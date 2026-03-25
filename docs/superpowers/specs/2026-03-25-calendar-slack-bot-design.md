# Calendar Slack Bot - Design Specification

**Date:** 2026-03-25
**Status:** Approved
**License:** MIT

## Overview

A GitHub Actions-based Slack bot that bridges Nextcloud CalDAV calendars with Slack channels. Each channel displays events from one or more calendars in a persistent Canvas and receives automated digest messages and change notifications.

## Goals

- **Zero infrastructure:** Runs entirely in GitHub Actions, no servers or databases
- **Maintainable:** Clean module boundaries, clear documentation, easy for future maintainers
- **Flexible:** Many-to-many calendar-to-channel mapping with per-channel configuration
- **Reliable:** Fail-fast validation, graceful error handling, debounced notifications

## Architecture

### System Components

**Runtime Environment:**
- GitHub Actions (Node.js 20)
- GitHub Actions cache for event state persistence
- No persistent database or server infrastructure

**External Services:**
- Nextcloud CalDAV (calendar data source)
- Slack API (message posting and Canvas updates)
- GitHub repository_dispatch (webhook receiver)

**Module Structure:**

```
src/
├── bot.js          # Main entry point, CLI flag routing
├── config.js       # Configuration loading and validation
├── caldav.js       # CalDAV fetching and iCalendar parsing
├── slack.js        # Slack API operations (messages, Canvas)
├── formatting.js   # Message and Canvas rendering
├── diff.js         # Event change detection and caching
└── scheduler.js    # Urgency classification and debounce logic

test/
├── formatting.test.js
├── diff.test.js
├── config.test.js
└── scheduler.test.js

.github/workflows/
├── scheduled.yml   # Cron-triggered digests
└── webhook.yml     # Nextcloud webhook handler
```

Each module is independently readable with a single, focused responsibility.

### Data Flow Architecture

**Many-to-Many Mapping:**
- Any calendar can post to multiple channels
- Any channel can receive events from multiple calendars
- Configuration is channel-centric (channels own display settings)
- Calendars are defined as named data sources referenced by channels

### Module Responsibilities

**`src/bot.js`** (150-200 lines)
- Parses CLI flags: `--scheduled`, `--event-changed`, `--dry-run`, `--weekly-digest` (test override), `--daily-digest` (test override)
- Loads config via `config.js`
- Routes to appropriate flow based on flag
- `--scheduled`: Runtime filtering mode - checks each channel's `digest_schedule` and `daily_digest_schedule` against current time, posts digests only to channels whose schedule matches (with ~5 min tolerance for Actions startup delay)
- `--weekly-digest` / `--daily-digest`: Explicit override flags for manual testing only - force digest to all channels regardless of schedule
- Top comment serves as architecture map

**`src/config.js`** (100-150 lines)
- Loads and validates `config.json`
- Resolves environment variable placeholders (`${CALDAV_USERNAME}`)
- Fail-fast validation with human-readable error messages
- Exports validated config object

**`src/caldav.js`** (150-200 lines)
- `fetchCalendar(caldavUrl, credentials)` - fetches events from CalDAV
- Uses `node-ical` library for iCalendar parsing
- Expands recurring events within date range (critical for team calendars)
- Returns normalized event objects: `{ id, title, start, end, location, description, isAllDay }`
- Handles network errors, timeouts, auth failures gracefully

**`src/slack.js`** (150-200 lines)
- `postMessage(channelId, text)` - posts message to channel
- `updateCanvas(canvasId, content)` - rewrites Canvas with markdown
- `postErrorNotification(errorChannelId, message)` - posts errors to error channel
- Uses `@slack/web-api` library
- Handles rate limits and API errors

**`src/formatting.js`** (250-350 lines)
- `renderWeekView(events, dateRange, locale, options)` - generates week view digest format
- `renderChangeNotification(diff, locale)` - generates change notification messages
- `renderCanvasContent(events, channels, calendars, locale, options)` - full Canvas markdown
- Locale-aware formatting using `Intl.DateTimeFormat` and `Intl.RelativeTimeFormat`
- Handles merged vs separate calendar views
- Handles event detail levels (minimal, standard, detailed)
- Canvas always shows full current week regardless of trigger

**`src/diff.js`** (100-150 lines)
- `diffEvents(previousEvents, currentEvents)` - returns structured diff
- Detects: new, deleted, time_changed, title_changed, location_changed
- Returns diff objects: `{ type: 'time_changed', event: {...}, old: {...}, new: {...} }`
- Cache loading/saving via `@actions/cache` (GitHub Actions cache API)
- Cache key: `calendar-state-{calendar-id}` (scoped per calendar)
- Graceful fallback to generic "updated" when cache unavailable
- Description changes ignored (too noisy, not actionable)

**`src/scheduler.js`** (100-150 lines)
- `classifyUrgency(event, channelConfig)` - returns `URGENT` / `THIS_WEEK` / `FUTURE`
- `shouldNotifyNow(diff, channelConfig)` - determines if change triggers immediate notification
- Debounce state management via GitHub Actions cache (pending notifications, timestamps)
- MVP hardcoded thresholds clearly marked as v2 configurable:
  ```javascript
  // MVP HARDCODED THRESHOLDS — configurable in v2
  const URGENT_THRESHOLD_HOURS = 24;
  const THIS_WEEK_BOUNDARY = 'end_of_current_week';
  const DEBOUNCE_WINDOW_SECONDS = 300; // 5 minutes
  ```
- Cascade logic: promotes THIS_WEEK → URGENT if no daily digest, FUTURE → THIS_WEEK if no weekly digest

### Dependencies

- `node-ical` - iCalendar parsing with recurring event expansion (latest stable, recommend ^0.18.0 or newer)
- `@actions/cache` - GitHub Actions cache API (latest stable, recommend ^3.0.0 or newer)
- `@slack/web-api` - Slack API client (latest stable, recommend ^7.0.0 or newer for Canvas API support)
- Native `fetch()` for CalDAV HTTP requests (Node.js 20+ built-in, no package needed)

**Version notes:**
- Exact versions will be determined during implementation based on current npm latest
- Canvas API support in `@slack/web-api` was added in v7.x - earlier versions will not work
- `node-ical` should be recent enough to handle modern iCalendar formats and RRULE parsing
- Lock versions in `package-lock.json` for reproducibility

## Configuration Schema

### Structure (Channel-Centric)

