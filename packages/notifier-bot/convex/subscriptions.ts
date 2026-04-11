import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';

export const getById = internalQuery({
  args: { subscriptionId: v.id('subscriptions') },
  handler: async (ctx, { subscriptionId }) => ctx.db.get(subscriptionId),
});

export const getBySubscriber = internalQuery({
  args: { subscriberId: v.id('subscribers') },
  handler: async (ctx, { subscriberId }) => {
    return await ctx.db
      .query('subscriptions')
      .withIndex('by_subscriber', (q) => q.eq('subscriberId', subscriberId))
      .collect();
  },
});

export const getSubscribersOfPackage = internalQuery({
  args: { packageId: v.id('packages') },
  handler: async (ctx, { packageId }) => {
    return await ctx.db
      .query('subscriptions')
      .withIndex('by_package', (q) => q.eq('packageId', packageId))
      .collect();
  },
});

export const getByPackageAndSubscriber = internalQuery({
  args: {
    packageId: v.id('packages'),
    subscriberId: v.id('subscribers'),
  },
  handler: async (ctx, { packageId, subscriberId }) => {
    return await ctx.db
      .query('subscriptions')
      .withIndex('by_package_and_subscriber', (q) =>
        q.eq('packageId', packageId).eq('subscriberId', subscriberId),
      )
      .collect();
  },
});

/**
 * Looks up a subscription by its natural key:
 * - channelId provided → channel subscription: unique by (packageId, subscriberId, channelId)
 * - userId provided    → DM subscription: unique by (packageId, subscriberId, userId)
 * - neither            → legacy default-channel subscription
 */
export const exists = internalQuery({
  args: {
    packageId: v.id('packages'),
    subscriberId: v.id('subscribers'),
    channelId: v.optional(v.string()),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, { packageId, subscriberId, channelId, userId }) => {
    if (channelId) {
      const subs = await ctx.db
        .query('subscriptions')
        .withIndex('by_package_and_subscriber', (q) =>
          q.eq('packageId', packageId).eq('subscriberId', subscriberId),
        )
        .collect();
      return subs.find((s) => s.channelId === channelId) ?? null;
    }

    return (
      (await ctx.db
        .query('subscriptions')
        .withIndex('by_package_subscriber_user', (q) =>
          q
            .eq('packageId', packageId)
            .eq('subscriberId', subscriberId)
            .eq('userId', userId),
        )
        .first()) ?? null
    );
  },
});

export const create = internalMutation({
  args: {
    packageId: v.id('packages'),
    subscriberId: v.id('subscribers'),
    lastNotifiedVersion: v.string(),
    minUpdateType: v.optional(
      v.union(v.literal('patch'), v.literal('minor'), v.literal('major')),
    ),
    channelId: v.optional(v.string()),
    channelName: v.optional(v.string()),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('subscriptions', {
      packageId: args.packageId,
      subscriberId: args.subscriberId,
      lastNotifiedVersion: args.lastNotifiedVersion,
      subscriptionDate: Date.now(),
      minUpdateType: args.minUpdateType,
      channelId: args.channelId,
      channelName: args.channelName,
      userId: args.userId,
    });
  },
});

/**
 * Removes a subscription by its natural key (mirrors `exists`).
 * - channelId provided → remove that channel subscription
 * - userId provided    → remove that user's DM subscription
 * - neither            → remove legacy default-channel subscription
 */
export const remove = internalMutation({
  args: {
    packageId: v.id('packages'),
    subscriberId: v.id('subscribers'),
    channelId: v.optional(v.string()),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, { packageId, subscriberId, channelId, userId }) => {
    if (channelId) {
      const subs = await ctx.db
        .query('subscriptions')
        .withIndex('by_package_and_subscriber', (q) =>
          q.eq('packageId', packageId).eq('subscriberId', subscriberId),
        )
        .collect();
      for (const sub of subs.filter((s) => s.channelId === channelId)) {
        await ctx.db.delete(sub._id);
      }
      return;
    }

    const sub = await ctx.db
      .query('subscriptions')
      .withIndex('by_package_subscriber_user', (q) =>
        q
          .eq('packageId', packageId)
          .eq('subscriberId', subscriberId)
          .eq('userId', userId),
      )
      .first();
    if (sub) await ctx.db.delete(sub._id);
  },
});

export const updateLastNotifiedVersion = internalMutation({
  args: {
    subscriptionId: v.id('subscriptions'),
    version: v.string(),
  },
  handler: async (ctx, { subscriptionId, version }) => {
    await ctx.db.patch(subscriptionId, { lastNotifiedVersion: version });
  },
});

export const updateMinUpdateType = internalMutation({
  args: {
    subscriptionId: v.id('subscriptions'),
    minUpdateType: v.union(
      v.literal('patch'),
      v.literal('minor'),
      v.literal('major'),
    ),
  },
  handler: async (ctx, { subscriptionId, minUpdateType }) => {
    await ctx.db.patch(subscriptionId, { minUpdateType });
  },
});

export const updateChannelName = internalMutation({
  args: {
    subscriptionId: v.id('subscriptions'),
    channelName: v.string(),
  },
  handler: async (ctx, { subscriptionId, channelName }) => {
    await ctx.db.patch(subscriptionId, { channelName });
  },
});

/** Fixes subscriptions where channelId was stored as a channel name instead of a Slack channel ID. */
export const fixChannelIds = internalMutation({
  args: {
    subscriberId: v.id('subscribers'),
    oldChannelId: v.string(),
    newChannelId: v.string(),
    newChannelName: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { subscriberId, oldChannelId, newChannelId, newChannelName },
  ) => {
    const subs = await ctx.db
      .query('subscriptions')
      .withIndex('by_subscriber', (q) => q.eq('subscriberId', subscriberId))
      .collect();
    for (const sub of subs) {
      if (sub.channelId === oldChannelId) {
        await ctx.db.patch(sub._id, {
          channelId: newChannelId,
          ...(newChannelName !== undefined
            ? { channelName: newChannelName }
            : {}),
        });
      }
    }
  },
});
