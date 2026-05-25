const { test } = require('node:test');
const assert = require('node:assert');
const { openDb, loadEvents, saveEvents, loadColor, saveColor, loadRunState, saveRunState, loadPending, savePending, getWorkspace, upsertWorkspace } = require('../src/db.js');

process.env.ENCRYPTION_KEY = '0'.repeat(64);

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

test('upsertWorkspace encrypts bot_token — raw stored value differs from plaintext', () => {
  const db = memDb();
  upsertWorkspace(db, { teamId: 'T_ENC', teamName: 'Enc Test', botToken: 'xoxb-plaintext-token' });
  const raw = db.prepare('SELECT bot_token FROM workspaces WHERE team_id = ?').get('T_ENC');
  assert.notStrictEqual(raw.bot_token, 'xoxb-plaintext-token');
  assert.ok(raw.bot_token.includes(':'), 'stored value must be in iv:ct:tag format');
  db.close();
});

test('getWorkspace decrypts bot_token — returns original plaintext', () => {
  const db = memDb();
  upsertWorkspace(db, { teamId: 'T_DEC', teamName: 'Dec Test', botToken: 'xoxb-plaintext-token' });
  const row = getWorkspace(db, 'T_DEC');
  assert.strictEqual(row.bot_token, 'xoxb-plaintext-token');
  db.close();
});

const { upsertCaldavCredentials, getCaldavCredentials } = require('../src/db.js');

test('upsertCaldavCredentials encrypts password — raw stored value differs from plaintext', () => {
  const db = memDb();
  upsertWorkspace(db, { teamId: 'T_CRED', teamName: 'Cred Test' });
  upsertCaldavCredentials(db, 'T_CRED', 'admin', 'super-secret-pass');
  const raw = db.prepare('SELECT password FROM caldav_credentials WHERE workspace_id = ?').get('T_CRED');
  assert.notStrictEqual(raw.password, 'super-secret-pass');
  assert.ok(raw.password.includes(':'), 'stored value must be in iv:ct:tag format');
  db.close();
});

test('getCaldavCredentials decrypts password — returns original plaintext', () => {
  const db = memDb();
  upsertWorkspace(db, { teamId: 'T_CRED2', teamName: 'Cred Test 2' });
  upsertCaldavCredentials(db, 'T_CRED2', 'user@example.com', 'super-secret-pass');
  const creds = getCaldavCredentials(db, 'T_CRED2');
  assert.strictEqual(creds.username, 'user@example.com');
  assert.strictEqual(creds.password, 'super-secret-pass');
  db.close();
});

test('getCaldavCredentials returns null for unknown workspace', () => {
  const db = memDb();
  assert.strictEqual(getCaldavCredentials(db, 'T_NONE'), null);
  db.close();
});

test('upsertCaldavCredentials is idempotent — updates on conflict', () => {
  const db = memDb();
  upsertWorkspace(db, { teamId: 'T_IDEM', teamName: 'Idem Test' });
  upsertCaldavCredentials(db, 'T_IDEM', 'user1', 'pass1');
  upsertCaldavCredentials(db, 'T_IDEM', 'user2', 'pass2');
  const creds = getCaldavCredentials(db, 'T_IDEM');
  assert.strictEqual(creds.username, 'user2');
  assert.strictEqual(creds.password, 'pass2');
  db.close();
});

const { upsertWorkspaceFromOAuth, listActiveWorkspaces, markWorkspaceInactive } = require('../src/db.js');

test('upsertWorkspaceFromOAuth stores workspace with encrypted bot_token', () => {
  const db = memDb();
  upsertWorkspaceFromOAuth(db, { teamId: 'T_OAUTH1', teamName: 'Acme', botToken: 'xoxb-live-token', installedBy: 'U_ADMIN' });
  const raw = db.prepare('SELECT bot_token FROM workspaces WHERE team_id = ?').get('T_OAUTH1');
  assert.ok(raw, 'row should exist');
  assert.notStrictEqual(raw.bot_token, 'xoxb-live-token', 'stored value must be encrypted');
  assert.ok(raw.bot_token.includes(':'), 'stored value must be in iv:ct:tag format');
  db.close();
});

