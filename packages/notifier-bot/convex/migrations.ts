import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';

export const backfillPendingReleaseCheckPackages = internalMutation({
  args: {},
  handler: async (ctx) => {
    const checks = await ctx.db.query('pendingReleaseChecks').collect();
    let migrated = 0;

    for (const check of checks) {
      const existing = await ctx.db
        .query('pendingReleaseCheckPackages')
        .withIndex('by_check_id_and_package_index', (q) =>
          q.eq('checkId', check._id),
        )
        .first();

      if (existing || !check.packages || check.packages.length === 0) {
        continue;
      }

      for (const [packageIndex, pkg] of check.packages.entries()) {
        await ctx.db.insert('pendingReleaseCheckPackages', {
          checkId: check._id,
          packageIndex,
          ...pkg,
        });
      }

      migrated += 1;
    }

    return { migrated };
  },
});

export const verifyPendingReleaseCheckPackagesBackfill = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const checks = await ctx.db.query('pendingReleaseChecks').collect();
    const sampleRemaining: Array<{ checkId: string; packageCount: number }> =
      [];

    for (const check of checks) {
      if (!check.packages || check.packages.length === 0) continue;

      const existing = await ctx.db
        .query('pendingReleaseCheckPackages')
        .withIndex('by_check_id_and_package_index', (q) =>
          q.eq('checkId', check._id),
        )
        .first();

      if (existing) continue;

      sampleRemaining.push({
        checkId: check._id,
        packageCount: check.packages.length,
      });

      if (sampleRemaining.length >= (limit ?? 10)) {
        break;
      }
    }

    return {
      complete: sampleRemaining.length === 0,
      sampleRemaining,
    };
  },
});
