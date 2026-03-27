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
const { renderWeekView, renderDailyView, renderCanvasContent, renderBundledNotification } = require('./formatting.js');
const { diffEvents, loadCachedEvents, saveCachedEvents, loadPendingNotifications, savePendingNotifications } = require('./diff.js');
const { matchesSchedule, shouldNotifyNow } = require('./scheduler.js');

const args = process.argv.slice(2);
const mode = args.find(arg => arg.startsWith('--') && !arg.startsWith('--dry'));
const dryRun = args.includes('--dry-run');

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
 * Route detected diffs to subscribed channels (polling mode - no debounce)
 * @param {Object} config - Bot configuration
 * @param {string} calendarId - Calendar identifier
 * @param {Array} diffsWithCalendar - Diffs with calendar name attached
 * @param {boolean} dryRun - Dry run mode flag
 * @returns {Promise<void>}
 */
async function routeChangeDetectionDiffs(config, calendarId, diffsWithCalendar, dryRun) {
  for (const channel of config.channels) {
    // Check if channel subscribes to this calendar
    if (!channel.calendars.includes(calendarId)) {
      continue;
    }

    // Filter diffs by notification settings
    const notifiableDiffs = diffsWithCalendar.filter(diff =>
      shouldNotifyNow(diff, channel)
    );

    if (notifiableDiffs.length === 0) {
      console.log(`Change detected for calendar ${calendarId} but channel ${channel.id} has notifications filtered - skipping`);
      continue;
    }

    // Post bundled notification (polling mode - no debounce)
    const locale = channel.locale || config.locale;
    const timezone = channel.timezone || config.timezone || 'UTC';
    const notification = renderBundledNotification(notifiableDiffs, locale, timezone);

    console.log(`Posting ${notifiableDiffs.length} change(s) to channel ${channel.id}`);
    await postMessage(channel.id, notification, dryRun);
  }
}

/**
 * Run change detection polling
 * Fetch all calendars, diff against cache, post bundled notifications
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

  // Process each calendar
  for (const calId of Object.keys(config.calendars)) {
    const calendar = config.calendars[calId];
    console.log(`Processing calendar: ${calendar.name} (${calId})`);

    let cachedData = null; // Declare outside try block for catch block access

    try {
      // Load previous state
      cachedData = await loadCacheState(calId, cacheDir);

      // Fetch current events
      const currentEvents = await fetchCalendar(
        calendar.caldav_url,
        config.caldav_credentials,
        dateRange
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

      // Route to channels
      await routeChangeDetectionDiffs(config, calId, diffsWithCalendar, dryRun);

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

  console.log('Change detection complete');
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
      console.log('[DRY RUN] No Slack API calls were made.');
    }

    process.exit(0);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

/**
 * Run scheduled digest checks for all channels
 * @param {Object} config - Bot configuration
 * @param {boolean} dryRun - Dry run mode flag
 * @returns {Promise<void>}
 */
async function runScheduledDigests(config, dryRun) {
  const now = new Date();

  for (const channel of config.channels) {
    // Check weekly digest
    if (channel.digest_schedule && matchesSchedule(channel.digest_schedule, now, channel.locale || config.locale)) {
      console.log(`Weekly digest match for channel ${channel.id}`);
      await postDigestForChannel(config, channel, 'weekly', dryRun);
    }

    // Check daily digest
    if (channel.daily_digest_schedule && matchesSchedule(channel.daily_digest_schedule, now, channel.locale || config.locale)) {
      console.log(`Daily digest match for channel ${channel.id}`);
      await postDigestForChannel(config, channel, 'daily', dryRun);
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
  // Fetch events from all calendars for this channel
  const allEvents = [];
  for (const calId of channel.calendars) {
    const calendar = config.calendars[calId];
    try {
      const events = await fetchCalendar(
        calendar.caldav_url,
        config.caldav_credentials,
        getCurrentWeekRange()
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
  const timezone = channel.timezone || config.timezone || 'UTC';
  const dateRange = type === 'daily'
    ? getDailyRange()
    : getCurrentWeekRange();

  const digest = type === 'daily'
    ? renderDailyView(allEvents, dateRange, locale, { ...channel, timezone })
    : renderWeekView(allEvents, dateRange, locale, { ...channel, timezone });
  await postMessage(channel.id, digest, dryRun);

  // Update Canvas (always full week)
  const canvasContent = renderCanvasContent(allEvents, { locale, timezone, ...channel });
  await updateCanvas(channel.canvas_id, canvasContent, dryRun);
}

/**
 * Get current week date range (Monday - Sunday)
 * @returns {Object} Object with start and end Date objects
 */
function getCurrentWeekRange() {
  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  const startOfWeek = new Date(now);
  startOfWeek.setUTCDate(now.getUTCDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1));
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
  const currentEvents = await fetchCalendar(
    calendar.caldav_url,
    config.caldav_credentials,
    getCurrentWeekRange()
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
      const staleNotification = renderBundledNotification(pending.diffs, locale, timezone);
      await postMessage(channel.id, staleNotification, dryRun);
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
    const notification = renderBundledNotification(allDiffs, locale, timezone);
    await postMessage(channel.id, notification, dryRun);

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

  for (const calId of Object.keys(config.calendars)) {
    const calendar = config.calendars[calId];
    const currentEvents = await fetchCalendar(
      calendar.caldav_url,
      config.caldav_credentials,
      getCurrentWeekRange()
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

module.exports = {
  getChangeDetectionRange
};

if (require.main === module) {
  main();
}
