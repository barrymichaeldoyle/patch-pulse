import { v } from 'convex/values';
import {
  internalAction,
  internalMutation,
  internalQuery,
} from './_generated/server';
import { internal } from './_generated/api';
import { type Doc } from './_generated/dataModel';
import { fetchNpmPackageManifest } from '@patch-pulse/shared';
import { summarizeReleaseEvidence } from './aiSummary';
import { collectReleaseEvidence } from './releaseEvidence';
import { formatUpdateLine } from './slack/format';
import {
  chatPostMessage,
  chatUpdateMessage,
  reactionsAdd,
  reactionsRemove,
} from './slack/api';

const RETRY_DELAYS_MS = [
  1 * 60 * 60 * 1000,
  3 * 60 * 60 * 1000,
  6 * 60 * 60 * 1000,
  12 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
] as const;

const lineStatusValidator = v.union(
  v.literal('pending'),
  v.literal('resolved'),
  v.literal('abandoned'),
);

const summaryStatusValidator = v.union(
  v.literal('pending'),
  v.literal('ready'),
  v.literal('abandoned'),
);

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
  lineStatus: lineStatusValidator,
  summaryStatus: summaryStatusValidator,
  summaryText: v.optional(v.string()),
  sourceLinks: v.optional(
    v.array(
      v.object({
        label: v.string(),
        url: v.string(),
      }),
    ),
  ),
});

const STATUS_REACTIONS = {
  abandoned: 'warning',
  failed: 'x',
  pending: 'hourglass_flowing_sand',
  ready: 'memo',
} as const;

type ReleaseCheckPackage = Doc<'pendingReleaseChecks'>['packages'][number];

function packageNeedsWork(pkg: ReleaseCheckPackage): boolean {
  return pkg.lineStatus === 'pending' || pkg.summaryStatus === 'pending';
}

function buildThreadSummaryText(
  packages: ReleaseCheckPackage[],
): string | null {
  const readyPackages = packages.filter(
    (pkg) => pkg.summaryStatus === 'ready' && pkg.summaryText,
  );
  if (readyPackages.length === 0) return null;

  const body = readyPackages
    .map((pkg) => {
      const packageLabel = `*${pkg.name}* ${pkg.fromVersion} → ${pkg.toVersion}`;
      const sources =
        pkg.sourceLinks && pkg.sourceLinks.length > 0
          ? `\n  ↳ ${pkg.sourceLinks
              .map((link) => `<${link.url}|${link.label}>`)
              .join(' · ')}`
          : '';
      return `• ${packageLabel}: ${pkg.summaryText}${sources}`;
    })
    .join('\n');

  return `📝 *Release summary*\n\n${body}`;
}

async function syncStatusReaction(args: {
  accessToken: string;
  channelId: string;
  messageTs: string;
  previousReaction: string | undefined;
  nextStatus: keyof typeof STATUS_REACTIONS;
}): Promise<string> {
  const nextReaction = STATUS_REACTIONS[args.nextStatus];

  if (args.previousReaction && args.previousReaction !== nextReaction) {
    try {
      await reactionsRemove(
        args.accessToken,
        args.channelId,
        args.messageTs,
        args.previousReaction,
      );
    } catch (error) {
      console.warn('failed to remove Slack reaction:', error);
    }
  }

  if (args.previousReaction !== nextReaction) {
    try {
      await reactionsAdd(
        args.accessToken,
        args.channelId,
        args.messageTs,
        nextReaction,
      );
    } catch (error) {
      console.warn('failed to add Slack reaction:', error);
    }
  }

  return nextReaction;
}

export const create = internalMutation({
  args: {
    subscriberId: v.id('subscribers'),
    channelId: v.string(),
    messageTs: v.string(),
    fullText: v.string(),
    packages: v.array(pendingPackageValidator),
  },
  handler: async (ctx, args) => {
    const checkId = await ctx.db.insert('pendingReleaseChecks', {
      ...args,
      retryCount: 0,
      currentReaction: STATUS_REACTIONS.pending,
    });
    await ctx.scheduler.runAfter(0, internal.releaseChecks.retry, { checkId });
    return checkId;
  },
});

export const get = internalQuery({
  args: { checkId: v.id('pendingReleaseChecks') },
  handler: async (ctx, { checkId }) => {
    return await ctx.db.get(checkId);
  },
});

export const saveProgress = internalMutation({
  args: {
    checkId: v.id('pendingReleaseChecks'),
    fullText: v.string(),
    retryCount: v.number(),
    packages: v.array(pendingPackageValidator),
    commentTs: v.optional(v.string()),
    currentReaction: v.optional(v.string()),
  },
  handler: async (ctx, { checkId, ...patch }) => {
    await ctx.db.patch(checkId, patch);
  },
});

