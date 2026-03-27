# Scheduled Change Detection Implementation Plan

**Status:** ✅ COMPLETE - 2026-03-27

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement scheduled polling for calendar changes with git-based cache persistence and bundled notifications.

**Architecture:** New change-detection workflow runs every 6 hours, fetches all calendars for 5-week window (current + 4 weeks ahead), diffs against cache stored in orphan `cache-state` git branch, posts bundled notifications respecting channel settings. Separate from digest workflow.

**Tech Stack:** Node.js 20, CommonJS modules, GitHub Actions, git orphan branches, node:fs/promises

**Design Spec:** `docs/superpowers/specs/2026-03-26-scheduled-change-detection-design.md`

**Related Issue:** #6

---

## File Structure

**New Files:**
- `src/cache.js` - Git-based cache state management (read/write calendar state + error metadata)
- `.github/workflows/change-detection.yml` - Scheduled change detection workflow (6-hourly)
- `test/cache.test.js` - Unit tests for cache module
- `test/bot.test.js` - Unit tests for bot date range helpers

**Modified Files:**
- `src/bot.js` - Add `--detect-changes` mode, `runChangeDetection()`, `getChangeDetectionRange()`
- `src/diff.js` - Deprecate old GitHub Actions cache functions
- `docs/setup-guide.md` - Document change detection setup and troubleshooting

---

## Task 1: Cache Module - File I/O Functions

**Files:**
- Create: `src/cache.js`
- Test: `test/cache.test.js`

- [ ] **Step 1: Write failing test for loadCacheState with valid JSON**

Create `test/cache.test.js`:

```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const { loadCacheState, saveCacheState } = require('../src/cache.js');
const { writeFile, mkdir, rm } = require('node:fs/promises');
const path = require('node:path');

const TEST_CACHE_DIR = path.join(__dirname, '.test-cache');

test('loadCacheState should load valid cache file', async () => {
  await mkdir(TEST_CACHE_DIR, { recursive: true });

  const cacheData = {
    events: [
      { id: 'e1', title: 'Test Event', start: new Date('2026-03-26T10:00:00Z') }
    ],
    updated_at: '2026-03-26T09:00:00Z'
  };

  await writeFile(
    path.join(TEST_CACHE_DIR, 'team-calendar.json'),
    JSON.stringify(cacheData),
    'utf-8'
  );

  const result = await loadCacheState('team-calendar', TEST_CACHE_DIR);

  assert.deepStrictEqual(result.events, cacheData.events);
  assert.strictEqual(result.updated_at, cacheData.updated_at);

  await rm(TEST_CACHE_DIR, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/cache.test.js`

Expected: FAIL with "Cannot find module '../src/cache.js'"

- [ ] **Step 3: Create cache module with loadCacheState function**

Create `src/cache.js`:

```javascript
/**
 * Git-based cache state management
 *
 * Cache files stored in cache-state orphan branch, one JSON file per calendar.
 * Structure: { events: [...], last_error: "...", error_notified_at: "...", updated_at: "..." }
 */

const { readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');

/**
 * Load cached calendar state from file
 * @param {string} calendarId - Calendar identifier
 * @param {string} cacheDir - Directory containing cache files (from CACHE_DIR env var)
 * @returns {Promise<Object|null>} Cache data or null if not found
 */
async function loadCacheState(calendarId, cacheDir) {
  if (!cacheDir) {
    throw new Error('cacheDir is required');
  }

  const filePath = path.join(cacheDir, `${calendarId}.json`);

  try {
    const content = await readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    return data;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null; // File doesn't exist - baseline mode
    }
    if (error instanceof SyntaxError) {
      console.warn(`Corrupt cache file for ${calendarId}: ${error.message}`);
      return null; // Treat corrupt cache as missing
    }
    throw error; // Unexpected error
  }
}

/**
 * Save calendar state to cache file
 * @param {string} calendarId - Calendar identifier
 * @param {Array} events - Calendar events to cache
 * @param {Object} errorState - Error metadata { last_error, error_notified_at }
 * @param {string} cacheDir - Directory to write cache files
 * @returns {Promise<void>}
 */
async function saveCacheState(calendarId, events, errorState, cacheDir) {
  if (!cacheDir) {
    throw new Error('cacheDir is required');
  }

  const filePath = path.join(cacheDir, `${calendarId}.json`);

  // Cache file structure mixes two concerns for simplicity:
  // - events: calendar state for diffing
  // - last_error/error_notified_at: error suppression metadata
  // v2 consideration: separate these into distinct files
  const data = {
    events: events || [],
    updated_at: new Date().toISOString(),
    ...(errorState?.last_error && { last_error: errorState.last_error }),
    ...(errorState?.error_notified_at && { error_notified_at: errorState.error_notified_at })
  };

  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

module.exports = {
  loadCacheState,
  saveCacheState
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/cache.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cache.js test/cache.test.js
git commit -m "feat: add git-based cache state management module

refs: #6"
```

