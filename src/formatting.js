/**
 * Formatting and rendering module for digest messages and Canvas content
 */

const { CALENDAR_INDICATORS, hashCalendarName, getCalendarColor, createColorCacheObject } = require('./calendar-colors');

/**
 * Parse RRULE string into components
 * @param {string} rrule - RRULE string
 * @returns {Object} Parsed components
 */
function parseRRule(rrule) {
  if (!rrule) return null;

  const parts = rrule.split(';');
  const parsed = {};

  for (const part of parts) {
    const [key, value] = part.split('=');
    parsed[key] = value;
  }

  return parsed;
}

/**
 * Parse positional day pattern (e.g., "2MO" = 2nd Monday, "-1FR" = last Friday)
 * @param {string} byDay - BYDAY value (e.g., "2MO", "-1FR")
 * @param {Object} dayMap - Day abbreviation mapping
 * @returns {string|null} Formatted positional text or null if not positional
 */
function parsePositionalDay(byDay, dayMap) {
  const positionalMatch = byDay.match(/^(-?\d+)([A-Z]{2})$/);
  if (positionalMatch) {
    const [, position, day] = positionalMatch;
    const posText = position === '-1' ? 'letzter' : `${position}.`;
    return `${posText} ${dayMap[day] || day}`;
  }
  return null;
}

/**
 * Format recurrence pattern as human-readable German text
 * @param {string|null} rrule - RRULE string (e.g., "FREQ=WEEKLY;BYDAY=MO,WE")
 * @param {string} locale - Locale (currently only de-DE supported)
 * @returns {string|null} Human-readable recurrence pattern
 */
function formatRecurrencePattern(rrule, locale = 'de-DE') {
  if (!rrule) return null;

  // Currently only de-DE supported
  if (locale !== 'de-DE') {
    console.warn(`formatRecurrencePattern: Unsupported locale "${locale}", falling back to de-DE`);
  }

  try {
    const parsed = parseRRule(rrule);
    if (!parsed || !parsed.FREQ) {
      return 'Wiederholend'; // Fallback for invalid RRULE
    }

    const freq = parsed.FREQ;
    const interval = parseInt(parsed.INTERVAL || '1', 10);
    const byDay = parsed.BYDAY;
    const byMonthDay = parsed.BYMONTHDAY;
    const byMonth = parsed.BYMONTH;
    const count = parsed.COUNT;
    const until = parsed.UNTIL;

    // Day abbreviations mapping (de-DE)
    const dayMap = {
      'MO': 'Mo.', 'TU': 'Di.', 'WE': 'Mi.', 'TH': 'Do.',
      'FR': 'Fr.', 'SA': 'Sa.', 'SU': 'So.'
    };

    // Month abbreviations mapping (de-DE)
    const monthMap = {
      '1': 'Jan.', '2': 'Feb.', '3': 'März', '4': 'Apr.',
      '5': 'Mai', '6': 'Juni', '7': 'Juli', '8': 'Aug.',
      '9': 'Sept.', '10': 'Okt.', '11': 'Nov.', '12': 'Dez.'
    };

    let base = '';
    let details = '';

    // Build base frequency text
    if (freq === 'DAILY') {
      base = interval === 1 ? 'Täglich' : `Alle ${interval} Tage`;
    } else if (freq === 'WEEKLY') {
      base = interval === 1 ? 'Wöchentlich' : `Alle ${interval} Wochen`;
    } else if (freq === 'MONTHLY') {
      base = interval === 1 ? 'Monatlich' : `Alle ${interval} Monate`;
    } else if (freq === 'YEARLY') {
      base = interval === 1 ? 'Jährlich' : `Alle ${interval} Jahre`;
    } else {
      return 'Wiederholend';
    }

    // Add day/date details
    if (byDay) {
      // Check for positional patterns (e.g., "2MO" = 2nd Monday)
      const positionalText = parsePositionalDay(byDay, dayMap);
      if (positionalText) {
        details = positionalText;
      } else {
        // Multiple days (e.g., "MO,WE,FR")
        const days = byDay.split(',').map(d => dayMap[d] || d);
        details = days.join(', ');
      }
    } else if (byMonthDay) {
      details = `${byMonthDay}.`;
    }

    // Add month for yearly patterns
    if (freq === 'YEARLY' && byMonth) {
      const monthName = monthMap[byMonth] || byMonth;
      if (byDay) {
        const positionalText = parsePositionalDay(byDay, dayMap);
        if (positionalText) {
          details = `${positionalText} im ${monthName}`;
        }
      } else if (byMonthDay) {
        details = `${byMonthDay}. ${monthName}`;
      } else {
        details = monthName;
      }
    }

    // Build result
    let result = details ? `${base}, ${details}` : base;

    // Add end condition
    if (count) {
      result += ` (${count}×)`;
    } else if (until) {
      // Parse UNTIL date (format: YYYYMMDDTHHMMSSZ)
      const match = until.match(/^(\d{4})(\d{2})(\d{2})/);
      if (match) {
        const [, year, month, day] = match;
        const untilDate = new Date(`${year}-${month}-${day}`);
        const formatted = new Intl.DateTimeFormat(locale, {
          day: 'numeric',
          month: 'short',
          year: 'numeric'
        }).format(untilDate);
        result += ` (bis ${formatted})`;
      }
    }

    return result;
  } catch (error) {
    console.warn('Failed to parse RRULE:', rrule, error.message);
    return 'Wiederholend';
  }
}

