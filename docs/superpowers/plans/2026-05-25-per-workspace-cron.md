**Issue:** #47

# Per-Workspace Cron Scheduling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-workspace hardcoded cron setup in `server.js` with a multi-tenant scheduler that loads all active workspaces from SQLite at startup and dynamically adds or removes jobs when workspaces install or uninstall.

**Architecture:** `scheduler-registry.js` owns a `Map<workspaceId, CronTask[]>` and is independently testable with a stub cron. `events.js` handles `POST /slack/events` with HMAC replay-protection and fires an `onUninstall(teamId)` callback — it knows nothing about scheduling. `server.js` becomes a pure orchestrator wiring the pieces together. `runner.js`'s exported functions load config per-invocation from SQLite instead of receiving it from the caller.

**Tech Stack:** Node.js 20+, node-cron 4.x, better-sqlite3, node:crypto (HMAC-SHA256), node:test + node:assert

---

### Task 1: db.js — add `markWorkspaceInactive`

**Files:**
- Modify: `src/db.js`
- Modify: `test/db.test.js`

- [ ] **Step 1.1: Add three failing tests to `test/db.test.js`**

Add these tests at the bottom of the file (after the existing `listActiveWorkspaces` tests). The existing imports already cover `upsertWorkspaceFromOAuth` and `listActiveWorkspaces`; add `markWorkspaceInactive` to the destructure on line 248:

```javascript
const { upsertWorkspaceFromOAuth, listActiveWorkspaces, markWorkspaceInactive } = require('../src/db.js');

test('markWorkspaceInactive sets active = 0 for the given team_id', () => {
  const db = memDb();
  upsertWorkspaceFromOAuth(db, { teamId: 'T_INACT', teamName: 'Bye', botToken: 'xoxb-bye', installedBy: 'U1' });
  markWorkspaceInactive(db, 'T_INACT');
  const raw = db.prepare('SELECT active FROM workspaces WHERE team_id = ?').get('T_INACT');
  assert.strictEqual(raw.active, 0);
  db.close();
});

test('markWorkspaceInactive — no-op for unknown team_id (no error)', () => {
  const db = memDb();
  assert.doesNotThrow(() => markWorkspaceInactive(db, 'T_GHOST'));
  db.close();
});

test('listActiveWorkspaces excludes workspace marked inactive via markWorkspaceInactive', () => {
  const db = memDb();
  upsertWorkspaceFromOAuth(db, { teamId: 'T_STAYS', teamName: 'Active', botToken: 'xoxb-a', installedBy: 'U1' });
  upsertWorkspaceFromOAuth(db, { teamId: 'T_GONE',  teamName: 'Gone',   botToken: 'xoxb-b', installedBy: 'U2' });
  markWorkspaceInactive(db, 'T_GONE');
  const rows = listActiveWorkspaces(db);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].team_id, 'T_STAYS');
  db.close();
});
```

- [ ] **Step 1.2: Run the tests to verify they fail**

```bash
NODE_ENV=test node --test test/db.test.js 2>&1 | tail -10
```

Expected: `TypeError: markWorkspaceInactive is not a function`

- [ ] **Step 1.3: Add `markWorkspaceInactive` to `src/db.js`**

Add this function after `listActiveWorkspaces`, before `module.exports`:

```javascript
/**
 * Mark a workspace as inactive. Called after app_uninstalled Slack event.
 * No-op if team_id does not exist.
 * @param {import('better-sqlite3').Database} db
 * @param {string} teamId
 */
function markWorkspaceInactive(db, teamId) {
  db.prepare('UPDATE workspaces SET active = 0 WHERE team_id = ?').run(teamId);
}
```

Add `markWorkspaceInactive` to the existing `module.exports` object in `src/db.js`.

- [ ] **Step 1.4: Run tests — expect all pass**

```bash
NODE_ENV=test node --test test/db.test.js 2>&1 | grep -E "^# (tests|pass|fail)"
```

Expected: `# fail 0`

- [ ] **Step 1.5: Commit**

```bash
git add src/db.js test/db.test.js
git commit -m "feat: add markWorkspaceInactive to db.js  refs: #47"
```

---

### Task 2: runner.js — update `runScheduledDigests` and `runChangeDetection` to `(db, workspaceId, dryRun)`

**Files:**
- Modify: `src/runner.js`
- Modify: `test/runner.test.js`

- [ ] **Step 2.1: Add two failing tests to `test/runner.test.js`**

