const Database = require('better-sqlite3');
const { readdirSync, readFileSync, unlinkSync } = require('node:fs');
const path = require('node:path');

/**
 * Open (or create) a SQLite database, run schema migrations, and return the instance.
 * Pass ':memory:' for tests.
 * @param {string} dbPath - Absolute path to .db file, or ':memory:'
 * @returns {import('better-sqlite3').Database}
 */
function openDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      calendar_id       TEXT PRIMARY KEY,
      events_json       TEXT NOT NULL,
      last_error        TEXT,
      error_notified_at TEXT,
      updated_at        TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS color_cache (
      calendar_id TEXT PRIMARY KEY,
      color_json  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS run_state (
      channel_id  TEXT NOT NULL,
      digest_type TEXT NOT NULL,
      last_run    TEXT NOT NULL,
      PRIMARY KEY (channel_id, digest_type)
    );
    CREATE TABLE IF NOT EXISTS pending_notifications (
      channel_id TEXT PRIMARY KEY,
      diffs_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

/**
 * Load cached events row for a calendar.
 * @param {import('better-sqlite3').Database} db
 * @param {string} calendarId
 * @returns {{events: Array, updated_at: string, last_error?: string, error_notified_at?: string}|null}
 */
function loadEvents(db, calendarId) {
  const row = db.prepare('SELECT * FROM events WHERE calendar_id = ?').get(calendarId);
  if (!row) return null;

  const events = JSON.parse(row.events_json).map(e => ({
    ...e,
    instances: (e.instances ?? []).map(inst => ({
      ...inst,
      start: new Date(inst.start),
      end: new Date(inst.end)
    }))
  }));

  const result = { events, updated_at: row.updated_at };
  if (row.last_error) result.last_error = row.last_error;
  if (row.error_notified_at) result.error_notified_at = row.error_notified_at;
  return result;
}

/**
 * Save events (and optional error state) for a calendar.
 * @param {import('better-sqlite3').Database} db
 * @param {string} calendarId
 * @param {Array} events
 * @param {{last_error?: string, error_notified_at?: string}|null} errorState
 */
function saveEvents(db, calendarId, events, errorState) {
  db.prepare(`
    INSERT INTO events (calendar_id, events_json, last_error, error_notified_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(calendar_id) DO UPDATE SET
      events_json = excluded.events_json,
      last_error = excluded.last_error,
      error_notified_at = excluded.error_notified_at,
      updated_at = excluded.updated_at
  `).run(
    calendarId,
    JSON.stringify(events || []),
    errorState?.last_error || null,
    errorState?.error_notified_at || null,
    new Date().toISOString()
  );
}

/**
 * Load cached color for a calendar.
 * @param {import('better-sqlite3').Database} db
 * @param {string} calendarId
 * @returns {{hex: string, emoji: string, source: string}|null}
 */
function loadColor(db, calendarId) {
  const row = db.prepare('SELECT color_json FROM color_cache WHERE calendar_id = ?').get(calendarId);
  return row ? JSON.parse(row.color_json) : null;
}

/**
 * Save color for a calendar.
 * @param {import('better-sqlite3').Database} db
 * @param {string} calendarId
 * @param {{hex: string, emoji: string, source: string}} color
 */
function saveColor(db, calendarId, color) {
  db.prepare(`
    INSERT INTO color_cache (calendar_id, color_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(calendar_id) DO UPDATE SET
      color_json = excluded.color_json,
      updated_at = excluded.updated_at
  `).run(calendarId, JSON.stringify(color), new Date().toISOString());
}

/**
 * Load last run timestamp for a channel digest.
 * @param {import('better-sqlite3').Database} db
 * @param {string} channelId
 * @param {'weekly'|'daily'} digestType
 * @returns {Date|null}
 */
function loadRunState(db, channelId, digestType) {
  const row = db.prepare('SELECT last_run FROM run_state WHERE channel_id = ? AND digest_type = ?').get(channelId, digestType);
  return row ? new Date(row.last_run) : null;
}

/**
 * Save last run timestamp for a channel digest.
 * @param {import('better-sqlite3').Database} db
 * @param {string} channelId
 * @param {'weekly'|'daily'} digestType
 * @param {Date} timestamp
 */
function saveRunState(db, channelId, digestType, timestamp) {
  db.prepare(`
    INSERT INTO run_state (channel_id, digest_type, last_run)
    VALUES (?, ?, ?)
    ON CONFLICT(channel_id, digest_type) DO UPDATE SET last_run = excluded.last_run
  `).run(channelId, digestType, timestamp.toISOString());
}

/**
 * Load pending notifications for a channel.
 * @param {import('better-sqlite3').Database} db
 * @param {string} channelId
 * @returns {{expired: boolean, diffs: Array}}
 */
function loadPending(db, channelId) {
  const row = db.prepare('SELECT diffs_json, created_at FROM pending_notifications WHERE channel_id = ?').get(channelId);
  if (!row) return { expired: false, diffs: [] };

  const ageSeconds = (Date.now() - new Date(row.created_at).getTime()) / 1000;
  const diffs = JSON.parse(row.diffs_json);
  return { expired: ageSeconds > 300, diffs };
}

/**
 * Save pending notifications for a channel.
 * @param {import('better-sqlite3').Database} db
 * @param {string} channelId
 * @param {Array} diffs
 * @param {Date} [createdAt]
 */
function savePending(db, channelId, diffs, createdAt = new Date()) {
  db.prepare(`
    INSERT INTO pending_notifications (channel_id, diffs_json, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT(channel_id) DO UPDATE SET
      diffs_json = excluded.diffs_json,
      created_at = excluded.created_at
  `).run(channelId, JSON.stringify(diffs), createdAt.toISOString());
}

/**
 * Migrate flat JSON files from a legacy cache directory into SQLite.
 * Imports events, colors, run state. Deletes migrated files on success.
 * Safe to call repeatedly — skips files already in DB.
 * @param {import('better-sqlite3').Database} db
 * @param {string} legacyDir - Directory previously used as CACHE_DIR
 */
function migrateFromFlatFiles(db, legacyDir) {
  let files;
  try {
    files = readdirSync(legacyDir);
  } catch {
    return;
  }

  for (const filename of files) {
    const filePath = path.join(legacyDir, filename);

    const runMatch = filename.match(/^\.lastrun-(.+)-(weekly|daily)\.json$/);
    if (runMatch) {
      try {
        const data = JSON.parse(readFileSync(filePath, 'utf-8'));
        if (data.lastRun) {
          const existing = loadRunState(db, runMatch[1], runMatch[2]);
          if (!existing) {
            saveRunState(db, runMatch[1], runMatch[2], new Date(data.lastRun));
            console.log(`[migration] Imported run state: ${filename}`);
          }
        }
        unlinkSync(filePath);
      } catch (err) {
        console.warn(`[migration] Failed to migrate ${filename}: ${err.message}`);
      }
      continue;
    }

    if (filename.endsWith('.json') && !filename.startsWith('.')) {
      const calendarId = filename.slice(0, -5);
      try {
        const data = JSON.parse(readFileSync(filePath, 'utf-8'));
        const existing = loadEvents(db, calendarId);
        if (!existing && data.events) {
          saveEvents(db, calendarId, data.events, {
            last_error: data.last_error || null,
            error_notified_at: data.error_notified_at || null
          });
          console.log(`[migration] Imported events: ${filename}`);
        }
        if (data.color) {
          const existingColor = loadColor(db, calendarId);
          if (!existingColor) {
            saveColor(db, calendarId, data.color);
            console.log(`[migration] Imported color: ${filename}`);
          }
        }
        unlinkSync(filePath);
      } catch (err) {
        console.warn(`[migration] Failed to migrate ${filename}: ${err.message}`);
      }
    }
  }
}

module.exports = {
  openDb,
  loadEvents,
  saveEvents,
  loadColor,
  saveColor,
  loadRunState,
  saveRunState,
  loadPending,
  savePending,
  migrateFromFlatFiles
};