```json
{
  "locale": "de-DE",
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

### Field Definitions

**Global Settings:**

- `locale` (string, required): BCP 47 language tag for date/time formatting (e.g., `"de-DE"`, `"en-US"`, `"en-GB"`)
- `error_channel` (string, optional): Slack channel ID for critical error notifications; if omitted, errors logged to GitHub Actions only
- `caldav_credentials` (object, required): CalDAV authentication
  - `username` (string, required): CalDAV username, supports `${ENV_VAR}` syntax
  - `password` (string, required): CalDAV password, supports `${ENV_VAR}` syntax
  - **Note:** MVP uses global credentials (same Nextcloud instance for all calendars). Per-calendar credential overrides are a v2 consideration for multi-instance setups.

**Calendars** (object, required):
- Keys are calendar IDs (used in channel references)
- `name` (string, required): Human-readable calendar name
- `caldav_url` (string, required): Full CalDAV calendar URL

**Channels** (array, required):

- `id` (string, required): Slack channel ID
- `name` (string, optional): Human-readable channel name (documentation only)
- `canvas_id` (string, required): Slack Canvas ID
- `calendars` (array of strings, required): Calendar IDs to display in this channel
- `locale` (string, optional): Override global locale for this channel
- `view` (string, optional): `"merged"` (default) or `"separate"` - how to display multiple calendars
- `event_detail` (string, optional): `"minimal"`, `"standard"` (default), or `"detailed"`
  - `minimal`: time + title
  - `standard`: time + title + location (if present)
  - `detailed`: time + title + location + description snippet (~100 chars)
- `digest_style` (string, optional): `"full"` (default), `"highlights"`, or `"minimal"`
  - `full`: all events in digest message
  - `highlights`: top 5 notable events (all-day events first, then earliest timed event per day)
  - `minimal`: just a Canvas link
- `digest_format` (string, optional): `"week_view"` (default) or `"list"`
- `digest_schedule` (string or false, optional): Weekly digest schedule (e.g., `"sunday 18:00"`), default `"sunday 18:00"`, set to `false` to disable
  - Format: `"<day> <HH:MM>"` where day is one of: `monday`, `tuesday`, `wednesday`, `thursday`, `friday`, `saturday`, `sunday`, `weekdays` (Mon-Fri), `weekends` (Sat-Sun), `daily` (every day)
  - Time is in 24-hour format, interpreted as UTC
  - Alternative: raw cron expression (e.g., `"0 18 * * 0"`) for advanced scheduling
  - **Runtime filtering:** The bot checks this field at runtime when `--scheduled` runs and only posts digests to channels whose schedule matches the current time (within ~5 min tolerance)
  - **MVP limitation:** Custom schedule times require adding a matching cron expression to `.github/workflows/scheduled.yml`. Default cron covers `sunday 18:00` and `weekdays 08:00`.
- `daily_digest_schedule` (string or false, optional): Daily digest schedule (e.g., `"weekdays 08:00"`), default `false` (disabled)
  - Same format as `digest_schedule`
  - Common values: `"weekdays 08:00"` (Monday-Friday at 08:00 UTC), `"daily 09:00"` (every day at 09:00 UTC)
  - **Runtime filtering:** Same as `digest_schedule` - checked at runtime, only posts to matching channels
- `show_empty_days` (boolean, optional): Show days with no events, default `false`
- `notifications` (string or object, optional): Controls change notification behavior
  - `"all"` (default): every change posted immediately after debounce
  - `"urgent_only"`: only changes to events within urgent threshold (24h)
  - `"daily"`: changes batched into daily digest
  - `"weekly"`: Sunday digest only, no change notifications
  - `"disabled"`: Canvas updates silently, no messages posted
  - Advanced object format reserved for v2

### Validation Rules

1. All required fields present
2. All channel `calendars` references point to defined calendar IDs
3. `locale` values are valid BCP 47 tags (basic pattern validation)
4. `${ENV_VAR}` placeholders are resolved (environment variables exist)
5. `digest_schedule` and `daily_digest_schedule` are parseable (human-readable format or cron)
6. `view`, `event_detail`, `digest_style`, `digest_format`, `notifications` are valid enum values

### Error Message Examples

- `"Config error: channel '#team-schedule' references calendar 'project-x' which is not defined in calendars"`
- `"Config error: CALDAV_PASSWORD environment variable is not set"`
- `"Config error: channel 'C01234TEAM' missing required field 'canvas_id'"`
- `"Config error: invalid locale 'invalid-tag' - must be a valid BCP 47 language tag"`

### Schedule Parsing Grammar

**Human-readable format:**

```
<day> <HH:MM>
```

**Supported day keywords:**
- `monday`, `tuesday`, `wednesday`, `thursday`, `friday`, `saturday`, `sunday` - specific weekday
- `weekdays` - Monday through Friday (expands to all weekdays)
- `weekends` - Saturday and Sunday (expands to both weekend days)
- `daily` - every day of the week

**Time format:**
- 24-hour format: `HH:MM` (e.g., `08:00`, `18:30`, `23:45`)
- Interpreted as UTC timezone
- **Important:** All schedule times in config are UTC. Maintainers must calculate their local timezone offset. Example: for CET (UTC+1), `18:00` local time = `17:00` in config.

**Alternative: raw cron expressions:**
- Full cron syntax supported: `"0 18 * * 0"` (Sunday at 18:00 UTC)
- Five-field format: `minute hour day-of-month month day-of-week`
- Useful for complex schedules (e.g., "first Monday of month")

**Parsing priority:**
1. If value is `false` → disabled, skip parsing
2. If value matches cron pattern (5 space-separated fields) → parse as cron
3. If value matches `<day> <HH:MM>` pattern → parse as human-readable
4. Otherwise → validation error

**Examples:**
- `"sunday 18:00"` → every Sunday at 18:00 UTC
- `"weekdays 08:00"` → Monday-Friday at 08:00 UTC
- `"daily 12:00"` → every day at 12:00 UTC
- `"0 18 * * 0"` → cron: every Sunday at 18:00 UTC
- `false` → disabled

### Runtime Schedule Matching

**How the bot determines if a digest is due:**

When `--scheduled` runs, the bot:

1. **Gets current UTC time** (e.g., "2026-03-30T18:02:35Z" = Sunday 18:02 UTC)
2. **For each channel:**
   - Parse `digest_schedule` and `daily_digest_schedule` from config
   - Check if current time matches schedule within ~5 minute tolerance window
   - Tolerance accounts for GitHub Actions startup delay and cron schedule drift
3. **Matching logic:**
   - Day match: current day of week matches schedule day (or current day is in schedule day range for "weekdays"/"weekends"/"daily")
   - Time match: **`schedule_time <= current_time <= schedule_time + 5 minutes`**
     - Schedule time must be in the past or now
     - Current time must be within 5 minutes after schedule time
   - Example: schedule is "sunday 18:00", current time is Sunday 18:03 → **match** (3 min after schedule)
   - Example: schedule is "weekdays 08:00", current time is Monday 08:04 → **match** (4 min after schedule)
   - Example: schedule is "sunday 18:00", current time is Sunday 17:58 → **no match** (schedule is in the future)
   - Example: schedule is "sunday 18:00", current time is Sunday 18:06 → **no match** (more than 5 min after schedule)
   - Example: schedule is "weekdays 08:00", current time is Saturday 08:01 → **no match** (wrong day)
4. **If match:** Post digest to this channel
5. **If no match:** Skip this channel silently

**Tolerance window rationale:**
- GitHub Actions cron is not guaranteed to run at exact time (can be delayed by minutes)
- **Forward-looking tolerance only:** Workflow can run late (up to 5 min) but not early
  - Prevents duplicate posts if workflow runs before scheduled time
  - Catches delayed runs within reasonable window
  - If GitHub Actions delays > 5 minutes, digest will be skipped (logged as missed)
- **Implementation:** `const minutesAfterSchedule = (currentTime - scheduleTime) / 60000; return minutesAfterSchedule >= 0 && minutesAfterSchedule <= 5;`

**MVP limitation:**
- The workflow cron must cover the times specified in channel schedules
- Default cron: `0 18 * * 0` and `0 8 * * 1-5` covers "sunday 18:00" and "weekdays 08:00"
- Custom times like "friday 17:00" require adding `0 17 * * 5` to workflow cron
- Future v2: dynamic cron generation or more frequent polling (e.g., hourly) with wider tolerance

## Cache Keys and Structure

### Event State Cache

**Key format:** `calendar-state-<calendar-id>`
- `<calendar-id>` is the calendar key from config (e.g., `"team-calendar"` → `calendar-state-team-calendar`)
- One cache entry per calendar (isolated, no cross-calendar interference)

**Value structure:**
```json
{
  "timestamp": "2026-03-25T10:30:00Z",
  "events": [
    {
      "id": "event-12345",
      "title": "Team Standup",
      "start": "2026-03-25T09:00:00Z",
      "end": "2026-03-25T09:30:00Z",
      "location": "Conference Room A",
      "description": "Daily sync",
      "isAllDay": false
    }
  ]
}
```

**Cache behavior:**
- Saved after every successful calendar fetch (scheduled digest or webhook)
- Loaded before diffing on event-changed webhook
- GitHub Actions cache TTL: 7 days of inactivity (automatic eviction)
- Missing cache is graceful: skip diffing, fall back to generic "updated" notifications

**Race condition handling:**
- Scheduled digest and webhook workflows can run concurrently
- Both workflows read/write the same event state cache keys
- GitHub Actions cache API is eventually consistent - last write wins
- **Acceptable race:** If digest and webhook run simultaneously, one may use slightly stale cache
  - Worst case: a single webhook might show generic "updated" instead of precise diff
  - Next webhook will have correct cache from the concurrent digest run
  - This is acceptable for MVP - happens rarely, degrades gracefully
- Pending notifications cache is per-channel and only used by webhooks (no race with scheduled)

### Pending Notifications Cache

**Key format:** `pending-notifications-<channel-id>`
- `<channel-id>` is the Slack channel ID from config (e.g., `"C01234TEAM"` → `pending-notifications-C01234TEAM`)
- One cache entry per channel (debounce state is channel-specific)

**Value structure:**
```json
{
  "firstTimestamp": "2026-03-25T10:30:00Z",
  "changes": [
    {
      "type": "time_changed",
      "event": {
        "id": "event-12345",
        "title": "Team Standup"
      },
      "old": { "start": "2026-03-25T09:00:00Z" },
      "new": { "start": "2026-03-25T10:00:00Z" }
    }
  ]
}
```

**Cache behavior:**
- Created when first change arrives within debounce window
- Updated with additional changes during window
- Deleted after bundled notification is posted
- Missing cache triggers immediate posting (cold start, no debounce)

## Nextcloud Webhook Payload

**Problem:** Nextcloud's CalDAV webhook payload format varies by version and configuration. Rather than hardcoding assumptions, the implementation must be flexible.

**Approach:**

1. **Expected fields (best-effort extraction):**
   - `calendar_id` or `calendarid` or `calendar` - identifies which calendar changed
   - `event_id` or `eventid` or `uid` - identifies which event changed (optional)
   - `change_type` or `action` - describes change type: `created`, `modified`, `deleted` (optional)

2. **Parsing strategy:**
   - Try multiple field name variations (case-insensitive)
   - Extract calendar identifier if present
   - **Map calendar identifier to config calendar ID:**
     1. Try exact match first (case-sensitive): payload `"team-calendar"` matches config key `"team-calendar"`
     2. If no exact match, try case-insensitive exact match
     3. If still no match, try substring match: payload contains config key or vice versa
     4. **Tie-breaking for multiple substring matches:** Use shortest matching config key (most specific)
        - Example: payload `"team"` matches both `"team-calendar"` and `"team-standup"` → use `"team-calendar"` (shorter, equally specific) OR first alphabetically if same length
        - If truly ambiguous → log warning, fall back to full refresh
   - If parsing succeeds and calendar is recognized → update that calendar only
   - If parsing fails or calendar not recognized → log warning, fall back to full refresh (fetch all calendars)

3. **Implementation:**
   - Isolate parsing in `parseNextcloudWebhook(payload)` function in `bot.js`
   - Function returns: `{ success: boolean, calendarId: string | null, eventId: string | null }`
   - Clear comments documenting field name variations tried
   - Easy to extend with new field names as Nextcloud versions change

4. **Testing:**
   - Manual trigger accepts `test_payload` input for testing various payload formats
   - Dry-run mode helps validate parsing without side effects
   - Document sample payloads in README for common Nextcloud versions

**Sample test payload formats:**

```json
// Format 1: Nextcloud 25+
{
  "calendar_id": "team-calendar",
  "event_id": "event-12345",
  "change_type": "modified"
}

