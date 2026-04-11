# Contributing to PatchPulse

![PatchPulse Banner](./assets/banner.png)

Thanks for your interest in contributing! This is a pnpm monorepo with multiple packages at different stages of development. Before diving in, here's where things stand:

| Package                     | Status            | Open to contributions?                            |
| --------------------------- | ----------------- | ------------------------------------------------- |
| `packages/notifier-bot`     | Live              | Yes                                               |
| `packages/cli`              | v3 in development | Yes — but expect churn while v3 takes shape       |
| `packages/shared`           | Active            | Yes                                               |
| `packages/vscode-extension` | Early development | Not yet — architecture is still being figured out |

## Before you start

**Please open an issue before submitting a PR.** This applies to bug fixes, features, and anything non-trivial. It avoids wasted effort if a change isn't a good fit, and gives us a chance to align on approach before you invest time writing code.

Issues marked [`accepting PRs`](https://github.com/barrymichaeldoyle/patch-pulse/labels/accepting%20PRs) are explicitly open for contribution — these are a great place to start.

## Setup

**Prerequisites:** Node.js, pnpm

```bash
git clone https://github.com/barrymichaeldoyle/patch-pulse.git
cd patch-pulse
pnpm install
```

## Running packages locally

```bash
pnpm dev:notifier        # Slack bot (requires Convex setup — see packages/notifier-bot/README.md)
pnpm dev:cli             # CLI
pnpm dev:vscode-extension  # VS Code extension (opens Extension Development Host)
```

## Tests & linting

```bash
pnpm test                # Run all tests
pnpm test:cli            # CLI tests only
pnpm test:vscode-extension  # VS Code extension tests only
pnpm lint                # Lint
pnpm format              # Format
```

## Submitting a PR

1. Make sure there's an open issue for your change and that it's been acknowledged
2. Fork the repo and create a branch from `main`
3. Make your changes — keep commits focused
4. Open a PR and link the relevant issue
