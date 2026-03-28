const { test } = require('node:test');
const assert = require('node:assert');
const {
  renderWeekView,
  renderDailyView,
  renderChangeNotification,
  renderBundledNotification,
  renderCanvasContent,
  formatEventTime,
  renderCalendarLegend
} = require('../src/formatting.js');

test('formatEventTime should format time based on locale', () => {
  const event = {
    start: new Date('2026-03-25T09:00:00Z'),
    end: new Date('2026-03-25T10:00:00Z'),
    isAllDay: false
  };

  const enUS = formatEventTime(event, 'en-US');
  assert.match(enUS, /\d{1,2}:\d{2}/); // US format with time
  assert.match(enUS, /(AM|PM)/); // US format includes AM/PM

  const deDE = formatEventTime(event, 'de-DE');
  assert.match(deDE, /\d{2}:\d{2}/); // German 24-hour format
});

test('renderWeekView should generate week digest with all-day events first', () => {
  const events = [
    {
      id: 'e1',
      title: 'Team Standup',
      start: new Date('2026-03-25T09:00:00Z'),
      end: new Date('2026-03-25T09:30:00Z'),
      isAllDay: false,
      calendarName: 'Team'
    },
    {
      id: 'e2',
      title: 'Project Deadline',
      start: new Date('2026-03-25T00:00:00Z'),
      end: new Date('2026-03-25T23:59:59Z'),
      isAllDay: true,
      calendarName: 'Project X'
    }
  ];

  const dateRange = {
    start: new Date('2026-03-24T00:00:00Z'), // Monday
    end: new Date('2026-03-30T23:59:59Z')    // Sunday
  };

  const result = renderWeekView(events, dateRange, 'en-US', { showEmptyDays: false });

  // All-day events should appear before timed events
  const projectIndex = result.indexOf('Project Deadline');
  const standupIndex = result.indexOf('Team Standup');
  assert.ok(projectIndex < standupIndex, 'All-day events should come first');

  // Should include week header
  assert.match(result, /Week \d+/);

  // Should include event count summary
  assert.match(result, /2 events/);
});

test('renderChangeNotification should format time changes with arrow', () => {
  const diff = {
    type: 'time_changed',
    event: {
      id: 'e1',
      title: 'Team Standup'
    },
    old: { start: new Date('2026-03-25T09:00:00Z') },
    new: { start: new Date('2026-03-25T10:00:00Z') },
    calendarName: 'Team'
  };

  const result = renderChangeNotification(diff, 'en-US');
  assert.match(result, /Termin verschoben:/);
  assert.match(result, /Team Standup/);
  assert.match(result, /→/); // Arrow indicating change
});

test('renderChangeNotification should format new events', () => {
  const diff = {
    type: 'new',
    event: {
      id: 'e1',
      title: 'New Meeting',
      start: new Date('2026-03-25T14:00:00Z'),
      isAllDay: false
    },
    calendarName: 'Team'
  };

  const result = renderChangeNotification(diff, 'en-US');
  assert.match(result, /Neuer Termin:/);
  assert.match(result, /New Meeting/);

  // Should include color indicator (legend is now posted separately)
  const indicators = ['🟦', '🟩', '🟨', '🟧', '🟪', '🟥', '⬜'];
  const hasIndicator = indicators.some(ind => result.includes(ind));
  assert.ok(hasIndicator, 'Should show color indicator');
});

test('renderChangeNotification should format cancelled events', () => {
  const diff = {
    type: 'deleted',
    event: {
      id: 'e1',
      title: 'Cancelled Meeting',
      start: new Date('2026-03-25T14:00:00Z'),
      isAllDay: false
    },
    calendarName: 'Team'
  };

  const result = renderChangeNotification(diff, 'en-US');
  assert.match(result, /Termin abgesagt:/);
  assert.match(result, /Cancelled Meeting/);
});

test('renderBundledNotification should group multiple changes by type', () => {
  const diffs = [
    {
      type: 'new',
      event: {
        id: 'e1',
        title: 'New Meeting',
        start: new Date('2026-03-25T14:00:00Z'),
        isAllDay: false
      },
      calendarName: 'Team'
    },
    {
      type: 'deleted',
      event: {
        id: 'e2',
        title: 'Cancelled Event',
        start: new Date('2026-03-26T10:00:00Z'),
        isAllDay: false
      },
      calendarName: 'Project X'
    },
    {
      type: 'time_changed',
      event: {
        id: 'e3',
        title: 'Moved Meeting',
        start: new Date('2026-03-27T15:00:00Z'),
        isAllDay: false
      },
      old: { start: new Date('2026-03-27T14:00:00Z') },
      new: { start: new Date('2026-03-27T15:00:00Z') },
      calendarName: 'Team'
    }
  ];

  const result = renderBundledNotification(diffs, 'en-US');
  assert.match(result, /3 calendar changes/);
  assert.match(result, /Neuer Termin:/);
  assert.match(result, /Termin abgesagt:/);
  assert.match(result, /Termin verschoben:/);
  assert.match(result, /New Meeting/);
  assert.match(result, /Cancelled Event/);
  assert.match(result, /Moved Meeting/);
});

