# Scheduled Change Detection with Polling - Design Specification

**Date:** 2026-03-26
**Status:** Approved
**Target:** MVP Implementation

## 1. Overview & Purpose

### Problem

Without webhooks (due to Nextcloud 32 incompatibility), all change detection infrastructure (`diffEvents`, caching, debouncing) is currently unused. The hourly workflow only checks digest schedules, not calendar changes. Users have no visibility into calendar changes between scheduled digests.

### Solution

Implement scheduled polling for calendar changes. Every 6 hours (configurable), fetch all calendars, diff against cached state, and post bundled change notifications to Slack channels.

### Key Principles

- **Separation of concerns:** Digest workflow and change detection workflow are independent
- **Cache persistence:** Use orphan git branch (`cache-state`) for reliable state storage
- **Intelligent bundling:** Polling interval acts as natural debounce window
- **Graceful degradation:** Calendar fetch failures don't block other calendars
- **Respect user preferences:** Honor existing `notifications` config setting

## 2. Architecture

### Two Independent Workflows

**1. `.github/workflows/scheduled-digests.yml` (existing, unchanged)**
- Purpose: Post scheduled weekly/daily digests + update Canvas
- Trigger: Hourly cron (polling mechanism), but digests only post when a channel's `digest_schedule` or `daily_digest_schedule` matches current time
- Responsibilities: Digest rendering, Canvas updates

**2. `.github/workflows/change-detection.yml` (new)**
- Purpose: Detect calendar changes, post notifications
- Trigger: 6-hourly cron (default `0 */6 * * *`), user-configurable
- Responsibilities: Fetch calendars, diff against cache, post change notifications
- Never updates Canvas

