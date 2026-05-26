**Issue:** #27

# Slack Interactivity Handler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `POST /slack/interactions` endpoint with HMAC verification, block_actions/view_submission dispatch, and a concrete `config_edit_channel` flow for editing channel schedules via Slack modal.

**Architecture:** New `src/interactions.js` module following the handler pattern from `commands.js` (readAndVerify → parse → dispatch). An "Edit" button added to `/calendar config` output triggers `views.open`; modal submission validates schedule strings via `scheduleStringToCron` and persists changes via a new `updateChannelSchedule` DB function. An `onReschedule` callback from `server.js` triggers cron rescheduling after a successful save.

**Tech Stack:** Node.js (node:http, node:crypto), better-sqlite3, @slack/web-api (WebClient.views.open), node:test + node:assert.

---

### Task 1: updateChannelSchedule in db.js

**Files:**
- Modify: `src/db.js`
- Modify: `test/db.test.js`

- [ ] **Step 1: Add updateChannelSchedule to the import list in test/db.test.js**

Update the existing `require('../src/db.js')` line at the top of `test/db.test.js`:

```javascript
const { openDb, loadEvents, saveEvents, loadColor, saveColor, loadRunState, saveRunState, loadPending, savePending, getWorkspace, upsertWorkspace, updateChannelSchedule } = require('../src/db.js');
```

- [ ] **Step 2: Append 2 tests to test/db.test.js**

```javascript
test('updateChannelSchedule updates both schedule fields', () => {
  const db = memDb();
  upsertWorkspace(db, { teamId: 'T_SCHED', teamName: 'Sched WS' });
  db.prepare('INSERT INTO channels (workspace_id, channel_id, name, digest_schedule, daily_digest_schedule) VALUES (?,?,?,?,?)')
    .run('T_SCHED', 'C_SCHED', 'general', 'sunday 18:00', 'weekdays 09:00');

  updateChannelSchedule(db, 'T_SCHED', 'C_SCHED', 'monday 10:00', 'daily 08:00');

  const row = db.prepare('SELECT digest_schedule, daily_digest_schedule FROM channels WHERE workspace_id=? AND channel_id=?')
    .get('T_SCHED', 'C_SCHED');
  assert.strictEqual(row.digest_schedule, 'monday 10:00');
  assert.strictEqual(row.daily_digest_schedule, 'daily 08:00');
  db.close();
});

test('updateChannelSchedule stores null for empty string input', () => {
  const db = memDb();
  upsertWorkspace(db, { teamId: 'T_NULL', teamName: 'Null WS' });
  db.prepare('INSERT INTO channels (workspace_id, channel_id, name, digest_schedule, daily_digest_schedule) VALUES (?,?,?,?,?)')
    .run('T_NULL', 'C_NULL', 'test', 'sunday 18:00', 'weekdays 09:00');

  updateChannelSchedule(db, 'T_NULL', 'C_NULL', '', '');

  const row = db.prepare('SELECT digest_schedule, daily_digest_schedule FROM channels WHERE workspace_id=? AND channel_id=?')
    .get('T_NULL', 'C_NULL');
  assert.strictEqual(row.digest_schedule, null);
  assert.strictEqual(row.daily_digest_schedule, null);
  db.close();
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd /Users/olerummel/Documents/projects/slon/calendar-slack-bot
NODE_ENV=test node --test test/db.test.js
```

Expected: FAIL — `updateChannelSchedule is not a function`

- [ ] **Step 4: Add updateChannelSchedule to src/db.js**

Append after the `markWorkspaceInactive` function:

```javascript
/**
 * Update digest schedules for a channel.
 * @param {import('better-sqlite3').Database} db
 * @param {string} workspaceId
 * @param {string} channelId
 * @param {string|null} digestSchedule - weekly schedule string, or null to disable
 * @param {string|null} dailySchedule  - daily schedule string, or null to disable
 */
function updateChannelSchedule(db, workspaceId, channelId, digestSchedule, dailySchedule) {
  db.prepare(`
    UPDATE channels
    SET digest_schedule = ?, daily_digest_schedule = ?
    WHERE workspace_id = ? AND channel_id = ?
  `).run(digestSchedule || null, dailySchedule || null, workspaceId, channelId);
}
```

- [ ] **Step 5: Add updateChannelSchedule to module.exports in src/db.js**

