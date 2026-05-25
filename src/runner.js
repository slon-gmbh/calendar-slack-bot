const { fetchCalendar } = require('./caldav.js');
const { postMessage, updateCanvas, postErrorNotification } = require('./slack.js');
const { renderWeekView, renderDailyView, renderCanvasContent, renderBundledNotification, renderCalendarLegend, assignCalendarIndicators } = require('./formatting.js');
const { diffEvents, loadPendingNotifications, savePendingNotifications } = require('./diff.js');
const { scheduleMatchesCron, shouldNotifyNow, hasRunToday, hasRunThisWeek } = require('./scheduler.js');
const { loadCacheState, saveCacheState } = require('./cache.js');
const { loadRunState, saveRunState } = require('./db.js');
const { loadConfigFromDb } = require('./config.js');

/**
 * Build cache map for color resolution — calendarId → full cache object
 * @param {Object} config
 * @param {import('better-sqlite3').Database} db
 * @returns {Promise<Map>}
 */
async function buildCacheMap(config, db) {
  const cacheMap = new Map();
  for (const calendarId of Object.keys(config.calendars)) {
    try {
      const cached = loadCacheState(db, config.workspace_id, calendarId);
      if (cached) cacheMap.set(calendarId, cached);
    } catch (error) {
      console.warn(`Failed to load cache for calendar ${calendarId}:`, error.message);
    }
  }
  return cacheMap;
}

/**
 * Check if error notification should be posted (suppression logic)
 * @param {string} calendarId
 * @param {string} errorMessage
 * @param {Object|null} cachedData
 * @returns {boolean}
 */
function shouldPostErrorNotification(calendarId, errorMessage, cachedData) {
  if (!cachedData) return true;
  const { last_error: lastError, error_notified_at: lastNotified } = cachedData;
  if (!lastError) return true;
  if (lastError !== errorMessage) return true;
  if (lastNotified) {
    const hoursSince = (Date.now() - new Date(lastNotified).getTime()) / (1000 * 60 * 60);
    if (hoursSince >= 24) return true;
  }
  console.log(`Suppressing duplicate error notification for ${calendarId} (last notified: ${cachedData.error_notified_at})`);
  return false;
}

/**
 * Run change detection polling
 * @param {import('better-sqlite3').Database} db
 * @param {string} workspaceId
 * @param {boolean} dryRun
 * @returns {Promise<void>}
 */
async function runChangeDetection(db, workspaceId, dryRun) {
  const config = loadConfigFromDb(db, workspaceId);
  console.log('Running change detection...');
  const dateRange = getChangeDetectionRange();
  console.log(`Checking calendars for changes (${dateRange.start.toISOString()} to ${dateRange.end.toISOString()})`);
  const cacheMap = await buildCacheMap(config, db);
  const channelDiffsMap = new Map();

  for (const calId of Object.keys(config.calendars)) {
    const calendar = config.calendars[calId];
    console.log(`Processing calendar: ${calendar.name} (${calId})`);
    let cachedData = null;

    try {
      cachedData = loadCacheState(db, config.workspace_id, calId);
      const timezone = config.timezone || 'UTC';
      const currentEvents = await fetchCalendar(calendar.caldav_url, config.caldav_credentials, dateRange, timezone);

      if (!cachedData) {
        console.log(`No previous state for ${calId} - establishing baseline`);
        saveCacheState(db, config.workspace_id, calId, currentEvents, null, null);
        continue;
      }

      const previousEvents = cachedData.events || [];
      const diffs = diffEvents(previousEvents, currentEvents);

      if (diffs.length === 0) {
        console.log(`No changes detected for ${calId}`);
        saveCacheState(db, config.workspace_id, calId, currentEvents, null, null);
        continue;
      }

      console.log(`Detected ${diffs.length} change(s) for ${calId}`);
      const diffsWithCalendar = diffs.map(d => ({ ...d, calendarName: calendar.name }));

      for (const channel of config.channels) {
        if (!channel.calendars.includes(calId)) continue;
        const notifiableDiffs = diffsWithCalendar.filter(diff => shouldNotifyNow(diff, channel));
        if (notifiableDiffs.length === 0) {
          console.log(`Change detected for ${calId} but channel ${channel.id} has notifications filtered - skipping`);
          continue;
        }
        if (!channelDiffsMap.has(channel.id)) channelDiffsMap.set(channel.id, []);
        channelDiffsMap.get(channel.id).push({ calendarId: calId, calendarName: calendar.name, diffs: notifiableDiffs });
        console.log(`Collected ${notifiableDiffs.length} diff(s) for channel ${channel.id} from ${calendar.name}`);
      }

      saveCacheState(db, config.workspace_id, calId, currentEvents, null, null);

    } catch (error) {
      console.error(`Failed to fetch calendar '${calendar.name}' (${calId}): ${error.message}`);
      const shouldNotify = shouldPostErrorNotification(calId, error.message, cachedData);
      if (shouldNotify) {
        await postErrorNotification(config.error_channel, `Calendar fetch failed: ${calendar.name}\n\n${error.message}`, dryRun);
      }
      if (cachedData) {
        saveCacheState(db, config.workspace_id, calId, cachedData.events, {
          last_error: error.message,
          error_notified_at: shouldNotify ? new Date().toISOString() : cachedData.error_notified_at
        }, null);
      }
    }
  }

  await bundleAndPostChangeDetections(config, channelDiffsMap, cacheMap, db, dryRun);
  console.log('Change detection complete');
}

