const { test } = require('node:test');
const assert = require('node:assert');
const {
  matchesSchedule,
  classifyUrgency,
  shouldNotifyNow
} = require('../src/scheduler.js');

test('matchesSchedule should match within ±30 min tolerance', () => {
  const schedule = 'monday 14:00';
  const mondayAt1400 = new Date('2026-03-23T14:00:00Z'); // Monday
  const mondayAt1410 = new Date('2026-03-23T14:10:00Z'); // 10 min after
  const mondayAt1345 = new Date('2026-03-23T13:45:00Z'); // 15 min before
  const mondayAt1435 = new Date('2026-03-23T14:35:00Z'); // 35 min after (outside)

  assert.ok(matchesSchedule(schedule, mondayAt1400, 'en-US'));
  assert.ok(matchesSchedule(schedule, mondayAt1410, 'en-US'));
  assert.ok(matchesSchedule(schedule, mondayAt1345, 'en-US'));
  assert.ok(!matchesSchedule(schedule, mondayAt1435, 'en-US'));
});

test('matchesSchedule should handle weekdays schedule', () => {
  const schedule = 'weekdays 08:00';
  const mondayAt8 = new Date('2026-03-23T08:00:00Z'); // Monday
  const saturdayAt8 = new Date('2026-03-28T08:00:00Z'); // Saturday

  assert.ok(matchesSchedule(schedule, mondayAt8, 'en-US'));
  assert.ok(!matchesSchedule(schedule, saturdayAt8, 'en-US'));
});

test('matchesSchedule should handle cron format', () => {
  const schedule = '0 18 * * 0'; // Sunday at 18:00
  const sundayAt18 = new Date('2026-03-29T18:00:00Z'); // Sunday
  const mondayAt18 = new Date('2026-03-30T18:00:00Z'); // Monday

  assert.ok(matchesSchedule(schedule, sundayAt18, 'en-US'));
  assert.ok(!matchesSchedule(schedule, mondayAt18, 'en-US'));
});

test('classifyUrgency should return URGENT for events within 24h', () => {
  const now = new Date();
  const in20Hours = new Date(now.getTime() + 20 * 60 * 60 * 1000);

  const event = { start: in20Hours };
  const channelConfig = {
    daily_digest_schedule: 'weekdays 08:00',
    digest_schedule: 'sunday 18:00'
  };

  assert.strictEqual(classifyUrgency(event, channelConfig), 'URGENT');
});

test('classifyUrgency should return THIS_WEEK for events within current week', () => {
  // Use fixed dates to ensure event is within the same week
  // Week: Monday Mar 23 - Sunday Mar 29, 2026
  const wednesday = new Date('2026-03-25T10:00:00Z'); // Wednesday
  const friday = new Date('2026-03-27T14:00:00Z'); // Friday (2 days later, same week)

  const event = { start: friday };
  const channelConfig = {
    daily_digest_schedule: 'weekdays 08:00',
    digest_schedule: 'sunday 18:00'
  };

  // Mock the current time by temporarily replacing Date
  const OriginalDate = global.Date;
  global.Date = class extends OriginalDate {
    constructor(...args) {
      if (args.length === 0) {
        return wednesday;
      }
      return new OriginalDate(...args);
    }
    static now() {
      return wednesday.getTime();
    }
  };

  const result = classifyUrgency(event, channelConfig);

  // Restore original Date
  global.Date = OriginalDate;

  assert.strictEqual(result, 'THIS_WEEK');
});

test('shouldNotifyNow should respect notifications setting', () => {
  const diff = { type: 'new', event: { start: new Date() } };
  const disabledConfig = { notifications: 'disabled' };
  const weeklyConfig = { notifications: 'weekly' };
  const allConfig = { notifications: 'all' };

  assert.ok(!shouldNotifyNow(diff, disabledConfig));
  assert.ok(!shouldNotifyNow(diff, weeklyConfig));
  assert.ok(shouldNotifyNow(diff, allConfig));
});
