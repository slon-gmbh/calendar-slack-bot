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
