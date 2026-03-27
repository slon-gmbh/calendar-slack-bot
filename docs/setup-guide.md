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

Store your sensitive configuration and credentials as encrypted GitHub Secrets.

1. **Go to your repository settings:**
   - Navigate to: `https://github.com/YOUR_ORG/calendar-slack-bot/settings/secrets/actions`
   - Or: Repository → Settings → Secrets and variables → Actions

2. **Add these 3 secrets** (click "New repository secret" for each):

   **`CONFIG_JSON`**
   - Copy the **entire contents** of your `config.json` file
   - This includes your username and the `${CALDAV_PASSWORD}` placeholder

   **`CALDAV_PASSWORD`**
   - Your actual Nextcloud password

   **`SLACK_BOT_TOKEN`**
   - Your Bot User OAuth Token from Step 2 (starts with `xoxb-`)

3. **Note:** `GITHUB_TOKEN` is automatically provided by GitHub Actions (no need to create it)

## Step 7: Set Up Nextcloud Webhook (Optional)

**Note:** Real-time webhooks require the "Webhooks" app which is currently incompatible with Nextcloud 32+. This step can be skipped - the bot works perfectly with scheduled polling (hourly checks via GitHub Actions). Changes will appear within 1 hour instead of 5-10 minutes.

**If you have Nextcloud ≤25 with the Webhooks app available:**

### Part A: Create GitHub Personal Access Token (PAT)

1. **Go to GitHub token settings:**
   - Visit: https://github.com/settings/tokens?type=beta
   - Click **"Generate new token"**

2. **Configure the token:**
   - Token name: `Triggers calendar-slack-bot on Nextcloud calendar changes`
   - Expiration: Choose based on your needs (30 days for testing, "No expiration" for production)
   - **Resource owner:** Select your organization
   - **Repository access:** "Only select repositories" → Choose `calendar-slack-bot`
   - **Repository permissions:**
     - **Contents:** Read and write
     - (Metadata will be automatically included as required)

3. **Generate and copy:**
   - Click **"Generate token"**
   - Copy the token (starts with `github_pat_`)

### Part B: Configure Nextcloud Workflow

1. **Install required apps:**
   - Apps → Flow category → Install **"Webhooks"** app

2. **Create a new workflow:**
   - Settings → Flow (or "Ablauf")
   - Click **"Add new flow"**

3. **Configure the trigger:**
   - **When:** Select "Item in calendar is created or updated"
   - **Then:** Select "Send a request to a URL"

4. **Configure the webhook:**

   **URL:**
   ```
   https://api.github.com/repos/YOUR_ORG/calendar-slack-bot/dispatches
   ```

   **Method:** `POST`

   **Headers:**
   - Name: `Authorization`, Value: `Bearer github_pat_YOUR_TOKEN`
   - Name: `Accept`, Value: `application/vnd.github.v3+json`

   **Body:**
   ```json
   {"event_type":"calendar_changed","client_payload":{}}
   ```

5. **Save the workflow**

**For everyone else:** Skip this step and rely on scheduled polling (works great!).

## Step 8: First Test Run (Dry Run)

Test the bot using GitHub Actions' manual trigger with dry-run mode. This validates your configuration without posting to Slack.

1. **Go to GitHub Actions:**
   - Visit: `https://github.com/YOUR_ORG/calendar-slack-bot/actions`
   - Or: Repository → Actions tab

2. **Select the scheduled workflow:**
   - In the left sidebar, click **"Scheduled Digests"**

3. **Run workflow manually:**
   - Click **"Run workflow"** dropdown (top right)
   - Configure:
     - **Branch:** `main`
     - **Digest type:** `weekly` (forces a digest regardless of schedule)
     - **Dry run:** ✅ **Check this box**
   - Click **"Run workflow"**

4. **Check the results:**
   - Click on the workflow run that appears
   - Click on the job name to see logs
   - Look for `[DRY RUN]` messages showing:
     - Calendar events fetched from Nextcloud
     - Preview of messages that would be posted
     - Canvas content that would be updated
   - Should end with: `[DRY RUN] No Slack API calls were made.`

**Common issues:**
- If tests fail: Check that all code is pushed and up to date
- If config errors: Verify `CONFIG_JSON` secret is valid JSON
- If CalDAV errors: Check `CALDAV_PASSWORD` secret and CalDAV URLs
- If no events shown: Verify you have events in your calendar

**Success looks like:**
```
Running weekly digest...
[DRY RUN] Would post to channel C01234ABC:
📅 Week 13 · Monday — Sunday
...
[DRY RUN] Would update Canvas F98765XYZ:
...
[DRY RUN] No Slack API calls were made.
```

## Step 9: First Live Run

Now run the bot for real to post actual messages to Slack.

1. **Double-check you're ready:**
   - ✅ Dry-run test passed in Step 8
   - ✅ Bot is invited to all channels (especially private ones)
   - ✅ Canvas documents are created in each channel
   - ✅ All GitHub Secrets are configured

2. **Run the workflow without dry-run:**
   - Go to: Repository → Actions → **"Scheduled Digests"**
   - Click **"Run workflow"**
   - Configure:
     - **Branch:** `main`
     - **Digest type:** `weekly`
     - **Dry run:** ❌ **Uncheck this box** (set to false)
   - Click **"Run workflow"**

