/**
 * Formatting and rendering module for digest messages and Canvas content
 */

/**
 * Calendar color indicators for multi-calendar channels
 */
const CALENDAR_INDICATORS = ['🟦', '🟩', '🟨', '🟧', '🟪', '🟥', '⬜'];

/**
 * Assign color indicators to calendars
 * @param {Array} events - Events with calendarName property
 * @returns {Map} Map of calendar name to indicator
 */
function assignCalendarIndicators(events) {
  const uniqueCalendars = [...new Set(events.map(e => e.calendarName).filter(Boolean))];

  // Only use indicators if multiple calendars
  if (uniqueCalendars.length <= 1) {
    return new Map();
  }

  const indicatorMap = new Map();
  uniqueCalendars.forEach((cal, index) => {
    indicatorMap.set(cal, CALENDAR_INDICATORS[index % CALENDAR_INDICATORS.length]);
  });

  return indicatorMap;
}

/**
 * Format event time based on locale
 * @param {Object} event - Event object with start, end, isAllDay
 * @param {string} locale - BCP 47 locale (e.g., 'en-US', 'de-DE')
 * @returns {string} Formatted time string
 */
function formatEventTime(event, locale = 'en-US') {
  if (event.isAllDay) {
    return '📅';
  }

  const timeFormat = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: locale.startsWith('en-US')
  });

  return timeFormat.format(event.start);
}

/**
 * Format date for display
 */
function formatDate(date, locale = 'en-US') {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    month: 'short',
    day: 'numeric'
  }).format(date);
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
 * @param {Object} options - { showEmptyDays, viewMode, eventDetail }
 * @returns {string} Formatted week view
 */
function renderWeekView(events, dateRange, locale = 'en-US', options = {}) {
  const { showEmptyDays = false, viewMode = 'merged', eventDetail = 'standard' } = options;

  const weekNum = getWeekNumber(dateRange.start);
  const startDate = formatDate(dateRange.start, locale).split(',')[0]; // Just day name
  const endDate = formatDate(dateRange.end, locale).split(',')[0];

  let output = `📅 Week ${weekNum} · ${startDate} — ${endDate}\n\n`;

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
    const dayName = formatDate(date, locale);

    if (dayEvents.length === 0 && !showEmptyDays) {
      continue;
    }

    output += `${dayName}\n`;
    output += `━━━━━━━━━━━━━━━━━━━━\n`;

    if (dayEvents.length === 0) {
      output += `(nothing scheduled)\n\n`;
      continue;
    }

    // Sort: all-day first, then by time
    const sorted = dayEvents.sort((a, b) => {
      if (a.isAllDay && !b.isAllDay) return -1;
      if (!a.isAllDay && b.isAllDay) return 1;
      return a.start - b.start;
    });

    for (const event of sorted) {
      const time = formatEventTime(event, locale);
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
  output += `📆 ${totalEvents} event${totalEvents !== 1 ? 's' : ''}`;
  if (uniqueCalendars > 0) {
    output += ` · ${uniqueCalendars} calendar${uniqueCalendars !== 1 ? 's' : ''}`;
  }
  output += ` · Full schedule →`;

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
 * @returns {string} Formatted notification
 */
function renderChangeNotification(diff, locale = 'en-US') {
  const { type, event, old, new: newData, calendarName } = diff;

  const dateStr = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  }).format(event.start);

  const calendar = calendarName ? ` · ${calendarName}` : '';

  switch (type) {
    case 'new':
      const newTime = formatEventTime(event, locale);
      return `➕ **New:** ${event.title} · ${dateStr} · ${newTime}${calendar}`;

    case 'deleted':
      const delTime = formatEventTime(event, locale);
      return `🗑️ **Cancelled:** ${event.title} · ${dateStr} · ${delTime}${calendar}`;

    case 'time_changed':
      const oldTime = formatEventTime({ ...event, start: old.start, isAllDay: event.isAllDay }, locale);
      const newTime2 = formatEventTime({ ...event, start: newData.start, isAllDay: event.isAllDay }, locale);
      return `✏️ **Moved:** ${event.title} · ${dateStr} · ${oldTime} → ${newTime2}${calendar}`;

    case 'title_changed':
      const titleTime = formatEventTime(event, locale);
      return `✏️ **Updated:** ${event.title} · ${dateStr} · ${titleTime} (renamed)${calendar}`;

    case 'location_changed':
      const locTime = formatEventTime(event, locale);
      return `✏️ **Updated:** ${event.title} · ${dateStr} · ${locTime} (location changed)${calendar}`;

    default:
      const defaultTime = formatEventTime(event, locale);
      return `✏️ **Updated:** ${event.title} · ${dateStr} · ${defaultTime}${calendar}`;
  }
}

