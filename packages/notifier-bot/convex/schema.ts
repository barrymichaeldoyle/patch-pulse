import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  packages: defineTable({
    name: v.string(),
    currentVersion: v.string(),
    ecosystem: v.string(),
    lastChecked: v.optional(v.number()),
    githubRepoUrl: v.optional(v.string()),
  }).index("by_name", ["name"]),

  subscribers: defineTable({
    type: v.string(), // "slack" | "discord"
    identifier: v.string(), // Slack team_id
    active: v.boolean(),
  }).index("by_identifier", ["identifier"]),

  slackSubscriberDetails: defineTable({
    subscriberId: v.id("subscribers"),
    accessToken: v.string(),
    botUserId: v.string(),
    teamId: v.string(),
    teamName: v.string(),
  })
    .index("by_subscriber", ["subscriberId"])
    .index("by_team_id", ["teamId"]),

  subscriptions: defineTable({
    packageId: v.id("packages"),
    subscriberId: v.id("subscribers"),
    lastNotifiedVersion: v.string(),
    subscriptionDate: v.number(),
    minUpdateType: v.optional(v.union(v.literal("patch"), v.literal("minor"), v.literal("major"))),
    channelId: v.optional(v.string()),   // Slack channel ID — set for channel subscriptions
    channelName: v.optional(v.string()), // Human-readable channel name (e.g. frontend)
    userId: v.optional(v.string()),      // Slack user ID — set for DM subscriptions (no channelId)
  })
    .index("by_package", ["packageId"])
    .index("by_subscriber", ["subscriberId"])
    .index("by_package_and_subscriber", ["packageId", "subscriberId"])
    .index("by_package_subscriber_user", ["packageId", "subscriberId", "userId"]),

});
