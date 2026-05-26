'use strict';

const { WebClient } = require('@slack/web-api');
const { readAndVerify } = require('./slack-verify.js');
const { getWorkspace, updateChannelSchedule } = require('./db.js');
const { scheduleStringToCron } = require('./scheduler-registry.js');

let _apiClientFactory = (token) => new WebClient(token);

/**
 * Override the Slack API client factory for tests. Pass null to restore.
 * @param {Function|null} fn - factory: (token) => clientObject
 * @example
 * _setApiClientForTest(() => ({ views: { open: async () => ({}) } }));
 */
function _setApiClientForTest(fn) {
  _apiClientFactory = fn || ((token) => new WebClient(token));
}

/**
 * Throw if SLACK_SIGNING_SECRET is missing. Call at server startup.
 */
function validateInteractionsEnvVars() {
  if (!process.env.SLACK_SIGNING_SECRET) {
    throw new Error('SLACK_SIGNING_SECRET environment variable is required');
  }
}

function ackEmpty(res) {
  res.writeHead(200);
  res.end();
}

function ackJson(res, body) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function handleConfigEditAction(db, workspace, action, triggerId, res) {
  ackEmpty(res);
}

async function handleConfigEditSubmit(db, payload, onReschedule, res) {
  ackEmpty(res);
}

/**
 * Handle POST /slack/interactions. Returns true if handled, false otherwise.
 * Verifies Slack HMAC signature, parses payload JSON from the URLSearchParams
 * 'payload' field, and dispatches by payload.type.
 * @param {import('better-sqlite3').Database} db
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {((workspaceId: string) => Promise<void>)|null} onReschedule
 * @returns {Promise<boolean>}
 */
async function handleInteractions(db, req, res, onReschedule) {
  if (req.method !== 'POST') return false;
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/slack/interactions') return false;

  let rawBody;
  try {
    ({ rawBody } = await readAndVerify(req, process.env.SLACK_SIGNING_SECRET));
  } catch (err) {
    res.writeHead(err.statusCode || 500);
    res.end();
    return true;
  }

  let payload;
  try {
    const raw = new URLSearchParams(rawBody).get('payload');
    if (!raw) throw new Error('missing payload field');
    payload = JSON.parse(raw);
  } catch {
    res.writeHead(400);
    res.end();
    return true;
  }

  const workspace = getWorkspace(db, payload.team?.id);
  if (!workspace) {
    ackEmpty(res);
    return true;
  }

  if (payload.type === 'block_actions') {
    for (const action of (payload.actions || [])) {
      if (action.action_id === 'config_edit_channel') {
        await handleConfigEditAction(db, workspace, action, payload.trigger_id, res);
        return true;
      }
    }
    ackEmpty(res);
    return true;
  }

  if (payload.type === 'view_submission') {
    if (payload.view?.callback_id === 'config_edit_channel') {
      await handleConfigEditSubmit(db, payload, onReschedule, res);
      return true;
    }
    ackEmpty(res);
    return true;
  }

  ackEmpty(res);
  return true;
}

module.exports = { validateInteractionsEnvVars, handleInteractions, _setApiClientForTest };
