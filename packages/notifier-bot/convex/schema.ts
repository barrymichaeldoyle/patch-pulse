import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import {
  pendingPackageValidator,
  pendingPackageFields,
} from './releaseCheckState';

export default defineSchema({
  packages: defineTable({
    name: v.string(),
    currentVersion: v.string(),
    ecosystem: v.string(),
    lastChecked: v.optional(v.number()),
    githubRepoUrl: v.optional(v.string()),
  })
    .index('by_name', ['name'])
    .index('by_last_checked', ['lastChecked']),

  subscribers: defineTable({
    type: v.string(), // "slack" | "discord"
    identifier: v.string(), // Slack team_id
    active: v.boolean(),
  }).index('by_identifier', ['identifier']),

  discordSubscriberDetails: defineTable({
    subscriberId: v.id('subscribers'),
    guildId: v.string(),
    guildName: v.string(),
  })
    .index('by_subscriber', ['subscriberId'])
    .index('by_guild_id', ['guildId']),

  slackSubscriberDetails: defineTable({
    subscriberId: v.id('subscribers'),
    accessToken: v.string(),
    botUserId: v.string(),
    teamId: v.string(),
    teamName: v.string(),
  })
    .index('by_subscriber', ['subscriberId'])
    .index('by_team_id', ['teamId']),

  pendingReleaseChecks: defineTable({
    subscriberId: v.id('subscribers'),
    channelId: v.string(),
    messageTs: v.string(),
    fullText: v.string(),
    retryCount: v.number(),
    commentTs: v.optional(v.string()),
    currentReaction: v.optional(v.string()),
    // Deprecated storage for older records; new writes use pendingReleaseCheckPackages.
    packages: v.optional(v.array(pendingPackageValidator)),
  }),

  pendingReleaseCheckPackages: defineTable({
    checkId: v.id('pendingReleaseChecks'),
    packageIndex: v.number(),
    ...pendingPackageFields,
  }).index('by_check_id_and_package_index', ['checkId', 'packageIndex']),

  subscriptions: defineTable({
    packageId: v.id('packages'),
    subscriberId: v.id('subscribers'),
    lastNotifiedVersion: v.string(),
    subscriptionDate: v.number(),
    minUpdateType: v.optional(
      v.union(v.literal('patch'), v.literal('minor'), v.literal('major')),
    ),
    channelId: v.optional(v.string()), // Slack channel ID — set for channel subscriptions
    channelName: v.optional(v.string()), // Human-readable channel name (e.g. frontend)
    userId: v.optional(v.string()), // Slack user ID — set for DM subscriptions (no channelId)
  })
    .index('by_subscriber', ['subscriberId'])
    .index('by_package_and_subscriber', ['packageId', 'subscriberId'])
    .index('by_package_subscriber_channel', [
      'packageId',
      'subscriberId',
      'channelId',
    ])
    .index('by_package_subscriber_user', [
      'packageId',
      'subscriberId',
      'userId',
    ]),
});
