import { v } from 'convex/values';
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server';
import { internal } from './_generated/api';
import { type Doc } from './_generated/dataModel';
import { fetchNpmPackageManifest } from '@patch-pulse/shared';
import { getTimeoutMs, withTimeout } from './async';
import {
  summarizeReleaseEvidence,
  type SummaryFailureReason,
} from './aiSummary';
import {
  pendingPackageValidator,
  type PendingReleaseCheckPackage,
} from './releaseCheckState';
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

const STATUS_REACTIONS = {
  abandoned: 'warning',
  failed: 'x',
  pending: 'hourglass_flowing_sand',
  ready: 'memo',
} as const;
const RELEASE_CHECK_PENDING_COMMENT =
  '⏳ Looking up release notes and drafting a short summary. This usually clears once npm or GitHub metadata catches up.';
const NPM_MANIFEST_TIMEOUT_MS = getTimeoutMs('NPM_MANIFEST_TIMEOUT_MS', 8_000);
const RELEASE_EVIDENCE_TIMEOUT_MS = getTimeoutMs(
  'RELEASE_EVIDENCE_TIMEOUT_MS',
  15_000,
);

type PendingReleaseCheckRecord = Omit<
  Doc<'pendingReleaseChecks'>,
  'packages'
> & {
  packages: PendingReleaseCheckPackage[];
};

async function listPackagesByCheckId(
  ctx: QueryCtx | MutationCtx,
  checkId: Doc<'pendingReleaseChecks'>['_id'],
): Promise<PendingReleaseCheckPackage[]> {
  const rows = await ctx.db
    .query('pendingReleaseCheckPackages')
    .withIndex('by_check_id_and_package_index', (q) => q.eq('checkId', checkId))
    .collect();

  return rows.map(
    ({ _creationTime, _id, checkId: _checkId, packageIndex, ...pkg }) => pkg,
  );
}

async function replacePackagesForCheck(
  ctx: MutationCtx,
  checkId: Doc<'pendingReleaseChecks'>['_id'],
  packages: PendingReleaseCheckPackage[],
) {
  const existing = await ctx.db
    .query('pendingReleaseCheckPackages')
    .withIndex('by_check_id_and_package_index', (q) => q.eq('checkId', checkId))
    .collect();

  for (const doc of existing) {
    await ctx.db.delete(doc._id);
  }

  for (const [packageIndex, pkg] of packages.entries()) {
    await ctx.db.insert('pendingReleaseCheckPackages', {
      checkId,
      packageIndex,
      ...pkg,
    });
  }
}

async function deletePackagesForCheck(
  ctx: MutationCtx,
  checkId: Doc<'pendingReleaseChecks'>['_id'],
) {
  const existing = await ctx.db
    .query('pendingReleaseCheckPackages')
    .withIndex('by_check_id_and_package_index', (q) => q.eq('checkId', checkId))
    .collect();

  for (const doc of existing) {
    await ctx.db.delete(doc._id);
  }
}

function packageNeedsWork(pkg: PendingReleaseCheckPackage): boolean {
  return pkg.lineStatus === 'pending' || pkg.summaryStatus === 'pending';
}

function logReleaseCheckEvent(event: string, details: Record<string, unknown>) {
  console.log(
    JSON.stringify({
      scope: 'release-check',
      event,
      ...details,
    }),
  );
}

function summarizeFailureReasons(
  packages: PendingReleaseCheckPackage[],
): Array<{
  count: number;
  reason: SummaryFailureReason | 'npm-manifest-unavailable';
}> {
  const counts = new Map<
    SummaryFailureReason | 'npm-manifest-unavailable',
    number
  >();

  for (const pkg of packages) {
    if (pkg.summaryStatus !== 'abandoned' || !pkg.summaryFailureReason) {
      continue;
    }
    counts.set(
      pkg.summaryFailureReason,
      (counts.get(pkg.summaryFailureReason) ?? 0) + 1,
    );
  }

  return Array.from(counts.entries()).map(([reason, count]) => ({
    reason,
    count,
  }));
}

function formatFailureReasonLine(args: {
  count: number;
  reason: SummaryFailureReason | 'npm-manifest-unavailable';
}): string {
  const prefix = `${args.count} update${args.count === 1 ? '' : 's'}`;
  switch (args.reason) {
    case 'missing-openai-key':
      return `• ${prefix}: AI summaries are disabled because \`OPENAI_API_KEY\` is not configured.`;
    case 'insufficient-public-evidence':
      return `• ${prefix}: public release notes or compare data were too thin to summarize safely.`;
    case 'openai-timeout':
      return `• ${prefix}: release evidence was found, but AI summary generation timed out.`;
    case 'openai-error':
      return `• ${prefix}: release evidence was found, but AI summary generation failed.`;
    case 'npm-manifest-unavailable':
      return `• ${prefix}: npm package metadata could not be fetched reliably enough to summarize.`;
  }
}