```javascript
const { runScheduledDigests, runChangeDetection } = require('../src/runner.js');

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0'.repeat(64);

test('runScheduledDigests(db, workspaceId, dryRun) — throws if workspace not found', async () => {
  const db = openDb(':memory:');
  await assert.rejects(
    () => runScheduledDigests(db, 'T_UNKNOWN', false),
    /Workspace not found: T_UNKNOWN/
  );
  db.close();
});

test('runChangeDetection(db, workspaceId, dryRun) — throws if workspace not found', async () => {
  const db = openDb(':memory:');
  await assert.rejects(
    () => runChangeDetection(db, 'T_UNKNOWN', false),
    /Workspace not found: T_UNKNOWN/
  );
  db.close();
});
```

- [ ] **Step 2.2: Run tests to verify they fail**

```bash
NODE_ENV=test node --test test/runner.test.js 2>&1 | tail -10
```

Expected: tests fail — the old signature treats `db` as `config` and throws something other than "Workspace not found".

- [ ] **Step 2.3: Add `loadConfigFromDb` import to `src/runner.js`**

At the top of `src/runner.js`, add to imports:

```javascript
const { loadConfigFromDb } = require('./config.js');
```

The existing last import line is `const { loadRunState, saveRunState } = require('./db.js');` — add after it.

- [ ] **Step 2.4: Update `runChangeDetection` signature in `src/runner.js`**

```javascript
// Before:
async function runChangeDetection(config, db, dryRun) {
  console.log('Running change detection...');

// After:
async function runChangeDetection(db, workspaceId, dryRun) {
  const config = loadConfigFromDb(db, workspaceId);
  console.log('Running change detection...');
```

- [ ] **Step 2.5: Update `runScheduledDigests` signature in `src/runner.js`**

```javascript
// Before:
async function runScheduledDigests(config, db, dryRun) {
  const now = new Date();

// After:
async function runScheduledDigests(db, workspaceId, dryRun) {
  const config = loadConfigFromDb(db, workspaceId);
  const now = new Date();
```

- [ ] **Step 2.6: Run tests — expect new tests pass, no regressions in suite**

```bash
NODE_ENV=test node --test test/runner.test.js 2>&1 | grep -E "^# (tests|pass|fail)"
NODE_ENV=test node --test test/*.test.js 2>&1 | grep -E "^# (tests|pass|fail)"
```

Expected: `# fail 0` on both.

Note: server.js still calls `runScheduledDigests(config, db, dryRun)` with the old signature — the server.js integration stays broken until Task 6. That's fine; server.js is not tested with the signature directly in the current test suite.

- [ ] **Step 2.7: Commit**

```bash
git add src/runner.js test/runner.test.js
git commit -m "feat: update runner.js signatures to (db, workspaceId, dryRun)  refs: #47"
```

---

### Task 3: oauth.js — add optional `onInstall` callback

**Files:**
- Modify: `src/oauth.js`
- Modify: `test/oauth.test.js`

- [ ] **Step 3.1: Add two failing tests to `test/oauth.test.js`**

Add at the bottom of the file:

```javascript
test('GET /slack/oauth/callback success — fires onInstall with teamId', async () => {
  const db = openDb(':memory:');
  _setClientForTest({
    oauth: {
      v2: {
        access: async () => ({
          access_token: 'xoxb-cb-test',
          team: { id: 'T_INSTALL_CB', name: 'CB Corp' },
          authed_user: { id: 'U_ADMIN' }
        })
      }
    }
  });
  try {
    let calledWith = null;
    const onInstall = async (teamId) => { calledWith = teamId; };
    const installRes = mockRes();
    await handleOAuthRequest(db, mockReq('GET', '/slack/install'), installRes);
    const state = new URL(installRes._headers['Location']).searchParams.get('state');
    const callbackRes = mockRes();
    await handleOAuthRequest(db, mockReq('GET', `/slack/oauth/callback?code=ok&state=${state}`), callbackRes, onInstall);
    assert.strictEqual(callbackRes._statusCode, 302);
    assert.strictEqual(calledWith, 'T_INSTALL_CB');
  } finally {
    _setClientForTest(null);
    db.close();
  }
});

test('GET /slack/oauth/callback — onInstall omitted — still redirects (backward compat)', async () => {
  const db = openDb(':memory:');
  _setClientForTest({
    oauth: {
      v2: {
        access: async () => ({
          access_token: 'xoxb-compat',
          team: { id: 'T_COMPAT', name: 'Compat' },
          authed_user: { id: 'U1' }
        })
      }
    }
  });
  try {
    const installRes = mockRes();
    await handleOAuthRequest(db, mockReq('GET', '/slack/install'), installRes);
    const state = new URL(installRes._headers['Location']).searchParams.get('state');
    const callbackRes = mockRes();
    await handleOAuthRequest(db, mockReq('GET', `/slack/oauth/callback?code=ok&state=${state}`), callbackRes);
    assert.strictEqual(callbackRes._statusCode, 302);
  } finally {
    _setClientForTest(null);
    db.close();
  }
});
```