export const remove = internalMutation({
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
      await ctx.runMutation(internal.releaseChecks.remove, { checkId });
      return;
    }

    let updatedText = check.fullText;
    let commentTs = check.commentTs;
    const nextDelayMs = RETRY_DELAYS_MS[check.retryCount];
    const isFinalAttempt = typeof nextDelayMs === 'undefined';
    const updatedPackages: ReleaseCheckPackage[] = [];

    for (const currentPackage of check.packages) {
      let pkg = { ...currentPackage };
      if (!packageNeedsWork(pkg)) {
        updatedPackages.push(pkg);
        continue;
      }

      let manifest;
      try {
        manifest = await fetchNpmPackageManifest(pkg.name, {
          userAgent: 'patch-pulse-notifier-bot',
        });
      } catch {
        if (isFinalAttempt) {
          if (pkg.lineStatus === 'pending') pkg.lineStatus = 'abandoned';
          if (pkg.summaryStatus === 'pending') pkg.summaryStatus = 'abandoned';
        }
        updatedPackages.push(pkg);
        continue;
      }

      if (pkg.lineStatus === 'pending') {
        const newLine = formatUpdateLine(
          pkg.name,
          pkg.fromVersion,
          pkg.toVersion,
          pkg.updateType,
          manifest,
        );
        if (newLine !== pkg.originalLine) {
          updatedText = updatedText.replace(pkg.originalLine, () => newLine);
          pkg.originalLine = newLine;
          pkg.lineStatus = 'resolved';
        } else if (isFinalAttempt) {
          pkg.lineStatus = 'abandoned';
        }
      }

      if (pkg.summaryStatus === 'pending') {
        try {
          const evidence = await collectReleaseEvidence(
            manifest,
            pkg.fromVersion,
            pkg.toVersion,
          );
          if (!evidence.shouldRetry) {
            const summary = await summarizeReleaseEvidence({
              packageName: pkg.name,
              fromVersion: pkg.fromVersion,
              toVersion: pkg.toVersion,
              updateType: pkg.updateType,
              evidence,
            });
            if (summary) {
              pkg.summaryStatus = 'ready';
              pkg.summaryText = summary.summary;
              pkg.sourceLinks = evidence.sourceLinks;
            } else if (isFinalAttempt) {
              pkg.summaryStatus = 'abandoned';
            }
          } else if (isFinalAttempt) {
            pkg.summaryStatus = 'abandoned';
          }
        } catch (error) {
          console.error('failed to build release summary:', error);
          if (isFinalAttempt) {
            pkg.summaryStatus = 'abandoned';
          }
        }
      }

      updatedPackages.push(pkg);
    }

    if (updatedText !== check.fullText) {
      try {
        await chatUpdateMessage(
          details.accessToken,
          check.channelId,
          check.messageTs,
          updatedText,
        );
      } catch (err) {
        console.error(
          'failed to update Slack message with release links:',
          err,
        );
      }
    }

    const threadSummary = buildThreadSummaryText(updatedPackages);
    if (threadSummary) {
      try {
        if (commentTs) {
          await chatUpdateMessage(
            details.accessToken,
            check.channelId,
            commentTs,
            threadSummary,
          );
        } else {
          const response = await chatPostMessage(
            details.accessToken,
            check.channelId,
            threadSummary,
            check.messageTs,
          );
          commentTs = response.ts;
        }
      } catch (error) {
        console.error('failed to post Slack summary thread reply:', error);
      }
    }

    const hasPendingWork = updatedPackages.some(packageNeedsWork);
    const nextReaction = await syncStatusReaction({
      accessToken: details.accessToken,
      channelId: check.channelId,
      messageTs: check.messageTs,
      previousReaction: check.currentReaction,
      nextStatus: hasPendingWork
        ? 'pending'
        : updatedPackages.some((pkg) => pkg.summaryStatus === 'ready')
          ? 'ready'
          : 'abandoned',
    });

    if (hasPendingWork && nextDelayMs) {
      await ctx.runMutation(internal.releaseChecks.saveProgress, {
        checkId,
        fullText: updatedText,
        retryCount: check.retryCount + 1,
        packages: updatedPackages,
        currentReaction: nextReaction,
        ...(commentTs ? { commentTs } : {}),
      });
      await ctx.scheduler.runAfter(nextDelayMs, internal.releaseChecks.retry, {
        checkId,
      });
      return;
    }

    await ctx.runMutation(internal.releaseChecks.remove, { checkId });
  },
});
