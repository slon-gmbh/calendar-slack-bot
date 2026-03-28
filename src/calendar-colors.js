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

  const cleaned = hex.replace(/^#/, '');

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
    h = s = 0;
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

  if (s < 10) {
    return '⬜';
  }

  if (h >= 0 && h < 30) return '🟥';
  if (h >= 30 && h < 70) return '🟧';
  if (h >= 70 && h < 160) return '🟨';
  if (h >= 160 && h < 200) return '🟩';
  if (h >= 200 && h < 270) return '🟦';
  if (h >= 270 && h < 330) return '🟪';
  if (h >= 330 && h <= 360) return '🟥';

  return '🟦';
}

module.exports = {
  mapHexToEmoji,
  parseHex,
  rgbToHsl
};