- [ ] **Step 3.2: Run tests to verify they fail**

```bash
NODE_ENV=test node --test test/oauth.test.js 2>&1 | tail -10
```

Expected: `calledWith` is still `null` — `onInstall` is never called.

- [ ] **Step 3.3: Update `handleOAuthRequest` in `src/oauth.js`**

Change signature (line 88):

```javascript
// Before:
async function handleOAuthRequest(db, req, res) {

// After:
async function handleOAuthRequest(db, req, res, onInstall) {
```

In the OAuth callback success branch, replace the `// TODO #48` comment and the redirect:

```javascript
      upsertWorkspaceFromOAuth(db, {
        teamId: result.team.id,
        teamName: result.team.name,
        botToken: result.access_token,
        installedBy: result.authed_user.id
      });

      if (onInstall) await onInstall(result.team.id);

      res.writeHead(302, { Location: '/slack/install/success' });
      res.end();
```

- [ ] **Step 3.4: Run tests — expect all pass**

```bash
NODE_ENV=test node --test test/oauth.test.js 2>&1 | grep -E "^# (tests|pass|fail)"
```

Expected: `# fail 0`

- [ ] **Step 3.5: Commit**

```bash
git add src/oauth.js test/oauth.test.js
git commit -m "feat: add optional onInstall callback to handleOAuthRequest  refs: #47"
```

---

### Task 4: scheduler-registry.js — new multi-tenant job registry

**Files:**
- Create: `src/scheduler-registry.js`
- Create: `test/scheduler-registry.test.js`
- Modify: `src/server.js` (remove `DAY_MAP` + `scheduleStringToCron`; import from registry)
- Modify: `test/server.test.js` (update import path)

- [ ] **Step 4.1: Write the failing tests — create `test/scheduler-registry.test.js`**

