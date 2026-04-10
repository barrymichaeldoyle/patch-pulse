import { v } from "convex/values";
import {
  fetchNpmLatestVersion,
} from "@patch-pulse/shared";
import { httpAction, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { formatSlackPackageLink, formatSlackVersionText } from "./links";

type MinUpdateType = "patch" | "minor" | "major";

function parseSlashBody(body: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(body));
}

function cleanText(text: string): string {
  return text.replace(/[*_<>]/g, "").trim();
}

/**
 * Parses "/npmtrack react [#channel] [minor|major]" in any order after the package name.
 * Uses regex extraction rather than positional splitting so it's robust to Slack's
 * various channel encoding formats (<#C1234|general> vs plain #general).
 *
 * Multi-channel tracking:
 * - Each (package, channel) pair is an independent subscription.
 * - "/npmtrack react #general" and "/npmtrack react #frontend" create two separate
 *   subscriptions that can have different minUpdateType filters and notify independently.
 * - Omitting a channel routes notifications to the workspace's default webhook channel.
 */
function parseTrackArgs(raw: string): {
  packageName: string;
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

  return { packageName: cleanText(text), channel, minUpdateType };
}

function formatMinUpdateType(minUpdateType: MinUpdateType | undefined): string | null {
  if (!minUpdateType || minUpdateType === "patch") return null;
  return minUpdateType === "major" ? "[major only]" : "[minor+]";
}

function formatChannelPhrase(channelName: string | undefined): string {
  return channelName ? ` in *#${channelName}*` : "";
}

function formatChannelDescriptor(channelName: string | undefined): string {
  return channelName ? `*#${normalizeChannelName(channelName)}*` : "the workspace default channel";
}

function formatTrackingTarget(
  channelName: string | undefined,
  defaultChannelName: string | undefined,
): string {
  if (channelName) {
    return `*#${normalizeChannelName(channelName)}*`;
  }

  if (defaultChannelName) {
    return `*#${normalizeChannelName(defaultChannelName)}* (default channel)`;
  }

  return "the workspace default channel";
}

function normalizeChannelName(channelName: string): string {
  return channelName.replace(/^#/, "");
}

function getListChannelMetadata(
  channelName: string | undefined,
  defaultChannelName: string | undefined,
): { key: string; heading: string } {
  if (channelName) {
    const normalized = normalizeChannelName(channelName);
    return {
      key: normalized,
      heading: `📣 *#${normalized}*`,
    };
  }

  if (defaultChannelName) {
    const normalized = normalizeChannelName(defaultChannelName);
    return {
      key: normalized,
      heading: `🏠 *#${normalized}* (default channel)`,
    };
  }

  return {
    key: "__default__",
    heading: "🏠 *Default channel*",
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

/** Posts a message to a Slack channel using the bot token. */
async function chatPostMessage(token: string, channel: string, text: string): Promise<void> {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ channel, text }),
  });
  const data = await response.json();
  if (!data.ok) throw new Error(`Slack error: ${data.error}`);
}

// HTTP action handlers — return immediately, schedule async work

export const npmTrack = httpAction(async (ctx, request) => {
  const body = parseSlashBody(await request.text());
  const { packageName, channel, minUpdateType } = parseTrackArgs(body.text ?? "");
  const teamId = body.team_id;
  const responseUrl = body.response_url;

  await ctx.scheduler.runAfter(0, internal.slack.commands.processNpmTrack, {
    packageName,
    teamId,
    responseUrl,
    minUpdateType,
    channelId: channel?.id,
    channelName: channel?.name,
  });

  return new Response(
    JSON.stringify({ text: `⏳ Tracking *${packageName}*…` }),
    { headers: { "Content-Type": "application/json" } },
  );
});

export const npmUntrack = httpAction(async (ctx, request) => {
  const body = parseSlashBody(await request.text());
  const { packageName, channel } = parseTrackArgs(body.text ?? "");
  const teamId = body.team_id;
  const responseUrl = body.response_url;

  await ctx.scheduler.runAfter(0, internal.slack.commands.processNpmUntrack, {
    packageName,
    teamId,
    responseUrl,
    channelId: channel?.id,
    channelName: channel?.name,
  });

  return new Response(
    JSON.stringify({ text: `⏳ Untracking *${packageName}*…` }),
    { headers: { "Content-Type": "application/json" } },
  );
});

