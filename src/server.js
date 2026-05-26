const http = require('node:http');
const path = require('node:path');
const { openDb } = require('./db.js');
const { validateEncryptionKey } = require('./crypto.js');
const { validateSlackEnvVars, handleOAuthRequest } = require('./oauth.js');
const { validateSlackEventsEnvVars, handleEventsRequest } = require('./events.js');
const { validateSlackCommandsEnvVars, handleSlashCommand } = require('./commands.js');
const { validateInteractionsEnvVars, handleInteractions } = require('./interactions.js');
const registry = require('./scheduler-registry.js');

async function start() {
  validateEncryptionKey();
  validateSlackEnvVars();
  validateSlackEventsEnvVars();
  validateSlackCommandsEnvVars();
  validateInteractionsEnvVars();

  const dataDir = process.env.DATA_DIR;
  if (!dataDir) throw new Error('DATA_DIR environment variable not set');

  const db = openDb(path.join(dataDir, 'bot.db'));
  const dryRun = process.env.DRY_RUN === 'true';

  await registry.scheduleAllWorkspaces(db, dryRun);

  const onInstall = async (workspaceId) => {
    await registry.scheduleWorkspace(db, workspaceId, dryRun);
  };

  const onUninstall = (workspaceId) => {
    registry.unscheduleWorkspace(workspaceId);
  };

  const onReschedule = async (workspaceId) => {
    await registry.scheduleWorkspace(db, workspaceId, dryRun);
  };

  const port = parseInt(process.env.PORT || '8080', 10);
  const httpServer = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } else if (await handleOAuthRequest(db, req, res, onInstall)) {
        // handled by oauth.js
      } else if (await handleEventsRequest(db, req, res, onUninstall)) {
        // handled by events.js
      } else if (await handleSlashCommand(db, req, res)) {
        // handled by commands.js
      } else if (await handleInteractions(db, req, res, onReschedule)) {
        // handled by interactions.js
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
    registry.stopAll();
    httpServer.close(() => {
      db.close();
      process.exit(0);
    });
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  console.log('Server started.');
}

if (require.main === module) {
  start().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = {};
