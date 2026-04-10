# Notifier Deployment

This document describes the runtime configuration and deployment expectations for the notifier package.

## Runtime

The notifier runs on Convex.

Important pieces:

- Convex functions and schema
- HTTP endpoints for Slack OAuth and slash commands
- an hourly polling cron

## Environment Variables

Current Slack OAuth flow depends on these environment variables:

- `SLACK_CLIENT_ID`
- `SLACK_CLIENT_SECRET`
- `SLACK_REDIRECT_URI`

These are read in [`convex/slack/oauth.ts`](../convex/slack/oauth.ts).

If any of them are missing, the Slack OAuth callback returns `500 Server misconfiguration`.

## Slack HTTP Endpoints

Defined in [`convex/http.ts`](../convex/http.ts):

- `GET /slack/oauth-callback`
- `POST /slack/npmtrack`
- `POST /slack/npmuntrack`
- `POST /slack/list`
- `POST /slack/events`

These routes are intended to be configured in Slack as:

- OAuth redirect URL: `/slack/oauth-callback`
- slash commands: `/slack/npmtrack`, `/slack/npmuntrack`, `/slack/list`
- event subscriptions: `/slack/events`

## Polling

The notifier uses an hourly cron defined in [`convex/crons.ts`](../convex/crons.ts):

- `poll npm packages`

This cron:

1. fetches npm metadata
2. detects updates
3. stores the latest version
4. stores GitHub repo metadata when available
5. delivers notifications grouped by Slack target channel

## Data Expectations

Slack installs create:

- a `subscribers` row for the workspace
- a `slackSubscriberDetails` row with bot token and webhook channel details

Tracked packages create:

- a `packages` row
- one or more `subscriptions` rows

## Deployment Checklist

- Set `SLACK_CLIENT_ID`
- Set `SLACK_CLIENT_SECRET`
- Set `SLACK_REDIRECT_URI`
- Confirm Slack app redirect URL matches `SLACK_REDIRECT_URI`
- Confirm slash command request URLs point to the Convex HTTP endpoints
- Confirm event subscriptions point to `/slack/events`
- Confirm the poller cron is deployed

## Post-Deploy Smoke Checks

- Install the Slack app into a test workspace
- Run `/npmtrack react`
- Run `/npmtrack react #general`
- Run `/list`
- Verify the default channel and explicit channel grouping
- Verify update notifications arrive in the expected channels
