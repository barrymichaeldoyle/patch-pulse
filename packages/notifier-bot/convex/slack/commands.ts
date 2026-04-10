import { v } from "convex/values";
import {
  fetchNpmLatestVersion,
  isVersionOutdated,
} from "@patch-pulse/shared";
import { httpAction, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { formatSlackPackageLink, formatSlackVersionText } from "./links";
import { chatPostMessage, PrivateChannelError } from "./api";
import { verifySlackRequest } from "./verify";

type MinUpdateType = "patch" | "minor" | "major";

function parseSlashBody(body: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(body));
}

function cleanText(text: string): string {
  return text.replace(/[*_<>]/g, "").trim();
}

/**
 * Parses "/npmtrack react vue typescript [#channel] [minor|major]" in any order.
 * Supports multiple space-separated package names before the optional channel and filter.
 * Uses regex extraction rather than positional splitting so it's robust to Slack's
 * various channel encoding formats (<#C1234|general> vs plain #general).
 *
 * Multi-channel tracking:
 * - Each (package, channel) pair is an independent subscription.
 * - "/npmtrack react #general" and "/npmtrack react #frontend" create two separate
 *   subscriptions that can have different minUpdateType filters and notify independently.
 * - Omitting a channel sends notifications to the invoking user's DMs.
 */
