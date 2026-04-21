const { test } = require('node:test');
const assert = require('node:assert');
const { openDb, loadEvents, saveEvents, loadColor, saveColor, loadRunState, saveRunState, loadPending, savePending } = require('../src/db.js');

function memDb() {
  return openDb(':memory:');
}

test('openDb creates schema tables', () => {
  const db = memDb();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  assert.ok(tables.includes('events'));
  assert.ok(tables.includes('color_cache'));
  assert.ok(tables.includes('run_state'));
  assert.ok(tables.includes('pending_notifications'));
  db.close();
});

test('saveEvents and loadEvents round-trip', () => {
  const db = memDb();
  const events = [
    { id: 'e1', title: 'Standup', instances: [{ start: new Date('2026-04-21T09:00:00Z'), end: new Date('2026-04-21T09:30:00Z'), isException: false }] }
  ];
  saveEvents(db, 'cal-1', events, null);
  const result = loadEvents(db, 'cal-1');
  assert.strictEqual(result.events.length, 1);
  assert.strictEqual(result.events[0].id, 'e1');
  assert.ok(result.events[0].instances[0].start instanceof Date);
  assert.strictEqual(result.events[0].instances[0].start.toISOString(), '2026-04-21T09:00:00.000Z');
  assert.ok(result.updated_at);
  assert.strictEqual(result.last_error, undefined);
  db.close();
});

test('loadEvents returns null for unknown calendarId', () => {
  const db = memDb();
  const result = loadEvents(db, 'nonexistent');
  assert.strictEqual(result, null);
  db.close();
});

test('saveEvents persists error state', () => {
  const db = memDb();
  saveEvents(db, 'cal-err', [], { last_error: 'timeout', error_notified_at: '2026-04-21T10:00:00Z' });
  const result = loadEvents(db, 'cal-err');
  assert.strictEqual(result.last_error, 'timeout');
  assert.strictEqual(result.error_notified_at, '2026-04-21T10:00:00Z');
  db.close();
});

test('saveColor and loadColor round-trip', () => {
  const db = memDb();
  const color = { hex: '#ff0000', emoji: ':red_circle:', source: 'caldav' };
  saveColor(db, 'cal-1', color);
  const result = loadColor(db, 'cal-1');
  assert.deepStrictEqual(result, color);
  db.close();
});

test('loadColor returns null for unknown calendarId', () => {
  const db = memDb();
  assert.strictEqual(loadColor(db, 'nonexistent'), null);
  db.close();
});

test('saveRunState and loadRunState round-trip', () => {
  const db = memDb();
  const ts = new Date('2026-04-21T08:00:00Z');
  saveRunState(db, 'C123', 'daily', ts);
  const result = loadRunState(db, 'C123', 'daily');
  assert.ok(result instanceof Date);
  assert.strictEqual(result.toISOString(), ts.toISOString());
  db.close();
});

test('loadRunState returns null for unknown channel', () => {
  const db = memDb();
  assert.strictEqual(loadRunState(db, 'C999', 'daily'), null);
  db.close();
});

test('savePending and loadPending round-trip within 5 min window', () => {
  const db = memDb();
  const diffs = [{ type: 'new', event: { id: 'e1' } }];
  savePending(db, 'C123', diffs, new Date());
  const result = loadPending(db, 'C123');
  assert.strictEqual(result.expired, false);
  assert.strictEqual(result.diffs.length, 1);
  assert.strictEqual(result.diffs[0].type, 'new');
  db.close();
});

test('loadPending returns expired=true when timestamp older than 5 min', () => {
  const db = memDb();
  const oldTs = new Date(Date.now() - 6 * 60 * 1000);
  savePending(db, 'C123', [{ type: 'new', event: { id: 'e1' } }], oldTs);
  const result = loadPending(db, 'C123');
  assert.strictEqual(result.expired, true);
  assert.strictEqual(result.diffs.length, 1);
  db.close();
});

test('loadPending returns empty diffs for unknown channel', () => {
  const db = memDb();
  const result = loadPending(db, 'C999');
  assert.strictEqual(result.expired, false);
  assert.deepStrictEqual(result.diffs, []);
  db.close();
});

test('savePending second write overwrites first (upsert resets timer)', () => {
  const db = memDb();
  const oldTs = new Date(Date.now() - 6 * 60 * 1000);
  savePending(db, 'C123', [{ type: 'new', event: { id: 'e1' } }], oldTs);
  savePending(db, 'C123', [{ type: 'deleted', event: { id: 'e2' } }], new Date());
  const result = loadPending(db, 'C123');
  assert.strictEqual(result.expired, false);
  assert.strictEqual(result.diffs.length, 1);
  assert.strictEqual(result.diffs[0].type, 'deleted');
  db.close();
});
