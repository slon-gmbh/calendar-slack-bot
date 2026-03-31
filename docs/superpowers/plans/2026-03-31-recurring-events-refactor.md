# Recurring Events Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate recurring event notification spam by preserving RRULE information throughout the pipeline

**Architecture:** Change event data model from flat instances to composite structure {id, title, rrule, instances:[]}. Compare recurring events at RRULE level, not instance level. Expand instances only for display.

**Tech Stack:** Node.js, node-ical (RRULE parsing), node:test (testing)

---

## File Structure

**Modified files:**
- `src/caldav.js` - Change normalizeEvent() to return composite structure
- `src/diff.js` - Compare by event.id only, add RRULE comparison
- `src/formatting.js` - Add RRULE humanization, update notifications
- `src/scheduler.js` - Iterate over event.instances[] for urgency
- `src/bot.js` - No functional changes (cache structure changes)
- `test/caldav.test.js` - Update fixtures to composite structure
- `test/diff.test.js` - Add recurring event tests
- `test/formatting.test.js` - Add RRULE humanization tests
- `test/scheduler.test.js` - Update to use instances array

**Responsibilities:**
- `caldav.js`: Parse iCal, expand RRULE to instances, preserve RRULE string
- `diff.js`: Compare events by ID, detect RRULE pattern changes
- `formatting.js`: Humanize RRULE, render notifications with recurrence info
- `scheduler.js`: Check urgency across all instances
- `bot.js`: Orchestration (minimal changes)

---

## Task 1: Update caldav.js Data Model

**Files:**
- Modify: `src/caldav.js:138-192` (normalizeEvent function)
- Test: `test/caldav.test.js`

- [ ] **Step 1.1: Write failing test for composite structure**

Add to `test/caldav.test.js`:

```javascript
const { test } = require('node:test');
const assert = require('node:assert');

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

  // Mock fetchCalendar to use this event
  const dateRange = {
    start: new Date('2026-04-01T00:00:00Z'),
    end: new Date('2026-04-30T23:59:59Z')
  };

  // We'll test via fetchCalendar since normalizeEvent is internal
  // For now, test the structure it should return
  const result = normalizeEvent(icalEvent, null, 'UTC');

  assert.strictEqual(result.id, 'recurring-event-456');
  assert.strictEqual(result.title, 'Weekly Meeting');
  assert.strictEqual(result.rrule, 'FREQ=WEEKLY;BYDAY=TH');
  assert.ok(Array.isArray(result.instances));
  assert.strictEqual(result.instances.length, 2);
  assert.strictEqual(result.instances[0].isException, false);
});

// Export normalizeEvent for testing (add to caldav.js exports)
```

Note: `normalizeEvent` is currently not exported. We'll need to export it for testing or test via `fetchCalendar`.

- [ ] **Step 1.2: Export normalizeEvent for testing**

In `src/caldav.js`, update exports at bottom:

```javascript
module.exports = {
  fetchCalendar,
  normalizeEvent  // Add this for testing
};
```

- [ ] **Step 1.3: Run tests to verify they fail**

```bash
npm test -- test/caldav.test.js
```

Expected: FAIL - normalizeEvent returns old structure without `instances` array

- [ ] **Step 1.4: Refactor normalizeEvent to return composite structure**

Replace `normalizeEvent` function in `src/caldav.js:138-192`:

```javascript
function normalizeEvent(icalEvent, instanceStart = null, timezone = 'UTC') {
  const start = instanceStart || icalEvent.start;

  // Calculate end time for recurring instances
  let end;
  if (instanceStart && icalEvent.end && icalEvent.start) {
    // Calculate duration from original event
    const originalStart = icalEvent.start instanceof Date ? icalEvent.start : new Date(icalEvent.start);
    const originalEnd = icalEvent.end instanceof Date ? icalEvent.end : new Date(icalEvent.end);
    const durationMs = originalEnd.getTime() - originalStart.getTime();

    // Apply duration to this instance
    const instanceDate = instanceStart instanceof Date ? instanceStart : new Date(instanceStart);
    end = new Date(instanceDate.getTime() + durationMs);
  } else {
    end = icalEvent.end || start;
  }

  const isAllDay = icalEvent.datetype === 'date';

  // Convert dates (all-day events skip timezone conversion)
  let normalizedStart, normalizedEnd;
  if (isAllDay) {
    normalizedStart = start instanceof Date ? start : new Date(start);
    normalizedEnd = end instanceof Date ? end : new Date(end);
  } else {
    normalizedStart = convertToUTC(start, timezone);
    normalizedEnd = convertToUTC(end, timezone);
  }

  // Validate dates
  if (isNaN(normalizedStart.getTime())) {
    throw new Error(`Invalid start date for event "${icalEvent.summary}": ${JSON.stringify(start)}`);
  }
  if (isNaN(normalizedEnd.getTime())) {
    throw new Error(`Invalid end date for event "${icalEvent.summary}": ${JSON.stringify(end)}`);
  }

  // Build instance object
  const instance = {
    start: normalizedStart,
    end: normalizedEnd,
    isException: false
  };

  // Return composite structure
  const normalized = {
    id: icalEvent.uid,
    title: icalEvent.summary || '(No title)',
    location: icalEvent.location || null,
    description: icalEvent.description || null,
    isAllDay: isAllDay,
    rrule: icalEvent.rrule ? icalEvent.rrule.toString() : null,
    instances: [instance]
  };

  return normalized;
}
```

- [ ] **Step 1.5: Update fetchCalendar to build composite events**

Replace the event normalization loop in `src/caldav.js:33-72`:

```javascript
    // Normalize events
    const eventMap = new Map(); // Track events by ID to build composite structure

    for (const [uid, event] of Object.entries(events)) {
      if (event.type !== 'VEVENT') continue;

      // Handle recurring events
      if (event.rrule) {
        const instances = event.rrule.between(dateRange.start, dateRange.end, true);
        const eventInstances = [];

        for (const instance of instances) {
          // Get date string for comparison (YYYY-MM-DD)
          const instanceDateStr = instance.toISOString().substring(0, 10);

          // Skip if this instance is in EXDATE (deleted occurrence)
          if (event.exdate && event.exdate[instanceDateStr]) {
            continue;
          }

          // Skip if this instance has a RECURRENCE-ID override (modified occurrence)
          if (event.recurrences && event.recurrences[instanceDateStr]) {
            continue;
          }

          // Build instance object
          const singleInstance = normalizeEvent(event, instance, timezone);
          eventInstances.push(...singleInstance.instances);
        }

        // Add modified occurrences from RECURRENCE-ID
        if (event.recurrences) {
          for (const [dateStr, recurrence] of Object.entries(event.recurrences)) {
            // Only add if within date range
            const recStart = recurrence.start instanceof Date ? recurrence.start : new Date(recurrence.start);
            if (recStart >= dateRange.start && recStart <= dateRange.end) {
              const exceptionInstance = normalizeEvent(recurrence, null, timezone);
              exceptionInstance.instances[0].isException = true;
              eventInstances.push(...exceptionInstance.instances);
            }
          }
        }

        // Build composite event
        if (eventInstances.length > 0) {
          eventMap.set(event.uid, {
            id: event.uid,
            title: event.summary || '(No title)',
            location: event.location || null,
            description: event.description || null,
            isAllDay: event.datetype === 'date',
            rrule: event.rrule.toString(),
            instances: eventInstances
          });
        }
      } else {
        // Single event
        const singleEvent = normalizeEvent(event, null, timezone);
        eventMap.set(event.uid, singleEvent);
      }
    }

    return Array.from(eventMap.values());
```

- [ ] **Step 1.6: Run tests to verify they pass**

```bash
npm test -- test/caldav.test.js
```

Expected: PASS

- [ ] **Step 1.7: Commit caldav.js data model changes**

```bash
git add src/caldav.js test/caldav.test.js
git commit -m "refactor(caldav): change data model to composite structure

- normalizeEvent() now returns {id, title, rrule, instances:[]}
- fetchCalendar() builds composite events with instances array
- Recurring events have single parent with multiple instances
- Non-recurring events have single instance

refs: #17"
```

---

## Task 2: Update diff.js for Composite Structure

**Files:**
- Modify: `src/diff.js:11-18` (getEventKey function)
- Modify: `src/diff.js:69-133` (detectChanges function)
- Test: `test/diff.test.js`

- [ ] **Step 2.1: Write failing test for recurring event diffing**

Add to `test/diff.test.js`:

```javascript
test('diffEvents should detect new recurring event as single diff', () => {
  const previous = [];
  const current = [{
    id: 'recurring-123',
    title: 'Weekly Meeting',
    location: null,
    description: null,
    isAllDay: false,
    rrule: 'FREQ=WEEKLY;BYDAY=TH',
    instances: [
      { start: new Date('2026-04-03T10:00:00Z'), end: new Date('2026-04-03T11:00:00Z'), isException: false },
      { start: new Date('2026-04-10T10:00:00Z'), end: new Date('2026-04-10T11:00:00Z'), isException: false },
      { start: new Date('2026-04-17T10:00:00Z'), end: new Date('2026-04-17T11:00:00Z'), isException: false }
    ]
  }];

  const diffs = diffEvents(previous, current);

  assert.strictEqual(diffs.length, 1);
  assert.strictEqual(diffs[0].type, 'new');
  assert.strictEqual(diffs[0].event.id, 'recurring-123');
  assert.strictEqual(diffs[0].event.rrule, 'FREQ=WEEKLY;BYDAY=TH');
});

test('diffEvents should detect RRULE pattern change', () => {
  const previous = [{
    id: 'event-123',
    title: 'Meeting',
    location: null,
    description: null,
    isAllDay: false,
    rrule: 'FREQ=WEEKLY;BYDAY=TH',
    instances: [
      { start: new Date('2026-04-03T10:00:00Z'), end: new Date('2026-04-03T11:00:00Z'), isException: false }
    ]
  }];

  const current = [{
    id: 'event-123',
    title: 'Meeting',
    location: null,
    description: null,
    isAllDay: false,
    rrule: 'FREQ=DAILY',
    instances: [
      { start: new Date('2026-04-03T10:00:00Z'), end: new Date('2026-04-03T11:00:00Z'), isException: false },
      { start: new Date('2026-04-04T10:00:00Z'), end: new Date('2026-04-04T11:00:00Z'), isException: false }
    ]
  }];

  const diffs = diffEvents(previous, current);

  assert.strictEqual(diffs.length, 1);
  assert.strictEqual(diffs[0].type, 'pattern_changed');
  assert.strictEqual(diffs[0].old.rrule, 'FREQ=WEEKLY;BYDAY=TH');
  assert.strictEqual(diffs[0].new.rrule, 'FREQ=DAILY');
});

test('diffEvents should not generate multiple diffs for recurring event instances', () => {
  const previous = [];
  const current = [{
    id: 'recurring-456',
    title: 'Daily Standup',
    location: null,
    description: null,
    isAllDay: false,
    rrule: 'FREQ=DAILY',
    instances: [
      { start: new Date('2026-04-01T09:00:00Z'), end: new Date('2026-04-01T09:15:00Z'), isException: false },
      { start: new Date('2026-04-02T09:00:00Z'), end: new Date('2026-04-02T09:15:00Z'), isException: false },
      { start: new Date('2026-04-03T09:00:00Z'), end: new Date('2026-04-03T09:15:00Z'), isException: false },
      { start: new Date('2026-04-04T09:00:00Z'), end: new Date('2026-04-04T09:15:00Z'), isException: false },
      { start: new Date('2026-04-05T09:00:00Z'), end: new Date('2026-04-05T09:15:00Z'), isException: false }
    ]
  }];

  const diffs = diffEvents(previous, current);

  // Should be 1 diff, not 5
  assert.strictEqual(diffs.length, 1);
  assert.strictEqual(diffs[0].type, 'new');
});
```

- [ ] **Step 2.2: Run tests to verify they fail**

```bash
npm test -- test/diff.test.js
```

