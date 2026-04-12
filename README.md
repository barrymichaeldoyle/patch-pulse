# PatchPulse

![PatchPulse Banner](./assets/banner.png)

PatchPulse helps you stay on top of npm dependency updates across your projects.

Live docs: https://barrymichaeldoyle.github.io/patch-pulse/

| Tool                                             | Status                          | Description                                              |
| ------------------------------------------------ | ------------------------------- | -------------------------------------------------------- |
| [Slack bot](#slack-bot)                          | Live                            | Get notified in Slack when your packages release updates |
| [CLI](./packages/cli)                            | v3.x on npm · v4 in development | Check for outdated dependencies from the terminal        |
| [VS Code extension](./packages/vscode-extension) | Early development               | In-editor dependency info (not yet released)             |

---

## Slack Bot

<a href="https://grand-yak-92.convex.site/slack/install"><img alt="Add to Slack" height="40" src="https://platform.slack-edge.com/img/add_to_slack.png" srcset="https://platform.slack-edge.com/img/add_to_slack.png 1x, https://platform.slack-edge.com/img/add_to_slack@2x.png 2x"></a>

> **Help us reach the Slack Marketplace!** We need at least 5 active workspace installs before Slack will approve PatchPulse for the official Marketplace. If the bot looks useful to you, installing it now is a huge help — it's free and takes about 30 seconds.

Once installed, run `/npmhelp` in any channel or DM to see the full command reference.

### Commands

| Command                          | Description                           |
| -------------------------------- | ------------------------------------- |
| `/npmtrack <package>`            | Track a package — notifies you via DM |
| `/npmtrack react vue typescript` | Track multiple packages at once       |
| `/npmtrack <package> #channel`   | Track a package in a channel          |
| `/npmtrack <package> minor`      | Only notify on minor+ releases        |
| `/npmtrack <package> major`      | Only notify on major releases         |
| `/npmuntrack <package>`          | Stop tracking via DM                  |
| `/npmuntrack <package> #channel` | Stop tracking in a channel            |
| `/npmlist`                       | See all packages you're tracking      |
| `/npmhelp`                       | Show command reference in Slack       |

### Features

- **Per-user DM tracking** — each person tracks privately; everyone gets their own notifications
- **Channel tracking** — post updates to a shared channel so the whole team stays in sync
- **Multi-package tracking** — `/npmtrack react vue typescript` in one command
- **Update type filters** — reduce noise on busy packages by filtering to `minor` or `major` only
- **Threshold updates in place** — re-run `/npmtrack` with a new filter to update without re-subscribing
- **Grouped notifications** — multiple package updates are batched into a single message
- **GitHub release links** — each notification links directly to the relevant GitHub release notes
- **Private channel support** — invite `@PatchPulse` to a private channel, then track as normal

---

## Contributing & Support

Bug reports and feature requests are welcome — [open an issue](https://github.com/barrymichaeldoyle/patch-pulse/issues). See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and guidelines.

---

## Development

PatchPulse is a `pnpm` monorepo.

### Packages

- `packages/cli` — npm CLI for checking outdated dependencies
- `packages/docs` — Astro/Starlight docs site
- `packages/notifier-bot` — Convex-powered Slack notification backend
- `packages/shared` — shared runtime helpers and types
- `packages/vscode-extension` — VS Code extension for in-editor dependency info

### Docs

Workspace docs:

- [Live docs site](https://barrymichaeldoyle.github.io/patch-pulse/)
- [Contributing](./CONTRIBUTING.md)
- [Support](./SUPPORT.md)

Package docs:

- [CLI](./packages/cli/README.md)
- [VS Code extension](./packages/vscode-extension/README.md)
- [Notifier overview](./packages/notifier-bot/README.md)
- [Notifier Slack behavior](./packages/notifier-bot/docs/slack.md)
- [Notifier architecture](./packages/notifier-bot/docs/architecture.md)
- [Notifier deployment](./packages/notifier-bot/docs/deployment.md)
- [Notifier runbook](./packages/notifier-bot/docs/runbook.md)

### Workspace commands

```
pnpm install          # install all dependencies
pnpm ci:check         # lint, format, knip, typecheck, test, build — mirrors CI

pnpm dev:notifier     # run Slack bot locally (requires Convex setup)
pnpm dev:docs         # run docs locally
pnpm dev:cli          # run CLI in dev mode
pnpm pp               # dogfood the local CLI from the repo root
pnpm -s pp -- --json  # same, but without pnpm's script banner for pipe-safe JSON
pnpm dev:vscode-extension  # watch VS Code extension

pnpm test             # run all tests
pnpm build            # build CLI + VS Code extension
pnpm deploy:notifier  # deploy Slack bot to Convex

pnpm lint             # lint entire repo
pnpm lint:fix         # lint and auto-fix
pnpm format           # format entire repo
pnpm typecheck        # typecheck CLI + notifier
pnpm knip             # check for unused exports and dependencies
```
