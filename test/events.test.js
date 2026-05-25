process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.SLACK_SIGNING_SECRET = 'test-signing-secret';

const { test } = require('node:test');
const assert = require('node:assert');
const { createHmac } = require('node:crypto');
const { openDb, upsertWorkspaceFromOAuth } = require('../src/db.js');
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
