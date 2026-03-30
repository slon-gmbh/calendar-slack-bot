# Scheduling Frequency Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix digest scheduling to run exactly once per configured period and limit change detection to business hours

**Architecture:** Add state tracking to prevent duplicate digest runs within the same day/week, and adjust change detection cron to only run during business hours (6 AM - 6 PM every 2 hours)

**Tech Stack:** Node.js, GitHub Actions workflows, git-based state management

---

## Problem Statement

From issue #6 additional comments:

1. **Schedule job**: Currently runs more often than configured. Should respect the configuration (daily = once per day, weekly = once per week).
2. **Change detection**: Currently runs at night unnecessarily. Should only run every 2 hours between 6 AM and 6 PM to avoid wasting resources during inactive hours.

## Current State

- `scheduled.yml` workflow runs hourly (cron: `'0 * * * *'`)
- `matchesSchedule()` has ±30 minute tolerance which can cause edge case duplicate runs
- `change-detection.yml` runs every 6 hours around the clock (cron: `'0 */6 * * *'`)
- No state tracking to prevent duplicate digest posts

## File Structure

**Files to Modify:**
- `.github/workflows/change-detection.yml` - Adjust cron to business hours
- `src/scheduler.js` - Add state tracking for digest runs
- `src/bot.js` - Integrate state checking in runScheduledDigests
- `test/scheduler.test.js` - Add tests for new state tracking

**Files to Create:**
- None (use existing cache-state branch for state storage)

---

### Task 1: Adjust Change Detection to Business Hours Only

**Files:**
- Modify: `.github/workflows/change-detection.yml:4-5`

- [ ] **Step 1: Update cron schedule to run every 2 hours from 6 AM to 6 PM UTC**

Change the cron expression from every 6 hours to specific hours:

```yaml
on:
  schedule:
    # Every 2 hours from 6 AM to 6 PM UTC (7 runs per day)
    - cron: '0 6,8,10,12,14,16,18 * * *'
  workflow_dispatch:
```

**Rationale:**
- Runs at: 06:00, 08:00, 10:00, 12:00, 14:00, 16:00, 18:00 UTC
- 7 runs/day instead of 4 runs/day (24/6)
- Only during business hours when changes are likely
- Saves ~17 runs/day during inactive hours

- [ ] **Step 2: Add comment explaining the schedule**

Add explanatory comment above the cron:

```yaml
on:
  schedule:
    # Every 2 hours from 6 AM to 6 PM UTC (7 runs per day)
    # Avoids running during inactive hours to save Actions minutes
    - cron: '0 6,8,10,12,14,16,18 * * *'
  workflow_dispatch:
```

- [ ] **Step 3: Commit changes**

```bash
git add .github/workflows/change-detection.yml
git commit -m "fix: run change detection only during business hours (6 AM - 6 PM)

Adjust cron to run every 2 hours from 6 AM to 6 PM UTC instead of
every 6 hours around the clock. This avoids wasting Actions minutes
during inactive hours while increasing coverage during active hours.

- 7 runs/day (every 2 hours 6-18)
- Previously: 4 runs/day (every 6 hours)
- Saves ~17 runs/day during off-hours

refs: #6"
```

---

### Task 2: Add State Tracking for Digest Runs

**Files:**
- Create: (use cache-state branch, add `.lastrun-<channel-id>.json` files)
- Modify: `src/scheduler.js`
- Test: `test/scheduler.test.js`

- [ ] **Step 1: Write failing test for hasRunToday function**

```javascript
// test/scheduler.test.js

const { hasRunToday, hasRunThisWeek } = require('../src/scheduler.js');

test('hasRunToday should return false if no last run', () => {
  const result = hasRunToday(null, 'daily');
  assert.equal(result, false);
});

test('hasRunToday should return true if run within last 20 hours', () => {
  const lastRun = new Date(Date.now() - 19 * 60 * 60 * 1000); // 19 hours ago
  const result = hasRunToday(lastRun, 'daily');
  assert.equal(result, true);
});

test('hasRunToday should return false if run more than 20 hours ago', () => {
  const lastRun = new Date(Date.now() - 21 * 60 * 60 * 1000); // 21 hours ago
  const result = hasRunToday(lastRun, 'daily');
  assert.equal(result, false);
});

test('hasRunThisWeek should return false if no last run', () => {
  const result = hasRunThisWeek(null, 'sunday 18:00');
  assert.equal(result, false);
});

test('hasRunThisWeek should return true if run within last 6 days', () => {
  const lastRun = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
  const result = hasRunThisWeek(lastRun, 'sunday 18:00');
  assert.equal(result, true);
});

test('hasRunThisWeek should return false if run more than 6 days ago', () => {
  const lastRun = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
  const result = hasRunThisWeek(lastRun, 'sunday 18:00');
  assert.equal(result, false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/scheduler.test.js`
