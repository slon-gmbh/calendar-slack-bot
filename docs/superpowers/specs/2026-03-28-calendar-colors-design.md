# Calendar Color Matching Design

**Date:** 2026-03-28
**Issue:** #5 - Match calendar indicator colors to Nextcloud calendar colors
**Status:** Approved

## Problem

The bot currently assigns arbitrary emoji color indicators (🟦 🟩 🟨 🟧 🟪 🟥 ⬜) to calendars using hash-based assignment. These colors don't match the colors assigned to calendars in Nextcloud, creating confusion for users who expect consistent colors across both systems.

## Goals

1. Fetch calendar colors from Nextcloud CalDAV API
2. Map Nextcloud hex colors to closest Slack emoji indicators
3. Allow manual color overrides in config
4. Cache colors persistently to minimize API calls
5. Gracefully fall back to hash-based assignment on failures
6. Maintain consistent colors across all bot messages

## Non-Goals

- Dynamic emoji selection beyond the 7 available colors
- Supporting custom emoji or text-based color indicators
- Real-time color syncing (manual refresh only)
- UI for color management

## Architecture

### Approach: Hybrid Color Resolution

The system uses a three-tier fallback approach:

1. **Config override** - Manual color specification in config.json
2. **CalDAV fetch** - Automatic fetch from Nextcloud via PROPFIND
3. **Hash fallback** - Existing hash-based assignment

### New Module: `src/calendar-colors.js`

A dedicated module handles all color-related logic:

- Fetching colors from CalDAV API
- Hex-to-emoji color mapping
- Cache persistence and retrieval
- Unified interface for color resolution

This separation keeps concerns clean: `caldav.js` handles events, `calendar-colors.js` handles colors, and `formatting.js` uses both.

## Component Design

### calendar-colors.js

**Public API:**

```javascript
/**
 * Get the color indicator for a calendar
 * @param {string} calendarId - Calendar ID from config
 * @param {Object} config - Full config object
 * @param {Object} cache - Calendar state cache for this calendar
 * @returns {Promise<string>} Emoji indicator (e.g., '🟦')
 */
async function getCalendarColor(calendarId, config, cache)

/**
 * Clear cached colors (manual refresh trigger)
 * @param {string} calendarId - Calendar ID, or null for all calendars
 */
function clearColorCache(calendarId = null)
```

**Internal Functions:**

```javascript
// Fetch color from CalDAV via PROPFIND
async function fetchColorFromCalDAV(caldavUrl, credentials)

// Convert hex to emoji using hue ranges
function mapHexToEmoji(hexColor)

// RGB to HSL conversion helper
function rgbToHsl(r, g, b)

// Parse hex color string
function parseHex(hexString)
```

### Integration Point: formatting.js

The existing `assignCalendarIndicators(events)` function will be updated:

**Before:**
```javascript
function assignCalendarIndicators(events) {
  const uniqueCalendars = [...new Set(events.map(e => e.calendarName).filter(Boolean))];
  const indicatorMap = new Map();
  uniqueCalendars.forEach((cal) => {
    const index = hashCalendarName(cal);
    indicatorMap.set(cal, CALENDAR_INDICATORS[index]);
  });
  return indicatorMap;
}
```

**After:**
```javascript
async function assignCalendarIndicators(events, config, cacheMap) {
  const uniqueCalendars = [...new Set(events.map(e => e.calendarName).filter(Boolean))];
  const indicatorMap = new Map();

  for (const calName of uniqueCalendars) {
    const calendarId = findCalendarIdByName(calName, config);
    const cache = cacheMap.get(calendarId);
    const indicator = await getCalendarColor(calendarId, config, cache);
    indicatorMap.set(calName, indicator);
  }

  return indicatorMap;
}
```

## Data Flow

### Color Resolution Flow

