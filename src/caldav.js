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
    const eventMap = new Map(); // Track events by ID to build composite structure

    for (const [uid, event] of Object.entries(events)) {
      if (event.type !== 'VEVENT') continue;

      // Handle recurring events
      if (event.rrule) {
        const instances = event.rrule.between(dateRange.start, dateRange.end, true);
        const eventInstances = [];

        for (const instance of instances) {
          // Get date string for comparison (YYYY-MM-DD)
          const instanceDateStr = instance.toISOString().substring(0, 10);

          // Skip if this instance is in EXDATE (deleted occurrence)
          if (event.exdate && event.exdate[instanceDateStr]) {
            continue;
          }

          // Skip if this instance has a RECURRENCE-ID override (modified occurrence)
          if (event.recurrences && event.recurrences[instanceDateStr]) {
            continue;
          }

          // Build instance object
          const singleInstance = normalizeEvent(event, instance, timezone);
          eventInstances.push(...singleInstance.instances);
        }

        // Add modified occurrences from RECURRENCE-ID
        if (event.recurrences) {
          for (const [dateStr, recurrence] of Object.entries(event.recurrences)) {
            // Only add if within date range
            const recStart = recurrence.start instanceof Date ? recurrence.start : new Date(recurrence.start);
            if (recStart >= dateRange.start && recStart <= dateRange.end) {
              const exceptionInstance = normalizeEvent(recurrence, null, timezone);
              exceptionInstance.instances[0].isException = true;
              eventInstances.push(...exceptionInstance.instances);
            }
          }
        }

        // Build composite event
        if (eventInstances.length > 0) {
          // Extract RRULE string (same logic as normalizeEvent)
          const rruleRaw = event.rrule.toString();
          const rruleLine = rruleRaw.split('\n').find(line => line.startsWith('RRULE:'));
          let rruleString = null;

          if (rruleLine) {
            rruleString = rruleLine.substring(6); // Skip "RRULE:"
          } else if (rruleRaw.startsWith('FREQ=')) {
            rruleString = rruleRaw; // Already in simple format
          }

          eventMap.set(event.uid, {
            id: event.uid,
            title: event.summary || '(No title)',
            location: event.location || null,
            description: event.description || null,
            isAllDay: event.datetype === 'date',
            rrule: rruleString,
            instances: eventInstances
          });
        }
      } else {
        // Single event
        const singleEvent = normalizeEvent(event, null, timezone);
        eventMap.set(event.uid, singleEvent);
      }
    }

    return Array.from(eventMap.values());
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

  // Validate that we have a valid date
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid date value: ${JSON.stringify(date)} (type: ${typeof date})`);
  }

  // If node-ical attached a timezone, it already converted correctly to UTC
  if (d.tz) {
    return d;
  }

  // No timezone info - node-ical seems to store time in an inconsistent way
  // We need to add the timezone offset to get the correct UTC time
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const day = d.getUTCDate();
  const hours = d.getUTCHours();
  const minutes = d.getUTCMinutes();
  const seconds = d.getUTCSeconds();
  const ms = d.getUTCMilliseconds();

  // Create a formatter to get the offset for this specific date/time in the target timezone
  const testDate = new Date(Date.UTC(year, month, day, 12, 0, 0)); // Use noon to avoid DST edge cases

  // Get the timezone offset in minutes
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: defaultTimezone,
    timeZoneName: 'shortOffset'
  });

  const parts = formatter.formatToParts(testDate);
  const offsetStr = parts.find(part => part.type === 'timeZoneName')?.value || '+00:00';

  // Parse offset string like "GMT+1" or "GMT-5"
  const offsetMatch = offsetStr.match(/GMT([+-])(\d+)(?::(\d+))?/);
  let offsetMinutes = 0;
  if (offsetMatch) {
    const sign = offsetMatch[1] === '+' ? 1 : -1;
    const offsetHours = parseInt(offsetMatch[2], 10);
    const offsetMins = parseInt(offsetMatch[3] || '0', 10);
    offsetMinutes = sign * (offsetHours * 60 + offsetMins);
  }

  // Debug logging for offset calculation (#7)
  // Convert from local time to UTC by SUBTRACTING the offset
  // E.g., 11:00 Berlin (UTC+2) → 11:00 - 2:00 = 09:00 UTC
  const resultUTC = new Date(Date.UTC(year, month, day, hours, minutes, seconds, ms) - offsetMinutes * 60000);
  console.log(`[TZ-CONVERT] Input=${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}T${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}, TZ=${defaultTimezone}, Offset=${offsetStr} (${offsetMinutes}min), Result=${resultUTC.toISOString()}`);

  // Add the offset to get proper UTC
  return resultUTC;
}

function normalizeEvent(icalEvent, instanceStart = null, timezone = 'UTC') {
  const start = instanceStart || icalEvent.start;

  // Calculate end time for recurring instances
  let end;
  if (instanceStart && icalEvent.end && icalEvent.start) {
    // Calculate duration from original event
    const originalStart = icalEvent.start instanceof Date ? icalEvent.start : new Date(icalEvent.start);
    const originalEnd = icalEvent.end instanceof Date ? icalEvent.end : new Date(icalEvent.end);
    const durationMs = originalEnd.getTime() - originalStart.getTime();

    // Apply duration to this instance
    const instanceDate = instanceStart instanceof Date ? instanceStart : new Date(instanceStart);
    end = new Date(instanceDate.getTime() + durationMs);
  } else {
    end = icalEvent.end || start;
  }

  const isAllDay = icalEvent.datetype === 'date';

  // Convert dates (all-day events skip timezone conversion)
  let normalizedStart, normalizedEnd;
  if (isAllDay) {
    normalizedStart = start instanceof Date ? start : new Date(start);
    normalizedEnd = end instanceof Date ? end : new Date(end);
  } else {
    // Debug logging for timezone conversion (#7)
    const startBeforeConversion = start instanceof Date ? start.toISOString() : new Date(start).toISOString();
    normalizedStart = convertToUTC(start, timezone);
    normalizedEnd = convertToUTC(end, timezone);
    console.log(`[TZ] Event "${icalEvent.summary}": Original=${startBeforeConversion}, Timezone=${timezone}, UTC=${normalizedStart.toISOString()}`);
  }

  // Validate dates
  if (isNaN(normalizedStart.getTime())) {
    throw new Error(`Invalid start date for event "${icalEvent.summary}": ${JSON.stringify(start)}`);
  }
  if (isNaN(normalizedEnd.getTime())) {
    throw new Error(`Invalid end date for event "${icalEvent.summary}": ${JSON.stringify(end)}`);
  }

  // Build instance object
  const instance = {
    start: normalizedStart,
    end: normalizedEnd,
    isException: false
  };

  // Return composite structure
  let rruleString = null;
  if (icalEvent.rrule) {
    const rruleRaw = icalEvent.rrule.toString();

    // Extract just the RRULE line from multi-line string (DTSTART + RRULE)
    // Example: "DTSTART;TZID=Europe/Berlin:20260128T200000\nRRULE:FREQ=WEEKLY;BYDAY=WE"
    const rruleLine = rruleRaw.split('\n').find(line => line.startsWith('RRULE:'));

    if (rruleLine) {
      // Remove "RRULE:" prefix to get just the parameters
      rruleString = rruleLine.substring(6); // Skip "RRULE:"
      console.log(`[CalDAV] Extracted RRULE for "${icalEvent.summary}": ${rruleString}`);
    } else if (rruleRaw.startsWith('FREQ=')) {
      // Already in simple format (from tests or some iCal implementations)
      rruleString = rruleRaw;
      console.log(`[CalDAV] Using simple RRULE for "${icalEvent.summary}": ${rruleString}`);
    } else {
      console.warn(`[CalDAV] No RRULE line found in: ${rruleRaw}`);
    }
  }

  const normalized = {
    id: icalEvent.uid,
    title: icalEvent.summary || '(No title)',
    location: icalEvent.location || null,
    description: icalEvent.description || null,
    isAllDay: isAllDay,
    rrule: rruleString,
    instances: [instance]
  };

  return normalized;
}

module.exports = {
  fetchCalendar,
  normalizeEvent
};
