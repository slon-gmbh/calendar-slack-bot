/**
 * Formatting and rendering module for digest messages and Canvas content
 */

/**
 * Calendar color indicators for multi-calendar channels
 */
const CALENDAR_INDICATORS = ['🟦', '🟩', '🟨', '🟧', '🟪', '🟥', '⬜'];

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
    modifiedEvents: 'geändert'
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
    modifiedEvents: 'modified'
  }
};

function getTranslation(locale, key) {
  const lang = TRANSLATIONS[locale] || TRANSLATIONS['en-US'];
  return lang[key] || TRANSLATIONS['en-US'][key];
}

/**
 * Hash calendar name to consistent indicator index
 * Ensures same calendar always gets same color across all messages
 * @param {string} calendarName - Calendar name
 * @returns {number} Index in CALENDAR_INDICATORS array
 */
function hashCalendarName(calendarName) {
  let hash = 0;
  for (let i = 0; i < calendarName.length; i++) {
    hash = ((hash << 5) - hash) + calendarName.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash) % CALENDAR_INDICATORS.length;
}

/**
 * Assign color indicators to calendars
 * @param {Array} events - Events with calendarName property
 * @returns {Map} Map of calendar name to indicator
 */
function assignCalendarIndicators(events) {
  const uniqueCalendars = [...new Set(events.map(e => e.calendarName).filter(Boolean))];

  // Always assign indicators using consistent hash-based mapping
  // This ensures each calendar gets same color across all messages
  const indicatorMap = new Map();
  uniqueCalendars.forEach((cal) => {
    const index = hashCalendarName(cal);
    indicatorMap.set(cal, CALENDAR_INDICATORS[index]);
  });

  return indicatorMap;
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
    return '📅';
  }

  const timeFormat = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: locale.startsWith('en-US'),
    timeZone: timezone
  });

  const formatted = timeFormat.format(event.start);

  // Debug logging
  console.log(`[DEBUG] Formatting: ${event.title}`);
  console.log(`  Date object:`, event.start);
  console.log(`  ISO:`, event.start.toISOString());
  console.log(`  Timezone:`, timezone);
  console.log(`  Formatted:`, formatted);

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
 * @param {Object} options - { showEmptyDays, viewMode, eventDetail, timezone }
 * @returns {string} Formatted week view
 */
function renderWeekView(events, dateRange, locale = 'en-US', options = {}) {
  const { showEmptyDays = false, viewMode = 'merged', eventDetail = 'standard', timezone = 'UTC' } = options;

  const weekNum = getWeekNumber(dateRange.start);
  const weekLabel = getTranslation(locale, 'week');
  const weekOverview = getTranslation(locale, 'weekOverview');
  const dateRangeStr = formatDateRange(dateRange.start, dateRange.end, locale, timezone);

  let output = `*${weekOverview}: ${weekLabel} ${weekNum} · ${dateRangeStr}*\n\n`;

  // Assign calendar indicators (only if multiple calendars)
  const calendarIndicators = assignCalendarIndicators(events);

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

    output += `${dayName}\n`;
    output += `━━━━━━━━━━━━━━━━━━━━\n`;

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
  output += `📆 ${totalEvents} ${eventLabel}`;
  if (uniqueCalendars > 0) {
    const calendarLabel = uniqueCalendars === 1 ? getTranslation(locale, 'calendar') : getTranslation(locale, 'calendars');
    output += ` · ${uniqueCalendars} ${calendarLabel}`;
  }
  output += ` · ${getTranslation(locale, 'fullSchedule')}`;

  // Add calendar legend if multiple calendars
  if (calendarIndicators.size > 0) {
    output += '\n\n';
    for (const [calName, indicator] of calendarIndicators) {
      output += `${indicator} ${calName}  `;
    }
  }

  output += '\n';

  return output;
}

/**
 * Render change notification for a single event change
 * @param {Object} diff - Diff object from diffEvents
 * @param {string} locale - Locale for formatting
 * @param {string} timezone - IANA timezone
 * @returns {string} Formatted notification
 */
