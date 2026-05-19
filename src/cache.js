const { loadEvents, saveEvents, loadColor, saveColor } = require('./db.js');

/**
 * Load cached calendar state from SQLite.
 * @param {import('better-sqlite3').Database} db
 * @param {string} workspaceId
 * @param {string} calendarId
 * @returns {{events: Array, updated_at: string, last_error?: string, error_notified_at?: string, color: Object|null}|null}
 */
function loadCacheState(db, workspaceId, calendarId) {
  const row = loadEvents(db, workspaceId, calendarId);
  if (!row) return null;
  return {
    ...row,
    color: loadColor(db, workspaceId, calendarId)
  };
}

/**
 * Save calendar state to SQLite.
 * @param {import('better-sqlite3').Database} db
 * @param {string} workspaceId
 * @param {string} calendarId
 * @param {Array} events
 * @param {{last_error?: string, error_notified_at?: string}|null} errorState
 * @param {{hex: string, emoji: string, source: string}|null} color
 */
function saveCacheState(db, workspaceId, calendarId, events, errorState, color = null) {
  saveEvents(db, workspaceId, calendarId, events, errorState);
  if (color) {
    saveColor(db, workspaceId, calendarId, color);
  }
}

module.exports = {
  loadCacheState,
  saveCacheState
};
