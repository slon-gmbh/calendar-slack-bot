# Calendar Slack Bot

GitHub Actions-based Slack bot that bridges Nextcloud CalDAV calendars with Slack channels.

## Features

- **Automated Digests**: Weekly and daily calendar digests posted to Slack channels
- **Real-time Updates**: Webhook-triggered change notifications
- **Many-to-Many Mapping**: Any calendar can post to multiple channels
- **Locale Support**: Multilingual date/time formatting
- **Zero Infrastructure**: Runs entirely in GitHub Actions

## Prerequisites

### 1. Nextcloud Webhook Setup (REQUIRED)

Nextcloud does not send webhooks by default. Install ONE of these apps:

#### Option A: Workflow App (Recommended)
1. Navigate to Settings → Flow in Nextcloud admin
2. Create new workflow:
   - Trigger: "Calendar event created or updated"
   - Action: "Send HTTP request"
   - URL: `https://api.github.com/repos/OWNER/REPO/dispatches`
   - Headers:
     - `Authorization: token YOUR_GITHUB_PAT`
     - `Content-Type: application/json`
   - Body: `{"event_type": "calendar_changed", "client_payload": {"calendar_id": "CALENDAR_NAME"}}`

#### Option B: WebhookListener App
- Install from Nextcloud app store
- Configure for calendar events
- Point to same GitHub URL as above

**Without this setup, real-time notifications will not work.**

### 2. GitHub PAT for Webhooks

Create a GitHub Personal Access Token with `repo` scope:
1. Go to Settings → Developer settings → Personal access tokens
2. Generate new token with `repo` scope
3. Store in Nextcloud webhook configuration
4. Rotate periodically for security

### 3. Slack Bot Setup

1. Create Slack app at api.slack.com/apps
2. Add bot scopes:
   - `canvases:write`
   - `canvases:read`
   - `chat:write`
3. Install to workspace
4. Copy bot token (xoxb-...)
5. Create Canvas for each channel (Slack UI)
6. Copy channel IDs and Canvas IDs

## Installation

### Step 1: Create Private Repository

**Do NOT fork this repo** (forks are public). Instead:

```bash
# Create new private repo on GitHub first
git clone https://github.com/OWNER/calendar-slack-bot.git
cd calendar-slack-bot
git remote set-url origin https://github.com/YOUR-ORG/your-private-bot.git
git push -u origin main
```

### Step 2: Configure Secrets

Add four GitHub Secrets (Settings → Secrets and variables → Actions):

- `CALDAV_USERNAME`: Nextcloud username
- `CALDAV_PASSWORD`: Nextcloud password
- `SLACK_BOT_TOKEN`: Slack bot token (xoxb-...)
- `CONFIG_JSON`: Full contents of config.json (see below)

### Step 3: Create Configuration

Copy `config.example.json` to `config.json` and fill in:

```json
{
  "locale": "en-US",
  "caldav_credentials": {
    "username": "${CALDAV_USERNAME}",
    "password": "${CALDAV_PASSWORD}"
  },
  "calendars": {
    "team-calendar": {
      "name": "Team Calendar",
      "caldav_url": "https://nextcloud.example.com/remote.php/dav/calendars/user/team/"
    }
  },
  "channels": [
    {
      "id": "C01234TEAM",
      "canvas_id": "F9876CANVAS",
      "calendars": ["team-calendar"],
      "digest_schedule": "sunday 18:00",
      "daily_digest_schedule": "weekdays 08:00"
    }
  ]
}
```

Paste the entire JSON as the `CONFIG_JSON` secret.

### Step 4: Test

Trigger manual workflow:
1. Go to Actions → Scheduled Digests → Run workflow
2. Select `digest_type: scheduled`
3. Enable `dry_run: true`
4. Check logs for output

## Schedule Configuration

**Hourly Polling**: Workflows run every hour and check channel schedules with ±30 min tolerance.

**Any schedule time works automatically** - no workflow editing needed.

**All times are UTC** - calculate offset for your timezone:
- CET (UTC+1): `18:00` local = `17:00` in config
- PST (UTC-8): `18:00` local = `02:00` (next day) in config

## Upstream Updates

This is a **template repository**. Upstream updates require manual sync:

1. Monitor public repo for important updates
2. Review commits and changes
3. Cherry-pick relevant updates to your private repo

Automated sync is a v2 consideration.

## Troubleshooting

### Digests not posting
- Check workflow runs in Actions tab
- Verify schedule matches current UTC time (±30 min)
- Test with manual trigger and dry-run

### Webhooks not working
- Verify Nextcloud Workflow/WebhookListener app is installed
- Check GitHub PAT has `repo` scope
- Test with manual trigger and test_payload

### Canvas not updating
- Verify Canvas ID (starts with F)
- Check bot has `canvases:write` scope
- Verify bot is member of channel

## License

MIT
