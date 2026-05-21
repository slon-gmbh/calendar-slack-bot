const http = require('node:http');
const path = require('node:path');
const cron = require('node-cron');
const { loadConfigFromDb } = require('./config.js');
const { openDb } = require('./db.js');
const { runScheduledDigests, runChangeDetection } = require('./runner.js');
const { validateEncryptionKey } = require('./crypto.js');
const { validateSlackEnvVars, handleOAuthRequest } = require('./oauth.js');

const DAY_MAP = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

/**
 * Convert a config schedule string to a node-cron expression.
 * Accepts 'day HH:MM', 'weekdays HH:MM', 'weekends HH:MM', 'daily HH:MM',
 * or a raw 5-field cron expression (passed through unchanged).
 * @param {string} str - Schedule string from config
 * @returns {string} node-cron expression
 * @example scheduleStringToCron('sunday 18:00') // '0 18 * * 0'
 * @example scheduleStringToCron('weekdays 08:00') // '0 8 * * 1-5'
 * @example scheduleStringToCron('0 18 * * 0') // '0 18 * * 0'
 */
function scheduleStringToCron(str) {
  if (/^\d+\s+\d+\s+[\d*]+\s+[\d*]+\s+[\d*,\-\/]+$/.test(str.trim())) {
    return str.trim();
  }

  const match = str.trim().match(/^(sunday|monday|tuesday|wednesday|thursday|friday|saturday|weekdays|weekends|daily)\s+(\d{1,2}):(\d{2})$/i);
  if (!match) throw new Error(`Unrecognised schedule string: "${str}"`);

  const [, day, hours, minutes] = match;
  const h = parseInt(hours, 10);
  const m = parseInt(minutes, 10);
  const keyword = day.toLowerCase();

  if (keyword === 'weekdays') return `${m} ${h} * * 1-5`;
  if (keyword === 'weekends') return `${m} ${h} * * 0,6`;
  if (keyword === 'daily') return `${m} ${h} * * *`;

  return `${m} ${h} * * ${DAY_MAP[keyword]}`;
}

async function start() {
  validateEncryptionKey();
  validateSlackEnvVars();
  const dataDir = process.env.DATA_DIR;
  if (!dataDir) throw new Error('DATA_DIR environment variable not set');

  const workspaceId = process.env.WORKSPACE_ID;
  if (!workspaceId) throw new Error('WORKSPACE_ID environment variable not set');

  const dbPath = path.join(dataDir, 'bot.db');
  const db = openDb(dbPath);
  const config = loadConfigFromDb(db, workspaceId);

  const jobs = [];
  const dryRun = process.env.DRY_RUN === 'true';

  for (const channel of config.channels) {
    if (channel.digest_schedule) {
      const expr = scheduleStringToCron(channel.digest_schedule);
      console.log(`Registering weekly digest for channel ${channel.id}: ${expr}`);
      jobs.push(cron.schedule(expr, async () => {
        console.log(`[cron] Weekly digest firing for channel ${channel.id}`);
        try {
          await runScheduledDigests(config, db, dryRun);
        } catch (err) {
          console.error(`[cron] Weekly digest error for ${channel.id}:`, err.message);
        }
      }));
    }

    if (channel.daily_digest_schedule) {
      const expr = scheduleStringToCron(channel.daily_digest_schedule);
      console.log(`Registering daily digest for channel ${channel.id}: ${expr}`);
      jobs.push(cron.schedule(expr, async () => {
        console.log(`[cron] Daily digest firing for channel ${channel.id}`);
        try {
          await runScheduledDigests(config, db, dryRun);
        } catch (err) {
          console.error(`[cron] Daily digest error for ${channel.id}:`, err.message);
        }
      }));
    }
  }

  const changeDetectionExpr = '0 6-18/2 * * *';
  console.log(`Registering change detection: ${changeDetectionExpr}`);
  jobs.push(cron.schedule(changeDetectionExpr, async () => {
    console.log('[cron] Change detection firing');
    try {
      await runChangeDetection(config, db, dryRun);
    } catch (err) {
      console.error('[cron] Change detection error:', err.message);
    }
  }));

  const port = parseInt(process.env.PORT || '8080', 10);
  const httpServer = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    } else if (await handleOAuthRequest(db, req, res)) {
      // handled by oauth.js
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  httpServer.listen(port, () => {
    console.log(`HTTP server listening on port ${port}`);
  });

  function shutdown() {
    console.log('Shutting down — stopping cron jobs');
    for (const job of jobs) job.stop();
    httpServer.close(() => {
      db.close();
      process.exit(0);
    });
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  console.log(`Server started. ${jobs.length} cron job(s) registered.`);
}

if (require.main === module) {
  start().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { scheduleStringToCron };
