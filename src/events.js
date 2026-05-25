const { createHmac } = require('node:crypto');
const { markWorkspaceInactive } = require('./db.js');

/**
 * Throw if SLACK_SIGNING_SECRET is missing. Call at server startup.
 */
function validateSlackEventsEnvVars() {
  if (!process.env.SLACK_SIGNING_SECRET) {
    throw new Error('SLACK_SIGNING_SECRET environment variable is required');
  }
}

/**
 * Handle POST /slack/events. Returns true if the route was handled, false otherwise.
 * Verifies Slack HMAC signature and timestamp before processing any event.
 * @param {import('better-sqlite3').Database} db
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {((teamId: string) => void)|undefined} onUninstall
 * @returns {Promise<boolean>}
 */
async function handleEventsRequest(db, req, res, onUninstall) {
  if (req.method !== 'POST') return false;
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/slack/events') return false;

  const chunks = [];
  await new Promise((resolve, reject) => {
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', resolve);
    req.on('error', reject);
  });
  const rawBody = Buffer.concat(chunks).toString('utf8');

  const timestamp = req.headers['x-slack-request-timestamp'];
  const ageSecs = Math.abs(Date.now() / 1000 - parseInt(timestamp || '0', 10));
  if (!timestamp || ageSecs > 300) {
    res.writeHead(403);
    res.end();
    return true;
  }

  const expected = 'v0=' + createHmac('sha256', process.env.SLACK_SIGNING_SECRET)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest('hex');
  const provided = req.headers['x-slack-signature'];
  if (!provided || provided !== expected) {
    res.writeHead(403);
    res.end();
    return true;
  }

  const body = JSON.parse(rawBody);

  if (body.type === 'url_verification') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ challenge: body.challenge }));
    return true;
  }

  if (body.type === 'event_callback' && body.event && body.event.type === 'app_uninstalled') {
    markWorkspaceInactive(db, body.team_id);
    if (onUninstall) onUninstall(body.team_id);
    res.writeHead(200);
    res.end();
    return true;
  }

  res.writeHead(200);
  res.end();
  return true;
}

module.exports = { validateSlackEventsEnvVars, handleEventsRequest };
