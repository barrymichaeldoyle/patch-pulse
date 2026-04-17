# Notifier Deployment

This document describes the runtime configuration and deployment expectations for the notifier package.

## Runtime

The notifier runs on Convex.

Important pieces:

- Convex functions and schema
- HTTP endpoints for Slack and Discord installs and commands
- an hourly polling cron

## Environment Variables

Slack install flow depends on these environment variables:

- `SLACK_CLIENT_ID`
- `SLACK_CLIENT_SECRET`
- `SLACK_REDIRECT_URI`
- `SLACK_SIGNING_SECRET`

Discord install flow depends on these environment variables:

- `DISCORD_APPLICATION_ID`
- `DISCORD_CLIENT_ID`
- `DISCORD_PUBLIC_KEY`
- `DISCORD_BOT_TOKEN`
- `DISCORD_REGISTER_COMMANDS_SECRET`

AI-powered release summaries additionally support:

- `OPENAI_API_KEY`
- `OPENAI_SUMMARY_NANO_MODEL` optional override
- `OPENAI_SUMMARY_MINI_MODEL` optional override
- `GITHUB_TOKEN` optional, for higher GitHub API rate limits

These are read in:

- [`convex/slack/oauth.ts`](../convex/slack/oauth.ts)
- [`convex/discord/oauth.ts`](../convex/discord/oauth.ts)
- [`convex/discord/commands.ts`](../convex/discord/commands.ts)

If Slack env vars are missing, the Slack OAuth callback returns `500 Server misconfiguration`.

If Discord env vars are missing, the Discord install flow, interaction verification, or command registration will fail.

## Slack HTTP Endpoints

Defined in [`convex/http.ts`](../convex/http.ts):

- `GET /slack/oauth-callback`
- `POST /slack/npmtrack`
- `POST /slack/npmuntrack`
- `POST /slack/list`
- `POST /slack/help`
- `POST /slack/events`

These routes are intended to be configured in Slack as:

- OAuth redirect URL: `/slack/oauth-callback`
- Slack slash command request URLs: `/slack/npmtrack`, `/slack/npmuntrack`, `/slack/list`, `/slack/help`
- event subscriptions: `/slack/events`

## Discord HTTP Endpoints

Defined in [`convex/http.ts`](../convex/http.ts):

- `GET /discord/install`
- `POST /discord/interactions`
- `POST /discord/register-commands`

These routes are intended to be configured in Discord as:

- Interactions endpoint URL: `/discord/interactions`
- Optional post-deploy command registration trigger: `/discord/register-commands` with `x-patchpulse-secret`

## Polling

The notifier uses an hourly cron defined in [`convex/crons.ts`](../convex/crons.ts):

- `poll npm packages`

This cron:

1. fetches npm metadata
2. detects updates
3. stores the latest version
4. stores GitHub repo metadata when available
5. delivers notifications grouped by target channel
6. queues Slack-only release enrichment jobs that can backfill links and post thread summaries later

## Data Expectations

Slack installs create:

- a `subscribers` row for the workspace
- a `slackSubscriberDetails` row with bot token and webhook channel details

Discord servers create subscriber rows lazily on first command use:

- a `subscribers` row for the guild
- a `discordSubscriberDetails` row with guild identity details

Tracked packages create:

- a `packages` row
- one or more `subscriptions` rows

## Deployment Checklist

- Set `SLACK_CLIENT_ID`
- Set `SLACK_CLIENT_SECRET`
- Set `SLACK_SIGNING_SECRET`
- Set `SLACK_REDIRECT_URI`
- Set `DISCORD_APPLICATION_ID`
- Set `DISCORD_CLIENT_ID`
- Set `DISCORD_PUBLIC_KEY`
- Set `DISCORD_BOT_TOKEN`
- Set `DISCORD_REGISTER_COMMANDS_SECRET`
- Set `OPENAI_API_KEY` if AI summaries should be enabled
- Optionally set `GITHUB_TOKEN` if you expect heavier GitHub API usage
- Confirm Slack app redirect URL matches `SLACK_REDIRECT_URI`
- Confirm slash command request URLs point to the Convex HTTP endpoints
- Confirm event subscriptions point to `/slack/events`
- Confirm Discord interactions point to `/discord/interactions`
- Run `curl -X POST -H "x-patchpulse-secret: $DISCORD_REGISTER_COMMANDS_SECRET" https://grand-yak-92.convex.site/discord/register-commands`
- Confirm the poller cron is deployed

## Post-Deploy Smoke Checks

- Install the Slack app into a test workspace
- Run `/npmtrack react`
- Run `/npmtrack react #general`
- Run `/npmlist`
- Verify the default channel and explicit channel grouping
- Verify update notifications arrive in the expected channels
- Verify new notifications receive `⏳` while enrichment is pending
- Verify a thread summary appears and the reaction changes to `📝` when evidence is available
- Install the Discord app into a test server
- Run `/npmtrack package:react`
- Run `/npmtrack package:react channel:#releases`
- Run `/npmlist`
- Verify the bot replies ephemerally and notifications arrive in the chosen channel
