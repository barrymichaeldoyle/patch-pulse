# Contributing to PatchPulse

![PatchPulse Banner](./assets/banner.png)

Thanks for your interest in contributing! This is a pnpm monorepo with multiple packages at different stages of development. Before diving in, here's where things stand:

| Package                     | Status            | Open to contributions?                            |
| --------------------------- | ----------------- | ------------------------------------------------- |
| `packages/notifier-bot`     | Live              | Yes                                               |
| `packages/cli`              | v3                | Yes                                               |
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
pnpm format              # Format the entire repo
pnpm format:changed      # Format modified and untracked files
pnpm format:staged       # Format only staged files
```

## Submitting a PR

1. Make sure there's an open issue for your change and that it's been acknowledged
2. Fork the repo and create a branch from `main`
3. Make your changes — keep commits focused
4. Add a changeset (see below)
5. Open a PR and link the relevant issue

---

## Release process

Releases are managed with [Changesets](https://github.com/changesets/changesets). The flow is automated — you just need to describe your change and the tooling handles versioning, changelogs, and publishing.

### 1. Add a changeset to your PR

Every PR that changes user-facing behaviour in a published package (`packages/cli`) must include a changeset. Run this from the repo root:

```bash
pnpm changeset
```

The interactive CLI will ask:

- **Which packages are affected?** Select `patch-pulse` (use space to select, enter to confirm).
- **What kind of change is it?**
  - `patch` — bug fix, internal refactor, dependency update, docs
  - `minor` — new feature, new flag, new config option (backwards-compatible)
  - `major` — breaking change (removed flag, changed output format, changed config behaviour)
- **Summary** — one or two sentences describing the change from a user's perspective. This becomes a line in the CHANGELOG, so write it for an end user, not a reviewer.

Commit the generated `.changeset/*.md` file alongside your code.

> Changes to `packages/shared`, `packages/notifier-bot`, or `packages/vscode-extension` do not require a changeset — those packages are either private or published separately.

### 2. How the automated release works

When a PR merges to `main`, the `release.yml` workflow runs:

- **If there are pending changesets** — a "Version Packages" PR is automatically opened (or updated). It bumps package versions and writes the CHANGELOG entries. Do not edit this PR manually.
- **If the "Version Packages" PR is merged** — the workflow publishes the updated packages to npm automatically.

You don't need to run `pnpm changeset version` or `pnpm changeset publish` manually — the workflow handles it.

### 3. Required secret

The publish step needs an `NPM_TOKEN` with publish access to the `patch-pulse` package. Add it at:

> **GitHub → Settings → Secrets and variables → Actions → `NPM_TOKEN`**

### 4. Manual release (if needed)

If the automated workflow fails or you need to publish outside CI:

```bash
# 1. Bump versions and generate CHANGELOG
pnpm changeset:version

# 2. Review the changes, then commit
git add -A && git commit -m "chore: version packages"

# 3. Build and publish
pnpm changeset:publish
```

### Versioning guide

| Change type                   | Example                                    | Bump               |
| ----------------------------- | ------------------------------------------ | ------------------ |
| Bug fix, typo, docs           | Fix crash when `package.json` is malformed | `patch`            |
| New flag or config option     | Add `--only-outdated` flag                 | `minor`            |
| New major feature             | Monorepo support                           | `minor` or `major` |
| Removed flag or config option | Remove `--legacy` flag                     | `major`            |
| Changed output format         | Restructure `--json` output shape          | `major`            |
| Breaking config change        | Remove regex pattern support               | `major`            |

When in doubt, prefer `minor` over `major` — breaking changes should be rare and deliberate.