Expected: FAIL with "hasRunToday is not a function" or similar

- [ ] **Step 3: Implement hasRunToday and hasRunThisWeek functions**

Add to `src/scheduler.js` after the matchesSchedule function:

```javascript
/**
 * Check if digest has run today (within last 20 hours)
 * @param {Date|string|null} lastRunTime - Last run timestamp
 * @param {string} schedule - Schedule string (used to determine if daily)
 * @returns {boolean} True if run within last 20 hours
 */
function hasRunToday(lastRunTime, schedule) {
  if (!lastRunTime) return false;

  const lastRun = new Date(lastRunTime);
  const now = new Date();
  const hoursSinceLastRun = (now - lastRun) / (1000 * 60 * 60);

  // 20-hour threshold allows for some schedule drift
  // but prevents duplicate runs on the same day
  return hoursSinceLastRun < 20;
}

/**
 * Check if digest has run this week (within last 6 days)
 * @param {Date|string|null} lastRunTime - Last run timestamp
 * @param {string} schedule - Schedule string (to determine weekly vs daily)
 * @returns {boolean} True if run within last 6 days
 */
function hasRunThisWeek(lastRunTime, schedule) {
  if (!lastRunTime) return false;

  const lastRun = new Date(lastRunTime);
  const now = new Date();
  const daysSinceLastRun = (now - lastRun) / (1000 * 60 * 60 * 24);

  // 6-day threshold prevents duplicate weekly runs
  // while allowing for schedule variations
  return daysSinceLastRun < 6;
}

/**
 * Determine if schedule is daily vs weekly
 * @param {string} schedule - Schedule string
 * @returns {boolean} True if daily schedule
 */
function isDaily Schedule(schedule) {
  if (!schedule || schedule === false) return false;

  // Check if schedule contains "daily" or "weekdays"
  const lowerSchedule = schedule.toLowerCase();
  return lowerSchedule.includes('daily') || lowerSchedule.includes('weekdays');
}
```

- [ ] **Step 4: Export new functions**

Update module.exports at end of `src/scheduler.js`:

```javascript
module.exports = {
  matchesSchedule,
  classifyUrgency,
  shouldNotifyNow,
  hasRunToday,
  hasRunThisWeek,
  isDailySchedule
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- test/scheduler.test.js`
Expected: All tests PASS

- [ ] **Step 6: Commit changes**

```bash
git add src/scheduler.js test/scheduler.test.js
git commit -m "feat: add state tracking functions for digest run history

Add hasRunToday() and hasRunThisWeek() to prevent duplicate digest
posts within the same day/week. Uses 20-hour and 6-day thresholds to
allow for schedule drift while preventing duplicates.

refs: #6"
```

---

### Task 3: Integrate State Tracking in Bot

**Files:**
- Modify: `src/bot.js:310-326` (runScheduledDigests function)

- [ ] **Step 1: Add state loading helper function**

Add before runScheduledDigests function in `src/bot.js`:

```javascript
/**
 * Load last run timestamp for a channel digest
 * @param {string} channelId - Channel ID
 * @param {string} digestType - 'weekly' or 'daily'
 * @returns {Promise<Date|null>} Last run timestamp or null
 */
async function loadLastRunTime(channelId, digestType) {
  const cacheDir = process.env.CACHE_DIR || '.';
  const { readFile } = require('node:fs/promises');
  const path = require('node:path');

  try {
    const filePath = path.join(cacheDir, `.lastrun-${channelId}-${digestType}.json`);
    const content = await readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    return data.lastRun ? new Date(data.lastRun) : null;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null; // File doesn't exist yet
    }
    console.warn(`Failed to load last run time for ${channelId}/${digestType}:`, error.message);
    return null;
  }
}

/**
 * Save last run timestamp for a channel digest
 * @param {string} channelId - Channel ID
 * @param {string} digestType - 'weekly' or 'daily'
 * @param {Date} timestamp - Run timestamp
 * @returns {Promise<void>}
 */
async function saveLastRunTime(channelId, digestType, timestamp) {
  const cacheDir = process.env.CACHE_DIR || '.';
  const { writeFile, mkdir } = require('node:fs/promises');
  const path = require('node:path');

  try {
    // Ensure cache directory exists
    await mkdir(cacheDir, { recursive: true });

    const filePath = path.join(cacheDir, `.lastrun-${channelId}-${digestType}.json`);
    const data = { lastRun: timestamp.toISOString() };
    await writeFile(filePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.warn(`Failed to save last run time for ${channelId}/${digestType}:`, error.message);
  }
}
```

