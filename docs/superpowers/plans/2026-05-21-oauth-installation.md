**Issue:** #46

# Slack OAuth Installation Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Slack OAuth install flow to `server.js` so any workspace admin can add the bot by visiting `/slack/install`, with the resulting bot token stored encrypted in SQLite.

**Architecture:** New `src/oauth.js` owns all OAuth logic (CSRF state, authorize redirect, code exchange, error pages). `src/db.js` gains `upsertWorkspaceFromOAuth()` and `listActiveWorkspaces()`. `server.js` calls `validateSlackEnvVars()` at startup and delegates matching HTTP requests to `handleOAuthRequest(db, req, res)`. The cron scheduler is untouched.

**Tech Stack:** Node.js `node:crypto` (CSRF), `@slack/web-api` WebClient (`oauth.v2.access`), `better-sqlite3`, `node:test` + `node:assert`.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/oauth.js` | **Create** | CSRF state, authorize URL, token exchange, HTML pages |
| `src/db.js` | **Modify** | Add `upsertWorkspaceFromOAuth`, `listActiveWorkspaces` |
| `src/server.js` | **Modify** | Call `validateSlackEnvVars()`, delegate HTTP to `handleOAuthRequest` |
| `test/oauth.test.js` | **Create** | Tests for `validateSlackEnvVars` + all route behaviours |
| `test/db.test.js` | **Modify** | Tests for the two new db functions |

---

## Task 1: db.js — upsertWorkspaceFromOAuth + listActiveWorkspaces

**Files:**
- Modify: `src/db.js` (after line 327, before `module.exports`)
- Modify: `test/db.test.js` (append after line 246)

- [ ] **Step 1.1 — Add failing tests to `test/db.test.js`**

Append after the last existing test (line 246):

```js
const { upsertWorkspaceFromOAuth, listActiveWorkspaces } = require('../src/db.js');

test('upsertWorkspaceFromOAuth stores workspace with encrypted bot_token', () => {
  const db = memDb();
  upsertWorkspaceFromOAuth(db, { teamId: 'T_OAUTH1', teamName: 'Acme', botToken: 'xoxb-live-token', installedBy: 'U_ADMIN' });
  const raw = db.prepare('SELECT bot_token FROM workspaces WHERE team_id = ?').get('T_OAUTH1');
  assert.ok(raw, 'row should exist');
  assert.notStrictEqual(raw.bot_token, 'xoxb-live-token', 'stored value must be encrypted');
  assert.ok(raw.bot_token.includes(':'), 'stored value must be in iv:ct:tag format');
  db.close();
});

test('upsertWorkspaceFromOAuth — getWorkspace decrypts bot_token', () => {
  const db = memDb();
  upsertWorkspaceFromOAuth(db, { teamId: 'T_OAUTH2', teamName: 'Beta', botToken: 'xoxb-decryptme', installedBy: 'U_ADMIN' });
  const ws = getWorkspace(db, 'T_OAUTH2');
  assert.strictEqual(ws.bot_token, 'xoxb-decryptme');
  db.close();
});

test('upsertWorkspaceFromOAuth — re-install updates bot_token and sets active=1', () => {
  const db = memDb();
  upsertWorkspaceFromOAuth(db, { teamId: 'T_REINSTALL', teamName: 'Gamma', botToken: 'xoxb-old', installedBy: 'U_ADMIN' });
  db.prepare('UPDATE workspaces SET active = 0 WHERE team_id = ?').run('T_REINSTALL');
  upsertWorkspaceFromOAuth(db, { teamId: 'T_REINSTALL', teamName: 'Gamma Renamed', botToken: 'xoxb-new', installedBy: 'U_ADMIN2' });
  const ws = getWorkspace(db, 'T_REINSTALL');
  assert.strictEqual(ws.bot_token, 'xoxb-new');
  assert.strictEqual(ws.active, 1);
  assert.strictEqual(ws.team_name, 'Gamma Renamed');
  db.close();
});

test('listActiveWorkspaces returns only active rows with decrypted tokens', () => {
  const db = memDb();
  upsertWorkspaceFromOAuth(db, { teamId: 'T_ACTIVE', teamName: 'Active', botToken: 'xoxb-active', installedBy: 'U1' });
  upsertWorkspaceFromOAuth(db, { teamId: 'T_INACTIVE', teamName: 'Inactive', botToken: 'xoxb-inactive', installedBy: 'U2' });
  db.prepare('UPDATE workspaces SET active = 0 WHERE team_id = ?').run('T_INACTIVE');
  const workspaces = listActiveWorkspaces(db);
  assert.strictEqual(workspaces.length, 1);
  assert.strictEqual(workspaces[0].team_id, 'T_ACTIVE');
  assert.strictEqual(workspaces[0].bot_token, 'xoxb-active');
  db.close();
});

