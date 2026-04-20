#!/usr/bin/env node

/**
 * Calendar Slack Bot - Main Entry Point
 *
 * CLI Flags:
 * --scheduled: Runtime filtering mode (checks all channel schedules)
 * --weekly-digest: Force weekly digest to all channels (testing)
 * --daily-digest: Force daily digest to all channels (testing)
 * --event-changed: Webhook handler for calendar changes
 * --dry-run: Skip all Slack API calls (validation only)
 *
 * Architecture:
 * - config.js: Configuration loading and validation
 * - caldav.js: CalDAV fetching and parsing
 * - slack.js: Slack API operations
 * - formatting.js: Message and Canvas rendering
 * - diff.js: Event change detection
 * - scheduler.js: Urgency and schedule matching
 */

const { loadConfig } = require('./config.js');
const { fetchCalendar } = require('./caldav.js');
const { postMessage, updateCanvas, postErrorNotification } = require('./slack.js');
const { renderWeekView, renderDailyView, renderCanvasContent, renderBundledNotification, renderCalendarLegend } = require('./formatting.js');
const { diffEvents, loadCachedEvents, saveCachedEvents, loadPendingNotifications, savePendingNotifications } = require('./diff.js');
const { scheduleMatchesCron, shouldNotifyNow } = require('./scheduler.js');

const args = process.argv.slice(2);
const mode = args.find(arg => arg.startsWith('--') && !arg.startsWith('--dry'));
const dryRun = args.includes('--dry-run');

/**
 * Build cache map for color resolution
 * @param {Object} config - Bot configuration
 * @returns {Promise<Map>} Map of calendarId to cached events
 */
async function buildCacheMap(config) {
  const cacheMap = new Map();
  for (const calendarId of Object.keys(config.calendars)) {
    try {
      const cached = await loadCachedEvents(calendarId);
      if (cached) {
        cacheMap.set(calendarId, cached);
      }
    } catch (error) {
      console.warn(`Failed to load cache for calendar ${calendarId}:`, error.message);
    }
  }
  return cacheMap;
}

/**
 * Check if error notification should be posted (suppression logic)
 * @param {string} calendarId - Calendar identifier
 * @param {string} errorMessage - Current error message
 * @param {Object} cachedData - Cached calendar data with error state
 * @returns {boolean} True if should post notification
 */
function shouldPostErrorNotification(calendarId, errorMessage, cachedData) {
  if (!cachedData) {
    return true; // First run, always notify on error
  }

  const lastError = cachedData.last_error;
  const lastNotified = cachedData.error_notified_at;

  // No previous error, this is first failure
  if (!lastError) {
    return true;
  }

  // Different error, notify
  if (lastError !== errorMessage) {
    return true;
  }

  // Same error - check if 24 hours elapsed since last notification
  if (lastNotified) {
    const lastNotifiedDate = new Date(lastNotified);
    const now = new Date();
    const hoursSinceNotification = (now - lastNotifiedDate) / (1000 * 60 * 60);

    if (hoursSinceNotification >= 24) {
      return true; // 24 hours elapsed, notify again
    }
  }

  console.log(`Suppressing duplicate error notification for ${calendarId} (last notified: ${lastNotified})`);
  return false;
}

/**
 * Run change detection polling
 * Fetch all calendars, diff against cache, collect diffs per channel, then post consolidated notifications
 * @param {Object} config - Bot configuration
 * @param {boolean} dryRun - Dry run mode flag
 * @returns {Promise<void>}
 */