/**
 * Locale-specific translations
 */
const TRANSLATIONS = {
  'de-DE': {
    week: 'KW',
    weekOverview: 'Wochenübersicht',
    events: 'Termine',
    event: 'Termin',
    calendars: 'Kalender',
    calendar: 'Kalender',
    fullSchedule: 'Komplette Übersicht →',
    nothingScheduled: '(nichts geplant)',
    today: 'Heute',
    tomorrow: 'Morgen',
    new: 'Neu',
    cancelled: 'Abgesagt',
    moved: 'Verschoben',
    updated: 'Aktualisiert',
    renamed: 'umbenannt',
    locationChanged: 'Ort geändert',
    calendarChanges: 'Kalenderänderungen',
    newEvents: 'neue',
    cancelledEvents: 'abgesagt',
    modifiedEvents: 'geändert',
    allDay: 'Ganztägig'
  },
  'en-US': {
    week: 'Week',
    weekOverview: 'Week Overview',
    events: 'events',
    event: 'event',
    calendars: 'calendars',
    calendar: 'calendar',
    fullSchedule: 'Full schedule →',
    nothingScheduled: '(nothing scheduled)',
    today: 'Today',
    tomorrow: 'Tomorrow',
    new: 'New',
    cancelled: 'Cancelled',
    moved: 'Moved',
    updated: 'Updated',
    renamed: 'renamed',
    locationChanged: 'location changed',
    calendarChanges: 'calendar changes',
    newEvents: 'new',
    cancelledEvents: 'cancelled',
    modifiedEvents: 'modified',
    allDay: 'All-day'
  }
};

function getTranslation(locale, key) {
  const lang = TRANSLATIONS[locale] || TRANSLATIONS['en-US'];
  return lang[key] || TRANSLATIONS['en-US'][key];
}


/**
 * Assign color indicators to calendars
 * @param {Array} events - Events with calendarName property
 * @param {Object} config - Full config object
 * @param {Map} cacheMap - Map of calendarId to cache objects
 * @returns {Promise<Object>} {indicatorMap: Map, newColors: Map} where newColors are colors to cache
 */
async function assignCalendarIndicators(events, config, cacheMap) {
  const uniqueCalendars = [...new Set(events.map(e => e.calendarName).filter(Boolean))];

  const indicatorMap = new Map();
  const newColors = new Map();

  for (const calendarName of uniqueCalendars) {
    const calendarId = Object.keys(config.calendars || {}).find(
      id => config.calendars[id].name === calendarName
    );

    if (!calendarId) {
      console.warn(`Calendar name '${calendarName}' not found in config, using hash fallback`);
      const index = hashCalendarName(calendarName);
      indicatorMap.set(calendarName, CALENDAR_INDICATORS[index]);
      continue;
    }

    const cache = cacheMap?.get(calendarId);
    const colorResult = await getCalendarColor(calendarId, config, cache);

    indicatorMap.set(calendarName, colorResult.emoji);

    if (colorResult.source === 'caldav' && colorResult.hex) {
      const colorCache = createColorCacheObject(colorResult.hex, colorResult.emoji, 'caldav');
      newColors.set(calendarId, colorCache);
    }
  }

  return { indicatorMap, newColors };
}

/**
 * Format event time based on locale and timezone
 * @param {Object} event - Event object with start, end, isAllDay
 * @param {string} locale - BCP 47 locale (e.g., 'en-US', 'de-DE')
 * @param {string} timezone - IANA timezone (e.g., 'Europe/Berlin', 'America/New_York')
 * @returns {string} Formatted time string
 */