Expected: FAIL - getEventKey still uses timestamp, generates multiple diffs

- [ ] **Step 2.3: Update getEventKey to use ID only**

Replace `getEventKey` in `src/diff.js:11-18`:

```javascript
function getEventKey(event) {
  // Use event ID only - recurring events share same ID across instances
  return event.id;
}
```

- [ ] **Step 2.4: Update detectChanges to handle RRULE comparison**

Replace `detectChanges` in `src/diff.js:69-133`:

```javascript
function detectChanges(oldEvent, newEvent) {
  // For recurring events, compare RRULE instead of individual instance timestamps
  if (oldEvent.rrule || newEvent.rrule) {
    // If RRULE changed or appeared/disappeared, that's a pattern change
    if (oldEvent.rrule !== newEvent.rrule) {
      console.log(`[DIFF] Recurrence pattern changed for "${newEvent.title}"`);
      return {
        type: 'pattern_changed',
        event: newEvent,
        old: { rrule: oldEvent.rrule },
        new: { rrule: newEvent.rrule }
      };
    }
    // Same RRULE = same recurring pattern, no time change to report
  } else {
    // Non-recurring event: compare actual timestamps
    const oldStart = oldEvent.instances[0].start.getTime();
    const newStart = newEvent.instances[0].start.getTime();
    const oldEnd = oldEvent.instances[0].end.getTime();
    const newEnd = newEvent.instances[0].end.getTime();

    if (oldStart !== newStart || oldEnd !== newEnd) {
      // Debug logging for real time changes
      if (oldStart !== newStart) {
        console.log(`[DIFF] Start time changed for "${newEvent.title}": ${oldEvent.instances[0].start.toISOString()} → ${newEvent.instances[0].start.toISOString()}`);
      }
      if (oldEnd !== newEnd) {
        console.log(`[DIFF] End time changed for "${newEvent.title}": ${oldEvent.instances[0].end.toISOString()} → ${newEvent.instances[0].end.toISOString()}`);
      }

      return {
        type: 'time_changed',
        event: newEvent,
        old: {
          start: oldEvent.instances[0].start,
          end: oldEvent.instances[0].end,
          isAllDay: oldEvent.isAllDay
        },
        new: {
          start: newEvent.instances[0].start,
          end: newEvent.instances[0].end,
          isAllDay: newEvent.isAllDay
        }
      };
    }
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
```

- [ ] **Step 2.5: Run tests to verify they pass**

```bash
npm test -- test/diff.test.js
```

Expected: PASS

- [ ] **Step 2.6: Commit diff.js changes**

```bash
git add src/diff.js test/diff.test.js
git commit -m "refactor(diff): compare recurring events by RRULE pattern

- getEventKey() returns event.id only (no timestamp)
- detectChanges() compares RRULE strings for recurring events
- Single diff generated per recurring event, not per instance
- Add pattern_changed diff type for RRULE modifications

refs: #17"
```

---

## Task 3: Add RRULE Humanization Helper

**Files:**
- Modify: `src/formatting.js` (add formatRecurrencePattern function)
- Test: `test/formatting.test.js`

- [ ] **Step 3.1: Write failing tests for RRULE humanization**

Add to `test/formatting.test.js`:

```javascript
test('formatRecurrencePattern should format daily pattern', () => {
  const result = formatRecurrencePattern('FREQ=DAILY', 'de-DE');
  assert.strictEqual(result, 'Täglich');
});

test('formatRecurrencePattern should format weekly pattern with single day', () => {
  const result = formatRecurrencePattern('FREQ=WEEKLY;BYDAY=MO', 'de-DE');
  assert.strictEqual(result, 'Wöchentlich, Mo.');
});

test('formatRecurrencePattern should format weekly pattern with multiple days', () => {
  const result = formatRecurrencePattern('FREQ=WEEKLY;BYDAY=MO,WE,FR', 'de-DE');
  assert.strictEqual(result, 'Wöchentlich, Mo., Mi., Fr.');
});

test('formatRecurrencePattern should format monthly pattern with day', () => {
  const result = formatRecurrencePattern('FREQ=MONTHLY;BYMONTHDAY=15', 'de-DE');
  assert.strictEqual(result, 'Monatlich, 15.');
});

test('formatRecurrencePattern should format yearly pattern', () => {
  const result = formatRecurrencePattern('FREQ=YEARLY;BYMONTH=12;BYMONTHDAY=24', 'de-DE');
  assert.strictEqual(result, 'Jährlich, 24. Dez.');
});

test('formatRecurrencePattern should format interval patterns', () => {
  assert.strictEqual(formatRecurrencePattern('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO', 'de-DE'), 'Alle 2 Wochen, Mo.');
  assert.strictEqual(formatRecurrencePattern('FREQ=DAILY;INTERVAL=3', 'de-DE'), 'Alle 3 Tage');
  assert.strictEqual(formatRecurrencePattern('FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=1', 'de-DE'), 'Alle 2 Monate, 1.');
});

test('formatRecurrencePattern should format positional patterns', () => {
  assert.strictEqual(formatRecurrencePattern('FREQ=MONTHLY;BYDAY=2MO', 'de-DE'), 'Monatlich, 2. Mo.');
  assert.strictEqual(formatRecurrencePattern('FREQ=MONTHLY;BYDAY=-1FR', 'de-DE'), 'Monatlich, letzter Fr.');
  assert.strictEqual(formatRecurrencePattern('FREQ=YEARLY;BYMONTH=11;BYDAY=4TH', 'de-DE'), 'Jährlich, 4. Do. im Nov.');
});

test('formatRecurrencePattern should format patterns with COUNT', () => {
  const result = formatRecurrencePattern('FREQ=WEEKLY;BYDAY=TH;COUNT=10', 'de-DE');
  assert.strictEqual(result, 'Wöchentlich, Do. (10×)');
});

test('formatRecurrencePattern should format patterns with UNTIL', () => {
  const result = formatRecurrencePattern('FREQ=DAILY;UNTIL=20260430T000000Z', 'de-DE');
  assert.strictEqual(result, 'Täglich (bis 30. Apr. 2026)');
});

test('formatRecurrencePattern should handle invalid RRULE gracefully', () => {
  const result = formatRecurrencePattern('INVALID', 'de-DE');
  assert.strictEqual(result, 'Wiederholend');
});

test('formatRecurrencePattern should return null for null input', () => {
  const result = formatRecurrencePattern(null, 'de-DE');
  assert.strictEqual(result, null);
});
```

