**Issue:** #26

# Slack Slash Command Handler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `POST /slack/commands` to handle `/calendar` subcommands, extracting shared HMAC verification into `src/slack-verify.js` so both endpoints share one tested code path.

**Architecture:** Four sequential tasks. Task 1 creates the shared verifier. Task 2 refactors `events.js` to use it (all existing tests must stay green). Task 3 builds the slash command handler with four subcommands. Task 4 wires it into `server.js`. Each task is independently committed.

**Tech Stack:** Node.js built-ins (`node:crypto`, `node:https`, `node:test`, `node:assert`), `better-sqlite3`, existing `src/db.js` / `src/config.js` / `src/runner.js`.

---

### Task 1: Shared HMAC Verification (src/slack-verify.js)

**Blocked by:** nothing — implement first.

**Files:**
- Create: `test/slack-verify.test.js`
- Create: `src/slack-verify.js`

- [ ] **Step 1: Write the failing tests**

Create `test/slack-verify.test.js`:

```javascript
process.env.ENCRYPTION_KEY = '0'.repeat(64);

const { test } = require('node:test');
const assert = require('node:assert');
const { createHmac } = require('node:crypto');
const { verifySlackRequest, readAndVerify } = require('../src/slack-verify.js');

const SECRET = 'test-secret';

function sign(timestamp, body) {
  return 'v0=' + createHmac('sha256', SECRET).update(`v0:${timestamp}:${body}`).digest('hex');
}

function freshTimestamp() {
  return Math.floor(Date.now() / 1000).toString();
}

function mockReq(headers, body) {
  const raw = typeof body === 'string' ? body : '';
  const buf = Buffer.from(raw, 'utf8');
  return {
    headers: headers || {},
    on(event, cb) {
      if (event === 'data') cb(buf);
      if (event === 'end') cb();
      return this;
    }
  };
}

test('verifySlackRequest returns true for valid signature', () => {
  const ts = freshTimestamp();
  const body = 'command=%2Fcalendar&text=help';
  assert.strictEqual(verifySlackRequest(body, ts, sign(ts, body), SECRET), true);
});

test('verifySlackRequest returns false for tampered body', () => {
  const ts = freshTimestamp();
  const body = 'command=%2Fcalendar&text=help';
  assert.strictEqual(verifySlackRequest('tampered', ts, sign(ts, body), SECRET), false);
});

test('readAndVerify returns rawBody and parsedBody for valid request', async () => {
  const body = 'command=%2Fcalendar&text=help&team_id=T123';
  const ts = freshTimestamp();
  const { rawBody, parsedBody } = await readAndVerify(mockReq({
    'x-slack-request-timestamp': ts,
    'x-slack-signature': sign(ts, body)
  }, body), SECRET);
  assert.strictEqual(rawBody, body);
  assert.strictEqual(parsedBody.command, '/calendar');
  assert.strictEqual(parsedBody.team_id, 'T123');
});

test('readAndVerify throws { statusCode: 403 } for stale timestamp', async () => {
  const stale = (Math.floor(Date.now() / 1000) - 400).toString();
  const body = 'command=%2Fcalendar';
  await assert.rejects(
    () => readAndVerify(mockReq({ 'x-slack-request-timestamp': stale, 'x-slack-signature': sign(stale, body) }, body), SECRET),
    err => err.statusCode === 403
  );
});

test('readAndVerify throws { statusCode: 403 } for wrong signature', async () => {
  const ts = freshTimestamp();
  await assert.rejects(
    () => readAndVerify(mockReq({ 'x-slack-request-timestamp': ts, 'x-slack-signature': 'v0=badhash' }, 'command=%2Fcalendar'), SECRET),
    err => err.statusCode === 403
  );
});

test('readAndVerify throws { statusCode: 403 } for missing timestamp header', async () => {
  await assert.rejects(
    () => readAndVerify(mockReq({ 'x-slack-signature': 'v0=whatever' }, 'command=%2Fcalendar'), SECRET),
    err => err.statusCode === 403
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
NODE_ENV=test node --test test/slack-verify.test.js
```