// Format 2: Older Nextcloud
{
  "calendarid": "team-calendar",
  "uid": "event-12345@example.com",
  "action": "update"
}

// Format 3: Minimal (fallback to full refresh)
{
  "calendar": "team"
}
```

**This approach explicitly acknowledges that Nextcloud webhook payload formats are version-dependent and not well-documented. The implementation must be exploratory and best-effort:**

- Initial implementation will use common field name variations based on similar webhook systems
- The fallback to full refresh ensures the bot never silently fails - it always updates, just less efficiently
- Post-deployment adjustment is expected - the first real webhooks will reveal the actual payload structure
- Clear logging of unparseable payloads will help maintainers debug and update the parser
- The isolated `parseNextcloudWebhook()` function makes updates trivial once real payloads are observed

**Testing strategy:** During initial deployment, monitor GitHub Actions logs for the first few webhook triggers. Log the full raw payload. Use this to refine the parser if needed.

## CalDAV Recurring Event Handling

**Library:** `node-ical` (https://www.npmjs.com/package/node-ical)

**Recurring event expansion:**

The `node-ical` library parses iCalendar data and provides recurring event information via RRULE properties. However, the library **does not automatically expand recurring events into individual instances**. This must be handled explicitly.

**Implementation approach:**

1. **Parse calendar with node-ical:**
   ```javascript
   const ical = require('node-ical');
   const events = await ical.async.fromURL(caldavUrl, options);
   ```

2. **Detect recurring events:**
   - Check for `event.rrule` property (RRULE object from rrule.js, which node-ical uses internally)
   - If `event.rrule` exists, event is recurring

3. **Expand recurring events:**
   - Use `event.rrule.between(startDate, endDate)` to get occurrences within date range
   - For each occurrence, create a new event object with the occurrence's start/end times
   - Merge with the original event's title, location, description

4. **Date range for expansion:**
   - Weekly digest: current week (Monday 00:00 - Sunday 23:59)
   - Daily digest: today + tomorrow (today 00:00 - tomorrow 23:59)
   - Event change webhook: current week (to ensure Canvas shows all current instances)

5. **Fallback:**
   - If RRULE expansion fails or is unsupported for complex patterns → show original event only, log warning
   - Common team calendar patterns (daily standups, weekly meetings) use simple RRULEs that are well-supported

**Code location:** `src/caldav.js` - `expandRecurringEvents(events, startDate, endDate)` function

**Implementation approach (priority order):**

1. **First: Check node-ical documentation** for built-in recurring event expansion
   - Look for methods like `expand()`, `occurrencesBetween()`, or similar
   - If found and working: use the built-in method (simplest)

2. **If no built-in expansion:** Check if `node-ical` exposes RRULE objects
   - `node-ical` internally uses `rrule.js` library
   - If `event.rrule` is an RRule object: use `event.rrule.between(startDate, endDate)`
   - This is the most likely scenario based on common iCalendar library patterns

3. **If neither works:** Add `rrule` package as separate dependency
   - Parse RRULE strings from event data
   - Create RRule objects manually: `new RRule({ ... })`
   - Use `rrule.between(startDate, endDate)` for expansion
   - This adds one dependency but guarantees recurring event support

4. **Worst case fallback:** Show recurring events as single entries with "(recurring)" label
   - Log warning that recurring expansion failed
   - This is acceptable for initial deployment if libraries don't cooperate
   - Can be fixed post-deployment once real calendar data reveals issues

**Decision criteria during implementation:**
- Try approach 1 first (spend <30 min investigating)
- If approach 1 fails, try approach 2 (spend <1 hour)
- If approach 2 fails, implement approach 3 (guaranteed to work)
- Approach 4 is only if approaches 1-3 all fail catastrophically (unlikely)

**The critical requirement:** Weekly recurring events (e.g., "Team Standup every Monday at 9am") must appear as individual instances in the digest, not as a single recurring event. Approaches 1-3 all achieve this. This is essential for team calendar usability.

## Data Flows

### Flow 1: Weekly/Daily Digest (Scheduled with Runtime Filtering)

1. **GitHub Actions cron triggers** `.github/workflows/scheduled.yml`
   - Two cron expressions: `0 18 * * 0` (Sunday 18:00 UTC) and `0 8 * * 1-5` (weekdays 08:00 UTC)
   - These are polling intervals, not the actual schedule - the bot wakes up to check if any channels need digests
   - Calls `node src/bot.js --scheduled` (runtime filtering mode)
   - Manual trigger via `workflow_dispatch` with `digest_type` input (choice: weekly/daily/scheduled) for testing

2. **Config loading** (`config.js`)
   - Load `config.json`
   - Resolve environment variables
   - Validate all fields and references
   - Fail fast with clear error if validation fails

3. **Fetch all calendars** (`caldav.js`)
   - For each calendar in config, fetch events via CalDAV
   - Expand recurring events within date range (weekly: current week, daily: today+tomorrow)
   - Normalize to standard event objects
   - Handle network errors gracefully - log individual calendar failures, continue with others

4. **Update GitHub Actions cache** (`diff.js`)
   - Save current event snapshot to cache (per-calendar cache keys)
   - This becomes "previous state" for next event-changed run

5. **For each channel** (`formatting.js` + `slack.js` + `scheduler.js`)
   - **Runtime filtering:** Check if channel's `digest_schedule` or `daily_digest_schedule` matches current time (within ~5 min tolerance)
     - Compare current UTC time against parsed schedule from config
     - If `digest_schedule` matches → channel is due for weekly digest
     - If `daily_digest_schedule` matches → channel is due for daily digest
     - If neither matches → skip this channel, no digest posted
     - If schedule is `false` → skip this digest type for this channel
   - **If digest is due:**
     - Collect all events from calendars assigned to this channel
     - **Render and post digest message:**
       - Weekly: render full week view, post to channel
       - Daily: render today+tomorrow view, post to channel
     - **Render and update Canvas:**
       - Always render full current week (regardless of digest type)
       - Update Canvas via Slack API
     - Respect channel-specific settings: locale, view mode, event detail level, digest format
   - **Manual testing mode:** If invoked with `--weekly-digest` or `--daily-digest` flags, skip runtime filtering and force digest to all channels

6. **Error handling**
   - Critical errors → post to error_channel if configured, else fail workflow
   - Individual calendar fetch timeouts → log warning, continue
   - Individual channel update failures → log error, continue

### Flow 2: Event Changed (Webhook)

1. **Nextcloud sends webhook** to GitHub repository_dispatch endpoint
   - Webhook URL: `https://api.github.com/repos/OWNER/REPO/dispatches`
   - Headers: `Authorization: token GITHUB_PAT`, `Accept: application/vnd.github.v3+json`
   - Payload: `{"event_type": "calendar_changed", "client_payload": {...}}`
   - **Security:** PAT requires `repo` scope, stored in Nextcloud as webhook secret, rotated periodically

