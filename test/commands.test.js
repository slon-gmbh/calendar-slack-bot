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
