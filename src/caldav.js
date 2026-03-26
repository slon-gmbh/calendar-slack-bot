const ical = require('node-ical');

/**
 * Fetch calendar events from CalDAV endpoint
 * @param {string} caldavUrl - CalDAV calendar URL
 * @param {Object} credentials - { username, password }
 * @param {Object} dateRange - { start: Date, end: Date }
 * @param {string} timezone - IANA timezone (e.g., 'Europe/Berlin') for events without explicit timezone
 * @returns {Promise<Array>} Normalized event objects
 */
async function fetchCalendar(caldavUrl, credentials, dateRange, timezone = 'UTC') {
  try {
    // Fetch iCalendar data with basic auth
    const authHeader = 'Basic ' + Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64');

    const response = await fetch(caldavUrl, {
      headers: {
        'Authorization': authHeader,
        'Accept': 'text/calendar'
      }
    });

    if (!response.ok) {
      throw new Error(`CalDAV fetch failed: ${response.status} ${response.statusText}`);
    }

    const icalData = await response.text();

    // Parse with node-ical
    const events = await ical.async.parseICS(icalData);

    // Normalize events
    const normalized = [];
    for (const [uid, event] of Object.entries(events)) {
      if (event.type !== 'VEVENT') continue;

      // Handle recurring events
      if (event.rrule) {
        const instances = event.rrule.between(dateRange.start, dateRange.end, true);
        for (const instance of instances) {
          normalized.push(normalizeEvent(event, instance, timezone));
        }
      } else {
        // Single event
        normalized.push(normalizeEvent(event, null, timezone));
      }
    }

    return normalized;
  } catch (error) {
    console.error(`Failed to fetch calendar ${caldavUrl}:`, error.message);
    throw error;
  }
}

/**
 * Convert a date to proper UTC, handling node-ical's inconsistent timezone behavior
 * @param {Date} date - Date from node-ical (may or may not have .tz property)
 * @param {string} defaultTimezone - Timezone to use if date lacks .tz property
 * @returns {Date} Properly converted UTC date
 */
function convertToUTC(date, defaultTimezone) {
  if (!date) return null;

  const d = date instanceof Date ? date : new Date(date);

  // If node-ical attached a timezone, it already converted correctly to UTC
  if (d.tz) {
    return d;
  }

  // No timezone info - node-ical stored local time as if it were UTC
  // We need to interpret the time components as being in defaultTimezone
  // and convert to proper UTC
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const day = d.getUTCDate();
  const hours = d.getUTCHours();
  const minutes = d.getUTCMinutes();
  const seconds = d.getUTCSeconds();

  // Create a date string in the format: "2026-03-25T11:00:00"
  const localDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  // Use Intl.DateTimeFormat to get the UTC offset for this timezone at this date
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: defaultTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'longOffset'
  });

  // Parse the local time in the target timezone
  // This is a workaround: create a date object with the local time components
  // interpreted as being in the specified timezone
  const localDate = new Date(localDateStr);
  const utcDate = new Date(localDate.toLocaleString('en-US', { timeZone: 'UTC' }));
  const tzDate = new Date(localDate.toLocaleString('en-US', { timeZone: defaultTimezone }));
  const offset = tzDate.getTime() - utcDate.getTime();

  // Adjust the original date by the offset
  return new Date(d.getTime() - offset);
}

function normalizeEvent(icalEvent, instanceStart = null, timezone = 'UTC') {
  const start = instanceStart || icalEvent.start;
  const end = icalEvent.end || start;

  const normalized = {
    id: icalEvent.uid,
    title: icalEvent.summary || '(No title)',
    start: convertToUTC(start, timezone),
    end: convertToUTC(end, timezone),
    location: icalEvent.location || null,
    description: icalEvent.description || null,
    isAllDay: icalEvent.datetype === 'date'
  };

  // Debug logging
  console.log(`[DEBUG] Event: ${normalized.title}`);
  console.log(`  Raw start:`, start);
  console.log(`  Raw start tz property:`, start?.tz);
  console.log(`  Normalized start:`, normalized.start);
  console.log(`  ISO string:`, normalized.start.toISOString());
  console.log(`  isAllDay:`, normalized.isAllDay);

  return normalized;
}

module.exports = {
  fetchCalendar
};