function formatEventTime(event, locale = 'en-US', timezone = 'UTC') {
  if (event.isAllDay) {
    const allDayText = getTranslation(locale, 'allDay');

    // Check if event spans multiple days
    if (event.end) {
      const startDate = new Date(event.start);
      const endDate = new Date(event.end);

      // Normalize to start of day for comparison (UTC)
      const startDay = Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate());
      const endDay = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate());

      // Calculate day difference
      const dayDiff = Math.floor((endDay - startDay) / (1000 * 60 * 60 * 24));

      // If spans more than 1 day, show end date
      // Note: iCal end dates are exclusive, so dayDiff=1 means single-day event
      if (dayDiff > 1) {
        // iCal end date is exclusive, so subtract 1 day to get the actual last day
        const actualEndDate = new Date(endDate);
        actualEndDate.setDate(actualEndDate.getDate() - 1);

        // Format: German: "02.04." / English: "Apr 2"
        const endDateFormat = new Intl.DateTimeFormat(locale, {
          day: locale === 'de-DE' ? '2-digit' : 'numeric',
          month: locale === 'de-DE' ? '2-digit' : 'short',
          timeZone: timezone
        });
        let formattedEndDate = endDateFormat.format(actualEndDate);
        // Add trailing period for German format
        if (locale === 'de-DE') {
          formattedEndDate += '.';
        }
        const untilText = locale === 'de-DE' ? 'bis' : 'until';
        return `${allDayText} (${untilText} ${formattedEndDate})`;
      }
    }

    return allDayText;
  }

  const timeFormat = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: locale.startsWith('en-US'),
    timeZone: timezone
  });

  const formatted = timeFormat.format(event.start);
  return formatted;
}

/**
 * Format date for display
 */
function formatDate(date, locale = 'en-US', timezone = 'UTC') {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: timezone
  }).format(date);
}

/**
 * Format short date for display (for change notifications)
 */
function formatShortDate(date, locale = 'en-US', timezone = 'UTC') {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: timezone
  }).format(date);
}

/**
 * Check if two dates are on the same day in a given timezone
 */
function isSameDay(date1, date2, timezone = 'UTC') {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: timezone
  });
  return formatter.format(date1) === formatter.format(date2);
}

/**
 * Format date range for header
 */
function formatDateRange(startDate, endDate, locale = 'en-US', timezone = 'UTC') {
  const dateFormat = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: timezone
  });
  return `${dateFormat.format(startDate)} — ${dateFormat.format(endDate)}`;
}

/**
 * Get week number from date
 */
function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

/**
 * Render week view digest
 * @param {Array} events - Array of event objects
 * @param {Object} dateRange - { start: Date, end: Date }
 * @param {string} locale - Locale for formatting
 * @param {Object} options - { showEmptyDays, viewMode, eventDetail, timezone, config, cacheMap }
 * @returns {Promise<string>} Formatted week view
 */