Replace the existing `module.exports` block (currently ends with `markWorkspaceInactive`):

```javascript
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
  markWorkspaceInactive,
  updateChannelSchedule,
};
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
NODE_ENV=test node --test test/db.test.js
```

Expected: 2 new tests pass

- [ ] **Step 7: Run full suite to confirm no regressions**

```bash
NODE_ENV=test node --test test/*.test.js
```

Expected: 278 tests pass, 0 fail

- [ ] **Step 8: Commit**

```bash
git add src/db.js test/db.test.js
git commit -m "feat: add updateChannelSchedule to db.js refs: #27"
```

---

### Task 2: interactions.js skeleton — routing, HMAC, payload parse

**Files:**
- Create: `src/interactions.js`
- Create: `test/interactions.test.js`

- [ ] **Step 1: Create test/interactions.test.js**

```javascript
// test/interactions.test.js
'use strict';

process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.SLACK_SIGNING_SECRET = 'test-ix-secret';

const { test } = require('node:test');
const assert = require('node:assert');
const { createHmac } = require('node:crypto');
const { openDb, upsertWorkspaceFromOAuth } = require('../src/db.js');
const { handleInteractions, _setApiClientForTest } = require('../src/interactions.js');

const SECRET = 'test-ix-secret';

function sign(timestamp, body) {
  return 'v0=' + createHmac('sha256', SECRET).update(`v0:${timestamp}:${body}`).digest('hex');
}

function freshTs() {
  return Math.floor(Date.now() / 1000).toString();
}

function staleTs() {
  return String(Math.floor(Date.now() / 1000) - 400);
}

function makeReq(method, url, headers, body) {
  const buf = Buffer.from(typeof body === 'string' ? body : '', 'utf8');
  return {
    method, url,
    headers: headers || {},
    on(event, cb) {
      if (event === 'data') cb(buf);
      if (event === 'end') cb();
      return this;
    }
  };
}

function mockRes() {
  const res = { _statusCode: null, _body: '', _headers: {} };
  res.writeHead = (code, hdrs) => { res._statusCode = code; if (hdrs) Object.assign(res._headers, hdrs); };
  res.end = (body) => { res._body = body || ''; };
  return res;
}

function makeBody(payloadObj) {
  return new URLSearchParams({ payload: JSON.stringify(payloadObj) }).toString();
}

function makeSignedReq(payloadObj) {
  const body = makeBody(payloadObj);
  const ts = freshTs();
  return makeReq('POST', '/slack/interactions', {
    'x-slack-request-timestamp': ts,
    'x-slack-signature': sign(ts, body)
  }, body);
}

function makeDb() {
  const db = openDb(':memory:');
  upsertWorkspaceFromOAuth(db, { teamId: 'T123', teamName: 'Test WS', botToken: 'xoxb-test', installedBy: 'U1' });
  db.prepare('INSERT INTO channels (workspace_id, channel_id, name, digest_schedule, daily_digest_schedule) VALUES (?,?,?,?,?)')
    .run('T123', 'C456', 'general', 'sunday 18:00', 'weekdays 09:00');
  return db;
}

test('handleInteractions returns false for GET', async () => {
  const db = makeDb();
  const req = makeReq('GET', '/slack/interactions', {}, '');
  const res = mockRes();
  const result = await handleInteractions(db, req, res, null);
  assert.strictEqual(result, false);
  assert.strictEqual(res._statusCode, null);
  db.close();
});

test('handleInteractions returns false for wrong path', async () => {
  const db = makeDb();
  const req = makeReq('POST', '/slack/events', {}, '');
  const res = mockRes();
  const result = await handleInteractions(db, req, res, null);
  assert.strictEqual(result, false);
  db.close();
});

test('handleInteractions returns 403 for bad signature', async () => {
  const db = makeDb();
  const ts = freshTs();
  const req = makeReq('POST', '/slack/interactions', {
    'x-slack-request-timestamp': ts,
    'x-slack-signature': 'v0=badsig'
  }, 'payload={}');
  const res = mockRes();
  await handleInteractions(db, req, res, null);
  assert.strictEqual(res._statusCode, 403);
  db.close();
});

test('handleInteractions returns 403 for stale timestamp', async () => {
  const db = makeDb();
  const ts = staleTs();
  const body = makeBody({ type: 'block_actions', team: { id: 'T123' }, actions: [] });
  const req = makeReq('POST', '/slack/interactions', {
    'x-slack-request-timestamp': ts,
    'x-slack-signature': sign(ts, body)
  }, body);
  const res = mockRes();
  await handleInteractions(db, req, res, null);
  assert.strictEqual(res._statusCode, 403);
  db.close();
});

test('handleInteractions returns 400 for missing payload field', async () => {
  const db = makeDb();
  const body = 'not_payload=hello';
  const ts = freshTs();
  const req = makeReq('POST', '/slack/interactions', {
    'x-slack-request-timestamp': ts,
    'x-slack-signature': sign(ts, body)
  }, body);
  const res = mockRes();
  await handleInteractions(db, req, res, null);
  assert.strictEqual(res._statusCode, 400);
  db.close();
});

test('handleInteractions acks 200 for unknown workspace', async () => {
  const db = makeDb();
  const req = makeSignedReq({ type: 'block_actions', team: { id: 'T_UNKNOWN' }, trigger_id: 't1', actions: [] });
  const res = mockRes();
  await handleInteractions(db, req, res, null);
  assert.strictEqual(res._statusCode, 200);
  assert.strictEqual(res._body, '');
  db.close();
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
NODE_ENV=test node --test test/interactions.test.js
```