Expected: 6 failures with `Cannot find module '../src/slack-verify.js'`.

- [ ] **Step 3: Implement src/slack-verify.js**

Create `src/slack-verify.js`:

```javascript
const { createHmac } = require('node:crypto');

/**
 * Verify a Slack request HMAC signature (pure, synchronous).
 * @param {string} rawBody
 * @param {string} timestamp
 * @param {string} signature - value of x-slack-signature header
 * @param {string} secret - SLACK_SIGNING_SECRET
 * @returns {boolean}
 */
function verifySlackRequest(rawBody, timestamp, signature, secret) {
  const expected = 'v0=' + createHmac('sha256', secret)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest('hex');
  return signature === expected;
}

/**
 * Read raw HTTP request body, verify Slack timestamp (≤300 s) and HMAC signature.
 * Returns { rawBody, parsedBody } where parsedBody is URL-decoded (for slash commands).
 * Events handlers should use rawBody and JSON.parse themselves.
 * Throws { statusCode: 403 } on any verification failure.
 * @param {import('http').IncomingMessage} req
 * @param {string} secret - SLACK_SIGNING_SECRET
 * @returns {Promise<{rawBody: string, parsedBody: Object}>}
 */
async function readAndVerify(req, secret) {
  const chunks = [];
  await new Promise((resolve, reject) => {
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', resolve);
    req.on('error', reject);
  });
  const rawBody = Buffer.concat(chunks).toString('utf8');

  const timestamp = req.headers['x-slack-request-timestamp'];
  const ageSecs = Math.abs(Date.now() / 1000 - parseInt(timestamp || '0', 10));
  if (!timestamp || ageSecs > 300) throw { statusCode: 403 };

  const signature = req.headers['x-slack-signature'];
  if (!signature || !verifySlackRequest(rawBody, timestamp, signature, secret)) {
    throw { statusCode: 403 };
  }

  const parsedBody = Object.fromEntries(new URLSearchParams(rawBody));
  return { rawBody, parsedBody };
}

module.exports = { verifySlackRequest, readAndVerify };
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
NODE_ENV=test node --test test/slack-verify.test.js
```

Expected: `pass 6, fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/slack-verify.js test/slack-verify.test.js
git commit -m "feat: add shared Slack HMAC verification module refs: #26"
```

---

### Task 2: Refactor events.js to Use slack-verify.js

**Blocked by:** Task 1.

**Files:**
- Modify: `src/events.js`

- [ ] **Step 1: Replace the inline verification block in events.js**

Open `src/events.js`. The current file has a `createHmac` import and an inline 20-line verification block inside `handleEventsRequest`. Replace the entire file with:

```javascript
const { readAndVerify } = require('./slack-verify.js');
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

  let rawBody;
  try {
    ({ rawBody } = await readAndVerify(req, process.env.SLACK_SIGNING_SECRET));
  } catch (err) {
    res.writeHead(err.statusCode || 500);
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

- [ ] **Step 2: Run the existing events tests to verify they still pass**

```bash
NODE_ENV=test node --test test/events.test.js
```

Expected: `pass 10, fail 0`. All 10 tests green — behavior is identical, just extracted.

- [ ] **Step 3: Run the full test suite to check nothing regressed**

```bash
NODE_ENV=test node --test test/*.test.js
```

Expected: `pass 264, fail 0` (258 previous + 6 new slack-verify tests).

- [ ] **Step 4: Commit**

```bash
git add src/events.js
git commit -m "refactor: extract HMAC verification from events.js into slack-verify.js refs: #26"
```

---

### Task 3: Slash Command Handler (src/commands.js)

**Blocked by:** Task 1.

**Files:**
- Create: `test/commands.test.js`
- Create: `src/commands.js`

- [ ] **Step 1: Write the failing tests**

Create `test/commands.test.js`:

```javascript
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.SLACK_SIGNING_SECRET = 'test-cmd-secret';

const { test } = require('node:test');
const assert = require('node:assert');
const { createHmac } = require('node:crypto');
const { openDb, upsertWorkspaceFromOAuth, saveRunState } = require('../src/db.js');
const { seedWorkspace } = require('../src/config.js');
const { validateSlackCommandsEnvVars, handleSlashCommand, _setRunnerForTest } = require('../src/commands.js');

const SECRET = 'test-cmd-secret';

function sign(timestamp, body) {
  return 'v0=' + createHmac('sha256', SECRET).update(`v0:${timestamp}:${body}`).digest('hex');
}

function freshTimestamp() {
  return Math.floor(Date.now() / 1000).toString();
}

function makeReq(method, url, headers, body) {
  const raw = typeof body === 'string' ? body : '';
  const buf = Buffer.from(raw, 'utf8');
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
  const res = { _statusCode: null, _headers: {}, _body: '' };
  res.writeHead = (code, headers) => { res._statusCode = code; if (headers) Object.assign(res._headers, headers); };
  res.end = (body) => { res._body = body || ''; };
  return res;
}

function makeValidReq(subcommand, teamId = 'T_TEST', responseUrl = 'https://hooks.slack.com/ack') {
  const body = new URLSearchParams({
    command: '/calendar',
    text: subcommand,
    team_id: teamId,
    response_url: responseUrl
  }).toString();
  const ts = freshTimestamp();
  return makeReq('POST', '/slack/commands', {
    'x-slack-request-timestamp': ts,
    'x-slack-signature': sign(ts, body)
  }, body);
}

test('validateSlackCommandsEnvVars throws when SLACK_SIGNING_SECRET missing', () => {
  const saved = process.env.SLACK_SIGNING_SECRET;
  delete process.env.SLACK_SIGNING_SECRET;
  try {
    assert.throws(() => validateSlackCommandsEnvVars(), /SLACK_SIGNING_SECRET/);
  } finally {
    process.env.SLACK_SIGNING_SECRET = saved;
  }
});

test('handleSlashCommand returns false for non-POST', async () => {
  const db = openDb(':memory:');
  const res = mockRes();
  const handled = await handleSlashCommand(db, makeReq('GET', '/slack/commands', {}, ''), res);
  assert.strictEqual(handled, false);
  db.close();
});

test('handleSlashCommand returns false for wrong path', async () => {
  const db = openDb(':memory:');
  const ts = freshTimestamp();
  const body = 'command=%2Fcalendar&text=help';
  const res = mockRes();
  const handled = await handleSlashCommand(db, makeReq('POST', '/slack/events', {
    'x-slack-request-timestamp': ts,
    'x-slack-signature': sign(ts, body)
  }, body), res);
  assert.strictEqual(handled, false);
  db.close();
});

test('handleSlashCommand returns 403 for bad signature', async () => {
  const db = openDb(':memory:');
  const ts = freshTimestamp();
  const res = mockRes();
  await handleSlashCommand(db, makeReq('POST', '/slack/commands', {
    'x-slack-request-timestamp': ts,
    'x-slack-signature': 'v0=badhash'
  }, 'command=%2Fcalendar&text=help&team_id=T_X'), res);
  assert.strictEqual(res._statusCode, 403);
  db.close();
});

test('handleSlashCommand returns 200 ephemeral for unknown workspace', async () => {
  const db = openDb(':memory:');
  const res = mockRes();
  await handleSlashCommand(db, makeValidReq('help', 'T_UNKNOWN'), res);
  assert.strictEqual(res._statusCode, 200);
  assert.ok(JSON.parse(res._body).text.includes('not configured'));
  db.close();
});

test('/calendar help returns all four command names', async () => {
  const db = openDb(':memory:');
  upsertWorkspaceFromOAuth(db, { teamId: 'T_HELP', teamName: 'Help WS', botToken: 'xoxb-h', installedBy: 'U1' });
  const res = mockRes();
  await handleSlashCommand(db, makeValidReq('help', 'T_HELP'), res);
  assert.strictEqual(res._statusCode, 200);
  const payload = JSON.parse(res._body);
  assert.strictEqual(payload.response_type, 'ephemeral');
  const text = payload.blocks[0].text.text;
  assert.ok(text.includes('/calendar help'));
  assert.ok(text.includes('/calendar config'));
  assert.ok(text.includes('/calendar status'));
  assert.ok(text.includes('/calendar refresh'));
  db.close();
});

test('/calendar config returns channel schedule and calendar info', async () => {
  const db = openDb(':memory:');
  seedWorkspace(db, 'T_CONFIG', {
    locale: 'en-US',
    caldav_credentials: { username: 'user', password: 'pass' },
    calendars: { 'CAL1': { name: 'Team Calendar', caldav_url: 'https://nc.example.com/cal' } },
    channels: [{
      id: 'C_GENERAL', name: 'general', canvas_id: 'CV_G',
      digest_schedule: 'monday 09:00', daily_digest_schedule: false,
      show_empty_days: false, calendars: ['CAL1']
    }]
  });
  const res = mockRes();
  await handleSlashCommand(db, makeValidReq('config', 'T_CONFIG'), res);
  assert.strictEqual(res._statusCode, 200);
  const payload = JSON.parse(res._body);
  assert.strictEqual(payload.response_type, 'ephemeral');
  const texts = payload.blocks.map(b => b.text?.text || '').join(' ');
  assert.ok(texts.includes('general'));
  assert.ok(texts.includes('monday 09:00'));
  assert.ok(texts.includes('Team Calendar'));
  db.close();
});

test('/calendar status returns last run timestamps', async () => {
  const db = openDb(':memory:');
  upsertWorkspaceFromOAuth(db, { teamId: 'T_STATUS', teamName: 'Status WS', botToken: 'xoxb-s', installedBy: 'U1' });
  db.prepare('INSERT INTO channels (workspace_id, channel_id, name, canvas_id, show_empty_days) VALUES (?, ?, ?, ?, 0)')
    .run('T_STATUS', 'C_S1', 'statuschan', 'CV_S');
  saveRunState(db, 'T_STATUS', 'C_S1', 'weekly', new Date('2026-05-20T09:00:00.000Z'));
  const res = mockRes();
  await handleSlashCommand(db, makeValidReq('status', 'T_STATUS'), res);
  assert.strictEqual(res._statusCode, 200);
  const payload = JSON.parse(res._body);
  assert.strictEqual(payload.response_type, 'ephemeral');
  const texts = payload.blocks.map(b => b.text?.text || '').join(' ');
  assert.ok(texts.includes('Last weekly digest'));
  assert.ok(texts.includes('2026-05-20T09:00:00.000Z'));
  db.close();
});

test('/calendar refresh sends immediate ack with Refreshing text', async () => {
  const db = openDb(':memory:');
  upsertWorkspaceFromOAuth(db, { teamId: 'T_REFRESH', teamName: 'Refresh WS', botToken: 'xoxb-r', installedBy: 'U1' });
  _setRunnerForTest(async () => {});
  const res = mockRes();
  await handleSlashCommand(db, makeValidReq('refresh', 'T_REFRESH'), res);
  assert.strictEqual(res._statusCode, 200);
  assert.ok(JSON.parse(res._body).text.includes('Refreshing'));
  _setRunnerForTest(null);
  db.close();
});

test('/calendar refresh calls runChangeDetection asynchronously', async () => {
  const db = openDb(':memory:');
  upsertWorkspaceFromOAuth(db, { teamId: 'T_REFRESH2', teamName: 'R2 WS', botToken: 'xoxb-r2', installedBy: 'U1' });
  let detected = false;
  _setRunnerForTest(async () => { detected = true; });
  const res = mockRes();
  await handleSlashCommand(db, makeValidReq('refresh', 'T_REFRESH2'), res);
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(detected, true);
  _setRunnerForTest(null);
  db.close();
});

test('unknown subcommand returns "Unknown command" message', async () => {
  const db = openDb(':memory:');
  upsertWorkspaceFromOAuth(db, { teamId: 'T_UNK', teamName: 'Unk WS', botToken: 'xoxb-u', installedBy: 'U1' });
  const res = mockRes();
  await handleSlashCommand(db, makeValidReq('foobar', 'T_UNK'), res);
  assert.strictEqual(res._statusCode, 200);
  assert.ok(JSON.parse(res._body).text.includes('Unknown command'));
  db.close();
});

test('empty text returns "Unknown command" message', async () => {
  const db = openDb(':memory:');
  upsertWorkspaceFromOAuth(db, { teamId: 'T_EMPTY', teamName: 'Empty WS', botToken: 'xoxb-e', installedBy: 'U1' });
  const res = mockRes();
  await handleSlashCommand(db, makeValidReq('', 'T_EMPTY'), res);
  assert.strictEqual(res._statusCode, 200);
  assert.ok(JSON.parse(res._body).text.includes('Unknown command'));
  db.close();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
NODE_ENV=test node --test test/commands.test.js
```

Expected: 12 failures with `Cannot find module '../src/commands.js'`.

- [ ] **Step 3: Implement src/commands.js**

Create `src/commands.js`:

```javascript
const https = require('node:https');
const { readAndVerify } = require('./slack-verify.js');
const { getWorkspace, loadRunState } = require('./db.js');
const { loadConfigFromDb } = require('./config.js');
const { runChangeDetection } = require('./runner.js');

let _runner = runChangeDetection;

/**
 * Override runChangeDetection for tests. Pass null to restore.
 * @param {Function|null} fn
 */
