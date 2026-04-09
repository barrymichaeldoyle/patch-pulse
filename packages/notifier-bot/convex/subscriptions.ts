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

export const exists = internalQuery({
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
      .first();
  },
});

export const create = internalMutation({
  args: {
    packageId: v.id("packages"),
    subscriberId: v.id("subscribers"),
    lastNotifiedVersion: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("subscriptions", {
      packageId: args.packageId,
      subscriberId: args.subscriberId,
      lastNotifiedVersion: args.lastNotifiedVersion,
      subscriptionDate: Date.now(),
    });
  },
});

export const remove = internalMutation({
  args: {
    packageId: v.id("packages"),
    subscriberId: v.id("subscribers"),
  },
  handler: async (ctx, { packageId, subscriberId }) => {
    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_package_and_subscriber", (q) =>
        q.eq("packageId", packageId).eq("subscriberId", subscriberId),
      )
      .first();

    if (subscription) {
      await ctx.db.delete(subscription._id);
    }
  },
});