Expected: FAIL — `Cannot find module '../src/interactions.js'`

- [ ] **Step 3: Create src/interactions.js**

```javascript
'use strict';

const { WebClient } = require('@slack/web-api');
const { readAndVerify } = require('./slack-verify.js');
const { getWorkspace, updateChannelSchedule } = require('./db.js');
const { scheduleStringToCron } = require('./scheduler-registry.js');

let _apiClientFactory = (token) => new WebClient(token);

/**
 * Override the Slack API client factory for tests. Pass null to restore.
 * @param {Function|null} fn - factory: (token) => clientObject
 */
function _setApiClientForTest(fn) {
  _apiClientFactory = fn || ((token) => new WebClient(token));
}

/**
 * Throw if SLACK_SIGNING_SECRET is missing. Call at server startup.
 */
function validateInteractionsEnvVars() {
  if (!process.env.SLACK_SIGNING_SECRET) {
    throw new Error('SLACK_SIGNING_SECRET environment variable is required');
  }
}

function ackEmpty(res) {
  res.writeHead(200);
  res.end();
}

function ackJson(res, body) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function handleConfigEditAction(db, workspace, action, triggerId, res) {
  ackEmpty(res);
}

async function handleConfigEditSubmit(db, payload, onReschedule, res) {
  ackEmpty(res);
}

/**
 * Handle POST /slack/interactions. Returns true if handled, false otherwise.
 * Verifies Slack HMAC signature, parses payload JSON from URLSearchParams, dispatches by type.
 * @param {import('better-sqlite3').Database} db
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {((workspaceId: string) => Promise<void>)|undefined} onReschedule
 * @returns {Promise<boolean>}
 */
async function handleInteractions(db, req, res, onReschedule) {
  if (req.method !== 'POST') return false;
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/slack/interactions') return false;

  let rawBody;
  try {
    ({ rawBody } = await readAndVerify(req, process.env.SLACK_SIGNING_SECRET));
  } catch (err) {
    res.writeHead(err.statusCode || 500);
    res.end();
    return true;
  }

  let payload;
  try {
    const raw = new URLSearchParams(rawBody).get('payload');
    if (!raw) throw new Error('missing payload field');
    payload = JSON.parse(raw);
  } catch {
    res.writeHead(400);
    res.end();
    return true;
  }

  const workspace = getWorkspace(db, payload.team?.id);
  if (!workspace) {
    ackEmpty(res);
    return true;
  }

  if (payload.type === 'block_actions') {
    for (const action of (payload.actions || [])) {
      if (action.action_id === 'config_edit_channel') {
        await handleConfigEditAction(db, workspace, action, payload.trigger_id, res);
        return true;
      }
    }
    ackEmpty(res);
    return true;
  }

  if (payload.type === 'view_submission') {
    if (payload.view?.callback_id === 'config_edit_channel') {
      await handleConfigEditSubmit(db, payload, onReschedule, res);
      return true;
    }
    ackEmpty(res);
    return true;
  }

  ackEmpty(res);
  return true;
}

module.exports = { validateInteractionsEnvVars, handleInteractions, _setApiClientForTest };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
NODE_ENV=test node --test test/interactions.test.js
```

