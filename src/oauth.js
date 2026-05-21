const { randomBytes } = require('node:crypto');
const { WebClient } = require('@slack/web-api');
const { upsertWorkspaceFromOAuth } = require('./db.js');

const PENDING_STATES = new Map();
const STATE_TTL_MS = 10 * 60 * 1000;

let _testClient = null;

/**
 * Override the WebClient for tests. Pass null to restore default.
 * @param {object|null} client
 */
function _setClientForTest(client) {
  _testClient = client;
}

/**
 * Insert a state directly into PENDING_STATES for tests.
 * @param {string} state
 * @param {number} ttlMs - positive for future expiry, negative for already-expired
 */
function _addStateForTest(state, ttlMs) {
  PENDING_STATES.set(state, Date.now() + ttlMs);
}

function getClient() {
  return _testClient || new WebClient();
}

/**
 * Validate that SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, and SLACK_REDIRECT_HOST are set.
 * Throws with the missing variable name. Call at server startup before the HTTP server binds.
 */
function validateSlackEnvVars() {
  for (const v of ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET', 'SLACK_REDIRECT_HOST']) {
    if (!process.env[v]) {
      throw new Error(`${v} environment variable is required`);
    }
  }
}

function sweepExpiredStates() {
  const now = Date.now();
  for (const [state, expiry] of PENDING_STATES) {
    if (expiry < now) PENDING_STATES.delete(state);
  }
}

function generateState() {
  sweepExpiredStates();
  const state = randomBytes(16).toString('hex');
  PENDING_STATES.set(state, Date.now() + STATE_TTL_MS);
  return state;
}

function buildAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.SLACK_CLIENT_ID,
    scope: 'chat:write canvases:write im:write commands',
    redirect_uri: `https://${process.env.SLACK_REDIRECT_HOST}/slack/oauth/callback`,
    state
  });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sendError(res, message) {
  res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(
    `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Installation Failed</title></head>` +
    `<body><h1>Installation failed</h1><p>${escapeHtml(message)}</p>` +
    `<p><a href="/slack/install">Try again</a></p></body></html>`
  );
}

/**
 * Handle Slack OAuth installation routes. Returns true if the request was handled.
 * Routes: GET /slack/install, GET /slack/oauth/callback, GET /slack/install/success
 * @param {import('better-sqlite3').Database} db
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @returns {Promise<boolean>}
 */
async function handleOAuthRequest(db, req, res) {
  if (req.method !== 'GET') return false;

  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/slack/install') {
    const state = generateState();
    res.writeHead(302, { Location: buildAuthorizeUrl(state) });
    res.end();
    return true;
  }

  if (url.pathname === '/slack/oauth/callback') {
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    if (!state || !PENDING_STATES.has(state)) {
      sendError(res, 'Installation failed. Please try again.');
      return true;
    }

    const expiry = PENDING_STATES.get(state);
    PENDING_STATES.delete(state);

    if (expiry < Date.now()) {
      sendError(res, 'Installation link expired. Please try again.');
      return true;
    }

    if (error) {
      sendError(res, 'Installation was cancelled.');
      return true;
    }

    try {
      const result = await getClient().oauth.v2.access({
        client_id: process.env.SLACK_CLIENT_ID,
        client_secret: process.env.SLACK_CLIENT_SECRET,
        code
      });

      upsertWorkspaceFromOAuth(db, {
        teamId: result.team.id,
        teamName: result.team.name,
        botToken: result.access_token,
        installedBy: result.authed_user.id
      });

      // TODO #48: DM authed_user.id to trigger onboarding wizard

      res.writeHead(302, { Location: '/slack/install/success' });
      res.end();
    } catch (err) {
      console.error('[oauth] Token exchange failed:', err.message);
      sendError(res, 'Installation failed. Please try again.');
    }
    return true;
  }

  if (url.pathname === '/slack/install/success') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Installation Complete</title></head>` +
      `<body><h1>Installation complete</h1>` +
      `<p>The Calendar Bot has been added to your Slack workspace. You can close this tab.</p></body></html>`
    );
    return true;
  }

  return false;
}

module.exports = { validateSlackEnvVars, handleOAuthRequest, _setClientForTest, _addStateForTest };
