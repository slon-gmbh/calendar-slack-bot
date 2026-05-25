process.env.ENCRYPTION_KEY = '0'.repeat(64);

const { test } = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db.js');
const { seedWorkspace } = require('../src/config.js');
const {
  scheduleWorkspace, scheduleAllWorkspaces, unscheduleWorkspace,
  stopAll, _setCronForTest, _jobCount, scheduleStringToCron
} = require('../src/scheduler-registry.js');

function makeMockCron() {
  const tasks = [];
  return {
    tasks,
    schedule(expr, handler) {
      const task = { expr, handler, stopped: false, stop() { this.stopped = true; } };
      tasks.push(task);
      return task;
    }
  };
}

function seedTestWorkspace(db, workspaceId) {
  seedWorkspace(db, workspaceId, {
    locale: 'en-US',
    caldav_credentials: { username: 'u', password: 'p' },
    calendars: { 'cal-1': { name: 'Cal', caldav_url: 'http://example.com/cal.ics' } },
    channels: [{
      id: 'C_TEST',
      canvas_id: 'F_TEST',
      calendars: ['cal-1'],
      digest_schedule: 'monday 09:00',
      daily_digest_schedule: 'daily 07:00'
    }]
  });
}

test('scheduleStringToCron converts sunday HH:MM to cron', () => {
  assert.strictEqual(scheduleStringToCron('sunday 18:00'), '0 18 * * 0');
});

test('scheduleStringToCron converts weekdays HH:MM to cron', () => {
  assert.strictEqual(scheduleStringToCron('weekdays 08:00'), '0 8 * * 1-5');
});

test('scheduleStringToCron passes through valid cron expression', () => {
  assert.strictEqual(scheduleStringToCron('0 18 * * 0'), '0 18 * * 0');
});

test('scheduleStringToCron throws on unrecognised string', () => {
  assert.throws(() => scheduleStringToCron('banana'), /Unrecognised schedule/);
});

test('scheduleWorkspace — registers digest + daily + change-detection jobs', () => {
  const mock = makeMockCron();
  _setCronForTest(mock);
  stopAll();
  const db = openDb(':memory:');
  seedTestWorkspace(db, 'T_REG');
  scheduleWorkspace(db, 'T_REG', false);
  assert.strictEqual(mock.tasks.length, 3, 'expected 3 jobs: digest, daily, change-detection');
  assert.strictEqual(_jobCount(), 1);
  assert.strictEqual(mock.tasks[0].expr, '0 9 * * 1', 'digest must be monday 09:00');
  assert.strictEqual(mock.tasks[1].expr, '0 7 * * *', 'daily must be 07:00');
  assert.strictEqual(mock.tasks[2].expr, '0 6-18/2 * * *', 'change-detection fixed schedule');
  _setCronForTest(null);
  stopAll();
  db.close();
});

test('scheduleWorkspace — idempotent: calling twice stops first set of jobs', () => {
  const mock = makeMockCron();
  _setCronForTest(mock);
  stopAll();
  const db = openDb(':memory:');
  seedTestWorkspace(db, 'T_IDEM');
  scheduleWorkspace(db, 'T_IDEM', false);
  const firstBatch = [...mock.tasks];
  scheduleWorkspace(db, 'T_IDEM', false);
  assert.ok(firstBatch.every(t => t.stopped), 'first batch must be stopped');
  assert.ok(mock.tasks.slice(3).every(t => !t.stopped), 'second batch must be running');
  assert.strictEqual(_jobCount(), 1);
  _setCronForTest(null);
  stopAll();
  db.close();
});

test('unscheduleWorkspace — stops all jobs; _jobCount drops to 0', () => {
  const mock = makeMockCron();
  _setCronForTest(mock);
  stopAll();
  const db = openDb(':memory:');
  seedTestWorkspace(db, 'T_UNSCHED');
  scheduleWorkspace(db, 'T_UNSCHED', false);
  assert.strictEqual(_jobCount(), 1);
  unscheduleWorkspace('T_UNSCHED');
  assert.strictEqual(_jobCount(), 0);
  assert.ok(mock.tasks.every(t => t.stopped));
  db.close();
  _setCronForTest(null);
});

test('unscheduleWorkspace — second call is a no-op (no error)', () => {
  stopAll();
  assert.doesNotThrow(() => unscheduleWorkspace('T_NONEXISTENT'));
});

test('scheduleAllWorkspaces — schedules both active workspaces', async () => {
  const mock = makeMockCron();
  _setCronForTest(mock);
  stopAll();
  const db = openDb(':memory:');
  seedTestWorkspace(db, 'T_ALL_A');
  seedTestWorkspace(db, 'T_ALL_B');
  await scheduleAllWorkspaces(db, false);
  assert.strictEqual(_jobCount(), 2, 'two workspaces must have jobs registered');
  _setCronForTest(null);
  stopAll();
  db.close();
});

test('stopAll — stops all jobs and clears JOBS map', () => {
  const mock = makeMockCron();
  _setCronForTest(mock);
  stopAll();
  const db = openDb(':memory:');
  seedTestWorkspace(db, 'T_STOP_A');
  seedTestWorkspace(db, 'T_STOP_B');
  scheduleWorkspace(db, 'T_STOP_A', false);
  scheduleWorkspace(db, 'T_STOP_B', false);
  assert.strictEqual(_jobCount(), 2);
  stopAll();
  assert.strictEqual(_jobCount(), 0);
  assert.ok(mock.tasks.every(t => t.stopped), 'all tasks must be stopped');
  _setCronForTest(null);
  db.close();
});
