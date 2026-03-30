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

test('renderWeekView should generate week digest with all-day events first', async () => {
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

  const result = await renderWeekView(events, dateRange, 'en-US', { showEmptyDays: false, config: {}, cacheMap: new Map() });

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

test('renderBundledNotification should group multiple changes by type', async () => {
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

  const { message: result } = await renderBundledNotification(diffs, 'en-US', 'UTC', { config: {}, cacheMap: new Map() });
  assert.match(result, /3 calendar changes/);
  assert.match(result, /Neuer Termin:/);
  assert.match(result, /Termin abgesagt:/);
  assert.match(result, /Termin verschoben:/);
  assert.match(result, /New Meeting/);
  assert.match(result, /Cancelled Event/);
  assert.match(result, /Moved Meeting/);
});

test('renderDailyView should use Today/Tomorrow labels', async () => {
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
  const result = await renderDailyView(allEvents, dateRange, 'en-US', { config: {}, cacheMap: new Map() });

  assert.match(result, /Today/);
  assert.match(result, /Tomorrow/);
  assert.match(result, /Morning Meeting/);
  assert.match(result, /Afternoon Review/);
});

test('renderCanvasContent should filter to current week', async () => {
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
  const result = await renderCanvasContent(allEvents, { locale: 'en-US', config: {}, cacheMap: new Map() });

  assert.match(result, /This Week Event/);
  assert.ok(!result.includes('Next Week Event'), 'Should not include next week events');
});

test('renderCanvasContent adds Nextcloud link when nextcloud_url provided', async () => {
  const now = new Date();
  const events = [{
    title: 'Test Event',
    start: now,
    end: now,
    isAllDay: false
  }];

  const config = {
    nextcloud_url: 'https://nextcloud.example.com/apps/calendar'
  };

  const result = await renderCanvasContent(events, { locale: 'en-US', config, cacheMap: new Map() });

  assert.ok(result.includes('[View in Nextcloud →](https://nextcloud.example.com/apps/calendar)'), 'Should have Nextcloud link in markdown format');
});

test('renderCanvasContent works without nextcloud_url', async () => {
  const now = new Date();
  const events = [{
    title: 'Test Event',
    start: now,
    end: now,
    isAllDay: false
  }];

  const result = await renderCanvasContent(events, { locale: 'en-US', config: {}, cacheMap: new Map() });

  assert.ok(!result.includes('Nextcloud'), 'Should not have Nextcloud text');
  assert.ok(result.includes('Test Event'), 'Should have event content');
});

test('renderCanvasContent uses German text for de-DE locale', async () => {
  const now = new Date();
  const events = [{
    title: 'Test Event',
    start: now,
    end: now,
    isAllDay: false
  }];

  const config = {
    nextcloud_url: 'https://nextcloud.example.com/apps/calendar'
  };

  const result = await renderCanvasContent(events, { locale: 'de-DE', config, cacheMap: new Map() });

  assert.ok(result.includes('[In Nextcloud ansehen →](https://nextcloud.example.com/apps/calendar)'), 'Should have German Nextcloud link in markdown format');
});

test('renderCanvasContent does not include canvas_url link (redundant)', async () => {
  const now = new Date();
  const events = [{
    title: 'Test Event',
    start: now,
    end: now,
    isAllDay: false
  }];

  const canvasUrl = 'https://abeona.slack.com/docs/T31PV0E2E/F0AP5AJLFRAJK';
  const result = await renderCanvasContent(events, {
    locale: 'en-US',
    config: {},
    cacheMap: new Map(),
    canvas_url: canvasUrl
  });

  // Canvas should NOT include a link to itself
  assert.ok(!result.includes('Komplette Übersicht →'), 'Canvas should not include German canvas link text');
  assert.ok(!result.includes('Full schedule →'), 'Canvas should not include English canvas link text');
  // Should not contain any Slack mrkdwn angle bracket links
  assert.ok(!result.match(/<https?:\/\/[^>]+\|[^>]+>/), 'Should not contain any mrkdwn format links');
});

test('renderCanvasContent shows upcoming week when rendered on Sunday', async () => {
  // Create mock function to override getCurrentWeekRange behavior
  const originalGetCurrentWeekRange = Date.prototype.getUTCDay;

  // Events: one on Sunday March 22, one on Monday March 23
  const events = [
    {
      title: 'Sunday Event (current week)',
      start: new Date('2026-03-22T10:00:00Z'), // Sunday March 22
      end: new Date('2026-03-22T11:00:00Z'),
      isAllDay: false
    },
    {
      title: 'Monday Event (next week)',
      start: new Date('2026-03-23T10:00:00Z'), // Monday March 23
      end: new Date('2026-03-23T11:00:00Z'),
      isAllDay: false
    }
  ];

  // Mock current date to Sunday March 22, 2026
  const OriginalDate = global.Date;
  global.Date = class extends OriginalDate {
    constructor(...args) {
      if (args.length === 0) {
        super('2026-03-22T12:00:00Z'); // Sunday
      } else {
        super(...args);
      }
    }
    static now() {
      return new OriginalDate('2026-03-22T12:00:00Z').getTime();
    }
  };

  try {
    const result = await renderCanvasContent(events, { locale: 'en-US', config: {}, cacheMap: new Map() });

    // Should include Monday event (next week from Sunday's perspective)
    assert.ok(result.includes('Monday Event (next week)'), 'Should include next week Monday event');
    // Should NOT include Sunday event (end of previous week from Sunday's perspective)
    assert.ok(!result.includes('Sunday Event (current week)'), 'Should not include current Sunday event');
  } finally {
    global.Date = OriginalDate;
  }
});

test('renderBundledNotification should show color indicators for single calendar', async () => {
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

  const { message: result } = await renderBundledNotification(diffs, 'en-US', 'UTC', { config: {}, cacheMap: new Map() });

  // Should show color indicator (🟦, 🟩, etc.) not text name "· Team"
  assert.ok(result.includes('🟦') || result.includes('🟩') || result.includes('🟨') ||
            result.includes('🟧') || result.includes('🟪') || result.includes('🟥') || result.includes('⬜'),
            'Should show color indicator');
  assert.ok(!result.includes('· Team'), 'Should not show text calendar name');
});

test('renderBundledNotification should assign consistent colors to same calendar', async () => {
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

  const { message: resultTeam } = await renderBundledNotification(diffsTeam, 'en-US', 'UTC', { config: {}, cacheMap: new Map() });
  const { message: resultVorstand } = await renderBundledNotification(diffsVorstand, 'en-US', 'UTC', { config: {}, cacheMap: new Map() });

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
  const { message: resultBoth } = await renderBundledNotification(diffsBoth, 'en-US', 'UTC', { config: {}, cacheMap: new Map() });

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
    old: { start: new Date('2026-03-26T18:00:00Z'), isAllDay: false },
    new: { start: new Date('2026-03-27T18:00:00Z'), isAllDay: false },
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
    old: { start: new Date('2026-03-27T17:00:00Z'), isAllDay: false },
    new: { start: new Date('2026-03-27T18:00:00Z'), isAllDay: false },
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
    old: { start: new Date('2026-03-26T17:00:00Z'), isAllDay: false },
    new: { start: new Date('2026-03-27T18:00:00Z'), isAllDay: false },
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

test('renderChangeNotification should show all-day to specific time change clearly', () => {
  // Issue #11: When event changes from all-day to specific time
  // Should show: Ganztägig → 18:00
  const diff = {
    type: 'time_changed',
    event: {
      id: 'e1',
      title: 'Test27',
      start: new Date('2026-03-29T18:00:00Z'),
      isAllDay: false
    },
    old: { start: new Date('2026-03-29T00:00:00Z'), isAllDay: true },
    new: { start: new Date('2026-03-29T18:00:00Z'), isAllDay: false },
    calendarName: 'Abeona-Termine'
  };

  const result = renderChangeNotification(diff, 'de-DE', 'Europe/Berlin');

  // Should show "Ganztägig → 20:00" (18:00 UTC = 20:00 Berlin in DST)
  assert.match(result, /Ganztägig/, 'Should show "Ganztägig"');
  assert.match(result, /20:00/, 'Should show new time (20:00 Berlin)');
  assert.match(result, /→/, 'Should have arrow');
  assert.match(result, /Ganztägig\s*→\s*20:00/, 'Should show "Ganztägig → 20:00"');
  // Should NOT show confusing times like 01:00
  assert.ok(!result.match(/01:00/), 'Should not show midnight time');
});

test('renderChangeNotification should show specific time to all-day change clearly', () => {
  // Issue #11: When event changes from specific time to all-day
  // Should show: 18:00 → Ganztägig
  const diff = {
    type: 'time_changed',
    event: {
      id: 'e1',
      title: 'Test',
      start: new Date('2026-03-29T00:00:00Z'),
      isAllDay: true
    },
    old: { start: new Date('2026-03-29T18:00:00Z'), isAllDay: false },
    new: { start: new Date('2026-03-29T00:00:00Z'), isAllDay: true },
    calendarName: 'Team'
  };

  const result = renderChangeNotification(diff, 'de-DE', 'Europe/Berlin');

  // Should show "20:00 → Ganztägig" (18:00 UTC = 20:00 Berlin in DST)
  assert.match(result, /Ganztägig/, 'Should show "Ganztägig"');
  assert.match(result, /20:00/, 'Should show old time (20:00 Berlin)');
  assert.match(result, /→/, 'Should have arrow');
  assert.match(result, /20:00\s*→\s*Ganztägig/, 'Should show "20:00 → Ganztägig"');
});

test('renderChangeNotification should use locale for all-day label', () => {
  // Should use "All-day" in English
  const diff = {
    type: 'time_changed',
    event: {
      id: 'e1',
      title: 'Test',
      start: new Date('2026-03-29T18:00:00Z'),
      isAllDay: false
    },
    old: { start: new Date('2026-03-29T00:00:00Z'), isAllDay: true },
    new: { start: new Date('2026-03-29T18:00:00Z'), isAllDay: false },
    calendarName: 'Team'
  };

  const result = renderChangeNotification(diff, 'en-US', 'UTC');

  assert.match(result, /All-day/, 'Should show "All-day" in English');
  assert.match(result, /All-day\s*→\s*06:00 PM/, 'Should show "All-day → 06:00 PM"');
});

test('renderChangeNotification should infer all-day status from midnight when flag missing', () => {
  // Legacy cached events might not have isAllDay flag
  // Should infer all-day from midnight start time
  const diff = {
    type: 'time_changed',
    event: {
      id: 'e1',
      title: 'Team-Testing',
      start: new Date('2026-03-28T09:00:00Z'),
      isAllDay: false
    },
    old: {
      start: new Date('2026-03-28T00:00:00Z'), // Midnight = infer all-day
      isAllDay: undefined // Missing flag
    },
    new: {
      start: new Date('2026-03-28T09:00:00Z'),
      isAllDay: false
    },
    calendarName: 'Team'
  };

  const result = renderChangeNotification(diff, 'de-DE', 'Europe/Berlin');

  // Should detect as all-day → specific time change
  assert.match(result, /Ganztägig/, 'Should infer all-day from midnight');
  assert.match(result, /Ganztägig\s*→\s*10:00/, 'Should show "Ganztägig → 10:00"');
  // Should NOT show confusing midnight time
  assert.ok(!result.match(/01:00\s*→/), 'Should not show "01:00 →"');
});

test('formatEventTime returns translated all-day text instead of emoji', () => {
  const allDayEvent = {
    start: new Date('2026-03-24T00:00:00Z'),
    end: new Date('2026-03-24T23:59:59Z'),
    isAllDay: true
  };

  const resultDE = formatEventTime(allDayEvent, 'de-DE', 'UTC');
  assert.equal(resultDE, 'Ganztägig', 'Should return German all-day translation');
  assert.ok(!resultDE.includes('📅'), 'Should not contain emoji');

  const resultEN = formatEventTime(allDayEvent, 'en-US', 'UTC');
  assert.equal(resultEN, 'All-day', 'Should return English all-day translation');
  assert.ok(!resultEN.includes('📅'), 'Should not contain emoji');
});

test('renderWeekView removes calendar emoji from footer', async () => {
  const events = [{
    title: 'Test Event',
    start: new Date('2026-03-25T10:00:00Z'),
    end: new Date('2026-03-25T11:00:00Z'),
    isAllDay: false,
    calendarName: 'Team'
  }];

  const dateRange = {
    start: new Date('2026-03-24T00:00:00Z'),
    end: new Date('2026-03-30T23:59:59Z')
  };

  const result = await renderWeekView(events, dateRange, 'en-US', { config: {}, cacheMap: new Map() });

  assert.ok(!result.includes('📆'), 'Should not contain calendar emoji in footer');
  assert.match(result, /1 event/, 'Should contain event count');
});

test('renderDailyView removes calendar emoji from footer', async () => {
  const events = [{
    title: 'Test Event',
    start: new Date('2026-03-24T10:00:00Z'),
    end: new Date('2026-03-24T11:00:00Z'),
    isAllDay: false,
    calendarName: 'Team'
  }];

  const dateRange = {
    start: new Date('2026-03-24T00:00:00Z'),
    end: new Date('2026-03-25T23:59:59Z')
  };

  const result = await renderDailyView(events, dateRange, 'en-US', { config: {}, cacheMap: new Map() });

  assert.ok(!result.includes('📆'), 'Should not contain calendar emoji in footer');
  assert.match(result, /1 event/, 'Should contain event count');
});

test('renderWeekView shows inline calendar color indicators', async () => {
  const events = [
    {
      title: 'Team Event',
      start: new Date('2026-03-24T10:00:00Z'),
      end: new Date('2026-03-24T11:00:00Z'),
      isAllDay: false,
      calendarName: 'Team Calendar'
    },
    {
      title: 'Project Event',
      start: new Date('2026-03-24T14:00:00Z'),
      end: new Date('2026-03-24T15:00:00Z'),
      isAllDay: false,
      calendarName: 'Project X'
    }
  ];

  const dateRange = {
    start: new Date('2026-03-24T00:00:00Z'),
    end: new Date('2026-03-30T23:59:59Z')
  };

  const config = {
    calendars: {
      'team-calendar': { name: 'Team Calendar' },
      'project-x': { name: 'Project X' }
    }
  };

  const result = await renderWeekView(events, dateRange, 'en-US', { config });

  const indicators = ['🟦', '🟩', '🟨', '🟧', '🟪', '🟥', '⬜'];
  const hasTeamIndicator = indicators.some(ind => result.includes(`Team Event ${ind}`));
  const hasProjectIndicator = indicators.some(ind => result.includes(`Project Event ${ind}`));

  assert.ok(hasTeamIndicator, 'Team Event should have color indicator inline');
  assert.ok(hasProjectIndicator, 'Project Event should have color indicator inline');
});

test('renderDailyView shows inline calendar color indicators', async () => {
  const events = [{
    title: 'Team Event',
    start: new Date('2026-03-24T10:00:00Z'),
    end: new Date('2026-03-24T11:00:00Z'),
    isAllDay: false,
    calendarName: 'Team Calendar'
  }];

  const dateRange = {
    start: new Date('2026-03-24T00:00:00Z'),
    end: new Date('2026-03-25T23:59:59Z')
  };

  const config = {
    calendars: {
      'team-calendar': { name: 'Team Calendar' }
    }
  };

  const result = await renderDailyView(events, dateRange, 'en-US', { config });

  const indicators = ['🟦', '🟩', '🟨', '🟧', '🟪', '🟥', '⬜'];
  const hasIndicator = indicators.some(ind => result.includes(`Team Event ${ind}`));

  assert.ok(hasIndicator, 'Team Event should have color indicator inline');
});

test('renderWeekView uses 12-character HR separator', async () => {
  const events = [{
    title: 'Test Event',
    start: new Date('2026-03-24T10:00:00Z'),
    end: new Date('2026-03-24T11:00:00Z'),
    isAllDay: false
  }];

  const dateRange = {
    start: new Date('2026-03-24T00:00:00Z'),
    end: new Date('2026-03-30T23:59:59Z')
  };

  const result = await renderWeekView(events, dateRange, 'en-US', {});

  // Should have exactly 12-char separator
  assert.ok(result.includes('────────────\n'), 'Should use 12-character light horizontal line separator');
  assert.ok(!result.includes('━━━━━━━━━━━━━━━━━━━━'), 'Should not use 20-character heavy horizontal line');
});

test('renderDailyView uses 12-character HR separator', async () => {
  const events = [{
    title: 'Test Event',
    start: new Date('2026-03-24T10:00:00Z'),
    end: new Date('2026-03-24T11:00:00Z'),
    isAllDay: false
  }];

  const dateRange = {
    start: new Date('2026-03-24T00:00:00Z'),
    end: new Date('2026-03-25T23:59:59Z')
  };

  const result = await renderDailyView(events, dateRange, 'en-US', {});

  assert.ok(result.includes('────────────\n'), 'Should use 12-character light horizontal line separator');
  assert.ok(!result.includes('━━━━━━━━━━━━━━━━━━━━'), 'Should not use 20-character heavy horizontal line');
});

test('renderWeekView creates clickable Canvas link when canvas_url provided', async () => {
  const events = [{
    title: 'Test Event',
    start: new Date('2026-03-24T10:00:00Z'),
    end: new Date('2026-03-24T11:00:00Z'),
    isAllDay: false
  }];

  const dateRange = {
    start: new Date('2026-03-24T00:00:00Z'),
    end: new Date('2026-03-30T23:59:59Z')
  };

  const canvas_url = 'https://workspace.slack.com/docs/T123/F456';
  const result = await renderWeekView(events, dateRange, 'en-US', { canvas_url });

  // Should have Slack link syntax
  assert.ok(result.includes(`<${canvas_url}|Full schedule →>`), 'Should have clickable Canvas link');
});

test('renderWeekView shows plain text when canvas_url missing', async () => {
  const events = [{
    title: 'Test Event',
    start: new Date('2026-03-24T10:00:00Z'),
    end: new Date('2026-03-24T11:00:00Z'),
    isAllDay: false
  }];

  const dateRange = {
    start: new Date('2026-03-24T00:00:00Z'),
    end: new Date('2026-03-30T23:59:59Z')
  };

  const result = await renderWeekView(events, dateRange, 'en-US', {});

  assert.ok(result.includes('Full schedule →'), 'Should have plain text');
  assert.ok(!result.includes('<http'), 'Should not have link syntax');
});

test('renderDailyView creates clickable Canvas link when canvas_url provided', async () => {
  const events = [{
    title: 'Test Event',
    start: new Date('2026-03-24T10:00:00Z'),
    end: new Date('2026-03-24T11:00:00Z'),
    isAllDay: false
  }];

  const dateRange = {
    start: new Date('2026-03-24T00:00:00Z'),
    end: new Date('2026-03-25T23:59:59Z')
  };

  const canvas_url = 'https://workspace.slack.com/docs/T123/F456';
  const result = await renderDailyView(events, dateRange, 'de-DE', { canvas_url });

  assert.ok(result.includes(`<${canvas_url}|Komplette Übersicht →>`), 'Should have clickable Canvas link with German text');
});