async function runChangeDetection(config, dryRun) {
  console.log('Running change detection...');

  const cacheDir = process.env.CACHE_DIR;
  if (!cacheDir) {
    throw new Error('CACHE_DIR environment variable not set');
  }

  const { loadCacheState, saveCacheState } = require('./cache.js');
  const dateRange = getChangeDetectionRange();

  console.log(`Checking calendars for changes (${dateRange.start.toISOString()} to ${dateRange.end.toISOString()})`);

  // Build cache map for color indicator assignment
  const cacheMap = await buildCacheMap(config);

  // Collect all diffs per channel: Map<channelId, Array<{calendarId, calendarName, diffs}>>
  const channelDiffsMap = new Map();

  // Process each calendar
  for (const calId of Object.keys(config.calendars)) {
    const calendar = config.calendars[calId];
    console.log(`Processing calendar: ${calendar.name} (${calId})`);

    let cachedData = null; // Declare outside try block for catch block access

    try {
      // Load previous state
      cachedData = await loadCacheState(calId, cacheDir);

      // Fetch current events
      const timezone = config.timezone || 'UTC';
      const currentEvents = await fetchCalendar(
        calendar.caldav_url,
        config.caldav_credentials,
        dateRange,
        timezone
      );

      if (!cachedData) {
        // Baseline mode - no previous state
        console.log(`No previous state for ${calId} - establishing baseline`);
        await saveCacheState(calId, currentEvents, null, cacheDir);
        continue;
      }

      // Diff previous vs current
      const previousEvents = cachedData.events || [];
      const diffs = diffEvents(previousEvents, currentEvents);

      if (diffs.length === 0) {
        console.log(`No changes detected for ${calId}`);
        await saveCacheState(calId, currentEvents, null, cacheDir);
        continue;
      }

      console.log(`Detected ${diffs.length} change(s) for ${calId}`);

      // Add calendar name to diffs
      const diffsWithCalendar = diffs.map(d => ({ ...d, calendarName: calendar.name }));

      // Collect diffs for each subscribed channel
      for (const channel of config.channels) {
        // Check if channel subscribes to this calendar
        if (!channel.calendars.includes(calId)) {
          continue;
        }

        // Filter diffs by notification settings
        const notifiableDiffs = diffsWithCalendar.filter(diff =>
          shouldNotifyNow(diff, channel)
        );

        if (notifiableDiffs.length === 0) {
          console.log(`Change detected for calendar ${calId} but channel ${channel.id} has notifications filtered - skipping`);
          continue;
        }

        // Add to collection
        if (!channelDiffsMap.has(channel.id)) {
          channelDiffsMap.set(channel.id, []);
        }
        channelDiffsMap.get(channel.id).push({
          calendarId: calId,
          calendarName: calendar.name,
          diffs: notifiableDiffs
        });

        console.log(`Collected ${notifiableDiffs.length} diff(s) for channel ${channel.id} from calendar ${calendar.name}`);
      }

      // Update cache (clear any previous error state)
      await saveCacheState(calId, currentEvents, null, cacheDir);

    } catch (error) {
      console.error(`Failed to fetch calendar '${calendar.name}' (${calId}): ${error.message}`);

      // Check if we should post error notification (suppression logic)
      const shouldNotify = shouldPostErrorNotification(calId, error.message, cachedData);

      if (shouldNotify) {
        await postErrorNotification(
          config.error_channel,
          `Calendar fetch failed: ${calendar.name}\n\n${error.message}`,
          dryRun
        );
      }

      // Save error state (don't update events - preserve last known good)
      if (cachedData) {
        await saveCacheState(calId, cachedData.events, {
          last_error: error.message,
          error_notified_at: shouldNotify ? new Date().toISOString() : cachedData.error_notified_at
        }, cacheDir);
      }

      // Continue with other calendars
    }
  }

  // Bundle and post consolidated messages per channel
  await bundleAndPostChangeDetections(config, channelDiffsMap, cacheMap, dryRun);

  console.log('Change detection complete');
}

/**
 * Bundle and post consolidated change detection messages per channel
 * Implements smart legend logic: single calendar in title, multiple calendars with legend
 * @param {Object} config - Bot configuration
 * @param {Map} channelDiffsMap - Map of channelId to Array of {calendarId, calendarName, diffs}
 * @param {Map} cacheMap - Cache map for color assignment
 * @param {boolean} dryRun - Dry run mode flag
 * @returns {Promise<void>}
 */
