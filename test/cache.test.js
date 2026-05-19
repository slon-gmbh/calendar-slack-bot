const { test } = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db.js');
const { loadCacheState, saveCacheState } = require('../src/cache.js');

function memDb() {
  return openDb(':memory:');
}

test('loadCacheState returns null for unknown calendar', () => {
  const db = memDb();
  assert.strictEqual(loadCacheState(db, 'T_TEST', 'nonexistent'), null);
  db.close();
});

test('saveCacheState and loadCacheState round-trip with composite events', () => {
  const db = memDb();
  const events = [
    {
      id: 'e1',
      title: 'Meeting',
      location: null,
      description: null,
      isAllDay: false,
      rrule: null,
      instances: [
        { start: new Date('2026-04-21T10:00:00Z'), end: new Date('2026-04-21T11:00:00Z'), isException: false }
      ],
      calendarName: 'Team'
    }
  ];

  saveCacheState(db, 'T_TEST', 'cal-1', events, null, null);
  const result = loadCacheState(db, 'T_TEST', 'cal-1');

  assert.strictEqual(result.events.length, 1);
  assert.strictEqual(result.events[0].id, 'e1');
  assert.ok(Array.isArray(result.events[0].instances));
  assert.ok(result.events[0].instances[0].start instanceof Date);
  assert.strictEqual(result.events[0].instances[0].start.toISOString(), '2026-04-21T10:00:00.000Z');
  assert.ok(result.updated_at);
  assert.ok(!result.last_error);
  db.close();
});

test('saveCacheState persists error metadata', () => {
  const db = memDb();
  const errorState = { last_error: 'CalDAV timeout', error_notified_at: '2026-04-21T10:00:00Z' };

  saveCacheState(db, 'T_TEST', 'cal-err', [], errorState, null);
  const result = loadCacheState(db, 'T_TEST', 'cal-err');

  assert.strictEqual(result.last_error, 'CalDAV timeout');
  assert.strictEqual(result.error_notified_at, '2026-04-21T10:00:00Z');
  db.close();
});

test('saveCacheState persists color, loadCacheState includes it', () => {
  const db = memDb();
  const color = { hex: '#3498db', emoji: ':blue_circle:', source: 'caldav' };

  saveCacheState(db, 'T_TEST', 'cal-color', [], null, color);
  const result = loadCacheState(db, 'T_TEST', 'cal-color');

  assert.deepStrictEqual(result.color, color);
  db.close();
});

test('loadCacheState returns null color when none saved', () => {
  const db = memDb();
  saveCacheState(db, 'T_TEST', 'cal-nocolor', [], null, null);
  const result = loadCacheState(db, 'T_TEST', 'cal-nocolor');
  assert.strictEqual(result.color, null);
  db.close();
});
