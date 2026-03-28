# Calendar Color Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Match Nextcloud calendar colors to Slack emoji indicators via CalDAV API with config overrides and persistent caching

**Architecture:** New `calendar-colors.js` module handles color fetching (PROPFIND), hex-to-emoji mapping (hue-based), and cache management. Hybrid resolution: config override → cache lookup → CalDAV fetch → hash fallback. Integration via updated `assignCalendarIndicators()` in formatting.js.

**Tech Stack:** Node.js fetch API, fast-xml-parser for XML parsing, existing cache-state branch persistence

---

## File Structure

**New Files:**
- `src/calendar-colors.js` - Color resolution, CalDAV fetching, hex-to-emoji mapping
- `test/calendar-colors.test.js` - Unit tests for color module

**Modified Files:**
- `src/formatting.js` - Make `assignCalendarIndicators()` async, integrate color module
- `src/cache.js` - Add `color` field to cache structure
- `test/formatting.test.js` - Update tests for async color assignment
- `config.example.json` - Document `color` field

---

## Task 1: Hex to Emoji Color Mapping Core

**Files:**
- Create: `src/calendar-colors.js`
- Create: `test/calendar-colors.test.js`

- [ ] **Step 1: Write failing tests for hex-to-emoji mapping**

Create test file with basic color mapping tests:

```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const { mapHexToEmoji } = require('../src/calendar-colors.js');

test('mapHexToEmoji should map red hues to red emoji', () => {
  assert.equal(mapHexToEmoji('#ff0000'), '🟥'); // Pure red
  assert.equal(mapHexToEmoji('#cc0000'), '🟥'); // Dark red
  assert.equal(mapHexToEmoji('#ff3333'), '🟥'); // Light red
});

test('mapHexToEmoji should map blue hues to blue emoji', () => {
  assert.equal(mapHexToEmoji('#0082c9'), '🟦'); // Nextcloud blue
  assert.equal(mapHexToEmoji('#0000ff'), '🟦'); // Pure blue
  assert.equal(mapHexToEmoji('#3366cc'), '🟦'); // Medium blue
});

test('mapHexToEmoji should map green hues to green emoji', () => {
  assert.equal(mapHexToEmoji('#00ff00'), '🟩'); // Pure green (actually yellow range)
  assert.equal(mapHexToEmoji('#00aa00'), '🟩'); // Dark green
});

test('mapHexToEmoji should map orange hues to orange emoji', () => {
  assert.equal(mapHexToEmoji('#ff8800'), '🟧'); // Orange
  assert.equal(mapHexToEmoji('#ff9933'), '🟧'); // Light orange
});

test('mapHexToEmoji should map yellow hues to yellow emoji', () => {
  assert.equal(mapHexToEmoji('#ffff00'), '🟨'); // Pure yellow
  assert.equal(mapHexToEmoji('#cccc00'), '🟨'); // Dark yellow
});

test('mapHexToEmoji should map purple hues to purple emoji', () => {
  assert.equal(mapHexToEmoji('#aa00ff'), '🟪'); // Purple
  assert.equal(mapHexToEmoji('#9933cc'), '🟪'); // Medium purple
});

test('mapHexToEmoji should map gray/white to white emoji', () => {
  assert.equal(mapHexToEmoji('#cccccc'), '⬜'); // Gray
  assert.equal(mapHexToEmoji('#ffffff'), '⬜'); // White
  assert.equal(mapHexToEmoji('#f0f0f0'), '⬜'); // Light gray
});

test('mapHexToEmoji should handle uppercase hex', () => {
  assert.equal(mapHexToEmoji('#FF0000'), '🟥');
  assert.equal(mapHexToEmoji('#0082C9'), '🟦');
});

test('mapHexToEmoji should handle hex without hash', () => {
  assert.equal(mapHexToEmoji('ff0000'), '🟥');
  assert.equal(mapHexToEmoji('0082c9'), '🟦');
});

test('mapHexToEmoji should return null for invalid hex', () => {
  assert.equal(mapHexToEmoji('#zzz'), null);
  assert.equal(mapHexToEmoji('not-a-color'), null);
  assert.equal(mapHexToEmoji(''), null);
  assert.equal(mapHexToEmoji(null), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test test/calendar-colors.test.js
```

Expected: All tests FAIL with "Cannot find module '../src/calendar-colors.js'"

