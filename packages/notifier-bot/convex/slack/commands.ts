import { v } from 'convex/values';
import { fetchNpmLatestVersion, isVersionOutdated } from '@patch-pulse/shared';
import { ActionCtx, httpAction, internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { Id } from '../_generated/dataModel';
import { formatSlackPackageLink, formatSlackVersionText } from './links';
import {
  chatPostMessage,
  conversationsFindByName,
  conversationsInfo,
  PrivateChannelError,
  publishAppHome,
  SlackMissingScopeError,
  type HomePackageEntry,
} from './api';
import { verifySlackRequest } from './verify';

type MinUpdateType = 'patch' | 'minor' | 'major';

function parseSlashBody(body: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(body));
}

function cleanText(text: string): string {
  return text.replace(/[*_<>]/g, '').trim();
}

function normalizeNpmPackageName(packageName: string): string {
  return cleanText(packageName).toLowerCase();
}

function formatPackageName(packageName: string): string {
  return `\`${packageName}\``;
}

function formatVersion(version: string): string {
  return `\`${version}\``;
}

type TrackOutcome =
  | {
      kind: 'tracked';
      packageId: Id<'packages'>;
      packageName: string;
      version: string;
      displayVersion: string;
      filterLabel: string | null;
      pendingUpdate: boolean;
    }
  | {
      kind: 'updated';
      packageName: string;
      version: string;
      filterLabel: string | null;
      channelName?: string;
    }
  | {
      kind: 'already';
      packageName: string;
      version: string;
      filterLabel: string | null;
      channelName?: string;
    }
  | {
      kind: 'not_found';
      packageName: string;
    };

async function trackPackage(
  ctx: ActionCtx,
  {
    subscriberId,
    packageName,
    minUpdateType,
    channelId,
    channelName,
    userId,
  }: {
    subscriberId: Id<'subscribers'>;
    packageName: string;
    minUpdateType: MinUpdateType;
    channelId?: string;
    channelName?: string;
    userId?: string;
  },
): Promise<TrackOutcome> {
  packageName = normalizeNpmPackageName(packageName);

  const version = await fetchNpmLatestVersion(packageName, {
    userAgent: 'patch-pulse-notifier-bot',
  }).catch(() => null);

  if (!version) {
    return { kind: 'not_found', packageName };
  }

  const { packageId, dbVersion } = await ctx.runMutation(
    internal.packages.ensureExists,
    {
      name: packageName,
      version,
      ecosystem: 'npm',
    },
  );

  const pendingUpdate = isVersionOutdated({
    current: dbVersion,
    latest: version,
  });
  const existing = await ctx.runQuery(internal.subscriptions.exists, {
    packageId,
    subscriberId,
    channelId,
    userId: channelId ? undefined : userId,
  });

  if (existing) {
    if (existing.minUpdateType !== minUpdateType) {
      await ctx.runMutation(internal.subscriptions.updateMinUpdateType, {
        subscriptionId: existing._id,
        minUpdateType,
      });
      return {
        kind: 'updated',
        packageName,
        version,
        filterLabel: formatMinUpdateType(minUpdateType),
        channelName: existing.channelName,
      };
    }

    return {
      kind: 'already',
      packageName,
      version,
      filterLabel: formatMinUpdateType(existing.minUpdateType as MinUpdateType),
      channelName: existing.channelName,
    };
  }

  await ctx.runMutation(internal.subscriptions.create, {
    packageId,
    subscriberId,
    lastNotifiedVersion: version,
    minUpdateType,
    channelId,
    channelName,
    userId: channelId ? undefined : userId,
  });

  return {
    kind: 'tracked',
    packageId,
    packageName,
    version,
    displayVersion: pendingUpdate ? dbVersion : version,
    filterLabel: formatMinUpdateType(minUpdateType),
    pendingUpdate,
  };
}

