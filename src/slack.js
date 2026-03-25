const { WebClient } = require('@slack/web-api');

let client = null;

/**
 * Initialize Slack client
 */
function getClient() {
  if (!client) {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) {
      throw new Error('SLACK_BOT_TOKEN environment variable not set');
    }
    client = new WebClient(token);
  }
  return client;
}

/**
 * Post message to Slack channel
 * @param {string} channelId - Slack channel ID
 * @param {string} text - Message text (markdown)
 * @param {boolean} dryRun - If true, log instead of posting
 * @returns {Promise<void>}
 */
async function postMessage(channelId, text, dryRun = false) {
  if (dryRun) {
    console.log(`[DRY RUN] Would post to channel ${channelId}:`);
    console.log(text);
    console.log('');
    return;
  }

  try {
    await getClient().chat.postMessage({
      channel: channelId,
      text: text,
      mrkdwn: true
    });
  } catch (error) {
    console.error(`Failed to post message to ${channelId}:`, error.message);
    throw error;
  }
}

/**
 * Update Slack Canvas content
 * @param {string} canvasId - Slack Canvas ID
 * @param {string} content - Markdown content
 * @param {boolean} dryRun - If true, log instead of updating
 * @returns {Promise<void>}
 */
async function updateCanvas(canvasId, content, dryRun = false) {
  if (dryRun) {
    console.log(`[DRY RUN] Would update Canvas ${canvasId}:`);
    console.log(content);
    console.log('');
    return;
  }

  try {
    await getClient().canvases.edit({
      canvas_id: canvasId,
      changes: [{
        operation: 'replace',
        document_content: {
          type: 'markdown',
          markdown: content
        }
      }]
    });
  } catch (error) {
    console.error(`Failed to update Canvas ${canvasId}:`, error.message);
    throw error;
  }
}

/**
 * Post error notification
 * @param {string} errorChannelId - Error channel ID (optional)
 * @param {string} message - Error message
 * @param {boolean} dryRun - If true, log instead of posting
 * @returns {Promise<void>}
 */
async function postErrorNotification(errorChannelId, message, dryRun = false) {
  if (!errorChannelId) {
    console.error('Error:', message);
    return;
  }

  const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : 'N/A';

  const errorText = `⚠️ **Calendar Bot Error**\n\n${message}\n\nTime: ${new Date().toISOString()}\nRun: ${runUrl}`;

  await postMessage(errorChannelId, errorText, dryRun);
}

module.exports = {
  postMessage,
  updateCanvas,
  postErrorNotification
};
