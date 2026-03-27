const { test } = require('node:test');
const assert = require('node:assert');

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
