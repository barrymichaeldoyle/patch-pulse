import {
  getDependencyStatus,
  getUpdateType,
  getNpmLatestVersion,
  fetchNpmPackageManifest,
  isVersionOutdated,
  type NpmPackageManifest,
} from "@patch-pulse/shared";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

function extractGitHubUrl(manifest: NpmPackageManifest): string | undefined {
  const repo = manifest.repository;
  let raw: string | undefined;

  if (typeof repo === "string") {
    raw = repo;
  } else if (repo && typeof repo === "object" && "url" in repo) {
    raw = (repo as { url: string }).url;
  }

  if (!raw) return undefined;

  // Normalize git+https://github.com/x/y.git → https://github.com/x/y
  const normalized = raw
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/\.git$/, "")
    .replace(/^github:/, "https://github.com/");

  return normalized.includes("github.com") ? normalized : undefined;
}

/**
 * Returns all stable release versions published between fromVersion (exclusive)
 * and toVersion (inclusive), sorted ascending.
 */
function getIntermediateVersions(
  manifest: NpmPackageManifest,
  fromVersion: string,
  toVersion: string,
): string[] {
  const allVersions = Object.keys(manifest.versions ?? {});

  return allVersions
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
  manifest: NpmPackageManifest,
): string {
  const type = getUpdateType({ current: fromVersion, latest: toVersion });
  const npmUrl = `https://www.npmjs.com/package/${name}`;
  const githubUrl = extractGitHubUrl(manifest);

  const releaseLinks = githubUrl
    ? getIntermediateVersions(manifest, fromVersion, toVersion).map(
        (v) => `<${githubUrl}/releases/tag/v${v}|v${v}>`,
      )
    : [];

  const links = [...releaseLinks, `<${npmUrl}|npm>`].join(" · ");

  return `• *${name}* ${fromVersion} → ${toVersion} [${type}]\n  ↳ ${links}`;
}

export const checkForUpdates = internalAction({
  args: {},
  handler: async (ctx) => {
    const packages = await ctx.runQuery(internal.packages.getAll);

    // Collect updates: subscriberId → list of formatted update lines
    const updatesBySubscriber = new Map<Id<"subscribers">, string[]>();

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
        const line = formatUpdateLine(pkg.name, pkg.currentVersion, version, manifest);

        await ctx.runMutation(internal.packages.upsertVersion, {
          name: pkg.name,
          version,
        });

        console.log(`updated ${pkg.name} from ${pkg.currentVersion} to ${version}`);

        const subscriptions = await ctx.runQuery(
          internal.subscriptions.getSubscribersOfPackage,
          { packageId: pkg._id },
        );

        for (const sub of subscriptions) {
          const existing = updatesBySubscriber.get(sub.subscriberId) ?? [];
          existing.push(line);
          updatesBySubscriber.set(sub.subscriberId, existing);
        }
      }
    }

    if (updatesBySubscriber.size === 0) return;

    // Send one batched message per subscriber
    for (const [subscriberId, updates] of updatesBySubscriber) {
      const details = await ctx.runQuery(internal.subscribers.getSlackDetails, {
        subscriberId,
      });

      if (!details) continue;

      const text =
        `📦 *${updates.length} npm package update${updates.length === 1 ? "" : "s"}*\n\n` +
        updates.join("\n");

      try {
        const response = await fetch(details.webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });

        if (!response.ok) {
          console.error(`failed to notify ${subscriberId}: ${response.statusText}`);
        }
      } catch (error) {
        console.error(`error sending notification to ${subscriberId}:`, error);
      }
    }
  },
});
