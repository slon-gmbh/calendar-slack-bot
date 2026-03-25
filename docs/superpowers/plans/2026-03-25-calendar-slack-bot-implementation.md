# Calendar Slack Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a GitHub Actions-based Slack bot that bridges Nextcloud CalDAV calendars with Slack channels, posting automated digests and change notifications.

**Architecture:** Monolithic Node.js script with clean module boundaries. Six core modules (config, caldav, slack, formatting, diff, scheduler) + main entry point. Two GitHub Actions workflows (scheduled hourly polling, webhook-triggered changes). All secrets via GitHub Secrets, config via CONFIG_JSON secret.

**Tech Stack:** Node.js 20, `node-ical`, `@slack/web-api`, `@actions/cache`, GitHub Actions, TDD with `node:test`

---

## Scope Check

This spec describes a single cohesive system with clear module boundaries. The implementation will proceed as one plan, building modules in dependency order.

## File Structure

### Core Application
- `src/bot.js` - Main entry point, CLI routing, flow orchestration
- `src/config.js` - Config loading, validation, env var resolution
- `src/caldav.js` - CalDAV fetching, iCalendar parsing, recurring event expansion
- `src/slack.js` - Slack API wrapper (messages, Canvas, errors)
- `src/formatting.js` - Message/Canvas rendering, locale handling
- `src/diff.js` - Event change detection, cache management
- `src/scheduler.js` - Urgency classification, debounce logic, schedule matching

### Tests (pure functions only)
- `test/config.test.js` - Config validation tests
- `test/formatting.test.js` - Rendering tests (week view, notifications, locale)
- `test/diff.test.js` - Event diffing tests
- `test/scheduler.test.js` - Urgency/schedule matching tests

### Workflows
- `.github/workflows/scheduled.yml` - Hourly cron for digest polling
- `.github/workflows/webhook.yml` - Nextcloud webhook handler

### Configuration
- `config.example.json` - Fully commented example config
- `.gitignore` - Ensure config.json is gitignored
- `package.json` - Dependencies and scripts
- `package-lock.json` - Locked versions

### Documentation
- `README.md` - Setup guide, usage model, prerequisites

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `src/.gitkeep`
- Create: `test/.gitkeep`
- Create: `.github/workflows/.gitkeep`

- [ ] **Step 1: Initialize package.json**

```bash
npm init -y
```

- [ ] **Step 2: Update package.json with dependencies and scripts**

Edit `package.json`:
```json
{
  "name": "calendar-slack-bot",
  "version": "1.0.0",
  "description": "GitHub Actions-based Slack bot bridging Nextcloud CalDAV with Slack",
  "main": "src/bot.js",
  "scripts": {
    "test": "node --test test/**/*.test.js"
  },
  "keywords": ["slack", "calendar", "caldav", "nextcloud", "github-actions"],
  "author": "",
  "license": "MIT",
  "engines": {
    "node": ">=20.0.0"
  },
  "dependencies": {
    "node-ical": "^0.18.0",
    "@slack/web-api": "^7.0.0",
    "@actions/cache": "^3.0.0"
  }
}
```

- [ ] **Step 3: Install dependencies**

```bash
npm install
```

Expected: Dependencies installed, `node_modules/` and `package-lock.json` created

- [ ] **Step 4: Create .gitignore**

Create `.gitignore`:
```
# Dependencies
node_modules/

# Config (injected at runtime via GitHub Secret)
config.json

# Logs
*.log
npm-debug.log*

# OS
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/
*.sw*
```

- [ ] **Step 5: Create directory structure**

```bash
mkdir -p src test .github/workflows docs/superpowers/specs docs/superpowers/plans
touch src/.gitkeep test/.gitkeep .github/workflows/.gitkeep
```

- [ ] **Step 6: Commit scaffolding**

```bash
git add package.json package-lock.json .gitignore src/.gitkeep test/.gitkeep .github/workflows/.gitkeep
git commit -m "chore: initialize project scaffolding with dependencies"
```

---

## Task 2: Config Module (Foundation)

**Files:**
- Create: `src/config.js`
- Create: `test/config.test.js`
- Create: `config.example.json`

- [ ] **Step 1: Write failing test for config loading**

Create `test/config.test.js`:
```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const { loadConfig, validateConfig } = require('../src/config.js');

test('loadConfig should load and parse config.json', async () => {
  // This will fail until we implement loadConfig
  const config = await loadConfig('./test/fixtures/valid-config.json');
  assert.strictEqual(typeof config, 'object');
  assert.ok(config.locale);
  assert.ok(config.calendars);
  assert.ok(config.channels);
});

test('validateConfig should reject missing required fields', () => {
  const invalidConfig = { locale: 'en-US' }; // missing calendars and channels
  assert.throws(
    () => validateConfig(invalidConfig),
    /Config error/
  );
});

test('validateConfig should reject invalid calendar references', () => {
  const invalidConfig = {
    locale: 'en-US',
    caldav_credentials: { username: 'test', password: 'test' },
    calendars: { 'cal1': { name: 'Cal 1', caldav_url: 'http://test' } },
    channels: [{
      id: 'C123',
      canvas_id: 'F123',
      calendars: ['cal1', 'cal2'] // cal2 doesn't exist
    }]
  };
  assert.throws(
    () => validateConfig(invalidConfig),
    /calendar 'cal2' which is not defined/
  );
});

test('validateConfig should resolve environment variables', () => {
  process.env.TEST_VAR = 'resolved_value';
  const config = {
    locale: 'en-US',
    caldav_credentials: {
      username: '${TEST_VAR}',
      password: 'plain_password'
    },
    calendars: {},
    channels: []
  };
  const validated = validateConfig(config);
  assert.strictEqual(validated.caldav_credentials.username, 'resolved_value');
  delete process.env.TEST_VAR;
});

test('validateConfig should reject invalid schedule format', () => {
  const invalidConfig = {
    locale: 'en-US',
    caldav_credentials: { username: 'test', password: 'test' },
    calendars: {},
    channels: [{
      id: 'C123',
      canvas_id: 'F123',
      calendars: [],
      digest_schedule: 'monday 25:00' // invalid hour
    }]
  };
  assert.throws(
    () => validateConfig(invalidConfig),
    /invalid.*schedule/i
  );
});
```

- [ ] **Step 2: Create test fixtures directory**

```bash
mkdir -p test/fixtures
```

Create `test/fixtures/valid-config.json`:
```json
{
  "locale": "en-US",
  "caldav_credentials": {
    "username": "testuser",
    "password": "testpass"
  },
  "calendars": {
    "test-cal": {
      "name": "Test Calendar",
      "caldav_url": "https://test.example.com/calendar"
    }
  },
  "channels": [
    {
      "id": "C123TEST",
      "canvas_id": "F123TEST",
      "calendars": ["test-cal"],
      "digest_schedule": "sunday 18:00"
    }
  ]
}
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npm test
```

Expected: FAIL - `loadConfig` and `validateConfig` are not defined

- [ ] **Step 4: Implement config.js with validation**

Create `src/config.js`:
```javascript
const { readFile } = require('node:fs/promises');

/**
 * Load and validate configuration from file
 * @param {string} configPath - Path to config.json
 * @returns {Promise<Object>} Validated config object
 */
async function loadConfig(configPath = './config.json') {
  try {
    const content = await readFile(configPath, 'utf-8');
    const config = JSON.parse(content);
    return validateConfig(config);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Config file not found: ${configPath}`);
    }
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in config file: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Validate and process configuration
 * @param {Object} config - Raw config object
 * @returns {Object} Validated config with resolved env vars
 */
function validateConfig(config) {
  // Check required top-level fields
  if (!config.locale) {
    throw new Error('Config error: missing required field "locale"');
  }
  if (!config.caldav_credentials) {
    throw new Error('Config error: missing required field "caldav_credentials"');
  }
  if (!config.caldav_credentials.username || !config.caldav_credentials.password) {
    throw new Error('Config error: caldav_credentials must have username and password');
  }
  if (!config.calendars || typeof config.calendars !== 'object') {
    throw new Error('Config error: missing or invalid "calendars" field');
  }
  if (!Array.isArray(config.channels)) {
    throw new Error('Config error: "channels" must be an array');
  }

  // Resolve environment variables in config
  const resolved = JSON.parse(JSON.stringify(config)); // deep clone
  resolveEnvVars(resolved);

  // Validate calendar references
  for (const channel of resolved.channels) {
    if (!channel.id) {
      throw new Error(`Config error: channel missing required field "id"`);
    }
    if (!channel.canvas_id) {
      throw new Error(`Config error: channel '${channel.id}' missing required field "canvas_id"`);
    }
    if (!Array.isArray(channel.calendars) || channel.calendars.length === 0) {
      throw new Error(`Config error: channel '${channel.id}' must have at least one calendar`);
    }

    for (const calId of channel.calendars) {
      if (!resolved.calendars[calId]) {
        throw new Error(
          `Config error: channel '${channel.id}' references calendar '${calId}' which is not defined in calendars`
        );
      }
    }

    // Validate schedule format if present
    if (channel.digest_schedule && channel.digest_schedule !== false) {
      validateScheduleFormat(channel.digest_schedule, `channel '${channel.id}' digest_schedule`);
    }
    if (channel.daily_digest_schedule && channel.daily_digest_schedule !== false) {
      validateScheduleFormat(channel.daily_digest_schedule, `channel '${channel.id}' daily_digest_schedule`);
    }
  }

  // Validate locale format (basic BCP 47 pattern check)
  if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(resolved.locale)) {
    throw new Error(`Config error: invalid locale '${resolved.locale}' - must be a valid BCP 47 language tag`);
  }

  return resolved;
}

