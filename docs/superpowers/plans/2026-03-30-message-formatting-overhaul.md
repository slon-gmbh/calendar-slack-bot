# Message Formatting Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve message formatting, fix weekly schedule timing, add clickable links, and optimize cron schedules.

**Architecture:** Extends existing formatting system with configuration-driven footer links, restores inline calendar color indicators, fixes Sunday date range calculation, and updates GitHub Actions workflows.

**Tech Stack:** Node.js, Slack Web API, GitHub Actions, Jest for testing

---

## File Structure

**Configuration:**
- Modify: `src/config.js` - add validation for workspace_id, canvas_url, nextcloud_url
- Modify: `config.example.json` - add new fields

**Core Logic:**
- Modify: `src/formatting.js` - emoji removal, inline colors, HR fix, footer links
- Modify: `src/bot.js` - date range fix, pass canvas_url to renderers

**Workflows:**
- Modify: `.github/workflows/scheduled.yml` - document cron configuration
- Modify: `.github/workflows/change-detection.yml` - update cron schedule

**Tests:**
- Modify: `test/formatting.test.js` - add tests for formatting changes
- Modify: `test/bot.test.js` - add tests for date range logic

---

### Task 1: Add Configuration Validation

**Files:**
- Modify: `src/config.js`
- Modify: `config.example.json`
- Test: `test/config.test.js`

- [ ] **Step 1: Write failing test for workspace_id validation**

```javascript
// In test/config.test.js, add after existing tests
test('requires workspace_id field', async () => {
  const invalidConfig = {
    locale: 'en-US',
    caldav_credentials: { username: 'user', password: 'pass' },
    calendars: {},
    channels: []
  };

  await expect(async () => {
    // Assuming config validation throws
    validateConfig(invalidConfig);
  }).rejects.toThrow('workspace_id is required');
});

test('validates canvas_url format when provided', async () => {
  const invalidConfig = {
    workspace_id: 'T123',
    locale: 'en-US',
    caldav_credentials: { username: 'user', password: 'pass' },
    calendars: {},
    channels: [{
      id: 'C123',
      calendars: [],
      canvas_url: 'not-a-url'
    }]
  };

  await expect(async () => {
    validateConfig(invalidConfig);
  }).rejects.toThrow('canvas_url must be a valid URL');
});

test('validates nextcloud_url format when provided', async () => {
  const invalidConfig = {
    workspace_id: 'T123',
    nextcloud_url: 'not-a-url',
    locale: 'en-US',
    caldav_credentials: { username: 'user', password: 'pass' },
    calendars: {},
    channels: []
  };

  await expect(async () => {
    validateConfig(invalidConfig);
  }).rejects.toThrow('nextcloud_url must be a valid URL');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/config.test.js`
Expected: FAIL - validateConfig not exported or tests fail

- [ ] **Step 3: Add validation logic to config.js**

Add after existing validation in `src/config.js`:

```javascript
function validateConfig(config) {
  // Existing validation...

  // Validate workspace_id (required)
  if (!config.workspace_id || typeof config.workspace_id !== 'string') {
    throw new Error('workspace_id is required and must be a string');
  }

  // Validate nextcloud_url (optional)
  if (config.nextcloud_url) {
    try {
      new URL(config.nextcloud_url);
    } catch (error) {
      throw new Error('nextcloud_url must be a valid URL');
    }
  }

  // Validate channel canvas_url (optional)
  for (const channel of config.channels) {
    if (channel.canvas_url) {
      try {
        new URL(channel.canvas_url);
      } catch (error) {
        throw new Error(`canvas_url for channel ${channel.id} must be a valid URL`);
      }
    }
  }

  return config;
}

// Ensure validateConfig is exported
module.exports = {
  loadConfig,
  validateConfig  // Add if not already exported
};
```

Also update loadConfig to call validateConfig:

```javascript
async function loadConfig() {
  // Existing loading logic...
  const config = JSON.parse(configContent);

  // Validate before returning
  return validateConfig(config);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/config.test.js`
Expected: PASS

- [ ] **Step 5: Update config.example.json**

Add new fields with documentation:

```json
{
  "_comment": "Optional fields in calendars: (1) 'color' - Override calendar color with hex format (e.g., '#0082c9'). If not specified, color is fetched from CalDAV or defaults to hash-based assignment. (2) 'caldav_metadata_url' - Separate CalDAV URL for color fetching via PROPFIND. Use this if your caldav_url is a public share link (which works for event fetching but not metadata). If not specified, caldav_url is used for both events and metadata.",
  "workspace_id": "T01234WORK",
  "nextcloud_url": "https://nextcloud.example.com/apps/calendar",
  "locale": "en-US",
  "timezone": "UTC",
  "error_channel": "C01234ERROR",
  "caldav_credentials": {
    "username": "${CALDAV_USERNAME}",
    "password": "${CALDAV_PASSWORD}"
  },
  "calendars": {
    "team-calendar": {
      "name": "Team Calendar",
      "caldav_url": "https://nextcloud.example.com/apps/calendar/p/SHAREID",
      "caldav_metadata_url": "https://nextcloud.example.com/remote.php/dav/calendars/user/team/",
      "color": "#0082c9"
    },
    "project-x": {
      "name": "Project X",
      "caldav_url": "https://nextcloud.example.com/remote.php/dav/calendars/user/project-x/"
    }
  },
  "channels": [
    {
      "id": "C01234TEAM",
      "name": "#team-schedule",
      "canvas_id": "F9876CANVAS",
      "canvas_url": "https://workspace.slack.com/docs/T01234WORK/F9876CANVAS",
      "calendars": ["team-calendar", "project-x"],
      "locale": "de-DE",
      "timezone": "Europe/Berlin",
      "view": "merged",
      "event_detail": "standard",
      "digest_style": "full",
      "digest_format": "week_view",
      "digest_schedule": "sunday 18:00",
      "daily_digest_schedule": "weekdays 08:00",
      "show_empty_days": false,
      "notifications": "all"
    }
  ]
}
```

- [ ] **Step 6: Commit configuration changes**

```bash
git add src/config.js config.example.json test/config.test.js
git commit -m "feat: add workspace_id, canvas_url, and nextcloud_url config fields

- Add validation for required workspace_id
- Add optional URL validation for canvas_url and nextcloud_url
- Update config example with new fields

refs: #3"
```

---

### Task 2: Remove Decorative Emojis from Messages

**Files:**
- Modify: `src/formatting.js:111-125` (formatEventTime)
- Modify: `src/formatting.js:267,632` (footer emojis)
- Test: `test/formatting.test.js`

- [ ] **Step 1: Write failing test for all-day emoji removal**

```javascript
// In test/formatting.test.js, add new test
const { formatEventTime } = require('../src/formatting');

test('formatEventTime returns translated all-day text instead of emoji', () => {
  const allDayEvent = {
    start: new Date('2026-03-24T00:00:00Z'),
    end: new Date('2026-03-24T23:59:59Z'),
    isAllDay: true
  };

  const resultDE = formatEventTime(allDayEvent, 'de-DE', 'UTC');
  expect(resultDE).toBe('Ganztägig');
  expect(resultDE).not.toContain('📅');

  const resultEN = formatEventTime(allDayEvent, 'en-US', 'UTC');
  expect(resultEN).toBe('All-day');
  expect(resultEN).not.toContain('📅');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/formatting.test.js -t "all-day"`
Expected: FAIL - returns '📅' instead of translated text

- [ ] **Step 3: Update formatEventTime to remove emoji**

In `src/formatting.js` around line 111:

```javascript
function formatEventTime(event, locale = 'en-US', timezone = 'UTC') {
  if (event.isAllDay) {
    return getTranslation(locale, 'allDay');  // Changed from '📅'
  }

  const timeFormat = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: locale.startsWith('en-US'),
    timeZone: timezone
  });

  const formatted = timeFormat.format(event.start);
  return formatted;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/formatting.test.js -t "all-day"`
Expected: PASS

- [ ] **Step 5: Write failing test for footer emoji removal**

```javascript
// In test/formatting.test.js
test('renderWeekView removes calendar emoji from footer', async () => {
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

  expect(result).not.toContain('📆');
  expect(result).toContain('1 event');
});

test('renderDailyView removes calendar emoji from footer', async () => {
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

  expect(result).not.toContain('📆');
  expect(result).toContain('1 event');
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- test/formatting.test.js -t "emoji"`
Expected: FAIL - footer contains '📆'

- [ ] **Step 7: Remove emoji from renderWeekView footer**

In `src/formatting.js` around line 267:

```javascript
// Summary with calendar legend
const totalEvents = events.length;
const uniqueCalendars = new Set(events.map(e => e.calendarName).filter(Boolean)).size;
const eventLabel = totalEvents === 1 ? getTranslation(locale, 'event') : getTranslation(locale, 'events');
output += `${totalEvents} ${eventLabel}`;  // Changed from `📆 ${totalEvents} ${eventLabel}`
if (uniqueCalendars > 0) {
  const calendarLabel = uniqueCalendars === 1 ? getTranslation(locale, 'calendar') : getTranslation(locale, 'calendars');
  output += ` · ${uniqueCalendars} ${calendarLabel}`;
}
output += ` · ${getTranslation(locale, 'fullSchedule')}`;
```

- [ ] **Step 8: Remove emoji from renderDailyView footer**

In `src/formatting.js` around line 632:

```javascript
// Summary
const totalEvents = events.length;
const uniqueCalendars = new Set(events.map(e => e.calendarName).filter(Boolean)).size;
const eventLabel = totalEvents === 1 ? getTranslation(locale, 'event') : getTranslation(locale, 'events');
output += `${totalEvents} ${eventLabel}`;  // Changed from `📆 ${totalEvents} ${eventLabel}`
if (uniqueCalendars > 0) {
  const calendarLabel = uniqueCalendars === 1 ? getTranslation(locale, 'calendar') : getTranslation(locale, 'calendars');
  output += ` · ${uniqueCalendars} ${calendarLabel}`;
}
output += ` · ${getTranslation(locale, 'fullSchedule')}`;
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npm test -- test/formatting.test.js -t "emoji"`
Expected: PASS

- [ ] **Step 10: Commit emoji removal**

```bash
git add src/formatting.js test/formatting.test.js
git commit -m "feat: remove decorative emojis from messages

- Replace calendar emoji in all-day events with translated text
- Remove calendar emoji from footer summaries
- Keep warning emoji in error notifications

refs: #3"
```

---

### Task 3: Restore Inline Calendar Color Indicators

**Files:**
- Modify: `src/formatting.js:253-254,618-619`
- Test: `test/formatting.test.js`

- [ ] **Step 1: Write failing test for inline color indicators**

```javascript
// In test/formatting.test.js
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

  // Should have color indicators inline with events
  expect(result).toMatch(/Team Event.*[🟦🟩🟨🟧🟪🟥⬜]/);
  expect(result).toMatch(/Project Event.*[🟦🟩🟨🟧🟪🟥⬜]/);
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

  expect(result).toMatch(/Team Event.*[🟦🟩🟨🟧🟪🟥⬜]/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/formatting.test.js -t "inline"`
Expected: FAIL - no color indicators inline

- [ ] **Step 3: Restore inline indicators in renderWeekView**

In `src/formatting.js` around line 252:

```javascript
for (const event of sorted) {
  const time = formatEventTime(event, locale, timezone);
  // Restore inline color indicators
  const indicator = calendarIndicators.get(event.calendarName) || '';
  const calendar = indicator ? ` ${indicator}` : (event.calendarName ? ` · ${event.calendarName}` : '');
  const location = eventDetail !== 'minimal' && event.location ? ` — ${event.location}` : '';

  output += `${time}${!event.isAllDay ? '  ' : ' '}${event.title}${location}${calendar}\n`;
}
```

- [ ] **Step 4: Restore inline indicators in renderDailyView**

In `src/formatting.js` around line 616:

```javascript
for (const event of sorted) {
  const time = formatEventTime(event, locale, timezone);
  // Restore inline color indicators
  const indicator = calendarIndicators.get(event.calendarName) || '';
  const calendar = indicator ? ` ${indicator}` : (event.calendarName ? ` · ${event.calendarName}` : '');
  const location = eventDetail !== 'minimal' && event.location ? ` — ${event.location}` : '';

  output += `${time}${!event.isAllDay ? '  ' : ' '}${event.title}${location}${calendar}\n`;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- test/formatting.test.js -t "inline"`
Expected: PASS

- [ ] **Step 6: Commit inline color restoration**

```bash
git add src/formatting.js test/formatting.test.js
git commit -m "feat: restore inline calendar color indicators in digests

- Show color emoji next to each event in weekly digest
- Show color emoji next to each event in daily digest
- Fixes regression from commit b0885e1

refs: #3"
```

---

### Task 4: Fix Horizontal Rule Separator

**Files:**
- Modify: `src/formatting.js:237,602`
- Test: `test/formatting.test.js`

- [ ] **Step 1: Write failing test for HR length**