function _setRunnerForTest(fn) {
  _runner = fn || runChangeDetection;
}

/**
 * Throw if SLACK_SIGNING_SECRET is missing. Call at server startup.
 */
function validateSlackCommandsEnvVars() {
  if (!process.env.SLACK_SIGNING_SECRET) {
    throw new Error('SLACK_SIGNING_SECRET environment variable is required');
  }
}

function sendEphemeral(res, text) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ response_type: 'ephemeral', text }));
}

function sendEphemeralBlocks(res, blocks) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ response_type: 'ephemeral', blocks }));
}

async function postToResponseUrl(responseUrl, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const url = new URL(responseUrl);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => { res.resume(); resolve(); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function subHelp(res) {
  sendEphemeralBlocks(res, [{
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: '*Available commands:*\n`/calendar help` — show this help\n`/calendar config` — show channel calendar setup\n`/calendar status` — show last digest run times\n`/calendar refresh` — run calendar change detection now'
    }
  }]);
}

function subConfig(db, teamId, teamName, res) {
  let config;
  try {
    config = loadConfigFromDb(db, teamId);
  } catch (err) {
    console.error('[commands] loadConfigFromDb failed:', err.message);
    sendEphemeral(res, 'Could not load workspace config.');
    return;
  }

  if (!config.channels || config.channels.length === 0) {
    sendEphemeral(res, 'No calendars configured for this workspace.');
    return;
  }

  const blocks = [{ type: 'header', text: { type: 'plain_text', text: `Calendar Config — ${teamName}` } }];
  for (let i = 0; i < config.channels.length; i++) {
    const ch = config.channels[i];
    const calNames = ch.calendars.map(id => config.calendars[id]?.name || id).join(', ');
    const label = ch.name ? `#${ch.name}` : ch.id;
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${label}*\nDigest: \`${ch.digest_schedule || 'disabled'}\`\nDaily: \`${ch.daily_digest_schedule || 'disabled'}\`\nCalendars: ${calNames}`
      }
    });
    if (i < config.channels.length - 1) blocks.push({ type: 'divider' });
  }
  sendEphemeralBlocks(res, blocks);
}

