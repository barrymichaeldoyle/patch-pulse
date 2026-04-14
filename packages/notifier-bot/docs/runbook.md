# Notifier Runbook

This document is for debugging common notifier issues.

## Slack App Install Fails

Symptoms:

- Slack OAuth callback returns `500`
- install completes in Slack but nothing is stored

Checks:

- verify `SLACK_CLIENT_ID`
- verify `SLACK_CLIENT_SECRET`
- verify `SLACK_REDIRECT_URI`
- verify Slack redirect URL matches the configured callback
- inspect logs around [`convex/slack/oauth.ts`](../convex/slack/oauth.ts)

Likely causes:

- missing env vars
- redirect URL mismatch
- Slack OAuth token exchange failure

## `/npmlist` Hangs Or Appears Stuck

Symptoms:

- Slack only shows the initial ephemeral `Fetching your tracked packages…`
- no follow-up grouped list appears

Checks:

- confirm the scheduled action is running
- inspect logs around [`convex/slack/commands.ts`](../convex/slack/commands.ts)
- verify the workspace exists in `subscribers`
- verify Slack `response_url` follow-up requests are succeeding

Important note:

- `/npmlist` is intentionally designed to avoid live npm fetches
- if it feels slow, the issue is usually in scheduling, logging, or Slack delivery rather than npm lookups

## GitHub Links Missing In `/npmlist`

Symptoms:

- package names link to npm
- versions show as plain text instead of GitHub releases

Checks:

- verify the package row has `githubRepoUrl`
- verify polling has run since the package was added
- verify the npm manifest actually exposes a GitHub repository

Explanation:

- `/npmlist` uses stored metadata only
- GitHub links appear after polling enriches `packages.githubRepoUrl`

## Wrong Slack Channel Used

Symptoms:

- notifications go to the wrong channel
- default-channel subscriptions and explicit channel subscriptions are confused

Checks:

- inspect `slackSubscriberDetails.webhookChannel` and `webhookChannelId`
- inspect `subscriptions.channelId` and `channelName`
- remember that missing `channelId` means “workspace default channel”

## `/npmuntrack` Removes Too Much

Expected behavior:

- `/npmuntrack react #frontend` removes only that channel subscription
- `/npmuntrack react` removes all workspace subscriptions for `react`

If this is surprising in practice, it is usually a docs or UX issue rather than a data bug.

## Polling Does Not Send Updates

Checks:

- verify the package exists in `packages`
- verify subscriptions exist for that package
- verify the cron in [`convex/crons.ts`](../convex/crons.ts) is deployed
- inspect logs from [`convex/polling.ts`](../convex/polling.ts)
- verify update threshold filters like `minor` or `major`

## Release Summary Stays At `⏳`

Symptoms:

- the original Slack update message keeps the pending reaction
- no thread summary appears

Checks:

- inspect the `pendingReleaseChecks` row in Convex
- verify the package has a usable GitHub repo URL
- verify GitHub release or compare endpoints eventually return structured evidence
- verify `OPENAI_API_KEY` is configured if summaries are expected
- inspect logs from [`convex/releaseChecks.ts`](../convex/releaseChecks.ts)

Explanation:

- `⏳` means Patch Pulse is still retrying because upstream metadata is incomplete or not yet trustworthy
- the retry ladder is `1h`, `3h`, `6h`, `12h`, `24h`

## Release Summary Ends At `⚠️`

Symptoms:

- the original Slack message ends with a warning reaction
- no summary thread reply is present

Checks:

- confirm whether the package ever published release notes or comparable GitHub metadata
- verify the package repo and tag naming match the npm version

Explanation:

- `⚠️` means the job completed, but Patch Pulse never found enough trustworthy evidence to summarize
- this is different from a processing failure

## Release Summary Ends At `❌`

Symptoms:

- the original Slack message shows an `❌`

Checks:

- inspect Slack API errors around reactions or message updates
- inspect OpenAI API errors if summarization is enabled
- verify environment variables are set correctly

## Useful Files

- [`convex/http.ts`](../convex/http.ts)
- [`convex/slack/oauth.ts`](../convex/slack/oauth.ts)
- [`convex/slack/commands.ts`](../convex/slack/commands.ts)
- [`convex/slack/events.ts`](../convex/slack/events.ts)
- [`convex/polling.ts`](../convex/polling.ts)
- [`convex/schema.ts`](../convex/schema.ts)
- [`convex/packages.ts`](../convex/packages.ts)
- [`convex/subscriptions.ts`](../convex/subscriptions.ts)
