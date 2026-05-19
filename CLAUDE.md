# Calendar Slack Bot — Developer Guide

## What this project is

A Slack bot that bridges Nextcloud CalDAV calendars with Slack channels — posting weekly digests, daily summaries, and real-time change notifications.

## Two-branch strategy

This repo maintains two long-lived branches with different architectures. Do not attempt to merge them.

| Branch | Architecture | Status |
|--------|-------------|--------|
| `main` | GitHub Actions, single-tenant, config via GitHub Secrets | Production (live instance: kinderstube-abeona) |
| `v2` | Fly.io persistent server, SQLite, multi-tenant SaaS via OAuth | In active development |

**Bug fixes** go on `main`. Cherry-pick to `v2` if the fix is in shared business logic (`runner.js`, `caldav.js`, `formatting.js`, `diff.js`, `scheduler.js`). Infrastructure files (`bot.js`, `server.js`, `config.js`) are fully diverged — fix separately on each branch.

`v2` will replace `main` once proven stable on the slon/abeona Slack community.

## Product direction (v2)

Multi-tenant Slack app: one central Fly.io deployment, any Slack workspace installs via OAuth. The GitHub Actions approach on `main` is preserved as the self-hosted tier for communities that want full data control.

## Key files

| File | Branch | Role |
|------|--------|------|
| `src/runner.js` | both | Business logic — digests, change detection |
| `src/caldav.js` | both | CalDAV fetching |
| `src/formatting.js` | both | Slack message formatting |
| `src/diff.js` | both | Event diff detection |
| `src/scheduler.js` | both | Schedule parsing |
| `src/server.js` | v2 only | Persistent HTTP server + cron scheduler |
| `src/db.js` | v2 only | SQLite state store |
| `src/config.js` | diverged | Config loading (file-based on main, SQLite on v2) |
| `src/bot.js` | diverged | Entry point (monolith on main, CLI shim on v2) |
| `.github/workflows/` | main only | GitHub Actions workflows |
| `fly.toml`, `Dockerfile` | v2 only | Fly.io deployment |

## Repos

- `slon-gmbh/calendar-slack-bot` — upstream (template + active development)
- `kinderstube-abeona/calendar-slack-bot` — live production instance (tracks `main`)

## GitHub Project

All issues tracked in [Project #12 — Calendar Slack Bot Roadmap](https://github.com/orgs/slon-gmbh/projects/12).

Active milestone: **v1: multi-tenant Slack app**

Sprint 3 (May 18–31):
- #44 Multi-tenant SQLite schema (P0/M) — foundation, blocks everything
- #45 Credential encryption (P0/S) — blocked by #44
- #46 OAuth installation flow (P0/M) — blocked by #44, #45

Sprint 4 (Jun 1–14):
- #47 Per-workspace cron scheduling (P0/M) — blocked by #46
- #48 Workspace onboarding wizard (P1/L) — blocked by #47
- #26 Slack slash command handler (P1/S) — blocked by #46
- #27 Slack interactivity handler (P1/S) — blocked by #46
- #42 Deploy to Fly.io (P0/S) — blocked by #46

## Commit convention

Reference the issue in every commit: `refs: #ISSUE_NUMBER`