function parseTrackArgs(raw: string): {
  packageNames: string[];
  channel: { id: string; name: string } | null;
  minUpdateType: MinUpdateType;
} {
  let text = raw.trim();
  let channel: { id: string; name: string } | null = null;
  let minUpdateType: MinUpdateType = "patch";

  // Extract Slack-escaped channel mention: <#C1234567|channel-name>
  const escapedMention = text.match(/<#([A-Za-z0-9]+)\|([^>]+)>/);
  if (escapedMention) {
    channel = { id: escapedMention[1], name: escapedMention[2] };
    text = text.replace(escapedMention[0], "").trim();
  } else {
    // Extract plain #channel-name
    const hashMention = text.match(/(^|\s)(#\S+)/);
    if (hashMention) {
      const name = hashMention[2].slice(1); // strip leading #
      channel = { id: name, name };
      text = text.replace(hashMention[2], "").trim();
    }
  }

  // Extract update type filter
  const filterMatch = text.match(/(^|\s)(minor|major)(\s|$)/);
  if (filterMatch) {
    minUpdateType = filterMatch[2] as MinUpdateType;
    text = text.replace(filterMatch[0], " ").trim();
  }

  const packageNames = text.split(/\s+/).map(cleanText).filter(Boolean);

  return { packageNames, channel, minUpdateType };
}

function formatMinUpdateType(minUpdateType: MinUpdateType | undefined): string | null {
  if (!minUpdateType || minUpdateType === "patch") return null;
  return minUpdateType === "major" ? "[major only]" : "[minor+]";
}

function formatChannelPhrase(channelName: string | undefined): string {
  return channelName ? ` in *#${channelName}*` : "";
}

function formatChannelDescriptor(channelName: string | undefined, channelId: string | undefined): string {
  return channelName ? `*#${normalizeChannelName(channelName)}*` : channelId ? `<#${channelId}>` : "this channel";
}

function formatTrackingTarget(channelName: string | undefined): string {
  return channelName ? `*#${normalizeChannelName(channelName)}*` : "this channel";
}

function normalizeChannelName(channelName: string): string {
  return channelName.replace(/^#/, "");
}

function getListChannelMetadata(
  channelName: string | undefined,
  userId: string | undefined,
): { key: string; heading: string } {
  if (channelName) {
    const normalized = normalizeChannelName(channelName);
    return {
      key: `channel:${normalized}`,
      heading: `📣 *#${normalized}*`,
    };
  }

  return {
    key: `dm:${userId}`,
    heading: `💬 *Your DMs*`,
  };
}

/** Posts an ephemeral reply back to the slash command invoker via the response_url. */
async function sendToSlack(url: string, text: string): Promise<void> {
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}


// HTTP action handlers — return immediately, schedule async work

export const npmTrack = httpAction(async (ctx, request) => {
  const rawBody = await verifySlackRequest(request);
  if (rawBody === null) return new Response("Unauthorized", { status: 401 });

  const body = parseSlashBody(rawBody);
  const { packageNames, channel, minUpdateType } = parseTrackArgs(body.text ?? "");
  const teamId = body.team_id;
  const responseUrl = body.response_url;
  const userId = body.user_id;

  for (const packageName of packageNames) {
    await ctx.scheduler.runAfter(0, internal.slack.commands.processNpmTrack, {
      packageName,
      teamId,
      responseUrl,
      minUpdateType,
      channelId: channel?.id,
      channelName: channel?.name,
      userId,
    });
  }

  const packageList = packageNames.map((p) => `*${p}*`).join(", ");
  const ackText =
    packageNames.length === 0
      ? `⚠️ Please provide a package name, e.g. \`/npmtrack react\``
      : `⏳ Tracking ${packageList}${formatChannelPhrase(channel?.name)}…`;

  return new Response(JSON.stringify({ text: ackText }), {
    headers: { "Content-Type": "application/json" },
  });
});

export const npmUntrack = httpAction(async (ctx, request) => {
  const rawBody = await verifySlackRequest(request);
  if (rawBody === null) return new Response("Unauthorized", { status: 401 });

  const body = parseSlashBody(rawBody);
  const { packageNames, channel } = parseTrackArgs(body.text ?? "");

  if (packageNames.length === 0) {
    return new Response(
      JSON.stringify({ text: `⚠️ Please provide a package name, e.g. \`/npmuntrack react\`` }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  const packageName = packageNames[0];
  const teamId = body.team_id;
  const responseUrl = body.response_url;
  const userId = body.user_id;

  await ctx.scheduler.runAfter(0, internal.slack.commands.processNpmUntrack, {
    packageName,
    teamId,
    responseUrl,
    channelId: channel?.id,
    channelName: channel?.name,
    userId,
  });

  return new Response(
    JSON.stringify({ text: `⏳ Untracking *${packageName}*${formatChannelPhrase(channel?.name)}…` }),
    { headers: { "Content-Type": "application/json" } },
  );
});

export const help = httpAction(async (_ctx, request) => {
  const rawBody = await verifySlackRequest(request);
  if (rawBody === null) return new Response("Unauthorized", { status: 401 });
  const text =
    `*PatchPulse — command reference*\n\n` +
    `*Tracking*\n` +
    `• \`/npmtrack <package>\` — track a package via DM\n` +
    `• \`/npmtrack react vue typescript\` — track multiple packages at once\n` +
    `• \`/npmtrack <package> #channel\` — track a package in a channel\n` +
    `• \`/npmtrack <package> minor\` — only notify on minor *and* major releases\n` +
    `• \`/npmtrack <package> major\` — only notify on major releases\n\n` +
    `*Untracking*\n` +
    `• \`/npmuntrack <package>\` — stop tracking via DM\n` +
    `• \`/npmuntrack <package> #channel\` — stop tracking in a specific channel\n\n` +
    `*Listing*\n` +
    `• \`/npmlist\` — see all packages you're tracking (your DMs + all channel subscriptions)\n\n` +
    `*Tips*\n` +
    `• Re-running \`/npmtrack\` with a different threshold (e.g. \`major\`) updates it in place.\n` +
    `• To track in a private channel, first run \`/invite @PatchPulse\` in that channel.`;

  return new Response(JSON.stringify({ text }), {
    headers: { "Content-Type": "application/json" },
  });
});

export const listPackages = httpAction(async (ctx, request) => {
  const rawBody = await verifySlackRequest(request);
  if (rawBody === null) return new Response("Unauthorized", { status: 401 });

  const body = parseSlashBody(rawBody);
  const teamId = body.team_id;
  const responseUrl = body.response_url;
  const userId = body.user_id;

  await ctx.scheduler.runAfter(0, internal.slack.commands.processList, {
    teamId,
    responseUrl,
    userId,
  });

  return new Response(
    JSON.stringify({ text: `⏳ Fetching your tracked packages…` }),
    { headers: { "Content-Type": "application/json" } },
  );
});

// Internal actions — async processors scheduled by the HTTP handlers above

export const processNpmTrack = internalAction({
  args: {
    packageName: v.string(),
    teamId: v.string(),
    responseUrl: v.string(),
    minUpdateType: v.union(v.literal("patch"), v.literal("minor"), v.literal("major")),
    channelId: v.optional(v.string()),
    channelName: v.optional(v.string()),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, { packageName, teamId, responseUrl, minUpdateType, channelId, channelName, userId }) => {
    const subscriber = await ctx.runQuery(internal.subscribers.getByTeamId, { teamId });
    if (!subscriber) {
      await sendToSlack(responseUrl, `❌ Workspace not found. Please reinstall PatchPulse.`);
      return;
    }

    const version = await fetchNpmLatestVersion(packageName, {
      userAgent: "patch-pulse-notifier-bot",
    }).catch(() => null);

    if (!version) {
      await sendToSlack(responseUrl, `❌ Could not find *${packageName}* on npm.`);
      return;
    }

    // Use ensureExists so we don't silently advance pkg.currentVersion —
    // that's polling's job, and advancing it here would cause existing
    // subscribers to miss the notification.
    const { packageId, dbVersion } = await ctx.runMutation(internal.packages.ensureExists, {
      name: packageName,
      version,
      ecosystem: "npm",
    });

    const pendingUpdate = isVersionOutdated({ current: dbVersion, latest: version });

    // Check for an existing subscription on this exact (package, channel/user) pair
    const existing = await ctx.runQuery(internal.subscriptions.exists, {
      packageId,
      subscriberId: subscriber._id,
      channelId,
      userId: channelId ? undefined : userId,
    });

    if (existing) {
      // Fix 2: if the threshold changed, update in place instead of rejecting
      if (existing.minUpdateType !== minUpdateType) {
        await ctx.runMutation(internal.subscriptions.updateMinUpdateType, {
          subscriptionId: existing._id,
          minUpdateType,
        });
        const filterLabel = formatMinUpdateType(minUpdateType);
        const channelLabel = formatChannelPhrase(existing.channelName);
        await sendToSlack(
          responseUrl,
          `Updated: now tracking *${packageName}*${channelLabel} with ${filterLabel ?? "all"} notifications — currently at *${version}*`,
        );
      } else {
        const filterLabel = formatMinUpdateType(existing.minUpdateType as MinUpdateType);
        const channelLabel = formatChannelPhrase(existing.channelName);
        // Fix 3: show current npm version, not the (potentially stale) lastNotifiedVersion
        await sendToSlack(
          responseUrl,
          `Already tracking *${packageName}* — currently at *${version}*${channelLabel}${filterLabel ? ` ${filterLabel}` : ""}`,
        );
      }
      return;
    }

    await ctx.runMutation(internal.subscriptions.create, {
      packageId,
      subscriberId: subscriber._id,
      lastNotifiedVersion: version,
      minUpdateType,
      channelId,
      channelName,
      userId: channelId ? undefined : userId,
    });

    const details = await ctx.runQuery(internal.subscribers.getSlackDetails, {
      subscriberId: subscriber._id,
    });

    if (details) {
      const filterLabel = formatMinUpdateType(minUpdateType);
      // Fix 3: if npm already has a newer version than our DB, mention it
      const updateSuffix = pendingUpdate
        ? ` There's already an update available (*${dbVersion}* → *${version}*) — I'll notify you about it shortly.`
        : "";

      if (channelId) {
        const channelLabel = formatTrackingTarget(channelName);
        const baseVersion = pendingUpdate ? dbVersion : version;
        try {
          await chatPostMessage(
            details.accessToken,
            channelId,
            `<@${userId}> is now tracking *${packageName}* in ${channelLabel} — current version *${baseVersion}*${filterLabel ? ` ${filterLabel}` : ""}${updateSuffix}`,
          );
        } catch (error) {
          if (error instanceof PrivateChannelError) {
            await ctx.runMutation(internal.subscriptions.remove, {
              packageId,
              subscriberId: subscriber._id,
              channelId,
            });
            await sendToSlack(
              responseUrl,
              `⚠️ *${packageName}* couldn't be tracked in ${channelLabel} — PatchPulse needs to be invited first. Run \`/invite @PatchPulse\` in that channel, then try again.`,
            );
          } else {
            throw error;
          }
        }
      } else if (userId) {
        await chatPostMessage(
          details.accessToken,
          userId,
          `You're now tracking *${packageName}* — current version *${pendingUpdate ? dbVersion : version}*${filterLabel ? ` ${filterLabel}` : ""}.${updateSuffix || " I'll DM you when updates are available."}`,
        );
      }
    }
  },
});

export const processNpmUntrack = internalAction({
  args: {
    packageName: v.string(),
    teamId: v.string(),
    responseUrl: v.string(),
    channelId: v.optional(v.string()),
    channelName: v.optional(v.string()),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, { packageName, teamId, responseUrl, channelId, channelName, userId }) => {
    const pkg = await ctx.runQuery(internal.packages.getByName, { name: packageName });
    if (!pkg) {
      await sendToSlack(responseUrl, `*${packageName}* is not in your tracked packages.`);
      return;
    }

    const subscriber = await ctx.runQuery(internal.subscribers.getByTeamId, { teamId });
    if (!subscriber) {
      await sendToSlack(responseUrl, `❌ Workspace not found. Please reinstall PatchPulse.`);
      return;
    }

    const details = await ctx.runQuery(internal.subscribers.getSlackDetails, {
      subscriberId: subscriber._id,
    });

    if (channelId) {
      // Remove the subscription for this specific channel
      const existing = await ctx.runQuery(internal.subscriptions.exists, {
        packageId: pkg._id,
        subscriberId: subscriber._id,
        channelId,
      });

      if (!existing) {
        await sendToSlack(
          responseUrl,
          `*${packageName}* is not tracked in ${formatChannelDescriptor(channelName, channelId)}.`,
        );
        return;
      }

      await ctx.runMutation(internal.subscriptions.remove, {
        packageId: pkg._id,
        subscriberId: subscriber._id,
        channelId,
      });

      if (details) {
        await chatPostMessage(
          details.accessToken,
          channelId,
          `<@${userId}> stopped tracking *${packageName}* in ${formatChannelDescriptor(channelName, channelId)}`,
        );
      }
    } else {
      // No channel specified — remove this user's DM subscription
      const existing = await ctx.runQuery(internal.subscriptions.exists, {
        packageId: pkg._id,
        subscriberId: subscriber._id,
        userId,
      });

      if (!existing) {
        await sendToSlack(responseUrl, `You're not tracking *${packageName}* via DMs.`);
        return;
      }

      await ctx.runMutation(internal.subscriptions.remove, {
        packageId: pkg._id,
        subscriberId: subscriber._id,
        userId,
      });

      // Warn if channel subscriptions for this package still exist in the workspace
      const remainingSubs = await ctx.runQuery(internal.subscriptions.getByPackageAndSubscriber, {
        packageId: pkg._id,
        subscriberId: subscriber._id,
      });
      const channelSubs = remainingSubs.filter((s) => s.channelId);
      const channelNote =
        channelSubs.length > 0
          ? ` Note: *${packageName}* is still tracked in ${channelSubs
              .map((s) => `*#${normalizeChannelName(s.channelName ?? s.channelId!)}*`)
              .join(", ")} by your workspace.`
          : "";

      if (details && userId) {
        await chatPostMessage(
          details.accessToken,
          userId,
          `You stopped tracking *${packageName}* via DMs.${channelNote}`,
        );
      }
    }
  },
});

export const processList = internalAction({
  args: {
    teamId: v.string(),
    responseUrl: v.string(),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, { teamId, responseUrl, userId }) => {
    const subscriber = await ctx.runQuery(internal.subscribers.getByTeamId, { teamId });
    if (!subscriber) {
      await sendToSlack(responseUrl, `❌ Workspace not found. Please reinstall PatchPulse.`);
      return;
    }

    const details = await ctx.runQuery(internal.subscribers.getSlackDetails, {
      subscriberId: subscriber._id,
    });

    const allSubscriptions = await ctx.runQuery(internal.subscriptions.getBySubscriber, {
      subscriberId: subscriber._id,
    });

    // Show all channel subscriptions (workspace-wide) but only the invoking
    // user's own DM subscriptions — other users' DMs are private to them.
    const subscriptions = allSubscriptions.filter(
      (sub) => sub.channelId || sub.userId === userId,
    );

    if (subscriptions.length === 0) {
      await sendToSlack(
        responseUrl,
        `You're not tracking any packages yet. Use \`/npmtrack <package>\` to get started.`,
      );
      return;
    }

    const packageIds = [...new Set(subscriptions.map((s) => s.packageId))];
    const packages = await ctx.runQuery(internal.packages.getByIds, { ids: packageIds });

    const groupedLines = subscriptions
      .map((sub) => {
        const pkg = packages.find((p) => p?._id === sub.packageId);
        if (!pkg) return null;
        const channel = getListChannelMetadata(sub.channelName, sub.userId);
        return { sub, pkg, channel };
      })
      .filter((entry): entry is {
        sub: (typeof subscriptions)[number];
        pkg: NonNullable<(typeof packages)[number]>;
        channel: { key: string; heading: string };
      } => entry !== null)
      .sort((a, b) => {
        const channelCompare = a.channel.key.localeCompare(b.channel.key);
        if (channelCompare !== 0) return channelCompare;
        return a.pkg.name.localeCompare(b.pkg.name);
      })
      .reduce((groups, { sub, pkg, channel }) => {
        const filterLabel = formatMinUpdateType(sub.minUpdateType as MinUpdateType);
        const line =
          `    • ${formatSlackPackageLink(pkg.name)} — ` +
          `${formatSlackVersionText(pkg.name, pkg.currentVersion, null, pkg.githubRepoUrl)}` +
          `${filterLabel ? ` ${filterLabel}` : ""}`;
        const existing = groups.get(channel.key);
        if (existing) {
          existing.lines.push(line);
        } else {
          groups.set(channel.key, { heading: channel.heading, lines: [line] });
        }
        return groups;
      }, new Map<string, { heading: string; lines: string[] }>());

    const uniquePackages = packageIds.length;
    const header =
      uniquePackages === subscriptions.length
        ? `📦 Tracking *${subscriptions.length}* package${subscriptions.length === 1 ? "" : "s"}:`
        : `📦 Tracking *${uniquePackages}* package${uniquePackages === 1 ? "" : "s"} across *${subscriptions.length}* subscriptions:`;

    const sections = Array.from(groupedLines.values()).map(
      ({ heading, lines }) => `${heading}\n${lines.join("\n")}`,
    );

    // Chunk sections into messages under ~3500 chars to stay within Slack's limits
    const SLACK_CHAR_LIMIT = 3500;
    const chunks: string[][] = [];
    let current: string[] = [];
    let currentLen = header.length + 3;

    for (const section of sections) {
      if (current.length > 0 && currentLen + section.length + 3 > SLACK_CHAR_LIMIT) {
        chunks.push(current);
        current = [];
        currentLen = 0;
      }
      current.push(section);
      currentLen += section.length + 3;
    }
    if (current.length > 0) chunks.push(current);

    const [first, ...rest] = chunks;
    await sendToSlack(responseUrl, `${header}\n\n\n${first.join("\n\n\n")}`);
    for (const chunk of rest) {
      await sendToSlack(responseUrl, chunk.join("\n\n\n"));
    }
  },
});
