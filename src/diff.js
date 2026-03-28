/**
 * Event diffing and cache management
 */

/**
 * Compare two event arrays and detect changes
 * @param {Array} previous - Previous events
 * @param {Array} current - Current events
 * @returns {Array} Array of diff objects
 */
function diffEvents(previous, current) {
  const diffs = [];

  // Create maps for fast lookup
  const prevMap = new Map(previous.map(e => [e.id, e]));
  const currMap = new Map(current.map(e => [e.id, e]));

  // Detect new and modified events
  for (const currEvent of current) {
    const prevEvent = prevMap.get(currEvent.id);

    if (!prevEvent) {
      // New event
      diffs.push({
        type: 'new',
        event: currEvent
      });
      continue;
    }

    // Check for changes (ignoring description per spec)
    const changes = detectChanges(prevEvent, currEvent);
    if (changes) {
      diffs.push(changes);
    }
  }

  // Detect deleted events
  for (const prevEvent of previous) {
    if (!currMap.has(prevEvent.id)) {
      diffs.push({
        type: 'deleted',
        event: prevEvent
      });
    }
  }

  return diffs;
}

/**
 * Detect specific changes between two events
 */
function detectChanges(oldEvent, newEvent) {
  // For recurring events, compare rrule instead of individual instance timestamps
  // This prevents false positives from DST transitions affecting regenerated instances
  if (oldEvent.rrule || newEvent.rrule) {
    // If rrule changed or appeared/disappeared, that's a schedule change
    if (oldEvent.rrule !== newEvent.rrule) {
      console.log(`[DIFF] Recurrence pattern changed for "${newEvent.title}"`);
      return {
        type: 'time_changed',
        event: newEvent,
        old: { start: oldEvent.start, end: oldEvent.end, isAllDay: oldEvent.isAllDay },
        new: { start: newEvent.start, end: newEvent.end, isAllDay: newEvent.isAllDay }
      };
    }
    // Same rrule = same recurring pattern, skip time comparison for instances
    // (instances will have different UTC timestamps across DST but represent same local times)
  } else {
    // Non-recurring event: compare actual timestamps
    const oldStart = oldEvent.start ? new Date(oldEvent.start).getTime() : null;
    const newStart = newEvent.start ? new Date(newEvent.start).getTime() : null;
    const oldEnd = oldEvent.end ? new Date(oldEvent.end).getTime() : null;
    const newEnd = newEvent.end ? new Date(newEvent.end).getTime() : null;

    if (oldStart !== newStart || oldEnd !== newEnd) {
      // Debug logging for real time changes
      if (oldStart !== newStart) {
        console.log(`[DIFF] Start time changed for "${newEvent.title}": ${oldEvent.start?.toISOString?.()} → ${newEvent.start?.toISOString?.()}`);
      }
      if (oldEnd !== newEnd) {
        console.log(`[DIFF] End time changed for "${newEvent.title}": ${oldEvent.end?.toISOString?.()} → ${newEvent.end?.toISOString?.()}`);
      }

      return {
        type: 'time_changed',
        event: newEvent,
        old: { start: oldEvent.start, end: oldEvent.end, isAllDay: oldEvent.isAllDay },
        new: { start: newEvent.start, end: newEvent.end, isAllDay: newEvent.isAllDay }
      };
    }
  }

  // Title change
  if (oldEvent.title !== newEvent.title) {
    return {
      type: 'title_changed',
      event: newEvent,
      old: { title: oldEvent.title },
      new: { title: newEvent.title }
    };
  }

  // Location change
  if (oldEvent.location !== newEvent.location) {
    return {
      type: 'location_changed',
      event: newEvent,
      old: { location: oldEvent.location },
      new: { location: newEvent.location }
    };
  }

  // Description changes are explicitly ignored per spec

  return null; // No actionable changes
}

/**
 * Load cached events from GitHub Actions cache
 * @param {string} calendarId - Calendar identifier
 * @returns {Promise<Array|null>} Cached events or null if not found
 *
 * DEPRECATED: Originally designed for GitHub Actions cache approach.
 * Superseded by src/cache.js which uses the cache-state git branch.
 * Retained for reference. Safe to remove in a future cleanup pass.
 */