/**
 * Recursively resolve ${ENV_VAR} placeholders
 */
function resolveEnvVars(obj) {
  for (const key in obj) {
    if (typeof obj[key] === 'string') {
      const match = obj[key].match(/^\$\{([^}]+)\}$/);
      if (match) {
        const envVar = match[1];
        if (!process.env[envVar]) {
          throw new Error(`Config error: ${envVar} environment variable is not set`);
        }
        obj[key] = process.env[envVar];
      }
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      resolveEnvVars(obj[key]);
    }
  }
}

/**
 * Validate schedule format
 * Accepts: "monday 14:30", "weekdays 08:00", "0 18 * * 0" (cron), false
 */
function validateScheduleFormat(schedule, fieldName) {
  if (schedule === false) return;

  // Check for cron format (5 fields)
  if (/^\d+\s+\d+\s+\*\s+\*\s+[\d,\-*]+$/.test(schedule)) {
    return; // Valid cron expression
  }

  // Check for human-readable format: "<day> <HH:MM>"
  const match = schedule.match(/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekdays|weekends|daily)\s+(\d{2}):(\d{2})$/i);
  if (!match) {
    throw new Error(
      `Config error: invalid schedule format for ${fieldName}: "${schedule}". ` +
      `Expected format: "day HH:MM" (e.g., "monday 14:30") or cron expression`
    );
  }

  const [, , hours, minutes] = match;
  const h = parseInt(hours, 10);
  const m = parseInt(minutes, 10);

  if (h < 0 || h > 23) {
    throw new Error(`Config error: invalid schedule for ${fieldName}: hour must be 00-23`);
  }
  if (m < 0 || m > 59) {
    throw new Error(`Config error: invalid schedule for ${fieldName}: minute must be 00-59`);
  }
}