async function renderWeekView(events, dateRange, locale = 'en-US', options = {}) {
  const { showEmptyDays = false, viewMode = 'merged', eventDetail = 'standard', timezone = 'UTC', config = {}, cacheMap = new Map() } = options;

  const weekNum = getWeekNumber(dateRange.start);
  const weekLabel = getTranslation(locale, 'week');
  const weekOverview = getTranslation(locale, 'weekOverview');
  const dateRangeStr = formatDateRange(dateRange.start, dateRange.end, locale, timezone);

  let output = `*${weekOverview}: ${weekLabel} ${weekNum} · ${dateRangeStr}*\n\n`;

  // Assign calendar indicators (only if multiple calendars)
  const { indicatorMap: calendarIndicators } = await assignCalendarIndicators(events, config, cacheMap);

  // Group events by day
  const eventsByDay = new Map();
  const currentDate = new Date(dateRange.start);

  while (currentDate <= dateRange.end) {
    const dayKey = currentDate.toISOString().split('T')[0];
    eventsByDay.set(dayKey, []);
    currentDate.setDate(currentDate.getDate() + 1);
  }

  // Populate events
  for (const event of events) {
    const eventDate = new Date(event.start);
    const dayKey = eventDate.toISOString().split('T')[0];
    if (eventsByDay.has(dayKey)) {
      eventsByDay.get(dayKey).push(event);
    }
  }

  // Render each day
  for (const [dayKey, dayEvents] of eventsByDay) {
    const date = new Date(dayKey + 'T12:00:00Z');
    const dayName = formatDate(date, locale, timezone);

    if (dayEvents.length === 0 && !showEmptyDays) {
      continue;
    }

    output += `*${dayName}*\n`;
    output += `────────────\n`;

    if (dayEvents.length === 0) {
      output += `${getTranslation(locale, 'nothingScheduled')}\n\n`;
      continue;
    }

    // Sort: all-day first, then by time
    const sorted = dayEvents.sort((a, b) => {
      if (a.isAllDay && !b.isAllDay) return -1;
      if (!a.isAllDay && b.isAllDay) return 1;
      return a.start - b.start;
    });

    for (const event of sorted) {
      const time = formatEventTime(event, locale, timezone);
      // Restore inline color indicators
      const indicator = calendarIndicators.get(event.calendarName) || '';
      const calendar = indicator ? ` ${indicator}` : (event.calendarName ? ` · ${event.calendarName}` : '');
      const location = eventDetail !== 'minimal' && event.location ? ` — ${event.location}` : '';

      output += `${time}${!event.isAllDay ? '  ' : ' '}${event.title}${location}${calendar}\n`;
    }

    output += '\n';
  }

  // Summary with calendar legend
  const totalEvents = events.length;
  const uniqueCalendars = new Set(events.map(e => e.calendarName).filter(Boolean)).size;
  const eventLabel = totalEvents === 1 ? getTranslation(locale, 'event') : getTranslation(locale, 'events');
  output += `${totalEvents} ${eventLabel}`;
  if (uniqueCalendars > 0) {
    const calendarLabel = uniqueCalendars === 1 ? getTranslation(locale, 'calendar') : getTranslation(locale, 'calendars');
    output += ` · ${uniqueCalendars} ${calendarLabel}`;
  }

  // Add clickable link if canvas_url provided
  const fullScheduleText = getTranslation(locale, 'fullSchedule');
  if (options.canvas_url) {
    output += ` · <${options.canvas_url}|${fullScheduleText}>`;
  } else {
    output += ` · ${fullScheduleText}`;
  }

  // Add calendar legend if multiple calendars (in italics)
  if (calendarIndicators.size > 0) {
    output += '\n\n_';
    for (const [calName, indicator] of calendarIndicators) {
      output += `${indicator} ${calName}  `;
    }
    output += '_';
  }

  output += '\n';

  return output;
}

/**
 * Render change notification for a single event change
 * @param {Object} diff - Diff object from diffEvents
 * @param {string} locale - Locale for formatting
 * @param {string} timezone - IANA timezone
 * @param {Map} calendarIndicators - Map of calendar name to emoji indicator (from assignCalendarIndicators)
 * @returns {string} Formatted notification
 */
