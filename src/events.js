const { readAndVerify } = require('./slack-verify.js');
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

  let rawBody;
  try {
    ({ rawBody } = await readAndVerify(req, process.env.SLACK_SIGNING_SECRET));
  } catch (err) {
    res.writeHead(err.statusCode || 500);
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