- [ ] **Step 3: Create calendar-colors.js with RGB/HSL helpers**

Create the module with helper functions:

```javascript
/**
 * Calendar color management module
 * Handles CalDAV color fetching, hex-to-emoji mapping, and caching
 */

/**
 * Parse hex color string to RGB values
 * @param {string} hex - Hex color like '#ff0000' or 'ff0000'
 * @returns {Object|null} {r, g, b} values 0-255, or null if invalid
 */
function parseHex(hex) {
  if (!hex) return null;

  // Remove # if present
  const cleaned = hex.replace(/^#/, '');

  // Validate format
  if (!/^[0-9a-f]{6}$/i.test(cleaned)) {
    return null;
  }

  const r = parseInt(cleaned.substring(0, 2), 16);
  const g = parseInt(cleaned.substring(2, 4), 16);
  const b = parseInt(cleaned.substring(4, 6), 16);

  return { r, g, b };
}

/**
 * Convert RGB to HSL
 * @param {number} r - Red 0-255
 * @param {number} g - Green 0-255
 * @param {number} b - Blue 0-255
 * @returns {Object} {h, s, l} where h=0-360, s=0-100, l=0-100
 */
function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h, s;
  const l = (max + min) / 2;

  if (max === min) {
    h = s = 0; // Achromatic (gray)
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100)
  };
}

/**
 * Map hex color to closest emoji indicator
 * @param {string} hexColor - Hex color like '#0082c9'
 * @returns {string|null} Emoji indicator or null if invalid
 */
function mapHexToEmoji(hexColor) {
  const rgb = parseHex(hexColor);
  if (!rgb) return null;

  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);

  // Gray/white detection (low saturation)
  if (s < 10) {
    return '⬜';
  }

  // Map by hue
  if (h >= 0 && h < 30) return '🟥';      // Red
  if (h >= 30 && h < 70) return '🟧';    // Orange
  if (h >= 70 && h < 160) return '🟨';   // Yellow
  if (h >= 160 && h < 200) return '🟩';  // Green
  if (h >= 200 && h < 270) return '🟦';  // Blue
  if (h >= 270 && h < 330) return '🟪';  // Purple
  if (h >= 330 && h <= 360) return '🟥'; // Red wrap-around

  // Fallback (shouldn't reach here)
  return '🟦';
}

module.exports = {
  mapHexToEmoji,
  parseHex,
  rgbToHsl
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test test/calendar-colors.test.js
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/calendar-colors.js test/calendar-colors.test.js
git commit -m "feat: add hex to emoji color mapping

- Parse hex colors to RGB
- Convert RGB to HSL for hue-based mapping
- Map hue ranges to emoji indicators
- Handle gray/white via saturation check
- Validate hex format and handle errors

refs: #5"
```

---

## Task 2: CalDAV PROPFIND Color Fetching

**Files:**
- Modify: `src/calendar-colors.js`
- Modify: `test/calendar-colors.test.js`

- [ ] **Step 1: Install fast-xml-parser dependency**

```bash
npm install fast-xml-parser
```

- [ ] **Step 2: Write failing test for CalDAV fetch (mock)**

Add to test file:

```javascript
const { fetchColorFromCalDAV } = require('../src/calendar-colors.js');

test('fetchColorFromCalDAV should parse color from XML response', async () => {
  // This is an integration-style test - we'll mock fetch in actual impl
  const mockXml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:apple="http://apple.com/ns/ical/">
  <d:response>
    <d:propstat>
      <d:prop>
        <apple:calendar-color>#0082c9</apple:calendar-color>
      </d:prop>
    </d:propstat>
  </d:response>
</d:multistatus>`;

  // For now, test the XML parsing directly
  const { XMLParser } = require('fast-xml-parser');
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_"
  });

  const result = parser.parse(mockXml);
  const color = result['d:multistatus']?['d:response']?.['d:propstat']?.['d:prop']?.['apple:calendar-color'];

  assert.equal(color, '#0082c9');
});