- [ ] **Step 3.2: Run tests to verify they fail**

```bash
npm test -- test/formatting.test.js
```

Expected: FAIL - formatRecurrencePattern is not defined

- [ ] **Step 3.3: Implement formatRecurrencePattern helper**

Add to `src/formatting.js` (after imports, before other functions):

```javascript
/**
 * Parse RRULE string into components
 * @param {string} rrule - RRULE string
 * @returns {Object} Parsed components
 */
function parseRRule(rrule) {
  if (!rrule) return null;

  const parts = rrule.split(';');
  const parsed = {};

  for (const part of parts) {
    const [key, value] = part.split('=');
    parsed[key] = value;
  }

  return parsed;
}

/**
 * Format recurrence pattern as human-readable German text
 * @param {string|null} rrule - RRULE string (e.g., "FREQ=WEEKLY;BYDAY=MO,WE")
 * @param {string} locale - Locale (currently only de-DE supported)
 * @returns {string|null} Human-readable recurrence pattern
 */
function formatRecurrencePattern(rrule, locale = 'de-DE') {
  if (!rrule) return null;

  try {
    const parsed = parseRRule(rrule);
    if (!parsed || !parsed.FREQ) {
      return 'Wiederholend'; // Fallback for invalid RRULE
    }

    const freq = parsed.FREQ;
    const interval = parseInt(parsed.INTERVAL || '1', 10);
    const byDay = parsed.BYDAY;
    const byMonthDay = parsed.BYMONTHDAY;
    const byMonth = parsed.BYMONTH;
    const count = parsed.COUNT;
    const until = parsed.UNTIL;

    // Day abbreviations mapping (de-DE)
    const dayMap = {
      'MO': 'Mo.', 'TU': 'Di.', 'WE': 'Mi.', 'TH': 'Do.',
      'FR': 'Fr.', 'SA': 'Sa.', 'SU': 'So.'
    };

    // Month abbreviations mapping (de-DE)
    const monthMap = {
      '1': 'Jan.', '2': 'Feb.', '3': 'März', '4': 'Apr.',
      '5': 'Mai', '6': 'Juni', '7': 'Juli', '8': 'Aug.',
      '9': 'Sept.', '10': 'Okt.', '11': 'Nov.', '12': 'Dez.'
    };

    let base = '';
    let details = '';

    // Build base frequency text
    if (freq === 'DAILY') {
      base = interval === 1 ? 'Täglich' : `Alle ${interval} Tage`;
    } else if (freq === 'WEEKLY') {
      base = interval === 1 ? 'Wöchentlich' : `Alle ${interval} Wochen`;
    } else if (freq === 'MONTHLY') {
      base = interval === 1 ? 'Monatlich' : `Alle ${interval} Monate`;
    } else if (freq === 'YEARLY') {
      base = interval === 1 ? 'Jährlich' : `Alle ${interval} Jahre`;
    } else {
      return 'Wiederholend';
    }

    // Add day/date details
    if (byDay) {
      // Check for positional patterns (e.g., "2MO" = 2nd Monday)
      const positionalMatch = byDay.match(/^(-?\d+)([A-Z]{2})$/);
      if (positionalMatch) {
        const [, position, day] = positionalMatch;
        const posText = position === '-1' ? 'letzter' : `${position}.`;
        details = `${posText} ${dayMap[day] || day}`;
      } else {
        // Multiple days (e.g., "MO,WE,FR")
        const days = byDay.split(',').map(d => dayMap[d] || d);
        details = days.join(', ');
      }
    } else if (byMonthDay) {
      details = `${byMonthDay}.`;
    }

    // Add month for yearly patterns
    if (freq === 'YEARLY' && byMonth) {
      const monthName = monthMap[byMonth] || byMonth;
      if (byDay) {
        const positionalMatch = byDay.match(/^(-?\d+)([A-Z]{2})$/);
        if (positionalMatch) {
          const [, position, day] = positionalMatch;
          const posText = position === '-1' ? 'letzter' : `${position}.`;
          details = `${posText} ${dayMap[day] || day} im ${monthName}`;
        }
      } else if (byMonthDay) {
        details = `${byMonthDay}. ${monthName}`;
      } else {
        details = monthName;
      }
    }

    // Build result
    let result = details ? `${base}, ${details}` : base;

    // Add end condition
    if (count) {
      result += ` (${count}×)`;
    } else if (until) {
      // Parse UNTIL date (format: YYYYMMDDTHHMMSSZ)
      const match = until.match(/^(\d{4})(\d{2})(\d{2})/);
      if (match) {
        const [, year, month, day] = match;
        const untilDate = new Date(`${year}-${month}-${day}`);
        const formatted = new Intl.DateTimeFormat(locale, {
          day: 'numeric',
          month: 'short',
          year: 'numeric'
        }).format(untilDate);
        result += ` (bis ${formatted})`;
      }
    }

    return result;
  } catch (error) {
    console.warn('Failed to parse RRULE:', rrule, error.message);
    return 'Wiederholend';
  }
}
```

- [ ] **Step 3.4: Export formatRecurrencePattern**

Update exports at end of `src/formatting.js`:

```javascript
module.exports = {
  formatEventTime,
  renderWeekView,
  renderChangeNotification,
  renderBundledNotification,
  renderDailyView,
  renderCanvasContent,
  renderCalendarLegend,
  formatRecurrencePattern  // Add this
};
```

- [ ] **Step 3.5: Run tests to verify they pass**

```bash
npm test -- test/formatting.test.js
```

Expected: PASS

- [ ] **Step 3.6: Commit RRULE humanization**

