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
