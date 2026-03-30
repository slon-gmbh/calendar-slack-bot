const { test } = require('node:test');
const assert = require('node:assert');
const { mkdtemp, rm } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

// We'll test the exported helper after extracting it
const { getChangeDetectionRange } = require('../src/bot.js');

test('getChangeDetectionRange should return current week + 4 weeks', () => {
  // Mock date: Wednesday, March 26, 2026
  const mockNow = new Date('2026-03-26T14:00:00Z');

  const result = getChangeDetectionRange(mockNow);

  // Week starts Monday (March 23)
  const expectedStart = new Date('2026-03-23T00:00:00.000Z');
  // 4 weeks ahead from end of current week (Sunday April 26, 23:59:59)
  const expectedEnd = new Date('2026-04-26T23:59:59.999Z');

  assert.strictEqual(result.start.toISOString(), expectedStart.toISOString());
  assert.strictEqual(result.end.toISOString(), expectedEnd.toISOString());
});

test('getChangeDetectionRange should handle Sunday correctly', () => {
  // Mock date: Sunday, March 29, 2026 (last day of week)
  const mockNow = new Date('2026-03-29T14:00:00Z');

  const result = getChangeDetectionRange(mockNow);

  // Week starts Monday (March 23) - same week
  const expectedStart = new Date('2026-03-23T00:00:00.000Z');
  // 4 weeks ahead from Sunday (April 26, 23:59:59)
  const expectedEnd = new Date('2026-04-26T23:59:59.999Z');

  assert.strictEqual(result.start.toISOString(), expectedStart.toISOString());
  assert.strictEqual(result.end.toISOString(), expectedEnd.toISOString());
});

test('getCurrentWeekRange: Sunday should return upcoming week (next Monday to Sunday)', () => {
  const { getCurrentWeekRange } = require('../src/bot.js');

  // Mock date to Sunday March 22, 2026
  const mockNow = new Date('2026-03-22T12:00:00Z');
  const range = getCurrentWeekRange(mockNow);

  // Should return March 23 (Monday) through March 29 (Sunday)
  assert.strictEqual(range.start.getUTCDate(), 23, 'Start should be March 23');
  assert.strictEqual(range.start.getUTCDay(), 1, 'Start should be Monday');
  assert.strictEqual(range.end.getUTCDate(), 29, 'End should be March 29');
  assert.strictEqual(range.end.getUTCDay(), 0, 'End should be Sunday');
});

test('getCurrentWeekRange: Monday should return current week (this Monday to Sunday)', () => {
  const { getCurrentWeekRange } = require('../src/bot.js');

  // Mock date to Monday March 23, 2026
  const mockNow = new Date('2026-03-23T12:00:00Z');
  const range = getCurrentWeekRange(mockNow);

  // Should return March 23 (Monday) through March 29 (Sunday)
  assert.strictEqual(range.start.getUTCDate(), 23, 'Start should be March 23');
  assert.strictEqual(range.start.getUTCDay(), 1, 'Start should be Monday');
  assert.strictEqual(range.end.getUTCDate(), 29, 'End should be March 29');
  assert.strictEqual(range.end.getUTCDay(), 0, 'End should be Sunday');
});

test('getCurrentWeekRange: Saturday should return current week (this Monday to Sunday)', () => {
  const { getCurrentWeekRange } = require('../src/bot.js');

  // Mock date to Saturday March 21, 2026
  const mockNow = new Date('2026-03-21T12:00:00Z');
  const range = getCurrentWeekRange(mockNow);

  // Should return March 16 (Monday) through March 22 (Sunday)
  assert.strictEqual(range.start.getUTCDate(), 16, 'Start should be March 16');
  assert.strictEqual(range.start.getUTCDay(), 1, 'Start should be Monday');
  assert.strictEqual(range.end.getUTCDate(), 22, 'End should be March 22');
  assert.strictEqual(range.end.getUTCDay(), 0, 'End should be Sunday');
});

test('saveLastRunTime should create lastrun file', async () => {
  const { loadLastRunTime, saveLastRunTime } = require('../src/bot.js');
  const testDir = await mkdtemp(join(tmpdir(), 'bot-test-'));
  process.env.CACHE_DIR = testDir;

  try {
    const timestamp = new Date('2026-03-30T18:00:00Z');
    await saveLastRunTime('C12345', 'weekly', timestamp);

    const loaded = await loadLastRunTime('C12345', 'weekly');
    assert.ok(loaded);
    assert.equal(loaded.toISOString(), timestamp.toISOString());
  } finally {
    delete process.env.CACHE_DIR;
    await rm(testDir, { recursive: true, force: true });
  }
});

test('loadLastRunTime should return null for nonexistent file', async () => {
  const { loadLastRunTime } = require('../src/bot.js');
  const testDir = await mkdtemp(join(tmpdir(), 'bot-test-'));
  process.env.CACHE_DIR = testDir;

  try {
    const loaded = await loadLastRunTime('C99999', 'weekly');
    assert.equal(loaded, null);
  } finally {
    delete process.env.CACHE_DIR;
    await rm(testDir, { recursive: true, force: true });
  }
});
