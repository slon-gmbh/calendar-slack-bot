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
  assert.equal(mapHexToEmoji('#00ff00'), '🟨'); // Pure green (h=120 is in yellow range 70-160)
  assert.equal(mapHexToEmoji('#00aa00'), '🟨'); // Dark green (h=120 is in yellow range 70-160)
});

test('mapHexToEmoji should map orange hues to orange emoji', () => {
  assert.equal(mapHexToEmoji('#ff8800'), '🟧'); // Orange
  assert.equal(mapHexToEmoji('#ff9933'), '🟧'); // Light orange
});

test('mapHexToEmoji should map yellow hues to yellow emoji', () => {
  assert.equal(mapHexToEmoji('#ffff00'), '🟧'); // Pure yellow (h=60 is in orange range 30-70)
  assert.equal(mapHexToEmoji('#cccc00'), '🟧'); // Dark yellow (h=60 is in orange range 30-70)
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
