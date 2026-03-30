const { readFile } = require('node:fs/promises');

/**
 * Load and validate configuration from file
 * @param {string} configPath - Path to config.json
 * @returns {Promise<Object>} Validated config object
 */
async function loadConfig(configPath = './config.json') {
  try {
    const content = await readFile(configPath, 'utf-8');
    const config = JSON.parse(content);
    return validateConfig(config);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Config file not found: ${configPath}`);
    }
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in config file: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Validate and process configuration
 * @param {Object} config - Raw config object
 * @returns {Object} Validated config with resolved env vars
 */
function validateConfig(config) {
  // Check required top-level fields
  if (!config.workspace_id || typeof config.workspace_id !== 'string') {
    throw new Error('workspace_id is required and must be a string');
  }
  if (!config.locale) {
    throw new Error('Config error: missing required field "locale"');
  }
  if (!config.caldav_credentials) {
    throw new Error('Config error: missing required field "caldav_credentials"');
  }
  if (!config.caldav_credentials.username || !config.caldav_credentials.password) {
    throw new Error('Config error: caldav_credentials must have username and password');
  }
  if (!config.calendars || typeof config.calendars !== 'object') {
    throw new Error('Config error: missing or invalid "calendars" field');
  }
  if (!Array.isArray(config.channels)) {
    throw new Error('Config error: "channels" must be an array');
  }

  // Validate nextcloud_url (optional)
  if (config.nextcloud_url) {
    try {
      new URL(config.nextcloud_url);
    } catch (error) {
      throw new Error('nextcloud_url must be a valid URL');
    }
  }

  // Resolve environment variables in config
  const resolved = JSON.parse(JSON.stringify(config)); // deep clone
  resolveEnvVars(resolved);

  // Validate calendar structure
  for (const [calId, calendar] of Object.entries(resolved.calendars)) {
    if (!calendar.caldav_url) {
      throw new Error(`Config error: calendar '${calId}' missing required field "caldav_url"`);
    }
    if (!calendar.name) {
      throw new Error(`Config error: calendar '${calId}' missing required field "name"`);
    }
  }

  // Validate calendar references
  for (const channel of resolved.channels) {
    if (!channel.id) {
      throw new Error(`Config error: channel missing required field "id"`);
    }
    if (!channel.canvas_id) {
      throw new Error(`Config error: channel '${channel.id}' missing required field "canvas_id"`);
    }
    if (!Array.isArray(channel.calendars) || channel.calendars.length === 0) {
      throw new Error(`Config error: channel '${channel.id}' must have at least one calendar`);
    }

    for (const calId of channel.calendars) {
      if (!resolved.calendars[calId]) {
        throw new Error(
          `Config error: channel '${channel.id}' references calendar '${calId}' which is not defined in calendars`
        );
      }
    }

    // Validate canvas_url (optional)
    if (channel.canvas_url) {
      try {
        new URL(channel.canvas_url);
      } catch (error) {
        throw new Error(`canvas_url for channel ${channel.id} must be a valid URL`);
      }
    }

    // Validate channel-specific locale if present
    if (channel.locale && !/^[a-z]{2}(-[A-Z]{2})?$/.test(channel.locale)) {
      throw new Error(`Config error: invalid locale '${channel.locale}' in channel '${channel.id}'`);
    }

    // Validate schedule format if present
    if (channel.digest_schedule && channel.digest_schedule !== false) {
      validateScheduleFormat(channel.digest_schedule, `channel '${channel.id}' digest_schedule`);
    }
    if (channel.daily_digest_schedule && channel.daily_digest_schedule !== false) {
      validateScheduleFormat(channel.daily_digest_schedule, `channel '${channel.id}' daily_digest_schedule`);
    }
  }

  // Validate locale format (basic BCP 47 pattern check)
  if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(resolved.locale)) {
    throw new Error(`Config error: invalid locale '${resolved.locale}' - must be a valid BCP 47 language tag`);
  }

  // Validate timezone if present (IANA timezone)
  if (resolved.timezone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: resolved.timezone });
    } catch (e) {
      throw new Error(`Config error: invalid timezone '${resolved.timezone}' - must be a valid IANA timezone (e.g., 'Europe/Berlin', 'America/New_York')`);
    }
  }

  // Validate channel-specific timezones
  for (const channel of resolved.channels) {
    if (channel.timezone) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: channel.timezone });
      } catch (e) {
        throw new Error(`Config error: invalid timezone '${channel.timezone}' in channel '${channel.id}' - must be a valid IANA timezone`);
      }
    }
  }

  return resolved;
}

/**
 * Recursively resolve ${ENV_VAR} placeholders
 */
function resolveEnvVars(obj) {
  for (const key in obj) {
    if (typeof obj[key] === 'string') {
      const match = obj[key].match(/^\$\{([^}]+)\}$/);
      if (match) {
        const envVar = match[1];
        if (!process.env[envVar]) {
          throw new Error(`Config error: ${envVar} environment variable is not set`);
        }
        obj[key] = process.env[envVar];
      }
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      resolveEnvVars(obj[key]);
    }
  }
}

/**
 * Validate schedule format
 * Accepts: "monday 14:30", "weekdays 08:00", "0 18 * * 0" (cron), false
 */
function validateScheduleFormat(schedule, fieldName) {
  if (schedule === false) return;

  // Check for cron format (5 fields)
  if (/^\d+\s+\d+\s+\*\s+\*\s+[\d,\-*]+$/.test(schedule)) {
    return; // Valid cron expression
  }

  // Check for human-readable format: "<day> <HH:MM>"
  const match = schedule.match(/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekdays|weekends|daily)\s+(\d{2}):(\d{2})$/i);
  if (!match) {
    throw new Error(
      `Config error: invalid schedule format for ${fieldName}: "${schedule}". ` +
      `Expected format: "day HH:MM" (e.g., "monday 14:30") or cron expression`
    );
  }

  const [, , hours, minutes] = match;
  const h = parseInt(hours, 10);
  const m = parseInt(minutes, 10);

  if (h < 0 || h > 23) {
    throw new Error(`Config error: invalid schedule for ${fieldName}: hour must be 00-23`);
  }
  if (m < 0 || m > 59) {
    throw new Error(`Config error: invalid schedule for ${fieldName}: minute must be 00-59`);
  }
}

module.exports = {
  loadConfig,
  validateConfig
};