```
getCalendarColor(calendarId, config, cache)
  |
  ├─> 1. Check config.calendars[calendarId].color
  |      └─> If exists: mapHexToEmoji(hexColor) → return emoji
  |
  ├─> 2. Check cache.color
  |      └─> If exists and valid: return cache.color.emoji
  |
  ├─> 3. Fetch from CalDAV
  |      ├─> fetchColorFromCalDAV(caldavUrl, credentials)
  |      ├─> If success: mapHexToEmoji(hexColor)
  |      ├─> Save to cache
  |      └─> return emoji
  |
  └─> 4. Fallback to hash-based assignment
         └─> hashCalendarName(calendarName) → return CALENDAR_INDICATORS[index]
```

### Cache Structure

Calendar state cache (cache-state branch) will be extended with a `color` field:

```json
{
  "timestamp": "2026-03-28T10:00:00Z",
  "events": [...],
  "color": {
    "hex": "#0082c9",
    "emoji": "🟦",
    "source": "caldav"
  }
}
```

**Fields:**
- `hex`: Original hex color from Nextcloud
- `emoji`: Mapped emoji indicator
- `source`: Where color came from (`"caldav"`, `"config"`, or `"hash"`)

### CalDAV PROPFIND Implementation

**Request:**

```http
PROPFIND /remote.php/dav/calendars/user/calendar-name/ HTTP/1.1
Host: nextcloud.example.com
Authorization: Basic <base64-credentials>
Depth: 0
Content-Type: application/xml

<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:apple="http://apple.com/ns/ical/">
  <d:prop>
    <apple:calendar-color/>
  </d:prop>
</d:propfind>
```

**Response:**

```xml
<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:apple="http://apple.com/ns/ical/">
  <d:response>
    <d:href>/remote.php/dav/calendars/user/calendar-name/</d:href>
    <d:propstat>
      <d:prop>
        <apple:calendar-color>#0082c9</apple:calendar-color>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>
```

**Parsing:**

Use `fast-xml-parser` to parse XML response and extract hex color from `calendar-color` element. If element is missing, return null.

## Color Mapping Algorithm

### Simple Hue-Based Mapping

The algorithm converts hex colors to HSL and maps by hue range:

**Step 1: Parse Hex to RGB**
```
#0082c9 → R=0, G=130, B=201
```

**Step 2: Convert RGB to HSL**
```
H = hue (0-360°)
S = saturation (0-100%)
L = lightness (0-100%)
```

**Step 3: Map to Emoji**

If `S < 10%` → ⬜ (gray/white regardless of hue)

Otherwise, map by hue:
- `0° - 30°` → 🟥 Red
- `30° - 70°` → 🟧 Orange
- `70° - 160°` → 🟨 Yellow
- `160° - 200°` → 🟩 Green
- `200° - 270°` → 🟦 Blue
- `270° - 330°` → 🟪 Purple
- `330° - 360°` → 🟥 Red

**Example Mappings:**
- `#0082c9` (Nextcloud blue) → H≈200°, S=100%, L=39% → 🟦
- `#ff0000` (red) → H=0°, S=100%, L=50% → 🟥
- `#00ff00` (green) → H=120°, S=100%, L=50% → 🟨
- `#cccccc` (gray) → H=0°, S=0%, L=80% → ⬜

## Configuration

### Config Override Format

Add optional `color` field to calendar config:

```json
{
  "calendars": {
    "team-calendar": {
      "name": "Team Calendar",
      "caldav_url": "https://nextcloud.example.com/remote.php/dav/calendars/user/team/",
      "color": "#0082c9"
    }
  }
}
```

**Validation:**
- Must be valid hex format: `#RRGGBB`
- Case-insensitive
- Will be mapped to emoji using same algorithm as CalDAV colors

## Error Handling

### Failure Scenarios

All errors fall back gracefully to hash-based assignment:

1. **Network errors** → Log warning, return null, use hash fallback
2. **Authentication failures** → Log error (may indicate config issue), use hash fallback
3. **Missing calendar-color property** → Silent fallback (normal case)
4. **XML parse errors** → Log warning, use hash fallback
5. **Invalid hex format** → Log warning with calendar name, use hash fallback
6. **Timeout (5 seconds)** → Log warning, use hash fallback