```javascript
// In test/formatting.test.js
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
  expect(result).toContain('────────────\n');
  expect(result).not.toContain('━━━━━━━━━━━━━━━━━━━━');
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

  expect(result).toContain('────────────\n');
  expect(result).not.toContain('━━━━━━━━━━━━━━━━━━━━');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/formatting.test.js -t "HR"`
Expected: FAIL - still using 20-character separator

- [ ] **Step 3: Update HR in renderWeekView**

In `src/formatting.js` around line 237:

```javascript
output += `*${dayName}*\n`;
output += `────────────\n`;  // Changed from `━━━━━━━━━━━━━━━━━━━━\n`
```

- [ ] **Step 4: Update HR in renderDailyView**

In `src/formatting.js` around line 602:

```javascript
output += `*${label} · ${dayName}*\n`;
output += `────────────\n`;  // Changed from `━━━━━━━━━━━━━━━━━━━━\n`
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- test/formatting.test.js -t "HR"`
Expected: PASS

- [ ] **Step 6: Commit HR fix**

```bash
git add src/formatting.js test/formatting.test.js
git commit -m "fix: shorten HR separator to prevent wrapping on mobile

- Reduce from 20 to 12 characters
- Use light horizontal box drawing character
- Ensures consistent rendering across devices

refs: #3"
```

---

### Task 5: Add Clickable Footer Links (Message → Canvas)

**Files:**
- Modify: `src/formatting.js:267,632`
- Modify: `src/bot.js:367-368`
- Test: `test/formatting.test.js`

- [ ] **Step 1: Write failing test for clickable footer links**

```javascript
// In test/formatting.test.js
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
  expect(result).toContain(`<${canvas_url}|Full schedule →>`);
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

  expect(result).toContain('Full schedule →');
  expect(result).not.toContain('<http');
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

  expect(result).toContain(`<${canvas_url}|Komplette Übersicht →>`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/formatting.test.js -t "clickable"`
Expected: FAIL - no Slack link syntax in output

- [ ] **Step 3: Add clickable link logic to renderWeekView**

In `src/formatting.js` around line 267:

```javascript
// Summary with calendar legend
const totalEvents = events.length;
const uniqueCalendars = new Set(events.map(e => e.calendarName).filter(Boolean)).size;
const eventLabel = totalEvents === 1 ? getTranslation(locale, 'event') : getTranslation(locale, 'events');
output += `${totalEvents} ${eventLabel}`;
if (uniqueCalendars > 0) {
  const calendarLabel = uniqueCalendars === 1 ? getTranslation(locale, 'calendar') : getTranslation(locale, 'calendars');
  output += ` · ${uniqueCalendars} ${calendarLabel}`;
}

// Add clickable link if canvas_url provided
const fullScheduleText = getTranslation(locale, 'fullSchedule');
if (options.canvas_url) {
  output += ` · <${options.canvas_url}|${fullScheduleText}>`;
} else {
  output += ` · ${fullScheduleText}`;
}
```

- [ ] **Step 4: Add clickable link logic to renderDailyView**

In `src/formatting.js` around line 632:

```javascript
// Summary
const totalEvents = events.length;
const uniqueCalendars = new Set(events.map(e => e.calendarName).filter(Boolean)).size;
const eventLabel = totalEvents === 1 ? getTranslation(locale, 'event') : getTranslation(locale, 'events');
output += `${totalEvents} ${eventLabel}`;
if (uniqueCalendars > 0) {
  const calendarLabel = uniqueCalendars === 1 ? getTranslation(locale, 'calendar') : getTranslation(locale, 'calendars');
  output += ` · ${uniqueCalendars} ${calendarLabel}`;
}

// Add clickable link if canvas_url provided
const fullScheduleText = getTranslation(locale, 'fullSchedule');
if (options.canvas_url) {
  output += ` · <${options.canvas_url}|${fullScheduleText}>`;
} else {
  output += ` · ${fullScheduleText}`;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- test/formatting.test.js -t "clickable"`
Expected: PASS

- [ ] **Step 6: Pass canvas_url from bot.js to renderers**

In `src/bot.js` around line 365-370:

```javascript
const cacheMap = await buildCacheMap(config);
const digest = type === 'daily'
  ? await renderDailyView(allEvents, dateRange, locale, {
      ...channel,
      timezone,
      config,
      cacheMap,
      canvas_url: channel.canvas_url  // Add this
    })
  : await renderWeekView(allEvents, dateRange, locale, {
      ...channel,
      timezone,
      config,
      cacheMap,
      canvas_url: channel.canvas_url  // Add this
    });
```