test('fetchColorFromCalDAV should return null on missing property', async () => {
  const mockXml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:propstat>
      <d:prop>
      </d:prop>
    </d:propstat>
  </d:response>
</d:multistatus>`;

  const { XMLParser } = require('fast-xml-parser');
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_"
  });

  const result = parser.parse(mockXml);
  const color = result['d:multistatus']?.['d:response']?.['d:propstat']?.['d:prop']?.['apple:calendar-color'];

  assert.equal(color, undefined);
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npm test test/calendar-colors.test.js
```

Expected: Tests FAIL with "Cannot find module 'fast-xml-parser'" initially, then PASS after install, but fetchColorFromCalDAV is not exported yet

- [ ] **Step 4: Implement CalDAV PROPFIND fetching**

Add to `src/calendar-colors.js`:

```javascript
const { XMLParser } = require('fast-xml-parser');

/**
 * Fetch calendar color from CalDAV via PROPFIND
 * @param {string} caldavUrl - CalDAV calendar URL
 * @param {Object} credentials - {username, password}
 * @returns {Promise<string|null>} Hex color or null
 */
async function fetchColorFromCalDAV(caldavUrl, credentials) {
  try {
    const propfindBody = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:apple="http://apple.com/ns/ical/">
  <d:prop>
    <apple:calendar-color/>
  </d:prop>
</d:propfind>`;

    const authHeader = 'Basic ' + Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

    const response = await fetch(caldavUrl, {
      method: 'PROPFIND',
      headers: {
        'Authorization': authHeader,
        'Depth': '0',
        'Content-Type': 'application/xml'
      },
      body: propfindBody,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`CalDAV PROPFIND failed for ${caldavUrl}: ${response.status} ${response.statusText}`);
      return null;
    }

    const xmlText = await response.text();

    // Parse XML response
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_"
    });

    const result = parser.parse(xmlText);

    // Navigate XML structure to find calendar-color
    const color = result['d:multistatus']?.['d:response']?.['d:propstat']?.['d:prop']?.['apple:calendar-color'];

    if (!color) {
      console.debug(`No calendar-color property found for ${caldavUrl}`);
      return null;
    }

    console.info(`Fetched color ${color} from CalDAV for ${caldavUrl}`);
    return color;

  } catch (error) {
    if (error.name === 'AbortError') {
      console.warn(`CalDAV PROPFIND timeout for ${caldavUrl}`);
    } else {
      console.warn(`CalDAV PROPFIND error for ${caldavUrl}:`, error.message);
    }
    return null;
  }
}

module.exports = {
  mapHexToEmoji,
  parseHex,
  rgbToHsl,
  fetchColorFromCalDAV
};
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test test/calendar-colors.test.js
```

Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/calendar-colors.js test/calendar-colors.test.js package.json package-lock.json
git commit -m "feat: add CalDAV PROPFIND color fetching

- Send PROPFIND request with calendar-color property
- Parse XML response using fast-xml-parser
- Handle network errors and timeouts (5s)
- Return null on failures for graceful fallback

refs: #5"
```

---

## Task 3: Cache Integration for Colors

**Files:**
- Modify: `src/cache.js`
- Modify: `src/calendar-colors.js`

- [ ] **Step 1: Read current cache structure**

```bash
cat src/cache.js
```

Understand how `saveCacheState()` and `loadCacheState()` work

- [ ] **Step 2: Update cache save to support color field**

Modify `saveCacheState()` in `src/cache.js` to accept optional color parameter:

```javascript
/**
 * Save calendar state to cache
 * @param {string} calendarId - Calendar ID
 * @param {Array} events - Normalized events
 * @param {Object} color - Optional: {hex, emoji, source}
 * @returns {Promise<void>}
 */
async function saveCacheState(calendarId, events, color = null) {
  const cacheData = {
    timestamp: new Date().toISOString(),
    events
  };

  if (color) {
    cacheData.color = color;
  }

  // ... rest of existing save logic
}
```

Update the function signature and add color to the cache object before JSON.stringify

- [ ] **Step 3: Add color loading helper to calendar-colors.js**

Add to `src/calendar-colors.js`:

```javascript
/**
 * Load color from cache
 * @param {Object} cache - Calendar cache object from loadCacheState()
 * @returns {string|null} Emoji indicator or null
 */
function loadColorFromCache(cache) {
  if (!cache || !cache.color) {
    return null;
  }

  const { emoji, hex, source } = cache.color;

  // Validate cache structure
  if (!emoji || typeof emoji !== 'string') {
    console.warn('Invalid color cache structure, missing emoji');
    return null;
  }

  console.debug(`Using cached color ${hex} → ${emoji} (source: ${source})`);
  return emoji;
}

/**
 * Create color cache object for saving
 * @param {string} hex - Hex color
 * @param {string} emoji - Emoji indicator
 * @param {string} source - 'caldav', 'config', or 'hash'
 * @returns {Object} Color cache object
 */
function createColorCacheObject(hex, emoji, source) {
  return { hex, emoji, source };
}

module.exports = {
  mapHexToEmoji,
  parseHex,
  rgbToHsl,
  fetchColorFromCalDAV,
  loadColorFromCache,
  createColorCacheObject
};
```

