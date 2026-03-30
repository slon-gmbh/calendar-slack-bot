# Message Formatting Overhaul Design

**Date:** 2026-03-30
**Status:** Approved
**Related Issues:** #3, #10, #13, #6, #2, #5

## Overview

This design consolidates multiple message formatting, configuration, and scheduling improvements into a single cohesive update. The changes improve message readability, fix timing issues, optimize cron schedules, and add clickable links between Slack messages, Canvas, and Nextcloud.

## Problem Statement

Multiple issues affect the calendar bot's message formatting and scheduling:

1. **Excessive emojis** (📅, 📆) add visual clutter without functional value
2. **Missing inline calendar color indicators** - accidentally removed in commit b0885e1
3. **Horizontal rules break** on narrow screens (20 characters too long)
4. **Footer text not clickable** - "Komplette Übersicht →" looks like a link but isn't
5. **Weekly schedule timing wrong** - shows past week when run on Sunday instead of upcoming week
6. **Cron schedules wasteful** - digest workflow runs hourly regardless of configuration, change detection runs 24/7

## Goals

- Remove decorative emojis while keeping functional calendar color indicators
- Restore inline color indicators for multi-calendar channels
- Fix horizontal rule rendering across all devices
- Add clickable navigation: message → Canvas → Nextcloud
- Fix weekly schedule to show upcoming week on Sunday
- Optimize cron schedules to match actual needs

## Non-Goals

- Differentiating message vs Canvas content (summary vs full) - deferred to future work
- Removing `canvas_id` field - kept for backward compatibility, can be removed later
- Dynamic cron schedule generation - users manually configure schedules

## Design

### 1. Configuration Schema Changes

#### New Global Fields

Add to root config object:

```json
{
  "workspace_id": "T01234WORK",
  "nextcloud_url": "https://nextcloud.example.com/apps/calendar"
}
```

- **workspace_id** (string, required): Slack workspace ID for constructing Canvas URLs
- **nextcloud_url** (string, optional): Nextcloud calendar web interface URL for Canvas footer link

#### New Channel Field

Add to each channel object:

```json
{
  "channels": [
    {
      "canvas_url": "https://workspace.slack.com/docs/T01234WORK/F9876CANVAS"
    }
  ]
}
```

- **canvas_url** (string, optional): Full Slack Canvas URL for clickable footer link in digest messages

#### Backward Compatibility

- `canvas_id` field remains (not removed)
- All new fields are optional - missing fields disable related features:
  - No `canvas_url` → footer link shows as plain text
  - No `nextcloud_url` → Canvas has no Nextcloud link
- Existing configs work without modification

#### Validation

Update `src/config.js` validation:

- Require `workspace_id` field
- If `canvas_url` provided, validate URL format
- If `nextcloud_url` provided, validate URL format
- Log warnings if optional fields missing (graceful degradation)

#### Example config.json

```json
{
  "workspace_id": "T01234WORK",
  "nextcloud_url": "https://nextcloud.example.com/apps/calendar",
  "locale": "en-US",
  "timezone": "UTC",
  "caldav_credentials": { ... },
  "calendars": { ... },
  "channels": [
    {
      "id": "C01234TEAM",
      "canvas_id": "F9876CANVAS",
      "canvas_url": "https://workspace.slack.com/docs/T01234WORK/F9876CANVAS",
      "calendars": ["team-calendar"],
      "digest_schedule": "sunday 18:00"
    }
  ]
}
```

### 2. Message Formatting Changes

#### Remove Decorative Emojis

**All-day events** (`src/formatting.js` line 113):
```javascript
// Before
if (event.isAllDay) {
  return '📅';
}

// After
if (event.isAllDay) {
  return getTranslation(locale, 'allDay'); // "All-day" or "Ganztägig"
}
```

**Footer summaries** (`src/formatting.js` lines 267, 632):
```javascript
// Before
output += `📆 ${totalEvents} ${eventLabel}`;

// After
output += `${totalEvents} ${eventLabel}`;
```

**Keep error emojis** (`src/slack.js` line 95):
```javascript
// Unchanged - keep ⚠️ in error notifications
const errorText = `⚠️ **Calendar Bot Error**\n\n${message}...`;
```

#### Restore Inline Calendar Color Indicators

**Weekly digest** (`src/formatting.js` lines 253-254):
```javascript
// Before (accidentally removed in b0885e1)
// Don't show emoji indicators in digest, just calendar name if present
const calendar = event.calendarName ? ` · ${event.calendarName}` : '';

// After (restore)
const indicator = calendarIndicators.get(event.calendarName) || '';
const calendar = indicator ? ` ${indicator}` : (event.calendarName ? ` · ${event.calendarName}` : '');
```