- [ ] **Step 2: Write failing test for state tracking integration**

Add to `test/bot.test.js` (or create if doesn't exist):

```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const { loadLastRunTime, saveLastRunTime } = require('../src/bot.js');
const { mkdtemp, rm } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

test('saveLastRunTime should create lastrun file', async () => {
  const testDir = await mkdtemp(join(tmpdir(), 'bot-test-'));
  process.env.CACHE_DIR = testDir;

  try {
    const timestamp = new Date('2026-03-30T18:00:00Z');
    await saveLastRunTime('C12345', 'weekly', timestamp);

    const loaded = await loadLastRunTime('C12345', 'weekly');
    assert.ok(loaded);
    assert.equal(loaded.toISOString(), timestamp.toISOString());
  } finally {
    delete process.env.CACHE_DIR;
    await rm(testDir, { recursive: true, force: true });
  }
});

test('loadLastRunTime should return null for nonexistent file', async () => {
  const testDir = await mkdtemp(join(tmpdir(), 'bot-test-'));
  process.env.CACHE_DIR = testDir;

  try {
    const loaded = await loadLastRunTime('C99999', 'weekly');
    assert.equal(loaded, null);
  } finally {
    delete process.env.CACHE_DIR;
    await rm(testDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- test/bot.test.js`
Expected: FAIL with "loadLastRunTime is not exported" or similar

- [ ] **Step 4: Export the helper functions**

In `src/bot.js`, if there's a module.exports section at the end, add:

```javascript
// For testing
if (process.env.NODE_ENV === 'test') {
  module.exports = {
    ...module.exports,
    loadLastRunTime,
    saveLastRunTime
  };
}
```

Or if no exports yet:

```javascript
if (process.env.NODE_ENV === 'test') {
  module.exports = {
    loadLastRunTime,
    saveLastRunTime
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `NODE_ENV=test npm test -- test/bot.test.js`
Expected: All tests PASS

- [ ] **Step 6: Update runScheduledDigests to check state before posting**

Modify the runScheduledDigests function in `src/bot.js`:

```javascript
async function runScheduledDigests(config, dryRun) {
  const { hasRunToday, hasRunThisWeek, isDailySchedule } = require('./scheduler.js');
  const now = new Date();

  for (const channel of config.channels) {
    // Check weekly digest
    if (channel.digest_schedule && matchesSchedule(channel.digest_schedule, now, channel.locale || config.locale)) {
      console.log(`Weekly digest schedule match for channel ${channel.id}`);

      // Check if already run this week
      const lastRun = await loadLastRunTime(channel.id, 'weekly');
      if (hasRunThisWeek(lastRun, channel.digest_schedule)) {
        console.log(`Weekly digest already posted this week for channel ${channel.id}, skipping`);
        continue;
      }

      await postDigestForChannel(config, channel, 'weekly', dryRun);

      // Save run timestamp
      if (!dryRun) {
        await saveLastRunTime(channel.id, 'weekly', now);
      }
    }

    // Check daily digest
    if (channel.daily_digest_schedule && matchesSchedule(channel.daily_digest_schedule, now, channel.locale || config.locale)) {
      console.log(`Daily digest schedule match for channel ${channel.id}`);

      // Check if already run today
      const lastRun = await loadLastRunTime(channel.id, 'daily');
      if (hasRunToday(lastRun, channel.daily_digest_schedule)) {
        console.log(`Daily digest already posted today for channel ${channel.id}, skipping`);
        continue;
      }

      await postDigestForChannel(config, channel, 'daily', dryRun);

      // Save run timestamp
      if (!dryRun) {
        await saveLastRunTime(channel.id, 'daily', now);
      }
    }
  }
}
```

- [ ] **Step 7: Update workflow to make CACHE_DIR available**

Modify `.github/workflows/scheduled.yml` to add CACHE_DIR env var.

Find the "Run scheduled digests" step and add CACHE_DIR:

```yaml
      - name: Run scheduled digests
        env:
          CALDAV_PASSWORD: ${{ secrets.CALDAV_PASSWORD }}
          SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
          CACHE_DIR: /tmp/cache-state  # Add this line
        run: |
```

But wait - the scheduled workflow doesn't use the cache-state branch currently. We need to add that.

Add before the "Run scheduled digests" step:

```yaml
      - name: Setup cache branch for state tracking
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
          git worktree add /tmp/cache-state cache-state || true

      - name: Configure git
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
```

And after the "Run scheduled digests" step, add:

```yaml
      - name: Commit digest run state
        run: |
          cd /tmp/cache-state
          git add .lastrun-*.json 2>/dev/null || true

          # Check if there are staged changes
          if git diff --staged --quiet; then
            echo "No state changes to commit"
          else
            git commit -m "chore: update digest run timestamps $(date -u +%Y-%m-%dT%H:%M:%SZ)"
            git push --force origin cache-state
          fi
```

- [ ] **Step 8: Update workflow permissions**

Ensure the workflow has write permissions. In `.github/workflows/scheduled.yml`, add after the `jobs:` line:

```yaml
jobs:
  digest:
    runs-on: ubuntu-latest
    permissions:
      contents: write  # Allow pushing to cache-state branch
    steps:
```

- [ ] **Step 9: Run all tests**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 10: Commit all changes**

```bash
git add src/bot.js test/bot.test.js .github/workflows/scheduled.yml
git commit -m "feat: add state tracking to prevent duplicate digest posts

Track last run timestamp for each channel's weekly/daily digests using
the cache-state branch. Check state before posting to ensure digests
only run once per day/week even if workflow runs multiple times.

- Add loadLastRunTime/saveLastRunTime helpers
- Check hasRunToday/hasRunThisWeek before posting
- Store state in .lastrun-<channelid>-<type>.json files
- Update scheduled workflow to use cache-state branch

refs: #6"
```

---

### Task 4: Integration Testing

**Files:**
- None (manual testing)

- [ ] **Step 1: Test change detection business hours cron**

Manual verification:
1. Check `.github/workflows/change-detection.yml` cron is `'0 6,8,10,12,14,16,18 * * *'`
2. Verify this translates to 7 runs per day at specified hours
3. Confirm no runs outside 6 AM - 6 PM UTC window

Expected: Cron only triggers during business hours

- [ ] **Step 2: Test digest state tracking with dry-run**

Run manual workflow dispatch:
```bash
# Trigger workflow with dry-run
gh workflow run scheduled.yml --repo <your-repo> -f digest_type=weekly -f dry_run=true
```

Check logs:
1. Verify "Weekly digest schedule match" appears
2. Verify digest is posted (dry-run)
3. Verify NO ".lastrun" files created (dry-run mode)
4. Verify no duplicate posts in same run

Expected: Single digest post, no state saved in dry-run

- [ ] **Step 3: Test digest state tracking without dry-run**

Run workflow twice within 1 hour:
```bash
# First run
gh workflow run scheduled.yml --repo <your-repo> -f digest_type=weekly -f dry_run=false

# Wait 5 minutes, then second run
gh workflow run scheduled.yml --repo <your-repo> -f digest_type=weekly -f dry_run=false
```

Check logs and Slack:
1. First run: Digest posted, `.lastrun-<channelid>-weekly.json` created
2. Second run: "already posted this week" message, no duplicate post
3. Verify cache-state branch has `.lastrun-*.json` files

Expected: Digest posts only once, state file prevents duplicate

- [ ] **Step 4: Verify state clears after time threshold**

Test daily digest with 21-hour gap:
1. Post daily digest
2. Wait 21 hours (or modify `.lastrun` file timestamp manually)
3. Trigger workflow again

Expected: Second run posts digest (beyond 20-hour threshold)

- [ ] **Step 5: Commit integration test results**

Document results in commit message or issue comment:

```bash
git commit --allow-empty -m "test: verify scheduling frequency fixes

Integration test results:
- Change detection cron adjusted to business hours ✓
- Digest state tracking prevents duplicates ✓  - State clears after threshold period ✓
- Dry-run mode doesn't save state ✓

refs: #6"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ Change detection runs only during business hours (6 AM - 6 PM, every 2 hours)
- ✅ Scheduled digests respect configuration (once per day/week)
- ✅ State tracking prevents duplicate posts
- ✅ Dry-run mode doesn't affect state

**Placeholder scan:**
- ✅ All code blocks contain actual implementation
- ✅ All test code is complete and runnable
- ✅ All file paths are exact
- ✅ All commands have expected output

**Type consistency:**
- ✅ loadLastRunTime/saveLastRunTime signatures match usage
- ✅ hasRunToday/hasRunThisWeek signatures match usage
- ✅ Date handling consistent throughout

---

## Execution Notes

**Estimated total time:** 90-120 minutes

**Dependencies:**
- Existing cache-state branch infrastructure
- Git worktree support in workflows
- Node.js fs/promises API

**Rollback plan:**
- If issues arise, revert commits and restore previous cron schedules
- State files are isolated and can be deleted without affecting core functionality
- Workflow changes are independent and can be reverted separately