Expected: 6 tests pass

- [ ] **Step 5: Run full suite**

```bash
NODE_ENV=test node --test test/*.test.js
```

Expected: 284 tests pass, 0 fail

- [ ] **Step 6: Commit**

```bash
git add src/interactions.js test/interactions.test.js
git commit -m "feat: add interactions.js skeleton with routing and HMAC refs: #27"
```

---

### Task 3: block_actions handler — views.open

**Files:**
- Modify: `src/interactions.js` (implement handleConfigEditAction)
- Modify: `test/interactions.test.js` (append 2 tests)

- [ ] **Step 1: Append 2 block_actions tests to test/interactions.test.js**

```javascript
test('block_actions config_edit_channel calls views.open with correct args', async () => {
  const db = makeDb();
  const viewsCalls = [];
  _setApiClientForTest(() => ({
    views: { open: async (args) => { viewsCalls.push(args); return {}; } }
  }));

  const req = makeSignedReq({
    type: 'block_actions',
    team: { id: 'T123' },
    trigger_id: 'trigger-abc',
    actions: [{ action_id: 'config_edit_channel', value: 'C456' }]
  });
  const res = mockRes();

  await handleInteractions(db, req, res, null);

  assert.strictEqual(res._statusCode, 200);
  assert.strictEqual(viewsCalls.length, 1);
  assert.strictEqual(viewsCalls[0].trigger_id, 'trigger-abc');
  assert.strictEqual(viewsCalls[0].view.callback_id, 'config_edit_channel');
  const meta = JSON.parse(viewsCalls[0].view.private_metadata);
  assert.strictEqual(meta.channelId, 'C456');
  assert.strictEqual(meta.workspaceId, 'T123');

  _setApiClientForTest(null);
  db.close();
});

test('block_actions with unknown action_id acks 200 without calling views.open', async () => {
  const db = makeDb();
  const viewsCalls = [];
  _setApiClientForTest(() => ({
    views: { open: async (args) => { viewsCalls.push(args); return {}; } }
  }));

  const req = makeSignedReq({
    type: 'block_actions',
    team: { id: 'T123' },
    trigger_id: 'trigger-xyz',
    actions: [{ action_id: 'some_other_action', value: 'whatever' }]
  });
  const res = mockRes();

  await handleInteractions(db, req, res, null);

  assert.strictEqual(res._statusCode, 200);
  assert.strictEqual(viewsCalls.length, 0);

  _setApiClientForTest(null);
  db.close();
});
```

- [ ] **Step 2: Run tests to verify new tests fail**

```bash
NODE_ENV=test node --test test/interactions.test.js
```

Expected: 2 new tests fail — `views.open` not called (stub just acks empty)

- [ ] **Step 3: Replace handleConfigEditAction stub in src/interactions.js**

Replace the existing `async function handleConfigEditAction(db, workspace, action, triggerId, res) { ackEmpty(res); }` with:

```javascript
async function handleConfigEditAction(db, workspace, action, triggerId, res) {
  const channelId = action.value;
  const row = db.prepare(
    'SELECT digest_schedule, daily_digest_schedule, name FROM channels WHERE workspace_id = ? AND channel_id = ?'
  ).get(workspace.team_id, channelId);

  const label = row?.name ? `#${row.name}` : channelId;

  const view = {
    type: 'modal',
    callback_id: 'config_edit_channel',
    private_metadata: JSON.stringify({ workspaceId: workspace.team_id, channelId }),
    title: { type: 'plain_text', text: 'Edit Channel Schedule' },
    submit: { type: 'plain_text', text: 'Save' },
    close:  { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${label}*` }
      },
      {
        type: 'input',
        block_id: 'digest_schedule_block',
        optional: true,
        label: { type: 'plain_text', text: 'Weekly digest schedule' },
        hint:  { type: 'plain_text', text: 'e.g. "sunday 18:00" or "monday 09:00" — leave blank to disable' },
        element: {
          type: 'plain_text_input',
          action_id: 'digest_schedule_input',
          initial_value: row?.digest_schedule || ''
        }
      },
      {
        type: 'input',
        block_id: 'daily_schedule_block',
        optional: true,
        label: { type: 'plain_text', text: 'Daily digest schedule' },
        hint:  { type: 'plain_text', text: 'e.g. "weekdays 09:00" — leave blank to disable' },
        element: {
          type: 'plain_text_input',
          action_id: 'daily_schedule_input',
          initial_value: row?.daily_digest_schedule || ''
        }
      }
    ]
  };

  try {
    const client = _apiClientFactory(workspace.bot_token);
    await client.views.open({ trigger_id: triggerId, view });
  } catch (err) {
    console.error('[interactions] views.open failed:', err.message);
  }

  ackEmpty(res);
}
```

- [ ] **Step 4: Run tests to verify all pass**

```bash
NODE_ENV=test node --test test/interactions.test.js
```

Expected: 8 tests pass

- [ ] **Step 5: Run full suite**

```bash
NODE_ENV=test node --test test/*.test.js
```

Expected: 286 tests pass, 0 fail

- [ ] **Step 6: Commit**

```bash
git add src/interactions.js test/interactions.test.js
git commit -m "feat: add block_actions handler to interactions.js refs: #27"
```

---

### Task 4: view_submission handler — validate, save, reschedule

**Files:**
- Modify: `src/interactions.js` (implement handleConfigEditSubmit)
- Modify: `test/interactions.test.js` (append 4 tests)

- [ ] **Step 1: Append 4 view_submission tests to test/interactions.test.js**

```javascript
test('view_submission config_edit_channel updates DB and calls onReschedule', async () => {
  const db = makeDb();
  let rescheduledId = null;
  const onReschedule = async (wid) => { rescheduledId = wid; };

  const req = makeSignedReq({
    type: 'view_submission',
    team: { id: 'T123' },
    view: {
      callback_id: 'config_edit_channel',
      private_metadata: JSON.stringify({ workspaceId: 'T123', channelId: 'C456' }),
      state: {
        values: {
          digest_schedule_block: { digest_schedule_input: { value: 'monday 10:00' } },
          daily_schedule_block:  { daily_schedule_input:  { value: 'weekdays 08:00' } }
        }
      }
    }
  });
  const res = mockRes();

  await handleInteractions(db, req, res, onReschedule);

  assert.strictEqual(res._statusCode, 200);
  assert.strictEqual(res._body, '');
  const row = db.prepare('SELECT digest_schedule, daily_digest_schedule FROM channels WHERE workspace_id=? AND channel_id=?')
    .get('T123', 'C456');
  assert.strictEqual(row.digest_schedule, 'monday 10:00');
  assert.strictEqual(row.daily_digest_schedule, 'weekdays 08:00');
  assert.strictEqual(rescheduledId, 'T123');
  db.close();
});

test('view_submission with invalid schedule returns inline errors and does not update DB', async () => {
  const db = makeDb();

  const req = makeSignedReq({
    type: 'view_submission',
    team: { id: 'T123' },
    view: {
      callback_id: 'config_edit_channel',
      private_metadata: JSON.stringify({ workspaceId: 'T123', channelId: 'C456' }),
      state: {
        values: {
          digest_schedule_block: { digest_schedule_input: { value: 'not-a-schedule' } },
          daily_schedule_block:  { daily_schedule_input:  { value: '' } }
        }
      }
    }
  });
  const res = mockRes();

  await handleInteractions(db, req, res, null);

  assert.strictEqual(res._statusCode, 200);
  const parsed = JSON.parse(res._body);
  assert.strictEqual(parsed.response_action, 'errors');
  assert.ok(parsed.errors.digest_schedule_block, 'expected error for digest_schedule_block');
  const row = db.prepare('SELECT digest_schedule FROM channels WHERE workspace_id=? AND channel_id=?')
    .get('T123', 'C456');
  assert.strictEqual(row.digest_schedule, 'sunday 18:00'); // unchanged
  db.close();
});

test('view_submission with blank schedules stores null in DB', async () => {
  const db = makeDb();

  const req = makeSignedReq({
    type: 'view_submission',
    team: { id: 'T123' },
    view: {
      callback_id: 'config_edit_channel',
      private_metadata: JSON.stringify({ workspaceId: 'T123', channelId: 'C456' }),
      state: {
        values: {
          digest_schedule_block: { digest_schedule_input: { value: '' } },
          daily_schedule_block:  { daily_schedule_input:  { value: '' } }
        }
      }
    }
  });
  const res = mockRes();

  await handleInteractions(db, req, res, null);

  assert.strictEqual(res._statusCode, 200);
  const row = db.prepare('SELECT digest_schedule, daily_digest_schedule FROM channels WHERE workspace_id=? AND channel_id=?')
    .get('T123', 'C456');
  assert.strictEqual(row.digest_schedule, null);
  assert.strictEqual(row.daily_digest_schedule, null);
  db.close();
});

test('view_submission with unknown callback_id acks 200 empty', async () => {
  const db = makeDb();

  const req = makeSignedReq({
    type: 'view_submission',
    team: { id: 'T123' },
    view: { callback_id: 'something_else', private_metadata: '{}', state: { values: {} } }
  });
  const res = mockRes();

  await handleInteractions(db, req, res, null);

  assert.strictEqual(res._statusCode, 200);
  assert.strictEqual(res._body, '');
  db.close();
});
```

- [ ] **Step 2: Run tests to verify new tests fail**

```bash
NODE_ENV=test node --test test/interactions.test.js
```

Expected: 4 new tests fail (stub always acks empty, no validation or DB write)

- [ ] **Step 3: Replace handleConfigEditSubmit stub in src/interactions.js**

Replace the existing `async function handleConfigEditSubmit(db, payload, onReschedule, res) { ackEmpty(res); }` with:

```javascript
async function handleConfigEditSubmit(db, payload, onReschedule, res) {
  let workspaceId, channelId;
  try {
    ({ workspaceId, channelId } = JSON.parse(payload.view.private_metadata));
  } catch {
    ackEmpty(res);
    return;
  }

  const values = payload.view.state.values;
  const digestSchedule = values.digest_schedule_block?.digest_schedule_input?.value?.trim() || '';
  const dailySchedule  = values.daily_schedule_block?.daily_schedule_input?.value?.trim()  || '';

  const errors = {};
  if (digestSchedule) {
    try { scheduleStringToCron(digestSchedule); } catch {
      errors.digest_schedule_block = 'Invalid schedule format. Use e.g. "sunday 18:00" or leave blank to disable.';
    }
  }
  if (dailySchedule) {
    try { scheduleStringToCron(dailySchedule); } catch {
      errors.daily_schedule_block = 'Invalid schedule format. Use e.g. "weekdays 09:00" or leave blank to disable.';
    }
  }

  if (Object.keys(errors).length > 0) {
    ackJson(res, { response_action: 'errors', errors });
    return;
  }

  try {
    updateChannelSchedule(db, workspaceId, channelId, digestSchedule || null, dailySchedule || null);
  } catch (err) {
    console.error('[interactions] DB update failed:', err.message);
    ackEmpty(res);
    return;
  }

  if (onReschedule) {
    try { await onReschedule(workspaceId); } catch (err) {
      console.error('[interactions] onReschedule failed:', err.message);
    }
  }

  ackEmpty(res);
}
```

- [ ] **Step 4: Run tests to verify all pass**

```bash
NODE_ENV=test node --test test/interactions.test.js
```

Expected: 12 tests pass

- [ ] **Step 5: Run full suite**

```bash
NODE_ENV=test node --test test/*.test.js
```

Expected: 290 tests pass, 0 fail

- [ ] **Step 6: Commit**

```bash
git add src/interactions.js test/interactions.test.js
git commit -m "feat: add view_submission handler to interactions.js refs: #27"
```

---

### Task 5: Add "Edit" button to /calendar config

**Files:**
- Modify: `src/commands.js`
- Modify: `test/commands.test.js`

- [ ] **Step 1: Append Edit button test to test/commands.test.js**

```javascript
test('/calendar config includes Edit button accessory on each channel block', async () => {
  const db = openDb(':memory:');
  const { seedWorkspace } = require('../src/config.js');
  seedWorkspace(db, 'T_BTN', {
    locale: 'en-US',
    caldav_credentials: { username: 'user', password: 'pass' },
    calendars: { 'CAL1': { name: 'Work Calendar', caldav_url: 'https://nc.example.com/cal' } },
    channels: [{
      id: 'C_BTN', name: 'btn-test', canvas_id: 'CV_B',
      digest_schedule: 'monday 09:00', daily_digest_schedule: false,
      show_empty_days: false, calendars: ['CAL1']
    }]
  });

  const res = mockRes();
  await handleSlashCommand(db, makeValidReq('config', 'T_BTN'), res);

  assert.strictEqual(res._statusCode, 200);
  const payload = JSON.parse(res._body);
  const sectionWithAccessory = payload.blocks.find(b => b.type === 'section' && b.accessory);
  assert.ok(sectionWithAccessory, 'expected a section block with an accessory button');
  assert.strictEqual(sectionWithAccessory.accessory.type, 'button');
  assert.strictEqual(sectionWithAccessory.accessory.action_id, 'config_edit_channel');
  assert.strictEqual(sectionWithAccessory.accessory.value, 'C_BTN');
  db.close();
});
```

- [ ] **Step 2: Run the new test to verify it fails**

```bash
NODE_ENV=test node --test test/commands.test.js
```

Expected: new test fails — no `accessory` property on section blocks yet

- [ ] **Step 3: Update subConfig in src/commands.js**

In `subConfig`, find the block push inside the `for` loop. It currently looks like:

```javascript
blocks.push({
  type: 'section',
  text: {
    type: 'mrkdwn',
    text: `*${label}*\nDigest: \`${ch.digest_schedule || 'disabled'}\`\nDaily: \`${ch.daily_digest_schedule || 'disabled'}\`\nCalendars: ${calNames}`
  }
});
```

Replace with:

```javascript
blocks.push({
  type: 'section',
  text: {
    type: 'mrkdwn',
    text: `*${label}*\nDigest: \`${ch.digest_schedule || 'disabled'}\`\nDaily: \`${ch.daily_digest_schedule || 'disabled'}\`\nCalendars: ${calNames}`
  },
  accessory: {
    type: 'button',
    text: { type: 'plain_text', text: 'Edit' },
    action_id: 'config_edit_channel',
    value: ch.id
  }
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
NODE_ENV=test node --test test/commands.test.js
```

Expected: all commands tests pass

- [ ] **Step 5: Run full suite**

```bash
NODE_ENV=test node --test test/*.test.js
```

Expected: 291 tests pass, 0 fail

- [ ] **Step 6: Commit**

```bash
git add src/commands.js test/commands.test.js
git commit -m "feat: add Edit button to /calendar config subcommand refs: #27"
```

---

### Task 6: Wire interactions handler into server.js

**Files:**
- Modify: `src/server.js`

No new tests — covered by existing `test/server.test.js` and the full suite.

- [ ] **Step 1: Add import to src/server.js**

After the `handleSlashCommand` require, add:

```javascript
const { validateInteractionsEnvVars, handleInteractions } = require('./interactions.js');
```

The top of `server.js` becomes:

```javascript
const http = require('node:http');
const path = require('node:path');
const { openDb } = require('./db.js');
const { validateEncryptionKey } = require('./crypto.js');
const { validateSlackEnvVars, handleOAuthRequest } = require('./oauth.js');
const { validateSlackEventsEnvVars, handleEventsRequest } = require('./events.js');
const { validateSlackCommandsEnvVars, handleSlashCommand } = require('./commands.js');
const { validateInteractionsEnvVars, handleInteractions } = require('./interactions.js');
const registry = require('./scheduler-registry.js');
```

- [ ] **Step 2: Add validateInteractionsEnvVars() call in start()**

After `validateSlackCommandsEnvVars();`:

```javascript
validateInteractionsEnvVars();
```

The startup block becomes:

```javascript
async function start() {
  validateEncryptionKey();
  validateSlackEnvVars();
  validateSlackEventsEnvVars();
  validateSlackCommandsEnvVars();
  validateInteractionsEnvVars();

  const dataDir = process.env.DATA_DIR;
```

- [ ] **Step 3: Add onReschedule callback in start()**

After the `onUninstall` definition, add:

```javascript
const onReschedule = async (workspaceId) => {
  await registry.scheduleWorkspace(db, workspaceId, dryRun);
};
```

- [ ] **Step 4: Add handleInteractions route in the HTTP handler**

After `handleSlashCommand`, before the `404` branch:

```javascript
} else if (await handleSlashCommand(db, req, res)) {
  // handled by commands.js
} else if (await handleInteractions(db, req, res, onReschedule)) {
  // handled by interactions.js
} else {
  res.writeHead(404);
  res.end();
}
```

- [ ] **Step 5: Run full test suite**

```bash
NODE_ENV=test node --test test/*.test.js
```

Expected: 291 tests pass, 0 fail

- [ ] **Step 6: Commit**

```bash
git add src/server.js
git commit -m "feat: wire interactions handler into server.js refs: #27"
```
