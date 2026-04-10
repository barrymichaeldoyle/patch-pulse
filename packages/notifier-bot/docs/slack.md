# Slack Notifier Guide

This document describes how Slack behaves in the notifier package today.

## Workspace Install

When the Patch Pulse Slack app is installed into a workspace, we store:

- Slack workspace identity
- bot token
- incoming webhook details
- the webhook channel selected during installation

That webhook channel becomes the workspace default channel.

If a subscription does not specify an explicit Slack channel, notifications are routed to that default channel.

## Subscription Model

Slack subscriptions are channel-aware.

The same package can be tracked:

- once in the default channel
- once in `#frontend`
- once in `#general`

This means the effective uniqueness is:

- `(workspace, package, channel)`

## Slash Commands

### `/npmtrack [package-name] [#channel] [minor|major]`

Tracks a package for the workspace.

Behavior:

- If `#channel` is omitted, the package is tracked in the workspace default channel.
- If `#channel` is provided, the subscription is scoped to that channel.
- The same package can be tracked in multiple channels at once.
- `minor` or `major` raises the minimum update threshold for that subscription.

Examples:

- `/npmtrack react`
- `/npmtrack react #frontend`
- `/npmtrack react #frontend minor`
- `/npmtrack next major`

User feedback:

- The immediate slash response is ephemeral: `Fetching...` / `Tracking...`
- The follow-up confirmation states which channel the package is tracked in
- Duplicate subscriptions are rejected per exact channel target

### `/npmuntrack [package-name] [#channel]`

Removes tracking for a package.

Behavior:

- `/npmuntrack react #frontend` removes only that one channel subscription
- `/npmuntrack react` removes all subscriptions for that package in the workspace

This is intentional so the no-channel case is not ambiguous once multi-channel tracking exists.

### `/list`

Lists tracked subscriptions grouped by channel.

Current output shape:

- summary line at the top
- separate section per Slack target channel
- default section labelled as `*#channel-name* (default channel)`
- package names link to npm
- versions link to GitHub releases when stored metadata is available
- otherwise versions remain plain text

Example shape:

```text
📦 Tracking *3* packages across *4* channel subscriptions:


🏠 *#new-releases* (default channel)
    • *react* — 19.2.5
    • *typescript* — 6.0.2


📣 *#general*
    • *react* — 19.2.5
```

## Link Behavior

### Package Name

Package names link to npm:

- `react` -> `https://www.npmjs.com/package/react`

### Version

Versions in `/list` use stored package metadata:

- If `githubRepoUrl` is known, the version links to that repository's releases page
- If not, the version is plain text

Polling is responsible for enriching packages with GitHub metadata.

## Default Channel Behavior

The default channel is not a synthetic concept. It is the incoming-webhook channel Slack provides during installation.

That means:

- it has a real Slack channel name
- it has a real Slack channel ID
- it is used as the fallback target whenever a subscription has no explicit `channelId`

## Operational Notes

- `/list` should stay fast and deterministic
- `/list` should not make live npm requests per package
- richer metadata should be stored ahead of time during polling
- update notifications may include richer release links because the manifest is already being fetched during the update cycle