/**
 * Bundle and post consolidated change detection messages per channel
 * @param {Object} config
 * @param {Map} channelDiffsMap - Map of channelId to Array of {calendarId, calendarName, diffs}
 * @param {Map} cacheMap
 * @param {import('better-sqlite3').Database} db
 * @param {boolean} dryRun
 * @returns {Promise<void>}
 */
async function bundleAndPostChangeDetections(config, channelDiffsMap, cacheMap, db, dryRun) {
  for (const [channelId, calendarDiffsArray] of channelDiffsMap) {
    const channel = config.channels.find(ch => ch.id === channelId);
    if (!channel) { console.warn(`Channel ${channelId} not found in config, skipping`); continue; }

    const allDiffs = calendarDiffsArray.flatMap(cd => cd.diffs);
    const uniqueCalendars = new Set(calendarDiffsArray.map(cd => cd.calendarName));

    console.log(`Bundling ${allDiffs.length} diff(s) from ${uniqueCalendars.size} calendar(s) for channel ${channelId}`);

    const locale = channel.locale || config.locale;
    const timezone = channel.timezone || config.timezone || 'UTC';
    const { message: baseNotification, newColors } = await renderBundledNotification(allDiffs, locale, timezone, { config, cacheMap });

    const dummyEvents = Array.from(uniqueCalendars).map(name => ({ calendarName: name }));
    const { indicatorMap } = await assignCalendarIndicators(dummyEvents, config, cacheMap);

    let finalMessage = baseNotification;
    if (uniqueCalendars.size === 1) {
      const calendarName = Array.from(uniqueCalendars)[0];
      const indicator = indicatorMap.get(calendarName) || '';
      if (allDiffs.length === 1) {
        finalMessage = baseNotification.trim() + ` · ${calendarName} ${indicator}`;
      } else {
        const changeCount = allDiffs.length;
        const changesText = locale === 'de-DE' ? 'Änderungen' : 'changes';
        const newTitle = `*${changeCount} ${changesText} in ${calendarName} ${indicator}*`;
        finalMessage = baseNotification.replace(/^\*\d+ [^\*]+\*/, newTitle);
      }
    } else {
      const legend = renderCalendarLegend(Array.from(uniqueCalendars).sort(), indicatorMap);
      finalMessage = baseNotification.trim() + '\n\n' + legend;
    }

    console.log(`Posting consolidated message to channel ${channelId} (${uniqueCalendars.size} calendar(s), ${allDiffs.length} diff(s))`);
    await postMessage(channelId, finalMessage, dryRun, config.error_channel);

    if (newColors) {
      for (const [calId, colorCache] of newColors.entries()) {
        try {
          const cached = loadCacheState(db, config.workspace_id, calId);
          if (cached) saveCacheState(db, config.workspace_id, calId, cached.events, null, colorCache);
        } catch (error) {
          console.warn(`Failed to persist color for calendar ${calId}:`, error.message);
        }
      }
    }
  }
}

/**
 * Run scheduled digest checks for all channels
 * @param {import('better-sqlite3').Database} db
 * @param {string} workspaceId
 * @param {boolean} dryRun
 * @returns {Promise<void>}
 */