**Daily digest** (`src/formatting.js` lines 618-619):
```javascript
// Apply same fix as weekly digest
const indicator = calendarIndicators.get(event.calendarName) || '';
const calendar = indicator ? ` ${indicator}` : (event.calendarName ? ` · ${event.calendarName}` : '');
```

**Change notifications** - already correct, no changes needed.

#### Fix Horizontal Rule Rendering

**Problem:** 20 characters (`━━━━━━━━━━━━━━━━━━━━`) breaks on narrow screens, doesn't fill Canvas width properly.

**Solution:** Reduce to 12 characters and ensure line break:

```javascript
// Before (lines 237, 602)
output += `━━━━━━━━━━━━━━━━━━━━\n`;

// After
output += `────────────\n`;
```

**Rationale:**
- Shorter separator less likely to wrap on mobile
- Consistent 12-character length
- Using `─` (box drawing light horizontal) instead of `━` (heavy)
- Always followed by `\n` for proper line break

#### Add Clickable Footer Links

**Digest messages** → Canvas (lines 267, 632):
```javascript
// Before
output += ` · ${getTranslation(locale, 'fullSchedule')}`;

// After
if (options.canvas_url) {
  const linkText = getTranslation(locale, 'fullSchedule');
  output += ` · <${options.canvas_url}|${linkText}>`;
} else {
  output += ` · ${getTranslation(locale, 'fullSchedule')}`;
}
```

**Canvas content** → Nextcloud:
```javascript
// Add to renderCanvasContent() after existing content
if (options.config?.nextcloud_url) {
  const locale = options.locale || 'en-US';
  const linkText = locale === 'de-DE' ? 'In Nextcloud ansehen →' : 'View in Nextcloud →';
  output += `\n\n<${options.config.nextcloud_url}|${linkText}>`;
}
```

**Pass canvas_url to rendering functions:**

Update `postDigestForChannel()` in `src/bot.js`:
```javascript
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

#### Message Format Examples

**Before:**
```
*Wochenübersicht: KW 13 · 23. März — 29. März*

*Montag, 24. März*
━━━━━━━━━━━━━━━━━━━━
09:00  Team Meeting · Team Calendar
📅 All-day Event · Project Calendar

📆 12 Termine · 3 Kalender · Komplette Übersicht →

_🟦 Team Calendar  🟩 Project Calendar_
```

**After:**
```
*Wochenübersicht: KW 13 · 23. März — 29. März*

*Montag, 24. März*
────────────
09:00  Team Meeting 🟦
Ganztägig  All-day Event 🟩

12 Termine · 3 Kalender · Komplette Übersicht →

_🟦 Team Calendar  🟩 Project Calendar_
```

### 3. Weekly Schedule Timing Fix

#### Problem Analysis

`getCurrentWeekRange()` calculates Monday-Sunday of the current week. When run on Sunday (dayOfWeek = 0), the formula gives the previous Monday:

```javascript
// Current logic (incorrect)
startOfWeek.setUTCDate(now.getUTCDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1));
// Sunday: now - 0 + (-6) = 6 days ago = last Monday
```

#### Solution

Add special handling for Sunday to show the upcoming week:

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

#### Apply to Canvas Content

`renderCanvasContent()` has its own week calculation (lines 663-671). Apply the same logic:

```javascript
// In renderCanvasContent()
const now = new Date();
const dayOfWeek = now.getUTCDay();
const startOfWeek = new Date(now);

if (dayOfWeek === 0) {
  startOfWeek.setUTCDate(now.getUTCDate() + 1); // Tomorrow (Monday)
} else {
  startOfWeek.setUTCDate(now.getUTCDate() - dayOfWeek + 1); // This Monday
}
startOfWeek.setUTCHours(0, 0, 0, 0);

const endOfWeek = new Date(startOfWeek);
endOfWeek.setUTCDate(startOfWeek.getUTCDate() + 6);
endOfWeek.setUTCHours(23, 59, 59, 999);
```

#### Behavior Summary

| Day run | Range shown |
|---------|-------------|
| Monday | This Monday - This Sunday |
| Tuesday | This Monday - This Sunday |
| ... | ... |
| Saturday | This Monday - This Sunday |
| **Sunday** | **Next Monday - Next Sunday** |

### 4. Cron Schedule Optimization

#### Scheduled Digests Workflow

**Problem:** Runs every hour (`0 * * * *`) regardless of actual channel configurations.

**Solution:** Document that users must configure cron schedules to match their channel `digest_schedule` settings.

Update `.github/workflows/scheduled.yml`:

```yaml
name: Scheduled Digests