async function bundleAndPostChangeDetections(config, channelDiffsMap, cacheMap, dryRun) {
  const { loadCacheState, saveCacheState } = require('./cache.js');
  const cacheDir = process.env.CACHE_DIR;

  for (const [channelId, calendarDiffsArray] of channelDiffsMap) {
    // Find the channel config
    const channel = config.channels.find(ch => ch.id === channelId);
    if (!channel) {
      console.warn(`Channel ${channelId} not found in config, skipping`);
      continue;
    }

    // Flatten all diffs from all calendars
    const allDiffs = calendarDiffsArray.flatMap(cd => cd.diffs);
    const uniqueCalendars = new Set(calendarDiffsArray.map(cd => cd.calendarName));

    console.log(`Bundling ${allDiffs.length} diff(s) from ${uniqueCalendars.size} calendar(s) for channel ${channelId}`);

    // Render bundled notification
    const locale = channel.locale || config.locale;
    const timezone = channel.timezone || config.timezone || 'UTC';
    const { message: baseNotification, newColors } = await renderBundledNotification(
      allDiffs,
      locale,
      timezone,
      { config, cacheMap }
    );

    // Get calendar indicators for legend
    const { assignCalendarIndicators } = require('./formatting.js');
    const dummyEvents = Array.from(uniqueCalendars).map(name => ({ calendarName: name }));
    const { indicatorMap } = await assignCalendarIndicators(dummyEvents, config, cacheMap);

    let finalMessage = baseNotification;

    // Smart legend logic
    if (uniqueCalendars.size === 1) {
      // Single calendar: add calendar name + color to title
      const calendarName = Array.from(uniqueCalendars)[0];
      const indicator = indicatorMap.get(calendarName) || '';

      // Replace the title line with calendar-specific title
      // Handle both single change and multiple changes cases
      if (allDiffs.length === 1) {
        // Single change - the message doesn't have a numeric header
        // Title format varies by change type, so we'll add calendar info at the end
        finalMessage = baseNotification.trim() + ` · ${calendarName} ${indicator}`;
      } else {
        // Multiple changes - has header like "*5 calendar changes*"
        // Replace generic header with calendar-specific one
        const changeCount = allDiffs.length;
        const changesText = locale === 'de-DE' ? 'Änderungen' : 'changes';
        const newTitle = `*${changeCount} ${changesText} in ${calendarName} ${indicator}*`;
        finalMessage = baseNotification.replace(/^\*\d+ [^\*]+\*/, newTitle);
      }
    } else {
      // Multiple calendars: append legend to message
      const legend = renderCalendarLegend(Array.from(uniqueCalendars).sort(), indicatorMap);
      finalMessage = baseNotification.trim() + '\n\n' + legend;
    }

    // Post consolidated message
    console.log(`Posting consolidated message to channel ${channelId} (${uniqueCalendars.size} calendar(s), ${allDiffs.length} diff(s))`);
    await postMessage(channelId, finalMessage, dryRun, config.error_channel);

    // Persist fetched colors to cache
    if (newColors && cacheDir) {
      for (const [calId, colorCache] of newColors.entries()) {
        try {
          const cached = await loadCacheState(calId, cacheDir);
          if (cached) {
            await saveCacheState(calId, cached.events, null, cacheDir, colorCache);
          }
        } catch (error) {
          console.warn(`Failed to persist color for calendar ${calId}:`, error.message);
        }
      }
    }
  }
}

/**
 * Main entry point for bot execution
 * @returns {Promise<void>}
 */