test('listActiveWorkspaces returns empty array when no active workspaces', () => {
  const db = memDb();
  const workspaces = listActiveWorkspaces(db);
  assert.deepStrictEqual(workspaces, []);
  db.close();
});
```

- [ ] **Step 1.2 — Run tests to confirm they fail**

```bash
NODE_ENV=test node --test test/db.test.js
```

Expected: 5 new failures — `upsertWorkspaceFromOAuth is not a function` and `listActiveWorkspaces is not a function`.

- [ ] **Step 1.3 — Add `upsertWorkspaceFromOAuth` to `src/db.js`**

Insert after the `getCaldavCredentials` function (after line 327), before `module.exports`:

```js
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
```

- [ ] **Step 1.4 — Update `module.exports` in `src/db.js`**

Replace the existing `module.exports` block:

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
  upsertWorkspace,
  upsertCaldavCredentials,
  getCaldavCredentials,
  upsertWorkspaceFromOAuth,
  listActiveWorkspaces
};
```

- [ ] **Step 1.5 — Run tests to confirm they pass**

```bash
NODE_ENV=test node --test test/db.test.js
```

Expected: all tests pass including the 5 new ones.

- [ ] **Step 1.6 — Run full suite to confirm no regressions**

```bash
NODE_ENV=test node --test test/*.test.js
```

Expected: all tests pass.

- [ ] **Step 1.7 — Commit**

```bash
git add src/db.js test/db.test.js
git commit -m "feat: add upsertWorkspaceFromOAuth and listActiveWorkspaces to db.js

refs: #46"
```

---

## Task 2: src/oauth.js — validateSlackEnvVars + routes

**Files:**
- Create: `src/oauth.js`
- Create: `test/oauth.test.js`

- [ ] **Step 2.1 — Create `test/oauth.test.js` with `validateSlackEnvVars` tests**

```js
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.SLACK_CLIENT_ID = 'test-client-id';
process.env.SLACK_CLIENT_SECRET = 'test-client-secret';
process.env.SLACK_REDIRECT_HOST = 'test.example.com';

const { test } = require('node:test');
const assert = require('node:assert');
const { validateSlackEnvVars, handleOAuthRequest, _setClientForTest, _addStateForTest } = require('../src/oauth.js');
const { openDb, getWorkspace } = require('../src/db.js');

function mockReq(method, url) {
  return { method, url };
}

function mockRes() {
  const res = {
    _statusCode: null,
    _headers: {},
    _body: '',
    writeHead(code, headers) {
      this._statusCode = code;
      if (headers) Object.assign(this._headers, headers);
    },
    end(body) { this._body = body || ''; }
  };
  return res;
}

test('validateSlackEnvVars throws when SLACK_CLIENT_ID missing', () => {
  const saved = process.env.SLACK_CLIENT_ID;
  delete process.env.SLACK_CLIENT_ID;
  try {
    assert.throws(() => validateSlackEnvVars(), /SLACK_CLIENT_ID/);
  } finally {
    process.env.SLACK_CLIENT_ID = saved;
  }
});

test('validateSlackEnvVars throws when SLACK_CLIENT_SECRET missing', () => {
  const saved = process.env.SLACK_CLIENT_SECRET;
  delete process.env.SLACK_CLIENT_SECRET;
  try {
    assert.throws(() => validateSlackEnvVars(), /SLACK_CLIENT_SECRET/);
  } finally {
    process.env.SLACK_CLIENT_SECRET = saved;
  }
});

test('validateSlackEnvVars throws when SLACK_REDIRECT_HOST missing', () => {
  const saved = process.env.SLACK_REDIRECT_HOST;
  delete process.env.SLACK_REDIRECT_HOST;
  try {
    assert.throws(() => validateSlackEnvVars(), /SLACK_REDIRECT_HOST/);
  } finally {
    process.env.SLACK_REDIRECT_HOST = saved;
  }
});

test('validateSlackEnvVars does not throw when all vars set', () => {
  assert.doesNotThrow(() => validateSlackEnvVars());
});
```