**Why separate workflows:**
- Different failure modes (CalDAV timeout during change detection doesn't block digest)
- Independently tunable cadences
- Different cost profiles (users can reduce change detection frequency to save Actions minutes)
- Clear separation of concerns

### Cache Branch Architecture

**Branch:** `cache-state` (orphan branch, no history connection to main)

**Contents:** One JSON file per calendar (`<calendar-id>.json`)

**Structure per file:**
```json
{
  "events": [...],           // Calendar events array
  "last_error": "...",        // Last error message (if any)
  "error_notified_at": "...", // ISO timestamp of last error notification
  "updated_at": "..."         // ISO timestamp of last successful update
}
```

**Note:** Cache file mixes two concerns (events + error metadata) for simplicity. v2 consideration: separate these into distinct files.

**Persistence:** Force-pushed single commit on every run (no history accumulation)

**Lifecycle:** Orphaned files from removed calendars are not cleaned up automatically (harmless, manual cleanup documented)

**Access:** Read via file I/O in working directory, write via workflow git operations

### Component Responsibilities

- **Workflow YAML:** Git operations (checkout cache branch, commit, force push)
- **Bot code:** Pure file I/O (read/write JSON), business logic (fetch, diff, notify)
- **Cache files:** State storage only (no business logic)

## 3. Change Detection Flow

### Date Range Configuration

**Digest range:** Current week only (Monday-Sunday)

**Change detection range:** Current week + 4 weeks ahead (5 weeks total)

**Rationale:** Detect cancellations/changes to upcoming events that matter for planning. For example, if someone cancels a meeting two weeks from now, the change is detected immediately rather than waiting until that week begins.

**MVP Implementation:**
```javascript
// src/bot.js
const CHANGE_DETECTION_WEEKS_AHEAD = 4; // Hardcoded for MVP

// v2: Make configurable via config.json field: change_detection_weeks_ahead
```

### Step-by-Step Execution

**1. Git Setup (workflow)**
- Configure git user as `github-actions[bot]`
- Fetch `cache-state` branch (create orphan branch if doesn't exist)
- Checkout `cache-state` branch
- Set `CACHE_DIR` env var to current working directory

**2. For Each Calendar (bot code)**

**a. Load previous state:**
- Read `$CACHE_DIR/<calendar-id>.json`
- If file missing → **Baseline mode** (see below)
- If file exists → Parse previous events array

**b. Fetch current state:**
- Fetch events from CalDAV for current week + 4 weeks ahead (5 weeks total)
- On error → Skip calendar, post error notification (see error handling)

**c. Diff and notify:**
- Run `diffEvents(previous, current)`
- If no changes → Continue to next calendar
- If changes detected → Bundle all changes
- Route to subscribed channels
- Filter through `shouldNotifyNow()` (respects `notifications` setting)
- Post bundled notification if any changes pass filter
- Log if changes detected but notifications skipped

**d. Update cache:**
- Write current events to `$CACHE_DIR/<calendar-id>.json`
- Include error metadata if applicable

**3. Git Commit (workflow)**
- Stage all `*.json` files
- Check if staged changes exist: `git diff --staged --quiet`
- If changes: Commit with timestamp: `"chore: update calendar state cache 2026-03-26T14:00:00Z"`
- If no changes: Log `"No cache changes to commit"`
- Force push to `cache-state` branch

### Baseline Mode (Cache Miss)

When `<calendar-id>.json` doesn't exist:

1. Fetch current events from CalDAV (current week + 4 weeks ahead)
2. Write to `<calendar-id>.json`
3. **Skip diff/notification logic entirely**
4. Log: `"No previous state for <calendar-id> - establishing baseline"`
5. Next run will have state to diff against

**Why baseline mode matters:**
- First run ever: No spam of "new event" notifications for entire calendar
- Cache branch deleted: Re-establishes cleanly without false positives
- New calendar added to config: Silent initial sync

### Cache File Lifecycle

**Orphaned files from removed/renamed calendars:**

```javascript
// Note: cache files for removed/renamed calendars are not cleaned up automatically.
// They are harmless (never read) but accumulate in the cache-state branch over time.
// Manual cleanup: git checkout cache-state && git rm <old-calendar-id>.json && git commit
// Automated cleanup is a v2 consideration.
```

**Documentation:** Setup guide includes troubleshooting section with manual cleanup instructions.

## 4. Error Handling

### Calendar Fetch Failures

When CalDAV fetch fails for a calendar (timeout, auth error, network issue):

1. **Log error** with calendar ID and error message
2. **Skip calendar** - continue processing other calendars
3. **Post error notification** to configured `error_channel`
4. **Do not update cache** for failed calendar (preserve last known good state)

### Error Notification Suppression (MVP)

To avoid spamming `error_channel` with identical errors every 6 hours:

**Implementation:**
- Track error state in cache file: `{ "last_error": "...", "error_notified_at": "ISO timestamp", "events": [...] }`
- On first failure: Post error notification, record timestamp
- On consecutive failures: Suppress notification if same error within last 24 hours
- On recovery: Clear error tracking, log success

**Code comment:**
```javascript
// Cache file structure mixes two concerns for simplicity:
// - events: calendar state for diffing
// - last_error/error_notified_at: error suppression metadata
// v2 consideration: separate these into distinct files
```

### Partial Success Behavior

Example: 3 calendars configured, calendar 2 fails:

- Calendar 1: Success → diff, notify, update cache
- Calendar 2: **Failed** → skip, error notification, cache not updated
- Calendar 3: Success → diff, notify, update cache
- Workflow completes successfully (partial failure is not fatal)

### Workflow-Level Failures

If the entire workflow fails (git errors, config invalid, etc.):
- GitHub Actions marks run as failed (visible in Actions tab)
- No error notification posted (workflow didn't reach bot execution)
- User investigates via Actions run logs

## 5. Notification Routing and Filtering

### How Changes Are Routed to Channels

For each detected change (new/modified/deleted event):

**1. Find subscribed channels:**
- Check each channel's `calendars` array
- Channel subscribes if `calendars` includes the calendar ID

**2. Filter by notification settings:**
- Pass diff through `shouldNotifyNow(diff, channel)`
- Respects channel's `notifications` setting:
  - `"all"` → Post all changes
  - `"urgent_only"` → Only events within 24 hours
  - `"weekly"` / `"daily"` / `"disabled"` → Skip change notifications
- If filtered out: Log `"Change detected for calendar X but channel Y has notifications: 'disabled' - skipping"`

**3. Bundle and post:**
- All changes that pass filtering are bundled into one notification per channel
- Use `renderBundledNotification(diffs, locale, timezone)`
- Post to channel via `postMessage()`

### Debouncing Behavior

**Polling mode (this feature):**
- No explicit debounce window needed
- Polling interval acts as natural bundling window
- All changes between runs are detected in one diff and posted as one bundled notification
- `loadPendingNotifications()` / `savePendingNotifications()` are **not used**

**Webhook mode (future/legacy):**
- Uses existing 5-minute debounce window
- `loadPendingNotifications()` / `savePendingNotifications()` remain in code for future webhook support
- Polling flow bypasses this infrastructure entirely

### Example Notification Flow

Calendar "team-calendar" has 3 changes detected at 14:00:
- Event A: New meeting added (tomorrow at 10:00)
- Event B: Meeting time changed (next week)
- Event C: Meeting cancelled (next week)

**Channel 1** (`notifications: "all"`):
- Receives bundled notification: "3 calendar changes: 1 new, 1 modified, 1 cancelled"

**Channel 2** (`notifications: "urgent_only"`, Event A is tomorrow):
- Receives notification only for Event A (urgent)

**Channel 3** (`notifications: "disabled"`):
- Receives no notification, logged as skipped

## 6. Code Changes Required

### New Files

**1. `.github/workflows/change-detection.yml`**
- New workflow file for scheduled change detection
- Cron schedule: `0 */6 * * *` (6-hourly, user-configurable)
- Git operations: Setup cache branch, checkout, commit, force push
- Runs: `node src/bot.js --detect-changes` (supports `--dry-run` flag)
- Manual trigger support: `workflow_dispatch` with `dry_run` boolean input for testing
- Sets `CACHE_DIR` env var to working directory after cache branch checkout

**2. `src/cache.js` (new module)**

Functions:
- `loadCacheState(calendarId, cacheDir)` - Read calendar state from JSON file
- `saveCacheState(calendarId, events, errorState, cacheDir)` - Write state to JSON file

Cache file structure:
```javascript
{
  "events": [...],           // Calendar events array
  "last_error": "...",        // Last error message (if any)
  "error_notified_at": "...", // ISO timestamp of last error notification
  "updated_at": "..."         // ISO timestamp of last successful update
}
```

### Modified Files

**1. `src/bot.js`**
- Add new CLI mode: `--detect-changes` (supports `--dry-run`)
- New function: `runChangeDetection(config, dryRun)`
  - Implements the change detection flow (Section 3)
  - Uses `src/cache.js` for state management
  - Respects `CACHE_DIR` environment variable
  - When `dryRun=true`: Logs what would be posted, skips Slack API calls and cache commits
- New helper: `getChangeDetectionRange()` - Returns current week + 4 weeks
- Update CLI help text to include `--detect-changes`

**2. `src/diff.js`**

Deprecate GitHub Actions cache functions:
```javascript
// DEPRECATED: Originally designed for GitHub Actions cache approach.
// Superseded by src/cache.js which uses the cache-state git branch.
// Retained for reference. Safe to remove in a future cleanup pass.
function loadCachedEvents(calendarId) { ... }
function saveCachedEvents(calendarId, events) { ... }
```

Keep active (future webhook support):
- `loadPendingNotifications()`
- `savePendingNotifications()`
- `diffEvents()` (actively used)

**3. `src/slack.js`**
- Verify `postErrorNotification()` works for calendar fetch errors
- No other changes needed

**4. `docs/setup-guide.md`**

Add new sections:
- Document the change-detection workflow setup
- Explain polling frequency vs cost trade-offs
- Show how to edit workflow cron schedule to adjust frequency
- Add troubleshooting: cache branch cleanup for removed calendars
- Document baseline establishment behavior

### Unchanged Files

- `src/formatting.js` - `renderBundledNotification()` already exists
- `src/scheduler.js` - `shouldNotifyNow()` already exists
- `.github/workflows/scheduled-digests.yml` - digest workflow unchanged
- `src/config.js` - no config changes needed

## 7. Testing Strategy

### Unit Tests

**1. `test/cache.test.js` (new)**
- Test `loadCacheState()` with valid JSON, missing file, corrupt JSON
- Test `saveCacheState()` creates valid JSON structure
- Test error metadata handling (last_error, error_notified_at)
- Mock file system operations (no real git needed)

**2. `test/bot.test.js` (new)**
- Test `getChangeDetectionRange()` returns current week + 4 weeks
- Mock date to verify week boundary calculations
- Test pure baseline vs diff mode logic (if extracted to testable functions)
- **Scope:** Only pure functions, not full orchestration (no CalDAV/Slack/git mocking)

**3. Existing tests unchanged:**
- `test/diff.test.js` - `diffEvents()` logic still valid
- `test/formatting.test.js` - `renderBundledNotification()` already tested
- `test/scheduler.test.js` - `shouldNotifyNow()` already tested

### Integration Testing (Manual)

**1. First run (baseline establishment):**
- Delete `cache-state` branch if exists
- Trigger change-detection workflow manually via workflow_dispatch
- Verify: cache-state branch created, JSON files written, no notifications posted
- Check logs for "establishing baseline" messages

**2. Change detection:**
- Add/modify/delete event in Nextcloud
- Trigger workflow manually
- Verify: Bundled notification posted to correct channels
- Verify: Cache updated with new state

**3. Error handling:**
- Break CalDAV URL for one calendar
- Trigger workflow
- Verify: Error notification posted once, other calendars still process
- Trigger again (within 24h)
- Verify: Error notification suppressed
- Fix CalDAV URL
- Verify: Success logged, error state cleared

**4. Notification filtering:**
- Set channel `notifications: "disabled"`
- Make calendar change
- Verify: No notification posted, log shows "skipping"

**5. Date range coverage:**
- Add event 3 weeks from now in Nextcloud
- Trigger workflow
- Verify: Event is detected (confirms 4-week lookahead window works)
- Verify: Notification posted for the new event

## 8. Cost & Performance Considerations

### GitHub Actions Cost

**Default Configuration:**
- **Digest workflow:** Weekly (e.g., Sunday 18:00) = ~4 runs/month (negligible)
- **Change detection workflow:** 6-hourly (`0 */6 * * *`) = ~120 min/month (6% of free tier)
- **Combined default cost:** ~120 min/month — well within free tier for most users

**Increasing Change Detection Frequency:**

Users can edit `.github/workflows/change-detection.yml` to increase frequency to hourly (`0 * * * *`) for faster notifications, at the cost of ~720 min/month total.

### CalDAV Load

- 3 calendars × 4 runs/day (6-hourly) = 12 CalDAV requests/day
- 5-week date range per request (vs 1 week for digests)
- Very conservative rate - no Nextcloud load concerns expected
- Users running many bot instances should monitor their Nextcloud server

### Git Repository Growth

**Cache branch with force-push (single commit):**
- 3 calendars × ~10KB JSON each = ~30KB total
- Force-push replaces commit, no history accumulation
- Repository size impact: negligible (<100KB)

**Orphaned files from removed calendars:**
- Accumulate over time if not manually cleaned
- Each ~10KB, typically < 10 calendars lifetime = <100KB total
- Documented manual cleanup process

### Slack API Usage

- Change notifications: Variable (depends on calendar activity)
- Typical: 0-5 notifications/day for low-activity calendars
- Well within Slack's rate limits (1 req/sec per app)

### Performance Optimizations for Future Consideration

- **Smart polling:** Skip runs when no upcoming events exist
- **Conditional requests:** Use CalDAV ETags to detect changes without full fetch
- **Parallel CalDAV fetches:** Process calendars concurrently instead of sequentially

## 9. MVP Scope & Future Enhancements

### MVP Scope (This Feature)

**✅ Included:**
- Separate change-detection workflow with 6-hourly default
- Cache-state git branch for reliable state persistence
- 5-week lookahead window (current week + 4 weeks) for change detection
- Error notification suppression (avoid spamming on repeated failures)
- Intelligent bundling (polling interval as natural debounce window)
- Respect existing `notifications` channel settings
- Graceful cache miss handling (baseline establishment)
- Partial failure support (one calendar failure doesn't block others)
- Clear logging for filtered notifications

**❌ Deferred to v2:**
- Configurable lookahead window (`change_detection_weeks_ahead` config field)
- Automated cache branch cleanup for removed calendars
- Separate error/events files in cache branch
- Smart polling (skip when no activity expected)
- Parallel CalDAV fetches
- CalDAV ETag support for conditional requests

### Known Limitations

1. **Cache branch cleanup:** Orphaned files from removed/renamed calendars accumulate (manual cleanup documented)
2. **Concurrent workflow runs:** Last-write-wins if manual triggers overlap (rare, acceptable for MVP)
3. **Cold start on cache corruption:** If cache-state branch is deleted or corrupted, next run establishes baseline without notifications (expected behavior)
4. **No calendar rename detection:** Renaming a calendar ID in config creates a new baseline, old cache file orphaned

### Future Enhancement Paths

- **Webhook re-enablement:** Debounce infrastructure remains in code, ready to activate when Nextcloud webhooks become available
- **Calendar color matching:** Issue #5 (separate feature)
- **Smart scheduling:** Reduce polling frequency automatically based on calendar activity patterns
- **Multi-instance coordination:** If multiple bots monitor same calendars, coordinate cache writes

## 10. Implementation Checklist

- [ ] Create `src/cache.js` module with state management functions
- [ ] Add `--detect-changes` mode to `src/bot.js`
- [ ] Implement `runChangeDetection()` function
- [ ] Implement `getChangeDetectionRange()` helper (current week + 4 weeks)
- [ ] Add error notification suppression logic
- [ ] Deprecate old cache functions in `src/diff.js`
- [ ] Create `.github/workflows/change-detection.yml`
- [ ] Add git operations for cache branch management
- [ ] Write unit tests for `src/cache.js`
- [ ] Write unit tests for date range helpers
- [ ] Update `docs/setup-guide.md` with change detection documentation
- [ ] Add troubleshooting section for cache branch cleanup
- [ ] Manual integration testing (all 5 scenarios)
- [ ] Verify error suppression works correctly
- [ ] Verify 4-week lookahead detects future events
- [ ] Verify `--detect-changes --dry-run` works end-to-end without side effects
- [ ] Update README if needed with change detection feature
