# Patch Pulse Notifier

<a href="https://grand-yak-92.convex.site/slack/install"><img alt="Add to Slack" height="40" src="https://platform.slack-edge.com/img/add_to_slack.png" srcset="https://platform.slack-edge.com/img/add_to_slack.png 1x, https://platform.slack-edge.com/img/add_to_slack@2x.png 2x"></a>

> **Help us reach the Slack Marketplace!** We need at least 5 active workspace installs before Slack will approve PatchPulse for the official Marketplace. If the bot looks useful to you, installing it now is a huge help — it's free and takes about 30 seconds.

This package contains the Convex-powered notifier backend for Patch Pulse.

It currently supports:

- Slack workspace subscriptions
- npm package polling
- Multi-channel Slack tracking per workspace

More detailed docs live here:

- [`docs/slack.md`](./docs/slack.md): Slack install flow, slash commands, list formatting, and channel behavior
- [`docs/architecture.md`](./docs/architecture.md): schema, polling flow, metadata enrichment, and implementation notes
- [`docs/deployment.md`](./docs/deployment.md): environment variables, Slack endpoint setup, and deployment checks
- [`docs/runbook.md`](./docs/runbook.md): troubleshooting common Slack, polling, and `/npmlist` issues

## What This Package Does

The notifier stores tracked packages, Slack workspace details, and per-channel subscriptions in Convex.

An hourly cron checks tracked packages for updates. When a newer version is found:

1. The package record is updated in Convex.
2. GitHub repo metadata is stored on the package when it can be derived from npm metadata.
3. Matching subscribers are grouped by Slack target channel.
4. Slack notifications are sent to the relevant channel or the workspace default channel.

## Slack Summary

Slack tracking is subscription-based:

- A workspace has one default channel, chosen when the app is installed.
- The same package can also be tracked in additional explicit channels.
- A subscription is effectively scoped by `(workspace, package, channel)`.
- `/npmlist` groups subscriptions by channel.

Examples:

- `/npmtrack react`
- `/npmtrack react #frontend`
- `/npmtrack react #frontend minor`
- `/npmuntrack react`
- `/npmuntrack react #frontend`
- `/npmlist`

## Development

Useful commands from this package directory:

- `pnpm dev`
- `pnpm test`
- `pnpm typecheck`

## Notes

- `/npmlist` does not perform live npm lookups. It uses stored package metadata so the response stays fast.
- GitHub links in `/npmlist` appear after polling has enriched a package with repo metadata.
- Update notifications can include richer release links because polling already fetches npm manifests during the update check.