- [ ] **Step 2.2 — Run to confirm tests fail**

```bash
NODE_ENV=test node --test test/oauth.test.js
```

Expected: 4 failures — `Cannot find module '../src/oauth.js'`.

- [ ] **Step 2.3 — Create `src/oauth.js` with `validateSlackEnvVars` + stubs**

```js
const { randomBytes } = require('node:crypto');
const { WebClient } = require('@slack/web-api');
const { upsertWorkspaceFromOAuth } = require('./db.js');

const PENDING_STATES = new Map();
const STATE_TTL_MS = 10 * 60 * 1000;

let _testClient = null;

/**
 * Override the WebClient for tests. Pass null to restore default.
 * @param {object|null} client
 */
function _setClientForTest(client) {
  _testClient = client;
}

/**
 * Insert a state directly into PENDING_STATES for tests.
 * @param {string} state
 * @param {number} ttlMs - positive for future expiry, negative for already-expired
 */
function _addStateForTest(state, ttlMs) {
  PENDING_STATES.set(state, Date.now() + ttlMs);
}

function getClient() {
  return _testClient || new WebClient();
}

/**
 * Validate that SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, and SLACK_REDIRECT_HOST are set.
 * Throws with the missing variable name. Call at server startup before the HTTP server binds.
 */
function validateSlackEnvVars() {
  for (const v of ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET', 'SLACK_REDIRECT_HOST']) {
    if (!process.env[v]) {
      throw new Error(`${v} environment variable is required`);
    }
  }
}

function sweepExpiredStates() {
  const now = Date.now();
  for (const [state, expiry] of PENDING_STATES) {
    if (expiry < now) PENDING_STATES.delete(state);
  }
}

function generateState() {
  sweepExpiredStates();
  const state = randomBytes(16).toString('hex');
  PENDING_STATES.set(state, Date.now() + STATE_TTL_MS);
  return state;
}

function buildAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.SLACK_CLIENT_ID,
    scope: 'chat:write canvases:write im:write commands',
    redirect_uri: `https://${process.env.SLACK_REDIRECT_HOST}/slack/oauth/callback`,
    state
  });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

function sendError(res, message) {
  res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(
    `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Installation Failed</title></head>` +
    `<body><h1>Installation failed</h1><p>${message}</p>` +
    `<p><a href="/slack/install">Try again</a></p></body></html>`
  );
}

/**
 * Handle Slack OAuth installation routes. Returns true if the request was handled.
 * Routes: GET /slack/install, GET /slack/oauth/callback, GET /slack/install/success
 * @param {import('better-sqlite3').Database} db
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @returns {Promise<boolean>}
 */
async function handleOAuthRequest(db, req, res) {
  if (req.method !== 'GET') return false;

  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/slack/install') {
    const state = generateState();
    res.writeHead(302, { Location: buildAuthorizeUrl(state) });
    res.end();
    return true;
  }

  if (url.pathname === '/slack/oauth/callback') {
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    if (!state || !PENDING_STATES.has(state)) {
      sendError(res, 'Installation failed. Please try again.');
      return true;
    }

    const expiry = PENDING_STATES.get(state);
    PENDING_STATES.delete(state);

    if (expiry < Date.now()) {
      sendError(res, 'Installation link expired. Please try again.');
      return true;
    }

    if (error) {
      sendError(res, 'Installation was cancelled.');
      return true;
    }

    try {
      const result = await getClient().oauth.v2.access({
        client_id: process.env.SLACK_CLIENT_ID,
        client_secret: process.env.SLACK_CLIENT_SECRET,
        code
      });

      upsertWorkspaceFromOAuth(db, {
        teamId: result.team.id,
        teamName: result.team.name,
        botToken: result.access_token,
        installedBy: result.authed_user.id
      });

      // TODO #48: DM authed_user.id to trigger onboarding wizard

      res.writeHead(302, { Location: '/slack/install/success' });
      res.end();
    } catch (err) {
      console.error('[oauth] Token exchange failed:', err.message);
      sendError(res, 'Installation failed. Please try again.');
    }
    return true;
  }

  if (url.pathname === '/slack/install/success') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Installation Complete</title></head>` +
      `<body><h1>Installation complete</h1>` +
      `<p>The Calendar Bot has been added to your Slack workspace. You can close this tab.</p></body></html>`
    );
    return true;
  }

  return false;
}

module.exports = { validateSlackEnvVars, handleOAuthRequest, _setClientForTest, _addStateForTest };
```

