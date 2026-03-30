const assert = require('node:assert/strict');
const { test } = require('node:test');
const ical = require('node-ical');
const { fetchCalendar } = require('../src/caldav.js');

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

    // Should have 3 occurrences (4 total minus 1 EXDATE)
    // March 30, April 13, April 20 (NOT April 6)
    assert.equal(events.length, 3, 'Should have 3 events (excluding EXDATE)');

    const dates = events.map(e => e.start.toISOString().substring(0, 10)).sort();
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

    // Should have 3 occurrences total
    assert.equal(events.length, 3, 'Should have 3 events');

    // Find April 6 event
    const april6 = events.find(e =>
      e.start.toISOString().startsWith('2026-04-06')
    );

    assert.ok(april6, 'April 6 occurrence should exist');
    assert.equal(april6.title, 'Team Standup (Extended)',
      'April 6 should show modified title');

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

    // Should have 3 occurrences: Mar 30 (original), Apr 6 (modified), Apr 20 (original)
    // April 13 excluded by EXDATE
    assert.equal(events.length, 3, 'Should have 3 events');

    const april6 = events.find(e =>
      e.start.toISOString().startsWith('2026-04-06')
    );

    assert.ok(april6, 'April 6 should exist');
    assert.equal(april6.title, 'Project Review (Rescheduled)',
      'April 6 should show modified title');
    assert.match(april6.start.toISOString(), /16:00:00/,
      'April 6 should be rescheduled to 16:00');

    const april13 = events.find(e =>
      e.start.toISOString().startsWith('2026-04-13')
    );
    assert.equal(april13, undefined, 'April 13 should be excluded');
  } finally {
    global.fetch = originalFetch;
  }
});
