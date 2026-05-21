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
