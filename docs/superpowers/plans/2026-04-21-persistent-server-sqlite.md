# Persistent Server + SQLite State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the GitHub Actions cron scheduler and flat-file state with a persistent Node.js server (`server.js`) using `node-cron` for scheduling and `better-sqlite3` for durable state storage.

**Architecture:** `db.js` owns all SQL and exposes typed read/write helpers per table. `cache.js` and `diff.js` are rewritten to call `db.js` (same exported function names, `db` replaces `cacheDir` parameter). `runner.js` is extracted from `bot.js` containing all business logic; both the CLI shim (`bot.js`) and the persistent server (`server.js`) import from `runner.js`.

**Tech Stack:** Node.js ≥20, `better-sqlite3` (sync SQLite), `node-cron` (cron scheduler), built-in `node:test` + `node:assert` for tests.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/db.js` | Create | SQLite open/schema/migrate + all typed table accessors |
| `src/cache.js` | Rewrite | `loadCacheState`/`saveCacheState` backed by `db.js` |
| `src/diff.js` | Modify | Remove deprecated `@actions/cache` functions, rewrite pending notifications via `db.js` |
| `src/runner.js` | Create | All business logic extracted from `bot.js` |
| `src/bot.js` | Slim down | Thin CLI shim: parse args → open db → call runner → exit |
| `src/server.js` | Create | Boot: load config, open db, register node-cron jobs, graceful shutdown |
| `test/db.test.js` | Create | All `db.js` functions tested with `:memory:` SQLite |
| `test/cache.test.js` | Rewrite | Tests updated to use `:memory:` db instead of temp dirs |
| `test/runner.test.js` | Create | `loadRunState`/`saveRunState` tests migrated from `bot.test.js` |
| `test/bot.test.js` | Modify | Remove `loadLastRunTime`/`saveLastRunTime` tests (moved to runner.test.js) |

---

## Task 1: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install packages**

```bash
npm install better-sqlite3 node-cron
```

Expected output includes `added X packages`.

- [ ] **Step 2: Verify installation**

```bash
node -e "require('better-sqlite3'); require('node-cron'); console.log('ok')"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add better-sqlite3 and node-cron dependencies

refs: #23"
```

---

## Task 2: Create `src/db.js` — SQLite wrapper with schema and typed accessors

**Files:**
- Create: `src/db.js`
- Create: `test/db.test.js`

The DB file lives at `{DATA_DIR}/{workspaceId}.db`. For single-tenant use, callers pass `'bot'` as `workspaceId`. Tests pass `':memory:'` as `dbPath` directly via `openDb`.

### SQLite schema

```sql
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
```

- [ ] **Step 1: Write the failing test**

Create `test/db.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { openDb, loadEvents, saveEvents, loadColor, saveColor, loadRunState, saveRunState, loadPending, savePending } = require('../src/db.js');

function memDb() {
  return openDb(':memory:');
}

test('openDb creates schema tables', () => {
  const db = memDb();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  assert.ok(tables.includes('events'));
  assert.ok(tables.includes('color_cache'));
  assert.ok(tables.includes('run_state'));
  assert.ok(tables.includes('pending_notifications'));
  db.close();
});

test('saveEvents and loadEvents round-trip', () => {
  const db = memDb();
  const events = [
    { id: 'e1', title: 'Standup', instances: [{ start: new Date('2026-04-21T09:00:00Z'), end: new Date('2026-04-21T09:30:00Z'), isException: false }] }
  ];
  saveEvents(db, 'cal-1', events, null);
  const result = loadEvents(db, 'cal-1');
  assert.strictEqual(result.events.length, 1);
  assert.strictEqual(result.events[0].id, 'e1');
  assert.ok(result.events[0].instances[0].start instanceof Date);
  assert.strictEqual(result.events[0].instances[0].start.toISOString(), '2026-04-21T09:00:00.000Z');
  assert.ok(result.updated_at);
  assert.strictEqual(result.last_error, undefined);
  db.close();
});

test('loadEvents returns null for unknown calendarId', () => {
  const db = memDb();
  const result = loadEvents(db, 'nonexistent');
  assert.strictEqual(result, null);
  db.close();
});

test('saveEvents persists error state', () => {
  const db = memDb();
  saveEvents(db, 'cal-err', [], { last_error: 'timeout', error_notified_at: '2026-04-21T10:00:00Z' });
  const result = loadEvents(db, 'cal-err');
  assert.strictEqual(result.last_error, 'timeout');
  assert.strictEqual(result.error_notified_at, '2026-04-21T10:00:00Z');
  db.close();
});

test('saveColor and loadColor round-trip', () => {
  const db = memDb();
  const color = { hex: '#ff0000', emoji: ':red_circle:', source: 'caldav' };
  saveColor(db, 'cal-1', color);
  const result = loadColor(db, 'cal-1');
  assert.deepStrictEqual(result, color);
  db.close();
});

test('loadColor returns null for unknown calendarId', () => {
  const db = memDb();
  assert.strictEqual(loadColor(db, 'nonexistent'), null);
  db.close();
});

test('saveRunState and loadRunState round-trip', () => {
  const db = memDb();
  const ts = new Date('2026-04-21T08:00:00Z');
  saveRunState(db, 'C123', 'daily', ts);
  const result = loadRunState(db, 'C123', 'daily');
  assert.ok(result instanceof Date);
  assert.strictEqual(result.toISOString(), ts.toISOString());
  db.close();
});

test('loadRunState returns null for unknown channel', () => {
  const db = memDb();
  assert.strictEqual(loadRunState(db, 'C999', 'daily'), null);
  db.close();
});

test('savePending and loadPending round-trip within 5 min window', () => {
  const db = memDb();
  const diffs = [{ type: 'new', event: { id: 'e1' } }];
  savePending(db, 'C123', diffs, new Date());
  const result = loadPending(db, 'C123');
  assert.strictEqual(result.expired, false);
  assert.strictEqual(result.diffs.length, 1);
  assert.strictEqual(result.diffs[0].type, 'new');
  db.close();
});

test('loadPending returns expired=true when timestamp older than 5 min', () => {
  const db = memDb();
  const oldTs = new Date(Date.now() - 6 * 60 * 1000);
  savePending(db, 'C123', [{ type: 'new', event: { id: 'e1' } }], oldTs);
  const result = loadPending(db, 'C123');
  assert.strictEqual(result.expired, true);
  assert.strictEqual(result.diffs.length, 1);
  db.close();
});

