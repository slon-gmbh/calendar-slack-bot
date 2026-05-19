const { test } = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db.js');
const { loadConfigFromDb, seedWorkspace, validateConfig } = require('../src/config.js');

const FIXTURE_CONFIG = {
  workspace_id: 'T_TEST',
  locale: 'en-US',
  timezone: 'Europe/Berlin',
  error_channel: 'C_ERR',
  caldav_credentials: { username: 'admin', password: 'secret' },
  calendars: {
    'team': { name: 'Team', caldav_url: 'https://nc.example.com/cal/team', caldav_metadata_url: 'https://nc.example.com/dav/team', color: '#2D73BE' },
    'vorstand': { name: 'Vorstand', caldav_url: 'https://nc.example.com/cal/vorstand', color: '#B6469D' }
  },
  channels: [
    {
      id: 'C_CH1', name: '#test', canvas_id: 'F_CV1', canvas_url: 'https://slack.com/cv/F_CV1',
      calendars: ['team', 'vorstand'], locale: 'de-DE',
      digest_schedule: 'sunday 18:00', daily_digest_schedule: 'weekdays 08:00',
      show_empty_days: false, notifications: 'all',
      view: 'merged', event_detail: 'standard', digest_style: 'full', digest_format: 'week_view'
    },
    {
      id: 'C_CH2', name: '#second', canvas_id: 'F_CV2',
      calendars: ['team'],
      digest_schedule: 'sunday 18:00', daily_digest_schedule: false,
      show_empty_days: false, notifications: 'all'
    }
  ]
};

function memDb() {
  return openDb(':memory:');
}

test('seedWorkspace inserts all config data into the database', () => {
  const db = memDb();
  seedWorkspace(db, 'T_TEST', FIXTURE_CONFIG);

  const ws = db.prepare('SELECT * FROM workspaces WHERE team_id = ?').get('T_TEST');
  assert.ok(ws);
  assert.strictEqual(ws.locale, 'en-US');
  assert.strictEqual(ws.timezone, 'Europe/Berlin');
  assert.strictEqual(ws.error_channel, 'C_ERR');

  const creds = db.prepare('SELECT * FROM caldav_credentials WHERE workspace_id = ?').get('T_TEST');
  assert.strictEqual(creds.username, 'admin');
  assert.strictEqual(creds.password, 'secret');

  const cals = db.prepare('SELECT * FROM calendars WHERE workspace_id = ? ORDER BY calendar_id').all('T_TEST');
  assert.strictEqual(cals.length, 2);
  assert.strictEqual(cals[0].calendar_id, 'team');
  assert.strictEqual(cals[1].calendar_id, 'vorstand');

  const channels = db.prepare('SELECT * FROM channels WHERE workspace_id = ?').all('T_TEST');
  assert.strictEqual(channels.length, 2);

  const ccRows = db.prepare('SELECT * FROM channel_calendars WHERE workspace_id = ? AND channel_id = ?').all('T_TEST', 'C_CH1');
  const ccCalIds = ccRows.map(r => r.calendar_id).sort();
  assert.deepStrictEqual(ccCalIds, ['team', 'vorstand']);

  db.close();
});

test('seedWorkspace is idempotent', () => {
  const db = memDb();
  seedWorkspace(db, 'T_TEST', FIXTURE_CONFIG);
  seedWorkspace(db, 'T_TEST', FIXTURE_CONFIG);
  const cals = db.prepare('SELECT * FROM calendars WHERE workspace_id = ?').all('T_TEST');
  assert.strictEqual(cals.length, 2);
  db.close();
});

test('loadConfigFromDb returns same shape as loadConfig', () => {
  const db = memDb();
  seedWorkspace(db, 'T_TEST', FIXTURE_CONFIG);
  const config = loadConfigFromDb(db, 'T_TEST');

  assert.strictEqual(config.workspace_id, 'T_TEST');
  assert.strictEqual(config.locale, 'en-US');
  assert.strictEqual(config.timezone, 'Europe/Berlin');
  assert.strictEqual(config.error_channel, 'C_ERR');
  assert.strictEqual(config.caldav_credentials.username, 'admin');
  assert.strictEqual(config.caldav_credentials.password, 'secret');
  assert.ok(config.calendars['team']);
  assert.strictEqual(config.calendars['team'].name, 'Team');
  assert.ok(config.calendars['vorstand']);
  assert.strictEqual(Array.isArray(config.channels), true);
  assert.strictEqual(config.channels.length, 2);

  const ch1 = config.channels.find(c => c.id === 'C_CH1');
  assert.ok(ch1);
  assert.deepStrictEqual(ch1.calendars.sort(), ['team', 'vorstand']);
  assert.strictEqual(ch1.digest_schedule, 'sunday 18:00');
  assert.strictEqual(ch1.show_empty_days, false);

  const ch2 = config.channels.find(c => c.id === 'C_CH2');
  assert.strictEqual(ch2.daily_digest_schedule, false);

  db.close();
});

test('loadConfigFromDb throws for unknown workspaceId', () => {
  const db = memDb();
  assert.throws(
    () => loadConfigFromDb(db, 'T_MISSING'),
    /Workspace not found: T_MISSING/
  );
  db.close();
});

test('loadConfigFromDb output passes validateConfig', () => {
  const db = memDb();
  seedWorkspace(db, 'T_TEST', FIXTURE_CONFIG);
  const config = loadConfigFromDb(db, 'T_TEST');
  assert.doesNotThrow(() => validateConfig(config));
  db.close();
});
