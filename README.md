# Patch Pulse

![Patch Pulse Banner](./assets/banner.png)

Patch Pulse now lives in a single `pnpm` monorepo for the CLI, notifier bot, shared runtime, and VS Code extension.

## Packages

- `packages/cli`: Published npm CLI for checking outdated dependencies.
- `packages/notifier-bot`: Convex-powered notifier backend for Slack today, with room for Discord, email, and other delivery channels later.
- `packages/shared`: Shared runtime helpers and types used across Patch Pulse packages.
- `packages/vscode-extension`: VS Code extension for surfacing dependency update information in the editor.

## Package Docs

- Notifier overview: [`packages/notifier-bot/README.md`](./packages/notifier-bot/README.md)
- Slack behavior: [`packages/notifier-bot/docs/slack.md`](./packages/notifier-bot/docs/slack.md)
- Notifier architecture: [`packages/notifier-bot/docs/architecture.md`](./packages/notifier-bot/docs/architecture.md)
- Notifier deployment: [`packages/notifier-bot/docs/deployment.md`](./packages/notifier-bot/docs/deployment.md)
- Notifier runbook: [`packages/notifier-bot/docs/runbook.md`](./packages/notifier-bot/docs/runbook.md)

## Workspace commands

- `pnpm install`
- `pnpm build`
- `pnpm build:cli`
- `pnpm build:vscode-extension`
- `pnpm dev:notifier`
- `pnpm dev:cli`
- `pnpm dev:vscode-extension`
- `pnpm build:notifier`
- `pnpm format`
- `pnpm test:cli`
- `pnpm test:vscode-extension`

## Notes

- The packages are intentionally still mostly self-contained because they use different toolchains and release targets.
- Root config is limited to low-risk workspace standards for now: `pnpm`, formatting defaults, ignore rules, and shared entrypoint scripts.
