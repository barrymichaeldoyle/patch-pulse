import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { Id } from "./_generated/dataModel";

/**
 * One-time migration from Supabase. Delete this file after running.
 * Run with: npx convex run migration:seed '{...}'
 */
export const seed = internalMutation({
  args: {
    packages: v.array(
      v.object({
        supabaseId: v.string(),
        name: v.string(),
        currentVersion: v.string(),
        ecosystem: v.string(),
        lastChecked: v.optional(v.number()),
      }),
    ),
    subscribers: v.array(
      v.object({
        supabaseId: v.string(),
        type: v.string(),
        identifier: v.string(),
        active: v.boolean(),
      }),
    ),
    slackDetails: v.array(
      v.object({
        subscriberSupabaseId: v.string(),
        accessToken: v.string(),
        botUserId: v.string(),
        teamId: v.string(),
        teamName: v.string(),
        webhookUrl: v.string(),
        webhookChannel: v.string(),
        webhookChannelId: v.string(),
        webhookConfigurationUrl: v.optional(v.string()),
      }),
    ),
    subscriptions: v.array(
      v.object({
        packageSupabaseId: v.string(),
        subscriberSupabaseId: v.string(),
        lastNotifiedVersion: v.string(),
        subscriptionDate: v.number(),
      }),
    ),
  },
  handler: async (ctx, { packages, subscribers, slackDetails, subscriptions }) => {
    const packageIdMap = new Map<string, Id<"packages">>();
    const subscriberIdMap = new Map<string, Id<"subscribers">>();

    for (const pkg of packages) {
      const id = await ctx.db.insert("packages", {
        name: pkg.name,
        currentVersion: pkg.currentVersion,
        ecosystem: pkg.ecosystem,
        lastChecked: pkg.lastChecked,
      });
      packageIdMap.set(pkg.supabaseId, id);
    }

    for (const sub of subscribers) {
      const id = await ctx.db.insert("subscribers", {
        type: sub.type,
        identifier: sub.identifier,
        active: sub.active,
      });
      subscriberIdMap.set(sub.supabaseId, id);
    }

    for (const detail of slackDetails) {
      const subscriberId = subscriberIdMap.get(detail.subscriberSupabaseId);
      if (!subscriberId) {
        console.warn(`no Convex subscriber found for Supabase ID ${detail.subscriberSupabaseId}, skipping`);
        continue;
      }
      await ctx.db.insert("slackSubscriberDetails", {
        subscriberId,
        accessToken: detail.accessToken,
        botUserId: detail.botUserId,
        teamId: detail.teamId,
        teamName: detail.teamName,
        webhookUrl: detail.webhookUrl,
        webhookChannel: detail.webhookChannel,
        webhookChannelId: detail.webhookChannelId,
        webhookConfigurationUrl: detail.webhookConfigurationUrl,
      });
    }

    for (const sub of subscriptions) {
      const packageId = packageIdMap.get(sub.packageSupabaseId);
      const subscriberId = subscriberIdMap.get(sub.subscriberSupabaseId);
      if (!packageId || !subscriberId) {
        console.warn(`missing ID mapping for subscription, skipping`);
        continue;
      }
      await ctx.db.insert("subscriptions", {
        packageId,
        subscriberId,
        lastNotifiedVersion: sub.lastNotifiedVersion,
        subscriptionDate: sub.subscriptionDate,
      });
    }

    return {
      packages: packageIdMap.size,
      subscribers: subscriberIdMap.size,
      slackDetails: slackDetails.length,
      subscriptions: subscriptions.length,
    };
  },
});