- [ ] **Step 4: Write test for cache helpers**

Add to `test/calendar-colors.test.js`:

```javascript
const { loadColorFromCache, createColorCacheObject } = require('../src/calendar-colors.js');

test('loadColorFromCache should return emoji from valid cache', () => {
  const cache = {
    timestamp: '2026-03-28T10:00:00Z',
    events: [],
    color: {
      hex: '#0082c9',
      emoji: '🟦',
      source: 'caldav'
    }
  };

  assert.equal(loadColorFromCache(cache), '🟦');
});

test('loadColorFromCache should return null for missing color', () => {
  const cache = {
    timestamp: '2026-03-28T10:00:00Z',
    events: []
  };

  assert.equal(loadColorFromCache(cache), null);
});

test('loadColorFromCache should return null for invalid structure', () => {
  const cache = {
    timestamp: '2026-03-28T10:00:00Z',
    events: [],
    color: {
      hex: '#0082c9',
      // missing emoji
      source: 'caldav'
    }
  };

  assert.equal(loadColorFromCache(cache), null);
});

test('createColorCacheObject should create proper structure', () => {
  const result = createColorCacheObject('#0082c9', '🟦', 'caldav');

  assert.deepEqual(result, {
    hex: '#0082c9',
    emoji: '🟦',
    source: 'caldav'
  });
});
```

- [ ] **Step 5: Run tests**

```bash
npm test test/calendar-colors.test.js
```

Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/cache.js src/calendar-colors.js test/calendar-colors.test.js
git commit -m "feat: add color caching support

- Extend cache structure with color field
- Add loadColorFromCache helper
- Add createColorCacheObject helper
- Validate cache structure on load

refs: #5"
```

---

## Task 4: Main Color Resolution Function

**Files:**
- Modify: `src/calendar-colors.js`
- Modify: `test/calendar-colors.test.js`

- [ ] **Step 1: Write test for getCalendarColor**

Add to `test/calendar-colors.test.js`:

```javascript
const { getCalendarColor } = require('../src/calendar-colors.js');

test('getCalendarColor should use config override first', async () => {
  const config = {
    calendars: {
      'test-cal': {
        name: 'Test Calendar',
        caldav_url: 'https://example.com/cal/',
        color: '#ff0000'
      }
    },
    caldav_credentials: { username: 'user', password: 'pass' }
  };

  const cache = null; // No cache

  const result = await getCalendarColor('test-cal', config, cache);
  assert.equal(result.emoji, '🟥');
  assert.equal(result.source, 'config');
});

test('getCalendarColor should use cache if available', async () => {
  const config = {
    calendars: {
      'test-cal': {
        name: 'Test Calendar',
        caldav_url: 'https://example.com/cal/'
      }
    },
    caldav_credentials: { username: 'user', password: 'pass' }
  };

  const cache = {
    color: {
      hex: '#0082c9',
      emoji: '🟦',
      source: 'caldav'
    }
  };

  const result = await getCalendarColor('test-cal', config, cache);
  assert.equal(result.emoji, '🟦');
  assert.equal(result.source, 'caldav');
});