- [ ] **Step 7: Commit clickable footer links**

```bash
git add src/formatting.js src/bot.js test/formatting.test.js
git commit -m "feat: add clickable footer links from messages to Canvas

- Use Slack link syntax <url|text> when canvas_url configured
- Falls back to plain text when canvas_url missing
- Applies to both weekly and daily digests

refs: #3"
```

---

### Task 6: Add Canvas Footer Link (Canvas → Nextcloud)

**Files:**
- Modify: `src/formatting.js:659-682`
- Test: `test/formatting.test.js`

- [ ] **Step 1: Write failing test for Canvas Nextcloud link**

```javascript
// In test/formatting.test.js
test('renderCanvasContent adds Nextcloud link when nextcloud_url provided', async () => {
  const events = [{
    title: 'Test Event',
    start: new Date('2026-03-24T10:00:00Z'),
    end: new Date('2026-03-24T11:00:00Z'),
    isAllDay: false
  }];

  const config = {
    nextcloud_url: 'https://nextcloud.example.com/apps/calendar'
  };

  const result = await renderCanvasContent(events, { locale: 'en-US', config });

  expect(result).toContain('<https://nextcloud.example.com/apps/calendar|View in Nextcloud →>');
});

test('renderCanvasContent works without nextcloud_url', async () => {
  const events = [{
    title: 'Test Event',
    start: new Date('2026-03-24T10:00:00Z'),
    end: new Date('2026-03-24T11:00:00Z'),
    isAllDay: false
  }];

  const result = await renderCanvasContent(events, { locale: 'en-US', config: {} });

  expect(result).not.toContain('Nextcloud');
  expect(result).toContain('Test Event');
});

test('renderCanvasContent uses German text for de-DE locale', async () => {
  const events = [{
    title: 'Test Event',
    start: new Date('2026-03-24T10:00:00Z'),
    end: new Date('2026-03-24T11:00:00Z'),
    isAllDay: false
  }];

  const config = {
    nextcloud_url: 'https://nextcloud.example.com/apps/calendar'
  };

  const result = await renderCanvasContent(events, { locale: 'de-DE', config });

  expect(result).toContain('In Nextcloud ansehen →');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/formatting.test.js -t "Canvas"`
Expected: FAIL - no Nextcloud link in Canvas output

- [ ] **Step 3: Add Nextcloud link to renderCanvasContent**

In `src/formatting.js` around line 680 (after the renderWeekView call):

```javascript
async function renderCanvasContent(events, options = {}) {
  const { locale = 'en-US' } = options;

  // Get current week range
  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  const startOfWeek = new Date(now);
  startOfWeek.setUTCDate(now.getUTCDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1)); // Monday
  startOfWeek.setUTCHours(0, 0, 0, 0);

  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setUTCDate(startOfWeek.getUTCDate() + 6); // Sunday
  endOfWeek.setUTCHours(23, 59, 59, 999);

  const dateRange = { start: startOfWeek, end: endOfWeek };

  // Filter events to current week
  const weekEvents = events.filter(e => {
    const eventDate = new Date(e.start);
    return eventDate >= dateRange.start && eventDate <= dateRange.end;
  });

  let content = await renderWeekView(weekEvents, dateRange, locale, options);

  // Add Nextcloud link if configured
  if (options.config?.nextcloud_url) {
    const linkText = locale === 'de-DE' ? 'In Nextcloud ansehen →' : 'View in Nextcloud →';
    content += `\n\n<${options.config.nextcloud_url}|${linkText}>`;
  }

  return content;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/formatting.test.js -t "Canvas"`
Expected: PASS

- [ ] **Step 5: Commit Canvas Nextcloud link**

```bash
git add src/formatting.js test/formatting.test.js
git commit -m "feat: add Nextcloud link to Canvas footer

- Add clickable link from Canvas to Nextcloud calendar
- Uses translated text (de-DE: 'In Nextcloud ansehen →')
- Only shown when nextcloud_url configured

refs: #3"
```

---

### Task 7: Fix Weekly Schedule Timing (getCurrentWeekRange)

**Files:**
- Modify: `src/bot.js:380-392`
- Test: `test/bot.test.js`

- [ ] **Step 1: Write failing test for Sunday date range**

