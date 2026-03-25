/**
 * Urgency classification and schedule matching logic
 */

// MVP HARDCODED THRESHOLDS — configurable in v2
const URGENT_THRESHOLD_HOURS = 24;
const DEBOUNCE_WINDOW_SECONDS = 300; // 5 minutes

/**
 * Check if current time matches a schedule
 * @param {string} schedule - e.g., "monday 14:00", "weekdays 08:00"
 * @param {Date} currentTime - Time to check
 * @param {string} locale - Locale for day names
 * @returns {boolean} True if within ±30 min tolerance
 */
function matchesSchedule(schedule, currentTime = new Date(), locale = 'en-US') {
  if (schedule === false) return false;

  // Check for cron format (5 fields: minute hour day month weekday)
  const cronMatch = schedule.match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+([\d,\-*]+)$/);
  if (cronMatch) {
    const [, cronMinute, cronHour, cronWeekday] = cronMatch;
    const scheduleHour = parseInt(cronHour, 10);
    const scheduleMinute = parseInt(cronMinute, 10);

    // Check day match (cron uses 0=Sunday, 1=Monday, ...)
    const currentDay = currentTime.getUTCDay();
    const weekdayMatches = cronWeekday === '*' ||
                          cronWeekday.split(',').map(d => parseInt(d, 10)).includes(currentDay);

    if (!weekdayMatches) return false;

    // Check time match (±30 min tolerance)
    const currentHour = currentTime.getUTCHours();
    const currentMinute = currentTime.getUTCMinutes();

    const scheduleTotalMinutes = scheduleHour * 60 + scheduleMinute;
    const currentTotalMinutes = currentHour * 60 + currentMinute;
    const diff = Math.abs(currentTotalMinutes - scheduleTotalMinutes);

    return diff <= 30;
  }

  // Parse human-readable format
  const match = schedule.match(/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekdays|weekends|daily)\s+(\d{2}):(\d{2})$/i);
  if (!match) {
    console.warn(`Invalid schedule format: ${schedule}`);
    return false;
  }

  const [, day, hours, minutes] = match;
  const scheduleHour = parseInt(hours, 10);
  const scheduleMinute = parseInt(minutes, 10);

  // Check day match
  const currentDay = currentTime.getUTCDay(); // 0=Sunday, 1=Monday, ...
  const dayMatches = matchesDay(day.toLowerCase(), currentDay);

  if (!dayMatches) return false;

  // Check time match (±30 min tolerance)
  const currentHour = currentTime.getUTCHours();
  const currentMinute = currentTime.getUTCMinutes();

  const scheduleTotalMinutes = scheduleHour * 60 + scheduleMinute;
  const currentTotalMinutes = currentHour * 60 + currentMinute;
  const diff = Math.abs(currentTotalMinutes - scheduleTotalMinutes);

  return diff <= 30;
}

function matchesDay(dayKeyword, currentDay) {
  const dayNames = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6
  };

  if (dayKeyword === 'daily') return true;
  if (dayKeyword === 'weekdays') return currentDay >= 1 && currentDay <= 5;
  if (dayKeyword === 'weekends') return currentDay === 0 || currentDay === 6;

  return dayNames[dayKeyword] === currentDay;
}

/**
 * Classify event urgency
 * @param {Object} event - Event object with start date
 * @param {Object} channelConfig - Channel configuration
 * @returns {string} 'URGENT', 'THIS_WEEK', or 'FUTURE'
 */
function classifyUrgency(event, channelConfig) {
  const now = new Date();
  const eventStart = new Date(event.start);
  const hoursUntil = (eventStart - now) / (1000 * 60 * 60);

  // URGENT: within 24 hours
  if (hoursUntil <= URGENT_THRESHOLD_HOURS) {
    return 'URGENT';
  }

  // THIS_WEEK: within current calendar week
  const endOfWeek = getEndOfCurrentWeek(now);
  if (eventStart <= endOfWeek) {
    return 'THIS_WEEK';
  }

  // FUTURE: beyond current week
  return 'FUTURE';
}

function getEndOfCurrentWeek(date) {
  const dayOfWeek = date.getUTCDay();
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  const endOfWeek = new Date(date);
  endOfWeek.setUTCDate(date.getUTCDate() + daysUntilSunday);
  endOfWeek.setUTCHours(23, 59, 59, 999);
  return endOfWeek;
}

/**
 * Determine if a change should trigger immediate notification
 * @param {Object} diff - Diff object
 * @param {Object} channelConfig - Channel configuration
 * @returns {boolean} True if should notify now
 */
function shouldNotifyNow(diff, channelConfig) {
  const notificationsSetting = channelConfig.notifications || 'all';

  // Check notification settings
  if (notificationsSetting === 'disabled') return false;
  if (notificationsSetting === 'weekly' || notificationsSetting === 'daily') return false;

  // For 'urgent_only', check urgency
  if (notificationsSetting === 'urgent_only') {
    const urgency = classifyUrgency(diff.event, channelConfig);
    return urgency === 'URGENT';
  }

  // 'all' or default: notify for everything
  return true;
}

module.exports = {
  matchesSchedule,
  classifyUrgency,
  shouldNotifyNow
};