2. **GitHub Actions triggers** `.github/workflows/webhook.yml`
   - Listens for `repository_dispatch` events with type `calendar_changed`
   - Calls `node src/bot.js --event-changed`
   - Passes webhook payload via `WEBHOOK_PAYLOAD` environment variable

3. **Parse webhook payload** (`bot.js`)
   - Extract calendar identifier from payload
   - Payload parsing isolated in dedicated function (easy to adjust for Nextcloud version differences)
   - **If parsing fails or calendar not recognized:**
     - Log warning with full payload for debugging
     - **Full refresh fallback:** Fetch ALL calendars from config, update ALL channels
     - This ensures correctness at cost of efficiency - no changes are missed

4. **Load cache and fetch affected calendar(s)** (`diff.js` + `caldav.js`)
   - Load previous event snapshot from GitHub Actions cache
   - Fetch current events from CalDAV:
     - **If payload parsed successfully:** Fetch only affected calendar
     - **If full refresh fallback:** Fetch all calendars from config
   - If cache missing/expired → log note, proceed without diffing (post immediate notifications for that calendar)

5. **Detect changes** (`diff.js`)
   - Compare previous vs current events
   - Generate structured diffs: new, deleted, time_changed, title_changed, location_changed
   - Return list of diff objects with old/new state

