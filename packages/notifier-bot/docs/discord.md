# Discord Bot Guide

This document describes how the Discord bot behaves in the notifier package.

## Server Install

When PatchPulse is added to a Discord server, the install flow grants the bot access to the server and slash commands.

We persist the guild in Convex lazily on the first real command we receive from that server. At that point we record:

- the guild ID as the subscriber identifier
- the guild name for display purposes

There is no per-guild access token. All Discord API calls use a single shared `DISCORD_BOT_TOKEN` environment variable.

There is no default channel — every subscription must specify an explicit channel.

## Subscription Model

Discord subscriptions are channel-based only.

The same package can be tracked in multiple channels:

- once in `#releases`
- once in `#frontend`

The effective uniqueness key is `(guild, package, channel)`.

DM subscriptions are not supported for Discord bots.

## Slash Commands

Discord slash commands have typed options — no free-text parsing needed.

### `/npmtrack package:[name] [channel:#channel] [filter:patch|minor|major]`

Tracks a package in a channel.

Behavior:

- `package` is required.
- `channel` defaults to the channel where the command is run if omitted.
- `filter` defaults to `patch` (all updates) if omitted.
- Re-running with a different `filter` updates the threshold in place.
- The same package can be tracked in multiple channels independently.

Examples:

- `/npmtrack package:react`
- `/npmtrack package:react channel:#releases`
- `/npmtrack package:react filter:minor`
- `/npmtrack package:next channel:#frontend filter:major`

User feedback is ephemeral (only visible to the invoking user).

### `/npmuntrack package:[name] [channel:#channel]`

Stops tracking a package in a channel.

Behavior:

- `channel` defaults to the current channel if omitted.
- Only the subscription for that specific channel is removed.

### `/npmlist`

Lists all packages tracked in the server, grouped by channel.

Output shape:

```
📦 Tracking **3** packages across **4** subscriptions:

#releases
    • **`react`** — [`19.2.5`](<https://github.com/...>)
    • **`typescript`** — [`6.0.2`](<https://github.com/...>)

#frontend
    • **`react`** — [`19.2.5`](<https://github.com/...>) [minor+]
```

## Interaction Flow

Discord sends every slash command as an HTTP POST to `/discord/interactions`.

1. The interaction endpoint verifies the Ed25519 signature.
2. It immediately responds with a deferred ephemeral acknowledgement (type 5, flags 64).
3. A background Convex action processes the command.
4. The background action edits the deferred reply with the final result.

This keeps commands responsive even when npm lookups take a moment.

## Notification Format

Update notifications use Discord markdown:

```
📦 **react update**

• **[`react`](<https://www.npmjs.com/package/react>)** `18.3.1` → [`19.0.0`](<https://github.com/facebook/react/releases>) [major]
  ↳ [`v18.3.2`](<.../releases/tag/v18.3.2>) · [`v18.3.3`](<.../releases/tag/v18.3.3>)
```

Release note enrichment (AI summaries, thread replies) is currently Slack-only. Discord receives the base notification only.

## Link Behavior

- Package names link to npm.
- Versions link to GitHub releases when `githubRepoUrl` is known, otherwise plain text.
- Intermediate version links appear when a GitHub repo is available.

## Setup — One-Time Command Registration

Discord slash commands must be registered globally before they appear in any server.

After deploying:

```
curl -X POST \
  -H "x-patchpulse-secret: $DISCORD_REGISTER_COMMANDS_SECRET" \
  https://grand-yak-92.convex.site/discord/register-commands
```

This is idempotent and safe to re-run after adding or changing commands.
