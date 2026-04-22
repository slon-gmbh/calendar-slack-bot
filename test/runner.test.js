const { test } = require('node:test');
const assert = require('node:assert');
const { openDb, loadRunState, saveRunState } = require('../src/db.js');
const { getCurrentWeekRange, getChangeDetectionRange } = require('../src/runner.js');

test('getCurrentWeekRange: Monday returns current week Mon-Sun', () => {
  const mockNow = new Date('2026-04-20T12:00:00Z'); // Monday
  const range = getCurrentWeekRange(mockNow);
  assert.strictEqual(range.start.getUTCDay(), 1, 'Start should be Monday');
  assert.strictEqual(range.end.getUTCDay(), 0, 'End should be Sunday');
  assert.strictEqual(range.start.toISOString(), '2026-04-20T00:00:00.000Z');
  assert.strictEqual(range.end.toISOString(), '2026-04-26T23:59:59.999Z');
});

test('getCurrentWeekRange: Sunday returns upcoming week', () => {
  const mockNow = new Date('2026-04-19T12:00:00Z'); // Sunday
  const range = getCurrentWeekRange(mockNow);
  assert.strictEqual(range.start.getUTCDay(), 1, 'Start should be Monday');
  assert.strictEqual(range.start.toISOString(), '2026-04-20T00:00:00.000Z');
});

test('getChangeDetectionRange returns current week + 4 weeks lookahead', () => {
  const mockNow = new Date('2026-04-21T14:00:00Z'); // Tuesday
  const result = getChangeDetectionRange(mockNow);
  assert.strictEqual(result.start.toISOString(), '2026-04-20T00:00:00.000Z');
  assert.strictEqual(result.end.toISOString(), '2026-05-24T23:59:59.999Z');
});

test('saveRunState and loadRunState via db.js', () => {
  const db = openDb(':memory:');
  const ts = new Date('2026-04-21T08:00:00Z');
  saveRunState(db, 'C123', 'weekly', ts);
  const loaded = loadRunState(db, 'C123', 'weekly');
  assert.ok(loaded instanceof Date);
  assert.strictEqual(loaded.toISOString(), ts.toISOString());
  db.close();
});

test('loadRunState returns null for unknown channel', () => {
  const db = openDb(':memory:');
  assert.strictEqual(loadRunState(db, 'C999', 'daily'), null);
  db.close();
});
