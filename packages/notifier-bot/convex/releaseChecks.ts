import { v } from 'convex/values';
import { internal } from './_generated/api';
import { type Doc } from './_generated/dataModel';
import {
  internalAction,
  internalMutation,
  internalQuery,
} from './_generated/server';
import { chatDeleteMessage, reactionsRemove } from './slack/api';

/**
 * Compatibility cleanup for enrichment jobs scheduled before the feature was
 * removed. New notifications never create these records or schedule this job.
 */
export const getLegacyCheck = internalQuery({
  args: { checkId: v.id('pendingReleaseChecks') },
  handler: async (ctx, { checkId }) => await ctx.db.get(checkId),
});

export const removeLegacyCheck = internalMutation({
  args: { checkId: v.id('pendingReleaseChecks') },
  handler: async (ctx, { checkId }) => {
    const packages = await ctx.db
      .query('pendingReleaseCheckPackages')
      .withIndex('by_check_id_and_package_index', (q) =>
        q.eq('checkId', checkId),
      )
      .take(100);

    for (const pkg of packages) {
      await ctx.db.delete(pkg._id);
    }

    const check = await ctx.db.get(checkId);
    if (check) await ctx.db.delete(checkId);
  },
});

export const retry = internalAction({
  args: { checkId: v.id('pendingReleaseChecks') },
  handler: async (ctx, { checkId }) => {
    const check: Doc<'pendingReleaseChecks'> | null = await ctx.runQuery(
      internal.releaseChecks.getLegacyCheck,
      { checkId },
    );
    if (!check) return;

    const details = await ctx.runQuery(internal.subscribers.getSlackDetails, {
      subscriberId: check.subscriberId,
    });

    if (details && check.commentTs) {
      try {
        await chatDeleteMessage(
          details.accessToken,
          check.channelId,
          check.commentTs,
        );
      } catch (error) {
        console.warn(
          'failed to remove legacy Slack enrichment comment:',
          error,
        );
      }
    }

    if (details && check.currentReaction) {
      try {
        await reactionsRemove(
          details.accessToken,
          check.channelId,
          check.messageTs,
          check.currentReaction,
        );
      } catch (error) {
        console.warn(
          'failed to remove legacy Slack enrichment reaction:',
          error,
        );
      }
    }

    await ctx.runMutation(internal.releaseChecks.removeLegacyCheck, {
      checkId,
    });
  },
});