async function runScheduledDigests(db, workspaceId, dryRun) {
  const config = loadConfigFromDb(db, workspaceId);
  const now = new Date();
  const firedCron = process.env.SCHEDULED_CRON;
  if (!firedCron) console.warn('SCHEDULED_CRON env var not set — running all pending digests');

  for (const channel of config.channels) {
    if (channel.digest_schedule) {
      const matches = firedCron ? scheduleMatchesCron(channel.digest_schedule, firedCron, now) : true;
      if (matches) {
        console.log(`Weekly digest schedule match for channel ${channel.id}`);
        const lastRun = loadRunState(db, config.workspace_id, channel.id, 'weekly');
        if (hasRunThisWeek(lastRun)) {
          console.log(`Weekly digest already posted this week for channel ${channel.id}, skipping`);
        } else {
          await postDigestForChannel(config, channel, 'weekly', db, dryRun);
          if (!dryRun) saveRunState(db, config.workspace_id, channel.id, 'weekly', now);
        }
      }
    }

    if (channel.daily_digest_schedule) {
      const matches = firedCron ? scheduleMatchesCron(channel.daily_digest_schedule, firedCron, now) : true;
      if (matches) {
        console.log(`Daily digest schedule match for channel ${channel.id}`);
        const lastRun = loadRunState(db, config.workspace_id, channel.id, 'daily');
        if (hasRunToday(lastRun)) {
          console.log(`Daily digest already posted today for channel ${channel.id}, skipping`);
        } else {
          await postDigestForChannel(config, channel, 'daily', db, dryRun);
          if (!dryRun) saveRunState(db, config.workspace_id, channel.id, 'daily', now);
        }
      }
    }
  }
}

/**
 * Post digest for a specific channel
 * @param {Object} config
 * @param {Object} channel
 * @param {'daily'|'weekly'} type
 * @param {import('better-sqlite3').Database} db
 * @param {boolean} dryRun
 * @returns {Promise<void>}
 */
async function postDigestForChannel(config, channel, type, db, dryRun) {
  const timezone = channel.timezone || config.timezone || 'UTC';
  const allEvents = [];

  for (const calId of channel.calendars) {
    const calendar = config.calendars[calId];
    try {
      const events = await fetchCalendar(calendar.caldav_url, config.caldav_credentials, getCurrentWeekRange(), timezone);
      console.log(`Fetched ${events.length} events from calendar '${calendar.name}' (${calId})`);
      allEvents.push(...events.map(e => ({ ...e, calendarName: calendar.name })));
    } catch (error) {
      console.error(`Failed to fetch calendar '${calendar.name}' (${calId}): ${error.message}`);
    }
  }

  const locale = channel.locale || config.locale;
  const dateRange = type === 'daily' ? getDailyRange() : getCurrentWeekRange();

  if (type === 'daily') {
    const hasEvents = allEvents.some(event => {
      const instances = event.instances && event.instances.length > 0 ? event.instances : [event];
      return instances.some(inst => inst.start >= dateRange.start && inst.start <= dateRange.end);
    });
    if (!hasEvents) {
      console.log(`No events for today/tomorrow in channel ${channel.id}, skipping daily digest`);
      const cacheMap = await buildCacheMap(config, db);
      const canvasContent = await renderCanvasContent(allEvents, { locale, timezone, ...channel, config, cacheMap });
      await updateCanvas(channel.canvas_id, canvasContent, dryRun);
      return;
    }
  }

  const cacheMap = await buildCacheMap(config, db);
  const digest = type === 'daily'
    ? await renderDailyView(allEvents, dateRange, locale, { ...channel, timezone, config, cacheMap, canvas_url: channel.canvas_url })
    : await renderWeekView(allEvents, dateRange, locale, { ...channel, timezone, config, cacheMap, canvas_url: channel.canvas_url });
  await postMessage(channel.id, digest, dryRun, config.error_channel);

  const canvasContent = await renderCanvasContent(allEvents, { locale, timezone, ...channel, config, cacheMap });
  await updateCanvas(channel.canvas_id, canvasContent, dryRun);
}

/**
 * Route detected diffs to subscribed channels with debouncing
 * @param {Object} config
 * @param {string} calendarId
 * @param {Array} diffsWithCalendar
 * @param {import('better-sqlite3').Database} db
 * @param {boolean} dryRun
 * @returns {Promise<void>}
 */
