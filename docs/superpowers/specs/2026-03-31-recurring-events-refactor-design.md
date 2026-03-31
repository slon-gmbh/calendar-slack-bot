# Recurring Events Refactor Design

**Date:** 2026-03-31
**Status:** Approved

## Problem

Currently, recurring events are expanded into individual instances at CalDAV parsing time (caldav.js). This causes:

1. **Notification spam**: A new weekly recurring event triggers 5+ separate "new event" notifications (one per instance)
2. **Loss of context**: By the time we reach diffing and formatting, we've lost the information that these instances belong to the same recurring event
3. **Inefficient diffing**: Each instance is compared separately, generating redundant diffs

**Example issue:**
```
User creates: "Test" recurring weekly on Thursdays
Bot notifies:
  5 new events:
  • Test · Thu, Apr 2 · All-day
  • Test · Thu, Apr 9 · All-day
  • Test · Thu, Apr 16 · All-day
  • Test · Thu, Apr 23 · All-day
  • Test · Thu, Apr 30 · All-day
```

**Expected behavior:**
```
1 new event:
• Test · Wöchentlich, Do. · Ganztägig
```

## Solution

Restructure the data model to preserve RRULE information throughout the pipeline. Recurring events remain as single objects with an `instances[]` array, and are only expanded for display purposes.

## Architecture

### Data Model

**Event structure (all events):**
```javascript
{
  id: string,              // Event UID from CalDAV
  title: string,           // Event summary
  location: string | null, // Event location
  description: string | null,
  isAllDay: boolean,
  rrule: string | null,    // RRULE string (null for non-recurring)
  instances: [             // Expanded occurrences
    {
      start: Date,         // Instance start (UTC)
      end: Date,           // Instance end (UTC)
      isException: boolean // true if RECURRENCE-ID override
    }
  ]
}
```

**Recurring event example:**
```javascript
{
  id: "event-uid-123",
  title: "Weekly Standup",
  location: "Conference Room A",
  description: "Daily standup meeting",
  isAllDay: false,
  rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
  instances: [
    { start: Date("2026-04-02T09:00:00Z"), end: Date("2026-04-02T09:15:00Z"), isException: false },
    { start: Date("2026-04-04T09:00:00Z"), end: Date("2026-04-04T09:15:00Z"), isException: false },
    { start: Date("2026-04-07T09:00:00Z"), end: Date("2026-04-07T09:15:00Z"), isException: false }
  ]
}
```

**Non-recurring event example:**
```javascript
{
  id: "single-event-uid",
  title: "One-time Meeting",
  location: null,
  description: null,
  isAllDay: false,
  rrule: null,
  instances: [
    { start: Date("2026-04-05T14:00:00Z"), end: Date("2026-04-05T15:00:00Z"), isException: false }
  ]
}
```

**Key principles:**
- Every event has an `instances` array (even non-recurring events have exactly 1 instance)
- Title, location, description live at event level (not duplicated per instance)
- RRULE preserved as string for comparison and humanization
- Modified occurrences (RECURRENCE-ID) marked with `isException: true`

### Component Changes

#### 1. caldav.js (Major Refactor)

**Current behavior:**
- Expands recurring events immediately
- Returns flat array of event objects (one per instance)
- RRULE information is stored per instance but not used for grouping

**New behavior:**
- Parse RRULE and expand instances
- Return single event object with `instances[]` array
- Preserve RRULE string on parent event

**Changes:**
- Modify `normalizeEvent()` to return composite structure
- Keep instance expansion logic (rrule.between()) but store results in array
- Handle EXDATE (skip instances)
- Handle RECURRENCE-ID (mark as `isException: true`)
- Non-recurring events get single-element instances array

#### 2. diff.js (Major Refactor)

**Current behavior:**
- `getEventKey()` returns `id:timestamp` for recurring events
- Each instance compared separately
- Generates N diffs for N instances of same recurring event

**New behavior:**
- `getEventKey()` returns just `event.id`
- Compare recurring events by RRULE string
- Single diff for entire recurring event

**Diff logic:**

**For recurring events (`event.rrule !== null`):**
1. **New recurring event** → type: `new`
   - Message: "Test · Wöchentlich, Do. · Ganztägig"

