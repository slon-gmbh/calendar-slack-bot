/*
 * Git-based cache state management
 *
 * Cache files stored in cache-state orphan branch, one JSON file per calendar.
 * Structure: { events: [...], last_error: "...", error_notified_at: "...", updated_at: "..." }
 */

const { readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');

/*
 * Load cached calendar state from file
 * @param {string} calendarId - Calendar identifier
 * @param {string} cacheDir - Directory containing cache files (from CACHE_DIR env var)
 * @returns {Promise<Object|null>} Cache data or null if not found
 */
async function loadCacheState(calendarId, cacheDir) {
  if (!cacheDir) {
    throw new Error('cacheDir is required');
  }

  const filePath = path.join(cacheDir, `${calendarId}.json`);

  try {
    const content = await readFile(filePath, 'utf-8');
    const data = JSON.parse(content);

    // Convert date strings back to Date objects and migrate to composite structure
    if (data && data.events) {
      data.events = data.events.map(event => {
        // Check if this is new composite structure (has instances array)
        if (event.instances && Array.isArray(event.instances)) {
          // New format: convert instance dates
          return {
            ...event,
            instances: event.instances.map(instance => ({
              start: new Date(instance.start),
              end: new Date(instance.end),
              isException: instance.isException || false
            }))
          };
        }

        // Old format: migrate to composite structure
        const start = new Date(event.start);

        // Validate start date
        if (isNaN(start.getTime())) {
          throw new Error(`Invalid cached start date for event "${event.title}": ${event.start}`);
        }

        // Convert and validate end date if present
        let end = event.end;
        if (end) {
          end = new Date(end);
          if (isNaN(end.getTime())) {
            throw new Error(`Invalid cached end date for event "${event.title}": ${event.end}`);
          }
        }

        // Migrate RRULE from old multi-line format if needed
        let rrule = event.rrule || null;
        if (rrule && typeof rrule === 'string' && rrule.includes('\n')) {
          // Old cache had multi-line RRULE (DTSTART + RRULE), extract just the RRULE line
          const rruleLine = rrule.split('\n').find(line => line.startsWith('RRULE:'));
          if (rruleLine) {
            rrule = rruleLine.substring(6); // Skip "RRULE:" prefix
            console.log(`[Cache Migration] Extracted RRULE for "${event.title}": ${rrule}`);
          } else if (rrule.startsWith('FREQ=')) {
            // Already in simple format
            rrule = rrule;
          } else {
            // Invalid format, set to null
            console.warn(`[Cache Migration] Invalid RRULE format for "${event.title}": ${rrule}`);
            rrule = null;
          }
        }

        // Migrate old format to composite structure
        return {
          id: event.id,
          title: event.title,
          location: event.location || null,
          description: event.description || null,
          isAllDay: event.isAllDay,
          rrule,
          instances: [{
            start,
            end: end || start,
            isException: false
          }],
          calendarName: event.calendarName
        };
      });
    }

    return data;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    if (error instanceof SyntaxError) {
      console.warn(`Corrupt cache file for ${calendarId}: ${error.message}`);
      return null;
    }
    throw error;
  }
}

/*
 * Save calendar state to cache file
 * @param {string} calendarId - Calendar identifier
 * @param {Array} events - Calendar events to cache
 * @param {Object} errorState - Error metadata { last_error, error_notified_at }
 * @param {string} cacheDir - Directory to write cache files
 * @param {Object} color - Optional: {hex, emoji, source}
 * @returns {Promise<void>}
 */
async function saveCacheState(calendarId, events, errorState, cacheDir, color = null) {
  if (!cacheDir) {
    throw new Error('cacheDir is required');
  }

  const filePath = path.join(cacheDir, `${calendarId}.json`);

  const data = {
    events: events || [],
    updated_at: new Date().toISOString(),
    ...(errorState?.last_error && { last_error: errorState.last_error }),
    ...(errorState?.error_notified_at && { error_notified_at: errorState.error_notified_at }),
    ...(color && { color })
  };

  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

module.exports = {
  loadCacheState,
  saveCacheState
};