```javascript
process.env.ENCRYPTION_KEY = '0'.repeat(64);

const { test } = require('node:test');
const assert = require('node:assert');
const { openDb, upsertWorkspaceFromOAuth } = require('../src/db.js');
const { seedWorkspace } = require('../src/config.js');
const {
  scheduleWorkspace, scheduleAllWorkspaces, unscheduleWorkspace, stopAll,
  _setCronForTest, _jobCount, scheduleStringToCron
} = require('../src/scheduler-registry.js');

function makeMockCron() {
  const tasks = [];
  return {
    tasks,
    schedule(expr, handler) {
      const task = { expr, handler, stopped: false, stop() { this.stopped = true; } };
      tasks.push(task);
      return task;
    }
  };
}

function seedTestWorkspace(db, workspaceId) {
  seedWorkspace(db, workspaceId, {
    locale: 'en-US',
    caldav_credentials: { username: 'u', password: 'p' },
    calendars: { 'cal-1': { name: 'Cal', caldav_url: 'http://example.com/cal.ics' } },
    channels: [{
      id: 'C_TEST',
      canvas_id: 'F_TEST',
      calendars: ['cal-1'],
      digest_schedule: 'monday 09:00',
      daily_digest_schedule: 'daily 07:00'
    }]
  });
}

test('scheduleStringToCron converts sunday HH:MM to cron', () => {
  assert.strictEqual(scheduleStringToCron('sunday 18:00'), '0 18 * * 0');
});

test('scheduleStringToCron converts weekdays HH:MM to cron', () => {
  assert.strictEqual(scheduleStringToCron('weekdays 08:00'), '0 8 * * 1-5');
});

test('scheduleStringToCron passes through valid cron expression', () => {
  assert.strictEqual(scheduleStringToCron('0 18 * * 0'), '0 18 * * 0');
});

test('scheduleStringToCron throws on unrecognised string', () => {
  assert.throws(() => scheduleStringToCron('banana'), /Unrecognised schedule/);
});

test('scheduleWorkspace — registers digest + daily + change-detection jobs', () => {
  const mock = makeMockCron();
  _setCronForTest(mock);
  stopAll();
  const db = openDb(':memory:');
  seedTestWorkspace(db, 'T_REG');
  scheduleWorkspace(db, 'T_REG', false);
  assert.strictEqual(mock.tasks.length, 3, 'expected 3 jobs: digest, daily, change-detection');
  assert.strictEqual(_jobCount(), 1);
  assert.strictEqual(mock.tasks[0].expr, '0 9 * * 1', 'digest must be monday 09:00');
  assert.strictEqual(mock.tasks[1].expr, '0 7 * * *', 'daily must be 07:00');
  assert.strictEqual(mock.tasks[2].expr, '0 6-18/2 * * *', 'change-detection fixed schedule');
  _setCronForTest(null);
  stopAll();
  db.close();
});

test('scheduleWorkspace — idempotent: calling twice stops first set of jobs', () => {
  const mock = makeMockCron();
  _setCronForTest(mock);
  stopAll();
  const db = openDb(':memory:');
  seedTestWorkspace(db, 'T_IDEM');
  scheduleWorkspace(db, 'T_IDEM', false);
  const firstBatch = [...mock.tasks];
  scheduleWorkspace(db, 'T_IDEM', false);
  assert.ok(firstBatch.every(t => t.stopped), 'first batch must be stopped');
  assert.ok(mock.tasks.slice(3).every(t => !t.stopped), 'second batch must be running');
  assert.strictEqual(_jobCount(), 1);
  _setCronForTest(null);
  stopAll();
  db.close();
});

test('unscheduleWorkspace — stops all jobs; _jobCount drops to 0', () => {
  const mock = makeMockCron();
  _setCronForTest(mock);
  stopAll();
  const db = openDb(':memory:');
  seedTestWorkspace(db, 'T_UNSCHED');
  scheduleWorkspace(db, 'T_UNSCHED', false);
  assert.strictEqual(_jobCount(), 1);
  unscheduleWorkspace('T_UNSCHED');
  assert.strictEqual(_jobCount(), 0);
  assert.ok(mock.tasks.every(t => t.stopped));
  db.close();
  _setCronForTest(null);
});

test('unscheduleWorkspace — second call is a no-op (no error)', () => {
  stopAll();
  assert.doesNotThrow(() => unscheduleWorkspace('T_NONEXISTENT'));
});

test('scheduleAllWorkspaces — schedules both active workspaces', async () => {
  const mock = makeMockCron();
  _setCronForTest(mock);
  stopAll();
  const db = openDb(':memory:');
  seedTestWorkspace(db, 'T_ALL_A');
  seedTestWorkspace(db, 'T_ALL_B');
  await scheduleAllWorkspaces(db, false);
  assert.strictEqual(_jobCount(), 2, 'two workspaces must have jobs registered');
  _setCronForTest(null);
  stopAll();
  db.close();
});

test('stopAll — stops all jobs and clears JOBS map', () => {
  const mock = makeMockCron();
  _setCronForTest(mock);
  stopAll();
  const db = openDb(':memory:');
  seedTestWorkspace(db, 'T_STOP_A');
  seedTestWorkspace(db, 'T_STOP_B');
  scheduleWorkspace(db, 'T_STOP_A', false);
  scheduleWorkspace(db, 'T_STOP_B', false);
  assert.strictEqual(_jobCount(), 2);
  stopAll();
  assert.strictEqual(_jobCount(), 0);
  assert.ok(mock.tasks.every(t => t.stopped), 'all tasks must be stopped');
  _setCronForTest(null);
  db.close();
});
```

- [ ] **Step 4.2: Run tests to verify they fail**

```bash
NODE_ENV=test node --test test/scheduler-registry.test.js 2>&1 | tail -5
```

Expected: `Error: Cannot find module '../src/scheduler-registry.js'`

- [ ] **Step 4.3: Create `src/scheduler-registry.js`**

