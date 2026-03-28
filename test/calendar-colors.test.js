const { test } = require('node:test');
const assert = require('node:assert');
const { mapHexToEmoji, fetchColorFromCalDAV } = require('../src/calendar-colors.js');

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

test('mapHexToEmoji should map yellow-range hues (70-160°) to yellow emoji', () => {
  assert.equal(mapHexToEmoji('#00ff00'), '🟨'); // h=120° falls in yellow range
  assert.equal(mapHexToEmoji('#00aa00'), '🟨'); // h=120° falls in yellow range
});

test('mapHexToEmoji should map orange hues to orange emoji', () => {
  assert.equal(mapHexToEmoji('#ff8800'), '🟧'); // Orange
  assert.equal(mapHexToEmoji('#ff9933'), '🟧'); // Light orange
});

test('mapHexToEmoji should map orange-range hues (30-70°) to orange emoji', () => {
  assert.equal(mapHexToEmoji('#ffff00'), '🟧'); // h=60° falls in orange range
  assert.equal(mapHexToEmoji('#cccc00'), '🟧'); // h=60° falls in orange range
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

test('fetchColorFromCalDAV should parse color from XML response', async () => {
  const { XMLParser } = require('fast-xml-parser');

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

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_"
  });

  const result = parser.parse(mockXml);
  const color = result['d:multistatus']?.['d:response']?.['d:propstat']?.['d:prop']?.['apple:calendar-color'];

  assert.equal(color, '#0082c9');
});

test('fetchColorFromCalDAV should return null on missing property', async () => {
  const { XMLParser } = require('fast-xml-parser');

  const mockXml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:propstat>
      <d:prop>
      </d:prop>
    </d:propstat>
  </d:response>
</d:multistatus>`;

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_"
  });

  const result = parser.parse(mockXml);
  const color = result['d:multistatus']?.['d:response']?.['d:propstat']?.['d:prop']?.['apple:calendar-color'];

  assert.equal(color, undefined);
});

test('fetchColorFromCalDAV should fetch and parse color from CalDAV endpoint', async () => {
  const mockResponse = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:apple="http://apple.com/ns/ical/">
  <d:response>
    <d:propstat>
      <d:prop>
        <apple:calendar-color>#0082c9</apple:calendar-color>
      </d:prop>
    </d:propstat>
  </d:response>
</d:multistatus>`;

  const originalFetch = global.fetch;
  let fetchCalled = false;
  let fetchOptions = null;

  global.fetch = async (url, options) => {
    fetchCalled = true;
    fetchOptions = options;
    return {
      ok: true,
      text: async () => mockResponse
    };
  };

  const color = await fetchColorFromCalDAV('https://example.com/calendar', {
    username: 'user',
    password: 'pass'
  });

  global.fetch = originalFetch;

  assert.equal(color, '#0082c9');
  assert.equal(fetchCalled, true);
  assert.equal(fetchOptions.method, 'PROPFIND');
});

test('fetchColorFromCalDAV should return null on network error', async () => {
  const originalFetch = global.fetch;

  global.fetch = async () => {
    throw new Error('Network error');
  };

  const color = await fetchColorFromCalDAV('https://example.com/calendar', {
    username: 'user',
    password: 'pass'
  });

  global.fetch = originalFetch;

  assert.equal(color, null);
});

test('fetchColorFromCalDAV should return null on non-ok response', async () => {
  const originalFetch = global.fetch;

  global.fetch = async () => {
    return {
      ok: false,
      status: 404,
      statusText: 'Not Found'
    };
  };

  const color = await fetchColorFromCalDAV('https://example.com/calendar', {
    username: 'user',
    password: 'pass'
  });

  global.fetch = originalFetch;

  assert.equal(color, null);
});
