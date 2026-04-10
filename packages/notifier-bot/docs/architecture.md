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

## Data Model

### `packages`

Stores one record per tracked package name.

Important fields:

- `name`
- `currentVersion`
- `ecosystem`
- `lastChecked`
- `githubRepoUrl` optional

`githubRepoUrl` is stored so `/list` can render GitHub release links without doing live network fetches.

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

## Metadata Enrichment

The notifier now stores GitHub repo metadata on `packages.githubRepoUrl`.

Why:

- `/list` should stay fast
- `/list` should not depend on external requests
- version links in Slack should still be useful

How it works:

- polling fetches npm metadata anyway
- if a GitHub repo URL can be derived from `repository`, it is normalized and stored
- `/list` uses that stored URL to link versions to GitHub releases

## Link Strategy

Helper logic lives in:

- [`convex/slack/links.ts`](../convex/slack/links.ts)

Rules:

- package name links to npm
- update notification version links prefer GitHub releases when the manifest indicates GitHub
- `/list` version links use stored `githubRepoUrl`
- if no GitHub metadata is available, `/list` shows plain version text

## Testing

Notifier tests live in:

- [`convex/slack.commands.test.ts`](../convex/slack.commands.test.ts)

Current coverage focuses on:

- multi-channel tracking semantics
- `/npmuntrack` all-channel behavior
- `/list` formatting and link behavior
- GitHub metadata persistence during polling

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
