const https = require('node:https');
const { readAndVerify } = require('./slack-verify.js');
const { getWorkspace, loadRunState } = require('./db.js');
const { loadConfigFromDb } = require('./config.js');
const { runChangeDetection } = require('./runner.js');

let _runner = runChangeDetection;

/**
 * Override runChangeDetection for tests. Pass null to restore.
 * @param {Function|null} fn
 */
function _setRunnerForTest(fn) {
  _runner = fn || runChangeDetection;
}

/**
 * Throw if SLACK_SIGNING_SECRET is missing. Call at server startup.
 */
function validateSlackCommandsEnvVars() {
  if (!process.env.SLACK_SIGNING_SECRET) {
    throw new Error('SLACK_SIGNING_SECRET environment variable is required');
  }
}

function sendEphemeral(res, text) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ response_type: 'ephemeral', text }));
}

function sendEphemeralBlocks(res, blocks) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ response_type: 'ephemeral', blocks }));
}

async function postToResponseUrl(responseUrl, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const url = new URL(responseUrl);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => { res.resume(); resolve(); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function subHelp(res) {
  sendEphemeralBlocks(res, [{
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: '*Available commands:*\n`/calendar help` — show this help\n`/calendar config` — show channel calendar setup\n`/calendar status` — show last digest run times\n`/calendar refresh` — run calendar change detection now'
    }
  }]);
}

function subConfig(db, teamId, teamName, res) {
  let config;
  try {
    config = loadConfigFromDb(db, teamId);
  } catch (err) {
    console.error('[commands] loadConfigFromDb failed:', err.message);
    sendEphemeral(res, 'Could not load workspace config.');
    return;
  }

  if (!config.channels || config.channels.length === 0) {
    sendEphemeral(res, 'No calendars configured for this workspace.');
    return;
  }

  const blocks = [{ type: 'header', text: { type: 'plain_text', text: `Calendar Config — ${teamName}` } }];
  for (let i = 0; i < config.channels.length; i++) {
    const ch = config.channels[i];
    const calNames = ch.calendars.map(id => config.calendars[id]?.name || id).join(', ');
    const label = ch.name ? `#${ch.name}` : ch.id;
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${label}*\nDigest: \`${ch.digest_schedule || 'disabled'}\`\nDaily: \`${ch.daily_digest_schedule || 'disabled'}\`\nCalendars: ${calNames}`
      }
    });
    if (i < config.channels.length - 1) blocks.push({ type: 'divider' });
  }
  sendEphemeralBlocks(res, blocks);
}

function subStatus(db, teamId, teamName, res) {
  const rows = db.prepare('SELECT channel_id, name FROM channels WHERE workspace_id = ?').all(teamId);
  if (rows.length === 0) {
    sendEphemeral(res, 'No channels configured for this workspace.');
    return;
  }
  const blocks = [{ type: 'header', text: { type: 'plain_text', text: `Bot Status — ${teamName}` } }];
  for (const row of rows) {
    const weekly = loadRunState(db, teamId, row.channel_id, 'weekly');
    const daily = loadRunState(db, teamId, row.channel_id, 'daily');
    const label = row.name ? `#${row.name}` : row.channel_id;
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${label}*\nLast weekly digest: \`${weekly ? weekly.toISOString() : 'never'}\`\nLast daily digest: \`${daily ? daily.toISOString() : 'never'}\``
      }
    });
  }
  sendEphemeralBlocks(res, blocks);
}

function subRefresh(db, teamId, responseUrl, res) {
  sendEphemeral(res, 'Refreshing calendars…');
  setImmediate(async () => {
    let payload;
    try {
      await _runner(db, teamId, false);
      payload = { response_type: 'ephemeral', text: 'Change detection complete.' };
    } catch (err) {
      payload = { response_type: 'ephemeral', text: `Change detection failed: ${err.message}` };
    }
    try {
      await postToResponseUrl(responseUrl, payload);
    } catch (err) {
      console.warn('[commands] POST to response_url failed:', err.message);
    }
  });
}

/**
 * Handle POST /slack/commands. Returns true if handled, false otherwise.
 * Routes /calendar subcommands: help, config, status, refresh.
 * @param {import('better-sqlite3').Database} db
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @returns {Promise<boolean>}
 */
async function handleSlashCommand(db, req, res) {
  if (req.method !== 'POST') return false;
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/slack/commands') return false;

  let parsedBody;
  try {
    ({ parsedBody } = await readAndVerify(req, process.env.SLACK_SIGNING_SECRET));
  } catch (err) {
    res.writeHead(err.statusCode || 500);
    res.end();
    return true;
  }

  const { team_id, text = '', response_url = '' } = parsedBody;
  const workspace = getWorkspace(db, team_id);
  if (!workspace) {
    sendEphemeral(res, 'Workspace not configured yet.');
    return true;
  }

  const subcommand = (text || '').trim().split(/\s+/)[0].toLowerCase();

  switch (subcommand) {
    case 'help':    subHelp(res); break;
    case 'config':  subConfig(db, team_id, workspace.team_name, res); break;
    case 'status':  subStatus(db, team_id, workspace.team_name, res); break;
    case 'refresh': subRefresh(db, team_id, response_url, res); break;
    default:        sendEphemeral(res, 'Unknown command. Try `/calendar help`.'); break;
  }

  return true;
}

module.exports = { validateSlackCommandsEnvVars, handleSlashCommand, _setRunnerForTest };