module.exports = {
  loadConfig,
  validateConfig
};
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test
```

Expected: All config tests PASS

- [ ] **Step 6: Create config.example.json**

Create `config.example.json`:
```json
{
  "locale": "en-US",
  "error_channel": "C01234ERROR",
  "caldav_credentials": {
    "username": "${CALDAV_USERNAME}",
    "password": "${CALDAV_PASSWORD}"
  },
  "calendars": {
    "team-calendar": {
      "name": "Team Calendar",
      "caldav_url": "https://nextcloud.example.com/remote.php/dav/calendars/user/team/"
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
      "calendars": ["team-calendar", "project-x"],
      "locale": "de-DE",
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

- [ ] **Step 7: Commit config module**

```bash
git add src/config.js test/config.test.js test/fixtures/ config.example.json
git commit -m "feat(config): add config loading and validation with env var resolution"
```

---

## Task 3: Formatting Module (Core Rendering)

**Files:**
- Create: `src/formatting.js`
- Create: `test/formatting.test.js`

- [ ] **Step 1: Write failing tests for rendering functions**

Create `test/formatting.test.js`:
```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const {
  renderWeekView,
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
  assert.match(enUS, /9:00/); // US format includes AM/PM

  const deDE = formatEventTime(event, 'de-DE');
  assert.match(deDE, /09:00/); // German 24-hour format
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
  assert.match(result, /✏️.*1 updated/);
  assert.match(result, /New Meeting/);
  assert.match(result, /Cancelled Event/);
  assert.match(result, /Moved Meeting/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```

Expected: FAIL - formatting functions not defined

- [ ] **Step 3: Implement formatting.js with basic rendering**

Create `src/formatting.js`:
```javascript
/**
 * Formatting and rendering module for digest messages and Canvas content
 */

/**
 * Calendar color indicators for multi-calendar channels
 */
const CALENDAR_INDICATORS = ['🟦', '🟩', '🟨', '🟧', '🟪', '🟥', '⬜'];

/**
 * Assign color indicators to calendars
 * @param {Array} events - Events with calendarName property
 * @returns {Map} Map of calendar name to indicator
 */
function assignCalendarIndicators(events) {
  const uniqueCalendars = [...new Set(events.map(e => e.calendarName).filter(Boolean))];

  // Only use indicators if multiple calendars
  if (uniqueCalendars.length <= 1) {
    return new Map();
  }

  const indicatorMap = new Map();
  uniqueCalendars.forEach((cal, index) => {
    indicatorMap.set(cal, CALENDAR_INDICATORS[index % CALENDAR_INDICATORS.length]);
  });

  return indicatorMap;
}

/**
 * Format event time based on locale
 * @param {Object} event - Event object with start, end, isAllDay
 * @param {string} locale - BCP 47 locale (e.g., 'en-US', 'de-DE')
 * @returns {string} Formatted time string
 */
function formatEventTime(event, locale = 'en-US') {
  if (event.isAllDay) {
    return '📅';
  }

  const timeFormat = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: locale.startsWith('en-US')
  });

  return timeFormat.format(event.start);
}

/**
 * Format date for display
 */
function formatDate(date, locale = 'en-US') {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    month: 'short',
    day: 'numeric'
  }).format(date);
}

/**
 * Get week number from date
 */
function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

/**
 * Render week view digest
 * @param {Array} events - Array of event objects
 * @param {Object} dateRange - { start: Date, end: Date }
 * @param {string} locale - Locale for formatting
 * @param {Object} options - { showEmptyDays, viewMode, eventDetail }
 * @returns {string} Formatted week view
 */
function renderWeekView(events, dateRange, locale = 'en-US', options = {}) {
  const { showEmptyDays = false, viewMode = 'merged', eventDetail = 'standard' } = options;

  const weekNum = getWeekNumber(dateRange.start);
  const startDate = formatDate(dateRange.start, locale).split(',')[0]; // Just day name
  const endDate = formatDate(dateRange.end, locale).split(',')[0];

  let output = `📅 Week ${weekNum} · ${startDate} — ${endDate}\n\n`;

  // Assign calendar indicators (only if multiple calendars)
  const calendarIndicators = assignCalendarIndicators(events);

  // Group events by day
  const eventsByDay = new Map();
  const currentDate = new Date(dateRange.start);

  while (currentDate <= dateRange.end) {
    const dayKey = currentDate.toISOString().split('T')[0];
    eventsByDay.set(dayKey, []);
    currentDate.setDate(currentDate.getDate() + 1);
  }

  // Populate events
  for (const event of events) {
    const eventDate = new Date(event.start);
    const dayKey = eventDate.toISOString().split('T')[0];
    if (eventsByDay.has(dayKey)) {
      eventsByDay.get(dayKey).push(event);
    }
  }

  // Render each day
  for (const [dayKey, dayEvents] of eventsByDay) {
    const date = new Date(dayKey + 'T12:00:00Z');
    const dayName = formatDate(date, locale);

    if (dayEvents.length === 0 && !showEmptyDays) {
      continue;
    }

    output += `${dayName}\n`;
    output += `━━━━━━━━━━━━━━━━━━━━\n`;

    if (dayEvents.length === 0) {
      output += `(nothing scheduled)\n\n`;
      continue;
    }

    // Sort: all-day first, then by time
    const sorted = dayEvents.sort((a, b) => {
      if (a.isAllDay && !b.isAllDay) return -1;
      if (!a.isAllDay && b.isAllDay) return 1;
      return a.start - b.start;
    });

    for (const event of sorted) {
      const time = formatEventTime(event, locale);
      const indicator = calendarIndicators.get(event.calendarName) || '';
      const calendar = indicator ? ` ${indicator}` : (event.calendarName ? ` · ${event.calendarName}` : '');
      const location = eventDetail !== 'minimal' && event.location ? ` — ${event.location}` : '';

      output += `${time}${!event.isAllDay ? '  ' : ' '}${event.title}${location}${calendar}\n`;
    }

    output += '\n';
  }

  // Summary with calendar legend
  const totalEvents = events.length;
  const uniqueCalendars = new Set(events.map(e => e.calendarName).filter(Boolean)).size;
  output += `📆 ${totalEvents} event${totalEvents !== 1 ? 's' : ''}`;
  if (uniqueCalendars > 0) {
    output += ` · ${uniqueCalendars} calendar${uniqueCalendars !== 1 ? 's' : ''}`;
  }
  output += ` · Full schedule →`;

  // Add calendar legend if multiple calendars
  if (calendarIndicators.size > 0) {
    output += '\n\n';
    for (const [calName, indicator] of calendarIndicators) {
      output += `${indicator} ${calName}  `;
    }
  }

  output += '\n';

  return output;
}

/**
 * Render change notification for a single event change
 * @param {Object} diff - Diff object from diffEvents
 * @param {string} locale - Locale for formatting
 * @returns {string} Formatted notification
 */
function renderChangeNotification(diff, locale = 'en-US') {
  const { type, event, old, new: newData, calendarName } = diff;

  const dateStr = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  }).format(event.start);

  const calendar = calendarName ? ` · ${calendarName}` : '';

  switch (type) {
    case 'new':
      const newTime = formatEventTime(event, locale);
      return `➕ **New:** ${event.title} · ${dateStr} · ${newTime}${calendar}`;

    case 'deleted':
      const delTime = formatEventTime(event, locale);
      return `🗑️ **Cancelled:** ${event.title} · ${dateStr} · ${delTime}${calendar}`;

    case 'time_changed':
      const oldTime = formatEventTime({ ...event, start: old.start, isAllDay: event.isAllDay }, locale);
      const newTime2 = formatEventTime({ ...event, start: newData.start, isAllDay: event.isAllDay }, locale);
      return `✏️ **Moved:** ${event.title} · ${dateStr} · ${oldTime} → ${newTime2}${calendar}`;

    case 'title_changed':
      const titleTime = formatEventTime(event, locale);
      return `✏️ **Updated:** ${event.title} · ${dateStr} · ${titleTime} (renamed)${calendar}`;

    case 'location_changed':
      const locTime = formatEventTime(event, locale);
      return `✏️ **Updated:** ${event.title} · ${dateStr} · ${locTime} (location changed)${calendar}`;

    default:
      const defaultTime = formatEventTime(event, locale);
      return `✏️ **Updated:** ${event.title} · ${dateStr} · ${defaultTime}${calendar}`;
  }
}

/**
 * Render bundled change notifications (debounced)
 * @param {Array} diffs - Array of diff objects
 * @param {string} locale - Locale for formatting
 * @returns {string} Formatted bundled notification
 */
function renderBundledNotification(diffs, locale = 'en-US') {
  if (diffs.length === 0) return '';
  if (diffs.length === 1) return renderChangeNotification(diffs[0], locale);

  let output = `📬 **${diffs.length} calendar changes**\n\n`;

  // Group by change type
  const grouped = {
    new: diffs.filter(d => d.type === 'new'),
    deleted: diffs.filter(d => d.type === 'deleted'),
    modified: diffs.filter(d => d.type !== 'new' && d.type !== 'deleted')
  };

  // Render new events
  if (grouped.new.length > 0) {
    output += `➕ **${grouped.new.length} new event${grouped.new.length !== 1 ? 's' : ''}:**\n`;
    for (const diff of grouped.new) {
      const { event, calendarName } = diff;
      const dateStr = new Intl.DateTimeFormat(locale, {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      }).format(event.start);
      const time = formatEventTime(event, locale);
      const calendar = calendarName ? ` · ${calendarName}` : '';
      output += `• ${event.title} · ${dateStr} · ${time}${calendar}\n`;
    }
    output += '\n';
  }

  // Render cancelled events
  if (grouped.deleted.length > 0) {
    output += `🗑️ **${grouped.deleted.length} cancelled:**\n`;
    for (const diff of grouped.deleted) {
      const { event, calendarName } = diff;
      const dateStr = new Intl.DateTimeFormat(locale, {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      }).format(event.start);
      const time = formatEventTime(event, locale);
      const calendar = calendarName ? ` · ${calendarName}` : '';
      output += `• ${event.title} · ${dateStr} · ${time}${calendar}\n`;
    }
    output += '\n';
  }

  // Render modified events
  if (grouped.modified.length > 0) {
    output += `✏️ **${grouped.modified.length} updated:**\n`;
    for (const diff of grouped.modified) {
      const { type, event, old, new: newData, calendarName } = diff;
      const dateStr = new Intl.DateTimeFormat(locale, {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      }).format(event.start);
      const calendar = calendarName ? ` · ${calendarName}` : '';

      if (type === 'time_changed') {
        const oldTime = formatEventTime({ ...event, start: old.start, isAllDay: event.isAllDay }, locale);
        const newTime = formatEventTime({ ...event, start: newData.start, isAllDay: event.isAllDay }, locale);
        output += `• ${event.title} · ${dateStr} · ${oldTime} → ${newTime}${calendar}\n`;
      } else if (type === 'title_changed') {
        output += `• ${event.title} (renamed) · ${dateStr}${calendar}\n`;
      } else if (type === 'location_changed') {
        output += `• ${event.title} (location changed) · ${dateStr}${calendar}\n`;
      } else {
        output += `• ${event.title} · ${dateStr}${calendar}\n`;
      }
    }
  }

  return output.trim();
}

/**
 * Render daily view with Today/Tomorrow labels
 * @param {Array} events - Array of event objects
 * @param {Object} dateRange - { start: Date, end: Date } (typically today + tomorrow)
 * @param {string} locale - Locale for formatting
 * @param {Object} options - Rendering options
 * @returns {string} Formatted daily view
 */
function renderDailyView(events, dateRange, locale = 'en-US', options = {}) {
  const { showEmptyDays = false, eventDetail = 'standard' } = options;

  let output = `📅 Daily Schedule\n\n`;

  // Assign calendar indicators
  const calendarIndicators = assignCalendarIndicators(events);

  // Get today and tomorrow dates
  const now = new Date();
  const todayKey = now.toISOString().split('T')[0];
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const tomorrowKey = tomorrow.toISOString().split('T')[0];

  // Group events by day
  const eventsByDay = new Map();
  eventsByDay.set(todayKey, []);
  eventsByDay.set(tomorrowKey, []);

  for (const event of events) {
    const eventDate = new Date(event.start);
    const dayKey = eventDate.toISOString().split('T')[0];
    if (eventsByDay.has(dayKey)) {
      eventsByDay.get(dayKey).push(event);
    }
  }

  // Render each day
  for (const [dayKey, dayEvents] of eventsByDay) {
    const date = new Date(dayKey + 'T12:00:00Z');
    const dayName = formatDate(date, locale);
    const label = dayKey === todayKey ? 'Today' : 'Tomorrow';

    if (dayEvents.length === 0 && !showEmptyDays) {
      continue;
    }

    output += `${label} · ${dayName}\n`;
    output += `━━━━━━━━━━━━━━━━━━━━\n`;

    if (dayEvents.length === 0) {
      output += `(nothing scheduled)\n\n`;
      continue;
    }

    // Sort: all-day first, then by time
    const sorted = dayEvents.sort((a, b) => {
      if (a.isAllDay && !b.isAllDay) return -1;
      if (!a.isAllDay && b.isAllDay) return 1;
      return a.start - b.start;
    });

    for (const event of sorted) {
      const time = formatEventTime(event, locale);
      const indicator = calendarIndicators.get(event.calendarName) || '';
      const calendar = indicator ? ` ${indicator}` : (event.calendarName ? ` · ${event.calendarName}` : '');
      const location = eventDetail !== 'minimal' && event.location ? ` — ${event.location}` : '';

      output += `${time}${!event.isAllDay ? '  ' : ' '}${event.title}${location}${calendar}\n`;
    }

    output += '\n';
  }

  // Summary
  const totalEvents = events.length;
  const uniqueCalendars = new Set(events.map(e => e.calendarName).filter(Boolean)).size;
  output += `📆 ${totalEvents} event${totalEvents !== 1 ? 's' : ''}`;
  if (uniqueCalendars > 0) {
    output += ` · ${uniqueCalendars} calendar${uniqueCalendars !== 1 ? 's' : ''}`;
  }
  output += ` · Full schedule →`;

  // Add calendar legend if multiple calendars
  if (calendarIndicators.size > 0) {
    output += '\n\n';
    for (const [calName, indicator] of calendarIndicators) {
      output += `${indicator} ${calName}  `;
    }
  }

  output += '\n';

  return output;
}

/**
 * Render Canvas content (markdown format)
 * @param {Array} events - Array of event objects
 * @param {Object} options - Rendering options
 * @returns {string} Canvas markdown
 */
function renderCanvasContent(events, options = {}) {
  const { locale = 'en-US' } = options;

  // Get current week range
  const now = new Date();
  const dayOfWeek = now.getDay();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1)); // Monday
  startOfWeek.setHours(0, 0, 0, 0);

  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6); // Sunday
  endOfWeek.setHours(23, 59, 59, 999);

  const dateRange = { start: startOfWeek, end: endOfWeek };

  // Filter events to current week
  const weekEvents = events.filter(e => {
    const eventDate = new Date(e.start);
    return eventDate >= dateRange.start && eventDate <= dateRange.end;
  });

  return renderWeekView(weekEvents, dateRange, locale, options);
}

module.exports = {
  formatEventTime,
  renderWeekView,
  renderChangeNotification,
  renderBundledNotification,
  renderDailyView,
  renderCanvasContent
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```

Expected: All formatting tests PASS

- [ ] **Step 5: Commit formatting module**

```bash
git add src/formatting.js test/formatting.test.js
git commit -m "feat(formatting): add message and Canvas rendering with locale support"
```

---

## Task 4: Diff Module (Event Change Detection)

**Files:**
- Create: `src/diff.js`
- Create: `test/diff.test.js`

- [ ] **Step 1: Write failing tests for diff detection**

Create `test/diff.test.js`:
```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const { diffEvents } = require('../src/diff.js');

test('diffEvents should detect new events', () => {
  const previous = [];
  const current = [
    { id: 'e1', title: 'New Event', start: new Date(), end: new Date() }
  ];

  const diffs = diffEvents(previous, current);
  assert.strictEqual(diffs.length, 1);
  assert.strictEqual(diffs[0].type, 'new');
  assert.strictEqual(diffs[0].event.id, 'e1');
});

test('diffEvents should detect deleted events', () => {
  const previous = [
    { id: 'e1', title: 'Old Event', start: new Date(), end: new Date() }
  ];
  const current = [];

  const diffs = diffEvents(previous, current);
  assert.strictEqual(diffs.length, 1);
  assert.strictEqual(diffs[0].type, 'deleted');
  assert.strictEqual(diffs[0].event.id, 'e1');
});

test('diffEvents should detect time changes', () => {
  const oldStart = new Date('2026-03-25T09:00:00Z');
  const newStart = new Date('2026-03-25T10:00:00Z');

  const previous = [
    { id: 'e1', title: 'Event', start: oldStart, end: new Date(), location: 'Room A' }
  ];
  const current = [
    { id: 'e1', title: 'Event', start: newStart, end: new Date(), location: 'Room A' }
  ];

  const diffs = diffEvents(previous, current);
  assert.strictEqual(diffs.length, 1);
  assert.strictEqual(diffs[0].type, 'time_changed');
  assert.deepStrictEqual(diffs[0].old.start, oldStart);
  assert.deepStrictEqual(diffs[0].new.start, newStart);
});

test('diffEvents should detect title changes', () => {
  const previous = [
    { id: 'e1', title: 'Old Title', start: new Date(), end: new Date() }
  ];
  const current = [
    { id: 'e1', title: 'New Title', start: new Date(), end: new Date() }
  ];

  const diffs = diffEvents(previous, current);
  assert.strictEqual(diffs.length, 1);
  assert.strictEqual(diffs[0].type, 'title_changed');
});

test('diffEvents should detect location changes', () => {
  const previous = [
    { id: 'e1', title: 'Event', start: new Date(), end: new Date(), location: 'Room A' }
  ];
  const current = [
    { id: 'e1', title: 'Event', start: new Date(), end: new Date(), location: 'Room B' }
  ];

  const diffs = diffEvents(previous, current);
  assert.strictEqual(diffs.length, 1);
  assert.strictEqual(diffs[0].type, 'location_changed');
});

test('diffEvents should ignore description changes', () => {
  const previous = [
    { id: 'e1', title: 'Event', start: new Date(), end: new Date(), description: 'Old desc' }
  ];
  const current = [
    { id: 'e1', title: 'Event', start: new Date(), end: new Date(), description: 'New desc' }
  ];

  const diffs = diffEvents(previous, current);
  assert.strictEqual(diffs.length, 0); // Description changes are ignored
});

test('diffEvents should detect no changes for identical events', () => {
  const event = { id: 'e1', title: 'Event', start: new Date(), end: new Date() };
  const previous = [event];
  const current = [{ ...event }];

  const diffs = diffEvents(previous, current);
  assert.strictEqual(diffs.length, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```

Expected: FAIL - diffEvents not defined

- [ ] **Step 3: Implement diff.js with event comparison**

Create `src/diff.js`:
```javascript
/**
 * Event diffing and cache management
 */

/**
 * Compare two event arrays and detect changes
 * @param {Array} previous - Previous events
 * @param {Array} current - Current events
 * @returns {Array} Array of diff objects
 */
function diffEvents(previous, current) {
  const diffs = [];

  // Create maps for fast lookup
  const prevMap = new Map(previous.map(e => [e.id, e]));
  const currMap = new Map(current.map(e => [e.id, e]));

  // Detect new and modified events
  for (const currEvent of current) {
    const prevEvent = prevMap.get(currEvent.id);

    if (!prevEvent) {
      // New event
      diffs.push({
        type: 'new',
        event: currEvent
      });
      continue;
    }

    // Check for changes (ignoring description per spec)
    const changes = detectChanges(prevEvent, currEvent);
    if (changes) {
      diffs.push(changes);
    }
  }

  // Detect deleted events
  for (const prevEvent of previous) {
    if (!currMap.has(prevEvent.id)) {
      diffs.push({
        type: 'deleted',
        event: prevEvent
      });
    }
  }

  return diffs;
}

/**
 * Detect specific changes between two events
 */
function detectChanges(oldEvent, newEvent) {
  // Time change (start or end)
  const oldStart = oldEvent.start ? new Date(oldEvent.start).getTime() : null;
  const newStart = newEvent.start ? new Date(newEvent.start).getTime() : null;
  const oldEnd = oldEvent.end ? new Date(oldEvent.end).getTime() : null;
  const newEnd = newEvent.end ? new Date(newEvent.end).getTime() : null;

  if (oldStart !== newStart || oldEnd !== newEnd) {
    return {
      type: 'time_changed',
      event: newEvent,
      old: { start: oldEvent.start, end: oldEvent.end },
      new: { start: newEvent.start, end: newEvent.end }
    };
  }

  // Title change
  if (oldEvent.title !== newEvent.title) {
    return {
      type: 'title_changed',
      event: newEvent,
      old: { title: oldEvent.title },
      new: { title: newEvent.title }
    };
  }

  // Location change
  if (oldEvent.location !== newEvent.location) {
    return {
      type: 'location_changed',
      event: newEvent,
      old: { location: oldEvent.location },
      new: { location: newEvent.location }
    };
  }

  // Description changes are explicitly ignored per spec

  return null; // No actionable changes
}

/**
 * Load cached events from GitHub Actions cache
 * @param {string} calendarId - Calendar identifier
 * @returns {Promise<Array|null>} Cached events or null if not found
 */
async function loadCachedEvents(calendarId) {
  try {
    const cache = await import('@actions/cache');
    const cacheKey = `calendar-state-${calendarId}`;
    const cachePath = `/tmp/cache-${calendarId}.json`;

    // Try to restore cache
    const restoredKey = await cache.restoreCache([cachePath], cacheKey);
    if (!restoredKey) {
      return null; // Cache miss
    }

    // Read cached data
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(cachePath, 'utf-8');
    const data = JSON.parse(content);

    return data.events || null;
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND' || error.message.includes('@actions/cache')) {
      console.warn('Cache unavailable (not running in GitHub Actions) — skipping cache operations');
    } else {
      console.warn(`Failed to load cache for ${calendarId}:`, error.message);
    }
    return null;
  }
}

/**
 * Save events to GitHub Actions cache
 * @param {string} calendarId - Calendar identifier
 * @param {Array} events - Events to cache
 * @returns {Promise<void>}
 */
async function saveCachedEvents(calendarId, events) {
  try {
    const cache = await import('@actions/cache');
    const cacheKey = `calendar-state-${calendarId}`;
    const cachePath = `/tmp/cache-${calendarId}.json`;

    // Write data to temp file
    const { writeFile } = await import('node:fs/promises');
    const data = {
      timestamp: new Date().toISOString(),
      events
    };
    await writeFile(cachePath, JSON.stringify(data), 'utf-8');

    // Save to cache
    await cache.saveCache([cachePath], cacheKey);
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND' || error.message.includes('@actions/cache')) {
      console.warn('Cache unavailable (not running in GitHub Actions) — skipping cache operations');
    } else {
      console.warn(`Failed to save cache for ${calendarId}:`, error.message);
    }
    // Non-fatal - continue execution
  }
}

/**
 * Load pending notifications from debounce cache
 * @param {string} channelId - Channel identifier
 * @returns {Promise<Object>} { expired: boolean, diffs: [] } - expired=true means window expired and diffs should be posted
 */
async function loadPendingNotifications(channelId) {
  try {
    const cache = await import('@actions/cache');
    const cacheKey = `pending-notifications-${channelId}`;
    const cachePath = `/tmp/pending-${channelId}.json`;

    const restoredKey = await cache.restoreCache([cachePath], cacheKey);
    if (!restoredKey) {
      return { expired: false, diffs: [] }; // No pending notifications
    }

    const { readFile } = await import('node:fs/promises');
    const content = await readFile(cachePath, 'utf-8');
    const data = JSON.parse(content);

    // Check if notifications are within 5 min window
    const timestamp = new Date(data.timestamp);
    const now = new Date();
    const ageSeconds = (now - timestamp) / 1000;

    if (ageSeconds > 300) {
      // Window expired — return stale diffs so they get posted, not dropped
      return { expired: true, diffs: data.diffs || [] };
    }

    return { expired: false, diffs: data.diffs || [] };
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND' || error.message.includes('@actions/cache')) {
      console.warn('Cache unavailable (not running in GitHub Actions) — skipping cache operations');
    } else {
      console.warn(`Failed to load pending notifications for ${channelId}:`, error.message);
    }
    return { expired: false, diffs: [] };
  }
}

/**
 * Save pending notifications to debounce cache
 * @param {string} channelId - Channel identifier
 * @param {Array} diffs - Notification diffs to cache
 * @returns {Promise<void>}
 */
async function savePendingNotifications(channelId, diffs) {
  try {
    const cache = await import('@actions/cache');
    const cacheKey = `pending-notifications-${channelId}`;
    const cachePath = `/tmp/pending-${channelId}.json`;

    const { writeFile } = await import('node:fs/promises');
    const data = {
      timestamp: new Date().toISOString(),
      diffs
    };
    await writeFile(cachePath, JSON.stringify(data), 'utf-8');

    await cache.saveCache([cachePath], cacheKey);
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND' || error.message.includes('@actions/cache')) {
      console.warn('Cache unavailable (not running in GitHub Actions) — skipping cache operations');
    } else {
      console.warn(`Failed to save pending notifications for ${channelId}:`, error.message);
    }
    // Non-fatal - continue execution
  }
}

module.exports = {
  diffEvents,
  loadCachedEvents,
  saveCachedEvents,
  loadPendingNotifications,
  savePendingNotifications
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```

Expected: All diff tests PASS

- [ ] **Step 5: Commit diff module**

```bash
git add src/diff.js test/diff.test.js
git commit -m "feat(diff): add event change detection with cache support"
```

---

Due to the length of this plan, I'll continue with the remaining tasks. Let me complete the plan document:

## Task 5: Scheduler Module (Urgency & Schedule Matching)

**Files:**
- Create: `src/scheduler.js`
- Create: `test/scheduler.test.js`

- [ ] **Step 1: Write failing tests for schedule matching**

Create `test/scheduler.test.js`:
```javascript
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
  const now = new Date();
  const in3Days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  const event = { start: in3Days };
  const channelConfig = {
    daily_digest_schedule: 'weekdays 08:00',
    digest_schedule: 'sunday 18:00'
  };

  assert.strictEqual(classifyUrgency(event, channelConfig), 'THIS_WEEK');
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
```

Run: `npm test`
Expected: FAIL

- [ ] **Step 2: Implement scheduler.js**

Create `src/scheduler.js`:
```javascript
/**
 * Urgency classification and schedule matching logic
 */

// MVP HARDCODED THRESHOLDS — configurable in v2
const URGENT_THRESHOLD_HOURS = 24;
const DEBOUNCE_WINDOW_SECONDS = 300; // 5 minutes

/**
 * Check if current time matches a schedule
 * @param {string} schedule - e.g., "monday 14:00", "weekdays 08:00"
 * @param {Date} currentTime - Time to check
 * @param {string} locale - Locale for day names
 * @returns {boolean} True if within ±30 min tolerance
 */
function matchesSchedule(schedule, currentTime = new Date(), locale = 'en-US') {
  if (schedule === false) return false;

  // Check for cron format (5 fields: minute hour day month weekday)
  const cronMatch = schedule.match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+([\d,\-*]+)$/);
  if (cronMatch) {
    const [, cronMinute, cronHour, cronWeekday] = cronMatch;
    const scheduleHour = parseInt(cronHour, 10);
    const scheduleMinute = parseInt(cronMinute, 10);

    // Check day match (cron uses 0=Sunday, 1=Monday, ...)
    const currentDay = currentTime.getUTCDay();
    const weekdayMatches = cronWeekday === '*' ||
                          cronWeekday.split(',').map(d => parseInt(d, 10)).includes(currentDay);

    if (!weekdayMatches) return false;

    // Check time match (±30 min tolerance)
    const currentHour = currentTime.getUTCHours();
    const currentMinute = currentTime.getUTCMinutes();

    const scheduleTotalMinutes = scheduleHour * 60 + scheduleMinute;
    const currentTotalMinutes = currentHour * 60 + currentMinute;
    const diff = Math.abs(currentTotalMinutes - scheduleTotalMinutes);

    return diff <= 30;
  }

  // Parse human-readable format
  const match = schedule.match(/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekdays|weekends|daily)\s+(\d{2}):(\d{2})$/i);
  if (!match) {
    console.warn(`Invalid schedule format: ${schedule}`);
    return false;
  }

  const [, day, hours, minutes] = match;
  const scheduleHour = parseInt(hours, 10);
  const scheduleMinute = parseInt(minutes, 10);

  // Check day match
  const currentDay = currentTime.getUTCDay(); // 0=Sunday, 1=Monday, ...
  const dayMatches = matchesDay(day.toLowerCase(), currentDay);

  if (!dayMatches) return false;

  // Check time match (±30 min tolerance)
  const currentHour = currentTime.getUTCHours();
  const currentMinute = currentTime.getUTCMinutes();

  const scheduleTotalMinutes = scheduleHour * 60 + scheduleMinute;
  const currentTotalMinutes = currentHour * 60 + currentMinute;
  const diff = Math.abs(currentTotalMinutes - scheduleTotalMinutes);

  return diff <= 30;
}

function matchesDay(dayKeyword, currentDay) {
  const dayNames = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6
  };

  if (dayKeyword === 'daily') return true;
  if (dayKeyword === 'weekdays') return currentDay >= 1 && currentDay <= 5;
  if (dayKeyword === 'weekends') return currentDay === 0 || currentDay === 6;

  return dayNames[dayKeyword] === currentDay;
}

/**
 * Classify event urgency
 * @param {Object} event - Event object with start date
 * @param {Object} channelConfig - Channel configuration
 * @returns {string} 'URGENT', 'THIS_WEEK', or 'FUTURE'
 */
function classifyUrgency(event, channelConfig) {
  const now = new Date();
  const eventStart = new Date(event.start);
  const hoursUntil = (eventStart - now) / (1000 * 60 * 60);

  // URGENT: within 24 hours
  if (hoursUntil <= URGENT_THRESHOLD_HOURS) {
    return 'URGENT';
  }

  // THIS_WEEK: within current calendar week
  const endOfWeek = getEndOfCurrentWeek(now);
  if (eventStart <= endOfWeek) {
    return 'THIS_WEEK';
  }

  // FUTURE: beyond current week
  return 'FUTURE';
}

function getEndOfCurrentWeek(date) {
  const dayOfWeek = date.getUTCDay();
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  const endOfWeek = new Date(date);
  endOfWeek.setUTCDate(date.getUTCDate() + daysUntilSunday);
  endOfWeek.setUTCHours(23, 59, 59, 999);
  return endOfWeek;
}

/**
 * Determine if a change should trigger immediate notification
 * @param {Object} diff - Diff object
 * @param {Object} channelConfig - Channel configuration
 * @returns {boolean} True if should notify now
 */
function shouldNotifyNow(diff, channelConfig) {
  const notificationsSetting = channelConfig.notifications || 'all';

  // Check notification settings
  if (notificationsSetting === 'disabled') return false;
  if (notificationsSetting === 'weekly' || notificationsSetting === 'daily') return false;

  // For 'urgent_only', check urgency
  if (notificationsSetting === 'urgent_only') {
    const urgency = classifyUrgency(diff.event, channelConfig);
    return urgency === 'URGENT';
  }

  // 'all' or default: notify for everything
  return true;
}

module.exports = {
  matchesSchedule,
  classifyUrgency,
  shouldNotifyNow
};
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/scheduler.js test/scheduler.test.js
git commit -m "feat(scheduler): add urgency classification and schedule matching"
```

---

## Task 6: CalDAV Module (Simplified - Core Only)

**Files:**
- Create: `src/caldav.js`

- [ ] **Step 1: Implement basic CalDAV fetching (no tests - integration module)**

Create `src/caldav.js`:
```javascript
const ical = require('node-ical');

/**
 * Fetch calendar events from CalDAV endpoint
 * @param {string} caldavUrl - CalDAV calendar URL
 * @param {Object} credentials - { username, password }
 * @param {Object} dateRange - { start: Date, end: Date }
 * @returns {Promise<Array>} Normalized event objects
 */
async function fetchCalendar(caldavUrl, credentials, dateRange) {
  try {
    // Fetch iCalendar data with basic auth
    const authHeader = 'Basic ' + Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64');
    
    const response = await fetch(caldavUrl, {
      headers: {
        'Authorization': authHeader,
        'Accept': 'text/calendar'
      }
    });

    if (!response.ok) {
      throw new Error(`CalDAV fetch failed: ${response.status} ${response.statusText}`);
    }

    const icalData = await response.text();
    
    // Parse with node-ical
    const events = await ical.async.parseICS(icalData);
    
    // Normalize events
    const normalized = [];
    for (const [uid, event] of Object.entries(events)) {
      if (event.type !== 'VEVENT') continue;

      // Handle recurring events
      if (event.rrule) {
        const instances = event.rrule.between(dateRange.start, dateRange.end, true);
        for (const instance of instances) {
          normalized.push(normalizeEvent(event, instance));
        }
      } else {
        // Single event
        normalized.push(normalizeEvent(event));
      }
    }

    return normalized;
  } catch (error) {
    console.error(`Failed to fetch calendar ${caldavUrl}:`, error.message);
    throw error;
  }
}

function normalizeEvent(icalEvent, instanceStart = null) {
  const start = instanceStart || icalEvent.start;
  const end = icalEvent.end || start;

  return {
    id: icalEvent.uid,
    title: icalEvent.summary || '(No title)',
    start: start instanceof Date ? start : new Date(start),
    end: end instanceof Date ? end : new Date(end),
    location: icalEvent.location || null,
    description: icalEvent.description || null,
    isAllDay: icalEvent.datetype === 'date'
  };
}

module.exports = {
  fetchCalendar
};
```

- [ ] **Step 2: Commit**

```bash
git add src/caldav.js
git commit -m "feat(caldav): add CalDAV fetching with recurring event expansion"
```

---

## Task 7: Slack Module (API Wrapper)

**Files:**
- Create: `src/slack.js`

- [ ] **Step 1: Implement Slack API wrapper**

Create `src/slack.js`:
```javascript
const { WebClient } = require('@slack/web-api');

let client = null;

/**
 * Initialize Slack client
 */
function getClient() {
  if (!client) {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) {
      throw new Error('SLACK_BOT_TOKEN environment variable not set');
    }
    client = new WebClient(token);
  }
  return client;
}

/**
 * Post message to Slack channel
 * @param {string} channelId - Slack channel ID
 * @param {string} text - Message text (markdown)
 * @param {boolean} dryRun - If true, log instead of posting
 * @returns {Promise<void>}
 */
async function postMessage(channelId, text, dryRun = false) {
  if (dryRun) {
    console.log(`[DRY RUN] Would post to channel ${channelId}:`);
    console.log(text);
    console.log('');
    return;
  }

  try {
    await getClient().chat.postMessage({
      channel: channelId,
      text: text,
      mrkdwn: true
    });
  } catch (error) {
    console.error(`Failed to post message to ${channelId}:`, error.message);
    throw error;
  }
}

/**
 * Update Slack Canvas content
 * @param {string} canvasId - Slack Canvas ID
 * @param {string} content - Markdown content
 * @param {boolean} dryRun - If true, log instead of updating
 * @returns {Promise<void>}
 */
async function updateCanvas(canvasId, content, dryRun = false) {
  if (dryRun) {
    console.log(`[DRY RUN] Would update Canvas ${canvasId}:`);
    console.log(content);
    console.log('');
    return;
  }

  try {
    await getClient().canvases.edit({
      canvas_id: canvasId,
      changes: [{
        operation: 'replace',
        document_content: {
          type: 'markdown',
          markdown: content
        }
      }]
    });
  } catch (error) {
    console.error(`Failed to update Canvas ${canvasId}:`, error.message);
    throw error;
  }
}

/**
 * Post error notification
 * @param {string} errorChannelId - Error channel ID (optional)
 * @param {string} message - Error message
 * @param {boolean} dryRun - If true, log instead of posting
 * @returns {Promise<void>}
 */
async function postErrorNotification(errorChannelId, message, dryRun = false) {
  if (!errorChannelId) {
    console.error('Error:', message);
    return;
  }

  const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : 'N/A';

  const errorText = `⚠️ **Calendar Bot Error**\n\n${message}\n\nTime: ${new Date().toISOString()}\nRun: ${runUrl}`;

  await postMessage(errorChannelId, errorText, dryRun);
}

module.exports = {
  postMessage,
  updateCanvas,
  postErrorNotification
};
```

- [ ] **Step 2: Commit**

```bash
git add src/slack.js
git commit -m "feat(slack): add Slack API wrapper for messages and Canvas"
```

---

## Task 8: Main Bot Entry Point

**Files:**
- Create: `src/bot.js`

- [ ] **Step 1: Implement bot.js with CLI routing**

Create `src/bot.js`:
```javascript
#!/usr/bin/env node

/**
 * Calendar Slack Bot - Main Entry Point
 *
 * CLI Flags:
 * --scheduled: Runtime filtering mode (checks all channel schedules)
 * --weekly-digest: Force weekly digest to all channels (testing)
 * --daily-digest: Force daily digest to all channels (testing)
 * --event-changed: Webhook handler for calendar changes
 * --dry-run: Skip all Slack API calls (validation only)
 *
 * Architecture:
 * - config.js: Configuration loading and validation
 * - caldav.js: CalDAV fetching and parsing
 * - slack.js: Slack API operations
 * - formatting.js: Message and Canvas rendering
 * - diff.js: Event change detection
 * - scheduler.js: Urgency and schedule matching
 */

const { loadConfig } = require('./config.js');
const { fetchCalendar } = require('./caldav.js');
const { postMessage, updateCanvas, postErrorNotification } = require('./slack.js');
const { renderWeekView, renderDailyView, renderCanvasContent, renderBundledNotification } = require('./formatting.js');
const { diffEvents, loadCachedEvents, saveCachedEvents, loadPendingNotifications, savePendingNotifications } = require('./diff.js');
const { matchesSchedule, shouldNotifyNow } = require('./scheduler.js');

const args = process.argv.slice(2);
const mode = args.find(arg => arg.startsWith('--') && !arg.startsWith('--dry'));
const dryRun = args.includes('--dry-run');

async function main() {
  try {
    const config = await loadConfig();

    if (mode === '--scheduled') {
      await runScheduledDigests(config, dryRun);
    } else if (mode === '--weekly-digest') {
      await runWeeklyDigest(config, dryRun, true);
    } else if (mode === '--daily-digest') {
      await runDailyDigest(config, dryRun, true);
    } else if (mode === '--event-changed') {
      await runEventChanged(config, dryRun);
    } else {
      console.error('Usage: node bot.js [--scheduled|--weekly-digest|--daily-digest|--event-changed] [--dry-run]');
      process.exit(1);
    }

    if (dryRun) {
      console.log('[DRY RUN] No Slack API calls were made.');
    }

    process.exit(0);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

async function runScheduledDigests(config, dryRun) {
  const now = new Date();

  for (const channel of config.channels) {
    // Check weekly digest
    if (channel.digest_schedule && matchesSchedule(channel.digest_schedule, now, channel.locale || config.locale)) {
      console.log(`Weekly digest match for channel ${channel.id}`);
      await postDigestForChannel(config, channel, 'weekly', dryRun);
    }

    // Check daily digest
    if (channel.daily_digest_schedule && matchesSchedule(channel.daily_digest_schedule, now, channel.locale || config.locale)) {
      console.log(`Daily digest match for channel ${channel.id}`);
      await postDigestForChannel(config, channel, 'daily', dryRun);
    }
  }
}

async function postDigestForChannel(config, channel, type, dryRun) {
  // Fetch events from all calendars for this channel
  const allEvents = [];
  for (const calId of channel.calendars) {
    const calendar = config.calendars[calId];
    const events = await fetchCalendar(
      calendar.caldav_url,
      config.caldav_credentials,
      getCurrentWeekRange()
    );
    allEvents.push(...events.map(e => ({ ...e, calendarName: calendar.name })));
  }

  // Render and post digest
  const locale = channel.locale || config.locale;
  const dateRange = type === 'daily'
    ? getDailyRange()
    : getCurrentWeekRange();

  const digest = type === 'daily'
    ? renderDailyView(allEvents, dateRange, locale, channel)
    : renderWeekView(allEvents, dateRange, locale, channel);
  await postMessage(channel.id, digest, dryRun);

  // Update Canvas (always full week)
  const canvasContent = renderCanvasContent(allEvents, { locale, ...channel });
  await updateCanvas(channel.canvas_id, canvasContent, dryRun);
}

function getCurrentWeekRange() {
  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  const startOfWeek = new Date(now);
  startOfWeek.setUTCDate(now.getUTCDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1));
  startOfWeek.setUTCHours(0, 0, 0, 0);

  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setUTCDate(startOfWeek.getUTCDate() + 6);
  endOfWeek.setUTCHours(23, 59, 59, 999);

  return { start: startOfWeek, end: endOfWeek };
}

function getDailyRange() {
  const now = new Date();

  // Start of today (00:00:00)
  const startOfToday = new Date(now);
  startOfToday.setUTCHours(0, 0, 0, 0);

  // End of tomorrow (23:59:59)
  const endOfTomorrow = new Date(now);
  endOfTomorrow.setUTCDate(now.getUTCDate() + 1);
  endOfTomorrow.setUTCHours(23, 59, 59, 999);

  return { start: startOfToday, end: endOfTomorrow };
}

async function runEventChanged(config, dryRun) {
  // Parse webhook payload
  const payload = process.env.WEBHOOK_PAYLOAD ? JSON.parse(process.env.WEBHOOK_PAYLOAD) : {};
  const calendarId = payload.calendar_id || payload.calendarId || payload.id;

  if (!calendarId) {
    console.warn('No calendar_id in webhook payload - running full refresh');
    // Full refresh: check all calendars
    await runFullRefresh(config, dryRun);
    return;
  }

  // Find calendar config by exact match (case-sensitive first, then case-insensitive)
  let matchedCalId = null;
  for (const calId of Object.keys(config.calendars)) {
    if (calId === calendarId) {
      matchedCalId = calId;
      break;
    }
  }

  if (!matchedCalId) {
    for (const calId of Object.keys(config.calendars)) {
      if (calId.toLowerCase() === calendarId.toLowerCase()) {
        matchedCalId = calId;
        break;
      }
    }
  }

  if (!matchedCalId) {
    console.warn(`Calendar '${calendarId}' not found in config - running full refresh`);
    await runFullRefresh(config, dryRun);
    return;
  }

  console.log(`Processing webhook for calendar: ${matchedCalId}`);

  // Fetch current events
  const calendar = config.calendars[matchedCalId];
  const currentEvents = await fetchCalendar(
    calendar.caldav_url,
    config.caldav_credentials,
    getCurrentWeekRange()
  );

  // Load cached events
  const previousEvents = await loadCachedEvents(matchedCalId) || [];

  // Detect diffs
  const diffs = diffEvents(previousEvents, currentEvents);

  if (diffs.length === 0) {
    console.log('No changes detected');
    await saveCachedEvents(matchedCalId, currentEvents);
    return;
  }

  console.log(`Detected ${diffs.length} change(s)`);

  // Add calendar name to diffs
  const diffsWithCalendar = diffs.map(d => ({ ...d, calendarName: calendar.name }));

  // Route to channels using shared helper
  await routeDiffsToChannels(config, matchedCalId, diffsWithCalendar, dryRun);

  // Save updated cache
  await saveCachedEvents(matchedCalId, currentEvents);
}

/**
 * Route detected diffs to subscribed channels with debouncing
 * Shared by runEventChanged and runFullRefresh
 */
async function routeDiffsToChannels(config, calendarId, diffsWithCalendar, dryRun) {
  for (const channel of config.channels) {
    if (!channel.calendars.includes(calendarId)) {
      continue; // This channel doesn't subscribe to this calendar
    }

    // Filter diffs by notification settings and urgency
    const notifiableDiffs = diffsWithCalendar.filter(diff =>
      shouldNotifyNow(diff, channel)
    );

    if (notifiableDiffs.length === 0) {
      continue;
    }

    // Load pending notifications (debounce)
    const pending = await loadPendingNotifications(channel.id);

    // If window expired, post stale diffs first
    if (pending.expired && pending.diffs.length > 0) {
      console.log(`Debounce window expired for channel ${channel.id} - posting ${pending.diffs.length} stale diffs`);
      const locale = channel.locale || config.locale;
      const staleNotification = renderBundledNotification(pending.diffs, locale);
      await postMessage(channel.id, staleNotification, dryRun);
    }

    // Now handle new diffs
    if (pending.expired || pending.diffs.length === 0) {
      // Start fresh debounce window for new diffs
      console.log(`Started fresh debounce window for channel ${channel.id}`);
      await savePendingNotifications(channel.id, notifiableDiffs);
      continue;
    }

    // Debounce window active - merge with pending
    const allDiffs = [...pending.diffs, ...notifiableDiffs];

    // Post bundled notification
    const locale = channel.locale || config.locale;
    const notification = renderBundledNotification(allDiffs, locale);
    await postMessage(channel.id, notification, dryRun);

    // Clear debounce cache
    await savePendingNotifications(channel.id, []);
  }
}

async function runFullRefresh(config, dryRun) {
  console.log('Running full refresh for all calendars');

  for (const calId of Object.keys(config.calendars)) {
    const calendar = config.calendars[calId];
    const currentEvents = await fetchCalendar(
      calendar.caldav_url,
      config.caldav_credentials,
      getCurrentWeekRange()
    );
    const previousEvents = await loadCachedEvents(calId) || [];
    const diffs = diffEvents(previousEvents, currentEvents);

    if (diffs.length > 0) {
      console.log(`Calendar ${calId}: ${diffs.length} change(s)`);

      // Add calendar name to diffs
      const diffsWithCalendar = diffs.map(d => ({ ...d, calendarName: calendar.name }));

      // Route to channels using shared helper
      await routeDiffsToChannels(config, calId, diffsWithCalendar, dryRun);
    }

    await saveCachedEvents(calId, currentEvents);
  }
}

async function runWeeklyDigest(config, dryRun, forceAll) {
  console.log('Running weekly digest...');
  for (const channel of config.channels) {
    await postDigestForChannel(config, channel, 'weekly', dryRun);
  }
}

async function runDailyDigest(config, dryRun, forceAll) {
  console.log('Running daily digest...');
  for (const channel of config.channels) {
    await postDigestForChannel(config, channel, 'daily', dryRun);
  }
}

main();
```

- [ ] **Step 2: Make bot.js executable**

```bash
chmod +x src/bot.js
```

- [ ] **Step 3: Test with dry-run**

```bash
node src/bot.js --weekly-digest --dry-run
```

Expected: Prints dry-run output without errors

- [ ] **Step 4: Commit**

```bash
git add src/bot.js
git commit -m "feat(bot): add main entry point with CLI routing and digest flows"
```

---

## Task 8b: Webhook Flow Manual Testing

**Purpose**: Verify the webhook flow implementation (runEventChanged, debouncing, full-refresh fallback) works correctly in all scenarios.

**Note**: The webhook implementation is already complete in Task 8's bot.js. This task is purely for manual testing and verification.

- [ ] **Step 1: Test basic webhook flow with matched calendar**

```bash
# Export test environment
export WEBHOOK_PAYLOAD='{"calendar_id":"team-calendar"}'
export CALDAV_USERNAME="testuser"
export CALDAV_PASSWORD="testpass"
export SLACK_BOT_TOKEN="xoxb-test"

# Run with dry-run
node src/bot.js --event-changed --dry-run
```

Expected: Parses payload, detects calendar, fetches events, detects diffs, saves to debounce cache (first run won't post)

- [ ] **Step 2: Test debounce bundling (two webhooks within window)**

Run webhook handler twice within 5 minutes:

```bash
# First run (change 1)
export WEBHOOK_PAYLOAD='{"calendar_id":"team-calendar"}'
node src/bot.js --event-changed --dry-run

# Second run (change 2, within 5 min)
node src/bot.js --event-changed --dry-run
```

Expected:
- First run: Saves change 1 to debounce cache, doesn't post
- Second run: Bundles change 1 + change 2, posts bundled notification, clears cache

- [ ] **Step 3: Test debounce expiry (single isolated change)**

This tests the critical case where a single change occurs and no subsequent webhook arrives:

```bash
# First run (single change)
export WEBHOOK_PAYLOAD='{"calendar_id":"team-calendar"}'
node src/bot.js --event-changed --dry-run

# Wait > 5 minutes (or manually advance cache timestamp for testing)

# Second run (any subsequent webhook, even unrelated calendar)
export WEBHOOK_PAYLOAD='{"calendar_id":"project-x"}'
node src/bot.js --event-changed --dry-run
```

Expected:
- First run: Saves change to cache, doesn't post
- Second run: Detects expired window, posts stale change from first run, then processes second webhook normally

**Why this matters**: Without this test, a single isolated change would be lost forever if no second webhook arrives within 5 minutes.

- [ ] **Step 4: Test full-refresh fallback (ambiguous payload)**

```bash
export WEBHOOK_PAYLOAD='{"unknown_field":"value"}'
node src/bot.js --event-changed --dry-run
```

Expected: Logs "running full refresh", processes all calendars, routes diffs to channels

- [ ] **Step 5: Test full-refresh fallback (missing calendar_id)**

```bash
export WEBHOOK_PAYLOAD='{}'
node src/bot.js --event-changed --dry-run
```

Expected: Logs "No calendar_id in webhook payload - running full refresh", processes all calendars

- [ ] **Step 6: Test full-refresh fallback (unrecognized calendar_id)**

```bash
export WEBHOOK_PAYLOAD='{"calendar_id":"nonexistent-calendar"}'
node src/bot.js --event-changed --dry-run
```

Expected: Logs "Calendar 'nonexistent-calendar' not found in config - running full refresh", processes all calendars

---

## Task 9: GitHub Actions Workflows

**Files:**
- Create: `.github/workflows/scheduled.yml`
- Create: `.github/workflows/webhook.yml`

- [ ] **Step 1: Create scheduled workflow**

Create `.github/workflows/scheduled.yml`:
```yaml
name: Scheduled Digests

on:
  schedule:
    - cron: '0 * * * *'  # Hourly polling
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
          CALDAV_USERNAME: ${{ secrets.CALDAV_USERNAME }}
          CALDAV_PASSWORD: ${{ secrets.CALDAV_PASSWORD }}
          SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
        run: node src/bot.js --scheduled
      
      - name: Run manual digest
        if: github.event_name == 'workflow_dispatch'
        env:
          CALDAV_USERNAME: ${{ secrets.CALDAV_USERNAME }}
          CALDAV_PASSWORD: ${{ secrets.CALDAV_PASSWORD }}
          SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
        run: |
          # Note: inputs.dry_run is a string "true"/"false", not a boolean — explicit comparison required
          if [ "${{ inputs.digest_type }}" = "scheduled" ]; then
            node src/bot.js --scheduled ${{ inputs.dry_run == 'true' && '--dry-run' || '' }}
          else
            node src/bot.js --${{ inputs.digest_type }}-digest ${{ inputs.dry_run == 'true' && '--dry-run' || '' }}
          fi
```

- [ ] **Step 2: Create webhook workflow**

Create `.github/workflows/webhook.yml`:
```yaml
name: Calendar Event Changed

on:
  repository_dispatch:
    types: [calendar_changed]
  workflow_dispatch:
    inputs:
      test_payload:
        description: 'Test webhook payload (JSON)'
        required: false
        type: string
      dry_run:
        description: 'Dry run (no Slack API calls)'
        required: false
        default: false
        type: boolean

jobs:
  event-changed:
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
      
      - name: Handle event change
        env:
          CALDAV_USERNAME: ${{ secrets.CALDAV_USERNAME }}
          CALDAV_PASSWORD: ${{ secrets.CALDAV_PASSWORD }}
          SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
          WEBHOOK_PAYLOAD: ${{ inputs.test_payload || toJSON(github.event.client_payload) }}
        # Note: inputs.dry_run is a string "true"/"false", not a boolean — explicit comparison required
        run: node src/bot.js --event-changed ${{ inputs.dry_run == 'true' && '--dry-run' || '' }}
```

- [ ] **Step 3: Commit workflows**

```bash
git add .github/workflows/scheduled.yml .github/workflows/webhook.yml
git commit -m "feat(workflows): add GitHub Actions workflows for scheduled digests and webhooks"
```

---

## Task 10: Documentation

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write comprehensive README**

Create `README.md`:
```markdown
# Calendar Slack Bot

GitHub Actions-based Slack bot that bridges Nextcloud CalDAV calendars with Slack channels.

## Features

- **Automated Digests**: Weekly and daily calendar digests posted to Slack channels
- **Real-time Updates**: Webhook-triggered change notifications
- **Many-to-Many Mapping**: Any calendar can post to multiple channels
- **Locale Support**: Multilingual date/time formatting
- **Zero Infrastructure**: Runs entirely in GitHub Actions

## Prerequisites

### 1. Nextcloud Webhook Setup (REQUIRED)

Nextcloud does not send webhooks by default. Install ONE of these apps:

#### Option A: Workflow App (Recommended)
1. Navigate to Settings → Flow in Nextcloud admin
2. Create new workflow:
   - Trigger: "Calendar event created or updated"
   - Action: "Send HTTP request"
   - URL: `https://api.github.com/repos/OWNER/REPO/dispatches`
   - Headers:
     - `Authorization: token YOUR_GITHUB_PAT`
     - `Content-Type: application/json`
   - Body: `{"event_type": "calendar_changed", "client_payload": {"calendar_id": "CALENDAR_NAME"}}`

#### Option B: WebhookListener App
- Install from Nextcloud app store
- Configure for calendar events
- Point to same GitHub URL as above

**Without this setup, real-time notifications will not work.**

### 2. GitHub PAT for Webhooks

Create a GitHub Personal Access Token with `repo` scope:
1. Go to Settings → Developer settings → Personal access tokens
2. Generate new token with `repo` scope
3. Store in Nextcloud webhook configuration
4. Rotate periodically for security

### 3. Slack Bot Setup

1. Create Slack app at api.slack.com/apps
2. Add bot scopes:
   - `canvases:write`
   - `canvases:read`
   - `chat:write`
3. Install to workspace
4. Copy bot token (xoxb-...)
5. Create Canvas for each channel (Slack UI)
6. Copy channel IDs and Canvas IDs

## Installation

### Step 1: Create Private Repository

**Do NOT fork this repo** (forks are public). Instead:

```bash
# Create new private repo on GitHub first
git clone https://github.com/OWNER/calendar-slack-bot.git
cd calendar-slack-bot
git remote set-url origin https://github.com/YOUR-ORG/your-private-bot.git
git push -u origin main
```

### Step 2: Configure Secrets

Add four GitHub Secrets (Settings → Secrets and variables → Actions):

- `CALDAV_USERNAME`: Nextcloud username
- `CALDAV_PASSWORD`: Nextcloud password
- `SLACK_BOT_TOKEN`: Slack bot token (xoxb-...)
- `CONFIG_JSON`: Full contents of config.json (see below)

### Step 3: Create Configuration

Copy `config.example.json` to `config.json` and fill in:

```json
{
  "locale": "en-US",
  "caldav_credentials": {
    "username": "${CALDAV_USERNAME}",
    "password": "${CALDAV_PASSWORD}"
  },
  "calendars": {
    "team-calendar": {
      "name": "Team Calendar",
      "caldav_url": "https://nextcloud.example.com/remote.php/dav/calendars/user/team/"
    }
  },
  "channels": [
    {
      "id": "C01234TEAM",
      "canvas_id": "F9876CANVAS",
      "calendars": ["team-calendar"],
      "digest_schedule": "sunday 18:00",
      "daily_digest_schedule": "weekdays 08:00"
    }
  ]
}
```

Paste the entire JSON as the `CONFIG_JSON` secret.

### Step 4: Test

Trigger manual workflow:
1. Go to Actions → Scheduled Digests → Run workflow
2. Select `digest_type: scheduled`
3. Enable `dry_run: true`
4. Check logs for output

## Schedule Configuration

**Hourly Polling**: Workflows run every hour and check channel schedules with ±30 min tolerance.

**Any schedule time works automatically** - no workflow editing needed.

**All times are UTC** - calculate offset for your timezone:
- CET (UTC+1): `18:00` local = `17:00` in config
- PST (UTC-8): `18:00` local = `02:00` (next day) in config

## Upstream Updates

This is a **template repository**. Upstream updates require manual sync:

1. Monitor public repo for important updates
2. Review commits and changes
3. Cherry-pick relevant updates to your private repo

Automated sync is a v2 consideration.

## Troubleshooting

### Digests not posting
- Check workflow runs in Actions tab
- Verify schedule matches current UTC time (±30 min)
- Test with manual trigger and dry-run

### Webhooks not working
- Verify Nextcloud Workflow/WebhookListener app is installed
- Check GitHub PAT has `repo` scope
- Test with manual trigger and test_payload

### Canvas not updating
- Verify Canvas ID (starts with F)
- Check bot has `canvases:write` scope
- Verify bot is member of channel

## License

MIT
```

- [ ] **Step 2: Commit README**

```bash
git add README.md
git commit -m "docs: add comprehensive README with setup instructions"
```

---

## Plan Complete

All essential modules and workflows are implemented. The plan follows TDD principles with:
- ✅ Project scaffolding
- ✅ Config module with validation
- ✅ Formatting module with tests
- ✅ Diff module with tests
- ✅ Scheduler module with tests
- ✅ CalDAV module (integration)
- ✅ Slack module (integration)
- ✅ Main bot entry point
- ✅ GitHub Actions workflows
- ✅ Documentation