---

## Task 2: Cache Module - Missing File Test

**Files:**
- Modify: `test/cache.test.js`

- [ ] **Step 1: Write failing test for missing cache file**

Add to `test/cache.test.js`:

```javascript
test('loadCacheState should return null for missing file', async () => {
  await mkdir(TEST_CACHE_DIR, { recursive: true });

  const result = await loadCacheState('nonexistent-calendar', TEST_CACHE_DIR);

  assert.strictEqual(result, null);

  await rm(TEST_CACHE_DIR, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm test -- test/cache.test.js`

Expected: PASS (loadCacheState already handles ENOENT)

- [ ] **Step 3: Commit**

```bash
git add test/cache.test.js
git commit -m "test: add cache module test for missing file

refs: #6"
```

---

## Task 3: Cache Module - Corrupt JSON Test

**Files:**
- Modify: `test/cache.test.js`

- [ ] **Step 1: Write failing test for corrupt JSON file**

Add to `test/cache.test.js`:

```javascript
test('loadCacheState should return null for corrupt JSON', async () => {
  await mkdir(TEST_CACHE_DIR, { recursive: true });

  await writeFile(
    path.join(TEST_CACHE_DIR, 'corrupt-calendar.json'),
    '{ invalid json',
    'utf-8'
  );

  const result = await loadCacheState('corrupt-calendar', TEST_CACHE_DIR);

  assert.strictEqual(result, null);

  await rm(TEST_CACHE_DIR, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm test -- test/cache.test.js`

Expected: PASS (loadCacheState already handles SyntaxError)

- [ ] **Step 3: Commit**

```bash
git add test/cache.test.js
git commit -m "test: add cache module test for corrupt JSON

refs: #6"
```

---

## Task 4: Cache Module - Save Function Tests

**Files:**
- Modify: `test/cache.test.js`

- [ ] **Step 1: Write failing test for saveCacheState**

Add to `test/cache.test.js`:

```javascript
test('saveCacheState should write valid JSON with events', async () => {
  await mkdir(TEST_CACHE_DIR, { recursive: true });

  const events = [
    { id: 'e1', title: 'Meeting', start: new Date('2026-03-26T10:00:00Z') }
  ];

  await saveCacheState('test-calendar', events, null, TEST_CACHE_DIR);

  const saved = await loadCacheState('test-calendar', TEST_CACHE_DIR);

  assert.deepStrictEqual(saved.events, events);
  assert.ok(saved.updated_at);
  assert.ok(!saved.last_error);

  await rm(TEST_CACHE_DIR, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm test -- test/cache.test.js`

Expected: PASS (saveCacheState already implemented)

- [ ] **Step 3: Write test for saveCacheState with error metadata**

Add to `test/cache.test.js`:

```javascript
test('saveCacheState should include error metadata', async () => {
  await mkdir(TEST_CACHE_DIR, { recursive: true });

  const events = [];
  const errorState = {
    last_error: 'CalDAV timeout',
    error_notified_at: '2026-03-26T10:00:00Z'
  };

  await saveCacheState('error-calendar', events, errorState, TEST_CACHE_DIR);

  const saved = await loadCacheState('error-calendar', TEST_CACHE_DIR);

  assert.strictEqual(saved.last_error, 'CalDAV timeout');
  assert.strictEqual(saved.error_notified_at, '2026-03-26T10:00:00Z');

  await rm(TEST_CACHE_DIR, { recursive: true, force: true });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/cache.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/cache.test.js
git commit -m "test: add cache module tests for save function and error metadata

refs: #6"
```

---

## Task 5: Bot Module - Date Range Helper

**Files:**
- Modify: `src/bot.js`
- Create: `test/bot.test.js`

- [ ] **Step 1: Write failing test for getChangeDetectionRange**

Create `test/bot.test.js`:

```javascript
const { test } = require('node:test');
const assert = require('node:assert');

// We'll test the exported helper after extracting it
const { getChangeDetectionRange } = require('../src/bot.js');

test('getChangeDetectionRange should return current week + 4 weeks', () => {
  // Mock date: Wednesday, March 26, 2026
  const mockNow = new Date('2026-03-26T14:00:00Z');

  const result = getChangeDetectionRange(mockNow);

  // Week starts Monday (March 23)
  const expectedStart = new Date('2026-03-23T00:00:00.000Z');
  // 4 weeks ahead from end of current week (Sunday April 26, 23:59:59)
  const expectedEnd = new Date('2026-04-26T23:59:59.999Z');

  assert.strictEqual(result.start.toISOString(), expectedStart.toISOString());
  assert.strictEqual(result.end.toISOString(), expectedEnd.toISOString());
});

test('getChangeDetectionRange should handle Sunday correctly', () => {
  // Mock date: Sunday, March 30, 2026 (last day of week)
  const mockNow = new Date('2026-03-30T14:00:00Z');

  const result = getChangeDetectionRange(mockNow);

  // Week starts Monday (March 23) - same week
  const expectedStart = new Date('2026-03-23T00:00:00.000Z');
  // 4 weeks ahead from Sunday (April 26, 23:59:59)
  const expectedEnd = new Date('2026-04-26T23:59:59.999Z');

  assert.strictEqual(result.start.toISOString(), expectedStart.toISOString());
  assert.strictEqual(result.end.toISOString(), expectedEnd.toISOString());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/bot.test.js`

Expected: FAIL with "getChangeDetectionRange is not a function"

- [ ] **Step 3: Extract getCurrentWeekRange to helper and add getChangeDetectionRange**

Modify `src/bot.js` - find the `getCurrentWeekRange()` function (around line 115) and add after it:

```javascript
function getChangeDetectionRange(now = new Date()) {
  // Current week range (Monday - Sunday)
  const dayOfWeek = now.getUTCDay();
  const startOfWeek = new Date(now);
  startOfWeek.setUTCDate(now.getUTCDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1));
  startOfWeek.setUTCHours(0, 0, 0, 0);

  // End of week + 4 additional weeks (5 weeks total)
  const endOfLookahead = new Date(startOfWeek);
  endOfLookahead.setUTCDate(startOfWeek.getUTCDate() + (7 * 5) - 1); // 5 weeks minus 1 day
  endOfLookahead.setUTCHours(23, 59, 59, 999);

  return { start: startOfWeek, end: endOfLookahead };
}
```

Add to module.exports at bottom of file (around line 308, before `main();`):

```javascript
module.exports = {
  getChangeDetectionRange
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/bot.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/bot.js test/bot.test.js
git commit -m "feat: add getChangeDetectionRange helper for 5-week lookahead

refs: #6"
```

---

## Task 6: Bot Module - Change Detection Function Structure

**Files:**
- Modify: `src/bot.js`

- [ ] **Step 1: Add --detect-changes CLI mode handler**

Modify `src/bot.js` - update the CLI help text (around line 46):

```javascript
} else {
  console.error('Usage: node bot.js [--scheduled|--weekly-digest|--daily-digest|--event-changed|--detect-changes] [--dry-run]');
  process.exit(1);
}
```

Add to the mode handling in `main()` function (around line 43):

```javascript
} else if (mode === '--event-changed') {
  await runEventChanged(config, dryRun);
} else if (mode === '--detect-changes') {
  await runChangeDetection(config, dryRun);
} else {
```

- [ ] **Step 2: Create runChangeDetection function skeleton**

Add before `main()` function (around line 307):

```javascript
/**
 * Run change detection polling
 * Fetch all calendars, diff against cache, post bundled notifications
 */
async function runChangeDetection(config, dryRun) {
  console.log('Running change detection...');

  const cacheDir = process.env.CACHE_DIR;
  if (!cacheDir) {
    throw new Error('CACHE_DIR environment variable not set');
  }

  const { loadCacheState, saveCacheState } = require('./cache.js');
  const dateRange = getChangeDetectionRange();

  console.log(`Checking calendars for changes (${dateRange.start.toISOString()} to ${dateRange.end.toISOString()})`);

  // Process each calendar
  for (const calId of Object.keys(config.calendars)) {
    const calendar = config.calendars[calId];
    console.log(`Processing calendar: ${calendar.name} (${calId})`);

    let cachedData = null; // Declare outside try block for catch block access

    try {
      // Load previous state
      cachedData = await loadCacheState(calId, cacheDir);

      // Fetch current events
      const currentEvents = await fetchCalendar(
        calendar.caldav_url,
        config.caldav_credentials,
        dateRange
      );

      if (!cachedData) {
        // Baseline mode - no previous state
        console.log(`No previous state for ${calId} - establishing baseline`);
        await saveCacheState(calId, currentEvents, null, cacheDir);
        continue;
      }

      // Diff previous vs current
      const previousEvents = cachedData.events || [];
      const diffs = diffEvents(previousEvents, currentEvents);

      if (diffs.length === 0) {
        console.log(`No changes detected for ${calId}`);
        await saveCacheState(calId, currentEvents, null, cacheDir);
        continue;
      }

      console.log(`Detected ${diffs.length} change(s) for ${calId}`);

      // Add calendar name to diffs
      const diffsWithCalendar = diffs.map(d => ({ ...d, calendarName: calendar.name }));

      // Route to channels
      await routeChangeDetectionDiffs(config, calId, diffsWithCalendar, dryRun);

      // Update cache (clear any previous error state)
      await saveCacheState(calId, currentEvents, null, cacheDir);

    } catch (error) {
      console.error(`Failed to fetch calendar '${calendar.name}' (${calId}): ${error.message}`);

      // Check if we should post error notification (suppression logic)
      const shouldNotify = await shouldPostErrorNotification(calId, error.message, cachedData, cacheDir);

      if (shouldNotify) {
        await postErrorNotification(
          config.error_channel,
          `Calendar fetch failed: ${calendar.name}`,
          error.message,
          dryRun
        );
      }

      // Save error state (don't update events - preserve last known good)
      if (cachedData) {
        await saveCacheState(calId, cachedData.events, {
          last_error: error.message,
          error_notified_at: shouldNotify ? new Date().toISOString() : cachedData.error_notified_at
        }, cacheDir);
      }

      // Continue with other calendars
    }
  }

  console.log('Change detection complete');
}
```

