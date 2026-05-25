const http = require('node:http');
const path = require('node:path');
const cron = require('node-cron');
const { loadConfigFromDb } = require('./config.js');
const { openDb } = require('./db.js');
const { runScheduledDigests, runChangeDetection } = require('./runner.js');
const { validateEncryptionKey } = require('./crypto.js');
const { validateSlackEnvVars, handleOAuthRequest } = require('./oauth.js');
const { scheduleStringToCron } = require('./scheduler-registry.js');

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
    try {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } else if (await handleOAuthRequest(db, req, res)) {
        // handled by oauth.js
      } else {
        res.writeHead(404);
        res.end();
      }
    } catch (err) {
      console.error('[http] Unhandled error:', err.message);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end();
      }
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

module.exports = {};
