import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';

export const getAll = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query('packages').collect();
  },
});

export const getDueForCheck = internalQuery({
  args: {
    beforeTs: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, { beforeTs, limit }) => {
    const due = await ctx.db
      .query('packages')
      .withIndex('by_last_checked', (q) => q.lt('lastChecked', beforeTs))
      .take(limit);

    if (due.length >= limit) {
      return due;
    }

    // Legacy fallback for packages created before lastChecked existed.
    const neverChecked = await ctx.db
      .query('packages')
      .filter((q) => q.eq(q.field('lastChecked'), undefined))
      .take(limit - due.length);

    return [...due, ...neverChecked];
  },
});

export const getByName = internalQuery({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    return await ctx.db
      .query('packages')
      .withIndex('by_name', (q) => q.eq('name', name))
      .first();
  },
});

export const upsertVersion = internalMutation({
  args: {
    name: v.string(),
    version: v.string(),
    ecosystem: v.optional(v.string()),
    githubRepoUrl: v.optional(v.string()),
    checkedAt: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { name, version, ecosystem, githubRepoUrl, checkedAt },
  ) => {
    const timestamp = checkedAt ?? Date.now();
    const existing = await ctx.db
      .query('packages')
      .withIndex('by_name', (q) => q.eq('name', name))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        currentVersion: version,
        lastChecked: timestamp,
        githubRepoUrl,
      });
      return existing._id;
    }

    return await ctx.db.insert('packages', {
      name,
      currentVersion: version,
      ecosystem: ecosystem ?? 'npm',
      lastChecked: timestamp,
      githubRepoUrl,
    });
  },
});

/**
 * Inserts the package if it doesn't exist yet; returns the ID and current DB version.
 * Unlike upsertVersion, does NOT advance currentVersion on existing packages —
 * that is polling's job, so existing subscribers don't miss the notification.
 */
export const ensureExists = internalMutation({
  args: {
    name: v.string(),
    version: v.string(),
    ecosystem: v.optional(v.string()),
    githubRepoUrl: v.optional(v.string()),
  },
  handler: async (ctx, { name, version, ecosystem, githubRepoUrl }) => {
    const existing = await ctx.db
      .query('packages')
      .withIndex('by_name', (q) => q.eq('name', name))
      .first();

    if (existing) {
      if (githubRepoUrl && existing.githubRepoUrl !== githubRepoUrl) {
        await ctx.db.patch(existing._id, { githubRepoUrl });
      }
      return { packageId: existing._id, dbVersion: existing.currentVersion };
    }

    const packageId = await ctx.db.insert('packages', {
      name,
      currentVersion: version,
      ecosystem: ecosystem ?? 'npm',
      lastChecked: Date.now(),
      githubRepoUrl,
    });

    return { packageId, dbVersion: version };
  },
});

export const touchLastChecked = internalMutation({
  args: {
    packageId: v.id('packages'),
    checkedAt: v.optional(v.number()),
  },
  handler: async (ctx, { packageId, checkedAt }) => {
    await ctx.db.patch(packageId, { lastChecked: checkedAt ?? Date.now() });
  },
});

export const getByIds = internalQuery({
  args: { ids: v.array(v.id('packages')) },
  handler: async (ctx, { ids }) => {
    return await Promise.all(ids.map((id) => ctx.db.get(id)));
  },
});
