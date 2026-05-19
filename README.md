# Calendar Slack Bot

A Slack bot that bridges Nextcloud CalDAV calendars with Slack channels — posting weekly digests, daily summaries, and real-time change notifications.

## Branches

This repo has two long-lived branches with different architectures:

| Branch | Approach | Status |
|--------|----------|--------|
| `main` | GitHub Actions, self-hosted | Stable — use this to run your own instance |
| `v2` | Fly.io persistent server, multi-tenant SaaS | In development — the managed "Add to Slack" version |

**`main` (this branch):** zero-infrastructure, runs entirely in GitHub Actions. Each community runs their own private fork. Full data control.

**`v2`:** one central deployment, any Slack workspace installs via OAuth. Managed service.

## Features

- **Automated Digests**: Weekly and daily calendar digests posted to Slack channels
- **Real-time Updates**: Webhook-triggered change notifications
- **Change Detection**: Scheduled polling (6-hourly) detects calendar changes and posts bundled notifications
- **Many-to-Many Mapping**: Any calendar can post to multiple channels
- **Locale Support**: Multilingual date/time formatting
- **Zero Infrastructure**: Runs entirely in GitHub Actions

### Recurring Event Support

The bot intelligently handles recurring events:

- **Smart notifications**: Single notification per recurring event (not one per instance)
- **Human-readable patterns**: "Wöchentlich, Mo., Mi., Fr." instead of technical RRULE
- **Pattern change detection**: Notifies when recurrence rules are modified
- **All patterns supported**: Daily, weekly, monthly, yearly with intervals and positions

Example notification:
```
1 Kalenderänderung

Neuer Termin:
• Team Standup · Täglich · 09:00-09:15
```

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

## Roadmap

Development is tracked in the [GitHub Project — Calendar Slack Bot Roadmap](https://github.com/orgs/slon-gmbh/projects/12).

Active milestone: **v1: multi-tenant Slack app** — rebuilding the bot as a proper installable Slack app on the `v2` branch. The self-hosted GitHub Actions approach on `main` will continue to be maintained.

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

## Deployment (Fly.io)

### First-time setup

1. Install the Fly CLI: https://fly.io/docs/hands-on/install-flyctl/
2. Authenticate: `fly auth login`
3. Create the app and volume:
   ```bash
   fly apps create slon-calendar-bot
   fly volumes create calendar_bot_data --region fra --size 1
   ```
4. Set secrets:
   ```bash
   fly secrets set SLACK_BOT_TOKEN=xoxb-...
   fly secrets set CALDAV_PASSWORD=your-nextcloud-app-password
   ```
5. Deploy:
   ```bash
   fly deploy
   ```

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `SLACK_BOT_TOKEN` | Yes | Slack bot token (`xoxb-...`). Set via `fly secrets set`. |
| `CALDAV_PASSWORD` | Yes | Nextcloud app password for CalDAV. Set via `fly secrets set`. |
| `DATA_DIR` | Yes | Directory for SQLite DB. Set to `/data` in `fly.toml`. |
| `PORT` | No | HTTP port (default: `8080`). Set in `fly.toml`. |
| `DRY_RUN` | No | If `true`, routes Slack messages to `error_channel` instead of posting. |
| `CONFIG_FILE` | No | Path to `config.json` (default: `./config.json`). |
| `CACHE_DIR` | No | Deprecated. Used only to migrate legacy flat-file cache to SQLite on first boot. |

### Health check

The server exposes `GET /health` → `{"status":"ok"}` (HTTP 200). Fly.io uses this for readiness checks.

## License

MIT
