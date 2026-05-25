const Database = require('better-sqlite3');
const { encrypt, decrypt } = require('./crypto.js');

/**
 * Open (or create) a SQLite database, run schema migrations, and return the instance.
 * Pass ':memory:' for tests.
 * @param {string} dbPath - Absolute path to .db file, or ':memory:'
 * @returns {import('better-sqlite3').Database}
 */
function openDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const version = db.pragma('user_version', { simple: true });

  if (version === 0) {
    db.transaction(() => {
      db.exec(`
        DROP TABLE IF EXISTS events;
        DROP TABLE IF EXISTS color_cache;
        DROP TABLE IF EXISTS run_state;
        DROP TABLE IF EXISTS pending_notifications;

        CREATE TABLE workspaces (
          team_id       TEXT PRIMARY KEY,
          team_name     TEXT NOT NULL,
          bot_token     TEXT,
          installed_by  TEXT,
          installed_at  TEXT NOT NULL,
          active        INTEGER NOT NULL DEFAULT 1,
          locale        TEXT,
          timezone      TEXT,
          error_channel TEXT,
          nextcloud_url TEXT
        );

        CREATE TABLE caldav_credentials (
          workspace_id TEXT PRIMARY KEY,
          username     TEXT NOT NULL,
          password     TEXT NOT NULL,
          FOREIGN KEY (workspace_id) REFERENCES workspaces(team_id)
        );

        CREATE TABLE calendars (
          workspace_id        TEXT NOT NULL,
          calendar_id         TEXT NOT NULL,
          name                TEXT NOT NULL,
          caldav_url          TEXT NOT NULL,
          caldav_metadata_url TEXT,
          color               TEXT,
          PRIMARY KEY (workspace_id, calendar_id),
          FOREIGN KEY (workspace_id) REFERENCES workspaces(team_id)
        );

        CREATE TABLE channels (
          workspace_id          TEXT NOT NULL,
          channel_id            TEXT NOT NULL,
          name                  TEXT,
          canvas_id             TEXT,
          canvas_url            TEXT,
          locale                TEXT,
          view                  TEXT,
          event_detail          TEXT,
          digest_style          TEXT,
          digest_format         TEXT,
          digest_schedule       TEXT,
          daily_digest_schedule TEXT,
          show_empty_days       INTEGER,
          notifications         TEXT,
          PRIMARY KEY (workspace_id, channel_id),
          FOREIGN KEY (workspace_id) REFERENCES workspaces(team_id)
        );

        CREATE TABLE channel_calendars (
          workspace_id TEXT NOT NULL,
          channel_id   TEXT NOT NULL,
          calendar_id  TEXT NOT NULL,
          PRIMARY KEY (workspace_id, channel_id, calendar_id),
          FOREIGN KEY (workspace_id, channel_id) REFERENCES channels(workspace_id, channel_id),
          FOREIGN KEY (workspace_id, calendar_id) REFERENCES calendars(workspace_id, calendar_id)
        );

        CREATE TABLE events (
          workspace_id      TEXT NOT NULL,
          calendar_id       TEXT NOT NULL,
          events_json       TEXT NOT NULL,
          last_error        TEXT,
          error_notified_at TEXT,
          updated_at        TEXT NOT NULL,
          PRIMARY KEY (workspace_id, calendar_id)
        );

        CREATE TABLE color_cache (
          workspace_id TEXT NOT NULL,
          calendar_id  TEXT NOT NULL,
          color_json   TEXT NOT NULL,
          updated_at   TEXT NOT NULL,
          PRIMARY KEY (workspace_id, calendar_id)
        );

        CREATE TABLE run_state (
          workspace_id TEXT NOT NULL,
          channel_id   TEXT NOT NULL,
          digest_type  TEXT NOT NULL,
          last_run     TEXT NOT NULL,
          PRIMARY KEY (workspace_id, channel_id, digest_type)
        );

        CREATE TABLE pending_notifications (
          workspace_id TEXT NOT NULL,
          channel_id   TEXT NOT NULL,
          diffs_json   TEXT NOT NULL,
          created_at   TEXT NOT NULL,
          PRIMARY KEY (workspace_id, channel_id)
        );
      `);
    })();
    db.pragma('user_version = 1');
  }

  return db;
}

/**
 * Load cached events row for a calendar.
 * @param {import('better-sqlite3').Database} db
 * @param {string} workspaceId
 * @param {string} calendarId
 * @returns {{events: Array, updated_at: string, last_error?: string, error_notified_at?: string}|null}
 */