```javascript
const cron = require('node-cron');
const { loadConfigFromDb } = require('./config.js');
const { listActiveWorkspaces } = require('./db.js');
const { runScheduledDigests, runChangeDetection } = require('./runner.js');

const DAY_MAP = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

/**
 * Convert a config schedule string to a node-cron expression.
 * Accepts 'day HH:MM', 'weekdays HH:MM', 'weekends HH:MM', 'daily HH:MM',
 * or a raw 5-field cron expression (passed through unchanged).
 * @param {string} str
 * @returns {string}
 * @example scheduleStringToCron('sunday 18:00') // '0 18 * * 0'
 */
function scheduleStringToCron(str) {
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

const JOBS = new Map();
let _cron = cron;

/**
 * Override node-cron for tests. Pass null to restore.
 * @param {object|null} mockCron
 */
function _setCronForTest(mockCron) {
  _cron = mockCron || cron;
}

/**
 * Number of workspaces currently registered. For tests only.
 * @returns {number}
 */
function _jobCount() {
  return JOBS.size;
}

/**
 * Register cron jobs for one workspace. Idempotent — stops old jobs first if already registered.
 * @param {import('better-sqlite3').Database} db
 * @param {string} workspaceId
 * @param {boolean} dryRun
 */
function scheduleWorkspace(db, workspaceId, dryRun) {
  if (JOBS.has(workspaceId)) unscheduleWorkspace(workspaceId);
  const config = loadConfigFromDb(db, workspaceId);
  const tasks = [];

  for (const channel of config.channels) {
    if (channel.digest_schedule) {
      const expr = scheduleStringToCron(channel.digest_schedule);
      console.log(`[scheduler] digest workspace=${workspaceId} channel=${channel.id} expr=${expr}`);
      tasks.push(_cron.schedule(expr, async () => {
        console.log(`[cron][${workspaceId}] digest firing for channel ${channel.id}`);
        try {
          await runScheduledDigests(db, workspaceId, dryRun);
        } catch (err) {
          console.error(`[cron][${workspaceId}] digest error:`, err.message);
        }
      }));
    }

    if (channel.daily_digest_schedule) {
      const expr = scheduleStringToCron(channel.daily_digest_schedule);
      console.log(`[scheduler] daily digest workspace=${workspaceId} channel=${channel.id} expr=${expr}`);
      tasks.push(_cron.schedule(expr, async () => {
        console.log(`[cron][${workspaceId}] daily digest firing for channel ${channel.id}`);
        try {
          await runScheduledDigests(db, workspaceId, dryRun);
        } catch (err) {
          console.error(`[cron][${workspaceId}] daily digest error:`, err.message);
        }
      }));
    }
  }

  const changeExpr = '0 6-18/2 * * *';
  console.log(`[scheduler] change-detection workspace=${workspaceId} expr=${changeExpr}`);
  tasks.push(_cron.schedule(changeExpr, async () => {
    console.log(`[cron][${workspaceId}] change detection firing`);
    try {
      await runChangeDetection(db, workspaceId, dryRun);
    } catch (err) {
      console.error(`[cron][${workspaceId}] change detection error:`, err.message);
    }
  }));

  JOBS.set(workspaceId, tasks);
  console.log(`[scheduler] registered ${tasks.length} job(s) for workspace ${workspaceId}`);
}

/**
 * Schedule jobs for all active workspaces. Called at server startup.
 * @param {import('better-sqlite3').Database} db
 * @param {boolean} dryRun
 */
async function scheduleAllWorkspaces(db, dryRun) {
  const workspaces = listActiveWorkspaces(db);
  for (const ws of workspaces) {
    scheduleWorkspace(db, ws.team_id, dryRun);
  }
  console.log(`[scheduler] scheduled jobs for ${workspaces.length} workspace(s)`);
}

/**
 * Stop and remove all cron jobs for a workspace. No-op if not registered.
 * @param {string} workspaceId
 */
function unscheduleWorkspace(workspaceId) {
  const tasks = JOBS.get(workspaceId);
  if (tasks) {
    tasks.forEach(job => job.stop());
    JOBS.delete(workspaceId);
    console.log(`[scheduler] unscheduled workspace ${workspaceId}`);
  }
}

/**
 * Stop all jobs for all workspaces and clear the registry.
 */
function stopAll() {
  for (const tasks of JOBS.values()) {
    tasks.forEach(job => job.stop());
  }
  JOBS.clear();
  console.log('[scheduler] all jobs stopped');
}

module.exports = {
  scheduleStringToCron,
  scheduleWorkspace,
  scheduleAllWorkspaces,
  unscheduleWorkspace,
  stopAll,
  _setCronForTest,
  _jobCount
};
```

- [ ] **Step 4.4: Run registry tests — expect all pass**

```bash
NODE_ENV=test node --test test/scheduler-registry.test.js 2>&1 | grep -E "^# (tests|pass|fail)"
```

Expected: `# fail 0`

- [ ] **Step 4.5: Update `test/server.test.js` to import from `scheduler-registry.js`**

Change line 3 of `test/server.test.js`:

```javascript
// Before:
const { scheduleStringToCron } = require('../src/server.js');

// After:
const { scheduleStringToCron } = require('../src/scheduler-registry.js');
```

- [ ] **Step 4.6: Remove `scheduleStringToCron` from `src/server.js`**

In `src/server.js`:

1. Remove the `DAY_MAP` const at line 10.
2. Remove the entire `scheduleStringToCron` function (lines 22–40).
3. Add this import near the top (after the existing requires):
   ```javascript
   const { scheduleStringToCron } = require('./scheduler-registry.js');
   ```
4. Change `module.exports = { scheduleStringToCron };` at the bottom to:
   ```javascript
   module.exports = {};
   ```

- [ ] **Step 4.7: Run full test suite — no regressions**

```bash
NODE_ENV=test node --test test/*.test.js 2>&1 | grep -E "^# (tests|pass|fail)"
```

Expected: `# fail 0`

- [ ] **Step 4.8: Commit**