- [ ] **Step 2.4 — Run to confirm `validateSlackEnvVars` tests pass**

```bash
NODE_ENV=test node --test test/oauth.test.js
```

Expected: 4 tests pass.

- [ ] **Step 2.5 — Append route tests to `test/oauth.test.js`**

Append after the last test:

```js
test('handleOAuthRequest returns false for unrecognised path', async () => {
  const db = openDb(':memory:');
  const req = mockReq('GET', '/not-a-route');
  const res = mockRes();
  const handled = await handleOAuthRequest(db, req, res);
  assert.strictEqual(handled, false);
  assert.strictEqual(res._statusCode, null);
  db.close();
});

test('handleOAuthRequest returns false for non-GET method', async () => {
  const db = openDb(':memory:');
  const req = mockReq('POST', '/slack/install');
  const res = mockRes();
  const handled = await handleOAuthRequest(db, req, res);
  assert.strictEqual(handled, false);
  db.close();
});

test('GET /slack/install redirects to Slack authorize URL with state param', async () => {
  const db = openDb(':memory:');
  const req = mockReq('GET', '/slack/install');
  const res = mockRes();
  const handled = await handleOAuthRequest(db, req, res);
  assert.strictEqual(handled, true);
  assert.strictEqual(res._statusCode, 302);
  const location = res._headers['Location'];
  assert.ok(location.startsWith('https://slack.com/oauth/v2/authorize'), `unexpected location: ${location}`);
  const url = new URL(location);
  assert.ok(url.searchParams.get('state'), 'state param must be present');
  assert.strictEqual(url.searchParams.get('client_id'), 'test-client-id');
  db.close();
});

test('GET /slack/oauth/callback returns 400 when state missing', async () => {
  const db = openDb(':memory:');
  const req = mockReq('GET', '/slack/oauth/callback?code=abc');
  const res = mockRes();
  await handleOAuthRequest(db, req, res);
  assert.strictEqual(res._statusCode, 400);
  db.close();
});

test('GET /slack/oauth/callback returns 400 when state unknown', async () => {
  const db = openDb(':memory:');
  const req = mockReq('GET', '/slack/oauth/callback?code=abc&state=not-in-map');
  const res = mockRes();
  await handleOAuthRequest(db, req, res);
  assert.strictEqual(res._statusCode, 400);
  db.close();
});

test('GET /slack/oauth/callback returns 400 when state expired', async () => {
  const db = openDb(':memory:');
  _addStateForTest('stale-state', -1000);
  const req = mockReq('GET', '/slack/oauth/callback?code=abc&state=stale-state');
  const res = mockRes();
  await handleOAuthRequest(db, req, res);
  assert.strictEqual(res._statusCode, 400);
  db.close();
});

test('GET /slack/oauth/callback returns 400 when user denies access', async () => {
  const db = openDb(':memory:');
  // Get a fresh valid state via /slack/install
  const installRes = mockRes();
  await handleOAuthRequest(db, mockReq('GET', '/slack/install'), installRes);
  const state = new URL(installRes._headers['Location']).searchParams.get('state');
  const req = mockReq('GET', `/slack/oauth/callback?error=access_denied&state=${state}`);
  const res = mockRes();
  await handleOAuthRequest(db, req, res);
  assert.strictEqual(res._statusCode, 400);
  db.close();
});

test('GET /slack/oauth/callback returns 400 when Slack token exchange fails', async () => {
  const db = openDb(':memory:');
  _setClientForTest({ oauth: { v2: { access: async () => { throw new Error('invalid_code'); } } } });
  try {
    const installRes = mockRes();
    await handleOAuthRequest(db, mockReq('GET', '/slack/install'), installRes);
    const state = new URL(installRes._headers['Location']).searchParams.get('state');
    const req = mockReq('GET', `/slack/oauth/callback?code=bad-code&state=${state}`);
    const res = mockRes();
    await handleOAuthRequest(db, req, res);
    assert.strictEqual(res._statusCode, 400);
  } finally {
    _setClientForTest(null);
    db.close();
  }
});

test('GET /slack/oauth/callback success — stores workspace and redirects', async () => {
  const db = openDb(':memory:');
  _setClientForTest({
    oauth: {
      v2: {
        access: async () => ({
          access_token: 'xoxb-oauth-token',
          team: { id: 'T_FLOW', name: 'Flow Corp' },
          authed_user: { id: 'U_FLOW_ADMIN' }
        })
      }
    }
  });
  try {
    const installRes = mockRes();
    await handleOAuthRequest(db, mockReq('GET', '/slack/install'), installRes);
    const state = new URL(installRes._headers['Location']).searchParams.get('state');
    const callbackReq = mockReq('GET', `/slack/oauth/callback?code=good-code&state=${state}`);
    const callbackRes = mockRes();
    await handleOAuthRequest(db, callbackReq, callbackRes);
    assert.strictEqual(callbackRes._statusCode, 302);
    assert.strictEqual(callbackRes._headers['Location'], '/slack/install/success');
    const ws = getWorkspace(db, 'T_FLOW');
    assert.ok(ws, 'workspace must be stored');
    assert.strictEqual(ws.team_name, 'Flow Corp');
    assert.strictEqual(ws.bot_token, 'xoxb-oauth-token');
    assert.strictEqual(ws.installed_by, 'U_FLOW_ADMIN');
  } finally {
    _setClientForTest(null);
    db.close();
  }
});

test('GET /slack/install/success returns 200 HTML page', async () => {
  const db = openDb(':memory:');
  const req = mockReq('GET', '/slack/install/success');
  const res = mockRes();
  const handled = await handleOAuthRequest(db, req, res);
  assert.strictEqual(handled, true);
  assert.strictEqual(res._statusCode, 200);
  assert.ok(res._body.includes('Installation complete'));
  db.close();
});
```