async function routeDiffsToChannels(config, calendarId, diffsWithCalendar, db, dryRun) {
  const cacheMap = await buildCacheMap(config, db);

  for (const channel of config.channels) {
    if (!channel.calendars.includes(calendarId)) continue;

    const notifiableDiffs = diffsWithCalendar.filter(diff => shouldNotifyNow(diff, channel));
    if (notifiableDiffs.length === 0) continue;

    const pending = loadPendingNotifications(db, config.workspace_id, channel.id);

    if (pending.expired && pending.diffs.length > 0) {
      console.log(`Debounce window expired for channel ${channel.id} - posting ${pending.diffs.length} stale diffs`);
      const locale = channel.locale || config.locale;
      const timezone = channel.timezone || config.timezone || 'UTC';
      const { message: staleNotification, newColors: staleNewColors } = await renderBundledNotification(pending.diffs, locale, timezone, { config, cacheMap });
      await postMessage(channel.id, staleNotification, dryRun, config.error_channel);

      if (staleNewColors) {
        for (const [calId, colorCache] of staleNewColors.entries()) {
          try {
            const cached = loadCacheState(db, config.workspace_id, calId);
            if (cached) saveCacheState(db, config.workspace_id, calId, cached.events, null, colorCache);
          } catch (error) {
            console.warn(`Failed to persist color for calendar ${calId}:`, error.message);
          }
        }
      }
    }

    if (pending.expired || pending.diffs.length === 0) {
      console.log(`Started fresh debounce window for channel ${channel.id}`);
      savePendingNotifications(db, config.workspace_id, channel.id, notifiableDiffs);
      continue;
    }

    const allDiffs = [...pending.diffs, ...notifiableDiffs];
    const locale = channel.locale || config.locale;
    const timezone = channel.timezone || config.timezone || 'UTC';
    const { message: notification, newColors } = await renderBundledNotification(allDiffs, locale, timezone, { config, cacheMap });
    await postMessage(channel.id, notification, dryRun, config.error_channel);

    if (newColors) {
      for (const [calId, colorCache] of newColors.entries()) {
        try {
          const cached = loadCacheState(db, config.workspace_id, calId);
          if (cached) saveCacheState(db, config.workspace_id, calId, cached.events, null, colorCache);
        } catch (error) {
          console.warn(`Failed to persist color for calendar ${calId}:`, error.message);
        }
      }
    }

    savePendingNotifications(db, config.workspace_id, channel.id, []);
  }
}

/**
 * Run full refresh for all calendars
 * @param {Object} config
 * @param {import('better-sqlite3').Database} db
 * @param {boolean} dryRun
 * @returns {Promise<void>}
 */
async function runFullRefresh(config, db, dryRun) {
  console.log('Running full refresh for all calendars');
  const timezone = config.timezone || 'UTC';
  for (const calId of Object.keys(config.calendars)) {
    const calendar = config.calendars[calId];
    const currentEvents = await fetchCalendar(calendar.caldav_url, config.caldav_credentials, getCurrentWeekRange(), timezone);
    const cached = loadCacheState(db, config.workspace_id, calId);
    const previousEvents = cached ? cached.events : [];
    const diffs = diffEvents(previousEvents, currentEvents);

    if (diffs.length > 0) {
      console.log(`Calendar ${calId}: ${diffs.length} change(s)`);
      const diffsWithCalendar = diffs.map(d => ({ ...d, calendarName: calendar.name }));
      await routeDiffsToChannels(config, calId, diffsWithCalendar, db, dryRun);
    }

    saveCacheState(db, config.workspace_id, calId, currentEvents, null, null);
  }
}

/**
 * Handle webhook event change notifications
 * @param {Object} config
 * @param {import('better-sqlite3').Database} db
 * @param {boolean} dryRun
 * @returns {Promise<void>}
 */