6. **Classify urgency and debounce** (`scheduler.js`)
   - Determine which channels are affected by the changed calendar(s)
   - **For each affected channel:**
     - **Check notification settings first:**
       - If `notifications: "disabled"` → skip this channel entirely, update Canvas only (no message)
       - If `notifications: "weekly"` → skip immediate notification, change will appear in next weekly digest
       - If `notifications: "daily"` → skip immediate notification, change will appear in next daily digest
       - If `notifications: "urgent_only"` or `"all"` → proceed with urgency classification
     - **Classify urgency for each diff** (only if notifications enabled):
       - URGENT: event starts within 24 hours
       - THIS_WEEK: event starts within current week
       - FUTURE: event starts beyond current week
     - **Apply cascade rules** (promote urgency based on channel's configured digests):
       - If no `daily_digest_schedule` → THIS_WEEK promoted to URGENT
       - If no `digest_schedule` → FUTURE promoted to THIS_WEEK (or URGENT if no daily either)
       - Ensures every change has somewhere to go
     - **Debounce check** (per-channel, only for changes that should notify now):
       - Load pending notifications cache for this channel: `pending-notifications-{channel-id}`
       - **If cache exists:** Check if 5 min debounce window elapsed since first pending change
         - Still within window: Add current changes to pending cache, exit without posting to this channel
         - Window elapsed: Bundle all pending changes, proceed to post
       - **If cache missing:** Post immediately without debouncing (cold start)
   - **Important:** Debounce state is per-channel, not per-calendar. Same calendar change feeding multiple channels can be in different debounce states for each channel.

7. **Update affected channels** (`formatting.js` + `slack.js`)
   - Determine which channels receive this calendar
   - For each affected channel:
     - **If changes should notify now** (urgent or debounce window elapsed):
       - Render change notification message (single event or bundled)
       - Post to channel
     - **Always rewrite Canvas:**
       - Render full current week
       - Update Canvas via Slack API
   - Respect channel settings: locale, view mode, event detail level

8. **Update cache** (`diff.js`)
   - Save updated event snapshot to GitHub Actions cache
   - Clear pending notifications cache (if bundled notification was posted)
   - Becomes "previous state" for next webhook

9. **Error handling**
   - Unparseable webhook payload → log warning, fall back to full refresh
   - CalDAV fetch failure → post to error_channel if configured
   - Slack API failure → post to error_channel if configured
   - Individual failures don't halt processing of other channels

## Message Formats

### Weekly Digest (Default: "full" style, "week_view" format)

```
📅 Week 13 · Mon 25 Mar — Sun 31 Mar

Monday 25 Mar
━━━━━━━━━━━━━━━━━━━━
📅 Public Holiday — Ostermontag
09:00  Team Standup · 🟦 Team
14:00  Client Call — Acme GmbH · 🟦 Team
16:00  Budget Review · 🟩 Project X

Tuesday 26 Mar
━━━━━━━━━━━━━━━━━━━━
09:30  Design Review · 🟩 Project X
11:00  1:1 with Sarah · 🟦 Team

Thursday 28 Mar
━━━━━━━━━━━━━━━━━━━━
📅 Project X Deadline
10:00  Sprint Planning · 🟦 Team
13:00  Lunch with Ole · 🟨 Personal
15:00  Budget Review Follow-up · 🟩 Project X

Friday 29 Mar
━━━━━━━━━━━━━━━━━━━━
09:00  Team Standup · 🟦 Team
14:30  Sprint Review · 🟦 Team

📆 13 events · 3 calendars · Full schedule →
```

**Format rules:**
- All-day events always pinned to top of their day with 📅 indicator
- Calendar source indicators (🟦 🟩 🟨) only shown when multiple calendars feed the channel
- Empty days show "(nothing scheduled)" or are omitted based on `show_empty_days` setting
- Summary line shows total event count, calendar count, and Canvas link
- Locale controls date/time formatting (e.g., "Montag" for German, "Monday" for English)

### Daily Digest (Same week_view format, scoped to today + tomorrow)

```
📅 Monday 25 Mar — Tuesday 26 Mar

Today · Monday 25 Mar
━━━━━━━━━━━━━━━━━━━━
📅 Public Holiday — Ostermontag
09:00  Team Standup · 🟦 Team
14:00  Client Call — Acme GmbH · 🟦 Team

Tomorrow · Tuesday 26 Mar
━━━━━━━━━━━━━━━━━━━━
09:30  Design Review · 🟩 Project X
(nothing scheduled)

📆 3 events · Full schedule →
```

**Format rules:**
- "Today" and "Tomorrow" labels replace day names for clarity
- Same visual format as weekly digest (consistency)
- Daily digest message is scoped to today+tomorrow
- Canvas is always updated with full current week (not scoped to today+tomorrow)

### Change Notifications

**Single urgent event (immediate after debounce):**

```
➕ New: Team Standup · Mon 25 Mar · 09:00 · 🟦 Team
```

```
✏️ Moved: Team Standup · Mon 25 Mar · 09:00 → 10:00 · 🟦 Team
```

```
✏️ Updated: Team Standup · Mon 25 Mar · 10:00 (location changed) · 🟦 Team
```

```
🗑️ Cancelled: Team Standup · Mon 25 Mar · 09:00 · 🟦 Team
```

**Format rules:**
- Action-focused with clear visual distinction
- Time changes show old → new
- Other changes show brief label (location changed, renamed)
- Cancellations always use 🗑️ and "Cancelled" - critical for user trust
- Calendar source indicator follows same rule (only when multiple calendars)
- Canvas link optional and subtle for single notifications

**Bundled notification (multiple changes debounced):**

```
📅 3 calendar updates

✏️ Team Standup moved · Mon 25 Mar · 09:00 → 10:00 · 🟦 Team
➕ Budget Review added · Wed 27 Mar · 14:00 · 🟩 Project X
🗑️ Friday 1:1 cancelled · Fri 29 Mar · 15:00 · 🟦 Team

Full schedule →
```

**Format rules:**
- Clean changelog list
- Always ends with Canvas link
- Same action indicators as single notifications

## Urgency Classification and Debouncing

### Urgency Tiers (MVP Hardcoded)

```javascript
// MVP HARDCODED THRESHOLDS — configurable in v2
const URGENT_THRESHOLD_HOURS = 24;
const THIS_WEEK_BOUNDARY = 'end_of_current_week';
const DEBOUNCE_WINDOW_SECONDS = 300; // 5 minutes
```

**Tier definitions:**
- **URGENT:** Event starts within 24 hours → notify immediately after debounce window
- **THIS_WEEK:** Event starts within current calendar week → hold for daily digest
- **FUTURE:** Event starts beyond current week → hold for weekly Sunday digest

**Cascade rules:**
- If no daily digest configured → THIS_WEEK promoted to URGENT
- If no weekly digest configured → FUTURE promoted to THIS_WEEK (or URGENT if no daily either)
- Every change must have somewhere to go - no silent drops

### Debounce Mechanism

**State persistence via GitHub Actions cache:**

1. **On webhook receive:**
   - Load pending notifications cache
   - If cache exists and debounce window not elapsed:
     - Add current change to pending cache
     - Exit without posting (run does nothing)
   - If cache exists and window elapsed:
     - Bundle all pending changes
     - Post bundled notification
     - Clear pending cache
   - If cache missing (cold start):
     - Post immediately without debouncing
     - Document: `// MVP: if pending cache is missing, skip debounce and post immediately. Worst case: a few unbundled notifications on cache cold start. Acceptable trade-off vs. silently dropping notifications.`

2. **Cache structure:**
   - Key: `pending-notifications-{channel-id}`
   - Value: `{ firstTimestamp: ISO8601, changes: [{diff}, {diff}, ...] }`

**Debounce applies to all urgency tiers** - even urgent notifications wait out the debounce window in case more changes arrive.

## Locale and Internationalization

**Global locale setting:**
- Top-level `locale` field in config controls date/time formatting throughout
- Per-channel `locale` override available for mixed international teams

**Supported presets (via JavaScript Intl API):**
- `"de-DE"` → German format: "Montag, 9. März · 14:30 Uhr"
- `"en-GB"` → UK format: "Monday, 9 March · 14:30"
- `"en-US"` → US format: "Monday, March 9 · 2:30 PM"

**Implementation:**
- Use `Intl.DateTimeFormat` for all date/time formatting
- Use `Intl.RelativeTimeFormat` for relative times if needed
- Locale controls both format and language (day/month names)
- No extra libraries needed - native Node.js Intl API

## Error Handling

### Error Categories

**Critical errors** (halt execution, post to error_channel if configured):
- Config validation failure
- CalDAV authentication failure
- Slack API authentication failure
- Invalid Canvas ID
- All calendars unreachable

**Recoverable errors** (log warning, continue processing):
- Individual calendar fetch timeout
- Individual calendar HTTP error (404, 500)
- Individual channel update failure
- Cache load failure
- Webhook payload unparseable

### Error Message Format (Slack)

```
⚠️ Calendar Bot Error

Could not authenticate with Nextcloud — check CALDAV_USERNAME and CALDAV_PASSWORD

Time: 2026-03-25 10:30 UTC
Run: https://github.com/owner/calendar-slack-bot/actions/runs/123456
```

**Principles:**
- Human-readable, actionable descriptions
- No raw stack traces in Slack
- Clear suggested action for maintainer
- Direct link to GitHub Actions run (using `$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID`)

### Logging Strategy

- `console.error()` for errors (includes stack traces for debugging in GitHub Actions logs)
- `console.warn()` for warnings
- `console.info()` for normal flow
- Critical errors posted to Slack error_channel (if configured)
- All errors visible in GitHub Actions console

## GitHub Actions Workflows

### Workflow 1: Scheduled Digests

**File:** `.github/workflows/scheduled.yml`

**Triggers:**
- `schedule`:
  - `cron: '0 18 * * 0'` (Sunday 18:00 UTC)
  - `cron: '0 8 * * 1-5'` (Weekdays 08:00 UTC)
  - **Note:** These are polling intervals. The bot wakes up and checks which channels need digests via runtime filtering.
  - **Note:** Times are UTC - maintainers in other timezones must adjust accordingly
  - **MVP limitation:** Custom schedule times require adding matching cron expressions here
- `workflow_dispatch`:
  - `digest_type` input (choice: weekly/daily/scheduled)
    - `scheduled` - runtime filtering mode (normal behavior, checks each channel's schedule)
    - `weekly` - force weekly digest to all channels (testing override)
    - `daily` - force daily digest to all channels (testing override)
  - `dry_run` input (boolean, default false)

**Steps:**
1. Checkout code
2. Setup Node.js 20
3. Write config from secret:
   ```yaml
   - name: Write config
     env:
       CONFIG_JSON: ${{ secrets.CONFIG_JSON }}
     run: printf '%s' "$CONFIG_JSON" > config.json
   ```
4. Install dependencies (`npm ci`)
5. Run tests (`npm test`) - blocks workflow if tests fail
6. Run scheduled digest check (runtime filtering):
   ```yaml
   - name: Run scheduled digests
     if: github.event_name == 'schedule'
     env:
       CALDAV_USERNAME: ${{ secrets.CALDAV_USERNAME }}
       CALDAV_PASSWORD: ${{ secrets.CALDAV_PASSWORD }}
       SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
     run: node src/bot.js --scheduled
   ```
7. Run manual digest override (if manual trigger):
   ```yaml
   - name: Run manual digest
     if: github.event_name == 'workflow_dispatch'
     env:
       CALDAV_USERNAME: ${{ secrets.CALDAV_USERNAME }}
       CALDAV_PASSWORD: ${{ secrets.CALDAV_PASSWORD }}
       SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
     # Safe: digest_type is constrained to choice enum [weekly, daily, scheduled] — not free text
     # Note: "scheduled" → "--scheduled", "weekly" → "--weekly-digest", "daily" → "--daily-digest"
     run: |
       if [ "${{ inputs.digest_type }}" = "scheduled" ]; then
         node src/bot.js --scheduled ${{ inputs.dry_run == 'true' && '--dry-run' || '' }}
       else
         node src/bot.js --${{ inputs.digest_type }}-digest ${{ inputs.dry_run == 'true' && '--dry-run' || '' }}
       fi
   ```

**Environment variables:**
- `CALDAV_USERNAME` (from secrets)
- `CALDAV_PASSWORD` (from secrets)
- `SLACK_BOT_TOKEN` (from secrets)

**Command examples:**
```bash
# Scheduled (normal mode - runtime filtering)
node src/bot.js --scheduled

# Manual testing - force weekly digest to all channels
node src/bot.js --weekly-digest

# Manual testing - force daily digest to all channels
node src/bot.js --daily-digest

# Dry-run mode (no Slack API calls)
node src/bot.js --scheduled --dry-run
node src/bot.js --weekly-digest --dry-run
```

### Workflow 2: Webhook Handler

**File:** `.github/workflows/webhook.yml`

**Triggers:**
- `repository_dispatch`:
  - `types: [calendar_changed]`
- `workflow_dispatch`:
  - `test_payload` input (string, optional) - JSON test payload for testing webhook parsing
  - `dry_run` input (boolean, default false)

**Security note on `workflow_dispatch`:**
- The `test_payload` input allows manual testing of webhook payload parsing
- **Risk:** Anyone with repo write access can trigger this with arbitrary JSON
- **Mitigation:** This is acceptable for MVP because:
  - The repo is intended to be private (users fork privately, not publicly)
  - Only repo collaborators can trigger `workflow_dispatch`
  - The bot validates and sanitizes all inputs before processing
  - Worst case: invalid payload triggers full refresh fallback (logged, not executed)
  - No secrets are exposed - all credentials are in GitHub Secrets
- **Production consideration:** If the public template repo enables Actions, disable `workflow_dispatch` trigger on webhook.yml in the template (users add it in their private forks if needed for testing)

**Steps:**
1. Checkout code
2. Setup Node.js 20
3. Write config from secret:
   ```yaml
   - name: Write config
     env:
       CONFIG_JSON: ${{ secrets.CONFIG_JSON }}
     run: printf '%s' "$CONFIG_JSON" > config.json
   ```
4. Install dependencies (`npm ci`)
5. Run tests (`npm test`) - blocks workflow if tests fail
6. Handle event change

**Environment variables:**
- `CALDAV_USERNAME` (from secrets)
- `CALDAV_PASSWORD` (from secrets)
- `SLACK_BOT_TOKEN` (from secrets)
- `WEBHOOK_PAYLOAD` (from `inputs.test_payload` or `github.event.client_payload`)

**Command example:**
```bash
node src/bot.js --event-changed
```

**Sample test payload:**
```json
{
  "calendar_id": "team-calendar",
  "event_id": "event-12345",
  "change_type": "modified"
}
```

### GitHub Secrets Required

- `CALDAV_USERNAME` - Nextcloud CalDAV username
- `CALDAV_PASSWORD` - Nextcloud CalDAV password
- `SLACK_BOT_TOKEN` - Slack bot token (xoxb-...)
- `CONFIG_JSON` - Full contents of `config.json` file (entire JSON config as a single secret)

**Note on CONFIG_JSON:**
- Contains the complete configuration: calendars, channels, all settings
- Injected at runtime via `echo '${{ secrets.CONFIG_JSON }}' > config.json` as first workflow step
- Allows keeping the public repo clean (no instance-specific data) while users run private forks with their own config
- Users copy `config.example.json`, fill in their values, and paste the entire JSON as this secret

### Nextcloud Webhook Prerequisites

**CRITICAL:** Nextcloud does not send webhooks on calendar changes by default. The webhook flow will not work without additional Nextcloud configuration.

**Required Nextcloud apps (install ONE of these):**

1. **Workflow app** (recommended, built-in to most Nextcloud installations)
   - Navigate to Settings → Flow in Nextcloud admin
   - Create a new workflow:
     - Trigger: "Calendar event created or updated" (or similar, varies by Nextcloud version)
     - Action: "Send HTTP request"
     - URL: GitHub repository_dispatch endpoint (see configuration below)
     - Headers and body: see configuration below

2. **WebhookListener app** (alternative, requires separate installation)
   - Install from Nextcloud app store
   - Configure webhook endpoint for calendar events
   - Point to GitHub repository_dispatch endpoint

**Without one of these apps configured:**
- The event-changed workflow will never trigger
- Changes to calendar events will only appear in scheduled digests
- No real-time change notifications will be posted
- The bot will appear to work for scheduled digests but silently fail for webhooks

**This must be documented prominently in the README with setup instructions.**

### Nextcloud Webhook Configuration

**Webhook URL:**
```
https://api.github.com/repos/OWNER/REPO/dispatches
```

**Headers:**
- `Authorization: token GITHUB_PAT` (PAT stored in Nextcloud as webhook secret)
- `Accept: application/vnd.github.v3+json`
- `Content-Type: application/json`

**PAT Requirements:**
- Scope: Full `repo` scope required (the `repository_dispatch` API requires full repo access, not just read)
- Rotation: Rotate periodically (security best practice)
- Storage: Store in Nextcloud as webhook secret, NEVER in repo
- This PAT is the bridge between Nextcloud and GitHub - treat as sensitive credential

**Body:**
```json
{
  "event_type": "calendar_changed",
  "client_payload": {
    "calendar_id": "team-calendar",
    "event_id": "event-12345",
    "change_type": "modified"
  }
}
```

## Slack Setup

### Required Bot Token Scopes

- `canvases:write` - Update Canvas content
- `canvases:read` - Read Canvas content
- `chat:write` - Post messages to channels

### Slack Resources Needed

- Bot token (xoxb-...) stored in GitHub Secrets as `SLACK_BOT_TOKEN`
- Canvas IDs for each channel (configured in `config.json`)
- Channel IDs for each channel (configured in `config.json`)
- Optional: error notification channel ID (configured in `config.json`)

### Creating Slack Canvases

**Canvas is a Slack feature that must be created manually via Slack UI - it cannot be created via API.**

**Steps to create a Canvas and get its ID:**

1. **Open the Slack channel** where you want the calendar Canvas
2. **Create a new Canvas:**
   - Click the channel name at top to open channel details
   - Go to "Canvases" tab
   - Click "Create a canvas"
   - Give it a name (e.g., "Team Schedule")
   - The Canvas is now created and pinned to the channel
3. **Get the Canvas ID:**
   - Open the Canvas in Slack
   - Look at the URL in your browser: `https://app.slack.com/docs/TXXXXXXXX/FXXXXXXXXXX`
   - The Canvas ID is the second part starting with `F` (e.g., `F9876CANVAS`)
   - Alternatively, use the Slack API `canvases.list` method to list Canvas IDs for a channel
4. **Add Canvas ID to config.json** in the channel's `canvas_id` field

**Important:** Each channel needs its own Canvas. You cannot share a Canvas across multiple channels. Create one Canvas per channel you want to post calendars to.

**Troubleshooting:** If the bot cannot update a Canvas, verify:
- The Canvas ID is correct (starts with `F`)
- The bot has `canvases:write` and `canvases:read` scopes
- The bot is a member of the channel containing the Canvas

## Testing Strategy

### Automated Tests (Pure Functions Only)

**Test files:**
- `test/formatting.test.js` - test `renderWeekView()`, `renderChangeNotification()`, locale handling
- `test/diff.test.js` - test `diffEvents()` with various change scenarios
- `test/config.test.js` - test `validateConfig()` with valid/invalid configs
- `test/scheduler.test.js` - test `classifyUrgency()` with different event timings

**Framework:** Node.js built-in `node:test` module (no extra dependencies)

**Execution:**
```json
// package.json
{
  "scripts": {
    "test": "node --test test/**/*.test.js"
  }
}
```

**CI Integration:**
- Tests run in both workflows before main script
- Failing tests block the workflow - broken logic never reaches Slack
- Tests must complete in under 5 seconds
- No network calls in tests

### Integration Testing (Manual with Dry-Run)

**Dry-run mode:**
- CLI flag: `--dry-run`
- Runs full flow (config validation, CalDAV fetch, formatting)
- Skips all Slack API writes (no messages, no Canvas updates)
- Console output shows exactly what would be posted:
  ```
  [DRY RUN] Would post to #team-schedule:
  📅 Week 13 · Mon 25 Mar — Sun 31 Mar
  ...

  [DRY RUN] Would update Canvas F9876CANVAS with:
  ...

  [DRY RUN] No Slack API calls were made.
  ```

**Integration testing checklist:**

1. **Config validation:**
   - Test with missing required fields
   - Test with invalid calendar reference
   - Test with invalid locale
   - Test with missing environment variables

2. **Weekly/Daily digests:**
   - Run with `--dry-run` first, verify console output
   - Run without dry-run, verify Slack message and Canvas
   - Test multiple calendars in one channel (merged and separate views)
   - Test empty calendar (no events)
   - Test locale override (global vs channel-specific)

3. **Event change webhook:**
   - Use manual trigger with `test_payload`
   - Test parsing success → correct channel updated
   - Test parsing failure → fallback to full refresh + warning
   - Test debounce: trigger multiple changes within 5 minutes → bundled notification
   - Test cache miss → immediate posting without debounce

4. **Error handling:**
   - Test with invalid CalDAV URL → error to error_channel
   - Test with invalid Slack token → error in GitHub Actions log
   - Test with unreachable Nextcloud → graceful degradation
   - Test with invalid Canvas ID → clear error message

### Testing Scope

- **Automated tests:** Pure logic functions only
- **Integration tests:** Dry-run mode for full workflow validation
- **Not in MVP:** Automated tests for external service integrations (CalDAV, Slack API)
- **v2 consideration:** Automated integration tests with mocked services

## Repository Structure

```
calendar-slack-bot/
├── .github/
│   └── workflows/
│       ├── scheduled.yml       # Cron-triggered digests
│       └── webhook.yml          # Nextcloud webhook handler
├── src/
│   ├── bot.js                   # Main entry point
│   ├── config.js                # Configuration management
│   ├── caldav.js                # CalDAV operations
│   ├── slack.js                 # Slack API operations
│   ├── formatting.js            # Message/Canvas rendering
│   ├── diff.js                  # Event change detection
│   └── scheduler.js             # Urgency/debounce logic
├── test/
│   ├── formatting.test.js
│   ├── diff.test.js
│   ├── config.test.js
│   └── scheduler.test.js
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-03-25-calendar-slack-bot-design.md
├── config.example.json          # Example configuration (committed)
├── config.json                  # Actual configuration (gitignored)
├── package.json
├── package-lock.json
├── .gitignore                   # Node.js .gitignore
├── LICENSE                      # MIT license
└── README.md                    # Setup and usage documentation
```

**Gitignored:**
- `config.json` (instance-specific, injected at runtime via `CONFIG_JSON` GitHub Secret)
- `node_modules/`

**Committed:**
- `config.example.json` (template users copy and fill in)
- All source code
- All tests
- Workflows
- Documentation

**Config Injection Model:**

The public repository is a clean template with no instance-specific data. Users fork it privately and add their configuration via GitHub Secrets:

1. **Public repo:** Contains only `config.example.json` (template with placeholder values)
2. **Private fork:** User copies `config.example.json` to `config.json` locally, fills in their values
3. **GitHub Secret:** User pastes the entire `config.json` contents as the `CONFIG_JSON` secret
4. **Runtime:** First workflow step writes config: `echo '${{ secrets.CONFIG_JSON }}' > config.json`

**Intended usage models:**

- **Personal/team use:** Fork this repo privately, add your four GitHub Secrets (`CALDAV_USERNAME`, `CALDAV_PASSWORD`, `SLACK_BOT_TOKEN`, `CONFIG_JSON`), and you have your own running instance
- **Contributing:** Work against the public repo, never commit real config
- **Future hosted service:** Multi-tenant hosted version is a known long-term direction, tracked as v2+ consideration

This keeps the public repo clean while allowing users to run their own private instances with their own calendars, channels, and settings.

## Future Considerations (v2)

### Configuration Enhancements

- Per-calendar CalDAV credentials (multi-instance support)
- Configurable urgency thresholds per channel
- Configurable debounce window per channel
- Advanced notification rules (object format for `notifications` field)

### Feature Additions

- Recurring event handling improvements (support for complex RRULE patterns)
- Event filtering (show only specific event types per channel)
- Custom emoji for calendar source indicators
- Timezone-aware scheduling (digest times in local timezone instead of UTC)
- Event reminders (X minutes before event start)

### Technical Improvements

- Automated integration tests with mocked services
- Canvas update batching (reduce Slack API calls)
- Event cache expiration and cleanup strategy
- Webhook payload version detection and automatic parsing adjustment
- Rate limit handling improvements (retry logic, backoff)

## Design Rationale

### Why GitHub Actions?

- **Zero infrastructure:** No servers to maintain, no costs beyond GitHub usage
- **Built-in secrets management:** GitHub Secrets for credentials
- **Built-in cron scheduling:** Native cron triggers for digests
- **Built-in webhook receiver:** repository_dispatch for Nextcloud webhooks
- **Sufficient for calendar updates:** 5-minute debounce window is acceptable delay

### Why Channel-Centric Config?

- Channels own display settings (locale, view mode, digest schedule)
- Many-to-many mapping requires separating data sources (calendars) from display targets (channels)
- Easier to reason about: "What does #team-schedule show?" vs. "Where does Team Calendar post?"
- Extensibility: Easy to add new channels or reconfigure existing ones

### Why Debouncing?

- Prevents notification spam when multiple events change rapidly
- Common scenario: updating multiple events in Nextcloud calendar UI
- 5-minute window is long enough to catch related changes, short enough to feel responsive
- State persistence via cache makes this work across GitHub Actions runs

### Why MVP Hardcoded Thresholds?

- Keeps initial config simple and predictable
- Urgency logic is complex enough without parameterization
- Clear path to v2 configurability (constants block clearly marked)
- Future maintainer can see exactly where to add config fields

### Why Dry-Run Mode?

- Essential for safe testing without spamming real channels
- Validates full flow (config, CalDAV, formatting) without side effects
- Makes it easy to test locale changes, format adjustments, new features
- Low implementation cost, high value for maintainability

### Why Config Injection via GitHub Secret?

- Keeps the public repo clean (no instance-specific data, safe to publish)
- Users fork privately and add their own config as a secret
- Version control for config changes happens in the user's private fork, not the public template
- Future multi-tenant hosted service can replace this with a database-backed config model
- Simple model for single-instance deployments (the MVP use case)

## README Documentation Requirements

The README must prominently document:

1. **Nextcloud webhook prerequisites:**
   - Workflow app or WebhookListener app required
   - Step-by-step setup instructions for configuring calendar webhooks
   - Warning that the bot will appear to work for scheduled digests but silently fail for real-time notifications without this setup

2. **Usage model:**
   - Fork this repo privately (public fork exposes your config)
   - Add four GitHub Secrets: `CALDAV_USERNAME`, `CALDAV_PASSWORD`, `SLACK_BOT_TOKEN`, `CONFIG_JSON`
   - Copy `config.example.json`, fill in your values, paste as `CONFIG_JSON` secret
   - Workflows run automatically on schedule and webhook triggers

3. **Slack setup:**
   - Create a Slack app with required scopes: `canvases:write`, `canvases:read`, `chat:write`
   - Install to workspace, copy bot token
   - Create Canvas for each channel (Canvas is a Slack feature, not created by API)
   - Copy channel IDs and Canvas IDs for config

4. **GitHub PAT for webhook:**
   - Create PAT with full `repo` scope
   - Store in Nextcloud webhook configuration
   - Rotate periodically

5. **Digest schedules:**
   - Per-channel `digest_schedule` and `daily_digest_schedule` fields control when digests are posted
   - The bot uses runtime filtering - wakes up on workflow cron schedule and checks which channels need digests
   - Default workflow cron covers "sunday 18:00" and "weekdays 08:00" (UTC)
   - **MVP limitation:** Custom schedule times require adding matching cron expression to `.github/workflows/scheduled.yml`
   - Example: to add "friday 17:00" digests, add `- cron: '0 17 * * 5'` to workflow

6. **Testing:**
   - Use manual workflow triggers with `dry_run: true` to validate config without posting to Slack
   - Use `test_payload` input on webhook workflow to test webhook parsing
   - Use `digest_type: scheduled` for testing runtime filtering behavior
   - Use `digest_type: weekly` or `daily` to force digests to all channels (testing override)

## Success Criteria

- ✅ Zero infrastructure costs (runs entirely in GitHub Actions)
- ✅ Clear separation of concerns (each module has one responsibility)
- ✅ Fail-fast with actionable errors (maintainer knows exactly what to fix)
- ✅ Many-to-many calendar-to-channel mapping (supports complex team structures)
- ✅ Locale-aware formatting (German users see "Montag", US users see "Monday")
- ✅ Debounced notifications (prevents spam, bundles related changes)
- ✅ Graceful degradation (individual failures don't halt entire system)
- ✅ Safe testing with dry-run mode (validate changes without side effects)
- ✅ Human-readable config (maintainer with basic JSON knowledge can add mappings)
- ✅ Automated tests for core logic (formatting, diffing, config validation)
- ✅ Clear documentation (README explains setup, workflows explain behavior)

## References

- **Nextcloud CalDAV:** https://docs.nextcloud.com/server/latest/developer_manual/client_apis/WebDAV/
- **Slack API:** https://api.slack.com/
- **GitHub Actions:** https://docs.github.com/en/actions
- **node-ical:** https://www.npmjs.com/package/node-ical
- **@slack/web-api:** https://www.npmjs.com/package/@slack/web-api
- **@actions/cache:** https://www.npmjs.com/package/@actions/cache