```javascript
// In test/bot.test.js (create if doesn't exist)
const { getChangeDetectionRange } = require('../src/bot');

// Need to access getCurrentWeekRange - may need to export it first
// For now, write tests that verify the behavior through higher-level functions

describe('Weekly date range calculation', () => {
  test('Sunday should return upcoming week (next Monday to Sunday)', () => {
    // Mock date to Sunday March 23, 2026
    const sunday = new Date('2026-03-23T12:00:00Z'); // Sunday
    jest.useFakeTimers();
    jest.setSystemTime(sunday);

    // We need getCurrentWeekRange exported
    const { getCurrentWeekRange } = require('../src/bot');
    const range = getCurrentWeekRange();

    // Should return March 24 (Monday) through March 30 (Sunday)
    expect(range.start.getUTCDate()).toBe(24);
    expect(range.start.getUTCDay()).toBe(1); // Monday
    expect(range.end.getUTCDate()).toBe(30);
    expect(range.end.getUTCDay()).toBe(0); // Sunday

    jest.useRealTimers();
  });

  test('Monday should return current week (this Monday to Sunday)', () => {
    const monday = new Date('2026-03-24T12:00:00Z'); // Monday
    jest.useFakeTimers();
    jest.setSystemTime(monday);

    const { getCurrentWeekRange } = require('../src/bot');
    const range = getCurrentWeekRange();

    // Should return March 24 (Monday) through March 30 (Sunday)
    expect(range.start.getUTCDate()).toBe(24);
    expect(range.start.getUTCDay()).toBe(1); // Monday
    expect(range.end.getUTCDate()).toBe(30);
    expect(range.end.getUTCDay()).toBe(0); // Sunday

    jest.useRealTimers();
  });

  test('Saturday should return current week (this Monday to Sunday)', () => {
    const saturday = new Date('2026-03-21T12:00:00Z'); // Saturday
    jest.useFakeTimers();
    jest.setSystemTime(saturday);

    const { getCurrentWeekRange } = require('../src/bot');
    const range = getCurrentWeekRange();

    // Should return March 16 (Monday) through March 22 (Sunday)
    expect(range.start.getUTCDate()).toBe(16);
    expect(range.start.getUTCDay()).toBe(1); // Monday
    expect(range.end.getUTCDate()).toBe(22);
    expect(range.end.getUTCDay()).toBe(0); // Sunday

    jest.useRealTimers();
  });
});
```

- [ ] **Step 2: Export getCurrentWeekRange from bot.js**

In `src/bot.js` at the bottom (around line 664):

```javascript
module.exports = {
  getChangeDetectionRange,
  getCurrentWeekRange  // Add this export
};
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- test/bot.test.js`
Expected: FAIL - Sunday returns previous week instead of upcoming

- [ ] **Step 4: Fix getCurrentWeekRange logic**

In `src/bot.js` around line 380:

```javascript
function getCurrentWeekRange() {
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const startOfWeek = new Date(now);

  if (dayOfWeek === 0) {
    // Sunday: show upcoming week (tomorrow's Monday through next Sunday)
    startOfWeek.setUTCDate(now.getUTCDate() + 1);
  } else {
    // Monday-Saturday: show current week (this Monday through this Sunday)
    startOfWeek.setUTCDate(now.getUTCDate() - dayOfWeek + 1);
  }

  startOfWeek.setUTCHours(0, 0, 0, 0);

  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setUTCDate(startOfWeek.getUTCDate() + 6);
  endOfWeek.setUTCHours(23, 59, 59, 999);

  return { start: startOfWeek, end: endOfWeek };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- test/bot.test.js`
Expected: PASS

- [ ] **Step 6: Commit weekly timing fix**

```bash
git add src/bot.js test/bot.test.js
git commit -m "fix: weekly schedule shows upcoming week when run on Sunday

- Sunday now returns next Monday-Sunday instead of previous week
- Monday-Saturday still return current week (this Monday-Sunday)
- Fixes issue where Sunday digest showed past events

refs: #13"
```

---

### Task 8: Fix Canvas Week Calculation

**Files:**
- Modify: `src/formatting.js:663-671`
- Test: `test/formatting.test.js`

- [ ] **Step 1: Write failing test for Canvas Sunday behavior**