async function main() {
  try {
    const config = await loadConfig();

    if (mode === '--scheduled') {
      await runScheduledDigests(config, dryRun);
    } else if (mode === '--weekly-digest') {
      await runWeeklyDigest(config, dryRun, true);
    } else if (mode === '--daily-digest') {
      await runDailyDigest(config, dryRun, true);
    } else if (mode === '--event-changed') {
      await runEventChanged(config, dryRun);
    } else if (mode === '--detect-changes') {
      await runChangeDetection(config, dryRun);
    } else {
      console.error('Usage: node bot.js [--scheduled|--weekly-digest|--daily-digest|--event-changed|--detect-changes] [--dry-run]');
      process.exit(1);
    }

    if (dryRun) {
      console.log('[TEST MODE] All messages routed to error_channel. Canvas updates skipped.');
    }

    process.exit(0);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

/**
 * Load last run timestamp for a channel digest
 * @param {string} channelId - Channel ID
 * @param {string} digestType - 'weekly' or 'daily'
 * @returns {Promise<Date|null>} Last run timestamp or null
 */
async function loadLastRunTime(channelId, digestType) {
  const cacheDir = process.env.CACHE_DIR || '.';
  const { readFile } = require('node:fs/promises');
  const path = require('node:path');

  try {
    const filePath = path.join(cacheDir, `.lastrun-${channelId}-${digestType}.json`);
    const content = await readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    return data.lastRun ? new Date(data.lastRun) : null;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null; // File doesn't exist yet
    }
    console.warn(`Failed to load last run time for ${channelId}/${digestType}:`, error.message);
    return null;
  }
}

/**
 * Save last run timestamp for a channel digest
 * @param {string} channelId - Channel ID
 * @param {string} digestType - 'weekly' or 'daily'
 * @param {Date} timestamp - Run timestamp
 * @returns {Promise<void>}
 */
async function saveLastRunTime(channelId, digestType, timestamp) {
  const cacheDir = process.env.CACHE_DIR || '.';
  const { writeFile, mkdir } = require('node:fs/promises');
  const path = require('node:path');

  try {
    // Ensure cache directory exists
    await mkdir(cacheDir, { recursive: true });

    const filePath = path.join(cacheDir, `.lastrun-${channelId}-${digestType}.json`);
    const data = { lastRun: timestamp.toISOString() };
    await writeFile(filePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.warn(`Failed to save last run time for ${channelId}/${digestType}:`, error.message);
  }
}

/**
 * Run scheduled digest checks for all channels
 * @param {Object} config - Bot configuration
 * @param {boolean} dryRun - Dry run mode flag
 * @returns {Promise<void>}
 */
async function runScheduledDigests(config, dryRun) {
  const { hasRunToday, hasRunThisWeek } = require('./scheduler.js');
  const now = new Date();
  const firedCron = process.env.SCHEDULED_CRON;

  if (!firedCron) {
    console.warn('SCHEDULED_CRON env var not set — running all pending digests');
  }

  for (const channel of config.channels) {
    if (channel.digest_schedule) {
      const matches = firedCron ? scheduleMatchesCron(channel.digest_schedule, firedCron, now) : true;

      if (matches) {
        console.log(`Weekly digest schedule match for channel ${channel.id}`);
        const lastRun = await loadLastRunTime(channel.id, 'weekly');
        if (hasRunThisWeek(lastRun)) {
          console.log(`Weekly digest already posted this week for channel ${channel.id}, skipping`);
        } else {
          await postDigestForChannel(config, channel, 'weekly', dryRun);
          if (!dryRun) await saveLastRunTime(channel.id, 'weekly', now);
        }
      }
    }

    if (channel.daily_digest_schedule) {
      const matches = firedCron ? scheduleMatchesCron(channel.daily_digest_schedule, firedCron, now) : true;

      if (matches) {
        console.log(`Daily digest schedule match for channel ${channel.id}`);
        const lastRun = await loadLastRunTime(channel.id, 'daily');
        if (hasRunToday(lastRun)) {
          console.log(`Daily digest already posted today for channel ${channel.id}, skipping`);
        } else {
          await postDigestForChannel(config, channel, 'daily', dryRun);
          if (!dryRun) await saveLastRunTime(channel.id, 'daily', now);
        }
      }
    }
  }
}

/**
 * Post digest for a specific channel
 * @param {Object} config - Bot configuration
 * @param {Object} channel - Channel configuration
 * @param {string} type - Digest type ('daily' or 'weekly')
 * @param {boolean} dryRun - Dry run mode flag
 * @returns {Promise<void>}
 */
async function postDigestForChannel(config, channel, type, dryRun) {
  // Determine timezone early so we can use it for fetching
  const timezone = channel.timezone || config.timezone || 'UTC';

  // Fetch events from all calendars for this channel
  const allEvents = [];
  for (const calId of channel.calendars) {
    const calendar = config.calendars[calId];
    try {
      const events = await fetchCalendar(
        calendar.caldav_url,
        config.caldav_credentials,
        getCurrentWeekRange(),
        timezone
      );
      console.log(`Fetched ${events.length} events from calendar '${calendar.name}' (${calId})`);
      allEvents.push(...events.map(e => ({ ...e, calendarName: calendar.name })));
    } catch (error) {
      console.error(`Failed to fetch calendar '${calendar.name}' (${calId}): ${error.message}`);
      // Continue with other calendars instead of failing completely
    }
  }

  // Render and post digest
  const locale = channel.locale || config.locale;
  const dateRange = type === 'daily'
    ? getDailyRange()
    : getCurrentWeekRange();

  if (type === 'daily') {
    const hasEvents = allEvents.some(event => {
      const instances = event.instances && event.instances.length > 0 ? event.instances : [event];
      return instances.some(inst => inst.start >= dateRange.start && inst.start <= dateRange.end);
    });
    if (!hasEvents) {
      console.log(`No events for today/tomorrow in channel ${channel.id}, skipping daily digest`);
      const cacheMap = await buildCacheMap(config);
      const canvasContent = await renderCanvasContent(allEvents, { locale, timezone, ...channel, config, cacheMap });
      await updateCanvas(channel.canvas_id, canvasContent, dryRun);
      return;
    }
  }

  const cacheMap = await buildCacheMap(config);
  const digest = type === 'daily'
    ? await renderDailyView(allEvents, dateRange, locale, { ...channel, timezone, config, cacheMap, canvas_url: channel.canvas_url })
    : await renderWeekView(allEvents, dateRange, locale, { ...channel, timezone, config, cacheMap, canvas_url: channel.canvas_url });
  await postMessage(channel.id, digest, dryRun, config.error_channel);

  // Update Canvas (always full week)
  const canvasContent = await renderCanvasContent(allEvents, { locale, timezone, ...channel, config, cacheMap });
  await updateCanvas(channel.canvas_id, canvasContent, dryRun);
}

/**
 * Get current week date range (Monday - Sunday)
 * @param {Date} now - Optional date to use as "now" (for testing)
 * @returns {Object} Object with start and end Date objects
 */
function getCurrentWeekRange(now = new Date()) {
  const dayOfWeek = now.getUTCDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const startOfWeek = new Date(now);

  if (dayOfWeek === 0) {
    // Sunday: show upcoming week (tomorrow's Monday through next Sunday)
    startOfWeek.setUTCDate(now.getUTCDate() + 1);
  } else {
    // Monday-Saturday: show current week (this Monday through this Sunday)
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
 * @param {Date} now - Reference date (defaults to current time)
 * @returns {Object} Object with start and end Date objects
 */
function getChangeDetectionRange(now = new Date()) {
  // Current week range (Monday - Sunday)
  const dayOfWeek = now.getUTCDay();
  const startOfWeek = new Date(now);
  startOfWeek.setUTCDate(now.getUTCDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1));
  startOfWeek.setUTCHours(0, 0, 0, 0);

  // End of week + 4 additional weeks (5 weeks total)
  const endOfLookahead = new Date(startOfWeek);
  endOfLookahead.setUTCDate(startOfWeek.getUTCDate() + (7 * 5) - 1); // 5 weeks minus 1 day
  endOfLookahead.setUTCHours(23, 59, 59, 999);

  return { start: startOfWeek, end: endOfLookahead };
}

/**
 * Get daily digest date range (today and tomorrow)
 * @returns {Object} Object with start and end Date objects
 */
function getDailyRange() {
  const now = new Date();

  // Start of today (00:00:00)
  const startOfToday = new Date(now);
  startOfToday.setUTCHours(0, 0, 0, 0);

  // End of tomorrow (23:59:59)
  const endOfTomorrow = new Date(now);
  endOfTomorrow.setUTCDate(now.getUTCDate() + 1);
  endOfTomorrow.setUTCHours(23, 59, 59, 999);

  return { start: startOfToday, end: endOfTomorrow };
}

/**
 * Handle webhook event change notifications
 * @param {Object} config - Bot configuration
 * @param {boolean} dryRun - Dry run mode flag
 * @returns {Promise<void>}
 */
async function runEventChanged(config, dryRun) {
  // Parse webhook payload
  const payload = process.env.WEBHOOK_PAYLOAD ? JSON.parse(process.env.WEBHOOK_PAYLOAD) : {};
  const calendarId = payload.calendar_id || payload.calendarId || payload.id;

  if (!calendarId) {
    console.warn('No calendar_id in webhook payload - running full refresh');
    // Full refresh: check all calendars
    await runFullRefresh(config, dryRun);
    return;
  }

  // Find calendar config by exact match (case-sensitive first, then case-insensitive)
  let matchedCalId = null;
  for (const calId of Object.keys(config.calendars)) {
    if (calId === calendarId) {
      matchedCalId = calId;
      break;
    }
  }

  if (!matchedCalId) {
    for (const calId of Object.keys(config.calendars)) {
      if (calId.toLowerCase() === calendarId.toLowerCase()) {
        matchedCalId = calId;
        break;
      }
    }
  }

  if (!matchedCalId) {
    console.warn(`Calendar '${calendarId}' not found in config - running full refresh`);
    await runFullRefresh(config, dryRun);
    return;
  }

  console.log(`Processing webhook for calendar: ${matchedCalId}`);

  // Fetch current events
  const calendar = config.calendars[matchedCalId];
  const timezone = config.timezone || 'UTC';
  const currentEvents = await fetchCalendar(
    calendar.caldav_url,
    config.caldav_credentials,
    getCurrentWeekRange(),
    timezone
  );

  // Load cached events
  const previousEvents = await loadCachedEvents(matchedCalId) || [];

  // Detect diffs
  const diffs = diffEvents(previousEvents, currentEvents);

  if (diffs.length === 0) {
    console.log('No changes detected');
    await saveCachedEvents(matchedCalId, currentEvents);
    return;
  }

  console.log(`Detected ${diffs.length} change(s)`);

  // Add calendar name to diffs
  const diffsWithCalendar = diffs.map(d => ({ ...d, calendarName: calendar.name }));

  // Route to channels using shared helper
  await routeDiffsToChannels(config, matchedCalId, diffsWithCalendar, dryRun);

  // Save updated cache
  await saveCachedEvents(matchedCalId, currentEvents);
}

/**
 * Route detected diffs to subscribed channels with debouncing
 * Shared by runEventChanged and runFullRefresh
 * @param {Object} config - Bot configuration
 * @param {string} calendarId - Calendar identifier
 * @param {Array} diffsWithCalendar - Diffs with calendar name attached
 * @param {boolean} dryRun - Dry run mode flag
 * @returns {Promise<void>}
 */
async function routeDiffsToChannels(config, calendarId, diffsWithCalendar, dryRun) {
  const cacheMap = await buildCacheMap(config);
  const { loadCacheState, saveCacheState } = require('./cache.js');
  const cacheDir = process.env.CACHE_DIR;

  for (const channel of config.channels) {
    if (!channel.calendars.includes(calendarId)) {
      continue; // This channel doesn't subscribe to this calendar
    }

    // Filter diffs by notification settings and urgency
    const notifiableDiffs = diffsWithCalendar.filter(diff =>
      shouldNotifyNow(diff, channel)
    );

    if (notifiableDiffs.length === 0) {
      continue;
    }

    // Load pending notifications (debounce)
    const pending = await loadPendingNotifications(channel.id);

    // If window expired, post stale diffs first
    if (pending.expired && pending.diffs.length > 0) {
      console.log(`Debounce window expired for channel ${channel.id} - posting ${pending.diffs.length} stale diffs`);
      const locale = channel.locale || config.locale;
      const timezone = channel.timezone || config.timezone || 'UTC';
      const { message: staleNotification, newColors: staleNewColors } = await renderBundledNotification(pending.diffs, locale, timezone, { config, cacheMap });
      await postMessage(channel.id, staleNotification, dryRun, config.error_channel);

      // Persist colors from stale diffs
      if (staleNewColors && cacheDir) {
        for (const [calId, colorCache] of staleNewColors.entries()) {
          try {
            const cached = await loadCacheState(calId, cacheDir);
            if (cached) {
              await saveCacheState(calId, cached.events, null, cacheDir, colorCache);
            }
          } catch (error) {
            console.warn(`Failed to persist color for calendar ${calId}:`, error.message);
          }
        }
      }
    }

    // Now handle new diffs
    if (pending.expired || pending.diffs.length === 0) {
      // Start fresh debounce window for new diffs
      console.log(`Started fresh debounce window for channel ${channel.id}`);
      await savePendingNotifications(channel.id, notifiableDiffs);
      continue;
    }

    // Debounce window active - merge with pending
    const allDiffs = [...pending.diffs, ...notifiableDiffs];

    // Post bundled notification
    const locale = channel.locale || config.locale;
    const timezone = channel.timezone || config.timezone || 'UTC';
    const { message: notification, newColors } = await renderBundledNotification(allDiffs, locale, timezone, { config, cacheMap });
    await postMessage(channel.id, notification, dryRun, config.error_channel);

    // Persist fetched colors to cache
    if (newColors && cacheDir) {
      for (const [calId, colorCache] of newColors.entries()) {
        try {
          const cached = await loadCacheState(calId, cacheDir);
          if (cached) {
            await saveCacheState(calId, cached.events, null, cacheDir, colorCache);
          }
        } catch (error) {
          console.warn(`Failed to persist color for calendar ${calId}:`, error.message);
        }
      }
    }

    // Clear debounce cache
    await savePendingNotifications(channel.id, []);
  }
}

/**
 * Run full refresh for all calendars
 * @param {Object} config - Bot configuration
 * @param {boolean} dryRun - Dry run mode flag
 * @returns {Promise<void>}
 */
async function runFullRefresh(config, dryRun) {
  console.log('Running full refresh for all calendars');

  const timezone = config.timezone || 'UTC';
  for (const calId of Object.keys(config.calendars)) {
    const calendar = config.calendars[calId];
    const currentEvents = await fetchCalendar(
      calendar.caldav_url,
      config.caldav_credentials,
      getCurrentWeekRange(),
      timezone
    );
    const previousEvents = await loadCachedEvents(calId) || [];
    const diffs = diffEvents(previousEvents, currentEvents);

    if (diffs.length > 0) {
      console.log(`Calendar ${calId}: ${diffs.length} change(s)`);

      // Add calendar name to diffs
      const diffsWithCalendar = diffs.map(d => ({ ...d, calendarName: calendar.name }));

      // Route to channels using shared helper
      await routeDiffsToChannels(config, calId, diffsWithCalendar, dryRun);
    }

    await saveCachedEvents(calId, currentEvents);
  }
}

/**
 * Run weekly digest for all channels
 * @param {Object} config - Bot configuration
 * @param {boolean} dryRun - Dry run mode flag
 * @param {boolean} forceAll - Force digest for all channels
 * @returns {Promise<void>}
 */
async function runWeeklyDigest(config, dryRun, forceAll) {
  console.log('Running weekly digest...');
  for (const channel of config.channels) {
    await postDigestForChannel(config, channel, 'weekly', dryRun);
  }
}

/**
 * Run daily digest for all channels
 * @param {Object} config - Bot configuration
 * @param {boolean} dryRun - Dry run mode flag
 * @param {boolean} forceAll - Force digest for all channels
 * @returns {Promise<void>}
 */
async function runDailyDigest(config, dryRun, forceAll) {
  console.log('Running daily digest...');
  for (const channel of config.channels) {
    await postDigestForChannel(config, channel, 'daily', dryRun);
  }
}

// Export for testing
if (process.env.NODE_ENV === 'test') {
  module.exports = {
    getChangeDetectionRange,
    getCurrentWeekRange,
    loadLastRunTime,
    saveLastRunTime
  };
} else {
  module.exports = {
    getChangeDetectionRange,
    getCurrentWeekRange
  };
}

if (require.main === module) {
  main();
}