```bash
git add src/formatting.js test/formatting.test.js
git commit -m "feat(formatting): add RRULE humanization helper

- formatRecurrencePattern() converts RRULE to German text
- Supports: daily, weekly, monthly, yearly patterns
- Supports: intervals (alle N Tage/Wochen/etc)
- Supports: positional patterns (2. Mo., letzter Fr.)
- Supports: end conditions (COUNT, UNTIL)
- Graceful fallback for invalid RRULE

refs: #17"
```

---

## Task 4: Update Change Notifications

**Files:**
- Modify: `src/formatting.js:360-434` (renderChangeNotification)
- Modify: `src/formatting.js:444-580` (renderBundledNotification)
- Test: `test/formatting.test.js`

- [ ] **Step 4.1: Write failing tests for recurring event notifications**

Add to `test/formatting.test.js`:

```javascript
test('renderChangeNotification should show recurrence pattern for new recurring event', () => {
  const diff = {
    type: 'new',
    event: {
      id: 'recurring-123',
      title: 'Weekly Meeting',
      location: null,
      description: null,
      isAllDay: false,
      rrule: 'FREQ=WEEKLY;BYDAY=TH',
      instances: [
        { start: new Date('2026-04-03T10:00:00Z'), end: new Date('2026-04-03T11:00:00Z'), isException: false }
      ]
    },
    calendarName: 'Team'
  };

  const result = renderChangeNotification(diff, 'de-DE', 'UTC', new Map());

  assert.match(result, /Wöchentlich, Do\./);
  assert.match(result, /Weekly Meeting/);
});

test('renderChangeNotification should show pattern change', () => {
  const diff = {
    type: 'pattern_changed',
    event: {
      id: 'event-123',
      title: 'Standup',
      location: null,
      description: null,
      isAllDay: false,
      rrule: 'FREQ=DAILY',
      instances: [
        { start: new Date('2026-04-03T09:00:00Z'), end: new Date('2026-04-03T09:15:00Z'), isException: false }
      ]
    },
    old: { rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR' },
    new: { rrule: 'FREQ=DAILY' },
    calendarName: 'Team'
  };

  const result = renderChangeNotification(diff, 'de-DE', 'UTC', new Map());

  assert.match(result, /Wöchentlich, Mo\., Mi\., Fr\./);
  assert.match(result, /→/);
  assert.match(result, /Täglich/);
});

test('renderBundledNotification should collapse recurring events', () => {
  const diffs = [
    {
      type: 'new',
      event: {
        id: 'recurring-1',
        title: 'Weekly Meeting',
        location: null,
        description: null,
        isAllDay: true,
        rrule: 'FREQ=WEEKLY;BYDAY=TH',
        instances: [
          { start: new Date('2026-04-03T00:00:00Z'), end: new Date('2026-04-04T00:00:00Z'), isException: false },
          { start: new Date('2026-04-10T00:00:00Z'), end: new Date('2026-04-11T00:00:00Z'), isException: false }
        ]
      },
      calendarName: 'Team'
    }
  ];

  const result = renderBundledNotification(diffs, 'de-DE', 'UTC', {});

  // Should show as 1 change, not 2
  assert.match(result.message, /1.*Kalenderänderung/);
  assert.match(result.message, /Wöchentlich, Do\./);
});
```

- [ ] **Step 4.2: Run tests to verify they fail**

```bash
npm test -- test/formatting.test.js
```

Expected: FAIL - notifications don't show recurrence patterns yet

- [ ] **Step 4.3: Update renderChangeNotification to show recurrence**

Replace `renderChangeNotification` in `src/formatting.js:360-434`:

```javascript
function renderChangeNotification(diff, locale = 'de-DE', timezone = 'UTC', calendarIndicators = new Map()) {
  const { type, event, old, new: newData, calendarName } = diff;
  const indicator = calendarIndicators.get(calendarName) || '';
  const calendar = indicator ? ` ${indicator}` : (calendarName ? ` · ${calendarName}` : '');

  let message = '';

  // For recurring events, show recurrence pattern instead of specific date
  const isRecurring = event.rrule !== null;
  const recurrenceText = isRecurring ? formatRecurrencePattern(event.rrule, locale) : null;

  switch (type) {
    case 'new':
      if (isRecurring) {
        // Show recurrence pattern for recurring events
        const time = event.isAllDay ? getTranslation(locale, 'allDay') : formatEventTime({ ...event, start: event.instances[0].start, end: event.instances[0].end }, locale, timezone);
        message = `*${getTranslation(locale, 'newEvent')}:* ${event.title} · ${recurrenceText} · ${time}${calendar}`;
      } else {
        // Show date for non-recurring events
        const dateStr = new Intl.DateTimeFormat(locale, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          timeZone: timezone
        }).format(event.instances[0].start);
        const time = formatEventTime({ ...event, start: event.instances[0].start, end: event.instances[0].end }, locale, timezone);
        message = `*${getTranslation(locale, 'newEvent')}:* ${event.title} · ${dateStr} · ${time}${calendar}`;
      }
      break;

    case 'deleted':
      if (isRecurring) {
        const time = event.isAllDay ? getTranslation(locale, 'allDay') : formatEventTime({ ...event, start: event.instances[0].start, end: event.instances[0].end }, locale, timezone);
        message = `*${getTranslation(locale, 'cancelled')}:* ${event.title} · ${recurrenceText} · ${time}${calendar}`;
      } else {
        const dateStr = new Intl.DateTimeFormat(locale, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          timeZone: timezone
        }).format(event.instances[0].start);
        const time = formatEventTime({ ...event, start: event.instances[0].start, end: event.instances[0].end }, locale, timezone);
        message = `*${getTranslation(locale, 'cancelled')}:* ${event.title} · ${dateStr} · ${time}${calendar}`;
      }
      break;

    case 'pattern_changed':
      // RRULE changed - show old → new pattern
      const oldPattern = formatRecurrencePattern(old.rrule, locale);
      const newPattern = formatRecurrencePattern(newData.rrule, locale);
      const time = event.isAllDay ? getTranslation(locale, 'allDay') : formatEventTime({ ...event, start: event.instances[0].start, end: event.instances[0].end }, locale, timezone);
      message = `*Wiederholung geändert:* ${event.title} · ${oldPattern} → ${newPattern} · ${time}${calendar}`;
      break;

    case 'time_changed':
      // Non-recurring event time changed
      const dateStr = new Intl.DateTimeFormat(locale, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        timeZone: timezone
      }).format(event.instances[0].start);

      const dateChanged = !isSameDay(old.start, newData.start, timezone);
      const oldTime = formatEventTime({ ...event, start: old.start, end: old.end, isAllDay: old.isAllDay }, locale, timezone);
      const newTime = formatEventTime({ ...event, start: newData.start, end: newData.end, isAllDay: newData.isAllDay }, locale, timezone);
      const timeChanged = oldTime !== newTime;

      if (dateChanged && !timeChanged) {
        const oldDateStr = formatShortDate(old.start, locale, timezone);
        const newDateStr = formatShortDate(newData.start, locale, timezone);
        message = `*Termin verschoben:* ${event.title} · ${oldDateStr} ${oldTime} → ${newDateStr} ${newTime}${calendar}`;
      } else if (!dateChanged && timeChanged) {
        message = `*Termin verschoben:* ${event.title} · ${dateStr} · ${oldTime} → ${newTime}${calendar}`;
      } else {
        const oldDateStr = formatShortDate(old.start, locale, timezone);
        const newDateStr = formatShortDate(newData.start, locale, timezone);
        message = `*Termin verschoben:* ${event.title} · ${oldDateStr} ${oldTime} → ${newDateStr} ${newTime}${calendar}`;
      }
      break;

    case 'title_changed':
      if (isRecurring) {
        message = `*Termin umbenannt:* ${old.title} → ${event.title} · ${recurrenceText}${calendar}`;
      } else {
        const dateStr = new Intl.DateTimeFormat(locale, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          timeZone: timezone
        }).format(event.instances[0].start);
        const titleTime = formatEventTime({ ...event, start: event.instances[0].start, end: event.instances[0].end }, locale, timezone);
        message = `*Termin umbenannt:* ${old.title} → ${event.title} · ${dateStr} · ${titleTime}${calendar}`;
      }
      break;

    case 'location_changed':
      if (isRecurring) {
        message = `*Termin geändert:* ${event.title} · ${recurrenceText}${calendar}`;
      } else {
        const dateStr = new Intl.DateTimeFormat(locale, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          timeZone: timezone
        }).format(event.instances[0].start);
        const locTime = formatEventTime({ ...event, start: event.instances[0].start, end: event.instances[0].end }, locale, timezone);
        message = `*Termin geändert:* ${event.title} · ${dateStr} · ${locTime}${calendar}`;
      }
      break;

    default:
      if (isRecurring) {
        message = `*Termin geändert:* ${event.title} · ${recurrenceText}${calendar}`;
      } else {
        const dateStr = new Intl.DateTimeFormat(locale, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          timeZone: timezone
        }).format(event.instances[0].start);
        const defaultTime = formatEventTime({ ...event, start: event.instances[0].start, end: event.instances[0].end }, locale, timezone);
        message = `*Termin geändert:* ${event.title} · ${dateStr} · ${defaultTime}${calendar}`;
      }
      break;
  }

  return message;
}
```

- [ ] **Step 4.4: Update renderBundledNotification grouping logic**

In `src/formatting.js`, update the grouping section in `renderBundledNotification` (around line 467):

```javascript
  // Group by change type
  const grouped = {
    new: diffs.filter(d => d.type === 'new'),
    deleted: diffs.filter(d => d.type === 'deleted'),
    patternChanged: diffs.filter(d => d.type === 'pattern_changed'),
    timeChanged: diffs.filter(d => d.type === 'time_changed'),
    titleChanged: diffs.filter(d => d.type === 'title_changed'),
    locationChanged: diffs.filter(d => d.type === 'location_changed')
  };
```

Then update the rendering sections to handle pattern_changed:

```javascript
  // Render pattern-changed events (add after timeChanged section)
  if (grouped.patternChanged.length > 0) {
    const label = grouped.patternChanged.length === 1 ? 'Wiederholung geändert' : 'Wiederholungen geändert';
    output += `*${label}:*\n`;
    for (const diff of grouped.patternChanged) {
      const { event, old, new: newData, calendarName } = diff;
      const oldPattern = formatRecurrencePattern(old.rrule, locale);
      const newPattern = formatRecurrencePattern(newData.rrule, locale);
      const indicator = calendarIndicators.get(calendarName) || '';
      const calendar = indicator ? ` ${indicator}` : (calendarName ? ` · ${calendarName}` : '');
      output += `• ${event.title} · ${oldPattern} → ${newPattern}${calendar}\n`;
    }
    output += '\n';
  }
```

- [ ] **Step 4.5: Run tests to verify they pass**

```bash
npm test -- test/formatting.test.js
```

Expected: PASS

- [ ] **Step 4.6: Commit notification changes**

```bash
git add src/formatting.js test/formatting.test.js
git commit -m "feat(formatting): show recurrence patterns in notifications

- renderChangeNotification() shows RRULE pattern for recurring events
- New recurring event: 'Test · Wöchentlich, Do. · Ganztägig'
- Pattern changed: 'Test · Täglich → Wöchentlich, Do.'
- Non-recurring events unchanged
- Add pattern_changed handling to bundled notifications

refs: #17"
```

---

## Task 5: Update Scheduler for Instances

**Files:**
- Modify: `src/scheduler.js:60-80` (classifyUrgency function)
- Test: `test/scheduler.test.js`

- [ ] **Step 5.1: Write failing test for instance-based urgency**

Add to `test/scheduler.test.js`:

```javascript
test('classifyUrgency should check all instances for recurring event', () => {
  const now = new Date('2026-04-01T12:00:00Z');

  // Recurring event with one urgent instance
  const event = {
    id: 'recurring-123',
    title: 'Meeting',
    location: null,
    description: null,
    isAllDay: false,
    rrule: 'FREQ=WEEKLY;BYDAY=MO',
    instances: [
      { start: new Date('2026-04-01T18:00:00Z'), end: new Date('2026-04-01T19:00:00Z'), isException: false }, // 6 hours away - URGENT
      { start: new Date('2026-04-07T18:00:00Z'), end: new Date('2026-04-07T19:00:00Z'), isException: false }  // Next week
    ]
  };

  const urgency = classifyUrgency(event, now);

  assert.strictEqual(urgency, 'URGENT');
});

test('classifyUrgency should return THIS_WEEK if any instance in current week', () => {
  const now = new Date('2026-04-01T12:00:00Z'); // Wednesday

  const event = {
    id: 'recurring-456',
    title: 'Meeting',
    location: null,
    description: null,
    isAllDay: false,
    rrule: 'FREQ=WEEKLY;BYDAY=FR',
    instances: [
      { start: new Date('2026-04-04T10:00:00Z'), end: new Date('2026-04-04T11:00:00Z'), isException: false }, // This Friday
      { start: new Date('2026-04-11T10:00:00Z'), end: new Date('2026-04-11T11:00:00Z'), isException: false }  // Next Friday
    ]
  };

  const urgency = classifyUrgency(event, now);

  assert.strictEqual(urgency, 'THIS_WEEK');
});
```

- [ ] **Step 5.2: Run tests to verify they fail**

```bash
npm test -- test/scheduler.test.js
```

Expected: FAIL - classifyUrgency still uses single start date

- [ ] **Step 5.3: Update classifyUrgency to iterate over instances**

Replace `classifyUrgency` in `src/scheduler.js`:

```javascript
function classifyUrgency(event, now = new Date()) {
  // Check if ANY instance falls within urgency windows
  for (const instance of event.instances) {
    const start = instance.start;
    const hoursDiff = (start - now) / (1000 * 60 * 60);

    // Within 24 hours
    if (hoursDiff >= 0 && hoursDiff <= 24) {
      return 'URGENT';
    }

    // Within current week (Monday 00:00 - Sunday 23:59)
    const dayOfWeek = now.getUTCDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    const startOfWeek = new Date(now);
    startOfWeek.setUTCDate(now.getUTCDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1));
    startOfWeek.setUTCHours(0, 0, 0, 0);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setUTCDate(startOfWeek.getUTCDate() + 6);
    endOfWeek.setUTCHours(23, 59, 59, 999);

    if (start >= startOfWeek && start <= endOfWeek) {
      return 'THIS_WEEK';
    }
  }

  return 'LATER';
}
```

- [ ] **Step 5.4: Run tests to verify they pass**

```bash
npm test -- test/scheduler.test.js
```

Expected: PASS

- [ ] **Step 5.5: Commit scheduler changes**

```bash
git add src/scheduler.js test/scheduler.test.js
git commit -m "refactor(scheduler): check urgency across all instances

- classifyUrgency() iterates over event.instances[]
- Returns URGENT if any instance within 24 hours
- Returns THIS_WEEK if any instance in current week
- Supports recurring events with multiple instances

refs: #17"
```

---

## Task 6: Update Digest and Canvas Rendering

**Files:**
- Modify: `src/formatting.js` (renderWeekView, renderDailyView, renderCanvasContent)
- Test: `test/formatting.test.js`

- [ ] **Step 6.1: Write failing test for digest rendering**

Add to `test/formatting.test.js`:

```javascript
test('renderWeekView should expand recurring event instances for display', () => {
  const events = [
    {
      id: 'recurring-123',
      title: 'Daily Standup',
      location: null,
      description: null,
      isAllDay: false,
      rrule: 'FREQ=DAILY',
      instances: [
        { start: new Date('2026-03-31T09:00:00Z'), end: new Date('2026-03-31T09:15:00Z'), isException: false },
        { start: new Date('2026-04-01T09:00:00Z'), end: new Date('2026-04-01T09:15:00Z'), isException: false },
        { start: new Date('2026-04-02T09:00:00Z'), end: new Date('2026-04-02T09:15:00Z'), isException: false }
      ],
      calendarName: 'Team'
    }
  ];

  const dateRange = {
    start: new Date('2026-03-31T00:00:00Z'),
    end: new Date('2026-04-06T23:59:59Z')
  };

  const result = renderWeekView(events, dateRange, 'de-DE', {
    timezone: 'UTC',
    config: { calendars: {} },
    cacheMap: new Map()
  });

  // Should show 3 separate entries (one per instance)
  assert.strictEqual((result.match(/Daily Standup/g) || []).length, 3);
});

test('renderCanvasContent should expand recurring event instances', () => {
  const events = [
    {
      id: 'recurring-456',
      title: 'Weekly Meeting',
      location: null,
      description: null,
      isAllDay: true,
      rrule: 'FREQ=WEEKLY;BYDAY=TH',
      instances: [
        { start: new Date('2026-04-03T00:00:00Z'), end: new Date('2026-04-04T00:00:00Z'), isException: false },
        { start: new Date('2026-04-10T00:00:00Z'), end: new Date('2026-04-11T00:00:00Z'), isException: false }
      ],
      calendarName: 'Team'
    }
  ];

  const result = renderCanvasContent(events, {
    locale: 'de-DE',
    timezone: 'UTC',
    config: { calendars: {} },
    cacheMap: new Map()
  });

  // Should show 2 separate entries
  assert.strictEqual((result.match(/Weekly Meeting/g) || []).length, 2);
});
```

- [ ] **Step 6.2: Run tests to verify they fail**

```bash
npm test -- test/formatting.test.js
```

Expected: FAIL - digest rendering doesn't expand instances yet

- [ ] **Step 6.3: Update renderWeekView to expand instances**

In `src/formatting.js`, update `renderWeekView` to flatten instances:

```javascript
async function renderWeekView(events, dateRange, locale = 'en-US', options = {}) {
  // ... existing setup code ...

  // Flatten events to instances for display
  const flattenedEvents = [];
  for (const event of events) {
    for (const instance of event.instances) {
      flattenedEvents.push({
        ...event,
        start: instance.start,
        end: instance.end,
        isException: instance.isException
        // Keep other event properties (title, location, etc.)
      });
    }
  }

  // Rest of function works with flattenedEvents instead of events
  // ... existing rendering logic ...
}
```

