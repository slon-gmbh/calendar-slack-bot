const { test } = require('node:test');
const assert = require('node:assert');
const { loadCacheState, saveCacheState } = require('../src/cache.js');
const { writeFile, mkdir, rm } = require('node:fs/promises');
const path = require('node:path');

const TEST_CACHE_DIR = path.join(__dirname, '.test-cache');

test('loadCacheState should load valid cache file', async () => {
  await mkdir(TEST_CACHE_DIR, { recursive: true });

  const cacheData = {
    events: [
      { id: 'e1', title: 'Test Event', start: '2026-03-26T10:00:00.000Z' }
    ],
    updated_at: '2026-03-26T09:00:00Z'
  };

  await writeFile(
    path.join(TEST_CACHE_DIR, 'team-calendar.json'),
    JSON.stringify(cacheData),
    'utf-8'
  );

  const result = await loadCacheState('team-calendar', TEST_CACHE_DIR);

  // Dates should be converted to Date objects
  assert.strictEqual(result.events.length, 1);
  assert.strictEqual(result.events[0].id, 'e1');
  assert.strictEqual(result.events[0].title, 'Test Event');
  assert.ok(result.events[0].start instanceof Date);
  assert.strictEqual(result.events[0].start.toISOString(), '2026-03-26T10:00:00.000Z');
  assert.strictEqual(result.updated_at, cacheData.updated_at);

  await rm(TEST_CACHE_DIR, { recursive: true, force: true });
});

test('loadCacheState should return null for missing file', async () => {
  await mkdir(TEST_CACHE_DIR, { recursive: true });

  const result = await loadCacheState('nonexistent-calendar', TEST_CACHE_DIR);

  assert.strictEqual(result, null);

  await rm(TEST_CACHE_DIR, { recursive: true, force: true });
});

test('loadCacheState should return null for corrupt JSON', async () => {
  await mkdir(TEST_CACHE_DIR, { recursive: true });

  await writeFile(
    path.join(TEST_CACHE_DIR, 'corrupt-calendar.json'),
    '{ invalid json',
    'utf-8'
  );

  const result = await loadCacheState('corrupt-calendar', TEST_CACHE_DIR);

  assert.strictEqual(result, null);

  await rm(TEST_CACHE_DIR, { recursive: true, force: true });
});

/**
 * Verify saveCacheState writes valid JSON with events and proper metadata
 * Round-trip test: save events with no error state, then load and verify
 * - Event IDs and titles match exactly after round trip
 * - Event start dates serialize to ISO strings correctly
 * - updated_at timestamp is set
 * - last_error field is absent (not included in JSON)
 */
test('saveCacheState should write valid JSON with events', async () => {
  await mkdir(TEST_CACHE_DIR, { recursive: true });

  const events = [
    { id: 'e1', title: 'Meeting', start: new Date('2026-03-26T10:00:00Z') }
  ];

  await saveCacheState('test-calendar', events, null, TEST_CACHE_DIR);

  const saved = await loadCacheState('test-calendar', TEST_CACHE_DIR);

  assert.strictEqual(saved.events[0].id, 'e1');
  assert.strictEqual(saved.events[0].title, 'Meeting');
  // Dates are converted back to Date objects when loading
  assert.ok(saved.events[0].start instanceof Date);
  assert.strictEqual(saved.events[0].start.toISOString(), '2026-03-26T10:00:00.000Z');
  assert.ok(saved.updated_at);
  assert.ok(!saved.last_error);

  await rm(TEST_CACHE_DIR, { recursive: true, force: true });
});

/**
 * Verify saveCacheState includes error metadata when provided
 * Round-trip test: save empty events with error state, then load and verify
 * - last_error field is preserved
 * - error_notified_at field is preserved
 */
test('saveCacheState should include error metadata', async () => {
  await mkdir(TEST_CACHE_DIR, { recursive: true });

  const events = [];
  const errorState = {
    last_error: 'CalDAV timeout',
    error_notified_at: '2026-03-26T10:00:00Z'
  };

  await saveCacheState('error-calendar', events, errorState, TEST_CACHE_DIR);

  const saved = await loadCacheState('error-calendar', TEST_CACHE_DIR);

  assert.strictEqual(saved.last_error, 'CalDAV timeout');
  assert.strictEqual(saved.error_notified_at, '2026-03-26T10:00:00Z');

  await rm(TEST_CACHE_DIR, { recursive: true, force: true });
});