function renderChangeNotification(diff, locale = 'en-US', timezone = 'UTC') {
  const { type, event, old, new: newData, calendarName } = diff;

  const dateStr = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: timezone
  }).format(event.start);

  // Use color indicator instead of text calendar name
  const indicator = calendarName ? CALENDAR_INDICATORS[hashCalendarName(calendarName)] : '';
  const calendar = indicator ? ` ${indicator}` : '';

  switch (type) {
    case 'new':
      const newTime = formatEventTime(event, locale, timezone);
      return `*Neuer Termin:* ${event.title} · ${dateStr} · ${newTime}${calendar}`;

    case 'deleted':
      const delTime = formatEventTime(event, locale, timezone);
      return `*Termin abgesagt:* ${event.title} · ${dateStr} · ${delTime}${calendar}`;

    case 'time_changed':
      const oldTime = formatEventTime({ ...event, start: old.start, isAllDay: event.isAllDay }, locale, timezone);
      const newTime2 = formatEventTime({ ...event, start: newData.start, isAllDay: event.isAllDay }, locale, timezone);
      return `*Termin verschoben:* ${event.title} · ${dateStr} · ${oldTime} → ${newTime2}${calendar}`;

    case 'title_changed':
      const titleTime = formatEventTime(event, locale, timezone);
      return `*Termin umbenannt:* ${old.title} → ${event.title} · ${dateStr} · ${titleTime}${calendar}`;

    case 'location_changed':
      const locTime = formatEventTime(event, locale, timezone);
      return `*Termin geändert:* ${event.title} · ${dateStr} · ${locTime}${calendar}`;

    default:
      const defaultTime = formatEventTime(event, locale, timezone);
      return `*Termin geändert:* ${event.title} · ${dateStr} · ${defaultTime}${calendar}`;
  }
}

/**
 * Render bundled change notifications (debounced)
 * @param {Array} diffs - Array of diff objects
 * @param {string} locale - Locale for formatting
 * @param {string} timezone - IANA timezone
 * @returns {string} Formatted bundled notification
 */
function renderBundledNotification(diffs, locale = 'en-US', timezone = 'UTC') {
  if (diffs.length === 0) return '';
  if (diffs.length === 1) return renderChangeNotification(diffs[0], locale, timezone);

  let output = `*${diffs.length} ${getTranslation(locale, 'calendarChanges')}*\n\n`;

  // Assign calendar indicators (color flags) for multi-calendar channels
  const calendarIndicators = assignCalendarIndicators(
    diffs.map(d => ({ ...d.event, calendarName: d.calendarName }))
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
      output += `• ${event.title} · ${dateStr} · ${oldTime} → ${newTime}${calendar}\n`;
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

  return output.trim();
}

/**
 * Render daily view with Today/Tomorrow labels
 * @param {Array} events - Array of event objects
 * @param {Object} dateRange - { start: Date, end: Date } (typically today + tomorrow)
 * @param {string} locale - Locale for formatting
 * @param {Object} options - Rendering options including timezone
 * @returns {string} Formatted daily view
 */
function renderDailyView(events, dateRange, locale = 'en-US', options = {}) {
  const { showEmptyDays = false, eventDetail = 'standard', timezone = 'UTC' } = options;

  let output = `*${getTranslation(locale, 'today')} / ${getTranslation(locale, 'tomorrow')}*\n\n`;

  // Assign calendar indicators
  const calendarIndicators = assignCalendarIndicators(events);

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

    output += `${label} · ${dayName}\n`;
    output += `━━━━━━━━━━━━━━━━━━━━\n`;

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
  output += `📆 ${totalEvents} ${eventLabel}`;
  if (uniqueCalendars > 0) {
    const calendarLabel = uniqueCalendars === 1 ? getTranslation(locale, 'calendar') : getTranslation(locale, 'calendars');
    output += ` · ${uniqueCalendars} ${calendarLabel}`;
  }
  output += ` · ${getTranslation(locale, 'fullSchedule')}`;

  // Add calendar legend if multiple calendars
  if (calendarIndicators.size > 0) {
    output += '\n\n';
    for (const [calName, indicator] of calendarIndicators) {
      output += `${indicator} ${calName}  `;
    }
  }

  output += '\n';

  return output;
}

/**
 * Render Canvas content (markdown format)
 * @param {Array} events - Array of event objects
 * @param {Object} options - Rendering options
 * @returns {string} Canvas markdown
 */
function renderCanvasContent(events, options = {}) {
  const { locale = 'en-US' } = options;

  // Get current week range
  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  const startOfWeek = new Date(now);
  startOfWeek.setUTCDate(now.getUTCDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1)); // Monday
  startOfWeek.setUTCHours(0, 0, 0, 0);

  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setUTCDate(startOfWeek.getUTCDate() + 6); // Sunday
  endOfWeek.setUTCHours(23, 59, 59, 999);

  const dateRange = { start: startOfWeek, end: endOfWeek };

  // Filter events to current week
  const weekEvents = events.filter(e => {
    const eventDate = new Date(e.start);
    return eventDate >= dateRange.start && eventDate <= dateRange.end;
  });

  return renderWeekView(weekEvents, dateRange, locale, options);
}

module.exports = {
  formatEventTime,
  renderWeekView,
  renderChangeNotification,
  renderBundledNotification,
  renderDailyView,
  renderCanvasContent
};