```bash
git add src/scheduler-registry.js test/scheduler-registry.test.js src/server.js test/server.test.js
git commit -m "feat: add scheduler-registry.js with multi-tenant cron registry  refs: #47"
```

---

### Task 5: events.js — Slack Events API handler with HMAC verification

**Files:**
- Create: `src/events.js`
- Create: `test/events.test.js`

- [ ] **Step 5.1: Write failing tests — create `test/events.test.js`**

```javascript
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.SLACK_SIGNING_SECRET = 'test-signing-secret';

const { test } = require('node:test');
const assert = require('node:assert');
const { createHmac } = require('node:crypto');
const { openDb, upsertWorkspaceFromOAuth, getWorkspace } = require('../src/db.js');
const { validateSlackEventsEnvVars, handleEventsRequest } = require('../src/events.js');

const SECRET = 'test-signing-secret';

function sign(timestamp, body) {
  return 'v0=' + createHmac('sha256', SECRET).update(`v0:${timestamp}:${body}`).digest('hex');
}

function freshTimestamp() {
  return Math.floor(Date.now() / 1000).toString();
}

function mockReq(method, url, headers, body) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body || {});
  const buf = Buffer.from(raw, 'utf8');
  return {
    method,
    url,
    headers: headers || {},
    on(event, cb) {
      if (event === 'data') cb(buf);
      if (event === 'end') cb();
      return this;
    }
  };
}

function mockRes() {
  const res = { _statusCode: null, _headers: {}, _body: '' };
  res.writeHead = (code, headers) => { res._statusCode = code; if (headers) Object.assign(res._headers, headers); };
  res.end = (body) => { res._body = body || ''; };
  return res;
}

function validReq(body) {
  const raw = JSON.stringify(body);
  const ts = freshTimestamp();
  return mockReq('POST', '/slack/events', {
    'x-slack-request-timestamp': ts,
    'x-slack-signature': sign(ts, raw)
  }, raw);
}

test('validateSlackEventsEnvVars throws when SLACK_SIGNING_SECRET missing', () => {
  const saved = process.env.SLACK_SIGNING_SECRET;
  delete process.env.SLACK_SIGNING_SECRET;
  try {
    assert.throws(() => validateSlackEventsEnvVars(), /SLACK_SIGNING_SECRET/);
  } finally {
    process.env.SLACK_SIGNING_SECRET = saved;
  }
});

test('validateSlackEventsEnvVars does not throw when secret is set', () => {
  assert.doesNotThrow(() => validateSlackEventsEnvVars());
});

test('handleEventsRequest returns false for non-POST', async () => {
  const db = openDb(':memory:');
  const res = mockRes();
  const handled = await handleEventsRequest(db, mockReq('GET', '/slack/events', {}, ''), res);
  assert.strictEqual(handled, false);
  db.close();
});

test('handleEventsRequest returns false for wrong path', async () => {
  const db = openDb(':memory:');
  const ts = freshTimestamp();
  const res = mockRes();
  const handled = await handleEventsRequest(db, mockReq('POST', '/other', { 'x-slack-request-timestamp': ts, 'x-slack-signature': 'v0=x' }, '{}'), res);
  assert.strictEqual(handled, false);
  db.close();
});

test('handleEventsRequest returns 403 for stale timestamp (>5 min)', async () => {
  const db = openDb(':memory:');
  const stale = (Math.floor(Date.now() / 1000) - 400).toString();
  const body = JSON.stringify({ type: 'url_verification', challenge: 'x' });
  const req = mockReq('POST', '/slack/events', {
    'x-slack-request-timestamp': stale,
    'x-slack-signature': sign(stale, body)
  }, body);
  const res = mockRes();
  await handleEventsRequest(db, req, res);
  assert.strictEqual(res._statusCode, 403);
  db.close();
});

test('handleEventsRequest returns 403 for invalid signature', async () => {
  const db = openDb(':memory:');
  const ts = freshTimestamp();
  const req = mockReq('POST', '/slack/events', {
    'x-slack-request-timestamp': ts,
    'x-slack-signature': 'v0=badhash'
  }, '{"type":"url_verification","challenge":"c"}');
  const res = mockRes();
  await handleEventsRequest(db, req, res);
  assert.strictEqual(res._statusCode, 403);
  db.close();
});

test('handleEventsRequest — url_verification responds with challenge', async () => {
  const db = openDb(':memory:');
  const res = mockRes();
  await handleEventsRequest(db, validReq({ type: 'url_verification', challenge: 'abc123' }), res);
  assert.strictEqual(res._statusCode, 200);
  assert.strictEqual(JSON.parse(res._body).challenge, 'abc123');
  db.close();
});

test('handleEventsRequest — app_uninstalled marks workspace inactive and calls onUninstall', async () => {
  const db = openDb(':memory:');
  upsertWorkspaceFromOAuth(db, { teamId: 'T_UNINSTALL', teamName: 'Gone', botToken: 'xoxb-x', installedBy: 'U1' });
  let uninstalledId = null;
  const onUninstall = (teamId) => { uninstalledId = teamId; };
  const res = mockRes();
  await handleEventsRequest(db, validReq({
    type: 'event_callback',
    team_id: 'T_UNINSTALL',
    event: { type: 'app_uninstalled' }
  }), res, onUninstall);
  assert.strictEqual(res._statusCode, 200);
  assert.strictEqual(uninstalledId, 'T_UNINSTALL');
  const row = db.prepare('SELECT active FROM workspaces WHERE team_id = ?').get('T_UNINSTALL');
  assert.strictEqual(row.active, 0);
  db.close();
});

test('handleEventsRequest — unknown event type returns 200, no side effects', async () => {
  const db = openDb(':memory:');
  const res = mockRes();
  await handleEventsRequest(db, validReq({ type: 'event_callback', team_id: 'T_X', event: { type: 'message' } }), res);
  assert.strictEqual(res._statusCode, 200);
  db.close();
});

test('handleEventsRequest — returns true for all POST /slack/events (route handled)', async () => {
  const db = openDb(':memory:');
  const res = mockRes();
  const handled = await handleEventsRequest(db, validReq({ type: 'event_callback', event: { type: 'message' } }), res);
  assert.strictEqual(handled, true);
  db.close();
});
```