async function loadCachedEvents(calendarId) {
  try {
    const cache = await import('@actions/cache');
    const cacheKey = `calendar-state-${calendarId}`;
    const cachePath = `/tmp/cache-${calendarId}.json`;

    // Try to restore cache
    const restoredKey = await cache.restoreCache([cachePath], cacheKey);
    if (!restoredKey) {
      return null; // Cache miss
    }

    // Read cached data
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(cachePath, 'utf-8');
    const data = JSON.parse(content);

    return data.events || null;
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND' || error.message.includes('@actions/cache')) {
      console.warn('Cache unavailable (not running in GitHub Actions) — skipping cache operations');
    } else {
      console.warn(`Failed to load cache for ${calendarId}:`, error.message);
    }
    return null;
  }
}

/**
 * Save events to GitHub Actions cache
 * @param {string} calendarId - Calendar identifier
 * @param {Array} events - Events to cache
 * @returns {Promise<void>}
 *
 * DEPRECATED: Originally designed for GitHub Actions cache approach.
 * Superseded by src/cache.js which uses the cache-state git branch.
 * Retained for reference. Safe to remove in a future cleanup pass.
 */
async function saveCachedEvents(calendarId, events) {
  try {
    const cache = await import('@actions/cache');
    const cacheKey = `calendar-state-${calendarId}`;
    const cachePath = `/tmp/cache-${calendarId}.json`;

    // Write data to temp file
    const { writeFile } = await import('node:fs/promises');
    const data = {
      timestamp: new Date().toISOString(),
      events
    };
    await writeFile(cachePath, JSON.stringify(data), 'utf-8');

    // Save to cache
    await cache.saveCache([cachePath], cacheKey);
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND' || error.message.includes('@actions/cache')) {
      console.warn('Cache unavailable (not running in GitHub Actions) — skipping cache operations');
    } else {
      console.warn(`Failed to save cache for ${calendarId}:`, error.message);
    }
    // Non-fatal - continue execution
  }
}

/**
 * Load pending notifications from debounce cache
 * @param {string} channelId - Channel identifier
 * @returns {Promise<Object>} { expired: boolean, diffs: [] } - expired=true means window expired and diffs should be posted
 */
async function loadPendingNotifications(channelId) {
  try {
    const cache = await import('@actions/cache');
    const cacheKey = `pending-notifications-${channelId}`;
    const cachePath = `/tmp/pending-${channelId}.json`;

    const restoredKey = await cache.restoreCache([cachePath], cacheKey);
    if (!restoredKey) {
      return { expired: false, diffs: [] }; // No pending notifications
    }

    const { readFile } = await import('node:fs/promises');
    const content = await readFile(cachePath, 'utf-8');
    const data = JSON.parse(content);

    // Check if notifications are within 5 min window
    const timestamp = new Date(data.timestamp);
    const now = new Date();
    const ageSeconds = (now - timestamp) / 1000;

    if (ageSeconds > 300) {
      // Window expired — return stale diffs so they get posted, not dropped
      return { expired: true, diffs: data.diffs || [] };
    }

    return { expired: false, diffs: data.diffs || [] };
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND' || error.message.includes('@actions/cache')) {
      console.warn('Cache unavailable (not running in GitHub Actions) — skipping cache operations');
    } else {
      console.warn(`Failed to load pending notifications for ${channelId}:`, error.message);
    }
    return { expired: false, diffs: [] };
  }
}

/**
 * Save pending notifications to debounce cache
 * @param {string} channelId - Channel identifier
 * @param {Array} diffs - Notification diffs to cache
 * @returns {Promise<void>}
 */
async function savePendingNotifications(channelId, diffs) {
  try {
    const cache = await import('@actions/cache');
    const cacheKey = `pending-notifications-${channelId}`;
    const cachePath = `/tmp/pending-${channelId}.json`;

    const { writeFile } = await import('node:fs/promises');
    const data = {
      timestamp: new Date().toISOString(),
      diffs
    };
    await writeFile(cachePath, JSON.stringify(data), 'utf-8');

    await cache.saveCache([cachePath], cacheKey);
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND' || error.message.includes('@actions/cache')) {
      console.warn('Cache unavailable (not running in GitHub Actions) — skipping cache operations');
    } else {
      console.warn(`Failed to save pending notifications for ${channelId}:`, error.message);
    }
    // Non-fatal - continue execution
  }
}

module.exports = {
  diffEvents,
  loadCachedEvents,
  saveCachedEvents,
  loadPendingNotifications,
  savePendingNotifications
};
