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
 * @returns {Promise<void>}
 */
async function saveCacheState(calendarId, events, errorState, cacheDir) {
  if (!cacheDir) {
    throw new Error('cacheDir is required');
  }

  const filePath = path.join(cacheDir, `${calendarId}.json`);

  const data = {
    events: events || [],
    updated_at: new Date().toISOString(),
    ...(errorState?.last_error && { last_error: errorState.last_error }),
    ...(errorState?.error_notified_at && { error_notified_at: errorState.error_notified_at })
  };

  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

module.exports = {
  loadCacheState,
  saveCacheState
};
