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
    .sort((a, b) => (isVersionOutdated({ current: a, latest: b }) ? -1 : 1));
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

async function chatPostMessage(token: string, channel: string, text: string): Promise<void> {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ channel, text }),
  });

  const data = await response.json();
  if (!data.ok) throw new Error(`Slack error: ${data.error}`);
}

export const checkForUpdates = internalAction({
  args: {},
  handler: async (ctx) => {
    const packages = await ctx.runQuery(internal.packages.getAll);

    // Collect updates: subscriberId → channelId → update lines
    // channelId is undefined when the subscription uses the workspace default channel
    const updatesBySubscriber = new Map<
      Id<"subscribers">,
      Map<string | undefined, string[]>
    >();

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

          const channelMap =
            updatesBySubscriber.get(sub.subscriberId) ?? new Map<string | undefined, string[]>();
          const lines = channelMap.get(sub.channelId) ?? [];
          lines.push(line);
          channelMap.set(sub.channelId, lines);
          updatesBySubscriber.set(sub.subscriberId, channelMap);
        }
      }
    }

    if (updatesBySubscriber.size === 0) return;

    // Send one message per (subscriber, channel) pair
    for (const [subscriberId, channelMap] of updatesBySubscriber) {
      const details = await ctx.runQuery(internal.subscribers.getSlackDetails, {
        subscriberId,
      });

      if (!details) continue;

      for (const [channelId, updates] of channelMap) {
        const targetChannel = channelId ?? details.webhookChannelId;
        const text =
          `📦 *${updates.length} npm package update${updates.length === 1 ? "" : "s"}*\n\n` +
          updates.join("\n");

        try {
          await chatPostMessage(details.accessToken, targetChannel, text);
        } catch (error) {
          console.error(`error sending to ${targetChannel}:`, error);
        }
      }
    }
  },
});
