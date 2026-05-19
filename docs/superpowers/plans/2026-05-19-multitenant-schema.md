# Multi-Tenant SQLite Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-tenant SQLite schema and file-based config with a workspace-scoped schema and `loadConfigFromDb(db, workspaceId)` that returns the same shape as the current `loadConfig()`.

**Architecture:** `openDb()` detects schema version via `PRAGMA user_version` and runs a drop-and-recreate migration (v0 → v1) that adds workspace_id to all tables with correct composite PKs and creates five new config tables. All db functions gain `workspaceId` as second parameter; wrapper files (`cache.js`, `diff.js`) are updated in turn; callers (`server.js`, `bot.js`, `runner.js`) thread `config.workspace_id` through.

**Tech Stack:** Node.js, better-sqlite3, node:test, node:assert

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/db.js` | Modify | Schema migration, all operational functions, 2 new workspace helpers, remove migrateFromFlatFiles |
| `src/cache.js` | Modify | Add `workspaceId` to `loadCacheState` / `saveCacheState` |
| `src/diff.js` | Modify | Add `workspaceId` to `loadPendingNotifications` / `savePendingNotifications` |
| `src/config.js` | Modify | Add `loadConfigFromDb` and `seedWorkspace`; keep `loadConfig` and `validateConfig` |
| `src/server.js` | Modify | Use `loadConfigFromDb`; read `WORKSPACE_ID` env var |
| `src/bot.js` | Modify | Use `loadConfigFromDb`; require `WORKSPACE_ID` env var |
| `src/runner.js` | Modify | Pass `config.workspace_id` to all cache / diff / db calls |
| `test/db.test.js` | Modify | Add `workspaceId` arg to all calls; schema test checks 9 tables; new workspace helper tests |
| `test/cache.test.js` | Modify | Add `workspaceId` arg to all calls |
| `test/config-db.test.js` | Create | Tests for `loadConfigFromDb` and `seedWorkspace` |

---

### Task 1: db.js — schema migration (openDb v0 → v1)

**Files:**
- Modify: `src/db.js`
- Modify: `test/db.test.js`

- [ ] **Step 1: Update the schema test to expect 9 tables**

Replace the existing `'openDb creates schema tables'` test in `test/db.test.js`:

```js
test('openDb creates schema tables', () => {
  const db = memDb();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
  const expected = [
    'caldav_credentials', 'calendars', 'channel_calendars', 'channels',
    'color_cache', 'events', 'pending_notifications', 'run_state', 'workspaces'
  ];
  assert.deepStrictEqual(tables.sort(), expected);
  db.close();
});