function subStatus(db, teamId, teamName, res) {
  const rows = db.prepare('SELECT channel_id, name FROM channels WHERE workspace_id = ?').all(teamId);
  if (rows.length === 0) {
    sendEphemeral(res, 'No channels configured for this workspace.');
    return;
  }
  const blocks = [{ type: 'header', text: { type: 'plain_text', text: `Bot Status — ${teamName}` } }];
  for (const row of rows) {
    const weekly = loadRunState(db, teamId, row.channel_id, 'weekly');
    const daily = loadRunState(db, teamId, row.channel_id, 'daily');
    const label = row.name ? `#${row.name}` : row.channel_id;
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${label}*\nLast weekly digest: \`${weekly ? weekly.toISOString() : 'never'}\`\nLast daily digest: \`${daily ? daily.toISOString() : 'never'}\``
      }
    });
  }
  sendEphemeralBlocks(res, blocks);
}

function subRefresh(db, teamId, responseUrl, res) {
  sendEphemeral(res, 'Refreshing calendars…');
  setImmediate(async () => {
    let payload;
    try {
      await _runner(db, teamId, false);
      payload = { response_type: 'ephemeral', text: 'Change detection complete.' };
    } catch (err) {
      payload = { response_type: 'ephemeral', text: `Change detection failed: ${err.message}` };
    }
    try {
      await postToResponseUrl(responseUrl, payload);
    } catch (err) {
      console.warn('[commands] POST to response_url failed:', err.message);
    }
  });
}