test('getCalendarColor should fall back to hash if all else fails', async () => {
  const config = {
    calendars: {
      'test-cal': {
        name: 'Test Calendar',
        caldav_url: 'https://example.com/cal/'
      }
    },
    caldav_credentials: { username: 'user', password: 'pass' }
  };

  const cache = null;

  // fetchColorFromCalDAV will fail (no mock), so should fall back to hash
  const result = await getCalendarColor('test-cal', config, cache);
  assert.ok(result.emoji); // Should have an emoji
  assert.equal(result.source, 'hash');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test test/calendar-colors.test.js
```

Expected: Tests FAIL with "getCalendarColor is not a function"

- [ ] **Step 3: Implement getCalendarColor**

Add to `src/calendar-colors.js`:

```javascript
// Import hash function from formatting.js
const CALENDAR_INDICATORS = ['🟦', '🟩', '🟨', '🟧', '🟪', '🟥', '⬜'];

/**
 * Hash calendar name to consistent indicator index
 * @param {string} calendarName - Calendar name
 * @returns {number} Index in CALENDAR_INDICATORS array
 */
function hashCalendarName(calendarName) {
  let hash = 0;
  for (let i = 0; i < calendarName.length; i++) {
    hash = ((hash << 5) - hash) + calendarName.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash) % CALENDAR_INDICATORS.length;
}

/**
 * Get color indicator for a calendar (hybrid resolution)
 * Priority: config override → cache → CalDAV fetch → hash fallback
 * @param {string} calendarId - Calendar ID from config
 * @param {Object} config - Full config object
 * @param {Object} cache - Calendar state cache
 * @returns {Promise<Object>} {emoji, source, hex}
 */
async function getCalendarColor(calendarId, config, cache) {
  const calendarConfig = config.calendars[calendarId];
  if (!calendarConfig) {
    console.error(`Calendar ${calendarId} not found in config`);
    return { emoji: '🟦', source: 'hash', hex: null };
  }

  const calendarName = calendarConfig.name;

  // 1. Check config override
  if (calendarConfig.color) {
    const emoji = mapHexToEmoji(calendarConfig.color);
    if (emoji) {
      console.info(`Using configured color ${calendarConfig.color} → ${emoji} for calendar '${calendarName}' (source: config)`);
      return { emoji, source: 'config', hex: calendarConfig.color };
    } else {
      console.warn(`Invalid hex color '${calendarConfig.color}' in config for '${calendarName}', using fallback`);
    }
  }

  // 2. Check cache
  const cachedEmoji = loadColorFromCache(cache);
  if (cachedEmoji) {
    return { emoji: cachedEmoji, source: 'caldav', hex: cache.color.hex };
  }

  // 3. Fetch from CalDAV
  const caldavUrl = calendarConfig.caldav_url;
  const credentials = config.caldav_credentials;

  if (caldavUrl && credentials) {
    try {
      const hexColor = await fetchColorFromCalDAV(caldavUrl, credentials);
      if (hexColor) {
        const emoji = mapHexToEmoji(hexColor);
        if (emoji) {
          console.info(`Fetched color ${hexColor} → ${emoji} for calendar '${calendarName}' (source: caldav)`);
          return { emoji, source: 'caldav', hex: hexColor };
        }
      }
    } catch (error) {
      console.warn(`Failed to fetch color for '${calendarName}':`, error.message);
    }
  }

  // 4. Fallback to hash
  const index = hashCalendarName(calendarName);
  const emoji = CALENDAR_INDICATORS[index];
  console.info(`Using hash-based fallback for calendar '${calendarName}' → ${emoji} (source: hash)`);
  return { emoji, source: 'hash', hex: null };
}

module.exports = {
  mapHexToEmoji,
  parseHex,
  rgbToHsl,
  fetchColorFromCalDAV,
  loadColorFromCache,
  createColorCacheObject,
  getCalendarColor
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test test/calendar-colors.test.js
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/calendar-colors.js test/calendar-colors.test.js
git commit -m "feat: implement hybrid color resolution

- Priority: config > cache > caldav > hash
- Handle all fallback scenarios
- Log decisions for debugging
- Return emoji + source + hex for caching

refs: #5"
```

---

## Task 5: Integrate with formatting.js

**Files:**
- Modify: `src/formatting.js`
- Modify: `test/formatting.test.js`

- [ ] **Step 1: Update assignCalendarIndicators signature**

In `src/formatting.js`, find `assignCalendarIndicators()` and make it async:

```javascript
const { getCalendarColor, createColorCacheObject } = require('./calendar-colors.js');

/**
 * Assign color indicators to calendars
 * @param {Array} events - Events with calendarName property
 * @param {Object} config - Full config object
 * @param {Map} cacheMap - Map of calendarId to cache objects
 * @param {Function} saveCacheFn - Function to save cache: (calendarId, events, color) => Promise
 * @returns {Promise<Map>} Map of calendar name to indicator emoji
 */
async function assignCalendarIndicators(events, config, cacheMap, saveCacheFn) {
  const uniqueCalendars = [...new Set(events.map(e => e.calendarName).filter(Boolean))];

  const indicatorMap = new Map();

  for (const calendarName of uniqueCalendars) {
    // Find calendar ID by name
    const calendarId = Object.keys(config.calendars).find(
      id => config.calendars[id].name === calendarName
    );

    if (!calendarId) {
      console.warn(`Calendar name '${calendarName}' not found in config, using hash fallback`);
      const index = hashCalendarName(calendarName);
      indicatorMap.set(calendarName, CALENDAR_INDICATORS[index]);
      continue;
    }

    const cache = cacheMap.get(calendarId);
    const colorResult = await getCalendarColor(calendarId, config, cache);

    indicatorMap.set(calendarName, colorResult.emoji);

    // Save to cache if from CalDAV fetch
    if (colorResult.source === 'caldav' && colorResult.hex && saveCacheFn) {
      const colorCache = createColorCacheObject(colorResult.hex, colorResult.emoji, 'caldav');
      // Save cache is called by the caller with the color object
      // We'll need to update the caller to handle this
    }
  }

  return indicatorMap;
}
```

- [ ] **Step 2: Update all callers of assignCalendarIndicators**

Find all calls to `assignCalendarIndicators()` in `src/formatting.js`:
- `renderWeekView()`
- `renderDailyView()`
- `renderBundledNotification()`

Update each to await the call:

```javascript
// Before:
const calendarIndicators = assignCalendarIndicators(events);

// After:
const calendarIndicators = await assignCalendarIndicators(events, config, cacheMap, saveCacheFn);
```

Make all calling functions async if they aren't already.

- [ ] **Step 3: Update function exports to be async**

Update module.exports in `src/formatting.js`:

```javascript
module.exports = {
  formatEventTime,
  renderWeekView,  // Now async
  renderChangeNotification,
  renderBundledNotification,  // Now async
  renderDailyView,  // Now async
  renderCanvasContent  // Now async
};
```

- [ ] **Step 4: Update tests to await async calls**

In `test/formatting.test.js`, find tests that call rendering functions and add `await`:

```javascript
// Before:
const result = renderWeekView(events, dateRange, 'en-US', options);

// After:
const result = await renderWeekView(events, dateRange, 'en-US', options);
```

Add `async` to all test functions that need it:

```javascript
test('renderWeekView should generate week digest', async () => {
  // ... test code
});
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test test/formatting.test.js
```

Expected: All tests PASS (may need to fix specific tests individually)

- [ ] **Step 6: Commit**

```bash
git add src/formatting.js test/formatting.test.js
git commit -m "feat: integrate color resolution into formatting

- Make assignCalendarIndicators async
- Accept config and cache parameters
- Call getCalendarColor for each calendar
- Update all callers to await
- Update tests for async behavior

refs: #5"
```

---

## Task 6: Update Bot Integration Points

**Files:**
- Modify: `src/bot.js` (or wherever formatting functions are called)

- [ ] **Step 1: Find all bot integration points**

```bash
grep -r "renderWeekView\|renderBundledNotification\|renderDailyView" src/
```

Identify where these functions are called from the bot code

- [ ] **Step 2: Update bot.js to pass config and cache**

For each call site, update to pass required parameters:

```javascript
// Before:
const message = renderWeekView(events, dateRange, locale, options);

// After:
const config = await loadConfig();
const cacheMap = new Map();
// Load cache for each calendar
for (const calendarId of Object.keys(config.calendars)) {
  const cache = await loadCacheState(calendarId);
  if (cache) {
    cacheMap.set(calendarId, cache);
  }
}

const message = await renderWeekView(events, dateRange, locale, { ...options, config, cacheMap });
```

Note: The exact changes depend on the bot.js structure. Adapt as needed.

- [ ] **Step 3: Test bot locally**

```bash
node src/bot.js
```

Verify bot starts without errors and can send messages with correct colors

- [ ] **Step 4: Commit**

```bash
git add src/bot.js
git commit -m "feat: pass config and cache to formatting functions

- Load config before formatting
- Build cacheMap from loaded caches
- Pass to all rendering functions
- Enable color resolution in bot

refs: #5"
```

---

## Task 7: Update Config Example

**Files:**
- Modify: `config.example.json`

- [ ] **Step 1: Add color field to example config**

Update `config.example.json`:

```json
{
  "locale": "en-US",
  "timezone": "UTC",
  "error_channel": "C01234ERROR",
  "caldav_credentials": {
    "username": "${CALDAV_USERNAME}",
    "password": "${CALDAV_PASSWORD}"
  },
  "calendars": {
    "team-calendar": {
      "name": "Team Calendar",
      "caldav_url": "https://nextcloud.example.com/remote.php/dav/calendars/user/team/",
      "color": "#0082c9"
    },
    "project-x": {
      "name": "Project X",
      "caldav_url": "https://nextcloud.example.com/remote.php/dav/calendars/user/project-x/"
    }
  },
  "channels": [...]
}
```

Add comment explaining color field:

```json
{
  "calendars": {
    "team-calendar": {
      "name": "Team Calendar",
      "caldav_url": "https://nextcloud.example.com/remote.php/dav/calendars/user/team/",
      "color": "#0082c9"  // Optional: Override calendar color (hex format)
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add config.example.json
git commit -m "docs: add color field to config example

- Show optional color override
- Explain hex format requirement
- refs: #5"
```

---

## Task 8: Integration Testing

**Files:**
- Modify: `test/formatting.test.js`

- [ ] **Step 1: Add integration test for color matching**

Add comprehensive test to `test/formatting.test.js`:

```javascript
test('assignCalendarIndicators should match Nextcloud colors via config', async () => {
  const events = [
    {
      id: 'e1',
      title: 'Blue Event',
      start: new Date('2026-03-28T10:00:00Z'),
      calendarName: 'Blue Calendar'
    },
    {
      id: 'e2',
      title: 'Red Event',
      start: new Date('2026-03-28T11:00:00Z'),
      calendarName: 'Red Calendar'
    }
  ];

  const config = {
    calendars: {
      'blue-cal': {
        name: 'Blue Calendar',
        caldav_url: 'https://example.com/blue/',
        color: '#0082c9'
      },
      'red-cal': {
        name: 'Red Calendar',
        caldav_url: 'https://example.com/red/',
        color: '#ff0000'
      }
    },
    caldav_credentials: { username: 'user', password: 'pass' }
  };

  const cacheMap = new Map();

  const { assignCalendarIndicators } = require('../src/formatting.js');
  const indicators = await assignCalendarIndicators(events, config, cacheMap, null);

  assert.equal(indicators.get('Blue Calendar'), '🟦');
  assert.equal(indicators.get('Red Calendar'), '🟥');
});

test('assignCalendarIndicators should use cached colors', async () => {
  const events = [
    {
      id: 'e1',
      title: 'Cached Event',
      start: new Date('2026-03-28T10:00:00Z'),
      calendarName: 'Cached Calendar'
    }
  ];

  const config = {
    calendars: {
      'cached-cal': {
        name: 'Cached Calendar',
        caldav_url: 'https://example.com/cached/'
      }
    },
    caldav_credentials: { username: 'user', password: 'pass' }
  };

  const cacheMap = new Map([
    ['cached-cal', {
      color: {
        hex: '#00ff00',
        emoji: '🟩',
        source: 'caldav'
      }
    }]
  ]);

  const { assignCalendarIndicators } = require('../src/formatting.js');
  const indicators = await assignCalendarIndicators(events, config, cacheMap, null);

  assert.equal(indicators.get('Cached Calendar'), '🟩');
});

test('assignCalendarIndicators should fall back to hash for unknown calendars', async () => {
  const events = [
    {
      id: 'e1',
      title: 'Unknown Event',
      start: new Date('2026-03-28T10:00:00Z'),
      calendarName: 'Unknown Calendar'
    }
  ];

  const config = {
    calendars: {},
    caldav_credentials: { username: 'user', password: 'pass' }
  };

  const cacheMap = new Map();

  const { assignCalendarIndicators } = require('../src/formatting.js');
  const indicators = await assignCalendarIndicators(events, config, cacheMap, null);

  // Should have some emoji (hash-based)
  const emoji = indicators.get('Unknown Calendar');
  assert.ok(emoji);
  assert.ok(['🟦', '🟩', '🟨', '🟧', '🟪', '🟥', '⬜'].includes(emoji));
});
```

- [ ] **Step 2: Run all tests**

```bash
npm test
```

Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add test/formatting.test.js
git commit -m "test: add integration tests for color matching

- Test config override colors
- Test cached colors
- Test hash fallback
- refs: #5"
```

---

## Task 9: Manual Testing and Verification

**Files:**
- None (manual testing)

- [ ] **Step 1: Test with real Nextcloud instance**

1. Set up config.json with real Nextcloud CalDAV URL
2. Run bot manually
3. Verify colors are fetched from Nextcloud
4. Check logs for "Fetched color #... → 🟦"

- [ ] **Step 2: Test config override**

1. Add `color` field to a calendar in config.json
2. Restart bot
3. Verify override color is used
4. Check logs for "Using configured color"

- [ ] **Step 3: Test cache persistence**

1. Run bot, let it fetch colors
2. Stop bot
3. Check cache-state branch for color fields
4. Restart bot
5. Verify cached colors are used without refetching

- [ ] **Step 4: Test fallback behavior**

1. Configure invalid CalDAV URL
2. Run bot
3. Verify hash-based fallback works
4. Check logs for warnings

- [ ] **Step 5: Document findings**

Create issue comment on #5 with test results

---

## Task 10: Final Documentation and Cleanup

**Files:**
- Create: `docs/calendar-colors.md`

- [ ] **Step 1: Write user documentation**

Create `docs/calendar-colors.md`:

```markdown
# Calendar Color Matching

The bot matches Slack emoji indicators to your Nextcloud calendar colors.

## How It Works

Colors are resolved using this priority:

1. **Config Override** - Manually specify color in config.json
2. **CalDAV Fetch** - Automatically fetch from Nextcloud
3. **Cache** - Use previously fetched color
4. **Hash Fallback** - Consistent color based on calendar name

## Configuration

### Automatic Colors (Recommended)

The bot automatically fetches calendar colors from Nextcloud via CalDAV:

```json
{
  "calendars": {
    "team-calendar": {
      "name": "Team Calendar",
      "caldav_url": "https://nextcloud.example.com/remote.php/dav/calendars/user/team/"
    }
  }
}
```

Colors are cached after first fetch and persist across bot restarts.

### Manual Color Override

Override automatic colors by specifying hex values:

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

## Supported Colors

The bot maps colors to these emoji indicators:

- 🟥 Red - Hue 0-30° and 330-360°
- 🟧 Orange - Hue 30-70°
- 🟨 Yellow - Hue 70-160°
- 🟩 Green - Hue 160-200°
- 🟦 Blue - Hue 200-270°
- 🟪 Purple - Hue 270-330°
- ⬜ Gray/White - Low saturation colors

## Refreshing Colors

Colors are cached permanently. To refresh:

1. Delete the cache-state branch
2. Restart the bot

Future versions may include a refresh command.

## Troubleshooting

### Colors Don't Match

Check bot logs for warnings:
- "Failed to fetch color" - Network or auth issue
- "Invalid hex color" - Check config format
- "Using hash-based fallback" - CalDAV fetch failed

### Authentication Errors

Verify CalDAV credentials in config:
```json
{
  "caldav_credentials": {
    "username": "your-username",
    "password": "your-app-password"
  }
}
```

Use an app-specific password, not your main Nextcloud password.
```

- [ ] **Step 2: Commit documentation**

```bash
git add docs/calendar-colors.md
git commit -m "docs: add calendar color matching guide

- Explain color resolution priority
- Document config options
- List supported colors
- Add troubleshooting tips

refs: #5"
```

- [ ] **Step 3: Update main README if needed**

Add section about calendar colors to main README.md

- [ ] **Step 4: Final commit**

```bash
git add README.md
git commit -m "docs: update README with calendar color feature

refs: #5"
```

---

## Self-Review Checklist

Before marking complete, verify:

- [ ] All spec requirements implemented (CalDAV fetch, hex-to-emoji mapping, cache, config override, fallback)
- [ ] No placeholders or TODOs in code
- [ ] All functions have consistent naming across tasks
- [ ] Tests cover success and failure paths
- [ ] Error handling is comprehensive and non-blocking
- [ ] Logging provides useful debug info
- [ ] Documentation is complete and clear
- [ ] All commits reference issue #5

---

## Completion

Once all tasks are complete:

1. Run full test suite: `npm test`
2. Test manually with real Nextcloud instance
3. Update issue #5 with test results
4. Request code review if applicable
5. Close issue #5 after merge