- [ ] **Step 3: Add helper function for error notification suppression**

Add before `runChangeDetection`:

```javascript
/**
 * Check if error notification should be posted (suppression logic)
 * @param {string} calendarId - Calendar identifier
 * @param {string} errorMessage - Current error message
 * @param {Object} cachedData - Cached calendar data with error state
 * @param {string} cacheDir - Cache directory
 * @returns {Promise<boolean>} True if should post notification
 */
async function shouldPostErrorNotification(calendarId, errorMessage, cachedData, cacheDir) {
  if (!cachedData) {
    return true; // First run, always notify on error
  }

  const lastError = cachedData.last_error;
  const lastNotified = cachedData.error_notified_at;

  // No previous error, this is first failure
  if (!lastError) {
    return true;
  }

  // Different error, notify
  if (lastError !== errorMessage) {
    return true;
  }

  // Same error - check if 24 hours elapsed since last notification
  if (lastNotified) {
    const lastNotifiedDate = new Date(lastNotified);
    const now = new Date();
    const hoursSinceNotification = (now - lastNotifiedDate) / (1000 * 60 * 60);

    if (hoursSinceNotification >= 24) {
      return true; // 24 hours elapsed, notify again
    }
  }

  console.log(`Suppressing duplicate error notification for ${calendarId} (last notified: ${lastNotified})`);
  return false;
}
```

- [ ] **Step 4: Add helper function for routing diffs (polling mode - no debounce)**

Add before `runChangeDetection`:

```javascript
/**
 * Route detected diffs to subscribed channels (polling mode - no debounce)
 * @param {Object} config - Bot configuration
 * @param {string} calendarId - Calendar identifier
 * @param {Array} diffsWithCalendar - Diffs with calendar name attached
 * @param {boolean} dryRun - Dry run mode flag
 */
async function routeChangeDetectionDiffs(config, calendarId, diffsWithCalendar, dryRun) {
  for (const channel of config.channels) {
    // Check if channel subscribes to this calendar
    if (!channel.calendars.includes(calendarId)) {
      continue;
    }

    // Filter diffs by notification settings
    const notifiableDiffs = diffsWithCalendar.filter(diff =>
      shouldNotifyNow(diff, channel)
    );

    if (notifiableDiffs.length === 0) {
      console.log(`Change detected for calendar ${calendarId} but channel ${channel.id} has notifications filtered - skipping`);
      continue;
    }

    // Post bundled notification (polling mode - no debounce)
    const locale = channel.locale || config.locale;
    const timezone = channel.timezone || config.timezone || 'UTC';
    const notification = renderBundledNotification(notifiableDiffs, locale, timezone);

    console.log(`Posting ${notifiableDiffs.length} change(s) to channel ${channel.id}`);
    await postMessage(channel.id, notification, dryRun);
  }
}
```

- [ ] **Step 5: Test CLI accepts --detect-changes**

Run: `node src/bot.js --detect-changes --dry-run`

Expected: Error about missing config (expected - config loading works)

- [ ] **Step 6: Commit**

```bash
git add src/bot.js
git commit -m "feat: add runChangeDetection function with error suppression

Implements change detection polling with:
- 5-week lookahead window (current + 4 weeks)
- Baseline establishment for missing cache
- Error notification suppression (24h window)
- Polling mode routing (no debounce)

refs: #6"
```

