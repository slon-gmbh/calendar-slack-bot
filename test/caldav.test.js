const assert = require('node:assert/strict');
const { test } = require('node:test');
const ical = require('node-ical');
const { fetchCalendar, normalizeEvent } = require('../src/caldav.js');

/**
 * Test recurring events with EXDATE and RECURRENCE-ID
 *
 * This tests the fix for issue #1:
 * - Recurring events with exceptions (EXDATE) should not include those dates
 * - Recurring events with modified occurrences (RECURRENCE-ID) should show the modified version
 */

test('recurring event with EXDATE excludes deleted occurrences', async () => {
  // Create test iCal data with a weekly recurring event and one deleted occurrence
  const testIcal = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:test-recurring-with-exdate
SUMMARY:Weekly Meeting
DTSTART:20260330T140000Z
DTEND:20260330T150000Z
RRULE:FREQ=WEEKLY;COUNT=4
EXDATE:20260406T140000Z
END:VEVENT
END:VCALENDAR`;

  // Mock fetch to return our test iCal data
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    text: async () => testIcal
  });

  try {
    const events = await fetchCalendar(
      'https://test.example.com/calendar',
      { username: 'test', password: 'test' },
      { start: new Date('2026-03-29'), end: new Date('2026-04-21') },
      'UTC'
    );

    // Should have 1 composite event with 3 instances (4 total minus 1 EXDATE)
    // March 30, April 13, April 20 (NOT April 6)
    assert.equal(events.length, 1, 'Should have 1 composite event');
    assert.equal(events[0].instances.length, 3, 'Should have 3 instances (excluding EXDATE)');

    const dates = events[0].instances.map(i => i.start.toISOString().substring(0, 10)).sort();
    assert.deepEqual(dates, ['2026-03-30', '2026-04-13', '2026-04-20'],
      'Should exclude April 6 (EXDATE)');
  } finally {
    global.fetch = originalFetch;
  }
});

test('recurring event with RECURRENCE-ID shows modified occurrence', async () => {
  // Create test iCal with a weekly recurring event and one modified occurrence
  const testIcal = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:test-recurring-base
SUMMARY:Team Standup
DTSTART:20260330T090000Z
DTEND:20260330T093000Z
RRULE:FREQ=WEEKLY;COUNT=3
END:VEVENT
BEGIN:VEVENT
UID:test-recurring-base
RECURRENCE-ID:20260406T090000Z
SUMMARY:Team Standup (Extended)
DTSTART:20260406T090000Z
DTEND:20260406T110000Z
END:VEVENT
END:VCALENDAR`;

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    text: async () => testIcal
  });

  try {
    const events = await fetchCalendar(
      'https://test.example.com/calendar',
      { username: 'test', password: 'test' },
      { start: new Date('2026-03-29'), end: new Date('2026-04-15') },
      'UTC'
    );

    // Should have 1 composite event with 3 instances total
    assert.equal(events.length, 1, 'Should have 1 composite event');
    assert.equal(events[0].instances.length, 3, 'Should have 3 instances');

    // Find April 6 instance
    const april6 = events[0].instances.find(i =>
      i.start.toISOString().startsWith('2026-04-06')
    );

    assert.ok(april6, 'April 6 occurrence should exist');
    assert.ok(april6.isException, 'April 6 should be marked as exception');

    // Modified occurrence is 2 hours long (not 30 minutes)
    const duration = april6.end.getTime() - april6.start.getTime();
    assert.equal(duration, 2 * 60 * 60 * 1000,
      'Modified occurrence should be 2 hours long');
  } finally {
    global.fetch = originalFetch;
  }
});

