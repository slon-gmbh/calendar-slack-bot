const ical = require('node-ical');

/**
 * Fetch calendar events from CalDAV endpoint
 * @param {string} caldavUrl - CalDAV calendar URL
 * @param {Object} credentials - { username, password }
 * @param {Object} dateRange - { start: Date, end: Date }
 * @returns {Promise<Array>} Normalized event objects
 */
async function fetchCalendar(caldavUrl, credentials, dateRange) {
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
          normalized.push(normalizeEvent(event, instance));
        }
      } else {
        // Single event
        normalized.push(normalizeEvent(event));
      }
    }

    return normalized;
  } catch (error) {
    console.error(`Failed to fetch calendar ${caldavUrl}:`, error.message);
    throw error;
  }
}

function normalizeEvent(icalEvent, instanceStart = null) {
  const start = instanceStart || icalEvent.start;
  const end = icalEvent.end || start;

  return {
    id: icalEvent.uid,
    title: icalEvent.summary || '(No title)',
    start: start instanceof Date ? start : new Date(start),
    end: end instanceof Date ? end : new Date(end),
    location: icalEvent.location || null,
    description: icalEvent.description || null,
    isAllDay: icalEvent.datetype === 'date'
  };
}

module.exports = {
  fetchCalendar
};