function buildThreadSummaryText(
  packages: PendingReleaseCheckPackage[],
): string | null {
  const readyPackages = packages.filter(
    (pkg) => pkg.summaryStatus === 'ready' && pkg.summaryText,
  );
  if (readyPackages.length === 0) return null;
  const failureLines = summarizeFailureReasons(packages).map(
    formatFailureReasonLine,
  );

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

  return (
    `📝 *Release summary*\n\n${body}` +
    (failureLines.length > 0
      ? `\n\n_Not summarized:_\n${failureLines.join('\n')}`
      : '')
  );
}

function buildThreadFallbackText(
  packages: PendingReleaseCheckPackage[],
): string {
  const packageCount = packages.length;
  const failureLines = summarizeFailureReasons(packages).map(
    formatFailureReasonLine,
  );
  const intro = `⚠️ I couldn't finish AI summaries for ${packageCount} update${packageCount === 1 ? '' : 's'}.`;

  return failureLines.length > 0
    ? `${intro}\n${failureLines.join('\n')}\nThe links in the main message are still the best available signal right now.`
    : `${intro} The links in the main message are still the best available signal right now.`;
}

async function syncStatusReaction(args: {
  accessToken: string;
  channelId: string;
  messageTs: string;
  previousReaction: string | undefined;
  nextStatus: keyof typeof STATUS_REACTIONS;
}): Promise<string | undefined> {
  const nextReaction = STATUS_REACTIONS[args.nextStatus];
  let currentReaction = args.previousReaction;

  if (args.previousReaction && args.previousReaction !== nextReaction) {
    try {
      await reactionsRemove(
        args.accessToken,
        args.channelId,
        args.messageTs,
        args.previousReaction,
      );
      currentReaction = undefined;
    } catch (error) {
      console.warn('failed to remove Slack reaction:', error);
    }
  }

  if (currentReaction !== nextReaction) {
    try {
      await reactionsAdd(
        args.accessToken,
        args.channelId,
        args.messageTs,
        nextReaction,
      );
      currentReaction = nextReaction;
    } catch (error) {
      console.warn('failed to add Slack reaction:', error);
    }
  }

  return currentReaction;
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
      subscriberId: args.subscriberId,
      channelId: args.channelId,
      messageTs: args.messageTs,
      fullText: args.fullText,
      retryCount: 0,
      currentReaction: STATUS_REACTIONS.pending,
    });
    await replacePackagesForCheck(ctx, checkId, args.packages);
    await ctx.scheduler.runAfter(0, internal.releaseChecks.retry, { checkId });
    return checkId;
  },
});

export const get = internalQuery({
  args: { checkId: v.id('pendingReleaseChecks') },
  handler: async (ctx, { checkId }) => {
    const check = await ctx.db.get(checkId);
    if (!check) return null;

    const packages = await listPackagesByCheckId(ctx, checkId);
    return {
      ...check,
      packages: packages.length > 0 ? packages : (check.packages ?? []),
    } satisfies PendingReleaseCheckRecord;
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
    await ctx.db.patch(checkId, {
      fullText: patch.fullText,
      retryCount: patch.retryCount,
      commentTs: patch.commentTs,
      currentReaction: patch.currentReaction,
    });
    await replacePackagesForCheck(ctx, checkId, patch.packages);
  },
});

export const saveCommentTs = internalMutation({
  args: {
    checkId: v.id('pendingReleaseChecks'),
    commentTs: v.string(),
  },
  handler: async (ctx, { checkId, commentTs }) => {
    await ctx.db.patch(checkId, { commentTs });
  },
});

export const remove = internalMutation({
  args: { checkId: v.id('pendingReleaseChecks') },
  handler: async (ctx, { checkId }) => {
    await deletePackagesForCheck(ctx, checkId);
    await ctx.db.delete(checkId);
  },
});

