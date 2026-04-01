#!/usr/bin/env node
/**
 * CalDAV Raw Data Analyzer
 *
 * Fetches raw iCal data from CalDAV endpoints and analyzes event time formats.
 * Helps diagnose timezone conversion issues.
 *
 * Usage:
 *   node tools/analyze-caldav.js [calendar-id]
 *
 * Example:
 *   node tools/analyze-caldav.js team-calendar
 *   node tools/analyze-caldav.js  # analyzes all calendars
 */

const fs = require('fs');
const path = require('path');

async function fetchRawIcal(url, credentials) {
  const authHeader = 'Basic ' + Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64');

  console.log(`\nFetching from: ${url}`);

  const response = await fetch(url, {
    headers: {
      'Authorization': authHeader,
      'Accept': 'text/calendar'
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return await response.text();
}

function analyzeEvent(eventText) {
  const lines = eventText.split('\n');
  const summary = lines.find(l => l.startsWith('SUMMARY:'))?.substring(8) || 'Unknown';
  const dtstart = lines.find(l => l.startsWith('DTSTART'));
  const dtend = lines.find(l => l.startsWith('DTEND'));
  const rrule = lines.find(l => l.startsWith('RRULE:'));

  return { summary, dtstart, dtend, rrule };
}

function parseIcalData(icalText) {
  // Split into individual events
  const events = [];
  const eventBlocks = icalText.split('BEGIN:VEVENT');

  for (let i = 1; i < eventBlocks.length; i++) {
    const eventEnd = eventBlocks[i].indexOf('END:VEVENT');
    if (eventEnd !== -1) {
      const eventText = 'BEGIN:VEVENT' + eventBlocks[i].substring(0, eventEnd + 10);
      events.push(analyzeEvent(eventText));
    }
  }

  return events;
}

async function analyzeCalendar(calendarId, calendar, credentials) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Calendar: ${calendar.name} (${calendarId})`);
  console.log('='.repeat(80));

  try {
    const rawIcal = await fetchRawIcal(calendar.caldav_url, credentials);

    // Save raw data to file
    const outputDir = path.join(__dirname, '../.caldav-debug');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const outputFile = path.join(outputDir, `${calendarId}.ics`);
    fs.writeFileSync(outputFile, rawIcal, 'utf-8');
    console.log(`✓ Raw iCal saved to: ${outputFile}`);

    // Parse and analyze events
    const events = parseIcalData(rawIcal);
    console.log(`\nFound ${events.length} events:\n`);

    // Sort by summary for easier reading
    events.sort((a, b) => a.summary.localeCompare(b.summary));

    for (const event of events) {
      console.log(`Event: ${event.summary}`);
      if (event.dtstart) {
        console.log(`  ${event.dtstart}`);
      }
      if (event.dtend) {
        console.log(`  ${event.dtend}`);
      }
      if (event.rrule) {
        console.log(`  ${event.rrule}`);
      }

      // Highlight the problematic event
      if (event.summary.includes('Eurythmie')) {
        console.log(`  ⚠️  THIS IS THE PROBLEMATIC EVENT FROM ISSUE #16`);
      }
      console.log('');
    }

  } catch (error) {
    console.error(`✗ Failed to fetch calendar: ${error.message}`);
  }
}

async function main() {
  const targetCalendarId = process.argv[2];

  // Load config
  const configPath = path.join(__dirname, '../config.json');
  if (!fs.existsSync(configPath)) {
    console.error('Error: config.json not found!');
    console.error('Please create config.json in the project root with your CalDAV settings.');
    console.error('You can copy config.example.json as a starting point.');
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  // Resolve credentials from env vars
  const credentials = {
    username: config.caldav_credentials.username.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] || ''),
    password: config.caldav_credentials.password.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] || '')
  };

  if (!credentials.username || !credentials.password) {
    console.error('Error: CalDAV credentials not set!');
    console.error('Set CALDAV_USERNAME and CALDAV_PASSWORD environment variables.');
    process.exit(1);
  }

  console.log('CalDAV Raw Data Analyzer');
  console.log('='.repeat(80));

  if (targetCalendarId) {
    const calendar = config.calendars[targetCalendarId];
    if (!calendar) {
      console.error(`Error: Calendar "${targetCalendarId}" not found in config.json`);
      console.error(`Available calendars: ${Object.keys(config.calendars).join(', ')}`);
      process.exit(1);
    }
    await analyzeCalendar(targetCalendarId, calendar, credentials);
  } else {
    // Analyze all calendars
    for (const [calendarId, calendar] of Object.entries(config.calendars)) {
      await analyzeCalendar(calendarId, calendar, credentials);
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log('Analysis complete!');
  console.log(`Raw .ics files saved to: ${path.join(__dirname, '../.caldav-debug/')}`);
  console.log('='.repeat(80));
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