3. **Watch it run:**
   - Click on the workflow run
   - Watch the logs
   - Should complete successfully in 10-30 seconds
   - Look for lines like: `Fetched X events from calendar 'Name' (id)`

4. **Check Slack:**
   - Go to your Slack channels
   - You should see:
     - A new message from your Calendar Bot with the digest
     - The Canvas document updated with the week view
   - Check all configured channels

5. **Verify the output:**
   - ✅ Correct timezone (times match Nextcloud)
   - ✅ German localization (KW, Termine, Kalender)
   - ✅ All calendars included
   - ✅ Bold header with "Wochenübersicht"
   - ✅ Canvas updated

**If something goes wrong:**
- Check workflow logs for error messages
- Verify bot is a member of all channels
- Verify Canvas IDs are correct
- Verify SLACK_BOT_TOKEN is valid
- Check CalDAV URLs are accessible

**Success!** Your calendar-slack-bot is now running. The scheduled workflow will run hourly and post digests according to your configured schedules.

## Change Detection (Automatic)

The change detection workflow runs automatically every 6 hours to detect calendar changes and post notifications.

### How It Works

**Scheduled polling:**
- GitHub Actions runs `.github/workflows/change-detection.yml` every 6 hours
- Fetches all calendars for 5-week window (current week + 4 weeks ahead)
- Diffs against cached state stored in `cache-state` orphan git branch
- Posts bundled change notifications to Slack channels

**First run (baseline):**
- On first run or missing cache, establishes baseline without posting notifications
- Subsequent runs detect changes and post notifications

**Respects channel settings:**
- Honors `notifications` setting per channel (`"all"`, `"urgent_only"`, `"disabled"`, etc.)
- See `config.example.json` for notification options

### Adjusting Polling Frequency

**Default:** 6-hourly (`0 */6 * * *`) = ~120 min/month (6% of free tier)

**To change frequency:**

1. Edit `.github/workflows/change-detection.yml`
2. Modify the cron schedule:
   ```yaml
   schedule:
     - cron: '0 * * * *'  # Hourly (720 min/month)
   ```

**Common schedules:**
- Hourly: `0 * * * *` (~720 min/month, 36% of free tier)
- 6-hourly: `0 */6 * * *` (~120 min/month, 6% of free tier)
- 12-hourly: `0 */12 * * *` (~60 min/month, 3% of free tier)

### Manual Testing

Test change detection manually:

1. Go to: Repository → Actions → **"Change Detection"**
2. Click **"Run workflow"**
3. Configure:
   - **Branch:** `main`
   - **Dry run:** ✅ Check for testing (no Slack posts, no cache commits)
4. Click **"Run workflow"**

Check the logs to see detected changes.

## Next Steps

### Automated Scheduling

The bot will now run automatically:
- **Hourly:** GitHub Actions polls for schedule matches
- **Weekly digests:** Posted according to `digest_schedule` in config
- **Daily digests:** Posted according to `daily_digest_schedule` in config

### Maintenance

**Updating Configuration:**
1. Edit your local `config.json`
2. Update the `CONFIG_JSON` GitHub Secret
3. Changes take effect on next workflow run

**Adding/Removing Calendars:**
1. Get the CalDAV URL (or public sharing link)
2. Add to `calendars` section in config.json
3. Reference in channel's `calendars` array
4. Update GitHub Secret

**Monitoring:**
- Check the error channel for bot errors
- Review workflow runs in Actions tab
- All logs are available in GitHub Actions

### Future Enhancements

See the [GitHub Issues](https://github.com/slon-gmbh/calendar-slack-bot/issues) for planned features:
- Calendar color matching with Nextcloud
- Clickable Canvas links
- Summary vs full content in messages
- Interactive setup wizard

## Troubleshooting

### Cache Branch Cleanup

If you remove or rename a calendar in `config.json`, the old cache file remains in the `cache-state` branch. These files are harmless (never read) but accumulate over time.

**To clean up manually:**

```bash
# Checkout cache branch
git fetch origin cache-state
git checkout cache-state

# List cache files
ls *.json

# Remove old calendar cache
git rm old-calendar-id.json

# Commit and push
git commit -m "chore: remove cache for old-calendar-id"
git push origin cache-state

# Return to main
git checkout main
```

### Change Detection Not Posting Notifications

**Check channel notification settings:**

If changes are detected but not posted, verify the channel's `notifications` setting in `config.json`:

- `"all"` - Posts all changes (default)
- `"urgent_only"` - Only events within 24 hours
- `"disabled"` - No change notifications

Check workflow logs for: `"Change detected but channel has notifications filtered - skipping"`

### First Run Shows No Changes

This is expected. The first run establishes a baseline without posting notifications to avoid spamming "new event" notifications for the entire calendar.

**To verify baseline was established:**

1. Go to: Repository → Actions → **"Change Detection"**
2. Check recent run logs
3. Look for: `"No previous state for <calendar-id> - establishing baseline"`
4. Verify cache-state branch exists: `git fetch origin cache-state && git checkout cache-state && ls *.json`

---

**Congratulations!** Your calendar-slack-bot is fully configured and running.
