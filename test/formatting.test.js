const { test } = require('node:test');
const assert = require('node:assert');
const {
  renderWeekView,
  renderDailyView,
  renderChangeNotification,
  renderBundledNotification,
  renderCanvasContent,
  formatEventTime
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
  assert.match(result, /✏️.*Moved:/);
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
  assert.match(result, /➕.*New:/);
  assert.match(result, /New Meeting/);
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
  assert.match(result, /🗑️.*Cancelled:/);
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
  assert.match(result, /➕.*1 new event/);
  assert.match(result, /🗑️.*1 cancelled/);
  assert.match(result, /✏️.*1 modified/);
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