```javascript
// In test/formatting.test.js
test('renderCanvasContent shows upcoming week when rendered on Sunday', async () => {
  const events = [
    {
      title: 'Next Week Event',
      start: new Date('2026-03-24T10:00:00Z'), // Monday March 24
      end: new Date('2026-03-24T11:00:00Z'),
      isAllDay: false
    },
    {
      title: 'This Week Event',
      start: new Date('2026-03-23T10:00:00Z'), // Sunday March 23
      end: new Date('2026-03-23T11:00:00Z'),
      isAllDay: false
    }
  ];

  // Mock to Sunday March 23, 2026
  const sunday = new Date('2026-03-23T12:00:00Z');
  jest.useFakeTimers();
  jest.setSystemTime(sunday);

  const result = await renderCanvasContent(events, { locale: 'en-US', config: {} });

  // Should include next week event (Monday March 24)
  expect(result).toContain('Next Week Event');
  // Should NOT include today (Sunday March 23) as it's end of previous week
  expect(result).not.toContain('This Week Event');

  jest.useRealTimers();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/formatting.test.js -t "Canvas Sunday"`
Expected: FAIL - includes wrong events

- [ ] **Step 3: Fix week calculation in renderCanvasContent**

In `src/formatting.js` around line 663:

```javascript
async function renderCanvasContent(events, options = {}) {
  const { locale = 'en-US' } = options;

  // Get current/upcoming week range (same logic as getCurrentWeekRange)
  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  const startOfWeek = new Date(now);

  if (dayOfWeek === 0) {
    // Sunday: show upcoming week (tomorrow's Monday through next Sunday)
    startOfWeek.setUTCDate(now.getUTCDate() + 1);
  } else {
    // Monday-Saturday: show current week (this Monday through this Sunday)
    startOfWeek.setUTCDate(now.getUTCDate() - dayOfWeek + 1);
  }

  startOfWeek.setUTCHours(0, 0, 0, 0);

  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setUTCDate(startOfWeek.getUTCDate() + 6);
  endOfWeek.setUTCHours(23, 59, 59, 999);

  const dateRange = { start: startOfWeek, end: endOfWeek };

  // Filter events to current/upcoming week
  const weekEvents = events.filter(e => {
    const eventDate = new Date(e.start);
    return eventDate >= dateRange.start && eventDate <= dateRange.end;
  });

  let content = await renderWeekView(weekEvents, dateRange, locale, options);

  // Add Nextcloud link if configured
  if (options.config?.nextcloud_url) {
    const linkText = locale === 'de-DE' ? 'In Nextcloud ansehen →' : 'View in Nextcloud →';
    content += `\n\n<${options.config.nextcloud_url}|${linkText}>`;
  }

  return content;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/formatting.test.js -t "Canvas Sunday"`
Expected: PASS

- [ ] **Step 5: Commit Canvas timing fix**

```bash
git add src/formatting.js test/formatting.test.js
git commit -m "fix: Canvas shows upcoming week when updated on Sunday

- Apply same Sunday logic as digest messages
- Ensures Canvas and message content stay in sync
- Sunday updates show next Monday-Sunday

refs: #13"
```

---

### Task 9: Update Cron Schedules

**Files:**
- Modify: `.github/workflows/scheduled.yml`
- Modify: `.github/workflows/change-detection.yml`

- [ ] **Step 1: Update scheduled digest workflow with documentation**

In `.github/workflows/scheduled.yml`:

```yaml
name: Scheduled Digests

on:
  schedule:
    # IMPORTANT: Configure these cron schedules to match your channel digest_schedule settings
    #
    # Example configurations:
    # - If you have "sunday 18:00" in config.json, use: - cron: '0 18 * * 0'
    # - If you have "weekdays 08:00" in config.json, use: - cron: '0 8 * * 1-5'
    # - If you have "daily 09:00" in config.json, use: - cron: '0 9 * * *'
    #
    # Uncomment and adjust these examples to match your config.json channel settings:
    - cron: '0 18 * * 0'  # Sunday 18:00 UTC
    - cron: '0 8 * * 1-5'  # Weekdays 08:00 UTC
  workflow_dispatch:
    inputs:
      digest_type:
        description: 'Digest type to run'
        required: true
        default: 'scheduled'
        type: choice
        options: [weekly, daily, scheduled]
      dry_run:
        description: 'Dry run (no Slack API calls)'
        required: false
        default: false
        type: boolean

jobs:
  digest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Write config
        env:
          CONFIG_JSON: ${{ secrets.CONFIG_JSON }}
        run: printf '%s' "$CONFIG_JSON" > config.json

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test

      - name: Run scheduled digests
        if: github.event_name == 'schedule'
        env:
          CALDAV_PASSWORD: ${{ secrets.CALDAV_PASSWORD }}
          SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
        run: node src/bot.js --scheduled

      - name: Run manual digest
        if: github.event_name == 'workflow_dispatch'
        env:
          CALDAV_PASSWORD: ${{ secrets.CALDAV_PASSWORD }}
          SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
        run: |
          DRY_RUN=""
          if [ "${{ inputs.dry_run }}" = "true" ]; then
            DRY_RUN="--dry-run"
          fi

          if [ "${{ inputs.digest_type }}" = "scheduled" ]; then
            node src/bot.js --scheduled $DRY_RUN
          else
            node src/bot.js --${{ inputs.digest_type }}-digest $DRY_RUN
          fi
```

