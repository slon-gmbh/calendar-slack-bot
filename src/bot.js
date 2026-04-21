#!/usr/bin/env node

const path = require('node:path');
const { loadConfig } = require('./config.js');
const { openDb, migrateFromFlatFiles } = require('./db.js');
const {
  runScheduledDigests,
  runWeeklyDigest,
  runDailyDigest,
  runEventChanged,
  runChangeDetection
} = require('./runner.js');

const args = process.argv.slice(2);
const mode = args.find(arg => arg.startsWith('--') && !arg.startsWith('--dry'));
const dryRun = args.includes('--dry-run');

async function main() {
  const config = await loadConfig();

  const dataDir = process.env.DATA_DIR;
  if (!dataDir) throw new Error('DATA_DIR environment variable not set');

  const dbPath = path.join(dataDir, 'bot.db');
  const db = openDb(dbPath);

  const legacyDir = process.env.CACHE_DIR;
  if (legacyDir) migrateFromFlatFiles(db, legacyDir);

  if (mode === '--scheduled') {
    await runScheduledDigests(config, db, dryRun);
  } else if (mode === '--weekly-digest') {
    await runWeeklyDigest(config, db, dryRun, true);
  } else if (mode === '--daily-digest') {
    await runDailyDigest(config, db, dryRun, true);
  } else if (mode === '--event-changed') {
    await runEventChanged(config, db, dryRun);
  } else if (mode === '--detect-changes') {
    await runChangeDetection(config, db, dryRun);
  } else {
    console.error('Usage: node bot.js [--scheduled|--weekly-digest|--daily-digest|--event-changed|--detect-changes] [--dry-run]');
    process.exit(1);
  }

  if (dryRun) {
    console.log('[TEST MODE] All messages routed to error_channel. Canvas updates skipped.');
  }

  db.close();
  process.exit(0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

const { getCurrentWeekRange, getChangeDetectionRange } = require('./runner.js');
module.exports = { getCurrentWeekRange, getChangeDetectionRange };