test('renderDailyView should use Today/Tomorrow labels', () => {
  const now = new Date();
  const todayEvents = [
    {
      id: 'e1',
      title: 'Morning Meeting',
      start: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0),
      end: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0),
      isAllDay: false,
      calendarName: 'Work'
    }
  ];

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const tomorrowEvents = [
    {
      id: 'e2',
      title: 'Afternoon Review',
      start: new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 14, 0),
      end: new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 15, 0),
      isAllDay: false,
      calendarName: 'Work'
    }
  ];

  const allEvents = [...todayEvents, ...tomorrowEvents];
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfTomorrow = new Date(tomorrow);
  endOfTomorrow.setHours(23, 59, 59, 999);

  const dateRange = { start: startOfToday, end: endOfTomorrow };
  const result = renderDailyView(allEvents, dateRange, 'en-US');

  assert.match(result, /Today/);
  assert.match(result, /Tomorrow/);
  assert.match(result, /Morning Meeting/);
  assert.match(result, /Afternoon Review/);
});

test('renderCanvasContent should filter to current week', () => {
  const now = new Date();
  const thisWeekEvent = {
    id: 'e1',
    title: 'This Week Event',
    start: now,
    end: now,
    isAllDay: false,
    calendarName: 'Work'
  };

  const nextWeekEvent = {
    id: 'e2',
    title: 'Next Week Event',
    start: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000), // 10 days from now
    end: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000),
    isAllDay: false,
    calendarName: 'Work'
  };

  const allEvents = [thisWeekEvent, nextWeekEvent];
  const result = renderCanvasContent(allEvents, { locale: 'en-US' });

  assert.match(result, /This Week Event/);
  assert.ok(!result.includes('Next Week Event'), 'Should not include next week events');
});

test('renderBundledNotification should show color indicators for single calendar', () => {
  // Issue #8: Change notifications should show color indicators instead of text names
  const diffs = [
    {
      type: 'new',
      event: {
        id: 'e1',
        title: 'New Meeting',
        start: new Date('2026-03-25T14:00:00Z'),
        isAllDay: false
      },
      calendarName: 'Team'
    }
  ];

  const result = renderBundledNotification(diffs, 'en-US');

  // Should show color indicator (🟦, 🟩, etc.) not text name "· Team"
  assert.ok(result.includes('🟦') || result.includes('🟩') || result.includes('🟨') ||
            result.includes('🟧') || result.includes('🟪') || result.includes('🟥') || result.includes('⬜'),
            'Should show color indicator');
  assert.ok(!result.includes('· Team'), 'Should not show text calendar name');
});

test('renderBundledNotification should assign consistent colors to same calendar', () => {
  // Issue #8: Same calendar should get same color across different messages
  const diffsTeam = [
    {
      type: 'new',
      event: {
        id: 'e1',
        title: 'Team Event',
        start: new Date('2026-03-25T14:00:00Z'),
        isAllDay: false
      },
      calendarName: 'Team'
    }
  ];

  const diffsVorstand = [
    {
      type: 'new',
      event: {
        id: 'e2',
        title: 'Vorstand Event',
        start: new Date('2026-03-25T15:00:00Z'),
        isAllDay: false
      },
      calendarName: 'Vorstand'
    }
  ];

  const resultTeam = renderBundledNotification(diffsTeam, 'en-US');
  const resultVorstand = renderBundledNotification(diffsVorstand, 'en-US');

  // Extract color indicators from results
  const indicators = ['🟦', '🟩', '🟨', '🟧', '🟪', '🟥', '⬜'];
  const teamColor = indicators.find(ind => resultTeam.includes(ind));
  const vorstandColor = indicators.find(ind => resultVorstand.includes(ind));

  // Both should have color indicators
  assert.ok(teamColor, 'Team should have color indicator');
  assert.ok(vorstandColor, 'Vorstand should have color indicator');

  // They should be different colors
  assert.notEqual(teamColor, vorstandColor, 'Different calendars should have different colors');

  // Now test with both calendars in one message - colors should stay consistent
  const diffsBoth = [...diffsTeam, ...diffsVorstand];
  const resultBoth = renderBundledNotification(diffsBoth, 'en-US');

  assert.ok(resultBoth.includes(teamColor), 'Team should keep same color in multi-calendar message');
  assert.ok(resultBoth.includes(vorstandColor), 'Vorstand should keep same color in multi-calendar message');
});

