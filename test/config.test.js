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
  const invalidConfig = { workspace_id: 'T123', locale: 'en-US' }; // missing calendars and channels
  assert.throws(
    () => validateConfig(invalidConfig),
    /Config error/
  );
});

test('validateConfig should reject invalid calendar references', () => {
  const invalidConfig = {
    workspace_id: 'T123',
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
    workspace_id: 'T123',
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

test('validateConfig should reject unset environment variables', () => {
  const config = {
    workspace_id: 'T123',
    locale: 'en-US',
    caldav_credentials: {
      username: '${UNSET_VAR}',
      password: 'test'
    },
    calendars: {},
    channels: []
  };
  assert.throws(
    () => validateConfig(config),
    /UNSET_VAR environment variable is not set/
  );
});

test('validateConfig should reject invalid schedule format', () => {
  const invalidConfig = {
    workspace_id: 'T123',
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

test('requires workspace_id field', () => {
  const invalidConfig = {
    locale: 'en-US',
    caldav_credentials: { username: 'user', password: 'pass' },
    calendars: {},
    channels: []
  };

  assert.throws(
    () => validateConfig(invalidConfig),
    /workspace_id is required/
  );
});

test('validates canvas_url format when provided', () => {
  const invalidConfig = {
    workspace_id: 'T123',
    locale: 'en-US',
    caldav_credentials: { username: 'user', password: 'pass' },
    calendars: { 'cal1': { name: 'Cal 1', caldav_url: 'http://test' } },
    channels: [{
      id: 'C123',
      canvas_id: 'F123',
      calendars: ['cal1'],
      canvas_url: 'not-a-url'
    }]
  };

  assert.throws(
    () => validateConfig(invalidConfig),
    /canvas_url.*must be a valid URL/
  );
});

test('validates nextcloud_url format when provided', () => {
  const invalidConfig = {
    workspace_id: 'T123',
    nextcloud_url: 'not-a-url',
    locale: 'en-US',
    caldav_credentials: { username: 'user', password: 'pass' },
    calendars: {},
    channels: []
  };

  assert.throws(
    () => validateConfig(invalidConfig),
    /nextcloud_url must be a valid URL/
  );
});