function renderChangeNotification(diff, locale = 'en-US', timezone = 'UTC', calendarIndicators = new Map()) {
  const { type, event, old, new: newData, calendarName } = diff;

  const dateStr = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: timezone
  }).format(event.start);

  // Use color indicator from resolved map, fallback to hash if not in map
  const indicator = calendarName && calendarIndicators.has(calendarName)
    ? calendarIndicators.get(calendarName)
    : (calendarName ? CALENDAR_INDICATORS[hashCalendarName(calendarName)] : '');
  const calendar = indicator ? ` ${indicator}` : '';

  let message = '';

  switch (type) {
    case 'new':
      const newTime = formatEventTime(event, locale, timezone);
      message = `*Neuer Termin:* ${event.title} · ${dateStr} · ${newTime}${calendar}`;
      break;

    case 'deleted':
      const delTime = formatEventTime(event, locale, timezone);
      message = `*Termin abgesagt:* ${event.title} · ${dateStr} · ${delTime}${calendar}`;
      break;

    case 'time_changed':
      // Check if all-day status changed
      // Handle legacy cached events that might not have isAllDay flag
      // Infer all-day from midnight start time if flag is missing
      const oldIsAllDay = old.isAllDay !== undefined
        ? old.isAllDay
        : (old.start && new Date(old.start).getUTCHours() === 0 && new Date(old.start).getUTCMinutes() === 0);
      const newIsAllDay = newData.isAllDay !== undefined
        ? newData.isAllDay
        : (newData.start && new Date(newData.start).getUTCHours() === 0 && new Date(newData.start).getUTCMinutes() === 0);
      const allDayLabel = getTranslation(locale, 'allDay');

      if (oldIsAllDay !== newIsAllDay) {
        // All-day status changed
        if (oldIsAllDay && !newIsAllDay) {
          // Changed from all-day to specific time
          const newTime = formatEventTime({ ...event, start: newData.start, isAllDay: false }, locale, timezone);
          message = `*Termin verschoben:* ${event.title} · ${dateStr} · ${allDayLabel} → ${newTime}${calendar}`;
        } else {
          // Changed from specific time to all-day
          const oldTime = formatEventTime({ ...event, start: old.start, isAllDay: false }, locale, timezone);
          message = `*Termin verschoben:* ${event.title} · ${dateStr} · ${oldTime} → ${allDayLabel}${calendar}`;
        }
      } else {
        // All-day status unchanged, check date/time changes
        const oldTime = formatEventTime({ ...event, start: old.start, isAllDay: oldIsAllDay }, locale, timezone);
        const newTime2 = formatEventTime({ ...event, start: newData.start, isAllDay: newIsAllDay }, locale, timezone);
        const dateChanged = !isSameDay(old.start, newData.start, timezone);
        const timeChanged = oldTime !== newTime2;

        if (dateChanged && !timeChanged) {
          // Date changed, time stayed same: show oldDate time → newDate time
          const oldDateStr = formatShortDate(old.start, locale, timezone);
          const newDateStr = formatShortDate(newData.start, locale, timezone);
          message = `*Termin verschoben:* ${event.title} · ${oldDateStr} ${oldTime} → ${newDateStr} ${newTime2}${calendar}`;
        } else if (!dateChanged && timeChanged) {
          // Time changed, date stayed same: show date · oldTime → newTime
          message = `*Termin verschoben:* ${event.title} · ${dateStr} · ${oldTime} → ${newTime2}${calendar}`;
        } else {
          // Both changed: show oldDate oldTime → newDate newTime
          const oldDateStr = formatShortDate(old.start, locale, timezone);
          const newDateStr = formatShortDate(newData.start, locale, timezone);
          message = `*Termin verschoben:* ${event.title} · ${oldDateStr} ${oldTime} → ${newDateStr} ${newTime2}${calendar}`;
        }
      }
      break;

    case 'title_changed':
      const titleTime = formatEventTime(event, locale, timezone);
      message = `*Termin umbenannt:* ${old.title} → ${event.title} · ${dateStr} · ${titleTime}${calendar}`;
      break;

    case 'location_changed':
      const locTime = formatEventTime(event, locale, timezone);
      message = `*Termin geändert:* ${event.title} · ${dateStr} · ${locTime}${calendar}`;
      break;

    default:
      const defaultTime = formatEventTime(event, locale, timezone);
      message = `*Termin geändert:* ${event.title} · ${dateStr} · ${defaultTime}${calendar}`;
      break;
  }

  return message;
}

/**
 * Render bundled change notifications (debounced)
 * @param {Array} diffs - Array of diff objects
 * @param {string} locale - Locale for formatting
 * @param {string} timezone - IANA timezone
 * @param {Object} options - Options including config and cacheMap
 * @returns {Promise<Object>} {message: string, newColors: Map} - newColors are colors to cache
 */
