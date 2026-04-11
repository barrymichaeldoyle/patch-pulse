import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const getByTeamId = internalQuery({
  args: { teamId: v.string() },
  handler: async (ctx, { teamId }) => {
    return await ctx.db
      .query("subscribers")
      .withIndex("by_identifier", (q) => q.eq("identifier", teamId))
      .first();
  },
});

export const getById = internalQuery({
  args: { subscriberId: v.id("subscribers") },
  handler: async (ctx, { subscriberId }) => {
    return await ctx.db.get(subscriberId);
  },
});

export const getSlackDetails = internalQuery({
  args: { subscriberId: v.id("subscribers") },
  handler: async (ctx, { subscriberId }) => {
    return await ctx.db
      .query("slackSubscriberDetails")
      .withIndex("by_subscriber", (q) => q.eq("subscriberId", subscriberId))
      .first();
  },
});

export const upsertSlackWorkspace = internalMutation({
  args: {
    accessToken: v.string(),
    botUserId: v.string(),
    teamId: v.string(),
    teamName: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("subscribers")
      .withIndex("by_identifier", (q) => q.eq("identifier", args.teamId))
      .first();

    if (existing) {
      if (!existing.active) {
        await ctx.db.patch(existing._id, { active: true });
      }

      const details = await ctx.db
        .query("slackSubscriberDetails")
        .withIndex("by_subscriber", (q) => q.eq("subscriberId", existing._id))
        .first();

      if (details) {
        await ctx.db.patch(details._id, {
          accessToken: args.accessToken,
          botUserId: args.botUserId,
          teamName: args.teamName,
        });
      } else {
        await ctx.db.insert("slackSubscriberDetails", {
          subscriberId: existing._id,
          accessToken: args.accessToken,
          botUserId: args.botUserId,
          teamId: args.teamId,
          teamName: args.teamName,
        });
      }

      return existing._id;
    }

    const subscriberId = await ctx.db.insert("subscribers", {
      type: "slack",
      identifier: args.teamId,
      active: true,
    });

    await ctx.db.insert("slackSubscriberDetails", {
      subscriberId,
      accessToken: args.accessToken,
      botUserId: args.botUserId,
      teamId: args.teamId,
      teamName: args.teamName,
    });

    return subscriberId;
  },
});

export const setInactive = internalMutation({
  args: { teamId: v.string() },
  handler: async (ctx, { teamId }) => {
    const subscriber = await ctx.db
      .query("subscribers")
      .withIndex("by_identifier", (q) => q.eq("identifier", teamId))
      .first();

    if (subscriber) {
      await ctx.db.patch(subscriber._id, { active: false });
    }
  },
});
