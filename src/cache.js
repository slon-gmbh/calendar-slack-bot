const { loadEvents, saveEvents, loadColor, saveColor } = require('./db.js');

/**
 * Load cached calendar state from SQLite.
 * @param {import('better-sqlite3').Database} db
 * @param {string} calendarId
 * @returns {{events: Array, updated_at: string, last_error?: string, error_notified_at?: string, color: Object|null}|null}
 */
function loadCacheState(db, calendarId) {
  const row = loadEvents(db, calendarId);
  if (!row) return null;
  return {
    ...row,
    color: loadColor(db, calendarId)
  };
}

/**
 * Save calendar state to SQLite.
 * @param {import('better-sqlite3').Database} db
 * @param {string} calendarId
 * @param {Array} events
 * @param {{last_error?: string, error_notified_at?: string}|null} errorState
 * @param {{hex: string, emoji: string, source: string}|null} color
 */
function saveCacheState(db, calendarId, events, errorState, color = null) {
  saveEvents(db, calendarId, events, errorState);
  if (color) {
    saveColor(db, calendarId, color);
  }
}

module.exports = {
  loadCacheState,
  saveCacheState
};