async function renderBundledNotification(diffs, locale = 'en-US', timezone = 'UTC', options = {}) {
  if (diffs.length === 0) return { message: '', newColors: new Map() };
  if (diffs.length === 1) {
    const { indicatorMap, newColors } = await assignCalendarIndicators(
      [{ ...diffs[0].event, calendarName: diffs[0].calendarName }],
      options.config || {},
      options.cacheMap || new Map()
    );
    return { message: renderChangeNotification(diffs[0], locale, timezone, indicatorMap), newColors };
  }

  const { config = {}, cacheMap = new Map() } = options;

  let output = `*${diffs.length} ${getTranslation(locale, 'calendarChanges')}*\n\n`;

  // Assign calendar indicators (color flags) for multi-calendar channels
  const { indicatorMap: calendarIndicators, newColors } = await assignCalendarIndicators(
    diffs.map(d => ({ ...d.event, calendarName: d.calendarName })),
    config,
    cacheMap
  );

  // Group by change type
  const grouped = {
    new: diffs.filter(d => d.type === 'new'),
    deleted: diffs.filter(d => d.type === 'deleted'),
    timeChanged: diffs.filter(d => d.type === 'time_changed'),
    titleChanged: diffs.filter(d => d.type === 'title_changed'),
    locationChanged: diffs.filter(d => d.type === 'location_changed')
  };

  // Render new events
  if (grouped.new.length > 0) {
    const label = grouped.new.length === 1 ? 'Neuer Termin' : 'Neue Termine';
    output += `*${label}:*\n`;
    for (const diff of grouped.new) {
      const { event, calendarName } = diff;
      const dateStr = new Intl.DateTimeFormat(locale, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        timeZone: timezone
      }).format(event.start);
      const time = formatEventTime(event, locale, timezone);
      const indicator = calendarIndicators.get(calendarName) || '';
      const calendar = indicator ? ` ${indicator}` : (calendarName ? ` · ${calendarName}` : '');
      output += `• ${event.title} · ${dateStr} · ${time}${calendar}\n`;
    }
    output += '\n';
  }

  // Render cancelled events
  if (grouped.deleted.length > 0) {
    const label = grouped.deleted.length === 1 ? 'Termin abgesagt' : 'Termine abgesagt';
    output += `*${label}:*\n`;
    for (const diff of grouped.deleted) {
      const { event, calendarName } = diff;
      const dateStr = new Intl.DateTimeFormat(locale, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        timeZone: timezone
      }).format(event.start);
      const time = formatEventTime(event, locale, timezone);
      const indicator = calendarIndicators.get(calendarName) || '';
      const calendar = indicator ? ` ${indicator}` : (calendarName ? ` · ${calendarName}` : '');
      output += `• ${event.title} · ${dateStr} · ${time}${calendar}\n`;
    }
    output += '\n';
  }

  // Render time-changed events
  if (grouped.timeChanged.length > 0) {
    const label = grouped.timeChanged.length === 1 ? 'Termin verschoben' : 'Termine verschoben';
    output += `*${label}:*\n`;
    for (const diff of grouped.timeChanged) {
      const { event, old, new: newData, calendarName } = diff;
      const dateStr = new Intl.DateTimeFormat(locale, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        timeZone: timezone
      }).format(event.start);
      const oldTime = formatEventTime({ ...event, start: old.start, isAllDay: event.isAllDay }, locale, timezone);
      const newTime = formatEventTime({ ...event, start: newData.start, isAllDay: event.isAllDay }, locale, timezone);
      const indicator = calendarIndicators.get(calendarName) || '';
      const calendar = indicator ? ` ${indicator}` : (calendarName ? ` · ${calendarName}` : '');

      const dateChanged = !isSameDay(old.start, newData.start, timezone);
      const timeChanged = oldTime !== newTime;

      if (dateChanged && !timeChanged) {
        // Date changed, time stayed same: show oldDate time → newDate time
        const oldDateStr = formatShortDate(old.start, locale, timezone);
        const newDateStr = formatShortDate(newData.start, locale, timezone);
        output += `• ${event.title} · ${oldDateStr} ${oldTime} → ${newDateStr} ${newTime}${calendar}\n`;
      } else if (!dateChanged && timeChanged) {
        // Time changed, date stayed same: show date · oldTime → newTime
        output += `• ${event.title} · ${dateStr} · ${oldTime} → ${newTime}${calendar}\n`;
      } else {
        // Both changed: show oldDate oldTime → newDate newTime
        const oldDateStr = formatShortDate(old.start, locale, timezone);
        const newDateStr = formatShortDate(newData.start, locale, timezone);
        output += `• ${event.title} · ${oldDateStr} ${oldTime} → ${newDateStr} ${newTime}${calendar}\n`;
      }
    }
    output += '\n';
  }

  // Render renamed events
  if (grouped.titleChanged.length > 0) {
    const label = grouped.titleChanged.length === 1 ? 'Termin umbenannt' : 'Termine umbenannt';
    output += `*${label}:*\n`;
    for (const diff of grouped.titleChanged) {
      const { event, old, calendarName } = diff;
      const dateStr = new Intl.DateTimeFormat(locale, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        timeZone: timezone
      }).format(event.start);
      const time = formatEventTime(event, locale, timezone);
      const indicator = calendarIndicators.get(calendarName) || '';
      const calendar = indicator ? ` ${indicator}` : (calendarName ? ` · ${calendarName}` : '');
      output += `• ${old.title} → ${event.title} · ${dateStr} · ${time}${calendar}\n`;
    }
    output += '\n';
  }

  // Render location-changed events
  if (grouped.locationChanged.length > 0) {
    const label = grouped.locationChanged.length === 1 ? 'Termin geändert' : 'Termine geändert';
    output += `*${label}:*\n`;
    for (const diff of grouped.locationChanged) {
      const { event, calendarName } = diff;
      const dateStr = new Intl.DateTimeFormat(locale, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        timeZone: timezone
      }).format(event.start);
      const time = formatEventTime(event, locale, timezone);
      const indicator = calendarIndicators.get(calendarName) || '';
      const calendar = indicator ? ` ${indicator}` : (calendarName ? ` · ${calendarName}` : '');
      output += `• ${event.title} · ${dateStr} · ${time}${calendar}\n`;
    }
  }

  return { message: output.trim(), newColors };
}

