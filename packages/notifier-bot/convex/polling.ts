import {
  getDependencyStatus,
  getUpdateType,
  getNpmLatestVersion,
  fetchNpmPackageManifest,
  type UpdateType,
  type NpmPackageManifest,
} from '@patch-pulse/shared';
import { internalAction } from './_generated/server';
import { internal } from './_generated/api';
import { Id } from './_generated/dataModel';
import { extractGitHubRepoUrl } from './slack/links';
import { formatUpdateLine } from './slack/format';
import {
  chatPostMessage,
  conversationsFindByName,
  PrivateChannelError,
} from './slack/api';

const UPDATE_TYPE_RANK: Record<UpdateType, number> = {
  patch: 0,
  minor: 1,
  major: 2,
};

function meetsThreshold(
  updateType: UpdateType,
  minUpdateType: UpdateType,
): boolean {
  return UPDATE_TYPE_RANK[updateType] >= UPDATE_TYPE_RANK[minUpdateType];
}

export const checkForUpdates = internalAction({
  args: {},
  handler: async (ctx) => {
    const packages = await ctx.runQuery(internal.packages.getAll);

    // Collect updates: subscriberId → destination key → { lines, subscription stamps to write after send }
    // Key format: "channel:<id>" | "dm:<userId>" | "default" (legacy fallback)
    type PendingPackageInfo = {
      name: string;
      fromVersion: string;
      toVersion: string;
      updateType: UpdateType;
      originalLine: string;
    };
    type DestinationEntry = {
      lines: string[];
      stamps: Array<{
        subscriptionId: Id<'subscriptions'>;
        newVersion: string;
      }>;
      // Lines for packages that had no GitHub URL at send time, keyed by the line string
      pendingByLine: Map<string, PendingPackageInfo>;
    };
    const updatesBySubscriber = new Map<
      Id<'subscribers'>,
      Map<string, DestinationEntry>
    >();

    for (const pkg of packages) {
      let manifest: NpmPackageManifest | undefined;

      try {
        manifest = await fetchNpmPackageManifest(pkg.name, {
          userAgent: 'patch-pulse-notifier-bot',
        });
      } catch {
        console.error(`failed to fetch npm data for ${pkg.name}`);
        continue;
      }

      const version = getNpmLatestVersion(manifest);
      if (!version) continue;

      await ctx.runMutation(internal.packages.touchLastChecked, {
        packageId: pkg._id,
      });

      const { status } = getDependencyStatus({
        packageName: pkg.name,
        currentVersion: pkg.currentVersion,
        latestVersion: version,
      });

      if (status === 'update-available') {
        const updateType = getUpdateType({
          current: pkg.currentVersion,
          latest: version,
        });
        const line = formatUpdateLine(
          pkg.name,
          pkg.currentVersion,
          version,
          updateType,
          manifest,
        );

        await ctx.runMutation(internal.packages.upsertVersion, {
          name: pkg.name,
          version,
          githubRepoUrl: extractGitHubRepoUrl(manifest),
        });

        console.log(
          `updated ${pkg.name} from ${pkg.currentVersion} to ${version}`,
        );

        const subscriptions = await ctx.runQuery(
          internal.subscriptions.getSubscribersOfPackage,
          { packageId: pkg._id },
        );

        for (const sub of subscriptions) {
          const threshold = sub.minUpdateType ?? 'patch';
          if (!meetsThreshold(updateType, threshold)) continue;

          if (!sub.channelId && !sub.userId) continue;
          const key = sub.channelId
            ? `channel:${sub.channelId}`
            : `dm:${sub.userId}`;

          const channelMap =
            updatesBySubscriber.get(sub.subscriberId) ??
            new Map<string, DestinationEntry>();
          const entry =
            channelMap.get(key) ??
            ({
              lines: [] as string[],
              stamps: [] as Array<{
                subscriptionId: Id<'subscriptions'>;
                newVersion: string;
              }>,
              pendingByLine: new Map<string, PendingPackageInfo>(),
            } satisfies DestinationEntry);
          entry.lines.push(line);
          entry.stamps.push({ subscriptionId: sub._id, newVersion: version });
          if (!extractGitHubRepoUrl(manifest)) {
            entry.pendingByLine.set(line, {
              name: pkg.name,
              fromVersion: pkg.currentVersion,
              toVersion: version,
              updateType,
              originalLine: line,
            });
          }
          channelMap.set(key, entry);
          updatesBySubscriber.set(sub.subscriberId, channelMap);
        }
      }
    }

    if (updatesBySubscriber.size === 0) return;

    // Send one message per (subscriber, channel) pair
    for (const [subscriberId, channelMap] of updatesBySubscriber) {
      const subscriber = await ctx.runQuery(internal.subscribers.getById, {
        subscriberId,
      });
      if (!subscriber?.active) continue;

      const details = await ctx.runQuery(internal.subscribers.getSlackDetails, {
        subscriberId,
      });

      if (!details) continue;

      for (const [
        key,
        { lines: updates, stamps, pendingByLine },
      ] of channelMap) {
        const rawTarget = key.startsWith('channel:')
          ? key.slice('channel:'.length)
          : key.slice('dm:'.length);

        // If this is a channel key whose value doesn't look like a Slack channel ID
        // (e.g. it was stored as a name like "new-releases"), resolve it before sending.
        let targetChannel = rawTarget;
        if (
          key.startsWith('channel:') &&
          !/^[CGD][A-Z0-9_]+$/i.test(rawTarget)
        ) {
          let resolved: { id: string; name: string } | null = null;
          try {
            resolved = await conversationsFindByName(
              details.accessToken,
              rawTarget,
            );
          } catch (err) {
            console.warn(`could not look up channel "${rawTarget}":`, err);
            continue;
          }
          if (!resolved) {
            console.warn(
              `channel "${rawTarget}" not found in workspace — skipping`,
            );
            continue;
          }
          targetChannel = resolved.id;
          // Fix all subscriptions for this subscriber that have the bad channel ID
          await ctx.runMutation(internal.subscriptions.fixChannelIds, {
            subscriberId,
            oldChannelId: rawTarget,
            newChannelId: resolved.id,
            newChannelName: resolved.name,
          });
        }

        // Chunk updates into messages under ~3500 chars to stay within Slack's limits
        const SLACK_CHAR_LIMIT = 3500;
        const batches: string[][] = [];
        let batch: string[] = [];
        let batchLen = 0;
        for (const line of updates) {
          if (
            batch.length > 0 &&
            batchLen + line.length + 1 > SLACK_CHAR_LIMIT
          ) {
            batches.push(batch);
            batch = [];
            batchLen = 0;
          }
          batch.push(line);
          batchLen += line.length + 1;
        }
        if (batch.length > 0) batches.push(batch);

        let allBatchesSent = true;
        for (const batchLines of batches) {
          const text =
            `📦 *${updates.length} npm package update${updates.length === 1 ? '' : 's'}*\n\n` +
            batchLines.join('\n');
          let messageTs: string | undefined;
          try {
            ({ ts: messageTs } = await chatPostMessage(
              details.accessToken,
              targetChannel,
              text,
            ));
          } catch (error) {
            allBatchesSent = false;
            if (error instanceof PrivateChannelError) {
              console.warn(
                `skipping private channel ${targetChannel}: bot not invited`,
              );
            } else {
              console.error(`error sending to ${targetChannel}:`, error);
            }
            break;
          }

          // Schedule release-link back-fill for packages that had no GitHub URL
          const batchPending = batchLines
            .filter((l) => pendingByLine.has(l))
            .map((l) => pendingByLine.get(l)!);
          if (batchPending.length > 0 && messageTs) {
            await ctx.runMutation(internal.releaseChecks.create, {
              subscriberId,
              channelId: targetChannel,
              messageTs,
              fullText: text,
              pendingPackages: batchPending,
            });
          }
        }

        if (allBatchesSent && batches.length > 0) {
          for (const { subscriptionId, newVersion } of stamps) {
            await ctx.runMutation(
              internal.subscriptions.updateLastNotifiedVersion,
              {
                subscriptionId,
                version: newVersion,
              },
            );
          }
        }
      }
    }
  },
});