function formatTrackOutcomeLine(outcome: TrackOutcome): string {
  switch (outcome.kind) {
    case 'tracked':
      return `• ${formatPackageName(outcome.packageName)} — current version ${formatVersion(outcome.displayVersion)}${outcome.filterLabel ? ` ${outcome.filterLabel}` : ''}${outcome.pendingUpdate ? ` (update available: ${formatVersion(outcome.version)})` : ''}`;
    case 'updated':
      return `• ${formatPackageName(outcome.packageName)} — updated threshold to ${outcome.filterLabel ?? 'all'} notifications, current version ${formatVersion(outcome.version)}`;
    case 'already':
      return `• ${formatPackageName(outcome.packageName)} — already tracked at ${formatVersion(outcome.version)}${outcome.filterLabel ? ` ${outcome.filterLabel}` : ''}`;
    case 'not_found':
      return `• ${formatPackageName(outcome.packageName)} — not found on npm`;
  }
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
  channel: { id?: string; name: string } | null;
  minUpdateType: MinUpdateType;
} {
  let text = raw.trim();
  let channel: { id?: string; name: string } | null = null;
  let minUpdateType: MinUpdateType = 'patch';

  // Extract Slack-escaped channel mention: <#C1234567|channel-name>
  const escapedMention = text.match(/<#([A-Za-z0-9]+)\|([^>]+)>/);
  if (escapedMention) {
    channel = { id: escapedMention[1], name: escapedMention[2] };
    text = text.replace(escapedMention[0], '').trim();
  } else {
    // Extract plain #channel-name
    const hashMention = text.match(/(^|\s)(#\S+)/);
    if (hashMention) {
      const name = hashMention[2].slice(1); // strip leading #
      channel = { name };
      text = text.replace(hashMention[2], '').trim();
    }
  }

  // Extract update type filter
  const filterMatch = text.match(/(^|\s)(minor|major)(\s|$)/);
  if (filterMatch) {
    minUpdateType = filterMatch[2] as MinUpdateType;
    text = text.replace(filterMatch[0], ' ').trim();
  }

  const packageNames = text
    .split(/\s+/)
    .map(normalizeNpmPackageName)
    .filter(Boolean);

  return { packageNames, channel, minUpdateType };
}

function formatMinUpdateType(
  minUpdateType: MinUpdateType | undefined,
): string | null {
  if (!minUpdateType || minUpdateType === 'patch') return null;
  return minUpdateType === 'major' ? '[major only]' : '[minor+]';
}

function formatChannelPhrase(
  channelName: string | undefined,
  channelId?: string,
): string {
  if (channelId) return ` in <#${channelId}>`;
  return channelName ? ` in *#${channelName}*` : '';
}

function formatChannelDescriptor(
  channelName: string | undefined,
  channelId: string | undefined,
): string {
  return channelId
    ? `<#${channelId}>`
    : channelName
      ? `*#${normalizeChannelName(channelName)}*`
      : 'this channel';
}

function formatTrackingTarget(
  channelName: string | undefined,
  channelId: string | undefined,
): string {
  return channelId
    ? `<#${channelId}>`
    : channelName
      ? `*#${normalizeChannelName(channelName)}*`
      : 'this channel';
}

function normalizeChannelName(channelName: string): string {
  return channelName.replace(/^#/, '');
}

function looksLikeSlackChannelId(
  channelId: string | undefined,
): channelId is string {
  return typeof channelId === 'string' && /^[CGD][A-Z0-9_]+$/i.test(channelId);
}

async function resolveChannelTarget(
  token: string,
  channelId: string | undefined,
  channelName: string | undefined,
): Promise<{ channelId: string | undefined; channelName: string | undefined }> {
  if (looksLikeSlackChannelId(channelId)) {
    const resolvedChannelName =
      channelName ?? (await conversationsInfo(token, channelId));
    return {
      channelId,
      channelName: resolvedChannelName ?? channelName,
    };
  }

  const candidateName = channelName ?? channelId;
  if (!candidateName) {
    return { channelId, channelName };
  }

  const channel = await conversationsFindByName(token, candidateName);
  if (!channel) {
    return {
      channelId: undefined,
      channelName: normalizeChannelName(candidateName),
    };
  }

  return {
    channelId: channel.id,
    channelName: channel.name,
  };
}

function missingChannelLookupScopeMessage(
  channelName: string | undefined,
): string {
  const target = channelName
    ? `*#${normalizeChannelName(channelName)}*`
    : 'that channel';
  return (
    `⚠️ I couldn't resolve ${target} because this Slack app is missing the channel lookup scope required ` +
    `for typed channel names. Reinstall PatchPulse with channel read access, or pick the channel from the modal / Slack channel picker so Slack sends the channel ID directly.`
  );
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
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

// HTTP action handlers — return immediately, schedule async work

export const npmTrack = httpAction(async (ctx, request) => {
  const rawBody = await verifySlackRequest(request);
  if (rawBody === null) return new Response('Unauthorized', { status: 401 });

  const body = parseSlashBody(rawBody);
  const { packageNames, channel, minUpdateType } = parseTrackArgs(
    body.text ?? '',
  );
  const teamId = body.team_id;
  const responseUrl = body.response_url;
  const userId = body.user_id;

  if (packageNames.length > 1) {
    await ctx.scheduler.runAfter(
      0,
      internal.slack.commands.processBulkNpmTrack,
      {
        packageNames,
        teamId,
        responseUrl,
        minUpdateType,
        channelId: channel?.id,
        channelName: channel?.name,
        userId,
      },
    );
  } else {
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
  }

  const packageList = packageNames.map((p) => formatPackageName(p)).join(', ');
  const ackText =
    packageNames.length === 0
      ? `⚠️ Please provide a package name, e.g. \`/npmtrack react\``
      : `⏳ Tracking ${packageList}${formatChannelPhrase(channel?.name, channel?.id)}…`;

  return new Response(JSON.stringify({ text: ackText }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

export const npmUntrack = httpAction(async (ctx, request) => {
  const rawBody = await verifySlackRequest(request);
  if (rawBody === null) return new Response('Unauthorized', { status: 401 });

  const body = parseSlashBody(rawBody);
  const { packageNames, channel } = parseTrackArgs(body.text ?? '');

  if (packageNames.length === 0) {
    return new Response(
      JSON.stringify({
        text: `⚠️ Please provide a package name, e.g. \`/npmuntrack react\``,
      }),
      { headers: { 'Content-Type': 'application/json' } },
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
    JSON.stringify({
      text: `⏳ Untracking ${formatPackageName(packageName)}${formatChannelPhrase(channel?.name, channel?.id)}…`,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});

export const help = httpAction(async (_ctx, request) => {
  const rawBody = await verifySlackRequest(request);
  if (rawBody === null) return new Response('Unauthorized', { status: 401 });
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
    `• To track in a private channel, first run \`/invite @PatchPulse\` in that channel.\n\n` +
    `🐛 Found a bug or have a feature request? <https://github.com/barrymichaeldoyle/patch-pulse/issues|Open an issue on GitHub>`;

  return new Response(JSON.stringify({ text }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

export const listPackages = httpAction(async (ctx, request) => {
  const rawBody = await verifySlackRequest(request);
  if (rawBody === null) return new Response('Unauthorized', { status: 401 });

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
    { headers: { 'Content-Type': 'application/json' } },
  );
});

// Internal actions — async processors scheduled by the HTTP handlers above

export const processNpmTrack = internalAction({
  args: {
    packageName: v.string(),
    teamId: v.string(),
    responseUrl: v.optional(v.string()),
    minUpdateType: v.union(
      v.literal('patch'),
      v.literal('minor'),
      v.literal('major'),
    ),
    channelId: v.optional(v.string()),
    channelName: v.optional(v.string()),
    userId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    {
      packageName,
      teamId,
      responseUrl,
      minUpdateType,
      channelId,
      channelName,
      userId,
    },
  ) => {
    packageName = normalizeNpmPackageName(packageName);

    // When invoked from a modal there is no responseUrl — fall back to DMing the user
    async function sendFeedback(
      details: { accessToken: string } | null,
      text: string,
    ) {
      if (responseUrl) {
        await sendToSlack(responseUrl, text);
      } else if (details && userId) {
        await chatPostMessage(details.accessToken, userId, text);
      }
    }

    const subscriber = await ctx.runQuery(internal.subscribers.getByTeamId, {
      teamId,
    });
    if (!subscriber) {
      await sendFeedback(
        null,
        `❌ Workspace not found. Please reinstall PatchPulse.`,
      );
      return;
    }

    const details = await ctx.runQuery(internal.subscribers.getSlackDetails, {
      subscriberId: subscriber._id,
    });

    if (details && (channelId || channelName)) {
      try {
        ({ channelId, channelName } = await resolveChannelTarget(
          details.accessToken,
          channelId,
          channelName,
        ));
      } catch (error) {
        if (error instanceof SlackMissingScopeError) {
          await sendFeedback(
            details,
            missingChannelLookupScopeMessage(channelName),
          );
          return;
        }
        throw error;
      }
    }

    const outcome = await trackPackage(ctx, {
      subscriberId: subscriber._id,
      packageName,
      minUpdateType,
      channelId,
      channelName,
      userId,
    });

    if (outcome.kind === 'not_found') {
      await sendFeedback(details, `❌ Could not find *${packageName}* on npm.`);
      return;
    }

    if (outcome.kind === 'updated') {
      const channelLabel = formatChannelPhrase(outcome.channelName);
      await sendFeedback(
        details,
        `Updated: now tracking ${formatPackageName(packageName)}${channelLabel} with ${outcome.filterLabel ?? 'all'} notifications — currently at ${formatVersion(outcome.version)}`,
      );
      if (!responseUrl && userId) {
        await ctx.scheduler.runAfter(
          0,
          internal.slack.commands.refreshAppHome,
          { teamId, userId },
        );
      }
      return;
    }

    if (outcome.kind === 'already') {
      const channelLabel = formatChannelPhrase(outcome.channelName);
      await sendFeedback(
        details,
        `Already tracking ${formatPackageName(packageName)} — currently at ${formatVersion(outcome.version)}${channelLabel}${outcome.filterLabel ? ` ${outcome.filterLabel}` : ''}`,
      );
      if (!responseUrl && userId) {
        await ctx.scheduler.runAfter(
          0,
          internal.slack.commands.refreshAppHome,
          { teamId, userId },
        );
      }
      return;
    }

    if (details) {
      const updateSuffix = outcome.pendingUpdate
        ? ` There's already an update available (${formatVersion(outcome.displayVersion)} → ${formatVersion(outcome.version)}) — I'll notify you about it shortly.`
        : '';

      if (channelId) {
        const channelLabel = formatTrackingTarget(channelName, channelId);
        try {
          await chatPostMessage(
            details.accessToken,
            channelId,
            `<@${userId}> is now tracking ${formatPackageName(packageName)} in this channel — current version ${formatVersion(outcome.displayVersion)}${outcome.filterLabel ? ` ${outcome.filterLabel}` : ''}${updateSuffix}`,
          );
        } catch (error) {
          if (error instanceof PrivateChannelError) {
            await ctx.runMutation(internal.subscriptions.remove, {
              packageId: outcome.packageId,
              subscriberId: subscriber._id,
              channelId,
            });
            await sendFeedback(
              details,
              `⚠️ ${formatPackageName(packageName)} couldn't be tracked in ${channelLabel} — PatchPulse needs to be invited first. Run \`/invite @PatchPulse\` in that channel, then try again.`,
            );
            return;
          } else {
            throw error;
          }
        }
      } else if (userId) {
        await chatPostMessage(
          details.accessToken,
          userId,
          `You're now tracking ${formatPackageName(packageName)} — current version ${formatVersion(outcome.displayVersion)}${outcome.filterLabel ? ` ${outcome.filterLabel}` : ''}.${updateSuffix || " I'll DM you when updates are available."}`,
        );
      }
    }

    // Refresh home tab when invoked from modal
    if (!responseUrl && userId) {
      await ctx.scheduler.runAfter(0, internal.slack.commands.refreshAppHome, {
        teamId,
        userId,
      });
    }
  },
});

export const processBulkNpmTrack = internalAction({
  args: {
    packageNames: v.array(v.string()),
    teamId: v.string(),
    responseUrl: v.optional(v.string()),
    minUpdateType: v.union(
      v.literal('patch'),
      v.literal('minor'),
      v.literal('major'),
    ),
    channelId: v.optional(v.string()),
    channelName: v.optional(v.string()),
    userId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    {
      packageNames,
      teamId,
      responseUrl,
      minUpdateType,
      channelId,
      channelName,
      userId,
    },
  ) => {
    const normalizedPackageNames = [
      ...new Set(packageNames.map(normalizeNpmPackageName).filter(Boolean)),
    ];
    const subscriber = await ctx.runQuery(internal.subscribers.getByTeamId, {
      teamId,
    });
    if (!subscriber) {
      if (responseUrl) {
        await sendToSlack(
          responseUrl,
          `❌ Workspace not found. Please reinstall PatchPulse.`,
        );
      }
      return;
    }

    const details = await ctx.runQuery(internal.subscribers.getSlackDetails, {
      subscriberId: subscriber._id,
    });
    if (details && (channelId || channelName)) {
      try {
        ({ channelId, channelName } = await resolveChannelTarget(
          details.accessToken,
          channelId,
          channelName,
        ));
      } catch (error) {
        if (error instanceof SlackMissingScopeError) {
          if (responseUrl) {
            await sendToSlack(
              responseUrl,
              missingChannelLookupScopeMessage(channelName),
            );
          } else if (details && userId) {
            await chatPostMessage(
              details.accessToken,
              userId,
              missingChannelLookupScopeMessage(channelName),
            );
          }
          return;
        }
        throw error;
      }
    }

    const outcomes: TrackOutcome[] = [];
    const createdPackageIds: Id<'packages'>[] = [];

    for (const packageName of normalizedPackageNames) {
      const outcome = await trackPackage(ctx, {
        subscriberId: subscriber._id,
        packageName,
        minUpdateType,
        channelId,
        channelName,
        userId,
      });
      outcomes.push(outcome);
      if (outcome.kind === 'tracked') {
        createdPackageIds.push(outcome.packageId);
      }
    }

    const targetLabel = channelId ? 'this channel' : 'your DMs';
    const summary =
      `${channelId ? `<@${userId}>` : 'You'} processed *${normalizedPackageNames.length}* package request${normalizedPackageNames.length === 1 ? '' : 's'} in ${targetLabel}:\n` +
      outcomes.map(formatTrackOutcomeLine).join('\n');

    if (details) {
      if (channelId) {
        try {
          await chatPostMessage(details.accessToken, channelId, summary);
        } catch (error) {
          if (error instanceof PrivateChannelError) {
            for (const packageId of createdPackageIds) {
              await ctx.runMutation(internal.subscriptions.remove, {
                packageId,
                subscriberId: subscriber._id,
                channelId,
              });
            }
            if (responseUrl) {
              await sendToSlack(
                responseUrl,
                `⚠️ Packages couldn't be tracked in ${targetLabel} — PatchPulse needs to be invited first. Run \`/invite @PatchPulse\` in that channel, then try again.`,
              );
            } else if (userId) {
              await chatPostMessage(
                details.accessToken,
                userId,
                `⚠️ Packages couldn't be tracked in ${targetLabel} — PatchPulse needs to be invited first. Run \`/invite @PatchPulse\` in that channel, then try again.`,
              );
            }
            return;
          }
          throw error;
        }
      } else if (userId) {
        await chatPostMessage(details.accessToken, userId, summary);
      }
    } else if (responseUrl) {
      await sendToSlack(responseUrl, summary);
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
  handler: async (
    ctx,
    { packageName, teamId, responseUrl, channelId, channelName, userId },
  ) => {
    packageName = normalizeNpmPackageName(packageName);

    const pkg = await ctx.runQuery(internal.packages.getByName, {
      name: packageName,
    });
    if (!pkg) {
      await sendToSlack(
        responseUrl,
        `${formatPackageName(packageName)} is not in your tracked packages.`,
      );
      return;
    }

    const subscriber = await ctx.runQuery(internal.subscribers.getByTeamId, {
      teamId,
    });
    if (!subscriber) {
      await sendToSlack(
        responseUrl,
        `❌ Workspace not found. Please reinstall PatchPulse.`,
      );
      return;
    }

    const details = await ctx.runQuery(internal.subscribers.getSlackDetails, {
      subscriberId: subscriber._id,
    });

    if (details && (channelId || channelName)) {
      try {
        ({ channelId, channelName } = await resolveChannelTarget(
          details.accessToken,
          channelId,
          channelName,
        ));
      } catch (error) {
        if (error instanceof SlackMissingScopeError) {
          await sendToSlack(
            responseUrl,
            missingChannelLookupScopeMessage(channelName),
          );
          return;
        }
        throw error;
      }
    }

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
          `${formatPackageName(packageName)} is not tracked in ${formatChannelDescriptor(channelName, channelId)}.`,
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
          `<@${userId}> stopped tracking ${formatPackageName(packageName)} in ${formatChannelDescriptor(channelName, channelId)}`,
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
        await sendToSlack(
          responseUrl,
          `You're not tracking ${formatPackageName(packageName)} via DMs.`,
        );
        return;
      }

      await ctx.runMutation(internal.subscriptions.remove, {
        packageId: pkg._id,
        subscriberId: subscriber._id,
        userId,
      });

      // Warn if channel subscriptions for this package still exist in the workspace
      const remainingSubs = await ctx.runQuery(
        internal.subscriptions.getByPackageAndSubscriber,
        {
          packageId: pkg._id,
          subscriberId: subscriber._id,
        },
      );
      const channelSubs = remainingSubs.filter((s) => s.channelId);
      const channelNote =
        channelSubs.length > 0
          ? ` Note: *${packageName}* is still tracked in ${channelSubs
              .map((s) => formatChannelDescriptor(s.channelName, s.channelId))
              .join(', ')} by your workspace.`
          : '';

      if (details && userId) {
        await chatPostMessage(
          details.accessToken,
          userId,
          `You stopped tracking ${formatPackageName(packageName)} via DMs.${channelNote}`,
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
    const subscriber = await ctx.runQuery(internal.subscribers.getByTeamId, {
      teamId,
    });
    if (!subscriber) {
      await sendToSlack(
        responseUrl,
        `❌ Workspace not found. Please reinstall PatchPulse.`,
      );
      return;
    }

    const allSubscriptions = await ctx.runQuery(
      internal.subscriptions.getBySubscriber,
      {
        subscriberId: subscriber._id,
      },
    );

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
    const packages = await ctx.runQuery(internal.packages.getByIds, {
      ids: packageIds,
    });

    const groupedLines = subscriptions
      .map((sub) => {
        const pkg = packages.find((p) => p?._id === sub.packageId);
        if (!pkg) return null;
        const channel = getListChannelMetadata(sub.channelName, sub.userId);
        return { sub, pkg, channel };
      })
      .filter(
        (
          entry,
        ): entry is {
          sub: (typeof subscriptions)[number];
          pkg: NonNullable<(typeof packages)[number]>;
          channel: { key: string; heading: string };
        } => entry !== null,
      )
      .sort((a, b) => {
        const channelCompare = a.channel.key.localeCompare(b.channel.key);
        if (channelCompare !== 0) return channelCompare;
        return a.pkg.name.localeCompare(b.pkg.name);
      })
      .reduce((groups, { sub, pkg, channel }) => {
        const filterLabel = formatMinUpdateType(
          sub.minUpdateType as MinUpdateType,
        );
        const line =
          `    • ${formatSlackPackageLink(pkg.name)} — ` +
          `${formatSlackVersionText(pkg.name, pkg.currentVersion, null, pkg.githubRepoUrl)}` +
          `${filterLabel ? ` ${filterLabel}` : ''}`;
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
        ? `📦 Tracking *${subscriptions.length}* package${subscriptions.length === 1 ? '' : 's'}:`
        : `📦 Tracking *${uniquePackages}* package${uniquePackages === 1 ? '' : 's'} across *${subscriptions.length}* subscriptions:`;

    const sections = Array.from(groupedLines.values()).map(
      ({ heading, lines }) => `${heading}\n${lines.join('\n')}`,
    );

    // Chunk sections into messages under ~3500 chars to stay within Slack's limits
    const SLACK_CHAR_LIMIT = 3500;
    const chunks: string[][] = [];
    let current: string[] = [];
    let currentLen = header.length + 3;

    for (const section of sections) {
      if (
        current.length > 0 &&
        currentLen + section.length + 3 > SLACK_CHAR_LIMIT
      ) {
        chunks.push(current);
        current = [];
        currentLen = 0;
      }
      current.push(section);
      currentLen += section.length + 3;
    }
    if (current.length > 0) chunks.push(current);

    const [first, ...rest] = chunks;
    await sendToSlack(responseUrl, `${header}\n\n\n${first.join('\n\n\n')}`);
    for (const chunk of rest) {
      await sendToSlack(responseUrl, chunk.join('\n\n\n'));
    }
  },
});

export const processUntrackAction = internalAction({
  args: {
    teamId: v.string(),
    viewingUserId: v.string(),
    subscriptionId: v.id('subscriptions'),
  },
  handler: async (ctx, { teamId, viewingUserId, subscriptionId }) => {
    const sub = await ctx.runQuery(internal.subscriptions.getById, {
      subscriptionId,
    });
    if (!sub) return;

    await ctx.runMutation(internal.subscriptions.remove, {
      packageId: sub.packageId,
      subscriberId: sub.subscriberId,
      channelId: sub.channelId,
      userId: sub.userId,
    });

    // Refresh the home tab so the package disappears immediately
    await ctx.scheduler.runAfter(0, internal.slack.commands.refreshAppHome, {
      teamId,
      userId: viewingUserId,
    });
  },
});

export const processThresholdChange = internalAction({
  args: {
    teamId: v.string(),
    viewingUserId: v.string(),
    subscriptionId: v.id('subscriptions'),
    minUpdateType: v.union(
      v.literal('patch'),
      v.literal('minor'),
      v.literal('major'),
    ),
  },
  handler: async (
    ctx,
    { teamId, viewingUserId, subscriptionId, minUpdateType },
  ) => {
    await ctx.runMutation(internal.subscriptions.updateMinUpdateType, {
      subscriptionId,
      minUpdateType,
    });

    await ctx.scheduler.runAfter(0, internal.slack.commands.refreshAppHome, {
      teamId,
      userId: viewingUserId,
    });
  },
});

export const processMoveAction = internalAction({
  args: {
    teamId: v.string(),
    viewingUserId: v.string(),
    subscriptionId: v.id('subscriptions'),
    newChannelId: v.string(),
  },
  handler: async (
    ctx,
    { teamId, viewingUserId, subscriptionId, newChannelId },
  ) => {
    const subscriber = await ctx.runQuery(internal.subscribers.getByTeamId, {
      teamId,
    });
    if (!subscriber) return;

    const details = await ctx.runQuery(internal.subscribers.getSlackDetails, {
      subscriberId: subscriber._id,
    });
    if (!details) return;

    const sub = await ctx.runQuery(internal.subscriptions.getById, {
      subscriptionId,
    });
    if (!sub) return;

    const newChannelName = await conversationsInfo(
      details.accessToken,
      newChannelId,
    );

    // Remove old subscription and create a new one for the new channel
    await ctx.runMutation(internal.subscriptions.remove, {
      packageId: sub.packageId,
      subscriberId: sub.subscriberId,
      channelId: sub.channelId,
      userId: sub.userId,
    });

    await ctx.runMutation(internal.subscriptions.create, {
      packageId: sub.packageId,
      subscriberId: sub.subscriberId,
      lastNotifiedVersion: sub.lastNotifiedVersion,
      minUpdateType: sub.minUpdateType,
      channelId: newChannelId,
      channelName: newChannelName,
    });

    await ctx.scheduler.runAfter(0, internal.slack.commands.refreshAppHome, {
      teamId,
      userId: viewingUserId,
    });
  },
});

export const refreshAppHome = internalAction({
  args: {
    teamId: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, { teamId, userId }) => {
    const subscriber = await ctx.runQuery(internal.subscribers.getByTeamId, {
      teamId,
    });
    if (!subscriber?.active) return;

    const details = await ctx.runQuery(internal.subscribers.getSlackDetails, {
      subscriberId: subscriber._id,
    });
    if (!details) return;

    const allSubscriptions = await ctx.runQuery(
      internal.subscriptions.getBySubscriber,
      {
        subscriberId: subscriber._id,
      },
    );

    // Show channel subs (workspace-wide) + this user's own DM subs
    const subscriptions = allSubscriptions.filter(
      (sub) => sub.channelId || sub.userId === userId,
    );

    const hydratedSubscriptions = await Promise.all(
      subscriptions.map(async (sub) => {
        if (!sub.channelId || sub.channelName) return sub;

        try {
          const channelName = await conversationsInfo(
            details.accessToken,
            sub.channelId,
          );
          if (!channelName) return sub;

          await ctx.runMutation(internal.subscriptions.updateChannelName, {
            subscriptionId: sub._id,
            channelName,
          });

          return { ...sub, channelName };
        } catch (error) {
          console.error('Failed to resolve Slack channel name:', error);
          return sub;
        }
      }),
    );

    const packageIds = [
      ...new Set(hydratedSubscriptions.map((s) => s.packageId)),
    ];
    const packages = await ctx.runQuery(internal.packages.getByIds, {
      ids: packageIds,
    });

    const entries = hydratedSubscriptions
      .map((sub): HomePackageEntry | null => {
        const pkg = packages.find((p) => p?._id === sub.packageId);
        if (!pkg) return null;
        return {
          subscriptionId: sub._id,
          packageName: pkg.name,
          currentVersion: pkg.currentVersion,
          githubRepoUrl: pkg.githubRepoUrl,
          minUpdateType: sub.minUpdateType,
          channelId: sub.channelId,
          channelName: sub.channelName,
          userId: sub.userId,
          lastChecked: pkg.lastChecked,
        };
      })
      .filter((e): e is HomePackageEntry => e !== null);

    try {
      await publishAppHome(details.accessToken, userId, entries);
    } catch (error) {
      console.error('Failed to publish App Home:', error);
    }
  },
});
