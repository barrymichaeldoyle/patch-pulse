import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  packages: defineTable({
    name: v.string(),
    currentVersion: v.string(),
    ecosystem: v.string(),
    lastChecked: v.optional(v.number()),
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
    webhookUrl: v.string(),
    webhookChannel: v.string(),
    webhookChannelId: v.string(),
    webhookConfigurationUrl: v.optional(v.string()),
  })
    .index("by_subscriber", ["subscriberId"])
    .index("by_team_id", ["teamId"]),

  subscriptions: defineTable({
    packageId: v.id("packages"),
    subscriberId: v.id("subscribers"),
    lastNotifiedVersion: v.string(),
    subscriptionDate: v.number(),
  })
    .index("by_package", ["packageId"])
    .index("by_subscriber", ["subscriberId"])
    .index("by_package_and_subscriber", ["packageId", "subscriberId"]),

});