test('recurring event with both EXDATE and RECURRENCE-ID', async () => {
  // Complex case: weekly event with one deleted, one modified
  const testIcal = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:test-complex-recurring
SUMMARY:Project Review
DTSTART:20260330T140000Z
DTEND:20260330T150000Z
RRULE:FREQ=WEEKLY;COUNT=4
EXDATE:20260413T140000Z
END:VEVENT
BEGIN:VEVENT
UID:test-complex-recurring
RECURRENCE-ID:20260406T140000Z
SUMMARY:Project Review (Rescheduled)
DTSTART:20260406T160000Z
DTEND:20260406T170000Z
END:VEVENT
END:VCALENDAR`;

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    text: async () => testIcal
  });

  try {
    const events = await fetchCalendar(
      'https://test.example.com/calendar',
      { username: 'test', password: 'test' },
      { start: new Date('2026-03-29'), end: new Date('2026-04-25') },
      'UTC'
    );

    // Should have 1 composite event with 3 instances: Mar 30 (original), Apr 6 (modified), Apr 20 (original)
    // April 13 excluded by EXDATE
    assert.equal(events.length, 1, 'Should have 1 composite event');
    assert.equal(events[0].instances.length, 3, 'Should have 3 instances');

    const april6 = events[0].instances.find(i =>
      i.start.toISOString().startsWith('2026-04-06')
    );

    assert.ok(april6, 'April 6 should exist');
    assert.ok(april6.isException, 'April 6 should be marked as exception');
    assert.match(april6.start.toISOString(), /16:00:00/,
      'April 6 should be rescheduled to 16:00');

    const april13 = events[0].instances.find(i =>
      i.start.toISOString().startsWith('2026-04-13')
    );
    assert.equal(april13, undefined, 'April 13 should be excluded');
  } finally {
    global.fetch = originalFetch;
  }
});

test('normalizeEvent should return composite structure for non-recurring event', () => {
  const icalEvent = {
    uid: 'test-event-123',
    summary: 'Test Meeting',
    start: new Date('2026-04-02T10:00:00Z'),
    end: new Date('2026-04-02T11:00:00Z'),
    location: 'Office',
    description: 'Test description',
    datetype: 'date-time',
    rrule: null
  };

  const result = normalizeEvent(icalEvent, null, 'UTC');

  assert.strictEqual(result.id, 'test-event-123');
  assert.strictEqual(result.title, 'Test Meeting');
  assert.strictEqual(result.location, 'Office');
  assert.strictEqual(result.description, 'Test description');
  assert.strictEqual(result.isAllDay, false);
  assert.strictEqual(result.rrule, null);
  assert.ok(Array.isArray(result.instances));
  assert.strictEqual(result.instances.length, 1);
  assert.strictEqual(result.instances[0].start.toISOString(), '2026-04-02T10:00:00.000Z');
  assert.strictEqual(result.instances[0].end.toISOString(), '2026-04-02T11:00:00.000Z');
  assert.strictEqual(result.instances[0].isException, false);
});

test('normalizeEvent should return composite structure for recurring event', () => {
  const rruleMock = {
    toString: () => 'FREQ=WEEKLY;BYDAY=TH',
    between: (start, end) => [
      new Date('2026-04-03T10:00:00Z'),
      new Date('2026-04-10T10:00:00Z')
    ]
  };

  const icalEvent = {
    uid: 'recurring-event-456',
    summary: 'Weekly Meeting',
    start: new Date('2026-04-03T10:00:00Z'),
    end: new Date('2026-04-03T11:00:00Z'),
    location: null,
    description: null,
    datetype: 'date-time',
    rrule: rruleMock
  };

  const dateRange = {
    start: new Date('2026-04-01T00:00:00Z'),
    end: new Date('2026-04-30T23:59:59Z')
  };

  const result = normalizeEvent(icalEvent, null, 'UTC');

  assert.strictEqual(result.id, 'recurring-event-456');
  assert.strictEqual(result.title, 'Weekly Meeting');
  assert.strictEqual(result.rrule, 'FREQ=WEEKLY;BYDAY=TH');
  assert.ok(Array.isArray(result.instances));
  assert.strictEqual(result.instances.length, 1);
  assert.strictEqual(result.instances[0].isException, false);
});

test('normalizeEvent should convert Europe/Berlin timezone to UTC correctly (issue #16)', () => {
  // Simulate node-ical parsing DTSTART;TZID=Europe/Berlin:20260415T110000
  // When node-ical doesn't attach .tz property, the Date object has UTC components
  // set to the local time values (11:00 becomes getUTCHours() = 11)
  const berlinLocalTime = new Date(Date.UTC(2026, 3, 15, 11, 0, 0)); // April 15, 2026, 11:00 (as UTC components)
  // Remove .tz property to simulate node-ical's inconsistent behavior
  delete berlinLocalTime.tz;

  const icalEvent = {
    uid: 'test-berlin-event',
    summary: 'EG | Eurythmie (mit Friederike)',
    start: berlinLocalTime,
    end: new Date(Date.UTC(2026, 3, 15, 12, 0, 0)),
    datetype: 'date-time',
    rrule: null
  };

  const result = normalizeEvent(icalEvent, null, 'Europe/Berlin');

  // Event at 11:00 Berlin time in April (CEST = UTC+2)
  // Should be stored as 09:00 UTC (11:00 - 2:00)
  const expectedStart = new Date('2026-04-15T09:00:00.000Z');
  const expectedEnd = new Date('2026-04-15T10:00:00.000Z');

  assert.strictEqual(result.instances[0].start.toISOString(), expectedStart.toISOString(),
    'Start time should be 09:00 UTC (11:00 Berlin - 2h CEST offset)');
  assert.strictEqual(result.instances[0].end.toISOString(), expectedEnd.toISOString(),
    'End time should be 10:00 UTC (12:00 Berlin - 2h CEST offset)');
});