- [ ] **Step 5.2: Run tests to verify they fail**

```bash
NODE_ENV=test node --test test/events.test.js 2>&1 | tail -5
```

Expected: `Error: Cannot find module '../src/events.js'`

- [ ] **Step 5.3: Create `src/events.js`**

```javascript
const { createHmac } = require('node:crypto');
const { markWorkspaceInactive } = require('./db.js');

/**
 * Throw if SLACK_SIGNING_SECRET is missing. Call at server startup.
 */
function validateSlackEventsEnvVars() {
  if (!process.env.SLACK_SIGNING_SECRET) {
    throw new Error('SLACK_SIGNING_SECRET environment variable is required');
  }
}

/**
 * Handle POST /slack/events. Returns true if the route was handled, false otherwise.
 * Verifies Slack HMAC signature and timestamp before processing any event.
 * @param {import('better-sqlite3').Database} db
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {((teamId: string) => void)|undefined} onUninstall
 * @returns {Promise<boolean>}
 */
async function handleEventsRequest(db, req, res, onUninstall) {
  if (req.method !== 'POST') return false;
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/slack/events') return false;

  const chunks = [];
  await new Promise((resolve, reject) => {
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', resolve);
    req.on('error', reject);
  });
  const rawBody = Buffer.concat(chunks).toString('utf8');

  const timestamp = req.headers['x-slack-request-timestamp'];
  const ageSecs = Math.abs(Date.now() / 1000 - parseInt(timestamp || '0', 10));
  if (!timestamp || ageSecs > 300) {
    res.writeHead(403);
    res.end();
    return true;
  }

  const expected = 'v0=' + createHmac('sha256', process.env.SLACK_SIGNING_SECRET)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest('hex');
  const provided = req.headers['x-slack-signature'];
  if (!provided || provided !== expected) {
    res.writeHead(403);
    res.end();
    return true;
  }

  const body = JSON.parse(rawBody);

  if (body.type === 'url_verification') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ challenge: body.challenge }));
    return true;
  }

  if (body.type === 'event_callback' && body.event && body.event.type === 'app_uninstalled') {
    markWorkspaceInactive(db, body.team_id);
    if (onUninstall) onUninstall(body.team_id);
    res.writeHead(200);
    res.end();
    return true;
  }

  res.writeHead(200);
  res.end();
  return true;
}

module.exports = { validateSlackEventsEnvVars, handleEventsRequest };
```

- [ ] **Step 5.4: Run events tests — expect all pass**

```bash
NODE_ENV=test node --test test/events.test.js 2>&1 | grep -E "^# (tests|pass|fail)"
```

Expected: `# fail 0`

- [ ] **Step 5.5: Run full test suite — no regressions**

```bash
NODE_ENV=test node --test test/*.test.js 2>&1 | grep -E "^# (tests|pass|fail)"
```

Expected: `# fail 0`

- [ ] **Step 5.6: Commit**

```bash
git add src/events.js test/events.test.js
git commit -m "feat: add events.js with Slack HMAC verification and app_uninstalled handler  refs: #47"
```

---

### Task 6: server.js — wire registry and events into the orchestrator