2. **Deleted recurring event** → type: `deleted`
   - Message: "Test · Wöchentlich, Do. · Ganztägig"

3. **RRULE changed** → type: `pattern_changed`
   - Compare old vs new RRULE strings
   - Message: "Test · Täglich → Wöchentlich, Do. · Ganztägig"

4. **Title/location changed (same RRULE)** → type: `title_changed` or `location_changed`
   - Message: "Old Title → New Title · Wöchentlich, Do."

**For non-recurring events (`event.rrule === null`):**
- Same as current logic: compare timestamps, title, location

**Ignore:**
- Individual instance modifications (RECURRENCE-ID) - future enhancement
- Number of instances (depends on date range)

#### 3. formatting.js (Major Refactor)

**Add RRULE humanization:**

```javascript
function formatRecurrencePattern(rrule, locale) {
  // Parse RRULE string and convert to human-readable text
}
```

**Supported patterns:**

```
Simple:
"FREQ=DAILY" → "Täglich"
"FREQ=WEEKLY;BYDAY=MO" → "Wöchentlich, Mo."
"FREQ=WEEKLY;BYDAY=MO,WE,FR" → "Wöchentlich, Mo., Mi., Fr."
"FREQ=MONTHLY;BYMONTHDAY=15" → "Monatlich, 15."
"FREQ=YEARLY;BYMONTH=12;BYMONTHDAY=24" → "Jährlich, 24. Dez."

Intervals:
"FREQ=WEEKLY;INTERVAL=2;BYDAY=MO" → "Alle 2 Wochen, Mo."
"FREQ=DAILY;INTERVAL=3" → "Alle 3 Tage"
"FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=1" → "Alle 2 Monate, 1."

Positional:
"FREQ=MONTHLY;BYDAY=2MO" → "Monatlich, 2. Mo."
"FREQ=MONTHLY;BYDAY=-1FR" → "Monatlich, letzter Fr."
"FREQ=YEARLY;BYMONTH=11;BYDAY=4TH" → "Jährlich, 4. Do. im Nov."

With end conditions:
"FREQ=WEEKLY;BYDAY=TH;COUNT=10" → "Wöchentlich, Do. (10×)"
"FREQ=DAILY;UNTIL=20260430T000000Z" → "Täglich (bis 30. Apr. 2026)"
```

**Change notification format:**

```javascript
// New recurring event:
"• Test · Wöchentlich, Do. · Ganztägig"

// Deleted recurring event:
"• Test · Wöchentlich, Do. · Ganztägig"

// Pattern changed:
"• Test · Täglich → Wöchentlich, Do. · Ganztägig"

// Title changed:
"• Old Name → New Name · Wöchentlich, Do. · 09:00-09:15"

// Non-recurring events (unchanged):
"• Meeting · Do., 2. Apr. · 14:00-15:00"
```

**Update functions:**
- `renderChangeNotification()` - check `event.rrule`, format recurrence pattern
- `renderBundledNotification()` - group by type, show recurrence info
- `renderWeekView()` - expand `event.instances[]` for display (no change to output format)
- `renderDailyView()` - expand `event.instances[]` for display (no change to output format)
- `renderCanvasContent()` - expand `event.instances[]` for canvas (no change to output format)

#### 4. scheduler.js (Minor Changes)

**Update urgency checking:**

```javascript
function classifyUrgency(event) {
  // Check if ANY instance falls in urgency window
  for (const instance of event.instances) {
    if (isUrgent(instance.start)) {
      return 'URGENT';
    }
  }
  // Check week boundaries...
}
```

**No changes to:**
- `matchesSchedule()` - operates on Date objects, independent of structure
- `shouldNotifyNow()` - uses urgency classification, independent of structure

#### 5. bot.js (Minor Changes)

**Update:**
- `buildCacheMap()` - no functional changes, cache structure changes but API is same

**No changes to:**
- Main flow logic
- Routing functions
- Digest scheduling

#### 6. Tests (Update All)

**Update test fixtures:**
- Change event structure to composite format
- Add `instances` array to all test events
- Add `rrule` property where applicable