- [ ] **Step 6.4: Update renderDailyView to expand instances**

In `src/formatting.js`, update `renderDailyView` similarly:

```javascript
async function renderDailyView(events, dateRange, locale = 'en-US', options = {}) {
  // ... existing setup code ...

  // Flatten events to instances for display
  const flattenedEvents = [];
  for (const event of events) {
    for (const instance of event.instances) {
      flattenedEvents.push({
        ...event,
        start: instance.start,
        end: instance.end,
        isException: instance.isException
      });
    }
  }

  // Rest of function works with flattenedEvents
  // ... existing rendering logic ...
}
```

- [ ] **Step 6.5: Update renderCanvasContent to expand instances**

In `src/formatting.js`, update `renderCanvasContent`:

```javascript
async function renderCanvasContent(events, options = {}) {
  // ... existing setup code ...

  // Flatten events to instances for display
  const flattenedEvents = [];
  for (const event of events) {
    for (const instance of event.instances) {
      flattenedEvents.push({
        ...event,
        start: instance.start,
        end: instance.end,
        isException: instance.isException
      });
    }
  }

  // Rest of function works with flattenedEvents
  // ... existing rendering logic ...
}
```

- [ ] **Step 6.6: Run tests to verify they pass**

```bash
npm test -- test/formatting.test.js
```

Expected: PASS

- [ ] **Step 6.7: Commit digest/canvas changes**

```bash
git add src/formatting.js test/formatting.test.js
git commit -m "refactor(formatting): expand instances for digest/canvas display

- renderWeekView() flattens event.instances[] before rendering
- renderDailyView() flattens event.instances[] before rendering
- renderCanvasContent() flattens event.instances[] before rendering
- Each instance shows as separate entry (preserves existing UX)
- No user-visible changes to digest/canvas output

refs: #17"
```

---

## Task 7: Integration Testing

**Files:**
- Test: All test files
- Modify: Test fixtures across all files

- [ ] **Step 7.1: Update all test fixtures to composite structure**

Update test files to use new event structure:

**test/bot.test.js:**
```javascript
// Update all event fixtures to include instances array
const testEvent = {
  id: 'test-123',
  title: 'Test Event',
  location: null,
  description: null,
  isAllDay: false,
  rrule: null,
  instances: [
    { start: new Date('2026-04-01T10:00:00Z'), end: new Date('2026-04-01T11:00:00Z'), isException: false }
  ]
};
```

**test/diff.test.js:**
```javascript
// Update all existing diff tests to use composite structure
// Ensure non-recurring events have rrule: null and single instance
```

**test/formatting.test.js:**
```javascript
// Update all event fixtures
// Ensure tests cover both recurring (rrule !== null) and non-recurring (rrule === null)
```

**test/scheduler.test.js:**
```javascript
// Update event fixtures to have instances array
```

- [ ] **Step 7.2: Run full test suite**

```bash
npm test
```

Expected: All tests pass

- [ ] **Step 7.3: Test with real CalDAV data (manual)**

Set up test environment:
```bash
# Copy config.example.json to config.json
# Fill in real credentials
# Set TEST_MODE=true to route to error_channel
```

Run bot manually:
```bash
node src/bot.js --detect-changes --dry-run
```

Verify:
- No duplicate notifications for recurring events
- Recurrence patterns shown in notifications
- Digests still display all instances

- [ ] **Step 7.4: Commit integration test updates**

```bash
git add test/*.test.js
git commit -m "test: update all fixtures to composite event structure

- All test events now have instances[] array
- Recurring events have rrule property
- Non-recurring events have rrule: null
- Full test suite passes with new data model

refs: #17"
```

---

## Task 8: Documentation and Cleanup

**Files:**
- Update: README.md
- Update: docs/setup-guide.md (if exists)

- [ ] **Step 8.1: Update documentation**

Add to README.md under Features section:

```markdown
### Recurring Event Support

The bot intelligently handles recurring events:

- **Smart notifications**: Single notification per recurring event (not one per instance)
- **Human-readable patterns**: "Wöchentlich, Mo., Mi., Fr." instead of technical RRULE
- **Pattern change detection**: Notifies when recurrence rules are modified
- **All patterns supported**: Daily, weekly, monthly, yearly with intervals and positions

Example notification:
```
1 Kalenderänderung

Neuer Termin:
• Team Standup · Täglich · 09:00-09:15
```
```

- [ ] **Step 8.2: Run final integration test**

```bash
npm test
npm run lint # if available
```

Expected: All checks pass

- [ ] **Step 8.3: Commit documentation**

```bash
git add README.md docs/
git commit -m "docs: add recurring events feature documentation

- Describe smart notification collapsing
- List supported RRULE patterns
- Add example notification format

refs: #17"
```

- [ ] **Step 8.4: Create summary of changes**

Run:
```bash
git log --oneline --since="1 day ago"
```

Verify all commits follow pattern:
- refactor(caldav): ...
- refactor(diff): ...
- feat(formatting): ...
- etc.

---

## Success Criteria Verification

- [ ] **No notification spam**: Create recurring event, verify single notification
- [ ] **Pattern detection**: Modify RRULE, verify pattern change notification
- [ ] **All patterns supported**: Test daily/weekly/monthly/yearly/interval/positional
- [ ] **Backward compatible**: Non-recurring events work exactly as before
- [ ] **Tests passing**: `npm test` shows 100% pass rate
- [ ] **No regressions**: Digests and canvas show all instances correctly

---

## Rollback Plan

If issues occur in production:

```bash
# Revert all commits from this feature
git revert <first-commit>^..<last-commit>

# Or reset to before feature
git reset --hard <commit-before-feature>
git push --force
```

---

## Notes for Implementation

- Follow TDD strictly: write test → verify fail → implement → verify pass
- Commit after each task completion
- Test with real CalDAV data before considering done
- Pay attention to timezone handling in tests
- Keep existing digest/canvas UX unchanged (expand instances for display)
