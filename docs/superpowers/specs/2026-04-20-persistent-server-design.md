# Persistent Server + SQLite State — Design Spec

**Issues:** #23 (persistent server) + #38 consolidated  
**Sprint:** 1 (Foundation, Apr 20 – May 3 2026)  
**Date:** 2026-04-20

---

## Overview

Replace the GitHub Actions cron-based scheduler with a persistent Node.js process that owns the scheduling loop via `node-cron`, backed by SQLite for durable state storage. The live bot continues running on GH Actions until the coordinated cutover in #31.

---

## Architecture

### New Files

**`src/server.js`** — Entry point for the persistent process. Loads config, initialises the SQLite DB, registers node-cron jobs per channel schedule, registers graceful shutdown handlers. No HTTP server (added in Sprint 2 via #24, #26, #27).

**`src/runner.js`** — Extracted from `bot.js`. Exports all business logic functions: `runScheduledDigests`, `runWeeklyDigest`, `runDailyDigest`, `runChangeDetection`. Both `bot.js` (CLI) and `server.js` (scheduler) import from here.

**`src/db.js`** — SQLite wrapper. Opens/creates the tenant DB file at `{DATA_DIR}/{workspaceId}.db`, runs schema migrations on boot, exposes typed getters/setters. All state reads/writes go through this module.

### Modified Files

**`src/bot.js`** — Becomes a thin CLI shim. Parses `process.argv`, calls the right function from `runner.js`, exits. No business logic remains here.

**`src/cache.js`** — Rewritten to use `db.js` instead of `fs`. Exported interface unchanged (`loadCacheState`, `saveCacheState`).

**`src/diff.js`** — `loadCachedEvents`, `saveCachedEvents`, `loadPendingNotifications`, `savePendingNotifications` rewritten to use `db.js`. Exported interface unchanged.

### Unchanged Files

`formatting.js`, `caldav.js`, `scheduler.js`, `config.js`, `slack.js`, `calendar-colors.js`

---

## SQLite Schema

One DB file per tenant: `{DATA_DIR}/{workspaceId}.db`

```sql
CREATE TABLE events (
  calendar_id       TEXT PRIMARY KEY,
  events_json       TEXT NOT NULL,
  last_error        TEXT,
  error_notified_at TEXT,
  updated_at        TEXT NOT NULL
);

CREATE TABLE color_cache (
  calendar_id TEXT PRIMARY KEY,
  color       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE run_state (
  channel_id  TEXT NOT NULL,
  digest_type TEXT NOT NULL,  -- 'weekly' | 'daily'
  last_run    TEXT NOT NULL,
  PRIMARY KEY (channel_id, digest_type)
);

CREATE TABLE pending_notifications (
  channel_id TEXT PRIMARY KEY,
  diffs_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

Each table maps directly to an existing flat-file format, making the migration straightforward.

---

## Scheduling

### Schedule Conversion

Config schedule strings are converted to node-cron expressions at boot via a `scheduleStringToCron(str)` helper in `server.js`:

| Config string | node-cron expression |
|---|---|
| `"sunday 18:00"` | `"0 18 * * 0"` |
| `"weekdays 08:00"` | `"0 8 * * 1-5"` |
| `"0 18 * * 0"` | `"0 18 * * 0"` (passthrough) |

This replaces the `SCHEDULED_CRON` / `scheduleMatchesCron` indirection. Each channel's cron job fires directly for that channel — no runtime matching needed.

### Jobs Registered at Boot

1. **Per-channel weekly digest** — one job per channel with `digest_schedule`
2. **Per-channel daily digest** — one job per channel with `daily_digest_schedule`  
3. **Change detection** — `"0 6-18/2 * * *"` (every 2h, 06:00–18:00 UTC), matching the current `change-detection.yml` schedule

### Deduplication

`hasRunToday` / `hasRunThisWeek` checks in `runner.js` remain in place, guarding against double-fires on server restart mid-schedule.

### Graceful Shutdown

`SIGTERM` and `SIGINT` stop all node-cron jobs before exit.

---

## State Migration

On first boot, `db.js` scans `DATA_DIR` for existing flat JSON files and imports them into SQLite:

- `cache_state_{calendarId}.json` → `events` table
- `color_cache_{calendarId}.json` → `color_cache` table  
- `.lastrun-{channelId}-{type}.json` → `run_state` table
- `pending_notifications_{channelId}.json` → `pending_notifications` table

After successful import, flat files are deleted. `CACHE_DIR` env var is deprecated in favour of `DATA_DIR`.

---

## Environment Variables

| Variable | Description |
|---|---|
| `DATA_DIR` | Directory for SQLite DB files. Required. |
| `SLACK_BOT_TOKEN` | Slack bot token. Required. |
| `CACHE_DIR` | Deprecated. Recognised for migration only. |

---

## Testing

- **`db.js` / `cache.js` / `diff.js`** — use `:memory:` SQLite in all tests. No temp files.
- **Migration** — write flat JSON files to a temp dir, run migration, assert SQLite state and flat file removal.
- **`runner.js`** — existing `bot.js` tests migrate here. Same mocks for `fetchCalendar` / `postMessage`.
- **`scheduleStringToCron`** — unit tested as pure function.
- **`server.js`** — not unit tested (thin boot orchestrator).
- Tests for `formatting.js`, `caldav.js`, `scheduler.js`, `slack.js` — unchanged.

---

## What Is Not In Scope

- HTTP server (Sprint 2: #24, #26, #27)
- Nextcloud webhook HTTP endpoint (Sprint 2: #39)
- GH Actions cutover (Sprint 4: #31)
- Multi-tenant onboarding UI
