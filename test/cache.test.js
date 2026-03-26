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

  assert.deepStrictEqual(result.events, cacheData.events);
  assert.strictEqual(result.updated_at, cacheData.updated_at);

  await rm(TEST_CACHE_DIR, { recursive: true, force: true });
});