test('upsertWorkspaceFromOAuth — getWorkspace decrypts bot_token', () => {
  const db = memDb();
  upsertWorkspaceFromOAuth(db, { teamId: 'T_OAUTH2', teamName: 'Beta', botToken: 'xoxb-decryptme', installedBy: 'U_ADMIN' });
  const ws = getWorkspace(db, 'T_OAUTH2');
  assert.strictEqual(ws.bot_token, 'xoxb-decryptme');
  db.close();
});

test('upsertWorkspaceFromOAuth — re-install updates bot_token and sets active=1', () => {
  const db = memDb();
  upsertWorkspaceFromOAuth(db, { teamId: 'T_REINSTALL', teamName: 'Gamma', botToken: 'xoxb-old', installedBy: 'U_ADMIN' });
  db.prepare('UPDATE workspaces SET active = 0 WHERE team_id = ?').run('T_REINSTALL');
  upsertWorkspaceFromOAuth(db, { teamId: 'T_REINSTALL', teamName: 'Gamma Renamed', botToken: 'xoxb-new', installedBy: 'U_ADMIN2' });
  const ws = getWorkspace(db, 'T_REINSTALL');
  assert.strictEqual(ws.bot_token, 'xoxb-new');
  assert.strictEqual(ws.active, 1);
  assert.strictEqual(ws.team_name, 'Gamma Renamed');
  db.close();
});

test('listActiveWorkspaces returns only active rows with decrypted tokens', () => {
  const db = memDb();
  upsertWorkspaceFromOAuth(db, { teamId: 'T_ACTIVE', teamName: 'Active', botToken: 'xoxb-active', installedBy: 'U1' });
  upsertWorkspaceFromOAuth(db, { teamId: 'T_INACTIVE', teamName: 'Inactive', botToken: 'xoxb-inactive', installedBy: 'U2' });
  db.prepare('UPDATE workspaces SET active = 0 WHERE team_id = ?').run('T_INACTIVE');
  const workspaces = listActiveWorkspaces(db);
  assert.strictEqual(workspaces.length, 1);
  assert.strictEqual(workspaces[0].team_id, 'T_ACTIVE');
  assert.strictEqual(workspaces[0].bot_token, 'xoxb-active');
  db.close();
});

test('listActiveWorkspaces returns empty array when no active workspaces', () => {
  const db = memDb();
  const workspaces = listActiveWorkspaces(db);
  assert.deepStrictEqual(workspaces, []);
  db.close();
});

test('markWorkspaceInactive sets active = 0 for the given team_id', () => {
  const db = memDb();
  upsertWorkspaceFromOAuth(db, { teamId: 'T_INACT', teamName: 'Bye', botToken: 'xoxb-bye', installedBy: 'U1' });
  markWorkspaceInactive(db, 'T_INACT');
  const raw = db.prepare('SELECT active FROM workspaces WHERE team_id = ?').get('T_INACT');
  assert.strictEqual(raw.active, 0);
  db.close();
});

test('markWorkspaceInactive — no-op for unknown team_id (no error)', () => {
  const db = memDb();
  assert.doesNotThrow(() => markWorkspaceInactive(db, 'T_GHOST'));
  db.close();
});

test('listActiveWorkspaces excludes workspace marked inactive via markWorkspaceInactive', () => {
  const db = memDb();
  upsertWorkspaceFromOAuth(db, { teamId: 'T_STAYS', teamName: 'Active', botToken: 'xoxb-a', installedBy: 'U1' });
  upsertWorkspaceFromOAuth(db, { teamId: 'T_GONE',  teamName: 'Gone',   botToken: 'xoxb-b', installedBy: 'U2' });
  markWorkspaceInactive(db, 'T_GONE');
  const rows = listActiveWorkspaces(db);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].team_id, 'T_STAYS');
  db.close();
});