**Files:**
- Modify: `src/server.js`

This task has no new tests — server.js is an entry-point orchestrator. The integration is verified by running the existing test suite and the `scheduleStringToCron` import already tested in Task 4.

- [ ] **Step 6.1: Update imports in `src/server.js`**

Replace the entire import block at the top of `src/server.js` with:

```javascript
const http = require('node:http');
const path = require('node:path');
const { openDb } = require('./db.js');
const { validateEncryptionKey } = require('./crypto.js');
const { validateSlackEnvVars, handleOAuthRequest } = require('./oauth.js');
const { validateSlackEventsEnvVars, handleEventsRequest } = require('./events.js');
const registry = require('./scheduler-registry.js');
```

- [ ] **Step 6.2: Replace the `start()` function body in `src/server.js`**

Replace everything inside `async function start() {` ... `}` with:

```javascript
  validateEncryptionKey();
  validateSlackEnvVars();
  validateSlackEventsEnvVars();

  const dataDir = process.env.DATA_DIR;
  if (!dataDir) throw new Error('DATA_DIR environment variable not set');

  const db = openDb(path.join(dataDir, 'bot.db'));
  const dryRun = process.env.DRY_RUN === 'true';

  await registry.scheduleAllWorkspaces(db, dryRun);

  const onInstall = async (workspaceId) => {
    await registry.scheduleWorkspace(db, workspaceId, dryRun);
  };

  const onUninstall = (workspaceId) => {
    registry.unscheduleWorkspace(workspaceId);
  };

  const port = parseInt(process.env.PORT || '8080', 10);
  const httpServer = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } else if (await handleOAuthRequest(db, req, res, onInstall)) {
        // handled by oauth.js
      } else if (await handleEventsRequest(db, req, res, onUninstall)) {
        // handled by events.js
      } else {
        res.writeHead(404);
        res.end();
      }
    } catch (err) {
      console.error('[http] Unhandled error:', err.message);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end();
      }
    }
  });

  httpServer.listen(port, () => {
    console.log(`HTTP server listening on port ${port}`);
  });

  function shutdown() {
    console.log('Shutting down — stopping cron jobs');
    registry.stopAll();
    httpServer.close(() => {
      db.close();
      process.exit(0);
    });
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  console.log('Server started.');
```

- [ ] **Step 6.3: Ensure `module.exports` line is clean**

The bottom of `src/server.js` should be:

```javascript
if (require.main === module) {
  start().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = {};
```

- [ ] **Step 6.4: Run full test suite — no regressions**

```bash
NODE_ENV=test node --test test/*.test.js 2>&1 | grep -E "^# (tests|pass|fail)"
```

Expected: `# fail 0`

- [ ] **Step 6.5: Smoke-test that the module loads without crashing**

```bash
NODE_ENV=test node -e "require('./src/server.js')" 2>&1
```

Expected: no errors printed.

- [ ] **Step 6.6: Commit**

```bash
git add src/server.js
git commit -m "feat: wire scheduler-registry and events into server.js orchestrator  refs: #47"
```

---

## Self-Review

### Spec coverage check

| Spec requirement | Task |
|---|---|
| `scheduler-registry.js` — `Map<workspaceId, CronTask[]>` | Task 4 |
| `scheduleWorkspace`, `scheduleAllWorkspaces`, `unscheduleWorkspace`, `stopAll` | Task 4 |
| Idempotent re-install | Task 4 step 4.3 |
| Error isolation per workspace (try/catch in each handler) | Task 4 step 4.3 |
| `events.js` — `validateSlackEventsEnvVars`, `handleEventsRequest` | Task 5 |
| HMAC signature verification + replay protection | Task 5 |
| `url_verification` challenge response | Task 5 |
| `app_uninstalled` → `markWorkspaceInactive` + `onUninstall` | Task 5 |
| `server.js` — remove `WORKSPACE_ID` | Task 6 |
| `server.js` — `await registry.scheduleAllWorkspaces(db, dryRun)` at startup | Task 6 |
| `server.js` — `onInstall`/`onUninstall` callbacks wired | Task 6 |
| `server.js` — `registry.stopAll()` in shutdown | Task 6 |
| `runner.js` — new signature `(db, workspaceId, dryRun)` | Task 2 |
| `oauth.js` — optional `onInstall` callback | Task 3 |
| `db.js` — `markWorkspaceInactive` | Task 1 |
| `scheduleStringToCron` moved to `scheduler-registry.js` | Task 4 |
| New env var `SLACK_SIGNING_SECRET` validated at startup | Task 5 + Task 6 |
| `WORKSPACE_ID` env var removed | Task 6 |

All spec requirements covered. No gaps found.
