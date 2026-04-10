import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const getBySubscriber = internalQuery({
  args: { subscriberId: v.id("subscribers") },
  handler: async (ctx, { subscriberId }) => {
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_subscriber", (q) => q.eq("subscriberId", subscriberId))
      .collect();
  },
});

export const getSubscribersOfPackage = internalQuery({
  args: { packageId: v.id("packages") },
  handler: async (ctx, { packageId }) => {
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_package", (q) => q.eq("packageId", packageId))
      .collect();
  },
});

export const getByPackageAndSubscriber = internalQuery({
  args: {
    packageId: v.id("packages"),
    subscriberId: v.id("subscribers"),
  },
  handler: async (ctx, { packageId, subscriberId }) => {
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_package_and_subscriber", (q) =>
        q.eq("packageId", packageId).eq("subscriberId", subscriberId),
      )
      .collect();
  },
});

/**
 * Returns the subscription for a specific (package, subscriber, channel) triple.
 * channelId === undefined matches the default-channel subscription (no explicit channel).
 * Uniqueness is (packageId, subscriberId, channelId) — the same package can be tracked
 * in multiple channels simultaneously.
 */
export const exists = internalQuery({
  args: {
    packageId: v.id("packages"),
    subscriberId: v.id("subscribers"),
    channelId: v.optional(v.string()),
  },
  handler: async (ctx, { packageId, subscriberId, channelId }) => {
    const subs = await ctx.db
      .query("subscriptions")
      .withIndex("by_package_and_subscriber", (q) =>
        q.eq("packageId", packageId).eq("subscriberId", subscriberId),
      )
      .collect();
    return subs.find((s) => s.channelId === channelId) ?? null;
  },
});

export const create = internalMutation({
  args: {
    packageId: v.id("packages"),
    subscriberId: v.id("subscribers"),
    lastNotifiedVersion: v.string(),
    minUpdateType: v.optional(v.union(v.literal("patch"), v.literal("minor"), v.literal("major"))),
    channelId: v.optional(v.string()),
    channelName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("subscriptions", {
      packageId: args.packageId,
      subscriberId: args.subscriberId,
      lastNotifiedVersion: args.lastNotifiedVersion,
      subscriptionDate: Date.now(),
      minUpdateType: args.minUpdateType,
      channelId: args.channelId,
      channelName: args.channelName,
    });
  },
});

/** Removes the subscription for a specific (package, subscriber, channel) triple. */
export const remove = internalMutation({
  args: {
    packageId: v.id("packages"),
    subscriberId: v.id("subscribers"),
    channelId: v.optional(v.string()),
  },
  handler: async (ctx, { packageId, subscriberId, channelId }) => {
    const subs = await ctx.db
      .query("subscriptions")
      .withIndex("by_package_and_subscriber", (q) =>
        q.eq("packageId", packageId).eq("subscriberId", subscriberId),
      )
      .collect();
    for (const sub of subs.filter((s) => s.channelId === channelId)) {
      await ctx.db.delete(sub._id);
    }
  },
});

/** Removes ALL subscriptions for a (package, subscriber) pair across all channels. */
export const removeAll = internalMutation({
  args: {
    packageId: v.id("packages"),
    subscriberId: v.id("subscribers"),
  },
  handler: async (ctx, { packageId, subscriberId }) => {
    const subs = await ctx.db
      .query("subscriptions")
      .withIndex("by_package_and_subscriber", (q) =>
        q.eq("packageId", packageId).eq("subscriberId", subscriberId),
      )
      .collect();
    for (const sub of subs) {
      await ctx.db.delete(sub._id);
    }
  },
});
