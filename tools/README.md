# CalDAV Debug Tools

## analyze-caldav.js

Fetches raw iCal data from CalDAV endpoints to diagnose timezone and formatting issues.

### Usage

1. Create `config.json` in project root (copy from `config.example.json`)
2. Set environment variables:
   ```bash
   export CALDAV_USERNAME="your-username"
   export CALDAV_PASSWORD="your-password"
   ```
3. Run the analyzer:
   ```bash
   # Analyze all calendars
   node tools/analyze-caldav.js

   # Analyze specific calendar
   node tools/analyze-caldav.js team-calendar
   ```

### Output

- Console: Event summaries with raw DTSTART/DTEND/RRULE formats
- Files: Raw .ics data saved to `.caldav-debug/` directory

### What to Look For

When diagnosing Issue #16 (timezone bug):

1. **DTSTART format** for "EG | Eurythmie (mit Friederike)":
   - `DTSTART:20260415T110000` (floating time, no timezone)
   - `DTSTART;TZID=Europe/Berlin:20260415T110000` (timezone-aware)
   - `DTSTART:20260415T090000Z` (UTC)

2. **Expected behavior**:
   - Event at 11:00 Berlin time (CEST = UTC+2)
   - Should be stored as 09:00 UTC
   - Currently showing as 12:00 (stored as 10:00 UTC)

3. **RRULE format**:
   - Old cache: `DTSTART;TZID=Europe/Berlin:20260114T100000\nRRULE:FREQ=WEEKLY`
   - New format: `FREQ=WEEKLY;BYDAY=WE`