test('openDb sets schema user_version to 1', () => {
  const db = memDb();
  assert.strictEqual(db.pragma('user_version', { simple: true }), 1);
  db.close();
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
node --test test/db.test.js 2>&1 | head -30
```

Expected: `AssertionError` — tables array does not match, user_version is 0.

- [ ] **Step 3: Rewrite `openDb` in `src/db.js`**

Replace the entire `openDb` function (and remove the `readdirSync`, `readFileSync`, `unlinkSync` imports since `migrateFromFlatFiles` is also being removed):

```js
const Database = require('better-sqlite3');

/**
 * Open (or create) a SQLite database, run schema migrations, and return the instance.
 * Pass ':memory:' for tests.
 * @param {string} dbPath - Absolute path to .db file, or ':memory:'
 * @returns {import('better-sqlite3').Database}
 */
function openDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  const version = db.pragma('user_version', { simple: true });

  if (version === 0) {
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
    db.pragma('user_version = 1');
  }

  return db;
}
```

Also remove the top-level imports `readdirSync`, `readFileSync`, `unlinkSync` and the `path` import (they were only used by `migrateFromFlatFiles` which is being removed in Task 3).

- [ ] **Step 4: Run schema tests**

```bash
node --test test/db.test.js 2>&1 | grep -E 'pass|fail|ok|not ok' | head -20
```

Expected: schema tests pass. Other tests fail (expected — they still pass old signatures).

---

### Task 2: db.js — operational functions (add workspaceId)

**Files:**
- Modify: `src/db.js`
- Modify: `test/db.test.js`

- [ ] **Step 1: Update all existing function tests to pass `'T_TEST'` as workspaceId**

In `test/db.test.js`, add `'T_TEST'` as the second argument in every call to `loadEvents`, `saveEvents`, `loadColor`, `saveColor`, `loadRunState`, `saveRunState`, `loadPending`, `savePending`. Example changes:

```js
// Before:
saveEvents(db, 'cal-1', events, null);
const result = loadEvents(db, 'cal-1');

// After:
saveEvents(db, 'T_TEST', 'cal-1', events, null);
const result = loadEvents(db, 'T_TEST', 'cal-1');
```

Apply to all 11 existing function tests. Full list of call sites to update:

| Test name | Old calls | New calls |
|-----------|-----------|-----------|
| `saveEvents and loadEvents round-trip` | `saveEvents(db, 'cal-1', events, null)` / `loadEvents(db, 'cal-1')` | add `'T_TEST'` as 2nd arg |
| `loadEvents returns null for unknown calendarId` | `loadEvents(db, 'nonexistent')` | `loadEvents(db, 'T_TEST', 'nonexistent')` |
| `saveEvents persists error state` | `saveEvents(db, 'cal-err', ...)` | add `'T_TEST'` as 2nd arg |
| `saveColor and loadColor round-trip` | `saveColor(db, 'cal-1', ...)` / `loadColor(db, 'cal-1')` | add `'T_TEST'` as 2nd arg |
| `loadColor returns null for unknown calendarId` | `loadColor(db, 'nonexistent')` | `loadColor(db, 'T_TEST', 'nonexistent')` |
| `saveRunState and loadRunState round-trip` | `saveRunState(db, 'C123', ...)` / `loadRunState(db, 'C123', ...)` | add `'T_TEST'` as 2nd arg |
| `loadRunState returns null for unknown channel` | `loadRunState(db, 'C999', 'daily')` | `loadRunState(db, 'T_TEST', 'C999', 'daily')` |
| `savePending and loadPending round-trip` | `savePending(db, 'C123', ...)` / `loadPending(db, 'C123')` | add `'T_TEST'` as 2nd arg |
| `loadPending returns expired=true` | `savePending(db, 'C123', ...)` / `loadPending(db, 'C123')` | add `'T_TEST'` as 2nd arg |
| `loadPending returns empty for unknown channel` | `loadPending(db, 'C999')` | `loadPending(db, 'T_TEST', 'C999')` |
| `savePending second write overwrites first` | `savePending(db, 'C123', ...)` × 2 / `loadPending(db, 'C123')` | add `'T_TEST'` as 2nd arg |

- [ ] **Step 2: Run tests to confirm they fail**

```bash
node --test test/db.test.js 2>&1 | grep -c 'not ok'
```

Expected: several failures (wrong arg count).

- [ ] **Step 3: Update all 8 operational functions in `src/db.js`**

Replace each function with the workspace-scoped version:

```js
/**
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
```

- [ ] **Step 4: Run db tests**

```bash
node --test test/db.test.js 2>&1 | tail -10
```

Expected: all existing tests pass. Schema test passes.

- [ ] **Step 5: Commit**

```bash
git add src/db.js test/db.test.js
git commit -m "feat: add workspace_id to all db operational functions and schema

refs: #44"
```

---

### Task 3: db.js — workspace helpers + remove migrateFromFlatFiles

**Files:**
- Modify: `src/db.js`
- Modify: `test/db.test.js`

- [ ] **Step 1: Write tests for the two new workspace helpers**

Add to `test/db.test.js`:

```js
const { openDb, loadEvents, saveEvents, loadColor, saveColor, loadRunState, saveRunState,
        loadPending, savePending, getWorkspace, upsertWorkspace } = require('../src/db.js');

test('getWorkspace returns null for unknown workspace', () => {
  const db = memDb();
  assert.strictEqual(getWorkspace(db, 'T_UNKNOWN'), null);
  db.close();
});

test('upsertWorkspace and getWorkspace round-trip', () => {
  const db = memDb();
  upsertWorkspace(db, { teamId: 'T_123', teamName: 'Test Team', locale: 'de-DE', timezone: 'Europe/Berlin' });
  const row = getWorkspace(db, 'T_123');
  assert.ok(row);
  assert.strictEqual(row.team_id, 'T_123');
  assert.strictEqual(row.team_name, 'Test Team');
  assert.strictEqual(row.locale, 'de-DE');
  assert.strictEqual(row.timezone, 'Europe/Berlin');
  assert.strictEqual(row.active, 1);
  assert.ok(row.installed_at);
  db.close();
});

test('upsertWorkspace is idempotent — bot_token not overwritten on re-upsert', () => {
  const db = memDb();
  upsertWorkspace(db, { teamId: 'T_123', teamName: 'Test Team', botToken: 'xoxb-secret' });
  upsertWorkspace(db, { teamId: 'T_123', teamName: 'Updated Name' });
  const row = getWorkspace(db, 'T_123');
  assert.strictEqual(row.team_name, 'Updated Name');
  assert.strictEqual(row.bot_token, 'xoxb-secret');  // preserved
  db.close();
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
node --test test/db.test.js 2>&1 | grep 'getWorkspace\|upsertWorkspace'
```

Expected: TypeError — `getWorkspace` is not a function.

- [ ] **Step 3: Add `getWorkspace` and `upsertWorkspace` to `src/db.js`**

```js
/**
 * Get workspace row by team_id.
 * @param {import('better-sqlite3').Database} db
 * @param {string} workspaceId
 * @returns {Object|null}
 */
function getWorkspace(db, workspaceId) {
  return db.prepare('SELECT * FROM workspaces WHERE team_id = ?').get(workspaceId) || null;
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
  `).run(teamId, teamName || teamId, botToken, installedBy, new Date().toISOString(), locale, timezone, errorChannel, nextcloudUrl);
}
```

Also remove `migrateFromFlatFiles` entirely from `src/db.js` (both the function body and the export). Remove the now-unused imports at the top of the file (`readdirSync`, `readFileSync`, `unlinkSync`, `path`).

Update `module.exports`:
```js
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
  upsertWorkspace
};
```

- [ ] **Step 4: Run all db tests**

```bash
node --test test/db.test.js 2>&1 | tail -5
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/db.js test/db.test.js
git commit -m "feat: add workspace helpers to db.js, remove migrateFromFlatFiles

refs: #44"
```

---

### Task 4: cache.js — add workspaceId

**Files:**
- Modify: `src/cache.js`
- Modify: `test/cache.test.js`

- [ ] **Step 1: Update cache.test.js to pass workspaceId**

In every call to `loadCacheState` and `saveCacheState`, add `'T_TEST'` as the second argument:

```js
// Before:
saveCacheState(db, 'cal-1', events, null, null);
const result = loadCacheState(db, 'cal-1');

// After:
saveCacheState(db, 'T_TEST', 'cal-1', events, null, null);
const result = loadCacheState(db, 'T_TEST', 'cal-1');
```

Apply to all tests in `test/cache.test.js`.

- [ ] **Step 2: Run to confirm tests fail**

```bash
node --test test/cache.test.js 2>&1 | grep -c 'not ok'
```

Expected: several failures.

- [ ] **Step 3: Update `src/cache.js`**

```js
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
```

- [ ] **Step 4: Run cache tests**

```bash
node --test test/cache.test.js 2>&1 | tail -5
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/cache.js test/cache.test.js
git commit -m "feat: add workspaceId to cache.js

refs: #44"
```

---

### Task 5: diff.js — add workspaceId to pending wrappers

**Files:**
- Modify: `src/diff.js`
- Check: `test/diff.test.js` (may not test pending functions directly)

- [ ] **Step 1: Check diff.test.js for loadPendingNotifications / savePendingNotifications usage**

```bash
grep -n 'loadPending\|savePending' test/diff.test.js
```

If no matches, the pending wrappers are tested indirectly via runner. Skip to Step 3.

- [ ] **Step 2: If found, update those calls to add `'T_TEST'` as workspaceId**

(Same pattern as Tasks 2 and 4.)

- [ ] **Step 3: Update `src/diff.js` pending wrapper functions**

Find `loadPendingNotifications` and `savePendingNotifications` in `src/diff.js` and add `workspaceId`:

```js
const { loadPending, savePending } = require('./db.js');

/**
 * Load pending notifications for a channel.
 * @param {import('better-sqlite3').Database} db
 * @param {string} workspaceId
 * @param {string} channelId
 * @returns {{expired: boolean, diffs: Array}}
 */
function loadPendingNotifications(db, workspaceId, channelId) {
  return loadPending(db, workspaceId, channelId);
}

/**
 * Save pending notifications for a channel.
 * @param {import('better-sqlite3').Database} db
 * @param {string} workspaceId
 * @param {string} channelId
 * @param {Array} diffs
 */
function savePendingNotifications(db, workspaceId, channelId, diffs) {
  savePending(db, workspaceId, channelId, diffs);
}
```

Keep all other functions in `diff.js` (`diffEvents`, `getEventKey`, etc.) unchanged.

- [ ] **Step 4: Run diff tests**

```bash
node --test test/diff.test.js 2>&1 | tail -5
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/diff.js
git commit -m "feat: add workspaceId to diff.js pending wrappers

refs: #44"
```

---

### Task 6: config.js — loadConfigFromDb + seedWorkspace

**Files:**
- Modify: `src/config.js`
- Create: `test/config-db.test.js`

- [ ] **Step 1: Write `test/config-db.test.js`**

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db.js');
const { loadConfigFromDb, seedWorkspace, validateConfig } = require('../src/config.js');

const FIXTURE_CONFIG = {
  workspace_id: 'T_TEST',
  locale: 'en-US',
  timezone: 'Europe/Berlin',
  error_channel: 'C_ERR',
  caldav_credentials: { username: 'admin', password: 'secret' },
  calendars: {
    'team': { name: 'Team', caldav_url: 'https://nc.example.com/cal/team', caldav_metadata_url: 'https://nc.example.com/dav/team', color: '#2D73BE' },
    'vorstand': { name: 'Vorstand', caldav_url: 'https://nc.example.com/cal/vorstand', color: '#B6469D' }
  },
  channels: [
    {
      id: 'C_CH1', name: '#test', canvas_id: 'F_CV1', canvas_url: 'https://slack.com/cv/F_CV1',
      calendars: ['team', 'vorstand'], locale: 'de-DE',
      digest_schedule: 'sunday 18:00', daily_digest_schedule: 'weekdays 08:00',
      show_empty_days: false, notifications: 'all',
      view: 'merged', event_detail: 'standard', digest_style: 'full', digest_format: 'week_view'
    },
    {
      id: 'C_CH2', name: '#second', canvas_id: 'F_CV2',
      calendars: ['team'],
      digest_schedule: 'sunday 18:00', daily_digest_schedule: false,
      show_empty_days: false, notifications: 'all'
    }
  ]
};

function memDb() {
  return openDb(':memory:');
}

test('seedWorkspace inserts all config data into the database', () => {
  const db = memDb();
  seedWorkspace(db, 'T_TEST', FIXTURE_CONFIG);

  const ws = db.prepare('SELECT * FROM workspaces WHERE team_id = ?').get('T_TEST');
  assert.ok(ws);
  assert.strictEqual(ws.locale, 'en-US');
  assert.strictEqual(ws.timezone, 'Europe/Berlin');
  assert.strictEqual(ws.error_channel, 'C_ERR');

  const creds = db.prepare('SELECT * FROM caldav_credentials WHERE workspace_id = ?').get('T_TEST');
  assert.strictEqual(creds.username, 'admin');
  assert.strictEqual(creds.password, 'secret');

  const cals = db.prepare('SELECT * FROM calendars WHERE workspace_id = ? ORDER BY calendar_id').all('T_TEST');
  assert.strictEqual(cals.length, 2);
  assert.strictEqual(cals[0].calendar_id, 'team');
  assert.strictEqual(cals[1].calendar_id, 'vorstand');

  const channels = db.prepare('SELECT * FROM channels WHERE workspace_id = ?').all('T_TEST');
  assert.strictEqual(channels.length, 2);

  const ccRows = db.prepare('SELECT * FROM channel_calendars WHERE workspace_id = ? AND channel_id = ?').all('T_TEST', 'C_CH1');
  const ccCalIds = ccRows.map(r => r.calendar_id).sort();
  assert.deepStrictEqual(ccCalIds, ['team', 'vorstand']);

  db.close();
});

test('seedWorkspace is idempotent', () => {
  const db = memDb();
  seedWorkspace(db, 'T_TEST', FIXTURE_CONFIG);
  seedWorkspace(db, 'T_TEST', FIXTURE_CONFIG);  // second call must not throw or duplicate
  const cals = db.prepare('SELECT * FROM calendars WHERE workspace_id = ?').all('T_TEST');
  assert.strictEqual(cals.length, 2);
  db.close();
});

test('loadConfigFromDb returns same shape as loadConfig', () => {
  const db = memDb();
  seedWorkspace(db, 'T_TEST', FIXTURE_CONFIG);
  const config = loadConfigFromDb(db, 'T_TEST');

  assert.strictEqual(config.workspace_id, 'T_TEST');
  assert.strictEqual(config.locale, 'en-US');
  assert.strictEqual(config.timezone, 'Europe/Berlin');
  assert.strictEqual(config.error_channel, 'C_ERR');
  assert.strictEqual(config.caldav_credentials.username, 'admin');
  assert.strictEqual(config.caldav_credentials.password, 'secret');
  assert.ok(config.calendars['team']);
  assert.strictEqual(config.calendars['team'].name, 'Team');
  assert.ok(config.calendars['vorstand']);
  assert.strictEqual(Array.isArray(config.channels), true);
  assert.strictEqual(config.channels.length, 2);

  const ch1 = config.channels.find(c => c.id === 'C_CH1');
  assert.ok(ch1);
  assert.deepStrictEqual(ch1.calendars.sort(), ['team', 'vorstand']);
  assert.strictEqual(ch1.digest_schedule, 'sunday 18:00');
  assert.strictEqual(ch1.show_empty_days, false);

  const ch2 = config.channels.find(c => c.id === 'C_CH2');
  assert.strictEqual(ch2.daily_digest_schedule, false);

  db.close();
});

test('loadConfigFromDb throws for unknown workspaceId', () => {
  const db = memDb();
  assert.throws(
    () => loadConfigFromDb(db, 'T_MISSING'),
    /Workspace not found: T_MISSING/
  );
  db.close();
});

test('loadConfigFromDb output passes validateConfig', () => {
  const db = memDb();
  seedWorkspace(db, 'T_TEST', FIXTURE_CONFIG);
  const config = loadConfigFromDb(db, 'T_TEST');
  assert.doesNotThrow(() => validateConfig(config));
  db.close();
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
node --test test/config-db.test.js 2>&1 | head -10
```

Expected: TypeError — `loadConfigFromDb` is not a function.

- [ ] **Step 3: Add `loadConfigFromDb` and `seedWorkspace` to `src/config.js`**

Add these imports at the top of `src/config.js`:

```js
const { getWorkspace, upsertWorkspace } = require('./db.js');
```

Add the two new functions at the end of `src/config.js`, before `module.exports`:

```js
/**
 * Load workspace config from SQLite, returning same shape as loadConfig().
 * Throws if workspace is not found.
 * @param {import('better-sqlite3').Database} db
 * @param {string} workspaceId
 * @returns {Object}
 */
function loadConfigFromDb(db, workspaceId) {
  const workspace = getWorkspace(db, workspaceId);
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);

  const creds = db.prepare('SELECT username, password FROM caldav_credentials WHERE workspace_id = ?').get(workspaceId);
  if (!creds) throw new Error(`No CalDAV credentials for workspace: ${workspaceId}`);

  const calRows = db.prepare('SELECT * FROM calendars WHERE workspace_id = ?').all(workspaceId);
  const calendars = {};
  for (const row of calRows) {
    calendars[row.calendar_id] = {
      name: row.name,
      caldav_url: row.caldav_url,
      ...(row.caldav_metadata_url ? { caldav_metadata_url: row.caldav_metadata_url } : {}),
      ...(row.color ? { color: row.color } : {})
    };
  }

  const channelRows = db.prepare('SELECT * FROM channels WHERE workspace_id = ?').all(workspaceId);
  const channels = [];
  for (const row of channelRows) {
    const calendarIds = db.prepare('SELECT calendar_id FROM channel_calendars WHERE workspace_id = ? AND channel_id = ?')
      .all(workspaceId, row.channel_id)
      .map(r => r.calendar_id);

    channels.push({
      id: row.channel_id,
      ...(row.name ? { name: row.name } : {}),
      canvas_id: row.canvas_id,
      ...(row.canvas_url ? { canvas_url: row.canvas_url } : {}),
      ...(row.locale ? { locale: row.locale } : {}),
      ...(row.view ? { view: row.view } : {}),
      ...(row.event_detail ? { event_detail: row.event_detail } : {}),
      ...(row.digest_style ? { digest_style: row.digest_style } : {}),
      ...(row.digest_format ? { digest_format: row.digest_format } : {}),
      digest_schedule: row.digest_schedule || false,
      daily_digest_schedule: row.daily_digest_schedule || false,
      show_empty_days: row.show_empty_days !== null ? Boolean(row.show_empty_days) : false,
      ...(row.notifications ? { notifications: row.notifications } : {}),
      calendars: calendarIds
    });
  }

  return {
    workspace_id: workspace.team_id,
    locale: workspace.locale,
    ...(workspace.timezone ? { timezone: workspace.timezone } : {}),
    ...(workspace.error_channel ? { error_channel: workspace.error_channel } : {}),
    ...(workspace.nextcloud_url ? { nextcloud_url: workspace.nextcloud_url } : {}),
    caldav_credentials: { username: creds.username, password: creds.password },
    calendars,
    channels
  };
}

/**
 * Import a parsed config.json object into the new multi-tenant tables. Idempotent.
 * Call with the output of loadConfig() so env vars are already resolved.
 * @param {import('better-sqlite3').Database} db
 * @param {string} workspaceId
 * @param {Object} configJson
 */
function seedWorkspace(db, workspaceId, configJson) {
  upsertWorkspace(db, {
    teamId: workspaceId,
    teamName: workspaceId,
    locale: configJson.locale,
    timezone: configJson.timezone || null,
    errorChannel: configJson.error_channel || null,
    nextcloudUrl: configJson.nextcloud_url || null
  });

  db.prepare(`
    INSERT INTO caldav_credentials (workspace_id, username, password)
    VALUES (?, ?, ?)
    ON CONFLICT(workspace_id) DO UPDATE SET
      username = excluded.username,
      password = excluded.password
  `).run(workspaceId, configJson.caldav_credentials.username, configJson.caldav_credentials.password);

  for (const [calId, cal] of Object.entries(configJson.calendars)) {
    db.prepare(`
      INSERT INTO calendars (workspace_id, calendar_id, name, caldav_url, caldav_metadata_url, color)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, calendar_id) DO UPDATE SET
        name = excluded.name,
        caldav_url = excluded.caldav_url,
        caldav_metadata_url = excluded.caldav_metadata_url,
        color = excluded.color
    `).run(workspaceId, calId, cal.name, cal.caldav_url, cal.caldav_metadata_url || null, cal.color || null);
  }

  for (const channel of configJson.channels) {
    db.prepare(`
      INSERT INTO channels (workspace_id, channel_id, name, canvas_id, canvas_url, locale, view, event_detail, digest_style, digest_format, digest_schedule, daily_digest_schedule, show_empty_days, notifications)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, channel_id) DO UPDATE SET
        name = excluded.name,
        canvas_id = excluded.canvas_id,
        canvas_url = excluded.canvas_url,
        locale = excluded.locale,
        view = excluded.view,
        event_detail = excluded.event_detail,
        digest_style = excluded.digest_style,
        digest_format = excluded.digest_format,
        digest_schedule = excluded.digest_schedule,
        daily_digest_schedule = excluded.daily_digest_schedule,
        show_empty_days = excluded.show_empty_days,
        notifications = excluded.notifications
    `).run(
      workspaceId, channel.id,
      channel.name || null,
      channel.canvas_id || null,
      channel.canvas_url || null,
      channel.locale || null,
      channel.view || null,
      channel.event_detail || null,
      channel.digest_style || null,
      channel.digest_format || null,
      channel.digest_schedule || null,
      channel.daily_digest_schedule === false ? null : (channel.daily_digest_schedule || null),
      typeof channel.show_empty_days === 'boolean' ? (channel.show_empty_days ? 1 : 0) : null,
      channel.notifications || null
    );

    db.prepare('DELETE FROM channel_calendars WHERE workspace_id = ? AND channel_id = ?')
      .run(workspaceId, channel.id);

    for (const calId of channel.calendars) {
      db.prepare(`
        INSERT INTO channel_calendars (workspace_id, channel_id, calendar_id)
        VALUES (?, ?, ?)
        ON CONFLICT(workspace_id, channel_id, calendar_id) DO NOTHING
      `).run(workspaceId, channel.id, calId);
    }
  }
}
```

Update `module.exports` in `src/config.js`:
```js
module.exports = {
  loadConfig,
  validateConfig,
  loadConfigFromDb,
  seedWorkspace
};
```

- [ ] **Step 4: Run config-db tests**

```bash
node --test test/config-db.test.js 2>&1 | tail -8
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/config.js test/config-db.test.js
git commit -m "feat: add loadConfigFromDb and seedWorkspace to config.js

refs: #44"
```

---

### Task 7: server.js + bot.js — switch to loadConfigFromDb

**Files:**
- Modify: `src/server.js`
- Modify: `src/bot.js`

- [ ] **Step 1: Update `src/server.js`**

Change the import and startup logic:

```js
// At the top, change:
const { loadConfig } = require('./config.js');
// to:
const { loadConfigFromDb } = require('./config.js');
```

In the `start()` function, replace:

```js
// Before:
const config = await loadConfig(process.env.CONFIG_FILE);
const dataDir = process.env.DATA_DIR;
if (!dataDir) throw new Error('DATA_DIR environment variable not set');
const dbPath = path.join(dataDir, 'bot.db');
const db = openDb(dbPath);
const legacyDir = process.env.CACHE_DIR;
if (legacyDir) migrateFromFlatFiles(db, legacyDir);

// After:
const dataDir = process.env.DATA_DIR;
if (!dataDir) throw new Error('DATA_DIR environment variable not set');
const workspaceId = process.env.WORKSPACE_ID;
if (!workspaceId) throw new Error('WORKSPACE_ID environment variable not set');
const dbPath = path.join(dataDir, 'bot.db');
const db = openDb(dbPath);
const config = loadConfigFromDb(db, workspaceId);
```

Also remove `{ migrateFromFlatFiles }` from the `openDb` import since it no longer exists:
```js
const { openDb } = require('./db.js');
```

- [ ] **Step 2: Update `src/bot.js`**

Change the import:
```js
// Before:
const { loadConfig } = require('./config.js');
const { openDb, migrateFromFlatFiles } = require('./db.js');

// After:
const { loadConfigFromDb } = require('./config.js');
const { openDb } = require('./db.js');
```

In `main()`, replace:
```js
// Before:
const config = await loadConfig();
const dataDir = process.env.DATA_DIR;
if (!dataDir) throw new Error('DATA_DIR environment variable not set');
const dbPath = path.join(dataDir, 'bot.db');
const db = openDb(dbPath);
const legacyDir = process.env.CACHE_DIR;
if (legacyDir) migrateFromFlatFiles(db, legacyDir);

// After:
const dataDir = process.env.DATA_DIR;
if (!dataDir) throw new Error('DATA_DIR environment variable not set');
const workspaceId = process.env.WORKSPACE_ID;
if (!workspaceId) throw new Error('WORKSPACE_ID environment variable not set');
const dbPath = path.join(dataDir, 'bot.db');
const db = openDb(dbPath);
const config = loadConfigFromDb(db, workspaceId);
```

- [ ] **Step 3: Run server and bot tests**

```bash
node --test test/server.test.js test/bot.test.js 2>&1 | tail -10
```

Expected: all pass. (These tests mock config loading, so they may need minor fixture updates — check output and fix any import errors.)

- [ ] **Step 4: Commit**

```bash
git add src/server.js src/bot.js
git commit -m "feat: use loadConfigFromDb in server.js and bot.js

refs: #44"
```

---

### Task 8: runner.js — thread workspaceId through all db calls

**Files:**
- Modify: `src/runner.js`
- Check: `test/runner.test.js`

- [ ] **Step 1: Identify all db/cache/diff call sites in runner.js**

```bash
grep -n 'loadCacheState\|saveCacheState\|loadRunState\|saveRunState\|loadPendingNotifications\|savePendingNotifications' src/runner.js
```

Expected output (line numbers will vary):
- `loadCacheState(db, calId)` — in `buildCacheMap`, `runChangeDetection`, `routeDiffsToChannels`, etc.
- `saveCacheState(db, calId, ...)` — multiple locations
- `loadRunState(db, channel.id, ...)` — in `runScheduledDigests`
- `saveRunState(db, channel.id, ...)` — in `runScheduledDigests`
- `loadPendingNotifications(db, channel.id)` — in `routeDiffsToChannels`
- `savePendingNotifications(db, channel.id, diffs)` — in `routeDiffsToChannels`

- [ ] **Step 2: Update `buildCacheMap` — add workspaceId parameter**

```js
// Before:
async function buildCacheMap(config, db) {
  const cacheMap = new Map();
  for (const calendarId of Object.keys(config.calendars)) {
    try {
      const cached = loadCacheState(db, calendarId);

// After:
async function buildCacheMap(config, db) {
  const cacheMap = new Map();
  for (const calendarId of Object.keys(config.calendars)) {
    try {
      const cached = loadCacheState(db, config.workspace_id, calendarId);
```

- [ ] **Step 3: Update all remaining call sites in runner.js**

Apply the following replacements throughout the file:

| Old | New |
|-----|-----|
| `loadCacheState(db, calId)` | `loadCacheState(db, config.workspace_id, calId)` |
| `saveCacheState(db, calId, ...)` | `saveCacheState(db, config.workspace_id, calId, ...)` |
| `loadCacheState(db, calId)` in `runEventChanged` and `runFullRefresh` | `loadCacheState(db, config.workspace_id, calId)` |
| `saveCacheState(db, calId, ...)` in all callers | add `config.workspace_id` as 2nd arg |
| `loadRunState(db, channel.id, type)` | `loadRunState(db, config.workspace_id, channel.id, type)` |
| `saveRunState(db, channel.id, type, now)` | `saveRunState(db, config.workspace_id, channel.id, type, now)` |
| `loadPendingNotifications(db, channel.id)` | `loadPendingNotifications(db, config.workspace_id, channel.id)` |
| `savePendingNotifications(db, channel.id, diffs)` | `savePendingNotifications(db, config.workspace_id, channel.id, diffs)` |

Note: in `bundleAndPostChangeDetections`, `config` is passed as a parameter — `config.workspace_id` is available there.

- [ ] **Step 4: Run runner tests**

```bash
node --test test/runner.test.js 2>&1 | tail -10
```

If tests fail due to fixture config missing `workspace_id`, open `test/runner.test.js` and add `workspace_id: 'T_TEST'` to the config fixture objects.

- [ ] **Step 5: Run full test suite**

```bash
npm test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/runner.js
git commit -m "feat: thread workspaceId through all runner.js db calls

refs: #44"
```

---

### Task 9: Final verification

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: all tests pass, no failures.

- [ ] **Step 2: Verify schema version**

```bash
node -e "
const { openDb } = require('./src/db.js');
const db = openDb(':memory:');
console.log('user_version:', db.pragma('user_version', { simple: true }));
const tables = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name\").all().map(r => r.name);
console.log('tables:', tables);
db.close();
"
```

Expected:
```
user_version: 1
tables: [ 'caldav_credentials', 'calendars', 'channel_calendars', 'channels', 'color_cache', 'events', 'pending_notifications', 'run_state', 'workspaces' ]
```

- [ ] **Step 3: Verify seedWorkspace + loadConfigFromDb round-trip with real config.json**

```bash
node -e "
const { openDb } = require('./src/db.js');
const { loadConfig, loadConfigFromDb, seedWorkspace } = require('./src/config.js');
async function run() {
  const raw = await loadConfig('./config.json');
  const db = openDb(':memory:');
  seedWorkspace(db, raw.workspace_id, raw);
  const config = loadConfigFromDb(db, raw.workspace_id);
  console.log('workspace_id:', config.workspace_id);
  console.log('calendars:', Object.keys(config.calendars));
  console.log('channels:', config.channels.length);
  console.log('locale:', config.locale);
  db.close();
}
run().catch(console.error);
"
```

Expected output:
```
workspace_id: T31PV0E2E
calendars: [ 'team', 'vorstand', 'termine' ]
channels: 4
locale: en-US
```

- [ ] **Step 4: Update issue #44 status on project board to In Progress**

```bash
gh project item-edit \
  --id PVTI_lADOAlSEx84BVFvGzgtKirk \
  --project-id PVT_kwDOAlSEx84BVFvG \
  --field-id PVTSSF_lADOAlSEx84BVFvGzhQj4bA \
  --single-select-option-id 47fc9ee4
```

- [ ] **Step 5: Final commit if any loose files**

```bash
git status
# Stage and commit any remaining changes
```
