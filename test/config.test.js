const { test } = require('node:test');
const assert = require('node:assert');
const { loadConfig, validateConfig } = require('../src/config.js');

test('loadConfig should load and parse config.json', async () => {
  // This will fail until we implement loadConfig
  const config = await loadConfig('./test/fixtures/valid-config.json');
  assert.strictEqual(typeof config, 'object');
  assert.ok(config.locale);
  assert.ok(config.calendars);
  assert.ok(config.channels);
});

test('validateConfig should reject missing required fields', () => {
  const invalidConfig = { locale: 'en-US' }; // missing calendars and channels
  assert.throws(
    () => validateConfig(invalidConfig),
    /Config error/
  );
});

test('validateConfig should reject invalid calendar references', () => {
  const invalidConfig = {
    locale: 'en-US',
    caldav_credentials: { username: 'test', password: 'test' },
    calendars: { 'cal1': { name: 'Cal 1', caldav_url: 'http://test' } },
    channels: [{
      id: 'C123',
      canvas_id: 'F123',
      calendars: ['cal1', 'cal2'] // cal2 doesn't exist
    }]
  };
  assert.throws(
    () => validateConfig(invalidConfig),
    /calendar 'cal2' which is not defined/
  );
});

test('validateConfig should resolve environment variables', () => {
  process.env.TEST_VAR = 'resolved_value';
  const config = {
    locale: 'en-US',
    caldav_credentials: {
      username: '${TEST_VAR}',
      password: 'plain_password'
    },
    calendars: {},
    channels: []
  };
  const validated = validateConfig(config);
  assert.strictEqual(validated.caldav_credentials.username, 'resolved_value');
  delete process.env.TEST_VAR;
});

test('validateConfig should reject invalid schedule format', () => {
  const invalidConfig = {
    locale: 'en-US',
    caldav_credentials: { username: 'test', password: 'test' },
    calendars: { 'cal1': { name: 'Cal 1', caldav_url: 'http://test' } },
    channels: [{
      id: 'C123',
      canvas_id: 'F123',
      calendars: ['cal1'],
      digest_schedule: 'monday 25:00' // invalid hour
    }]
  };
  assert.throws(
    () => validateConfig(invalidConfig),
    /invalid.*schedule/i
  );
});