**Add new tests:**
- RRULE parsing for all supported patterns
- RRULE humanization in multiple locales
- Recurring event diffing (new, deleted, pattern changed)
- Edge cases (invalid RRULE, empty instances, etc.)

**Update existing tests:**
- diff.js tests - update expectations for recurring events
- formatting.js tests - verify recurrence display
- scheduler.js tests - verify instance iteration

## Edge Cases & Error Handling

### 1. Invalid RRULE Strings
**Issue:** Malformed RRULE from CalDAV
**Solution:** Log warning, set `rrule: null`, treat as non-recurring
**Example:** `"FREQ=INVALID"` → fallback to single instance

### 2. Empty Instances Array
**Issue:** RRULE expands to 0 instances in date range
**Solution:** Skip event entirely (don't include in results)
**Example:** Weekly event that ended before current week

### 3. Very Large Recurrence Patterns
**Issue:** Daily event with no end date
**Solution:** Limit expansion to `dateRange.start` to `dateRange.end` only
**Example:** `FREQ=DAILY` only expands within requested date range

### 4. Mixed Timezones in Instances
**Issue:** DST transitions cause different UTC offsets
**Solution:** Already handled by `convertToUTC()` function
**No changes needed**

### 5. RRULE Parsing Errors
**Issue:** node-ical fails to parse RRULE
**Solution:** Catch error, log warning with UID, treat as non-recurring

### 6. Deleted Occurrences (EXDATE)
**Issue:** Specific instances removed from recurrence
**Solution:** Already handled - skip during expansion
**No changes needed**

### 7. Modified Occurrences (RECURRENCE-ID)
**Issue:** Specific instance has different time/title
**Solution:** Mark with `isException: true`, include in instances array
**Future enhancement:** Show "3 occurrences, 1 modified" (not MVP)

### 8. Unknown RRULE Properties
**Issue:** CalDAV uses custom/unknown properties
**Solution:** Preserve in RRULE string, ignore in humanization
**Example:** `FREQ=WEEKLY;X-CUSTOM=foo` → Show "Wöchentlich"

### Error Handling Strategy
- **Non-fatal errors:** Log warning, fallback to safe default (treat as non-recurring)
- **Fatal errors:** Only if event has no valid start/end dates (existing validation applies)
- **Graceful degradation:** Better to show "Termin geändert" than crash

## Migration Strategy

### Phase 1: Update Data Model
1. Modify caldav.js to return composite structure
2. Update tests to use new structure
3. Ensure caldav.js tests pass

### Phase 2: Update Diffing
1. Modify diff.js to compare by event ID only
2. Add recurring event comparison logic
3. Ensure diff.js tests pass

### Phase 3: Update Formatting
1. Add `formatRecurrencePattern()` helper
2. Update change notification rendering
3. Update digest/canvas rendering to expand instances
4. Ensure formatting.js tests pass

### Phase 4: Update Scheduler
1. Modify urgency checking to iterate instances
2. Ensure scheduler.js tests pass

### Phase 5: Integration Testing
1. Run full bot.js integration tests
2. Test with real CalDAV data
3. Verify notifications are collapsed

### Phase 6: Deployment
1. Update documentation
2. Deploy to production
3. Monitor for issues

## Success Criteria

1. **Notification spam eliminated:** Single notification for recurring event creation
2. **Pattern changes detected:** RRULE modifications trigger appropriate notifications
3. **All RRULE patterns supported:** Daily, weekly, monthly, yearly with all modifiers
4. **Backward compatible:** Non-recurring events work exactly as before
5. **Tests passing:** 100% test coverage maintained
6. **No regressions:** Digests and canvas updates work as before

## Future Enhancements (Not MVP)

1. **Exception tracking:** Show "Weekly (Mo., Wed.) · 1 occurrence modified"
2. **Instance-level notifications:** Notify when single occurrence is deleted/modified
3. **Smarter RRULE diffing:** Detect semantic equivalence (e.g., BYDAY=MO,TU,WE,TH,FR vs weekdays)
4. **Recurring event end date in notifications:** Show "until Dec 2026" for bounded recurrences
5. **RRULE localization:** Support languages beyond German

## Open Questions

None - all requirements clarified during design phase.