test('renderCalendarLegend should render legend with color indicators', () => {
  const calendars = ['Team', 'Vorstand', 'Abeona-Termine'];
  const legend = renderCalendarLegend(calendars);

  // Should be wrapped in italics
  assert.match(legend, /^_.*_$/, 'Legend should be wrapped in italics');

  // Should include all calendar names
  assert.match(legend, /Team/, 'Should include Team');
  assert.match(legend, /Vorstand/, 'Should include Vorstand');
  assert.match(legend, /Abeona-Termine/, 'Should include Abeona-Termine');

  // Should include color indicators
  const indicators = ['🟦', '🟩', '🟨', '🟧', '🟪', '🟥', '⬜'];
  const hasIndicators = indicators.some(ind => legend.includes(ind));
  assert.ok(hasIndicators, 'Should include color indicators');
});

test('renderCalendarLegend should return empty string for empty input', () => {
  assert.equal(renderCalendarLegend([]), '');
  assert.equal(renderCalendarLegend(null), '');
});

test('renderChangeNotification should show both old and new dates when date changes (same time)', () => {
  // Issue #12: When event moves from March 26 to March 27 but keeps same time (18:00)
  // Should show: Do., 26. März 18:00 → Fr., 27. März 18:00
  // NOT: Fr., 27. März · 18:00 → 18:00
  const diff = {
    type: 'time_changed',
    event: {
      id: 'e1',
      title: 'Test',
      start: new Date('2026-03-27T18:00:00Z'),
      isAllDay: false
    },
    old: { start: new Date('2026-03-26T18:00:00Z') },
    new: { start: new Date('2026-03-27T18:00:00Z') },
    calendarName: 'Vorstand'
  };

  const result = renderChangeNotification(diff, 'de-DE', 'Europe/Berlin');

  // Should show old date in the old time part
  assert.match(result, /26\.\s*März/, 'Should show old date (March 26)');
  // Should show new date in the new time part
  assert.match(result, /27\.\s*März/, 'Should show new date (March 27)');
  // Should show the time (18:00 UTC = 19:00 in Berlin timezone)
  assert.match(result, /19:00/, 'Should show the time');
  // Should NOT show the same date twice with arrow between times only
  assert.ok(!result.match(/27\.\s*März.*·.*19:00.*→.*19:00/), 'Should not show new date with · and arrow to same time');
});

test('renderChangeNotification should show date once when only time changes (same date)', () => {
  // Issue #12: When event stays on same date but time changes
  // Should show: Fr., 27. März · 18:00 → 19:00 (times in Berlin timezone)
  const diff = {
    type: 'time_changed',
    event: {
      id: 'e1',
      title: 'Test',
      start: new Date('2026-03-27T18:00:00Z'),
      isAllDay: false
    },
    old: { start: new Date('2026-03-27T17:00:00Z') },
    new: { start: new Date('2026-03-27T18:00:00Z') },
    calendarName: 'Vorstand'
  };

  const result = renderChangeNotification(diff, 'de-DE', 'Europe/Berlin');

  // Should show the date once
  const dateMatches = result.match(/27\.\s*März/g) || [];
  assert.equal(dateMatches.length, 1, 'Should show date only once');
  // Should show old time → new time (17:00 UTC = 18:00 Berlin, 18:00 UTC = 19:00 Berlin)
  assert.match(result, /18:00.*→.*19:00/, 'Should show old time → new time');
});

test('renderChangeNotification should show both dates and times when both change', () => {
  // Issue #12: When both date and time change
  // Should show: Do., 26. März 18:00 → Fr., 27. März 19:00 (times in Berlin timezone)
  const diff = {
    type: 'time_changed',
    event: {
      id: 'e1',
      title: 'Test',
      start: new Date('2026-03-27T18:00:00Z'),
      isAllDay: false
    },
    old: { start: new Date('2026-03-26T17:00:00Z') },
    new: { start: new Date('2026-03-27T18:00:00Z') },
    calendarName: 'Vorstand'
  };

  const result = renderChangeNotification(diff, 'de-DE', 'Europe/Berlin');

  // Should show old date and time (17:00 UTC = 18:00 Berlin)
  assert.match(result, /26\.\s*März/, 'Should show old date (March 26)');
  assert.match(result, /18:00/, 'Should show old time (18:00 Berlin)');
  // Should show new date and time (18:00 UTC = 19:00 Berlin)
  assert.match(result, /27\.\s*März/, 'Should show new date (March 27)');
  assert.match(result, /19:00/, 'Should show new time (19:00 Berlin)');
  // Should have arrow between them
  assert.match(result, /→/, 'Should have arrow');
});