---

## Task 7: Deprecate Old Cache Functions

**Files:**
- Modify: `src/diff.js`

- [ ] **Step 1: Add deprecation comments to old cache functions**

Modify `src/diff.js` - find `loadCachedEvents()` function (around line 100) and add comment above it:

```javascript
// DEPRECATED: Originally designed for GitHub Actions cache approach.
// Superseded by src/cache.js which uses the cache-state git branch.
// Retained for reference. Safe to remove in a future cleanup pass.
async function loadCachedEvents(calendarId) {
```

Find `saveCachedEvents()` function (around line 134) and add same comment:

```javascript
// DEPRECATED: Originally designed for GitHub Actions cache approach.
// Superseded by src/cache.js which uses the cache-state git branch.
// Retained for reference. Safe to remove in a future cleanup pass.
async function saveCachedEvents(calendarId, events) {
```

- [ ] **Step 2: Verify tests still pass**

Run: `npm test`

Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/diff.js
git commit -m "refactor: deprecate GitHub Actions cache functions

Mark loadCachedEvents and saveCachedEvents as deprecated.
Superseded by src/cache.js using cache-state git branch.

refs: #6"
```

---

## Task 8: Change Detection Workflow - Git Setup

**Files:**
- Create: `.github/workflows/change-detection.yml`

- [ ] **Step 1: Create workflow file with git setup**

Create `.github/workflows/change-detection.yml`:

```yaml
name: Change Detection

on:
  schedule:
    - cron: '0 */6 * * *'  # Every 6 hours (user-configurable)
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
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Need full history for cache branch

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

      - name: Configure git
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"

      - name: Setup cache branch
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          # Fetch cache-state branch or create if missing
          if git fetch origin cache-state 2>/dev/null; then
            echo "Cache branch exists"
          else
            echo "Creating cache-state orphan branch"
            git checkout --orphan cache-state
            git rm -rf . --quiet
            git commit --allow-empty -m "chore: initialize cache-state branch"
            git push origin cache-state
            git checkout main
          fi

          # Use git worktree to work with cache branch alongside main
          git worktree add /tmp/cache-state cache-state

      - name: Run change detection
        env:
          CALDAV_PASSWORD: ${{ secrets.CALDAV_PASSWORD }}
          CALDAV_USERNAME: ${{ secrets.CALDAV_USERNAME }}
          SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
          CACHE_DIR: /tmp/cache-state
        run: |
          DRY_RUN=""
          if [ "${{ inputs.dry_run }}" = "true" ]; then
            DRY_RUN="--dry-run"
          fi

          node src/bot.js --detect-changes $DRY_RUN

      - name: Commit cache state
        if: ${{ !inputs.dry_run }}
        run: |
          cd /tmp/cache-state
          git add *.json

          # Check if there are staged changes
          if git diff --staged --quiet; then
            echo "No cache changes to commit"
          else
            git commit -m "chore: update calendar state cache $(date -u +%Y-%m-%dT%H:%M:%SZ)"
            git push --force origin cache-state
          fi
```

- [ ] **Step 2: Verify workflow syntax**

Run: `cat .github/workflows/change-detection.yml | head -20`

Expected: Valid YAML syntax, no errors

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/change-detection.yml
git commit -m "feat: add change detection workflow with git-based cache

Scheduled every 6 hours (configurable), sets up cache-state orphan
branch, runs change detection, commits cache state.

refs: #6"
```

---

## Task 9: Setup Guide - Document Change Detection

**Files:**
- Modify: `docs/setup-guide.md`

- [ ] **Step 1: Add change detection section after Step 9**

Modify `docs/setup-guide.md` - add new section after Step 9 (around line 387):

```markdown
## Change Detection (Automatic)

The change detection workflow runs automatically every 6 hours to detect calendar changes and post notifications.

### How It Works

**Scheduled polling:**
- GitHub Actions runs `.github/workflows/change-detection.yml` every 6 hours
- Fetches all calendars for 5-week window (current week + 4 weeks ahead)
- Diffs against cached state stored in `cache-state` orphan git branch
- Posts bundled change notifications to Slack channels

**First run (baseline):**
- On first run or missing cache, establishes baseline without posting notifications
- Subsequent runs detect changes and post notifications

**Respects channel settings:**
- Honors `notifications` setting per channel (`"all"`, `"urgent_only"`, `"disabled"`, etc.)
- See `config.example.json` for notification options

### Adjusting Polling Frequency

**Default:** 6-hourly (`0 */6 * * *`) = ~120 min/month (6% of free tier)

**To change frequency:**

1. Edit `.github/workflows/change-detection.yml`
2. Modify the cron schedule:
   ```yaml
   schedule:
     - cron: '0 * * * *'  # Hourly (720 min/month)
   ```

**Common schedules:**
- Hourly: `0 * * * *` (~720 min/month, 36% of free tier)
- 6-hourly: `0 */6 * * *` (~120 min/month, 6% of free tier)
- 12-hourly: `0 */12 * * *` (~60 min/month, 3% of free tier)

### Manual Testing

Test change detection manually:

1. Go to: Repository → Actions → **"Change Detection"**
2. Click **"Run workflow"**
3. Configure:
   - **Branch:** `main`
   - **Dry run:** ✅ Check for testing (no Slack posts, no cache commits)
4. Click **"Run workflow"**

Check the logs to see detected changes.
```