test('loadPending returns empty diffs for unknown channel', () => {
  const db = memDb();
  const result = loadPending(db, 'C999');
  assert.strictEqual(result.expired, false);
  assert.deepStrictEqual(result.diffs, []);
  db.close();
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
NODE_ENV=test node --test test/db.test.js
```

Expected: `Error: Cannot find module '../src/db.js'`

- [ ] **Step 3: Implement `src/db.js`**

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
    instances: e.instances.map(inst => ({
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
  const { readdirSync, readFileSync, unlinkSync } = require('node:fs');
  const path = require('node:path');

  let files;
  try {
    files = readdirSync(legacyDir);
  } catch {
    return; // Directory doesn't exist — nothing to migrate
  }

  for (const filename of files) {
    const filePath = path.join(legacyDir, filename);

    // Run state: .lastrun-{channelId}-{type}.json
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

    // Events/color cache: {calendarId}.json
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
NODE_ENV=test node --test test/db.test.js
```

Expected: all 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/db.js test/db.test.js
git commit -m "feat: add SQLite db module with schema and typed accessors

refs: #23"
```

---

## Task 3: Rewrite `src/cache.js` with SQLite backend

**Files:**
- Modify: `src/cache.js`
- Modify: `test/cache.test.js`

`loadCacheState(db, calendarId)` and `saveCacheState(db, calendarId, events, errorState, color)` replace the file-based versions. The `db` parameter replaces `cacheDir`.

- [ ] **Step 1: Write the failing tests**

Replace `test/cache.test.js` entirely:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db.js');
const { loadCacheState, saveCacheState } = require('../src/cache.js');

function memDb() {
  return openDb(':memory:');
}

test('loadCacheState returns null for unknown calendar', () => {
  const db = memDb();
  assert.strictEqual(loadCacheState(db, 'nonexistent'), null);
  db.close();
});

test('saveCacheState and loadCacheState round-trip with composite events', () => {
  const db = memDb();
  const events = [
    {
      id: 'e1',
      title: 'Meeting',
      location: null,
      description: null,
      isAllDay: false,
      rrule: null,
      instances: [
        { start: new Date('2026-04-21T10:00:00Z'), end: new Date('2026-04-21T11:00:00Z'), isException: false }
      ],
      calendarName: 'Team'
    }
  ];

  saveCacheState(db, 'cal-1', events, null, null);
  const result = loadCacheState(db, 'cal-1');

  assert.strictEqual(result.events.length, 1);
  assert.strictEqual(result.events[0].id, 'e1');
  assert.ok(Array.isArray(result.events[0].instances));
  assert.ok(result.events[0].instances[0].start instanceof Date);
  assert.strictEqual(result.events[0].instances[0].start.toISOString(), '2026-04-21T10:00:00.000Z');
  assert.ok(result.updated_at);
  assert.ok(!result.last_error);
  db.close();
});

test('saveCacheState persists error metadata', () => {
  const db = memDb();
  const errorState = { last_error: 'CalDAV timeout', error_notified_at: '2026-04-21T10:00:00Z' };

  saveCacheState(db, 'cal-err', [], errorState, null);
  const result = loadCacheState(db, 'cal-err');

  assert.strictEqual(result.last_error, 'CalDAV timeout');
  assert.strictEqual(result.error_notified_at, '2026-04-21T10:00:00Z');
  db.close();
});

test('saveCacheState persists color, loadCacheState includes it', () => {
  const db = memDb();
  const color = { hex: '#3498db', emoji: ':blue_circle:', source: 'caldav' };

  saveCacheState(db, 'cal-color', [], null, color);
  const result = loadCacheState(db, 'cal-color');

  assert.deepStrictEqual(result.color, color);
  db.close();
});

test('loadCacheState returns null color when none saved', () => {
  const db = memDb();
  saveCacheState(db, 'cal-nocolor', [], null, null);
  const result = loadCacheState(db, 'cal-nocolor');
  assert.strictEqual(result.color, null);
  db.close();
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
NODE_ENV=test node --test test/cache.test.js
```

Expected: fails because `loadCacheState` signature mismatch (takes `cacheDir` currently).

- [ ] **Step 3: Rewrite `src/cache.js`**

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
NODE_ENV=test node --test test/cache.test.js
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/cache.js test/cache.test.js
git commit -m "feat: rewrite cache.js with SQLite backend via db.js

refs: #23"
```

---

## Task 4: Rewrite pending notifications in `src/diff.js`

**Files:**
- Modify: `src/diff.js`
- Modify: `test/diff.test.js`

Remove deprecated `loadCachedEvents`/`saveCachedEvents` (they used `@actions/cache`). Rewrite `loadPendingNotifications`/`savePendingNotifications` to use `db.js`. Keep `diffEvents`, `normalizeRRule`, `detectChanges` unchanged.

- [ ] **Step 1: Add pending notification tests to `test/diff.test.js`**

Append to the end of `test/diff.test.js`:

```js
const { openDb } = require('../src/db.js');
const { loadPendingNotifications, savePendingNotifications } = require('../src/diff.js');

test('savePendingNotifications and loadPendingNotifications round-trip within window', () => {
  const db = openDb(':memory:');
  const diffs = [{ type: 'new', event: { id: 'e1', title: 'New' } }];
  savePendingNotifications(db, 'C123', diffs);
  const result = loadPendingNotifications(db, 'C123');
  assert.strictEqual(result.expired, false);
  assert.strictEqual(result.diffs.length, 1);
  assert.strictEqual(result.diffs[0].type, 'new');
  db.close();
});

test('loadPendingNotifications returns empty for unknown channel', () => {
  const db = openDb(':memory:');
  const result = loadPendingNotifications(db, 'C999');
  assert.strictEqual(result.expired, false);
  assert.deepStrictEqual(result.diffs, []);
  db.close();
});
```

- [ ] **Step 2: Run to verify new tests fail**

```bash
NODE_ENV=test node --test test/diff.test.js
```

Expected: `TypeError: loadPendingNotifications is not a function` or signature mismatch.

- [ ] **Step 3: Rewrite the affected parts of `src/diff.js`**

Replace the four deprecated/old functions at the bottom with the new implementations. Keep everything above `loadCachedEvents` untouched.

Remove this block (lines ~184–316):
```js
async function loadCachedEvents(calendarId) { ... }
async function saveCachedEvents(calendarId, events) { ... }
async function loadPendingNotifications(channelId) { ... }
async function savePendingNotifications(channelId, diffs) { ... }
```

Replace with:

```js
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
```

Update the `module.exports` at the bottom to remove the deprecated functions:

```js
module.exports = {
  diffEvents,
  normalizeRRule,
  loadPendingNotifications,
  savePendingNotifications
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
NODE_ENV=test node --test test/diff.test.js
```

Expected: all existing tests + 2 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/diff.js test/diff.test.js
git commit -m "feat: replace @actions/cache in diff.js with SQLite-backed pending notifications

refs: #23"
```

---

## Task 5: Create `src/runner.js` — extract all business logic from `bot.js`

**Files:**
- Create: `src/runner.js`
- Create: `test/runner.test.js`

Extract every function from `bot.js` except `main()` and the CLI arg parsing. Functions become named exports taking `(config, db, dryRun)` instead of relying on `process.env.CACHE_DIR`. `loadLastRunTime`/`saveLastRunTime` are removed — replaced by `loadRunState`/`saveRunState` from `db.js`.

- [ ] **Step 1: Write failing tests for `runner.js`**

Create `test/runner.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { openDb, loadRunState, saveRunState } = require('../src/db.js');
const { getCurrentWeekRange, getChangeDetectionRange } = require('../src/runner.js');

test('getCurrentWeekRange: Monday returns current week Mon-Sun', () => {
  const mockNow = new Date('2026-04-20T12:00:00Z'); // Monday
  const range = getCurrentWeekRange(mockNow);
  assert.strictEqual(range.start.getUTCDay(), 1, 'Start should be Monday');
  assert.strictEqual(range.end.getUTCDay(), 0, 'End should be Sunday');
  assert.strictEqual(range.start.toISOString(), '2026-04-20T00:00:00.000Z');
  assert.strictEqual(range.end.toISOString(), '2026-04-26T23:59:59.999Z');
});

test('getCurrentWeekRange: Sunday returns upcoming week', () => {
  const mockNow = new Date('2026-04-19T12:00:00Z'); // Sunday
  const range = getCurrentWeekRange(mockNow);
  assert.strictEqual(range.start.getUTCDay(), 1, 'Start should be Monday');
  assert.strictEqual(range.start.toISOString(), '2026-04-20T00:00:00.000Z');
});

test('getChangeDetectionRange returns current week + 4 weeks lookahead', () => {
  const mockNow = new Date('2026-04-21T14:00:00Z'); // Tuesday
  const result = getChangeDetectionRange(mockNow);
  assert.strictEqual(result.start.toISOString(), '2026-04-20T00:00:00.000Z');
  assert.strictEqual(result.end.toISOString(), '2026-05-24T23:59:59.999Z');
});

test('saveRunState and loadRunState via db.js', () => {
  const db = openDb(':memory:');
  const ts = new Date('2026-04-21T08:00:00Z');
  saveRunState(db, 'C123', 'weekly', ts);
  const loaded = loadRunState(db, 'C123', 'weekly');
  assert.ok(loaded instanceof Date);
  assert.strictEqual(loaded.toISOString(), ts.toISOString());
  db.close();
});

test('loadRunState returns null for unknown channel', () => {
  const db = openDb(':memory:');
  assert.strictEqual(loadRunState(db, 'C999', 'daily'), null);
  db.close();
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
NODE_ENV=test node --test test/runner.test.js
```

Expected: `Cannot find module '../src/runner.js'`

- [ ] **Step 3: Create `src/runner.js`**

Copy the following from `bot.js`, updating all `CACHE_DIR`/`cacheDir` references to use `db`, and updating all `loadCacheState`/`saveCacheState` calls to pass `db` as first argument, and `loadPendingNotifications`/`savePendingNotifications` to pass `db`.

```js
const { fetchCalendar } = require('./caldav.js');
const { postMessage, updateCanvas, postErrorNotification } = require('./slack.js');
const { renderWeekView, renderDailyView, renderCanvasContent, renderBundledNotification, renderCalendarLegend, assignCalendarIndicators } = require('./formatting.js');
const { diffEvents, loadPendingNotifications, savePendingNotifications } = require('./diff.js');
const { scheduleMatchesCron, shouldNotifyNow, hasRunToday, hasRunThisWeek } = require('./scheduler.js');
const { loadCacheState, saveCacheState } = require('./cache.js');
const { loadRunState, saveRunState } = require('./db.js');

/**
 * Build cache map for color resolution — calendarId → full cache object
 * @param {Object} config
 * @param {import('better-sqlite3').Database} db
 * @returns {Map}
 */
async function buildCacheMap(config, db) {
  const cacheMap = new Map();
  for (const calendarId of Object.keys(config.calendars)) {
    try {
      const cached = loadCacheState(db, calendarId);
      if (cached) cacheMap.set(calendarId, cached);
    } catch (error) {
      console.warn(`Failed to load cache for calendar ${calendarId}:`, error.message);
    }
  }
  return cacheMap;
}

/**
 * Check if error notification should be posted (suppression logic)
 * @param {string} calendarId
 * @param {string} errorMessage
 * @param {Object|null} cachedData
 * @returns {boolean}
 */
function shouldPostErrorNotification(calendarId, errorMessage, cachedData) {
  if (!cachedData) return true;
  const { last_error: lastError, error_notified_at: lastNotified } = cachedData;
  if (!lastError) return true;
  if (lastError !== errorMessage) return true;
  if (lastNotified) {
    const hoursSince = (Date.now() - new Date(lastNotified).getTime()) / (1000 * 60 * 60);
    if (hoursSince >= 24) return true;
  }
  console.log(`Suppressing duplicate error notification for ${calendarId} (last notified: ${cachedData.error_notified_at})`);
  return false;
}

/**
 * Run change detection polling
 * @param {Object} config
 * @param {import('better-sqlite3').Database} db
 * @param {boolean} dryRun
 */
async function runChangeDetection(config, db, dryRun) {
  console.log('Running change detection...');
  const dateRange = getChangeDetectionRange();
  console.log(`Checking calendars for changes (${dateRange.start.toISOString()} to ${dateRange.end.toISOString()})`);
  const cacheMap = await buildCacheMap(config, db);
  const channelDiffsMap = new Map();

  for (const calId of Object.keys(config.calendars)) {
    const calendar = config.calendars[calId];
    console.log(`Processing calendar: ${calendar.name} (${calId})`);
    let cachedData = null;

    try {
      cachedData = loadCacheState(db, calId);
      const timezone = config.timezone || 'UTC';
      const currentEvents = await fetchCalendar(calendar.caldav_url, config.caldav_credentials, dateRange, timezone);

      if (!cachedData) {
        console.log(`No previous state for ${calId} - establishing baseline`);
        saveCacheState(db, calId, currentEvents, null, null);
        continue;
      }

      const previousEvents = cachedData.events || [];
      const diffs = diffEvents(previousEvents, currentEvents);

      if (diffs.length === 0) {
        console.log(`No changes detected for ${calId}`);
        saveCacheState(db, calId, currentEvents, null, null);
        continue;
      }

      console.log(`Detected ${diffs.length} change(s) for ${calId}`);
      const diffsWithCalendar = diffs.map(d => ({ ...d, calendarName: calendar.name }));

      for (const channel of config.channels) {
        if (!channel.calendars.includes(calId)) continue;
        const notifiableDiffs = diffsWithCalendar.filter(diff => shouldNotifyNow(diff, channel));
        if (notifiableDiffs.length === 0) {
          console.log(`Change detected for ${calId} but channel ${channel.id} has notifications filtered - skipping`);
          continue;
        }
        if (!channelDiffsMap.has(channel.id)) channelDiffsMap.set(channel.id, []);
        channelDiffsMap.get(channel.id).push({ calendarId: calId, calendarName: calendar.name, diffs: notifiableDiffs });
        console.log(`Collected ${notifiableDiffs.length} diff(s) for channel ${channel.id} from ${calendar.name}`);
      }

      saveCacheState(db, calId, currentEvents, null, null);

    } catch (error) {
      console.error(`Failed to fetch calendar '${calendar.name}' (${calId}): ${error.message}`);
      const shouldNotify = shouldPostErrorNotification(calId, error.message, cachedData);
      if (shouldNotify) {
        await postErrorNotification(config.error_channel, `Calendar fetch failed: ${calendar.name}\n\n${error.message}`, dryRun);
      }
      if (cachedData) {
        saveCacheState(db, calId, cachedData.events, {
          last_error: error.message,
          error_notified_at: shouldNotify ? new Date().toISOString() : cachedData.error_notified_at
        }, null);
      }
    }
  }

  await bundleAndPostChangeDetections(config, channelDiffsMap, cacheMap, db, dryRun);
  console.log('Change detection complete');
}

/**
 * Bundle and post consolidated change detection messages per channel
 * @param {Object} config
 * @param {Map} channelDiffsMap
 * @param {Map} cacheMap
 * @param {import('better-sqlite3').Database} db
 * @param {boolean} dryRun
 */
async function bundleAndPostChangeDetections(config, channelDiffsMap, cacheMap, db, dryRun) {
  for (const [channelId, calendarDiffsArray] of channelDiffsMap) {
    const channel = config.channels.find(ch => ch.id === channelId);
    if (!channel) { console.warn(`Channel ${channelId} not found in config, skipping`); continue; }

    const allDiffs = calendarDiffsArray.flatMap(cd => cd.diffs);
    const uniqueCalendars = new Set(calendarDiffsArray.map(cd => cd.calendarName));

    console.log(`Bundling ${allDiffs.length} diff(s) from ${uniqueCalendars.size} calendar(s) for channel ${channelId}`);

    const locale = channel.locale || config.locale;
    const timezone = channel.timezone || config.timezone || 'UTC';
    const { message: baseNotification, newColors } = await renderBundledNotification(allDiffs, locale, timezone, { config, cacheMap });

    const dummyEvents = Array.from(uniqueCalendars).map(name => ({ calendarName: name }));
    const { indicatorMap } = await assignCalendarIndicators(dummyEvents, config, cacheMap);

    let finalMessage = baseNotification;
    if (uniqueCalendars.size === 1) {
      const calendarName = Array.from(uniqueCalendars)[0];
      const indicator = indicatorMap.get(calendarName) || '';
      if (allDiffs.length === 1) {
        finalMessage = baseNotification.trim() + ` · ${calendarName} ${indicator}`;
      } else {
        const changeCount = allDiffs.length;
        const changesText = locale === 'de-DE' ? 'Änderungen' : 'changes';
        const newTitle = `*${changeCount} ${changesText} in ${calendarName} ${indicator}*`;
        finalMessage = baseNotification.replace(/^\*\d+ [^\*]+\*/, newTitle);
      }
    } else {
      const legend = renderCalendarLegend(Array.from(uniqueCalendars).sort(), indicatorMap);
      finalMessage = baseNotification.trim() + '\n\n' + legend;
    }

    console.log(`Posting consolidated message to channel ${channelId} (${uniqueCalendars.size} calendar(s), ${allDiffs.length} diff(s))`);
    await postMessage(channelId, finalMessage, dryRun, config.error_channel);

    if (newColors) {
      for (const [calId, colorCache] of newColors.entries()) {
        try {
          const cached = loadCacheState(db, calId);
          if (cached) saveCacheState(db, calId, cached.events, null, colorCache);
        } catch (error) {
          console.warn(`Failed to persist color for calendar ${calId}:`, error.message);
        }
      }
    }
  }
}

/**
 * Run scheduled digest checks for all channels
 * @param {Object} config
 * @param {import('better-sqlite3').Database} db
 * @param {boolean} dryRun
 */
async function runScheduledDigests(config, db, dryRun) {
  const now = new Date();
  const firedCron = process.env.SCHEDULED_CRON;
  if (!firedCron) console.warn('SCHEDULED_CRON env var not set — running all pending digests');

  for (const channel of config.channels) {
    if (channel.digest_schedule) {
      const matches = firedCron ? scheduleMatchesCron(channel.digest_schedule, firedCron, now) : true;
      if (matches) {
        console.log(`Weekly digest schedule match for channel ${channel.id}`);
        const lastRun = loadRunState(db, channel.id, 'weekly');
        if (hasRunThisWeek(lastRun)) {
          console.log(`Weekly digest already posted this week for channel ${channel.id}, skipping`);
        } else {
          await postDigestForChannel(config, channel, 'weekly', db, dryRun);
          if (!dryRun) saveRunState(db, channel.id, 'weekly', now);
        }
      }
    }

    if (channel.daily_digest_schedule) {
      const matches = firedCron ? scheduleMatchesCron(channel.daily_digest_schedule, firedCron, now) : true;
      if (matches) {
        console.log(`Daily digest schedule match for channel ${channel.id}`);
        const lastRun = loadRunState(db, channel.id, 'daily');
        if (hasRunToday(lastRun)) {
          console.log(`Daily digest already posted today for channel ${channel.id}, skipping`);
        } else {
          await postDigestForChannel(config, channel, 'daily', db, dryRun);
          if (!dryRun) saveRunState(db, channel.id, 'daily', now);
        }
      }
    }
  }
}

/**
 * Post digest for a specific channel
 * @param {Object} config
 * @param {Object} channel
 * @param {'daily'|'weekly'} type
 * @param {import('better-sqlite3').Database} db
 * @param {boolean} dryRun
 */
async function postDigestForChannel(config, channel, type, db, dryRun) {
  const timezone = channel.timezone || config.timezone || 'UTC';
  const allEvents = [];

  for (const calId of channel.calendars) {
    const calendar = config.calendars[calId];
    try {
      const events = await fetchCalendar(calendar.caldav_url, config.caldav_credentials, getCurrentWeekRange(), timezone);
      console.log(`Fetched ${events.length} events from calendar '${calendar.name}' (${calId})`);
      allEvents.push(...events.map(e => ({ ...e, calendarName: calendar.name })));
    } catch (error) {
      console.error(`Failed to fetch calendar '${calendar.name}' (${calId}): ${error.message}`);
    }
  }

  const locale = channel.locale || config.locale;
  const dateRange = type === 'daily' ? getDailyRange() : getCurrentWeekRange();

  if (type === 'daily') {
    const hasEvents = allEvents.some(event => {
      const instances = event.instances && event.instances.length > 0 ? event.instances : [event];
      return instances.some(inst => inst.start >= dateRange.start && inst.start <= dateRange.end);
    });
    if (!hasEvents) {
      console.log(`No events for today/tomorrow in channel ${channel.id}, skipping daily digest`);
      const cacheMap = await buildCacheMap(config, db);
      const canvasContent = await renderCanvasContent(allEvents, { locale, timezone, ...channel, config, cacheMap });
      await updateCanvas(channel.canvas_id, canvasContent, dryRun);
      return;
    }
  }

  const cacheMap = await buildCacheMap(config, db);
  const digest = type === 'daily'
    ? await renderDailyView(allEvents, dateRange, locale, { ...channel, timezone, config, cacheMap, canvas_url: channel.canvas_url })
    : await renderWeekView(allEvents, dateRange, locale, { ...channel, timezone, config, cacheMap, canvas_url: channel.canvas_url });
  await postMessage(channel.id, digest, dryRun, config.error_channel);

  const canvasContent = await renderCanvasContent(allEvents, { locale, timezone, ...channel, config, cacheMap });
  await updateCanvas(channel.canvas_id, canvasContent, dryRun);
}

/**
 * Route detected diffs to subscribed channels with debouncing
 * @param {Object} config
 * @param {string} calendarId
 * @param {Array} diffsWithCalendar
 * @param {import('better-sqlite3').Database} db
 * @param {boolean} dryRun
 */
async function routeDiffsToChannels(config, calendarId, diffsWithCalendar, db, dryRun) {
  const cacheMap = await buildCacheMap(config, db);

  for (const channel of config.channels) {
    if (!channel.calendars.includes(calendarId)) continue;

    const notifiableDiffs = diffsWithCalendar.filter(diff => shouldNotifyNow(diff, channel));
    if (notifiableDiffs.length === 0) continue;

    const pending = loadPendingNotifications(db, channel.id);

    if (pending.expired && pending.diffs.length > 0) {
      console.log(`Debounce window expired for channel ${channel.id} - posting ${pending.diffs.length} stale diffs`);
      const locale = channel.locale || config.locale;
      const timezone = channel.timezone || config.timezone || 'UTC';
      const { message: staleNotification, newColors: staleNewColors } = await renderBundledNotification(pending.diffs, locale, timezone, { config, cacheMap });
      await postMessage(channel.id, staleNotification, dryRun, config.error_channel);

      if (staleNewColors) {
        for (const [calId, colorCache] of staleNewColors.entries()) {
          try {
            const cached = loadCacheState(db, calId);
            if (cached) saveCacheState(db, calId, cached.events, null, colorCache);
          } catch (error) {
            console.warn(`Failed to persist color for calendar ${calId}:`, error.message);
          }
        }
      }
    }

    if (pending.expired || pending.diffs.length === 0) {
      console.log(`Started fresh debounce window for channel ${channel.id}`);
      savePendingNotifications(db, channel.id, notifiableDiffs);
      continue;
    }

    const allDiffs = [...pending.diffs, ...notifiableDiffs];
    const locale = channel.locale || config.locale;
    const timezone = channel.timezone || config.timezone || 'UTC';
    const { message: notification, newColors } = await renderBundledNotification(allDiffs, locale, timezone, { config, cacheMap });
    await postMessage(channel.id, notification, dryRun, config.error_channel);

    if (newColors) {
      for (const [calId, colorCache] of newColors.entries()) {
        try {
          const cached = loadCacheState(db, calId);
          if (cached) saveCacheState(db, calId, cached.events, null, colorCache);
        } catch (error) {
          console.warn(`Failed to persist color for calendar ${calId}:`, error.message);
        }
      }
    }

    savePendingNotifications(db, channel.id, []);
  }
}

/**
 * Run full refresh for all calendars
 * @param {Object} config
 * @param {import('better-sqlite3').Database} db
 * @param {boolean} dryRun
 */
async function runFullRefresh(config, db, dryRun) {
  console.log('Running full refresh for all calendars');
  const timezone = config.timezone || 'UTC';
  for (const calId of Object.keys(config.calendars)) {
    const calendar = config.calendars[calId];
    const currentEvents = await fetchCalendar(calendar.caldav_url, config.caldav_credentials, getCurrentWeekRange(), timezone);
    const cached = loadCacheState(db, calId);
    const previousEvents = cached ? cached.events : [];
    const diffs = diffEvents(previousEvents, currentEvents);

    if (diffs.length > 0) {
      console.log(`Calendar ${calId}: ${diffs.length} change(s)`);
      const diffsWithCalendar = diffs.map(d => ({ ...d, calendarName: calendar.name }));
      await routeDiffsToChannels(config, calId, diffsWithCalendar, db, dryRun);
    }

    saveCacheState(db, calId, currentEvents, null, null);
  }
}

/**
 * Handle webhook event change notifications
 * @param {Object} config
 * @param {import('better-sqlite3').Database} db
 * @param {boolean} dryRun
 */
async function runEventChanged(config, db, dryRun) {
  const payload = process.env.WEBHOOK_PAYLOAD ? JSON.parse(process.env.WEBHOOK_PAYLOAD) : {};
  const calendarId = payload.calendar_id || payload.calendarId || payload.id;

  if (!calendarId) {
    console.warn('No calendar_id in webhook payload - running full refresh');
    await runFullRefresh(config, db, dryRun);
    return;
  }

  let matchedCalId = Object.keys(config.calendars).find(id => id === calendarId)
    || Object.keys(config.calendars).find(id => id.toLowerCase() === calendarId.toLowerCase());

  if (!matchedCalId) {
    console.warn(`Calendar '${calendarId}' not found in config - running full refresh`);
    await runFullRefresh(config, db, dryRun);
    return;
  }

  console.log(`Processing webhook for calendar: ${matchedCalId}`);
  const calendar = config.calendars[matchedCalId];
  const timezone = config.timezone || 'UTC';
  const currentEvents = await fetchCalendar(calendar.caldav_url, config.caldav_credentials, getCurrentWeekRange(), timezone);

  const cached = loadCacheState(db, matchedCalId);
  const previousEvents = cached ? cached.events : [];
  const diffs = diffEvents(previousEvents, currentEvents);

  if (diffs.length === 0) {
    console.log('No changes detected');
    saveCacheState(db, matchedCalId, currentEvents, null, null);
    return;
  }

  console.log(`Detected ${diffs.length} change(s)`);
  const diffsWithCalendar = diffs.map(d => ({ ...d, calendarName: calendar.name }));
  await routeDiffsToChannels(config, matchedCalId, diffsWithCalendar, db, dryRun);
  saveCacheState(db, matchedCalId, currentEvents, null, null);
}

/**
 * Run weekly digest for all channels
 * @param {Object} config
 * @param {import('better-sqlite3').Database} db
 * @param {boolean} dryRun
 * @param {boolean} forceAll
 */
async function runWeeklyDigest(config, db, dryRun, forceAll) {
  console.log('Running weekly digest...');
  for (const channel of config.channels) {
    await postDigestForChannel(config, channel, 'weekly', db, dryRun);
  }
}

/**
 * Run daily digest for all channels
 * @param {Object} config
 * @param {import('better-sqlite3').Database} db
 * @param {boolean} dryRun
 * @param {boolean} forceAll
 */
async function runDailyDigest(config, db, dryRun, forceAll) {
  console.log('Running daily digest...');
  for (const channel of config.channels) {
    await postDigestForChannel(config, channel, 'daily', db, dryRun);
  }
}

/**
 * Get current week date range (Monday - Sunday)
 * @param {Date} [now]
 * @returns {{start: Date, end: Date}}
 */
function getCurrentWeekRange(now = new Date()) {
  const dayOfWeek = now.getUTCDay();
  const startOfWeek = new Date(now);
  if (dayOfWeek === 0) {
    startOfWeek.setUTCDate(now.getUTCDate() + 1);
  } else {
    startOfWeek.setUTCDate(now.getUTCDate() - dayOfWeek + 1);
  }
  startOfWeek.setUTCHours(0, 0, 0, 0);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setUTCDate(startOfWeek.getUTCDate() + 6);
  endOfWeek.setUTCHours(23, 59, 59, 999);
  return { start: startOfWeek, end: endOfWeek };
}

/**
 * Get change detection date range (current week + 4 weeks lookahead)
 * @param {Date} [now]
 * @returns {{start: Date, end: Date}}
 */
function getChangeDetectionRange(now = new Date()) {
  const dayOfWeek = now.getUTCDay();
  const startOfWeek = new Date(now);
  startOfWeek.setUTCDate(now.getUTCDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1));
  startOfWeek.setUTCHours(0, 0, 0, 0);
  const endOfLookahead = new Date(startOfWeek);
  endOfLookahead.setUTCDate(startOfWeek.getUTCDate() + (7 * 5) - 1);
  endOfLookahead.setUTCHours(23, 59, 59, 999);
  return { start: startOfWeek, end: endOfLookahead };
}

/**
 * Get daily digest date range (today and tomorrow)
 * @returns {{start: Date, end: Date}}
 */
function getDailyRange() {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setUTCHours(0, 0, 0, 0);
  const endOfTomorrow = new Date(now);
  endOfTomorrow.setUTCDate(now.getUTCDate() + 1);
  endOfTomorrow.setUTCHours(23, 59, 59, 999);
  return { start: startOfToday, end: endOfTomorrow };
}

module.exports = {
  runScheduledDigests,
  runWeeklyDigest,
  runDailyDigest,
  runChangeDetection,
  runEventChanged,
  runFullRefresh,
  postDigestForChannel,
  buildCacheMap,
  getCurrentWeekRange,
  getChangeDetectionRange,
  getDailyRange
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
NODE_ENV=test node --test test/runner.test.js
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/runner.js test/runner.test.js
git commit -m "feat: extract runner.js with all business logic from bot.js

refs: #23"
```

---

## Task 6: Slim `src/bot.js` to CLI shim, update `test/bot.test.js`

**Files:**
- Modify: `src/bot.js`
- Modify: `test/bot.test.js`

`bot.js` becomes ~40 lines: parse args, open db (or skip for date-only tests), call runner, exit.

- [ ] **Step 1: Update `test/bot.test.js`** — replace all test imports from `bot.js` with `runner.js`, and remove the `loadLastRunTime`/`saveLastRunTime` tests (those are now covered by `runner.test.js` via `db.js`).

Open `test/bot.test.js`. Find the import line at the top and all `require('../src/bot.js')` calls. Change them to `require('../src/runner.js')`. Remove the two tests named `saveLastRunTime should create lastrun file` and `loadLastRunTime should return null for nonexistent file`.

The file should now only test `getChangeDetectionRange` and `getCurrentWeekRange` from `runner.js`.

- [ ] **Step 2: Run bot tests with updated imports to confirm they pass**

```bash
NODE_ENV=test node --test test/bot.test.js
```

Expected: all remaining tests pass (4 tests about date ranges).

- [ ] **Step 3: Rewrite `src/bot.js`**

```js
#!/usr/bin/env node

const path = require('node:path');
const { loadConfig } = require('./config.js');
const { openDb, migrateFromFlatFiles } = require('./db.js');
const {
  runScheduledDigests,
  runWeeklyDigest,
  runDailyDigest,
  runEventChanged,
  runChangeDetection
} = require('./runner.js');

const args = process.argv.slice(2);
const mode = args.find(arg => arg.startsWith('--') && !arg.startsWith('--dry'));
const dryRun = args.includes('--dry-run');

async function main() {
  const config = await loadConfig();

  const dataDir = process.env.DATA_DIR;
  if (!dataDir) throw new Error('DATA_DIR environment variable not set');

  const dbPath = path.join(dataDir, 'bot.db');
  const db = openDb(dbPath);

  // Migrate legacy flat files if CACHE_DIR is set
  const legacyDir = process.env.CACHE_DIR;
  if (legacyDir) migrateFromFlatFiles(db, legacyDir);

  if (mode === '--scheduled') {
    await runScheduledDigests(config, db, dryRun);
  } else if (mode === '--weekly-digest') {
    await runWeeklyDigest(config, db, dryRun, true);
  } else if (mode === '--daily-digest') {
    await runDailyDigest(config, db, dryRun, true);
  } else if (mode === '--event-changed') {
    await runEventChanged(config, db, dryRun);
  } else if (mode === '--detect-changes') {
    await runChangeDetection(config, db, dryRun);
  } else {
    console.error('Usage: node bot.js [--scheduled|--weekly-digest|--daily-digest|--event-changed|--detect-changes] [--dry-run]');
    process.exit(1);
  }

  if (dryRun) {
    console.log('[TEST MODE] All messages routed to error_channel. Canvas updates skipped.');
  }

  db.close();
  process.exit(0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

// Re-export date helpers so existing callers continue to work
const { getCurrentWeekRange, getChangeDetectionRange } = require('./runner.js');
module.exports = { getCurrentWeekRange, getChangeDetectionRange };
```

- [ ] **Step 4: Run the full test suite to confirm nothing is broken**

```bash
NODE_ENV=test node --test test/*.test.js
```

Expected: all tests pass across all test files.

- [ ] **Step 5: Commit**

```bash
git add src/bot.js test/bot.test.js
git commit -m "refactor: slim bot.js to CLI shim, delegate logic to runner.js

refs: #23"
```

---

## Task 7: Create `src/server.js` — persistent node-cron scheduler

**Files:**
- Create: `src/server.js`

`server.js` boots on `node src/server.js`. It loads config, opens db (with migration), registers one cron job per channel schedule, registers a change-detection cron, and handles graceful shutdown. No HTTP server (added in Sprint 2).

- [ ] **Step 1: Write the failing test for `scheduleStringToCron`**

Create `test/server.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { scheduleStringToCron } = require('../src/server.js');

test('scheduleStringToCron converts sunday HH:MM to cron', () => {
  assert.strictEqual(scheduleStringToCron('sunday 18:00'), '0 18 * * 0');
});

test('scheduleStringToCron converts monday HH:MM to cron', () => {
  assert.strictEqual(scheduleStringToCron('monday 08:30'), '30 8 * * 1');
});

test('scheduleStringToCron converts tuesday HH:MM to cron', () => {
  assert.strictEqual(scheduleStringToCron('tuesday 09:00'), '0 9 * * 2');
});

test('scheduleStringToCron converts wednesday HH:MM to cron', () => {
  assert.strictEqual(scheduleStringToCron('wednesday 12:00'), '0 12 * * 3');
});

test('scheduleStringToCron converts thursday HH:MM to cron', () => {
  assert.strictEqual(scheduleStringToCron('thursday 17:00'), '0 17 * * 4');
});

test('scheduleStringToCron converts friday HH:MM to cron', () => {
  assert.strictEqual(scheduleStringToCron('friday 07:00'), '0 7 * * 5');
});

test('scheduleStringToCron converts saturday HH:MM to cron', () => {
  assert.strictEqual(scheduleStringToCron('saturday 10:00'), '0 10 * * 6');
});

test('scheduleStringToCron converts weekdays HH:MM to cron', () => {
  assert.strictEqual(scheduleStringToCron('weekdays 08:00'), '0 8 * * 1-5');
});

test('scheduleStringToCron converts weekends HH:MM to cron', () => {
  assert.strictEqual(scheduleStringToCron('weekends 10:00'), '0 10 * * 0,6');
});

test('scheduleStringToCron converts daily HH:MM to cron', () => {
  assert.strictEqual(scheduleStringToCron('daily 07:00'), '0 7 * * *');
});

test('scheduleStringToCron passes through valid cron expression unchanged', () => {
  assert.strictEqual(scheduleStringToCron('0 18 * * 0'), '0 18 * * 0');
});

test('scheduleStringToCron throws on unrecognised string', () => {
  assert.throws(() => scheduleStringToCron('banana'), /Unrecognised schedule/);
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
NODE_ENV=test node --test test/server.test.js
```

Expected: `Cannot find module '../src/server.js'`

- [ ] **Step 3: Create `src/server.js`**

```js
const path = require('node:path');
const cron = require('node-cron');
const { loadConfig } = require('./config.js');
const { openDb, migrateFromFlatFiles } = require('./db.js');
const { runScheduledDigests, runChangeDetection } = require('./runner.js');

const DAY_MAP = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

/**
 * Convert a config schedule string to a node-cron expression.
 * Accepts 'day HH:MM', 'weekdays HH:MM', 'weekends HH:MM', 'daily HH:MM',
 * or a raw 5-field cron expression (passed through unchanged).
 * @param {string} str - Schedule string from config
 * @returns {string} node-cron expression
 * @example scheduleStringToCron('sunday 18:00') // '0 18 * * 0'
 * @example scheduleStringToCron('weekdays 08:00') // '0 8 * * 1-5'
 * @example scheduleStringToCron('0 18 * * 0') // '0 18 * * 0'
 */
function scheduleStringToCron(str) {
  // Pass through if already a 5-field cron expression
  if (/^\d+\s+\d+\s+[\d*]+\s+[\d*]+\s+[\d*,\-\/]+$/.test(str.trim())) {
    return str.trim();
  }

  const match = str.trim().match(/^(sunday|monday|tuesday|wednesday|thursday|friday|saturday|weekdays|weekends|daily)\s+(\d{1,2}):(\d{2})$/i);
  if (!match) throw new Error(`Unrecognised schedule string: "${str}"`);

  const [, day, hours, minutes] = match;
  const h = parseInt(hours, 10);
  const m = parseInt(minutes, 10);
  const keyword = day.toLowerCase();

  if (keyword === 'weekdays') return `${m} ${h} * * 1-5`;
  if (keyword === 'weekends') return `${m} ${h} * * 0,6`;
  if (keyword === 'daily') return `${m} ${h} * * *`;

  return `${m} ${h} * * ${DAY_MAP[keyword]}`;
}

async function start() {
  const config = await loadConfig();

  const dataDir = process.env.DATA_DIR;
  if (!dataDir) throw new Error('DATA_DIR environment variable not set');

  const dbPath = path.join(dataDir, 'bot.db');
  const db = openDb(dbPath);

  const legacyDir = process.env.CACHE_DIR;
  if (legacyDir) migrateFromFlatFiles(db, legacyDir);

  const jobs = [];
  const dryRun = process.env.DRY_RUN === 'true';

  for (const channel of config.channels) {
    if (channel.digest_schedule) {
      const expr = scheduleStringToCron(channel.digest_schedule);
      console.log(`Registering weekly digest for channel ${channel.id}: ${expr}`);
      jobs.push(cron.schedule(expr, async () => {
        console.log(`[cron] Weekly digest firing for channel ${channel.id}`);
        try {
          await runScheduledDigests(config, db, dryRun);
        } catch (err) {
          console.error(`[cron] Weekly digest error for ${channel.id}:`, err.message);
        }
      }));
    }

    if (channel.daily_digest_schedule) {
      const expr = scheduleStringToCron(channel.daily_digest_schedule);
      console.log(`Registering daily digest for channel ${channel.id}: ${expr}`);
      jobs.push(cron.schedule(expr, async () => {
        console.log(`[cron] Daily digest firing for channel ${channel.id}`);
        try {
          await runScheduledDigests(config, db, dryRun);
        } catch (err) {
          console.error(`[cron] Daily digest error for ${channel.id}:`, err.message);
        }
      }));
    }
  }

  // Change detection: every 2 hours between 06:00–18:00 UTC, matching change-detection.yml
  const changeDetectionExpr = '0 6-18/2 * * *';
  console.log(`Registering change detection: ${changeDetectionExpr}`);
  jobs.push(cron.schedule(changeDetectionExpr, async () => {
    console.log('[cron] Change detection firing');
    try {
      await runChangeDetection(config, db, dryRun);
    } catch (err) {
      console.error('[cron] Change detection error:', err.message);
    }
  }));

  function shutdown() {
    console.log('Shutting down — stopping cron jobs');
    for (const job of jobs) job.stop();
    db.close();
    process.exit(0);
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  console.log(`Server started. ${jobs.length} cron job(s) registered.`);
}

if (require.main === module) {
  start().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { scheduleStringToCron };
```

- [ ] **Step 4: Run server tests to verify they pass**

```bash
NODE_ENV=test node --test test/server.test.js
```

Expected: all 12 tests pass.

- [ ] **Step 5: Run the full test suite**

```bash
NODE_ENV=test node --test test/*.test.js
```

Expected: all tests across all files pass.

- [ ] **Step 6: Commit**

```bash
git add src/server.js test/server.test.js
git commit -m "feat: add persistent server.js with node-cron scheduler and scheduleStringToCron

refs: #23"
```

---

## Self-Review

### Spec coverage check

| Spec requirement | Task |
|---|---|
| Server boots and runs scheduled digests without GH Actions | Task 7 (`server.js`) |
| Change detection runs on schedule from server | Task 7 (change detection cron job) |
| Existing bot logic unchanged | Task 5/6 (extracted to `runner.js`, logic identical) |
| Cron schedule driven by `digest_schedule`/`daily_digest_schedule` from config | Task 7 (`scheduleStringToCron`) |
| `cache.js` replaced with SQLite-backed implementation, same interface | Task 3 |
| Run timestamps stored in SQLite | Task 2 (`run_state` table) + Task 5 |
| One `.db` file per tenant under `DATA_DIR` | Task 6 (`bot.js`) + Task 7 (`server.js`) |
| Migration: flat JSON files auto-imported on first run | Task 2 (`migrateFromFlatFiles`) |
| Tests updated to use in-memory SQLite (`:memory:`) | Tasks 2, 3, 4, 5 |
| `CACHE_DIR` deprecated in favour of `DATA_DIR` | Tasks 6, 7 |

All requirements covered. No gaps.

### Placeholder scan

No TBDs or "implement later" present. All code blocks are complete.

### Type consistency

- `db` is always `import('better-sqlite3').Database` — consistent across all tasks
- `loadCacheState(db, calendarId)` — consistent in Task 3 (cache.js) and all runner.js callsites in Task 5
- `saveCacheState(db, calendarId, events, errorState, color)` — consistent everywhere
- `loadPendingNotifications(db, channelId)` / `savePendingNotifications(db, channelId, diffs)` — consistent in diff.js (Task 4) and runner.js callsites (Task 5)
- `loadRunState(db, channelId, digestType)` / `saveRunState(db, channelId, digestType, ts)` — consistent in db.js (Task 2) and runner.js (Task 5)