/**
 * Handle POST /slack/commands. Returns true if handled, false otherwise.
 * Routes /calendar subcommands: help, config, status, refresh.
 * @param {import('better-sqlite3').Database} db
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @returns {Promise<boolean>}
 */
async function handleSlashCommand(db, req, res) {
  if (req.method !== 'POST') return false;
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/slack/commands') return false;

  let parsedBody;
  try {
    ({ parsedBody } = await readAndVerify(req, process.env.SLACK_SIGNING_SECRET));
  } catch (err) {
    res.writeHead(err.statusCode || 500);
    res.end();
    return true;
  }

  const { team_id, text = '', response_url = '' } = parsedBody;
  const workspace = getWorkspace(db, team_id);
  if (!workspace) {
    sendEphemeral(res, 'Workspace not configured yet.');
    return true;
  }

  const subcommand = (text || '').trim().split(/\s+/)[0].toLowerCase();

  switch (subcommand) {
    case 'help':    subHelp(res); break;
    case 'config':  subConfig(db, team_id, workspace.team_name, res); break;
    case 'status':  subStatus(db, team_id, workspace.team_name, res); break;
    case 'refresh': subRefresh(db, team_id, response_url, res); break;
    default:        sendEphemeral(res, 'Unknown command. Try `/calendar help`.'); break;
  }

  return true;
}

module.exports = { validateSlackCommandsEnvVars, handleSlashCommand, _setRunnerForTest };
```

- [ ] **Step 4: Run the commands tests to verify they pass**

```bash
NODE_ENV=test node --test test/commands.test.js
```

Expected: `pass 12, fail 0`.

- [ ] **Step 5: Run the full test suite**

```bash
NODE_ENV=test node --test test/*.test.js
```

Expected: `pass 276, fail 0` (258 baseline + 6 slack-verify + 12 commands).

- [ ] **Step 6: Commit**

```bash
git add src/commands.js test/commands.test.js
git commit -m "feat: add slash command handler with help/config/status/refresh subcommands refs: #26"
```

---

### Task 4: Wire server.js

**Blocked by:** Task 3.

**Files:**
- Modify: `src/server.js`

- [ ] **Step 1: Update server.js to import and wire commands.js**

Replace the entire `src/server.js` with:

```javascript
const http = require('node:http');
const path = require('node:path');
const { openDb } = require('./db.js');
const { validateEncryptionKey } = require('./crypto.js');
const { validateSlackEnvVars, handleOAuthRequest } = require('./oauth.js');
const { validateSlackEventsEnvVars, handleEventsRequest } = require('./events.js');
const { validateSlackCommandsEnvVars, handleSlashCommand } = require('./commands.js');
const registry = require('./scheduler-registry.js');

async function start() {
  validateEncryptionKey();
  validateSlackEnvVars();
  validateSlackEventsEnvVars();
  validateSlackCommandsEnvVars();

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
      } else if (await handleSlashCommand(db, req, res)) {
        // handled by commands.js
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
}

if (require.main === module) {
  start().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = {};
```

- [ ] **Step 2: Run the full test suite**

```bash
NODE_ENV=test node --test test/*.test.js
```

Expected: `pass 276, fail 0`. The full suite must be green before committing.

- [ ] **Step 3: Commit**

```bash
git add src/server.js
git commit -m "feat: wire slash command handler into server routes refs: #26"
```