on:
  schedule:
    # IMPORTANT: Configure these cron schedules to match your channel digest_schedule settings
    # Example: If you have "sunday 18:00", use: - cron: '0 18 * * 0'
    # Example: If you have "weekdays 08:00", use: - cron: '0 8 * * 1-5'
    #
    # Uncomment and adjust these examples to match your config.json:
    - cron: '0 18 * * 0'  # Sunday 18:00 UTC
    - cron: '0 8 * * 1-5'  # Weekdays 08:00 UTC
  workflow_dispatch:
    ...
```

**Rationale:**
- Configuration is already hardcoded in config.json
- Cron schedules are hardcoded in workflow file
- Users maintain both files manually
- Future: could auto-generate workflow from config via UI (not in scope)

#### Change Detection Workflow

**Problem:** Runs every 6 hours, 24/7 (`0 */6 * * *`) including nighttime when no one monitors calendars.

**Solution:** Run every 2 hours during working hours only (6 AM - 6 PM UTC).

Update `.github/workflows/change-detection.yml`:

```yaml
on:
  schedule:
    - cron: '0 6-18/2 * * *'  # Every 2 hours between 06:00 and 18:00 UTC
```

**Schedule breakdown:**
- Runs at: 06:00, 08:00, 10:00, 12:00, 14:00, 16:00, 18:00 UTC
- 7 times per day instead of 4
- Skips: 20:00, 22:00, 00:00, 02:00, 04:00 (nighttime)

**Rationale:**
- More frequent during working hours (every 2h vs 6h) for better responsiveness
- Zero runs during night when changes are unlikely
- Users in Europe (UTC+1/+2): 6 AM UTC = 7-8 AM local (reasonable start)

### 5. Testing Strategy

#### Unit Tests

Update `test/formatting.test.js`:

1. **Emoji removal tests:**
   - Verify all-day events show "All-day" text instead of 📅
   - Verify footer has no 📆 emoji
   - Verify error notifications still have ⚠️

2. **Inline color indicator tests:**
   - Verify events show color emoji when calendarName present
   - Verify legend still renders at bottom
   - Verify change notifications unchanged

3. **HR rendering tests:**
   - Verify separator is exactly 12 characters
   - Verify followed by `\n`

4. **Footer link tests:**
   - Verify Slack link syntax when canvas_url provided: `<url|text>`
   - Verify plain text when canvas_url missing
   - Verify Canvas shows Nextcloud link when nextcloud_url provided

5. **Weekly range tests:**
   - Mock Date to various days of week
   - Verify Sunday returns next Monday-Sunday
   - Verify Monday-Saturday return current Monday-Sunday

#### Integration Tests

Manual testing workflow:

1. **Config validation:**
   - Test with missing optional fields (graceful degradation)
   - Test with invalid URLs (validation errors)
   - Test with valid complete config

2. **Message rendering:**
   - Run `--daily-digest --dry-run` and verify output format
   - Run `--weekly-digest --dry-run` on Sunday and verify date range
   - Verify clickable links work in actual Slack

3. **Cron schedules:**
   - Verify scheduled workflow only runs at configured times
   - Verify change detection runs 7 times per day (6 AM - 6 PM)

### 6. Migration Guide

#### For Existing Users

**Step 1:** Update config.json:

```json
{
  "workspace_id": "YOUR_WORKSPACE_ID",  // Required - find in Slack workspace settings
  "nextcloud_url": "https://your-nextcloud.example.com/apps/calendar",  // Optional
  "channels": [
    {
      "canvas_url": "https://yourworkspace.slack.com/docs/YOUR_WORKSPACE_ID/YOUR_CANVAS_ID"  // Optional
    }
  ]
}
```

**Step 2:** Update `.github/workflows/scheduled.yml`:

Replace the hourly cron with schedules matching your channel configurations.

**Step 3:** No action needed for change-detection.yml (automatically updated on next deployment)

**Step 4:** Test with dry-run:

```bash
node src/bot.js --weekly-digest --dry-run
node src/bot.js --daily-digest --dry-run
```

**Step 5:** Deploy and verify clickable links work in Slack.

#### Breaking Changes

None - all changes are backward compatible. Missing optional fields result in graceful degradation (features disabled, not errors).

### 7. Implementation Checklist

**Configuration:**
- [ ] Add `workspace_id` to config schema with validation
- [ ] Add `nextcloud_url` to config schema with optional validation
- [ ] Add `canvas_url` to channel schema with optional validation
- [ ] Update config.example.json with new fields and documentation
- [ ] Add validation warnings for missing optional fields

**Message Formatting:**
- [ ] Remove 📅 emoji from `formatEventTime()`, use translated "All-day" text
- [ ] Remove 📆 emoji from footer in `renderWeekView()`
- [ ] Remove 📆 emoji from footer in `renderDailyView()`
- [ ] Restore inline color indicators in `renderWeekView()` (line 253-254)
- [ ] Restore inline color indicators in `renderDailyView()` (line 618-619)
- [ ] Shorten HR separator to 12 chars in `renderWeekView()` (line 237)
- [ ] Shorten HR separator to 12 chars in `renderDailyView()` (line 602)
- [ ] Add clickable Canvas link to footer in `renderWeekView()`
- [ ] Add clickable Canvas link to footer in `renderDailyView()`
- [ ] Add clickable Nextcloud link to `renderCanvasContent()`
- [ ] Pass `canvas_url` from `postDigestForChannel()` to rendering functions

**Weekly Timing:**
- [ ] Fix `getCurrentWeekRange()` to handle Sunday correctly (line 380-392)
- [ ] Fix week calculation in `renderCanvasContent()` (line 663-671)
- [ ] Update tests for new Sunday behavior

**Cron Schedules:**
- [ ] Update `.github/workflows/scheduled.yml` with documented examples
- [ ] Update `.github/workflows/change-detection.yml` to `0 6-18/2 * * *`

**Testing:**
- [ ] Add emoji removal tests
- [ ] Add inline color indicator tests
- [ ] Add HR rendering tests
- [ ] Add footer link tests
- [ ] Add Sunday date range tests
- [ ] Manual integration testing with Slack

**Documentation:**
- [ ] Update README with new config fields
- [ ] Update setup guide with cron configuration instructions
- [ ] Add migration notes

### 8. Rollout Plan

**Phase 1: Development**
- Implement all changes
- Run full test suite
- Manual dry-run testing

**Phase 2: Deployment**
- Update config.json with new fields
- Update workflow files
- Deploy to production
- Monitor first scheduled run

**Phase 3: Verification**
- Verify weekly digest shows correct dates
- Verify clickable links work
- Verify change detection runs at correct times
- Check Slack message formatting on mobile and desktop

### 9. Success Metrics

- Weekly digest shows upcoming week when run on Sunday ✓
- All decorative emojis removed from messages ✓
- Calendar color indicators appear inline with events ✓
- Footer links are clickable and navigate correctly ✓
- HR separators render without breaking on mobile ✓
- Change detection runs only during working hours ✓
- Scheduled digest workflow aligned with channel configurations ✓

### 10. Future Enhancements

Not in scope for this update, but documented for future reference:

1. **Dynamic cron generation** - Auto-update workflow schedules when config changes
2. **Remove canvas_id** - After canvas_url is proven, remove redundant field
3. **Message vs Canvas differentiation** - Implement summary mode (Variant B from #3)
4. **Timezone-aware cron** - Convert user's local time to UTC for cron schedules
5. **Multiple Nextcloud instances** - Support per-channel or per-calendar Nextcloud URLs

## Appendix A: Files Modified

| File | Changes |
|------|---------|
| `src/config.js` | Add validation for workspace_id, canvas_url, nextcloud_url |
| `config.example.json` | Add new fields with documentation |
| `src/formatting.js` | Emoji removal, restore color indicators, fix HR, add links |
| `src/bot.js` | Fix getCurrentWeekRange(), pass canvas_url to renderers |
| `.github/workflows/scheduled.yml` | Document cron configuration |
| `.github/workflows/change-detection.yml` | Update cron to 6-18/2 |
| `test/formatting.test.js` | Add tests for all changes |
| `test/bot.test.js` | Add Sunday date range tests |

## Appendix B: Slack Link Syntax Reference

**Message to Canvas:**
```
<https://workspace.slack.com/docs/TWORKSPACE/FCANVASID|Link Text>
```

**Canvas to Nextcloud:**
```
<https://nextcloud.example.com/apps/calendar|Link Text>
```

Slack renders these as clickable blue links with custom text.
