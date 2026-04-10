import {
  getDependencyStatus,
  getUpdateType,
  getNpmLatestVersion,
  fetchNpmPackageManifest,
  isVersionOutdated,
  type UpdateType,
  type NpmPackageManifest,
} from "@patch-pulse/shared";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import {
  buildNpmPackageUrl,
  extractGitHubRepoUrl,
  formatSlackPackageLink,
  formatSlackVersionLink,
} from "./slack/links";
import { chatPostMessage, PrivateChannelError } from "./slack/api";

const UPDATE_TYPE_RANK: Record<UpdateType, number> = { patch: 0, minor: 1, major: 2 };

function meetsThreshold(updateType: UpdateType, minUpdateType: UpdateType): boolean {
  return UPDATE_TYPE_RANK[updateType] >= UPDATE_TYPE_RANK[minUpdateType];
}

function getIntermediateVersions(
  manifest: NpmPackageManifest,
  fromVersion: string,
  toVersion: string,
): string[] {
  return Object.keys(manifest.versions ?? {})
    .filter((v) => {
      if (v.includes("-")) return false; // skip pre-releases (alpha, beta, rc)
      const newerThanFrom = isVersionOutdated({ current: fromVersion, latest: v });
      const notNewerThanTo = !isVersionOutdated({ current: toVersion, latest: v });
      return newerThanFrom && notNewerThanTo;
    })
    .sort((a, b) => (isVersionOutdated({ current: a, latest: b }) ? -1 : 1))
    .slice(0, 10);
}

function formatUpdateLine(
  name: string,
  fromVersion: string,
  toVersion: string,
  updateType: UpdateType,
  manifest: NpmPackageManifest,
): string {
  const npmUrl = buildNpmPackageUrl(name);
  const githubUrl = extractGitHubRepoUrl(manifest);

  const releaseLinks = githubUrl
    ? getIntermediateVersions(manifest, fromVersion, toVersion).map(
        (v) => `<${githubUrl}/releases/tag/v${v}|v${v}>`,
      )
    : [];

  const links = [...releaseLinks, `<${npmUrl}|npm>`].join(" · ");

  return (
    `• ${formatSlackPackageLink(name)} ${fromVersion} → ` +
    `${formatSlackVersionLink(name, toVersion, manifest)} [${updateType}]\n  ↳ ${links}`
  );
}

export const checkForUpdates = internalAction({
  args: {},
  handler: async (ctx) => {
    const packages = await ctx.runQuery(internal.packages.getAll);

    // Collect updates: subscriberId → destination key → { lines, subscription stamps to write after send }
    // Key format: "channel:<id>" | "dm:<userId>" | "default" (legacy fallback)
    type DestinationEntry = {
      lines: string[];
      stamps: Array<{ subscriptionId: Id<"subscriptions">; newVersion: string }>;
    };
    const updatesBySubscriber = new Map<Id<"subscribers">, Map<string, DestinationEntry>>();

    for (const pkg of packages) {
      let manifest: NpmPackageManifest | undefined;

      try {
        manifest = await fetchNpmPackageManifest(pkg.name, {
          userAgent: "patch-pulse-notifier-bot",
        });
      } catch {
        console.error(`failed to fetch npm data for ${pkg.name}`);
        continue;
      }

      const version = getNpmLatestVersion(manifest);
      if (!version) continue;

      const { status } = getDependencyStatus({
        packageName: pkg.name,
        currentVersion: pkg.currentVersion,
        latestVersion: version,
      });

      if (status === "update-available") {
        const updateType = getUpdateType({ current: pkg.currentVersion, latest: version });
        const line = formatUpdateLine(pkg.name, pkg.currentVersion, version, updateType, manifest);

        await ctx.runMutation(internal.packages.upsertVersion, {
          name: pkg.name,
          version,
          githubRepoUrl: extractGitHubRepoUrl(manifest),
        });

        console.log(`updated ${pkg.name} from ${pkg.currentVersion} to ${version}`);

        const subscriptions = await ctx.runQuery(
          internal.subscriptions.getSubscribersOfPackage,
          { packageId: pkg._id },
        );

        for (const sub of subscriptions) {
          const threshold = sub.minUpdateType ?? "patch";
          if (!meetsThreshold(updateType, threshold)) continue;

          if (!sub.channelId && !sub.userId) continue;
          const key = sub.channelId ? `channel:${sub.channelId}` : `dm:${sub.userId}`;

          const channelMap = updatesBySubscriber.get(sub.subscriberId) ?? new Map<string, DestinationEntry>();
          const entry = channelMap.get(key) ?? { lines: [], stamps: [] };
          entry.lines.push(line);
          entry.stamps.push({ subscriptionId: sub._id, newVersion: version });
          channelMap.set(key, entry);
          updatesBySubscriber.set(sub.subscriberId, channelMap);
        }
      }
    }

    if (updatesBySubscriber.size === 0) return;

    // Send one message per (subscriber, channel) pair
    for (const [subscriberId, channelMap] of updatesBySubscriber) {
      const subscriber = await ctx.runQuery(internal.subscribers.getById, { subscriberId });
      if (!subscriber?.active) continue;

      const details = await ctx.runQuery(internal.subscribers.getSlackDetails, {
        subscriberId,
      });

      if (!details) continue;

      for (const [key, { lines: updates, stamps }] of channelMap) {
        const targetChannel = key.startsWith("channel:")
          ? key.slice("channel:".length)
          : key.slice("dm:".length);

        // Chunk updates into messages under ~3500 chars to stay within Slack's limits
        const SLACK_CHAR_LIMIT = 3500;
        const batches: string[][] = [];
        let batch: string[] = [];
        let batchLen = 0;
        for (const line of updates) {
          if (batch.length > 0 && batchLen + line.length + 1 > SLACK_CHAR_LIMIT) {
            batches.push(batch);
            batch = [];
            batchLen = 0;
          }
          batch.push(line);
          batchLen += line.length + 1;
        }
        if (batch.length > 0) batches.push(batch);

        let sent = false;
        for (const batchLines of batches) {
          const text =
            `📦 *${updates.length} npm package update${updates.length === 1 ? "" : "s"}*\n\n` +
            batchLines.join("\n");
          try {
            await chatPostMessage(details.accessToken, targetChannel, text);
            sent = true;
          } catch (error) {
            if (error instanceof PrivateChannelError) {
              console.warn(`skipping private channel ${targetChannel}: bot not invited`);
            } else {
              console.error(`error sending to ${targetChannel}:`, error);
            }
            break;
          }
        }

        if (sent) {
          for (const { subscriptionId, newVersion } of stamps) {
            await ctx.runMutation(internal.subscriptions.updateLastNotifiedVersion, {
              subscriptionId,
              version: newVersion,
            });
          }
        }
      }
    }
  },
});