export const listPackages = httpAction(async (ctx, request) => {
  const body = parseSlashBody(await request.text());
  const teamId = body.team_id;
  const responseUrl = body.response_url;

  await ctx.scheduler.runAfter(0, internal.slack.commands.processList, {
    teamId,
    responseUrl,
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
  },
  handler: async (ctx, { packageName, teamId, responseUrl, minUpdateType, channelId, channelName }) => {
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

    const packageId = await ctx.runMutation(internal.packages.upsertVersion, {
      name: packageName,
      version,
      ecosystem: "npm",
    });

    // Check for an existing subscription on this exact (package, channel) pair
    const existing = await ctx.runQuery(internal.subscriptions.exists, {
      packageId,
      subscriberId: subscriber._id,
      channelId,
    });

    if (existing) {
      const filterLabel = formatMinUpdateType(existing.minUpdateType as MinUpdateType);
      const channelLabel = formatChannelPhrase(existing.channelName);
      await sendToSlack(
        responseUrl,
        `Already tracking *${packageName}* — currently at *${existing.lastNotifiedVersion}*${channelLabel}${filterLabel ? ` ${filterLabel}` : ""}`,
      );
      return;
    }

    await ctx.runMutation(internal.subscriptions.create, {
      packageId,
      subscriberId: subscriber._id,
      lastNotifiedVersion: version,
      minUpdateType,
      channelId,
      channelName,
    });

    const details = await ctx.runQuery(internal.subscribers.getSlackDetails, {
      subscriberId: subscriber._id,
    });

    if (details) {
      const targetChannel = channelId ?? details.webhookChannelId;
      const filterLabel = formatMinUpdateType(minUpdateType);
      const channelLabel = formatTrackingTarget(channelName, details.webhookChannel);
      await chatPostMessage(
        details.accessToken,
        targetChannel,
        `Now tracking *${packageName}* in ${channelLabel} — current version *${version}*${filterLabel ? ` ${filterLabel}` : ""}`,
      );
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
  },
  handler: async (ctx, { packageName, teamId, responseUrl, channelId, channelName }) => {
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
          `*${packageName}* is not tracked in ${formatChannelDescriptor(channelName ?? channelId)}.`,
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
          `Stopped tracking *${packageName}* in ${formatChannelDescriptor(channelName ?? channelId)}`,
        );
      }
    } else {
      // No channel specified — remove all subscriptions for this package in this workspace
      const allSubs = await ctx.runQuery(internal.subscriptions.getByPackageAndSubscriber, {
        packageId: pkg._id,
        subscriberId: subscriber._id,
      });

      if (allSubs.length === 0) {
        await sendToSlack(responseUrl, `*${packageName}* is not in your tracked packages.`);
        return;
      }

      await ctx.runMutation(internal.subscriptions.removeAll, {
        packageId: pkg._id,
        subscriberId: subscriber._id,
      });

      if (details) {
        for (const sub of allSubs) {
          const targetChannel = sub.channelId ?? details.webhookChannelId;
          await chatPostMessage(
            details.accessToken,
            targetChannel,
            `Stopped tracking *${packageName}*`,
          );
        }
      }
    }
  },
});

export const processList = internalAction({
  args: {
    teamId: v.string(),
    responseUrl: v.string(),
  },
  handler: async (ctx, { teamId, responseUrl }) => {
    const subscriber = await ctx.runQuery(internal.subscribers.getByTeamId, { teamId });
    if (!subscriber) {
      await sendToSlack(responseUrl, `❌ Workspace not found. Please reinstall PatchPulse.`);
      return;
    }

    const details = await ctx.runQuery(internal.subscribers.getSlackDetails, {
      subscriberId: subscriber._id,
    });

    const subscriptions = await ctx.runQuery(internal.subscriptions.getBySubscriber, {
      subscriberId: subscriber._id,
    });

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
        const channel = getListChannelMetadata(sub.channelName, details?.webhookChannel);
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
        : `📦 Tracking *${uniquePackages}* package${uniquePackages === 1 ? "" : "s"} across *${subscriptions.length}* channel subscriptions:`;

    const sections = Array.from(groupedLines.values()).map(
      ({ heading, lines }) => `${heading}\n${lines.join("\n")}`,
    );

    await sendToSlack(responseUrl, `${header}\n\n\n${sections.join("\n\n\n")}`);
  },
});