export const retry = internalAction({
  args: { checkId: v.id('pendingReleaseChecks') },
  handler: async (ctx, { checkId }) => {
    const check: PendingReleaseCheckRecord | null = await ctx.runQuery(
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
    const updatedPackages: PendingReleaseCheckPackage[] = [];

    if (!commentTs) {
      try {
        const response = await chatPostMessage(
          details.accessToken,
          check.channelId,
          RELEASE_CHECK_PENDING_COMMENT,
          check.messageTs,
        );
        commentTs = response.ts;
        await ctx.runMutation(internal.releaseChecks.saveCommentTs, {
          checkId,
          commentTs,
        });
      } catch (error) {
        console.error(
          'failed to post Slack release-check progress reply:',
          error,
        );
      }
    }

    for (const currentPackage of check.packages) {
      let pkg = { ...currentPackage };
      if (!packageNeedsWork(pkg)) {
        updatedPackages.push(pkg);
        continue;
      }

      let manifest;
      try {
        manifest = await withTimeout(
          fetchNpmPackageManifest(pkg.name, {
            userAgent: 'patch-pulse-notifier-bot',
          }),
          {
            label: `npm manifest lookup (${pkg.name})`,
            timeoutMs: NPM_MANIFEST_TIMEOUT_MS,
          },
        );
      } catch (error) {
        console.warn(`failed to fetch npm manifest for ${pkg.name}:`, error);
        if (isFinalAttempt) {
          if (pkg.lineStatus === 'pending') pkg.lineStatus = 'abandoned';
          if (pkg.summaryStatus === 'pending') {
            pkg.summaryStatus = 'abandoned';
            pkg.summaryFailureReason = 'npm-manifest-unavailable';
            pkg.summaryFailureDetail =
              error instanceof Error ? error.message : String(error);
          }
        }
        logReleaseCheckEvent('npm-manifest-failed', {
          isFinalAttempt,
          packageName: pkg.name,
          retryCount: check.retryCount,
        });
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
          const evidence = await withTimeout(
            collectReleaseEvidence(
              pkg.name,
              manifest,
              pkg.fromVersion,
              pkg.toVersion,
            ),
            {
              label: `release evidence lookup (${pkg.name})`,
              timeoutMs: RELEASE_EVIDENCE_TIMEOUT_MS,
            },
          );
          logReleaseCheckEvent('release-evidence-collected', {
            diagnostics: evidence.diagnostics,
            packageName: pkg.name,
            retryCount: check.retryCount,
            shouldRetry: evidence.shouldRetry,
          });
          if (!evidence.shouldRetry) {
            const summaryResult = await withTimeout(
              summarizeReleaseEvidence({
                packageName: pkg.name,
                fromVersion: pkg.fromVersion,
                toVersion: pkg.toVersion,
                updateType: pkg.updateType,
                evidence,
              }),
              {
                label: `release summary generation (${pkg.name})`,
                timeoutMs: RELEASE_EVIDENCE_TIMEOUT_MS,
              },
            );
            if (summaryResult.status === 'ready') {
              pkg.summaryStatus = 'ready';
              pkg.summaryText = summaryResult.summary;
              pkg.sourceLinks = evidence.sourceLinks;
              pkg.summaryFailureReason = undefined;
              pkg.summaryFailureDetail = undefined;
            } else if (summaryResult.status === 'abandoned') {
              pkg.summaryStatus = 'abandoned';
              pkg.summaryFailureReason = summaryResult.reason;
              pkg.summaryFailureDetail = summaryResult.detail;
              pkg.sourceLinks = evidence.sourceLinks;
            } else if (isFinalAttempt) {
              pkg.summaryStatus = 'abandoned';
              pkg.summaryFailureReason = summaryResult.reason;
              pkg.summaryFailureDetail = summaryResult.detail;
              pkg.sourceLinks = evidence.sourceLinks;
            }
          } else if (isFinalAttempt) {
            pkg.summaryStatus = 'abandoned';
            pkg.summaryFailureReason = 'insufficient-public-evidence';
            pkg.summaryFailureDetail =
              'GitHub release or compare metadata never became rich enough to summarize safely.';
          }
        } catch (error) {
          console.error('failed to build release summary:', error);
          if (isFinalAttempt) {
            pkg.summaryStatus = 'abandoned';
            const message =
              error instanceof Error ? error.message : String(error);
            pkg.summaryFailureReason = message.includes('timed out')
              ? 'openai-timeout'
              : 'openai-error';
            pkg.summaryFailureDetail = message;
          }
        }
        logReleaseCheckEvent('release-summary-status', {
          packageName: pkg.name,
          reason: pkg.summaryFailureReason,
          retryCount: check.retryCount,
          status: pkg.summaryStatus,
        });
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
    if (!hasPendingWork && !threadSummary) {
      const fallbackText = buildThreadFallbackText(updatedPackages);
      try {
        if (commentTs) {
          await chatUpdateMessage(
            details.accessToken,
            check.channelId,
            commentTs,
            fallbackText,
          );
        } else {
          await chatPostMessage(
            details.accessToken,
            check.channelId,
            fallbackText,
            check.messageTs,
          );
        }
      } catch (error) {
        console.error('failed to post Slack summary fallback reply:', error);
      }
    }

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
