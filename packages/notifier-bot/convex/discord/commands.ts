import { v } from 'convex/values';
import {
  fetchNpmPackageManifest,
  getNpmLatestVersion,
  isVersionOutdated,
} from '@patch-pulse/shared';
import { ActionCtx, httpAction, internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { Id } from '../_generated/dataModel';
import { extractGitHubRepoUrl } from '../slack/links';
import { verifyDiscordRequest } from './verify';
import {
  editInteractionReply,
  getChannelName,
  getGuildName,
  sendFollowUpMessage,
} from './api';
import { formatDiscordPackageLink, formatDiscordVersionText } from './format';

const INTERACTION_TYPE_PING = 1;
const INTERACTION_TYPE_APPLICATION_COMMAND = 2;
const RESPONSE_PONG = 1;
const RESPONSE_DEFERRED_EPHEMERAL = 5;
const RESPONSE_EPHEMERAL_MESSAGE = 4;
const EPHEMERAL = 64;

type MinUpdateType = 'patch' | 'minor' | 'major';

function normalizePackageName(name: string): string {
  return name
    .replace(/[*_<>]/g, '')
    .trim()
    .toLowerCase();
}

function formatMinUpdateType(t: MinUpdateType | undefined): string | null {
  if (!t || t === 'patch') return null;
  return t === 'major' ? '[major only]' : '[minor+]';
}

function ephemeralText(content: string) {
  return new Response(
    JSON.stringify({
      type: RESPONSE_EPHEMERAL_MESSAGE,
      data: { content, flags: EPHEMERAL },
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
}

function deferredEphemeral() {
  return new Response(
    JSON.stringify({
      type: RESPONSE_DEFERRED_EPHEMERAL,
      data: { flags: EPHEMERAL },
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
}

type DiscordInteractionOption = {
  name: string;
  value: string | number | boolean;
};

type DiscordInteraction = {
  type: number;
  application_id: string;
  token: string;
  guild_id?: string;
  channel_id: string;
  member?: { user?: { id?: string } };
  user?: { id?: string };
  data: {
    name: string;
    options?: DiscordInteractionOption[];
    resolved?: { channels?: Record<string, { name?: string }> };
  };
};

export const discordInteractions = httpAction(async (ctx, request) => {
  const rawBody = await verifyDiscordRequest(request);
  if (rawBody === null) return new Response('Unauthorized', { status: 401 });

  const interaction = JSON.parse(rawBody) as DiscordInteraction;

  if (interaction.type === INTERACTION_TYPE_PING) {
    return new Response(JSON.stringify({ type: RESPONSE_PONG }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (interaction.type !== INTERACTION_TYPE_APPLICATION_COMMAND) {
    return new Response('Unknown interaction type', { status: 400 });
  }

  const { name, options = [], resolved } = interaction.data;
  const applicationId = interaction.application_id;
  const interactionToken = interaction.token;
  const guildId = interaction.guild_id;
  const channelId = interaction.channel_id;
  const userId =
    interaction.member?.user?.id ?? interaction.user?.id ?? 'unknown';

  if (!guildId) {
    return ephemeralText('⚠️ PatchPulse commands must be used in a server.');
  }

  function getOption<T>(optName: string): T | undefined {
    return options.find((o) => o.name === optName)?.value as T | undefined;
  }

  function resolvedChannelName(id: string): string | undefined {
    return resolved?.channels?.[id]?.name;
  }

  switch (name) {
    case 'npmtrack': {
      const packageName = getOption<string>('package');
      if (!packageName) {
        return ephemeralText('⚠️ Please provide a package name.');
      }

      const channelOption = getOption<string>('channel');
      const targetChannelId = channelOption ?? channelId;
      const targetChannelName = channelOption
        ? resolvedChannelName(channelOption)
        : undefined;
      const filter = (getOption<string>('filter') ?? 'patch') as MinUpdateType;

      await ctx.scheduler.runAfter(
        0,
        internal.discord.commands.processNpmTrack,
        {
          packageName,
          guildId,
          channelId: targetChannelId,
          channelName: targetChannelName,
          userId,
          minUpdateType: filter,
          applicationId,
          interactionToken,
        },
      );
      return deferredEphemeral();
    }

    case 'npmuntrack': {
      const packageName = getOption<string>('package');
      if (!packageName) {
        return ephemeralText('⚠️ Please provide a package name.');
      }

      const channelOption = getOption<string>('channel');
      const targetChannelId = channelOption ?? channelId;
      const targetChannelName = channelOption
        ? resolvedChannelName(channelOption)
        : undefined;

      await ctx.scheduler.runAfter(
        0,
        internal.discord.commands.processNpmUntrack,
        {
          packageName,
          guildId,
          channelId: targetChannelId,
          channelName: targetChannelName,
          userId,
          applicationId,
          interactionToken,
        },
      );
      return deferredEphemeral();
    }

    case 'npmlist': {
      await ctx.scheduler.runAfter(0, internal.discord.commands.processList, {
        guildId,
        userId,
        applicationId,
        interactionToken,
      });
      return deferredEphemeral();
    }

    default:
      return new Response('Unknown command', { status: 400 });
  }
});

async function trackPackageForDiscord(
  ctx: ActionCtx,
  {
    subscriberId,
    packageName,
    minUpdateType,
    channelId,
    channelName,
  }: {
    subscriberId: Id<'subscribers'>;
    packageName: string;
    minUpdateType: MinUpdateType;
    channelId: string;
    channelName?: string;
  },
): Promise<
  | { kind: 'not_found' }
  | { kind: 'already'; version: string; githubUrl?: string }
  | { kind: 'updated'; version: string; githubUrl?: string }
  | {
      kind: 'tracked';
      version: string;
      dbVersion: string;
      githubUrl?: string;
      pendingUpdate: boolean;
    }
> {
  const manifest = await fetchNpmPackageManifest(packageName, {
    userAgent: 'patch-pulse-notifier-bot',
  }).catch(() => null);
  const version = getNpmLatestVersion(manifest);

  if (!version) return { kind: 'not_found' };

  const githubUrl = manifest ? extractGitHubRepoUrl(manifest) : undefined;

  const { packageId, dbVersion } = await ctx.runMutation(
    internal.packages.ensureExists,
    { name: packageName, version, ecosystem: 'npm', githubRepoUrl: githubUrl },
  );

  const pendingUpdate = isVersionOutdated({
    current: dbVersion,
    latest: version,
  });

  const existing = await ctx.runQuery(internal.subscriptions.exists, {
    packageId,
    subscriberId,
    channelId,
  });

  if (existing) {
    if (existing.minUpdateType !== minUpdateType) {
      await ctx.runMutation(internal.subscriptions.updateMinUpdateType, {
        subscriptionId: existing._id,
        minUpdateType,
      });
      return { kind: 'updated', version, githubUrl };
    }
    return { kind: 'already', version, githubUrl };
  }

  await ctx.runMutation(internal.subscriptions.create, {
    packageId,
    subscriberId,
    lastNotifiedVersion: version,
    minUpdateType,
    channelId,
    channelName,
  });

  return { kind: 'tracked', version, dbVersion, githubUrl, pendingUpdate };
}

async function ensureDiscordSubscriber(
  ctx: ActionCtx,
  guildId: string,
): Promise<Id<'subscribers'>> {
  const existing = await ctx.runQuery(internal.subscribers.getByGuildId, {
    guildId,
  });
  if (existing) return existing._id;

  const guildName =
    (await getGuildName(guildId).catch(() => undefined)) ?? 'Discord Server';

  return await ctx.runMutation(internal.subscribers.upsertDiscordGuild, {
    guildId,
    guildName,
  });
}

export const processNpmTrack = internalAction({
  args: {
    packageName: v.string(),
    guildId: v.string(),
    channelId: v.string(),
    channelName: v.optional(v.string()),
    userId: v.string(),
    minUpdateType: v.union(
      v.literal('patch'),
      v.literal('minor'),
      v.literal('major'),
    ),
    applicationId: v.string(),
    interactionToken: v.string(),
  },
  handler: async (ctx, args) => {
    async function reply(content: string) {
      try {
        await editInteractionReply(
          args.applicationId,
          args.interactionToken,
          content,
        );
      } catch (err) {
        console.error('discord processNpmTrack reply failed:', err);
      }
    }

    const packageName = normalizePackageName(args.packageName);

    const subscriberId = await ensureDiscordSubscriber(ctx, args.guildId);

    let channelName = args.channelName;
    if (!channelName) {
      channelName = await getChannelName(args.channelId).catch(() => undefined);
    }

    const outcome = await trackPackageForDiscord(ctx, {
      subscriberId,
      packageName,
      minUpdateType: args.minUpdateType,
      channelId: args.channelId,
      channelName,
    });

    const pkgLink = formatDiscordPackageLink(packageName);
    const channelDisplay = `<#${args.channelId}>`;

    if (outcome.kind === 'not_found') {
      await reply(`❌ Could not find **\`${packageName}\`** on npm.`);
      return;
    }

    const versionText = formatDiscordVersionText(
      packageName,
      outcome.version,
      outcome.githubUrl,
    );
    const filterLabel = formatMinUpdateType(args.minUpdateType);

    if (outcome.kind === 'updated') {
      await reply(
        `Updated: now tracking ${pkgLink} in ${channelDisplay} with ${filterLabel ?? 'all'} notifications — currently at ${versionText}`,
      );
      return;
    }

    if (outcome.kind === 'already') {
      await reply(
        `Already tracking ${pkgLink} in ${channelDisplay} — currently at ${versionText}${filterLabel ? ` ${filterLabel}` : ''}`,
      );
      return;
    }

    const displayVersionText = formatDiscordVersionText(
      packageName,
      outcome.dbVersion,
      outcome.githubUrl,
    );
    const updateSuffix = outcome.pendingUpdate
      ? ` There's already an update available (${displayVersionText} → ${versionText}) — I'll notify you shortly.`
      : '';

    await reply(
      `Now tracking ${pkgLink} in ${channelDisplay} — current version ${outcome.pendingUpdate ? displayVersionText : versionText}${filterLabel ? ` ${filterLabel}` : ''}.${updateSuffix || " I'll post updates here when new versions are available."}`,
    );
  },
});

export const processNpmUntrack = internalAction({
  args: {
    packageName: v.string(),
    guildId: v.string(),
    channelId: v.string(),
    channelName: v.optional(v.string()),
    userId: v.string(),
    applicationId: v.string(),
    interactionToken: v.string(),
  },
  handler: async (ctx, args) => {
    async function reply(content: string) {
      try {
        await editInteractionReply(
          args.applicationId,
          args.interactionToken,
          content,
        );
      } catch (err) {
        console.error('discord processNpmUntrack reply failed:', err);
      }
    }

    const packageName = normalizePackageName(args.packageName);
    const pkgLink = formatDiscordPackageLink(packageName);
    const channelDisplay = `<#${args.channelId}>`;

    const pkg = await ctx.runQuery(internal.packages.getByName, {
      name: packageName,
    });
    if (!pkg) {
      await reply(`\`${packageName}\` is not tracked in this server.`);
      return;
    }

    const subscriberId = await ensureDiscordSubscriber(ctx, args.guildId);

    const existing = await ctx.runQuery(internal.subscriptions.exists, {
      packageId: pkg._id,
      subscriberId,
      channelId: args.channelId,
    });

    if (!existing) {
      await reply(`${pkgLink} is not tracked in ${channelDisplay}.`);
      return;
    }

    await ctx.runMutation(internal.subscriptions.remove, {
      packageId: pkg._id,
      subscriberId,
      channelId: args.channelId,
    });

    await reply(`Stopped tracking ${pkgLink} in ${channelDisplay}.`);
  },
});

export const processList = internalAction({
  args: {
    guildId: v.string(),
    userId: v.string(),
    applicationId: v.string(),
    interactionToken: v.string(),
  },
  handler: async (ctx, args) => {
    async function reply(content: string) {
      try {
        await editInteractionReply(
          args.applicationId,
          args.interactionToken,
          content,
        );
      } catch (err) {
        console.error('discord processList reply failed:', err);
      }
    }

    const subscriberId = await ensureDiscordSubscriber(ctx, args.guildId);

    const subscriptions = await ctx.runQuery(
      internal.subscriptions.getBySubscriber,
      { subscriberId },
    );

    const channelSubs = subscriptions.filter((s) => s.channelId);

    if (channelSubs.length === 0) {
      await reply(
        "You're not tracking any packages yet. Use `/npmtrack` to get started.",
      );
      return;
    }

    const packageIds = [...new Set(channelSubs.map((s) => s.packageId))];
    const packages = await ctx.runQuery(internal.packages.getByIds, {
      ids: packageIds,
    });

    const grouped = new Map<string, { channelId: string; lines: string[] }>();

    for (const sub of channelSubs) {
      if (!sub.channelId) continue;
      const pkg = packages.find((p) => p?._id === sub.packageId);
      if (!pkg) continue;

      const npmUrl = `https://www.npmjs.com/package/${encodeURIComponent(pkg.name)}`;
      const versionUrl = pkg.githubRepoUrl
        ? `${pkg.githubRepoUrl}/releases`
        : `${npmUrl}/v/${pkg.currentVersion}`;
      const filterLabel = formatMinUpdateType(
        sub.minUpdateType as MinUpdateType,
      );
      const line =
        `    • **[\`${pkg.name}\`](<${npmUrl}>)** — ` +
        `[\`${pkg.currentVersion}\`](<${versionUrl}>)` +
        `${filterLabel ? ` ${filterLabel}` : ''}`;

      const existing = grouped.get(sub.channelId) ?? {
        channelId: sub.channelId,
        lines: [],
      };
      existing.lines.push(line);
      grouped.set(sub.channelId, existing);
    }

    const uniquePackages = packageIds.length;
    const header =
      uniquePackages === channelSubs.length
        ? `📦 Tracking **${channelSubs.length}** package${channelSubs.length === 1 ? '' : 's'}:`
        : `📦 Tracking **${uniquePackages}** package${uniquePackages === 1 ? '' : 's'} across **${channelSubs.length}** subscriptions:`;

    const sections = Array.from(grouped.values()).map(
      ({ channelId, lines }) => `<#${channelId}>\n${lines.join('\n')}`,
    );

    // Chunk into messages under Discord's 2000-char limit
    const DISCORD_CHAR_LIMIT = 1800;
    const chunks: string[][] = [];
    let current: string[] = [];
    let currentLen = header.length + 2;

    for (const section of sections) {
      if (
        current.length > 0 &&
        currentLen + section.length + 2 > DISCORD_CHAR_LIMIT
      ) {
        chunks.push(current);
        current = [];
        currentLen = 0;
      }
      current.push(section);
      currentLen += section.length + 2;
    }
    if (current.length > 0) chunks.push(current);

    const [first, ...rest] = chunks;
    await reply(`${header}\n\n${first.join('\n\n')}`);

    for (const chunk of rest) {
      await sendFollowUpMessage(
        args.applicationId,
        args.interactionToken,
        chunk.join('\n\n'),
      );
    }
  },
});