### Non-Blocking Behavior

Color fetching must never block message delivery:

- All async color fetches have 5-second timeout
- Errors are caught and logged, never thrown
- If color fetch fails, immediately fall back to hash-based assignment
- Formatting continues with fallback colors

### Cache Corruption

If cache contains color field but it's malformed:
- Treat as cache miss
- Re-fetch from CalDAV
- If fetch fails, use hash fallback

### Logging

**Info level:**
```
Fetched color #0082c9 → 🟦 for calendar 'Team' (source: caldav)
Using configured color #ff0000 → 🟥 for calendar 'Project X' (source: config)
```

**Warning level:**
```
Failed to fetch color for calendar 'Team': Network error
Using hash-based fallback for calendar 'Team' (source: hash)
Invalid hex color '#zzz' in config for 'Team', using hash fallback
```

**Debug level:**
```
Color mapping: #0082c9 → RGB(0,130,201) → HSL(200°,100%,39%) → 🟦
```

## Cache Management

### Cache Persistence

Colors are saved to calendar state cache immediately after CalDAV fetch succeeds. The cache is committed to the cache-state branch using existing cache persistence mechanisms.

### Cache Refresh Strategy

**Manual refresh only** - Colors are NOT automatically refreshed. Users must manually trigger refresh by:
1. Deleting the cache (delete cache-state branch)
2. Calling `clearColorCache()` if we expose an admin command

**Rationale:** Calendar colors rarely change. Automatic refresh adds complexity without significant benefit. Manual refresh is simple and sufficient.

### Cache Location

Colors are stored in the existing calendar state cache structure (cache-state branch), one cache file per calendar. This keeps all calendar metadata (events, colors) together.

## Testing Strategy

### Unit Tests

**calendar-colors.test.js:**
- `mapHexToEmoji()` with various hex inputs
  - Standard colors: #ff0000 → 🟥, #0000ff → 🟦
  - Edge cases: #000000, #ffffff, #cccccc
  - Invalid formats: malformed hex strings
- `rgbToHsl()` conversion accuracy
- `parseHex()` validation

**Integration with formatting.js:**
- Color resolution priority: config > caldav > hash
- Fallback behavior when color fetch fails
- Cache hit/miss scenarios

### Manual Testing

**Scenarios:**
1. New calendar (no cache) → Fetch from CalDAV → Cache
2. Cached color → Use cached emoji
3. Config override → Use config color
4. CalDAV fetch failure → Hash fallback
5. Invalid config color → Hash fallback
6. Calendar with no color property → Hash fallback
7. Multiple calendars with different colors → All resolve correctly

## Migration

### Backward Compatibility

Existing calendars will continue working with hash-based colors until:
- Colors are fetched from CalDAV on first use
- Or colors are manually configured

No breaking changes to existing config format.

### Gradual Rollout

1. Deploy new code
2. Colors will be fetched and cached as messages are formatted
3. Within 24 hours (typical bot activity), all active calendars will have colors cached
4. Users can manually configure colors in config.json if auto-fetch fails or they want specific colors

## Future Enhancements

Not in scope for this implementation, but possible future improvements:

- Admin command to manually refresh colors
- Config validation to check hex color format at startup
- Support for emoji overrides (directly specify emoji in config)
- Color contrast checking for accessibility

## Acceptance Criteria

- [ ] Calendar colors fetched from CalDAV API via PROPFIND
- [ ] Hex colors mapped to closest emoji indicator using hue ranges
- [ ] Colors cached persistently in calendar state cache
- [ ] Config option to override colors manually (hex format)
- [ ] Graceful fallback to hash-based assignment on failures
- [ ] Non-blocking: color fetch failures don't delay messages
- [ ] Consistent colors across digest and change notifications
- [ ] All error scenarios handled and logged appropriately
- [ ] Unit tests for color mapping and conversion functions
- [ ] Integration tests for color resolution flow
