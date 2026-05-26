const { createHmac } = require('node:crypto');

/**
 * Verify a Slack request HMAC signature (pure, synchronous).
 * @param {string} rawBody
 * @param {string} timestamp
 * @param {string} signature - value of x-slack-signature header
 * @param {string} secret - SLACK_SIGNING_SECRET
 * @returns {boolean}
 */
function verifySlackRequest(rawBody, timestamp, signature, secret) {
  const expected = 'v0=' + createHmac('sha256', secret)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest('hex');
  return signature === expected;
}

/**
 * Read raw HTTP request body, verify Slack timestamp (<=300 s) and HMAC signature.
 * Returns { rawBody, parsedBody } where parsedBody is URL-decoded (for slash commands).
 * Events handlers should use rawBody and JSON.parse themselves.
 * Throws { statusCode: 403 } on any verification failure.
 * @param {import('http').IncomingMessage} req
 * @param {string} secret - SLACK_SIGNING_SECRET
 * @returns {Promise<{rawBody: string, parsedBody: Object}>}
 */
async function readAndVerify(req, secret) {
  const chunks = [];
  await new Promise((resolve, reject) => {
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', resolve);
    req.on('error', reject);
  });
  const rawBody = Buffer.concat(chunks).toString('utf8');

  const timestamp = req.headers['x-slack-request-timestamp'];
  const ageSecs = Math.abs(Date.now() / 1000 - parseInt(timestamp || '0', 10));
  if (!timestamp || ageSecs > 300) throw { statusCode: 403 };

  const signature = req.headers['x-slack-signature'];
  if (!signature || !verifySlackRequest(rawBody, timestamp, signature, secret)) {
    throw { statusCode: 403 };
  }

  const parsedBody = Object.fromEntries(new URLSearchParams(rawBody));
  return { rawBody, parsedBody };
}

module.exports = { verifySlackRequest, readAndVerify };