- [ ] **Step 2: Update change detection cron schedule**

In `.github/workflows/change-detection.yml` line 5:

```yaml
name: Change Detection

on:
  schedule:
    - cron: '0 6-18/2 * * *'  # Every 2 hours between 06:00 and 18:00 UTC (7 runs/day)
  workflow_dispatch:
    inputs:
      dry_run:
        description: 'Dry run (no Slack API calls or cache commits)'
        required: false
        default: false
        type: boolean

jobs:
  detect-changes:
    runs-on: ubuntu-latest
    permissions:
      contents: write  # Allow creating and pushing to cache-state branch
    steps:
      # ... rest of workflow unchanged
```

- [ ] **Step 3: Commit workflow updates**

```bash
git add .github/workflows/scheduled.yml .github/workflows/change-detection.yml
git commit -m "feat: optimize cron schedules for digest and change detection

- Scheduled digest: document user-configurable cron matching config
- Change detection: run every 2 hours 6am-6pm UTC (not 24/7)
- Reduces unnecessary runs during night hours

refs: #6"
```

---

### Task 10: Integration Testing and Documentation

**Files:**
- Test: Manual integration testing
- Verify: All changes work together

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 2: Test with dry-run - weekly digest**

Run: `node src/bot.js --weekly-digest --dry-run`

Verify output:
- No 📅 or 📆 emojis
- Calendar color indicators inline with events
- 12-character HR separator
- Footer shows clickable link format if canvas_url in config
- Canvas content includes Nextcloud link if configured

- [ ] **Step 3: Test with dry-run - daily digest**

Run: `node src/bot.js --daily-digest --dry-run`

Verify same formatting improvements as weekly

- [ ] **Step 4: Test Sunday date range behavior**

Mock system date to Sunday and run:
```bash
# This would require modifying bot.js temporarily to accept a test date
# Or run the actual test on a Sunday
```

Verify: Date range shows upcoming Monday-Sunday

- [ ] **Step 5: Update README documentation**

Add section to README explaining:
- New config fields (workspace_id, canvas_url, nextcloud_url)
- How to configure cron schedules to match digest_schedule
- Example configurations

- [ ] **Step 6: Final commit**

```bash
git add README.md
git commit -m "docs: update README with new config fields and cron setup

- Document workspace_id, canvas_url, nextcloud_url fields
- Explain how to configure workflow cron schedules
- Add migration notes for existing users

refs: #3, #6, #13"
```

---

## Post-Implementation Checklist

After completing all tasks:

- [ ] All tests passing
- [ ] Dry-run output verified for both weekly and daily digests
- [ ] Config validation working correctly
- [ ] Workflow files updated with correct cron schedules
- [ ] README documentation updated
- [ ] All commits reference appropriate issue numbers

## Testing in Production

1. Update `config.json` with new required fields (workspace_id, canvas_url, nextcloud_url)
2. Deploy changes to production
3. Wait for next scheduled run or trigger manually via workflow_dispatch
4. Verify in Slack:
   - Messages have no decorative emojis
   - Calendar colors show inline with events
   - HR separators don't wrap on mobile
   - Footer links are clickable
   - Canvas shows Nextcloud link
5. Verify on Sunday: weekly digest shows upcoming week

## Rollback Plan

If issues are found in production:

1. Revert to previous commit: `git revert HEAD~10..HEAD`
2. Redeploy
3. Investigate failures and fix in development
4. Redeploy fixed version

## Success Metrics

- ✓ No 📅 or 📆 emojis in digest messages
- ✓ Calendar color indicators visible inline with events
- ✓ HR separators render correctly on mobile
- ✓ Footer links are clickable in Slack
- ✓ Canvas links to Nextcloud
- ✓ Weekly digest shows correct date range on Sunday
- ✓ Change detection runs only during working hours
- ✓ Scheduled digests run only when configured
