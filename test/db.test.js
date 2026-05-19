const { test } = require('node:test');
const assert = require('node:assert');
const { openDb, loadEvents, saveEvents, loadColor, saveColor, loadRunState, saveRunState, loadPending, savePending, getWorkspace, upsertWorkspace } = require('../src/db.js');

function memDb() {
  return openDb(':memory:');
}

test('openDb creates schema tables', () => {
  const db = memDb();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
  const expected = [
    'caldav_credentials', 'calendars', 'channel_calendars', 'channels',
    'color_cache', 'events', 'pending_notifications', 'run_state', 'workspaces'
  ];
  assert.deepStrictEqual(tables.sort(), expected);
  db.close();
});

test('openDb sets schema user_version to 1', () => {
  const db = memDb();
  assert.strictEqual(db.pragma('user_version', { simple: true }), 1);
  db.close();
});

test('saveEvents and loadEvents round-trip', () => {
  const db = memDb();
  const events = [
    { id: 'e1', title: 'Standup', instances: [{ start: new Date('2026-04-21T09:00:00Z'), end: new Date('2026-04-21T09:30:00Z'), isException: false }] }
  ];
  saveEvents(db, 'T_TEST', 'cal-1', events, null);
  const result = loadEvents(db, 'T_TEST', 'cal-1');
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
  const result = loadEvents(db, 'T_TEST', 'nonexistent');
  assert.strictEqual(result, null);
  db.close();
});

test('saveEvents persists error state', () => {
  const db = memDb();
  saveEvents(db, 'T_TEST', 'cal-err', [], { last_error: 'timeout', error_notified_at: '2026-04-21T10:00:00Z' });
  const result = loadEvents(db, 'T_TEST', 'cal-err');
  assert.strictEqual(result.last_error, 'timeout');
  assert.strictEqual(result.error_notified_at, '2026-04-21T10:00:00Z');
  db.close();
});

test('saveColor and loadColor round-trip', () => {
  const db = memDb();
  const color = { hex: '#ff0000', emoji: ':red_circle:', source: 'caldav' };
  saveColor(db, 'T_TEST', 'cal-1', color);
  const result = loadColor(db, 'T_TEST', 'cal-1');
  assert.deepStrictEqual(result, color);
  db.close();
});

test('loadColor returns null for unknown calendarId', () => {
  const db = memDb();
  assert.strictEqual(loadColor(db, 'T_TEST', 'nonexistent'), null);
  db.close();
});

test('saveRunState and loadRunState round-trip', () => {
  const db = memDb();
  const ts = new Date('2026-04-21T08:00:00Z');
  saveRunState(db, 'T_TEST', 'C123', 'daily', ts);
  const result = loadRunState(db, 'T_TEST', 'C123', 'daily');
  assert.ok(result instanceof Date);
  assert.strictEqual(result.toISOString(), ts.toISOString());
  db.close();
});

test('loadRunState returns null for unknown channel', () => {
  const db = memDb();
  assert.strictEqual(loadRunState(db, 'T_TEST', 'C999', 'daily'), null);
  db.close();
});

test('savePending and loadPending round-trip within 5 min window', () => {
  const db = memDb();
  const diffs = [{ type: 'new', event: { id: 'e1' } }];
  savePending(db, 'T_TEST', 'C123', diffs, new Date());
  const result = loadPending(db, 'T_TEST', 'C123');
  assert.strictEqual(result.expired, false);
  assert.strictEqual(result.diffs.length, 1);
  assert.strictEqual(result.diffs[0].type, 'new');
  db.close();
});

test('loadPending returns expired=true when timestamp older than 5 min', () => {
  const db = memDb();
  const oldTs = new Date(Date.now() - 6 * 60 * 1000);
  savePending(db, 'T_TEST', 'C123', [{ type: 'new', event: { id: 'e1' } }], oldTs);
  const result = loadPending(db, 'T_TEST', 'C123');
  assert.strictEqual(result.expired, true);
  assert.strictEqual(result.diffs.length, 1);
  db.close();
});

test('loadPending returns empty diffs for unknown channel', () => {
  const db = memDb();
  const result = loadPending(db, 'T_TEST', 'C999');
  assert.strictEqual(result.expired, false);
  assert.deepStrictEqual(result.diffs, []);
  db.close();
});

test('savePending second write overwrites first (upsert resets timer)', () => {
  const db = memDb();
  const oldTs = new Date(Date.now() - 6 * 60 * 1000);
  savePending(db, 'T_TEST', 'C123', [{ type: 'new', event: { id: 'e1' } }], oldTs);
  savePending(db, 'T_TEST', 'C123', [{ type: 'deleted', event: { id: 'e2' } }], new Date());
  const result = loadPending(db, 'T_TEST', 'C123');
  assert.strictEqual(result.expired, false);
  assert.strictEqual(result.diffs.length, 1);
  assert.strictEqual(result.diffs[0].type, 'deleted');
  db.close();
});

test('workspace isolation: events not visible across workspaces', () => {
  const db = memDb();
  const events = [{ id: 'e1', instances: [] }];
  saveEvents(db, 'T_A', 'cal-1', events, null);
  assert.strictEqual(loadEvents(db, 'T_B', 'cal-1'), null);
  db.close();
});

test('workspace isolation: colors not visible across workspaces', () => {
  const db = memDb();
  saveColor(db, 'T_A', 'cal-1', { hex: '#ff0000', emoji: ':red:', source: 'caldav' });
  assert.strictEqual(loadColor(db, 'T_B', 'cal-1'), null);
  db.close();
});

test('workspace isolation: run_state not visible across workspaces', () => {
  const db = memDb();
  saveRunState(db, 'T_A', 'C123', 'weekly', new Date('2026-05-01T00:00:00Z'));
  assert.strictEqual(loadRunState(db, 'T_B', 'C123', 'weekly'), null);
  db.close();
});

test('workspace isolation: pending_notifications not visible across workspaces', () => {
  const db = memDb();
  savePending(db, 'T_A', 'C123', [{ type: 'new' }], new Date());
  const result = loadPending(db, 'T_B', 'C123');
  assert.deepStrictEqual(result.diffs, []);
  db.close();
});

test('getWorkspace returns null for unknown workspace', () => {
  const db = memDb();
  assert.strictEqual(getWorkspace(db, 'T_UNKNOWN'), null);
  db.close();
});

test('upsertWorkspace and getWorkspace round-trip', () => {
  const db = memDb();
  upsertWorkspace(db, { teamId: 'T_123', teamName: 'Test Team', locale: 'de-DE', timezone: 'Europe/Berlin' });
  const row = getWorkspace(db, 'T_123');
  assert.ok(row);
  assert.strictEqual(row.team_id, 'T_123');
  assert.strictEqual(row.team_name, 'Test Team');
  assert.strictEqual(row.locale, 'de-DE');
  assert.strictEqual(row.timezone, 'Europe/Berlin');
  assert.strictEqual(row.active, 1);
  assert.ok(row.installed_at);
  db.close();
});

test('upsertWorkspace is idempotent — bot_token not overwritten on re-upsert', () => {
  const db = memDb();
  upsertWorkspace(db, { teamId: 'T_123', teamName: 'Test Team', botToken: 'xoxb-secret' });
  upsertWorkspace(db, { teamId: 'T_123', teamName: 'Updated Name' });
  const row = getWorkspace(db, 'T_123');
  assert.strictEqual(row.team_name, 'Updated Name');
  assert.strictEqual(row.bot_token, 'xoxb-secret');  // preserved
  db.close();
});