/**
 * Render daily view with Today/Tomorrow labels
 * @param {Array} events - Array of event objects
 * @param {Object} dateRange - { start: Date, end: Date } (typically today + tomorrow)
 * @param {string} locale - Locale for formatting
 * @param {Object} options - Rendering options including timezone, config, cacheMap
 * @returns {Promise<string>} Formatted daily view
 */
async function renderDailyView(events, dateRange, locale = 'en-US', options = {}) {
  const { showEmptyDays = false, eventDetail = 'standard', timezone = 'UTC', config = {}, cacheMap = new Map() } = options;

  let output = `*${getTranslation(locale, 'today')} / ${getTranslation(locale, 'tomorrow')}*\n\n`;

  // Assign calendar indicators
  const { indicatorMap: calendarIndicators } = await assignCalendarIndicators(events, config, cacheMap);

  // Helper function to get local date key (YYYY-MM-DD) without timezone conversion
  function getLocalDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // Extract dates from dateRange to get day keys using local dates
  const todayKey = getLocalDateKey(dateRange.start);
  const tomorrowKey = getLocalDateKey(dateRange.end);

  // Group events by day
  const eventsByDay = new Map();
  eventsByDay.set(todayKey, []);
  eventsByDay.set(tomorrowKey, []);

  for (const event of events) {
    const dayKey = getLocalDateKey(event.start);
    if (eventsByDay.has(dayKey)) {
      eventsByDay.get(dayKey).push(event);
    }
  }

  // Render each day
  for (const [dayKey, dayEvents] of eventsByDay) {
    const [year, month, day] = dayKey.split('-').map(Number);
    const date = new Date(year, month - 1, day, 12, 0, 0);
    const dayName = formatDate(date, locale, timezone);
    const label = dayKey === todayKey ? getTranslation(locale, 'today') : getTranslation(locale, 'tomorrow');

    if (dayEvents.length === 0 && !showEmptyDays) {
      continue;
    }

    output += `*${label} · ${dayName}*\n`;
    output += `────────────\n`;

    if (dayEvents.length === 0) {
      output += `${getTranslation(locale, 'nothingScheduled')}\n\n`;
      continue;
    }

    // Sort: all-day first, then by time
    const sorted = dayEvents.sort((a, b) => {
      if (a.isAllDay && !b.isAllDay) return -1;
      if (!a.isAllDay && b.isAllDay) return 1;
      return a.start - b.start;
    });

    for (const event of sorted) {
      const time = formatEventTime(event, locale, timezone);
      // Restore inline color indicators
      const indicator = calendarIndicators.get(event.calendarName) || '';
      const calendar = indicator ? ` ${indicator}` : (event.calendarName ? ` · ${event.calendarName}` : '');
      const location = eventDetail !== 'minimal' && event.location ? ` — ${event.location}` : '';

      output += `${time}${!event.isAllDay ? '  ' : ' '}${event.title}${location}${calendar}\n`;
    }

    output += '\n';
  }

  // Summary
  const totalEvents = events.length;
  const uniqueCalendars = new Set(events.map(e => e.calendarName).filter(Boolean)).size;
  const eventLabel = totalEvents === 1 ? getTranslation(locale, 'event') : getTranslation(locale, 'events');
  output += `${totalEvents} ${eventLabel}`;
  if (uniqueCalendars > 0) {
    const calendarLabel = uniqueCalendars === 1 ? getTranslation(locale, 'calendar') : getTranslation(locale, 'calendars');
    output += ` · ${uniqueCalendars} ${calendarLabel}`;
  }

  // Add clickable link if canvas_url provided
  const fullScheduleText = getTranslation(locale, 'fullSchedule');
  if (options.canvas_url) {
    output += ` · <${options.canvas_url}|${fullScheduleText}>`;
  } else {
    output += ` · ${fullScheduleText}`;
  }

  // Add calendar legend if multiple calendars (in italics)
  if (calendarIndicators.size > 0) {
    output += '\n\n_';
    for (const [calName, indicator] of calendarIndicators) {
      output += `${indicator} ${calName}  `;
    }
    output += '_';
  }

  output += '\n';

  return output;
}

