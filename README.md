# PatchPulse

![PatchPulse Banner](./assets/banner.png)

Get notified in Slack when your npm packages release updates — right in your DMs or in a channel, filtered to only the release types you care about.

## Add to Slack

<a href="https://grand-yak-92.convex.site/slack/install"><img alt="Add to Slack" height="40" src="https://platform.slack-edge.com/img/add_to_slack.png" srcset="https://platform.slack-edge.com/img/add_to_slack.png 1x, https://platform.slack-edge.com/img/add_to_slack@2x.png 2x"></a>

Once installed, run `/npmhelp` in any channel or DM to see the full command reference.

## Commands

| Command | Description |
|---|---|
| `/npmtrack <package>` | Track a package — notifies you via DM |
| `/npmtrack react vue typescript` | Track multiple packages at once |
| `/npmtrack <package> #channel` | Track a package in a channel |
| `/npmtrack <package> minor` | Only notify on minor+ releases |
| `/npmtrack <package> major` | Only notify on major releases |
| `/npmuntrack <package>` | Stop tracking via DM |
| `/npmuntrack <package> #channel` | Stop tracking in a channel |
| `/npmlist` | See all packages you're tracking |
| `/npmhelp` | Show command reference in Slack |

## Features

- **Per-user DM tracking** — each person tracks privately; everyone gets their own notifications
- **Channel tracking** — post updates to a shared channel so the whole team stays in sync
- **Multi-package tracking** — `/npmtrack react vue typescript` in one command
- **Update type filters** — reduce noise on busy packages by filtering to `minor` or `major` only
- **Threshold updates in place** — re-run `/npmtrack` with a new filter to update without re-subscribing
- **Grouped notifications** — multiple package updates are batched into a single message
- **GitHub release links** — each notification links directly to the relevant GitHub release notes
- **Private channel support** — invite `@PatchPulse` to a private channel, then track as normal

---

## Development

PatchPulse is a `pnpm` monorepo.

### Packages

- `packages/cli` — npm CLI for checking outdated dependencies
- `packages/notifier-bot` — Convex-powered Slack notification backend
- `packages/shared` — shared runtime helpers and types
- `packages/vscode-extension` — VS Code extension for in-editor dependency info

### Docs

- [Notifier overview](./packages/notifier-bot/README.md)
- [Slack behavior](./packages/notifier-bot/docs/slack.md)
- [Architecture](./packages/notifier-bot/docs/architecture.md)
- [Deployment](./packages/notifier-bot/docs/deployment.md)
- [Runbook](./packages/notifier-bot/docs/runbook.md)

### Workspace commands

```
pnpm install
pnpm build
pnpm dev:notifier
pnpm dev:cli
pnpm dev:vscode-extension
pnpm test:cli
pnpm test:vscode-extension
pnpm format
```

### Notes

- Packages are intentionally self-contained — they use different toolchains and release targets.
- Root config is limited to workspace standards: `pnpm`, formatting, ignore rules, and shared scripts.