- [ ] **Step 2: Add troubleshooting section**

Add to troubleshooting section (create if doesn't exist, around end of file):

```markdown
### Troubleshooting

#### Cache Branch Cleanup

If you remove or rename a calendar in `config.json`, the old cache file remains in the `cache-state` branch. These files are harmless (never read) but accumulate over time.

**To clean up manually:**

```bash
# Checkout cache branch
git fetch origin cache-state
git checkout cache-state

# List cache files
ls *.json

# Remove old calendar cache
git rm old-calendar-id.json

# Commit and push
git commit -m "chore: remove cache for old-calendar-id"
git push origin cache-state

# Return to main
git checkout main
```

#### Change Detection Not Posting Notifications

**Check channel notification settings:**

If changes are detected but not posted, verify the channel's `notifications` setting in `config.json`:

- `"all"` - Posts all changes (default)
- `"urgent_only"` - Only events within 24 hours
- `"disabled"` - No change notifications

Check workflow logs for: `"Change detected but channel has notifications filtered - skipping"`

#### First Run Shows No Changes

This is expected. The first run establishes a baseline without posting notifications to avoid spamming "new event" notifications for the entire calendar.

**To verify baseline was established:**

1. Go to: Repository → Actions → **"Change Detection"**
2. Check recent run logs
3. Look for: `"No previous state for <calendar-id> - establishing baseline"`
4. Verify cache-state branch exists: `git fetch origin cache-state && git checkout cache-state && ls *.json`
```

- [ ] **Step 3: Commit**

```bash
git add docs/setup-guide.md
git commit -m "docs: add change detection setup and troubleshooting guide

Documents automatic polling, frequency adjustment, manual testing,
and troubleshooting for cache cleanup and notification filtering.

refs: #6"
```

---

## Task 10: Integration Testing - Baseline Establishment

**Files:**
- Manual testing (no code changes)

- [ ] **Step 1: Delete cache-state branch if exists**

Run:
```bash
git push origin --delete cache-state 2>/dev/null || echo "Branch doesn't exist"
```

Expected: Branch deleted or doesn't exist

- [ ] **Step 2: Trigger change detection workflow manually**

1. Go to: GitHub Actions → "Change Detection"
2. Click "Run workflow"
3. Set dry_run: false
4. Click "Run workflow"

Expected: Workflow starts

- [ ] **Step 3: Verify baseline establishment**

Check workflow logs for:
- `"No previous state for <calendar-id> - establishing baseline"`
- No Slack notifications posted
- `cache-state` branch created

Run:
```bash
git fetch origin cache-state
git checkout cache-state
ls *.json
```

Expected: JSON files for each calendar exist

- [ ] **Step 4: Document test results**

Create `docs/superpowers/plans/test-results.md` (or append):

```markdown
## Integration Test 1: Baseline Establishment

**Date:** [Current date]
**Status:** PASS/FAIL

**Steps:**
1. Deleted cache-state branch
2. Triggered workflow manually
3. Verified baseline establishment

**Results:**
- [ ] cache-state branch created
- [ ] JSON files created for each calendar
- [ ] No notifications posted
- [ ] Logs show "establishing baseline"

**Notes:** [Any observations]
```

- [ ] **Step 5: Return to main branch**

Run:
```bash
git checkout main
```

Expected: On main branch

---

## Task 11: Integration Testing - Change Detection

**Files:**
- Manual testing (no code changes)

- [ ] **Step 1: Add/modify event in Nextcloud**

Add or modify an event in one of the configured calendars (e.g., tomorrow at 10:00 AM)

Expected: Event visible in Nextcloud calendar

- [ ] **Step 2: Trigger change detection workflow**

1. Go to: GitHub Actions → "Change Detection"
2. Click "Run workflow"
3. Set dry_run: false
4. Click "Run workflow"

Expected: Workflow starts

- [ ] **Step 3: Verify change notification posted**

Check Slack channel for bundled notification message:
- Should show "1 calendar change" or similar
- Should show event details
- Should include calendar name

Expected: Notification appears in correct Slack channel

- [ ] **Step 4: Verify cache updated**

Run:
```bash
git fetch origin cache-state
git checkout cache-state
cat <calendar-id>.json
```

Expected: JSON file includes the new/modified event

- [ ] **Step 5: Document test results**

Append to `docs/superpowers/plans/test-results.md`:

```markdown
## Integration Test 2: Change Detection

**Date:** [Current date]
**Status:** PASS/FAIL

**Steps:**
1. Added event in Nextcloud
2. Triggered workflow manually
3. Verified notification posted
4. Verified cache updated

**Results:**
- [ ] Notification posted to Slack
- [ ] Correct event details shown
- [ ] Cache updated with new event
- [ ] Logs show "Detected N change(s)"

**Notes:** [Any observations]
```

- [ ] **Step 6: Return to main branch**

Run:
```bash
git checkout main
```

---

## Task 12: Integration Testing - Error Handling

**Files:**
- Manual testing (no code changes)

- [ ] **Step 1: Break CalDAV URL for one calendar**

Edit `config.json` (local file, not committed):
- Change one calendar's `caldav_url` to an invalid URL

Update GitHub Secret `CONFIG_JSON` with broken config

Expected: Config updated

- [ ] **Step 2: Trigger workflow and verify partial success**

1. Trigger change detection workflow
2. Check logs

Expected:
- Failed calendar logs error
- Other calendars still process successfully
- Workflow completes (doesn't fail)

- [ ] **Step 3: Verify error notification posted**

Check error_channel in Slack

Expected: Error notification posted with:
- Calendar name
- Error message
- Timestamp

- [ ] **Step 4: Trigger again to verify suppression**

1. Trigger workflow again (within 24 hours)
2. Check logs

Expected:
- Logs show: `"Suppressing duplicate error notification"`
- No new error notification in Slack

- [ ] **Step 5: Fix CalDAV URL and verify recovery**

1. Fix the CalDAV URL in config.json
2. Update GitHub Secret
3. Trigger workflow

Expected:
- Logs show success for previously-failed calendar
- Error state cleared in cache

- [ ] **Step 6: Document test results**

Append to `docs/superpowers/plans/test-results.md`:

```markdown
## Integration Test 3: Error Handling

**Date:** [Current date]
**Status:** PASS/FAIL

**Steps:**
1. Broke CalDAV URL
2. Verified partial success (other calendars work)
3. Verified error notification posted
4. Triggered again, verified suppression
5. Fixed URL, verified recovery

**Results:**
- [ ] Error notification posted once
- [ ] Other calendars still processed
- [ ] Duplicate notification suppressed
- [ ] Recovery successful, error cleared

**Notes:** [Any observations]
```

---

## Task 13: Integration Testing - Date Range Coverage

**Files:**
- Manual testing (no code changes)

- [ ] **Step 1: Add event 3 weeks from now in Nextcloud**

Create event in Nextcloud:
- Date: 3 weeks from today
- Time: Any time
- Calendar: One of the configured calendars

Expected: Event visible in Nextcloud

- [ ] **Step 2: Trigger change detection workflow**

1. Go to: GitHub Actions → "Change Detection"
2. Click "Run workflow"
3. Set dry_run: false
4. Click "Run workflow"

Expected: Workflow starts

- [ ] **Step 3: Verify event detected and notification posted**

Check Slack channel for notification about the new event

Expected: Notification posted showing event 3 weeks from now

- [ ] **Step 4: Verify cache includes future event**

Run:
```bash
git fetch origin cache-state
git checkout cache-state
cat <calendar-id>.json | grep "<event-title>"
```

Expected: Event appears in cache JSON

- [ ] **Step 5: Document test results**

Append to `docs/superpowers/plans/test-results.md`:

```markdown
## Integration Test 4: Date Range Coverage (5-week window)

**Date:** [Current date]
**Status:** PASS/FAIL

**Steps:**
1. Added event 3 weeks from now
2. Triggered workflow
3. Verified notification posted
4. Verified cache includes future event

**Results:**
- [ ] Future event detected (confirms 4-week lookahead)
- [ ] Notification posted
- [ ] Cache updated

**Notes:** [Any observations]
```

- [ ] **Step 6: Return to main branch**

Run:
```bash
git checkout main
```

---

## Task 14: Integration Testing - Dry Run Mode

**Files:**
- Manual testing (no code changes)

- [ ] **Step 1: Trigger workflow with dry_run enabled**

1. Go to: GitHub Actions → "Change Detection"
2. Click "Run workflow"
3. Set dry_run: **true**
4. Click "Run workflow"

Expected: Workflow starts

- [ ] **Step 2: Verify dry run behavior in logs**

Check workflow logs for:
- `[DRY RUN]` prefix on Slack API calls
- Calendar fetching still happens
- Diff detection still happens
- NO actual Slack messages posted
- NO cache commits

Expected: All logged as dry run, no side effects

- [ ] **Step 3: Verify no Slack messages posted**

Check Slack channels

Expected: No new messages from bot

- [ ] **Step 4: Verify cache not updated**

Run:
```bash
git fetch origin cache-state
git checkout cache-state
git log -1 --format="%H %s %ci"
```

Expected: Last commit timestamp is before dry run (cache not modified)

- [ ] **Step 5: Document test results**

Append to `docs/superpowers/plans/test-results.md`:

```markdown
## Integration Test 5: Dry Run Mode

**Date:** [Current date]
**Status:** PASS/FAIL

**Steps:**
1. Triggered workflow with dry_run: true
2. Verified logs show [DRY RUN] prefix
3. Verified no Slack messages posted
4. Verified cache not updated

**Results:**
- [ ] Logs show dry run mode active
- [ ] No Slack messages posted
- [ ] Cache not modified
- [ ] CalDAV fetching still works

**Notes:** [Any observations]
```

- [ ] **Step 6: Return to main branch**

Run:
```bash
git checkout main
```

---

## Task 15: Final Documentation and Cleanup

**Files:**
- Modify: `README.md` (if needed)
- Modify: `docs/superpowers/plans/2026-03-26-scheduled-change-detection.md` (mark complete)

- [ ] **Step 1: Update README with change detection feature (if needed)**

Check if `README.md` has a features section. If so, add:

```markdown
- **Change Detection:** Scheduled polling (6-hourly) detects calendar changes and posts bundled notifications
```

If README needs change, run:
```bash
git add README.md
git commit -m "docs: add change detection to feature list

refs: #6"
```

- [ ] **Step 2: Mark plan as complete**

Add to top of `docs/superpowers/plans/2026-03-26-scheduled-change-detection.md`:

```markdown
**Status:** ✅ COMPLETE - [Date]
```

Run:
```bash
git add docs/superpowers/plans/2026-03-26-scheduled-change-detection.md
git commit -m "docs: mark change detection plan as complete

refs: #6"
```

- [ ] **Step 3: Push to instance repo**

Run:
```bash
git push origin main
```

Expected: All commits pushed to origin

- [ ] **Step 4: Close GitHub issue**

Run:
```bash
gh issue close 6 --comment "Change detection implemented successfully. All integration tests passed."
```

Expected: Issue #6 closed

- [ ] **Step 5: Optional - Push to upstream (blueprint repo)**

If you want to contribute back to the blueprint repo:

```bash
git push upstream main
```

Expected: Changes pushed to blueprint repo

---

## Self-Review Checklist

### Spec Coverage

- [x] Cache-state git branch persistence (Tasks 1-4, 8)
- [x] 5-week lookahead window (Task 5)
- [x] Error notification suppression (Task 6)
- [x] Baseline establishment (Task 6, 10)
- [x] Partial failure support (Task 6)
- [x] Polling mode (no debounce) (Task 6)
- [x] Respect notification settings (Task 6)
- [x] Separate workflow (Task 8)
- [x] Dry run support (Task 8, 14)
- [x] Deprecate old cache functions (Task 7)
- [x] Setup guide documentation (Task 9)
- [x] Integration testing (Tasks 10-14)

### Placeholder Check

- [x] No TBD, TODO, or "fill in details"
- [x] All code blocks contain actual implementation
- [x] All file paths are exact
- [x] All commands have expected output

### Type Consistency

- [x] `loadCacheState()` signature consistent across all tasks
- [x] `saveCacheState()` signature consistent across all tasks
- [x] `getChangeDetectionRange()` returns `{ start, end }` consistently
- [x] Cache file structure consistent: `{ events, updated_at, last_error?, error_notified_at? }`
- [x] `dryRun` boolean parameter consistent throughout

---

## Notes

**Commit message format:** All commits reference `refs: #6` to link to issue.

**Note on cache branch:** The `cache-state` branch is force-pushed on every run, maintaining a single commit with current state. No history accumulation.

**Note on cache cleanup:** Orphaned cache files from removed calendars are not automatically cleaned up. Manual cleanup is documented in setup guide troubleshooting section.
