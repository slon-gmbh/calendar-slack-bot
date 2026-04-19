const { test } = require('node:test');
const assert = require('node:assert');
const {
  matchesSchedule,
  scheduleMatchesCron,
  classifyUrgency,
  shouldNotifyNow,
  hasRunToday,
  hasRunThisWeek,
  isDailySchedule
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

test('scheduleMatchesCron should match sunday schedule against sunday cron regardless of delay', () => {
  const sunday = new Date('2026-04-19T19:02:00Z'); // Sunday, 62 min after cron fired
  assert.ok(scheduleMatchesCron('sunday 18:00', '0 18 * * 0', sunday));
});

test('scheduleMatchesCron should not match on wrong day', () => {
  const monday = new Date('2026-04-20T18:00:00Z');
  assert.ok(!scheduleMatchesCron('sunday 18:00', '0 18 * * 0', monday));
});

test('scheduleMatchesCron should match weekdays schedule against weekday cron', () => {
  const monday = new Date('2026-04-14T09:15:00Z'); // Monday, 75 min after cron
  assert.ok(scheduleMatchesCron('weekdays 08:00', '0 8 * * 1-5', monday));
});

test('scheduleMatchesCron should not match weekday cron on weekend', () => {
  const saturday = new Date('2026-04-18T08:00:00Z');
  assert.ok(!scheduleMatchesCron('weekdays 08:00', '0 8 * * 1-5', saturday));
});

test('scheduleMatchesCron should not match when cron time differs from schedule time', () => {
  const sunday = new Date('2026-04-19T18:00:00Z');
  assert.ok(!scheduleMatchesCron('sunday 18:00', '0 8 * * 1-5', sunday));
});

test('scheduleMatchesCron should return false for missing args', () => {
  const now = new Date('2026-04-19T18:00:00Z');
  assert.ok(!scheduleMatchesCron(null, '0 18 * * 0', now));
  assert.ok(!scheduleMatchesCron('sunday 18:00', null, now));
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

test('hasRunToday should return false if no last run', () => {
  const result = hasRunToday(null);
  assert.equal(result, false);
});

test('hasRunToday should return true if run within last 20 hours', () => {
  const lastRun = new Date(Date.now() - 19 * 60 * 60 * 1000);
  const result = hasRunToday(lastRun);
  assert.equal(result, true);
});

test('hasRunToday should return false if run more than 20 hours ago', () => {
  const lastRun = new Date(Date.now() - 21 * 60 * 60 * 1000);
  const result = hasRunToday(lastRun);
  assert.equal(result, false);
});

test('hasRunThisWeek should return false if no last run', () => {
  const result = hasRunThisWeek(null);
  assert.equal(result, false);
});

test('hasRunThisWeek should return true if run within last 6 days', () => {
  const lastRun = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
  const result = hasRunThisWeek(lastRun);
  assert.equal(result, true);
});

test('hasRunThisWeek should return false if run more than 6 days ago', () => {
  const lastRun = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const result = hasRunThisWeek(lastRun);
  assert.equal(result, false);
});

test('hasRunThisWeek should use 7-day threshold', () => {
  const lastRun = new Date(Date.now() - 6.5 * 24 * 60 * 60 * 1000); // 6.5 days ago
  const result = hasRunThisWeek(lastRun);
  assert.equal(result, true); // Should still be true since < 7 days
});

test('hasRunToday should handle invalid date strings', () => {
  const result = hasRunToday('invalid-date-string');
  assert.equal(result, false);
});

test('hasRunThisWeek should handle invalid date strings', () => {
  const result = hasRunThisWeek('invalid-date-string');
  assert.equal(result, false);
});

test('isDailySchedule should return true for daily schedule', () => {
  assert.equal(isDailySchedule('daily'), true);
});

test('isDailySchedule should return true for weekdays schedule', () => {
  assert.equal(isDailySchedule('weekdays'), true);
});

test('isDailySchedule should return false for weekly schedule', () => {
  assert.equal(isDailySchedule('sunday 18:00'), false);
});

test('isDailySchedule should return false for null/false', () => {
  assert.equal(isDailySchedule(null), false);
  assert.equal(isDailySchedule(false), false);
});

test('isDailySchedule should return true for weekday cron', () => {
  assert.equal(isDailySchedule('0 8 * * 1-5'), true);
});

test('isDailySchedule should return true for daily cron', () => {
  assert.equal(isDailySchedule('0 8 * * *'), true);
});

test('isDailySchedule should return false for single-day cron', () => {
  assert.equal(isDailySchedule('0 18 * * 0'), false); // Sunday only
});

test('classifyUrgency should check all instances for recurring event', () => {
  const now = new Date('2026-04-01T12:00:00Z');

  const event = {
    id: 'recurring-123',
    title: 'Meeting',
    location: null,
    description: null,
    isAllDay: false,
    rrule: 'FREQ=WEEKLY;BYDAY=MO',
    instances: [
      { start: new Date('2026-04-01T18:00:00Z'), end: new Date('2026-04-01T19:00:00Z'), isException: false },
      { start: new Date('2026-04-07T18:00:00Z'), end: new Date('2026-04-07T19:00:00Z'), isException: false }
    ]
  };

  const urgency = classifyUrgency(event, now);

  assert.strictEqual(urgency, 'URGENT');
});

test('classifyUrgency should return THIS_WEEK if any instance in current week', () => {
  const now = new Date('2026-04-01T12:00:00Z');

  const event = {
    id: 'recurring-456',
    title: 'Meeting',
    location: null,
    description: null,
    isAllDay: false,
    rrule: 'FREQ=WEEKLY;BYDAY=FR',
    instances: [
      { start: new Date('2026-04-04T10:00:00Z'), end: new Date('2026-04-04T11:00:00Z'), isException: false },
      { start: new Date('2026-04-11T10:00:00Z'), end: new Date('2026-04-11T11:00:00Z'), isException: false }
    ]
  };

  const urgency = classifyUrgency(event, now);

  assert.strictEqual(urgency, 'THIS_WEEK');
});