- [ ] **Step 2.6 — Run to confirm new route tests fail**

```bash
NODE_ENV=test node --test test/oauth.test.js
```

Expected: the 4 `validateSlackEnvVars` tests pass; the 10 route tests fail (function not yet exported properly or `_addStateForTest` missing). If all 14 pass already (implementation was written in step 2.3), skip to step 2.7.

- [ ] **Step 2.7 — Run full oauth suite to confirm all 14 tests pass**

```bash
NODE_ENV=test node --test test/oauth.test.js
```

Expected: 14 tests pass.

- [ ] **Step 2.8 — Run full test suite to confirm no regressions**

```bash
NODE_ENV=test node --test test/*.test.js
```

Expected: all tests pass.

- [ ] **Step 2.9 — Commit**

```bash
git add src/oauth.js test/oauth.test.js
git commit -m "feat: add src/oauth.js — Slack OAuth install flow

refs: #46"
```

---

## Task 3: server.js integration

**Files:**
- Modify: `src/server.js`

- [ ] **Step 3.1 — Add import to `src/server.js`**

After line 7 (`const { validateEncryptionKey } = require('./crypto.js');`), add:

```js
const { validateSlackEnvVars, handleOAuthRequest } = require('./oauth.js');
```

- [ ] **Step 3.2 — Add `validateSlackEnvVars()` call in `start()`**

After line 42 (`validateEncryptionKey();`), add:

```js
  validateSlackEnvVars();
```

- [ ] **Step 3.3 — Update the HTTP request handler to async + delegate to oauth.js**

Replace the existing `http.createServer` block (lines 96–104):

```js
  const httpServer = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    } else if (await handleOAuthRequest(db, req, res)) {
      // handled by oauth.js
    } else {
      res.writeHead(404);
      res.end();
    }
  });
```

- [ ] **Step 3.4 — Run `server.test.js` to confirm existing tests still pass**

```bash
NODE_ENV=test node --test test/server.test.js
```

Expected: 12 tests pass (scheduleStringToCron tests unchanged).

- [ ] **Step 3.5 — Run full test suite**

```bash
NODE_ENV=test node --test test/*.test.js
```

Expected: all tests pass.

- [ ] **Step 3.6 — Commit**

```bash
git add src/server.js
git commit -m "feat: wire OAuth routes into server.js + fail-fast startup validation

refs: #46"
```

---

## Final Verification

- [ ] **Step 4.1 — Confirm total test count and all green**

```bash
NODE_ENV=test node --test test/*.test.js 2>&1 | tail -5
```

Expected: no failures, count includes the new oauth.test.js tests.

- [ ] **Step 4.2 — Confirm new files are present**

```bash
ls src/oauth.js test/oauth.test.js
```

Expected: both files listed.