async function runEventChanged(config, db, dryRun) {
  const payload = process.env.WEBHOOK_PAYLOAD ? JSON.parse(process.env.WEBHOOK_PAYLOAD) : {};
  const calendarId = payload.calendar_id || payload.calendarId || payload.id;

  if (!calendarId) {
    console.warn('No calendar_id in webhook payload - running full refresh');
    await runFullRefresh(config, db, dryRun);
    return;
  }

  let matchedCalId = Object.keys(config.calendars).find(id => id === calendarId)
    || Object.keys(config.calendars).find(id => id.toLowerCase() === calendarId.toLowerCase());

  if (!matchedCalId) {
    console.warn(`Calendar '${calendarId}' not found in config - running full refresh`);
    await runFullRefresh(config, db, dryRun);
    return;
  }

  console.log(`Processing webhook for calendar: ${matchedCalId}`);
  const calendar = config.calendars[matchedCalId];
  const timezone = config.timezone || 'UTC';
  const currentEvents = await fetchCalendar(calendar.caldav_url, config.caldav_credentials, getCurrentWeekRange(), timezone);

  const cached = loadCacheState(db, config.workspace_id, matchedCalId);
  const previousEvents = cached ? cached.events : [];
  const diffs = diffEvents(previousEvents, currentEvents);

  if (diffs.length === 0) {
    console.log('No changes detected');
    saveCacheState(db, config.workspace_id, matchedCalId, currentEvents, null, null);
    return;
  }

  console.log(`Detected ${diffs.length} change(s)`);
  const diffsWithCalendar = diffs.map(d => ({ ...d, calendarName: calendar.name }));
  await routeDiffsToChannels(config, matchedCalId, diffsWithCalendar, db, dryRun);
  saveCacheState(db, config.workspace_id, matchedCalId, currentEvents, null, null);
}

/**
 * Run weekly digest for all channels
 * @param {Object} config
 * @param {import('better-sqlite3').Database} db
 * @param {boolean} dryRun
 * @param {boolean} forceAll
 * @returns {Promise<void>}
 */
async function runWeeklyDigest(config, db, dryRun, forceAll) {
  console.log('Running weekly digest...');
  for (const channel of config.channels) {
    await postDigestForChannel(config, channel, 'weekly', db, dryRun);
  }
}

/**
 * Run daily digest for all channels
 * @param {Object} config
 * @param {import('better-sqlite3').Database} db
 * @param {boolean} dryRun
 * @param {boolean} forceAll
 * @returns {Promise<void>}
 */
async function runDailyDigest(config, db, dryRun, forceAll) {
  console.log('Running daily digest...');
  for (const channel of config.channels) {
    await postDigestForChannel(config, channel, 'daily', db, dryRun);
  }
}

/**
 * Get current week date range (Monday - Sunday)
 * @param {Date} [now]
 * @returns {{start: Date, end: Date}}
 */
function getCurrentWeekRange(now = new Date()) {
  const dayOfWeek = now.getUTCDay();
  const startOfWeek = new Date(now);
  if (dayOfWeek === 0) {
    startOfWeek.setUTCDate(now.getUTCDate() + 1);
  } else {
    startOfWeek.setUTCDate(now.getUTCDate() - dayOfWeek + 1);
  }
  startOfWeek.setUTCHours(0, 0, 0, 0);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setUTCDate(startOfWeek.getUTCDate() + 6);
  endOfWeek.setUTCHours(23, 59, 59, 999);
  return { start: startOfWeek, end: endOfWeek };
}

/**
 * Get change detection date range (current week + 4 weeks lookahead)
 * @param {Date} [now]
 * @returns {{start: Date, end: Date}}
 */
function getChangeDetectionRange(now = new Date()) {
  const dayOfWeek = now.getUTCDay();
  const startOfWeek = new Date(now);
  startOfWeek.setUTCDate(now.getUTCDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1));
  startOfWeek.setUTCHours(0, 0, 0, 0);
  const endOfLookahead = new Date(startOfWeek);
  endOfLookahead.setUTCDate(startOfWeek.getUTCDate() + (7 * 5) - 1);
  endOfLookahead.setUTCHours(23, 59, 59, 999);
  return { start: startOfWeek, end: endOfLookahead };
}

/**
 * Get daily digest date range (today and tomorrow)
 * @returns {{start: Date, end: Date}}
 */
function getDailyRange() {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setUTCHours(0, 0, 0, 0);
  const endOfTomorrow = new Date(now);
  endOfTomorrow.setUTCDate(now.getUTCDate() + 1);
  endOfTomorrow.setUTCHours(23, 59, 59, 999);
  return { start: startOfToday, end: endOfTomorrow };
}

module.exports = {
  runScheduledDigests,
  runWeeklyDigest,
  runDailyDigest,
  runChangeDetection,
  runEventChanged,
  runFullRefresh,
  postDigestForChannel,
  buildCacheMap,
  getCurrentWeekRange,
  getChangeDetectionRange,
  getDailyRange
};
