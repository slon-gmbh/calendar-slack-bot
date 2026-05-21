#!/usr/bin/env node

const path = require('node:path');
const { loadConfigFromDb } = require('./config.js');
const { openDb } = require('./db.js');
const { validateEncryptionKey } = require('./crypto.js');
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
  validateEncryptionKey();
  const dataDir = process.env.DATA_DIR;
  if (!dataDir) throw new Error('DATA_DIR environment variable not set');

  const workspaceId = process.env.WORKSPACE_ID;
  if (!workspaceId) throw new Error('WORKSPACE_ID environment variable not set');

  const dbPath = path.join(dataDir, 'bot.db');
  const db = openDb(dbPath);
  const config = loadConfigFromDb(db, workspaceId);

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

if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

const { getCurrentWeekRange, getChangeDetectionRange } = require('./runner.js');
module.exports = { getCurrentWeekRange, getChangeDetectionRange };
