# Calendar Slack Bot - Setup Guide

This guide walks you through setting up your own instance of the calendar-slack-bot.

## Prerequisites

- GitHub account (personal or organization)
- Slack workspace with admin permissions
- Nextcloud instance with calendar access
- Node.js 20+ installed locally (for testing)

## Step 1: Create Your Private Repository

Since the bot configuration will contain sensitive credentials, you need a private repository.

### For Personal Repository:

1. Clone the source repository:
   ```bash
   git clone https://github.com/ORIGINAL_SOURCE/calendar-slack-bot.git
   cd calendar-slack-bot
   ```

2. Create a new private repository at https://github.com/new
   - Set visibility to **Private**
   - Do NOT initialize with README, .gitignore, or license

3. Push to your private repository:
   ```bash
   git remote set-url origin https://github.com/YOUR_USERNAME/calendar-slack-bot.git
   git push -u origin main
   ```

### For Organization Repository:

1. Clone the source repository:
   ```bash
   git clone https://github.com/ORIGINAL_SOURCE/calendar-slack-bot.git
   cd calendar-slack-bot
   ```

2. Create a new private repository in your organization:
   - Go to https://github.com/organizations/YOUR_ORG_NAME/repositories/new
   - Set visibility to **Private**
   - Do NOT initialize with README, .gitignore, or license

3. Enable GitHub Actions (if not already enabled):
   - Go to https://github.com/organizations/YOUR_ORG_NAME/settings/actions
   - Under "Policies", ensure Actions are enabled

4. Push to your organization's private repository:
   ```bash
   git remote set-url origin https://github.com/YOUR_ORG_NAME/calendar-slack-bot.git
   git push -u origin main
   ```

5. Verify you have admin/write access to set secrets and trigger workflows

## Step 2: Set Up Slack App

You need to create a Slack app with permissions to post messages and update Canvas documents.

1. **Create a new Slack app:**
   - Go to https://api.slack.com/apps
   - Click **"Create New App"** → **"From scratch"**
   - App Name: `Calendar Bot` (or your preferred name)
   - Select your workspace
   - Click **"Create App"**

2. **Add OAuth scopes:**
   - In the left sidebar, click **"OAuth & Permissions"**
   - Scroll to **"Scopes"** → **"Bot Token Scopes"**
   - Add these three scopes:
     - `chat:write` - Post messages to channels
     - `chat:write.public` - Post to channels without joining
     - `canvases:write` - Create and update Canvas documents

3. **Install the app to your workspace:**
   - At the top of "OAuth & Permissions" page, click **"Install to Workspace"**
   - Review the permissions and click **"Allow"**

4. **Copy the Bot User OAuth Token:**
   - After installation, copy the **"Bot User OAuth Token"** (starts with `xoxb-`)
   - Save this securely - you'll need it in Step 6

**Note:** You do NOT need the `incoming-webhooks` scope. This bot uses the Slack Web API directly.

## Step 3: Create Slack Canvases

Each channel that receives calendar digests needs its own Canvas document for weekly/daily views.

1. **Create a Canvas in each channel:**
   - Open the Slack channel (e.g., `#team-calendar`)
   - Click the **"+"** button next to the message box
   - Select **"Canvas"**
   - Give it a descriptive title (e.g., `Team Calendar - Weekly View`)
   - Click **"Create"**

2. **Get the Canvas ID:**
   - Open the Canvas you just created
   - Look at the URL in your browser:
     ```
     https://yourworkspace.slack.com/docs/T01234ABCD/F98765ZYXW
     ```
   - The Canvas ID is the part starting with `F` (e.g., `F98765ZYXW`)
   - **Alternative:** Right-click the Canvas → "Copy link" to get the full URL

3. **Save the mapping:**
   - Note which Canvas ID belongs to which channel
   - You'll need this in Step 5 when building `config.json`

## Step 4: Find Slack Channel IDs

You need the internal Slack channel ID for each channel where the bot will post. These IDs typically start with `C`.

**Method 1: Using Channel Details (Easiest)**

1. Open the Slack channel in your workspace
2. Click the **channel name** at the top to open channel details
3. Scroll down to the bottom of the details panel
4. Look for the **Channel ID** field
5. Copy the ID (e.g., `C01234ABCD`)

**Method 2: Using the URL**

1. Open the Slack channel in your browser (not the desktop app)
2. Look at the URL:
   ```
   https://yourworkspace.slack.com/archives/C01234ABCD
   ```
3. The channel ID is the part after `/archives/`

**Important for Private Channels:**

If you're using a private channel, you MUST invite the bot:
- In the private channel, type: `/invite @Calendar Bot` (use your app's name)
- Or: Channel name → "Integrations" → "Add apps" → Select your bot
- The bot cannot post to private channels unless it's a member

**What to save:**
- Channel ID (e.g., `C01234ABCD`)
- Corresponding Canvas ID from Step 3 (e.g., `F98765ZYXW`)

## Step 5: Build config.json

Create your configuration file with all the IDs and settings you've collected.

**Important:** `config.json` is in `.gitignore` and will NOT be pushed to GitHub. You'll store it as a GitHub Secret instead.

1. **Copy the example config:**
   ```bash
   cp config.example.json config.json
   ```

2. **Edit `config.json` with your values:**

   **Global settings:**
   - `locale`: Default language/date format (e.g., `"en-US"`, `"de-DE"`)
   - `error_channel`: Channel ID where bot posts error messages (create a dedicated channel if desired)

   **CalDAV credentials:**
   - `username`: Your actual Nextcloud username
   - `password`: Use `"${CALDAV_PASSWORD}"` - actual password stored in GitHub Secret

   **Calendars:**
   - Each calendar needs a unique key (e.g., `"team-calendar"`)
   - `name`: Display name shown in Slack
   - `caldav_url`: Full CalDAV URL from Nextcloud
     - **To find:** Nextcloud Calendar → Click three dots (⋯) on calendar → "Private link that can be used with external clients"
     - Must end with trailing `/`

   **Channels (array):**
   - `id`: Channel ID from Step 4
   - `name`: Descriptive name like `"#team-calendar"`
   - `canvas_id`: Canvas ID from Step 3
   - `calendars`: Array of calendar keys (e.g., `["team-calendar"]`)
   - `digest_schedule`: When to post weekly digest (e.g., `"sunday 18:00"`)
   - `daily_digest_schedule`: When to post daily digest (e.g., `"weekdays 08:00"`)

3. **Save the file** - it stays local only (in `.gitignore`)

### Optional: Local Testing Setup

If you want to test the bot locally before deploying to GitHub Actions:

1. **Create a `.env` file** from the example:
   ```bash
   cp .env.example .env
   ```

2. **Edit `.env` with your actual credentials:**
   ```
   CALDAV_PASSWORD=your-actual-nextcloud-password
   SLACK_BOT_TOKEN=xoxb-your-actual-slack-bot-token
   ```

3. **Install dependencies** (if not already done):
   ```bash
   npm install
   ```

4. **Run tests:**
   ```bash
   npm test
   ```

5. **Test the bot locally** (dry-run mode - won't post to Slack):
   ```bash
   node -r dotenv/config src/bot.js --dry-run --weekly-digest
   ```

**Note:** The `.env` file is in `.gitignore` and will never be committed.

## Step 6: Configure GitHub Secrets

Coming next...
