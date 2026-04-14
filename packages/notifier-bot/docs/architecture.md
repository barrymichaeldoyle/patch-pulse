# Notifier Architecture

This package uses Convex as the notifier backend.

## Main Components

### Schema

Defined in [`convex/schema.ts`](../convex/schema.ts).

Primary tables:

- `packages`
- `subscribers`
- `slackSubscriberDetails`
- `subscriptions`
- `pendingReleaseChecks`

## Data Model

### `packages`

Stores one record per tracked package name.

Important fields:

- `name`
- `currentVersion`
- `ecosystem`
- `lastChecked`
- `githubRepoUrl` optional

`githubRepoUrl` is stored so `/npmlist` can render GitHub release links without doing live network fetches.

### `subscribers`

Stores top-level subscriber identities.

Today this is mainly Slack workspaces.

### `slackSubscriberDetails`

Stores Slack-specific connection details:

- bot token
- webhook URL
- default webhook channel name
- default webhook channel ID

### `subscriptions`

Stores channel-aware package subscriptions.

Important fields:

- `packageId`
- `subscriberId`
- `lastNotifiedVersion`
- `minUpdateType`
- `channelId` optional
- `channelName` optional

If `channelId` is missing, the subscription targets the workspace default channel.

### `pendingReleaseChecks`

Stores delayed enrichment work for a specific Slack notification message.

Important fields:

- `subscriberId`
- `channelId`
- `messageTs`
- `fullText`
- `commentTs` optional
- `retryCount`
- `packages`

Each package entry tracks two independent concerns:

- whether the original Slack line still needs GitHub link backfill
- whether an AI summary for that package is still pending

## Request Flow

### Slack Commands

Defined in:

- [`convex/slack/commands.ts`](../convex/slack/commands.ts)

Pattern:

1. Slack hits an HTTP endpoint.
2. The HTTP handler returns immediately with an ephemeral response.
3. The real work is scheduled via Convex.
4. A follow-up message is posted back to Slack.

This keeps slash commands responsive while still allowing async work.

### Polling

Defined in:

- [`convex/polling.ts`](../convex/polling.ts)
- [`convex/crons.ts`](../convex/crons.ts)

The poller:

1. loads tracked packages
2. fetches npm metadata
3. determines whether an update is available
4. stores the newest version
5. stores GitHub repo metadata when available
6. groups matching subscriptions by Slack target channel
7. sends one notification per `(workspace, channel)` target
8. adds a pending reaction and queues an enrichment job for the posted Slack message

## Metadata Enrichment

The notifier uses a two-stage enrichment flow.

Stage 1 happens during polling:

- polling fetches npm metadata anyway
- if a GitHub repo URL can be derived from `repository`, it is normalized and stored on `packages.githubRepoUrl`
- the outgoing Slack message includes the best release links available at send time

Stage 2 happens in [`convex/releaseChecks.ts`](../convex/releaseChecks.ts):

- the notifier retries on a backoff schedule: `1h`, `3h`, `6h`, `12h`, `24h`
- each retry re-fetches npm metadata and structured GitHub evidence
- if the message line can now be improved, the original Slack message is edited in place
- if the evidence is strong enough, the notifier calls OpenAI to produce a short thread summary
- the original message reaction reflects overall state: pending, ready, or abandoned

This design handles the common npm-first / GitHub-later case without requiring open-ended web search.

## Link Strategy

Helper logic lives in:

- [`convex/slack/links.ts`](../convex/slack/links.ts)

Rules:

- package name links to npm
- update notification version links prefer GitHub releases when the manifest indicates GitHub
- `/npmlist` version links use stored `githubRepoUrl`
- if no GitHub metadata is available, `/npmlist` shows plain version text

## Release Summaries

AI summarization is intentionally constrained:

- structured evidence is gathered from npm metadata plus GitHub release/compare APIs
- OpenAI is only used to compress that evidence into short Slack text
- the model is not expected to discover facts on the open web
- if the evidence is weak, the summary is skipped rather than guessed

## Testing

Notifier tests live in:

- [`convex/slack.commands.test.ts`](../convex/slack.commands.test.ts)

Current coverage focuses on:

- multi-channel tracking semantics
- `/npmuntrack` all-channel behavior
- `/npmlist` formatting and link behavior
- GitHub metadata persistence during polling
- delayed enrichment, Slack reactions, and AI summary posting

Test stack:

- `vitest`
- `convex-test`
- edge-runtime environment

## Documentation Boundaries

Recommended places to update docs:

- user-facing Slack behavior: [`docs/slack.md`](./slack.md)
- internal implementation notes: [`docs/architecture.md`](./architecture.md)
- deployment/configuration: [`docs/deployment.md`](./deployment.md)
- troubleshooting: [`docs/runbook.md`](./runbook.md)
- short package overview: [`README.md`](../README.md)