/**
 * Convert Slack mrkdwn to Canvas markdown format
 * Canvas uses:
 * - **bold** (double asterisk, not single)
 * - _italic_ (underscore)
 * - [text](url) for links (standard markdown, not <url|text>)
 * - \n\n for line breaks (double newline)
 * @param {string} text - Text with Slack mrkdwn formatting
 * @returns {string} Text formatted for Canvas
 */
function convertToCanvasMarkdown(text) {
  let result = text;

  // Convert Slack link format <url|text> to markdown [text](url)
  // Handles both <url|text> and <url||text> (pipe variations)
  result = result.replace(/<([^>|]+)\|+([^>]+)>/g, '[$2]($1)');

  // Convert standalone links <url> to [url](url)
  result = result.replace(/<(https?:\/\/[^>]+)>/g, '[$1]($1)');

  // Convert Slack bold *text* to Canvas bold **text**
  // Must avoid converting *text* that's part of other patterns
  result = result.replace(/\*([^*\n]+)\*/g, '**$1**');

  // Convert Slack italic _text_ to Canvas italic *text*
  // Remove trailing spaces before closing underscore
  result = result.replace(/_([^_\n]+?)\s*_/g, '*$1*');

  // Convert single newlines to double newlines for Canvas line breaks
  result = result.replace(/\n(?!\n)/g, '\n\n');

  return result;
}

/**
 * Render Canvas content (markdown format)
 * @param {Array} events - Array of event objects
 * @param {Object} options - Rendering options
 * @returns {Promise<string>} Canvas markdown
 */
async function renderCanvasContent(events, options = {}) {
  const { locale = 'en-US' } = options;

  // Get current/upcoming week range (same logic as getCurrentWeekRange)
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const startOfWeek = new Date(now);

  if (dayOfWeek === 0) {
    // Sunday: show upcoming week (tomorrow's Monday through next Sunday)
    startOfWeek.setUTCDate(now.getUTCDate() + 1);
  } else {
    // Monday-Saturday: show current week (this Monday through this Sunday)
    startOfWeek.setUTCDate(now.getUTCDate() - dayOfWeek + 1);
  }

  startOfWeek.setUTCHours(0, 0, 0, 0);

  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setUTCDate(startOfWeek.getUTCDate() + 6);
  endOfWeek.setUTCHours(23, 59, 59, 999);

  const dateRange = { start: startOfWeek, end: endOfWeek };

  // Filter events to current week
  const weekEvents = events.filter(e => {
    const eventDate = new Date(e.start);
    return eventDate >= dateRange.start && eventDate <= dateRange.end;
  });

  // Render week view without canvas_url (redundant on the Canvas itself)
  const optionsWithoutCanvasUrl = { ...options };
  delete optionsWithoutCanvasUrl.canvas_url;
  let content = await renderWeekView(weekEvents, dateRange, locale, optionsWithoutCanvasUrl);

  // Remove "Full schedule →" / "Komplette Übersicht →" text from Canvas (redundant)
  const fullScheduleEnglish = getTranslation('en-US', 'fullSchedule');
  const fullScheduleGerman = getTranslation('de-DE', 'fullSchedule');
  content = content.replace(` · ${fullScheduleEnglish}`, '');
  content = content.replace(` · ${fullScheduleGerman}`, '');

  // Add Nextcloud link if configured (in markdown format)
  if (options.config?.nextcloud_url) {
    const linkText = locale === 'de-DE' ? 'In Nextcloud ansehen →' : 'View in Nextcloud →';
    content += `\n\n[${linkText}](${options.config.nextcloud_url})`;
  }

  // Convert Slack mrkdwn to Canvas markdown format
  // This handles: links, bold formatting, and line breaks
  content = convertToCanvasMarkdown(content);

  return content;
}

/**
 * Render calendar legend showing which color corresponds to which calendar
 * @param {Array} calendarNames - Array of calendar names
 * @returns {string} Formatted legend
 */
function renderCalendarLegend(calendarNames) {
  if (!calendarNames || calendarNames.length === 0) {
    return '';
  }

  const legendItems = [];
  for (const calName of calendarNames) {
    const index = hashCalendarName(calName);
    const indicator = CALENDAR_INDICATORS[index];
    legendItems.push(`${indicator} ${calName}`);
  }

  return `_${legendItems.join('  ')}_`;
}

module.exports = {
  formatEventTime,
  renderWeekView,
  renderChangeNotification,
  renderBundledNotification,
  renderDailyView,
  renderCanvasContent,
  renderCalendarLegend,
  formatRecurrencePattern
};