function loadEvents(db, workspaceId, calendarId) {
  const row = db.prepare('SELECT * FROM events WHERE workspace_id = ? AND calendar_id = ?').get(workspaceId, calendarId);
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
 * @param {string} workspaceId
 * @param {string} calendarId
 * @param {Array} events
 * @param {{last_error?: string, error_notified_at?: string}|null} errorState
 */
function saveEvents(db, workspaceId, calendarId, events, errorState) {
  db.prepare(`
    INSERT INTO events (workspace_id, calendar_id, events_json, last_error, error_notified_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, calendar_id) DO UPDATE SET
      events_json = excluded.events_json,
      last_error = excluded.last_error,
      error_notified_at = excluded.error_notified_at,
      updated_at = excluded.updated_at
  `).run(
    workspaceId,
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
 * @param {string} workspaceId
 * @param {string} calendarId
 * @returns {{hex: string, emoji: string, source: string}|null}
 */
function loadColor(db, workspaceId, calendarId) {
  const row = db.prepare('SELECT color_json FROM color_cache WHERE workspace_id = ? AND calendar_id = ?').get(workspaceId, calendarId);
  return row ? JSON.parse(row.color_json) : null;
}

/**
 * Save color for a calendar.
 * @param {import('better-sqlite3').Database} db
 * @param {string} workspaceId
 * @param {string} calendarId
 * @param {{hex: string, emoji: string, source: string}} color
 */
function saveColor(db, workspaceId, calendarId, color) {
  db.prepare(`
    INSERT INTO color_cache (workspace_id, calendar_id, color_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(workspace_id, calendar_id) DO UPDATE SET
      color_json = excluded.color_json,
      updated_at = excluded.updated_at
  `).run(workspaceId, calendarId, JSON.stringify(color), new Date().toISOString());
}

/**
 * Load last run timestamp for a channel digest.
 * @param {import('better-sqlite3').Database} db
 * @param {string} workspaceId
 * @param {string} channelId
 * @param {'weekly'|'daily'} digestType
 * @returns {Date|null}
 */
function loadRunState(db, workspaceId, channelId, digestType) {
  const row = db.prepare('SELECT last_run FROM run_state WHERE workspace_id = ? AND channel_id = ? AND digest_type = ?').get(workspaceId, channelId, digestType);
  return row ? new Date(row.last_run) : null;
}

/**
 * Save last run timestamp for a channel digest.
 * @param {import('better-sqlite3').Database} db
 * @param {string} workspaceId
 * @param {string} channelId
 * @param {'weekly'|'daily'} digestType
 * @param {Date} timestamp
 */
function saveRunState(db, workspaceId, channelId, digestType, timestamp) {
  db.prepare(`
    INSERT INTO run_state (workspace_id, channel_id, digest_type, last_run)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(workspace_id, channel_id, digest_type) DO UPDATE SET last_run = excluded.last_run
  `).run(workspaceId, channelId, digestType, timestamp.toISOString());
}

/**
 * Load pending notifications for a channel.
 * @param {import('better-sqlite3').Database} db
 * @param {string} workspaceId
 * @param {string} channelId
 * @returns {{expired: boolean, diffs: Array}}
 */
function loadPending(db, workspaceId, channelId) {
  const row = db.prepare('SELECT diffs_json, created_at FROM pending_notifications WHERE workspace_id = ? AND channel_id = ?').get(workspaceId, channelId);
  if (!row) return { expired: false, diffs: [] };
  const ageSeconds = (Date.now() - new Date(row.created_at).getTime()) / 1000;
  const diffs = JSON.parse(row.diffs_json);
  return { expired: ageSeconds > 300, diffs };
}

/**
 * Save pending notifications for a channel.
 * @param {import('better-sqlite3').Database} db
 * @param {string} workspaceId
 * @param {string} channelId
 * @param {Array} diffs
 * @param {Date} [createdAt]
 */
function savePending(db, workspaceId, channelId, diffs, createdAt = new Date()) {
  db.prepare(`
    INSERT INTO pending_notifications (workspace_id, channel_id, diffs_json, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(workspace_id, channel_id) DO UPDATE SET
      diffs_json = excluded.diffs_json,
      created_at = excluded.created_at
  `).run(workspaceId, channelId, JSON.stringify(diffs), createdAt.toISOString());
}

/**
 * Get workspace row by team_id, decrypting bot_token transparently.
 * @param {import('better-sqlite3').Database} db
 * @param {string} workspaceId
 * @returns {Object|null}
 */
function getWorkspace(db, workspaceId) {
  const row = db.prepare('SELECT * FROM workspaces WHERE team_id = ?').get(workspaceId) || null;
  if (row?.bot_token) row.bot_token = decrypt(row.bot_token);
  return row;
}

/**
 * Insert or update a workspace. bot_token is preserved on conflict (not overwritten).
 * @param {import('better-sqlite3').Database} db
 * @param {{ teamId: string, teamName?: string, botToken?: string, installedBy?: string, locale?: string, timezone?: string, errorChannel?: string, nextcloudUrl?: string }} opts
 */
function upsertWorkspace(db, { teamId, teamName, botToken = null, installedBy = null, locale = null, timezone = null, errorChannel = null, nextcloudUrl = null }) {
  db.prepare(`
    INSERT INTO workspaces (team_id, team_name, bot_token, installed_by, installed_at, active, locale, timezone, error_channel, nextcloud_url)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
    ON CONFLICT(team_id) DO UPDATE SET
      team_name     = excluded.team_name,
      locale        = excluded.locale,
      timezone      = excluded.timezone,
      error_channel = excluded.error_channel,
      nextcloud_url = excluded.nextcloud_url,
      active        = excluded.active
  `).run(teamId, teamName || teamId, botToken ? encrypt(botToken) : null, installedBy, new Date().toISOString(), locale, timezone, errorChannel, nextcloudUrl);
}

/**
 * Insert or update CalDAV credentials. Encrypts password transparently.
 * @param {import('better-sqlite3').Database} db
 * @param {string} workspaceId
 * @param {string} username
 * @param {string} password - plaintext; stored encrypted
 */
function upsertCaldavCredentials(db, workspaceId, username, password) {
  db.prepare(`
    INSERT INTO caldav_credentials (workspace_id, username, password)
    VALUES (?, ?, ?)
    ON CONFLICT(workspace_id) DO UPDATE SET
      username = excluded.username,
      password = excluded.password
  `).run(workspaceId, username, encrypt(password));
}

/**
 * Get CalDAV credentials, decrypting password transparently.
 * @param {import('better-sqlite3').Database} db
 * @param {string} workspaceId
 * @returns {{username: string, password: string}|null}
 */
function getCaldavCredentials(db, workspaceId) {
  const row = db.prepare(
    'SELECT username, password FROM caldav_credentials WHERE workspace_id = ?'
  ).get(workspaceId);
  if (!row) return null;
  return { username: row.username, password: decrypt(row.password) };
}

/**
 * Insert or update a workspace from an OAuth install. Always updates bot_token and reactivates.
 * @param {import('better-sqlite3').Database} db
 * @param {{ teamId: string, teamName: string, botToken: string, installedBy: string }} opts
 */
function upsertWorkspaceFromOAuth(db, { teamId, teamName, botToken, installedBy }) {
  db.prepare(`
    INSERT INTO workspaces (team_id, team_name, bot_token, installed_by, installed_at, active)
    VALUES (?, ?, ?, ?, ?, 1)
    ON CONFLICT(team_id) DO UPDATE SET
      team_name    = excluded.team_name,
      bot_token    = excluded.bot_token,
      installed_by = excluded.installed_by,
      installed_at = excluded.installed_at,
      active       = 1
  `).run(teamId, teamName, encrypt(botToken), installedBy, new Date().toISOString());
}

/**
 * Return all active workspaces as an array with bot_token decrypted.
 * @param {import('better-sqlite3').Database} db
 * @returns {Array<Object>}
 */
function listActiveWorkspaces(db) {
  const rows = db.prepare('SELECT * FROM workspaces WHERE active = 1').all();
  return rows.map(row => {
    if (row.bot_token) row.bot_token = decrypt(row.bot_token);
    return row;
  });
}

/**
 * Mark a workspace as inactive (e.g. after app_uninstalled event).
 * No-op if team_id does not exist.
 * @param {import('better-sqlite3').Database} db
 * @param {string} teamId
 */
function markWorkspaceInactive(db, teamId) {
  db.prepare('UPDATE workspaces SET active = 0 WHERE team_id = ?').run(teamId);
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
  getWorkspace,
  upsertWorkspace,
  upsertCaldavCredentials,
  getCaldavCredentials,
  upsertWorkspaceFromOAuth,
  listActiveWorkspaces,
  markWorkspaceInactive
};