/**
 * Render bundled change notifications (debounced)
 * @param {Array} diffs - Array of diff objects
 * @param {string} locale - Locale for formatting
 * @returns {string} Formatted bundled notification
 */
function renderBundledNotification(diffs, locale = 'en-US') {
  if (diffs.length === 0) return '';
  if (diffs.length === 1) return renderChangeNotification(diffs[0], locale);

  let output = `📬 **${diffs.length} calendar changes**\n\n`;

  // Group by change type
  const grouped = {
    new: diffs.filter(d => d.type === 'new'),
    deleted: diffs.filter(d => d.type === 'deleted'),
    modified: diffs.filter(d => d.type !== 'new' && d.type !== 'deleted')
  };

  // Render new events
  if (grouped.new.length > 0) {
    output += `➕ **${grouped.new.length} new event${grouped.new.length !== 1 ? 's' : ''}:**\n`;
    for (const diff of grouped.new) {
      const { event, calendarName } = diff;
      const dateStr = new Intl.DateTimeFormat(locale, {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      }).format(event.start);
      const time = formatEventTime(event, locale);
      const calendar = calendarName ? ` · ${calendarName}` : '';
      output += `• ${event.title} · ${dateStr} · ${time}${calendar}\n`;
    }
    output += '\n';
  }

  // Render cancelled events
  if (grouped.deleted.length > 0) {
    output += `🗑️ **${grouped.deleted.length} cancelled:**\n`;
    for (const diff of grouped.deleted) {
      const { event, calendarName } = diff;
      const dateStr = new Intl.DateTimeFormat(locale, {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      }).format(event.start);
      const time = formatEventTime(event, locale);
      const calendar = calendarName ? ` · ${calendarName}` : '';
      output += `• ${event.title} · ${dateStr} · ${time}${calendar}\n`;
    }
    output += '\n';
  }

  // Render modified events
  if (grouped.modified.length > 0) {
    output += `✏️ **${grouped.modified.length} updated:**\n`;
    for (const diff of grouped.modified) {
      const { type, event, old, new: newData, calendarName } = diff;
      const dateStr = new Intl.DateTimeFormat(locale, {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      }).format(event.start);
      const calendar = calendarName ? ` · ${calendarName}` : '';

      if (type === 'time_changed') {
        const oldTime = formatEventTime({ ...event, start: old.start, isAllDay: event.isAllDay }, locale);
        const newTime = formatEventTime({ ...event, start: newData.start, isAllDay: event.isAllDay }, locale);
        output += `• ${event.title} · ${dateStr} · ${oldTime} → ${newTime}${calendar}\n`;
      } else if (type === 'title_changed') {
        output += `• ${event.title} (renamed) · ${dateStr}${calendar}\n`;
      } else if (type === 'location_changed') {
        output += `• ${event.title} (location changed) · ${dateStr}${calendar}\n`;
      } else {
        output += `• ${event.title} · ${dateStr}${calendar}\n`;
      }
    }
  }

  return output.trim();
}

/**
 * Render daily view with Today/Tomorrow labels
 * @param {Array} events - Array of event objects
 * @param {Object} dateRange - { start: Date, end: Date } (typically today + tomorrow)
 * @param {string} locale - Locale for formatting
 * @param {Object} options - Rendering options
 * @returns {string} Formatted daily view
 */
function renderDailyView(events, dateRange, locale = 'en-US', options = {}) {
  const { showEmptyDays = false, eventDetail = 'standard' } = options;

  let output = `📅 Daily Schedule\n\n`;

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
    const dayName = formatDate(date, locale);
    const label = dayKey === todayKey ? 'Today' : 'Tomorrow';

    if (dayEvents.length === 0 && !showEmptyDays) {
      continue;
    }

    output += `${label} · ${dayName}\n`;
    output += `━━━━━━━━━━━━━━━━━━━━\n`;

    if (dayEvents.length === 0) {
      output += `(nothing scheduled)\n\n`;
      continue;
    }

    // Sort: all-day first, then by time
    const sorted = dayEvents.sort((a, b) => {
      if (a.isAllDay && !b.isAllDay) return -1;
      if (!a.isAllDay && b.isAllDay) return 1;
      return a.start - b.start;
    });

    for (const event of sorted) {
      const time = formatEventTime(event, locale);
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
  output += `📆 ${totalEvents} event${totalEvents !== 1 ? 's' : ''}`;
  if (uniqueCalendars > 0) {
    output += ` · ${uniqueCalendars} calendar${uniqueCalendars !== 1 ? 's' : ''}`;
  }
  output += ` · Full schedule →`;

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
