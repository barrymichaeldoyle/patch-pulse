import { v } from 'convex/values';
import {
  internalAction,
  internalMutation,
  internalQuery,
} from './_generated/server';
import { internal } from './_generated/api';
import { type Doc } from './_generated/dataModel';
import { fetchNpmPackageManifest } from '@patch-pulse/shared';
import { chatUpdateMessage } from './slack/api';
import { formatUpdateLine } from './slack/format';

// Delays between retries: 1h → 3h → 6h → 12h → 24h
const RETRY_DELAYS_MS = [
  1 * 60 * 60 * 1000,
  3 * 60 * 60 * 1000,
  6 * 60 * 60 * 1000,
  12 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
] as const;

const pendingPackageValidator = v.object({
  name: v.string(),
  fromVersion: v.string(),
  toVersion: v.string(),
  updateType: v.union(
    v.literal('patch'),
    v.literal('minor'),
    v.literal('major'),
  ),
  originalLine: v.string(),
});

export const create = internalMutation({
  args: {
    subscriberId: v.id('subscribers'),
    channelId: v.string(),
    messageTs: v.string(),
    fullText: v.string(),
    pendingPackages: v.array(pendingPackageValidator),
  },
  handler: async (ctx, args) => {
    const checkId = await ctx.db.insert('pendingReleaseChecks', {
      ...args,
      retryCount: 0,
    });
    await ctx.scheduler.runAfter(
      RETRY_DELAYS_MS[0],
      internal.releaseChecks.retry,
      { checkId },
    );
  },
});

export const get = internalQuery({
  args: { checkId: v.id('pendingReleaseChecks') },
  handler: async (ctx, { checkId }) => {
    return await ctx.db.get(checkId);
  },
});

export const resolve = internalMutation({
  args: {
    checkId: v.id('pendingReleaseChecks'),
    updatedText: v.string(),
    resolvedNames: v.array(v.string()),
  },
  handler: async (ctx, { checkId, updatedText, resolvedNames }) => {
    const check = await ctx.db.get(checkId);
    if (!check) return;

    const remaining = check.pendingPackages.filter(
      (p) => !resolvedNames.includes(p.name),
    );

    const maxRetriesReached = check.retryCount >= RETRY_DELAYS_MS.length - 1;

    if (remaining.length === 0 || maxRetriesReached) {
      await ctx.db.delete(checkId);
      return;
    }

    const nextRetryCount = check.retryCount + 1;
    await ctx.db.patch(checkId, {
      fullText: updatedText,
      pendingPackages: remaining,
      retryCount: nextRetryCount,
    });
    await ctx.scheduler.runAfter(
      RETRY_DELAYS_MS[nextRetryCount],
      internal.releaseChecks.retry,
      { checkId },
    );
  },
});

export const abandon = internalMutation({
  args: { checkId: v.id('pendingReleaseChecks') },
  handler: async (ctx, { checkId }) => {
    await ctx.db.delete(checkId);
  },
});

export const retry = internalAction({
  args: { checkId: v.id('pendingReleaseChecks') },
  handler: async (ctx, { checkId }) => {
    const check: Doc<'pendingReleaseChecks'> | null = await ctx.runQuery(
      internal.releaseChecks.get,
      { checkId },
    );
    if (!check) return;

    const details = await ctx.runQuery(internal.subscribers.getSlackDetails, {
      subscriberId: check.subscriberId,
    });
    if (!details) {
      await ctx.runMutation(internal.releaseChecks.abandon, { checkId });
      return;
    }

    let updatedText = check.fullText;
    const resolvedNames: string[] = [];

    for (const pkg of check.pendingPackages) {
      let manifest;
      try {
        manifest = await fetchNpmPackageManifest(pkg.name, {
          userAgent: 'patch-pulse-notifier-bot',
        });
      } catch {
        continue;
      }

      const newLine = formatUpdateLine(
        pkg.name,
        pkg.fromVersion,
        pkg.toVersion,
        pkg.updateType,
        manifest,
      );

      // Only replace if the line has changed (i.e. a GitHub URL is now available)
      if (newLine !== pkg.originalLine) {
        updatedText = updatedText.replace(pkg.originalLine, () => newLine);
        resolvedNames.push(pkg.name);
      }
    }

    if (resolvedNames.length > 0) {
      try {
        await chatUpdateMessage(
          details.accessToken,
          check.channelId,
          check.messageTs,
          updatedText,
        );
      } catch (err) {
        console.error('failed to update Slack message with release links:', err);
      }
    }

    await ctx.runMutation(internal.releaseChecks.resolve, {
      checkId,
      updatedText,
      resolvedNames,
    });
  },
});
