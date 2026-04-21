/**
 * Event diffing and cache management
 */

/**
 * Generate a unique key for an event
 * With composite structure, recurring events are grouped by ID, not per-instance
 * @param {Object} event - Event object (composite structure with instances array)
 * @returns {string} Unique key for this event
 */
function getEventKey(event) {
  // Use event ID only - recurring events share same ID across instances
  return event.id;
}

/**
 * Compare two event arrays and detect changes
 * @param {Array} previous - Previous events
 * @param {Array} current - Current events
 * @returns {Array} Array of diff objects
 */
function diffEvents(previous, current) {
  const diffs = [];

  // Create maps for fast lookup using composite keys for recurring event instances
  const prevMap = new Map(previous.map(e => [getEventKey(e), e]));
  const currMap = new Map(current.map(e => [getEventKey(e), e]));

  // Detect new and modified events
  for (const currEvent of current) {
    const prevEvent = prevMap.get(getEventKey(currEvent));

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
    if (!currMap.has(getEventKey(prevEvent))) {
      diffs.push({
        type: 'deleted',
        event: prevEvent
      });
    }
  }

  return diffs;
}

/**
 * Normalize RRULE string by extracting just the RRULE part
 * Handles malformed RRULEs with DTSTART prefix from older cache format
 * @param {string|null} rrule - Raw RRULE string (may contain DTSTART prefix)
 * @returns {string|null} Normalized RRULE or null
 */
function normalizeRRule(rrule) {
  if (!rrule) return null;

  // If RRULE contains newlines, extract the RRULE line
  if (rrule.includes('\n')) {
    const rruleLine = rrule.split('\n').find(line => line.startsWith('RRULE:'));
    if (rruleLine) {
      return rruleLine.substring(6); // Skip "RRULE:" prefix
    }
  }

  // If already starts with RRULE:, strip the prefix
  if (rrule.startsWith('RRULE:')) {
    return rrule.substring(6);
  }

  // Already normalized (starts with FREQ=)
  return rrule;
}

/**
 * Detect specific changes between two events (composite structure)
 * Works with both recurring (with rrule) and non-recurring events
 */
function detectChanges(oldEvent, newEvent) {
  // Validate instances array exists
  if (!oldEvent.instances?.length || !newEvent.instances?.length) {
    console.warn(`[DIFF] Event missing instances array: "${newEvent.title || oldEvent.title}"`);
    return null;
  }

  // For recurring events, compare RRULE instead of individual instance timestamps
  if (oldEvent.rrule || newEvent.rrule) {
    // Normalize RRULEs before comparing (handles malformed DTSTART prefix)
    const normalizedOld = normalizeRRule(oldEvent.rrule);
    const normalizedNew = normalizeRRule(newEvent.rrule);

    // If RRULE changed or appeared/disappeared, that's a pattern change
    if (normalizedOld !== normalizedNew) {
      console.log(`[DIFF] Recurrence pattern changed for "${newEvent.title}"`);
      // TODO: Task 4 will add formatting support for pattern_changed type
      return {
        type: 'pattern_changed',
        event: newEvent,
        old: { rrule: oldEvent.rrule },
        new: { rrule: newEvent.rrule }
      };
    }
    // Same RRULE = same recurring pattern, no time change to report
  } else {
    // Non-recurring event: compare actual timestamps of first (only) instance
    const oldStart = oldEvent.instances[0].start ? new Date(oldEvent.instances[0].start).getTime() : null;
    const newStart = newEvent.instances[0].start ? new Date(newEvent.instances[0].start).getTime() : null;
    const oldEnd = oldEvent.instances[0].end ? new Date(oldEvent.instances[0].end).getTime() : null;
    const newEnd = newEvent.instances[0].end ? new Date(newEvent.instances[0].end).getTime() : null;

    if (oldStart !== newStart || oldEnd !== newEnd) {
      // Debug logging for real time changes
      if (oldStart !== newStart) {
        console.log(`[DIFF] Start time changed for "${newEvent.title}": ${oldEvent.instances[0].start?.toISOString?.()} → ${newEvent.instances[0].start?.toISOString?.()}`);
      }
      if (oldEnd !== newEnd) {
        console.log(`[DIFF] End time changed for "${newEvent.title}": ${oldEvent.instances[0].end?.toISOString?.()} → ${newEvent.instances[0].end?.toISOString?.()}`);
      }

      return {
        type: 'time_changed',
        event: newEvent,
        old: {
          start: oldEvent.instances[0].start,
          end: oldEvent.instances[0].end,
          isAllDay: oldEvent.isAllDay
        },
        new: {
          start: newEvent.instances[0].start,
          end: newEvent.instances[0].end,
          isAllDay: newEvent.isAllDay
        }
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

const { loadPending, savePending } = require('./db.js');

/**
 * Load pending notifications for a channel from SQLite.
 * @param {import('better-sqlite3').Database} db
 * @param {string} channelId
 * @returns {{expired: boolean, diffs: Array}}
 */
function loadPendingNotifications(db, channelId) {
  return loadPending(db, channelId);
}

/**
 * Save pending notifications for a channel to SQLite.
 * @param {import('better-sqlite3').Database} db
 * @param {string} channelId
 * @param {Array} diffs
 */
function savePendingNotifications(db, channelId, diffs) {
  savePending(db, channelId, diffs);
}

module.exports = {
  diffEvents,
  normalizeRRule,
  loadPendingNotifications,
  savePendingNotifications
};
