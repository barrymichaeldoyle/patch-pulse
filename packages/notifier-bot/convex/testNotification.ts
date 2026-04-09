import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  getUpdateType,
  isVersionOutdated,
  fetchNpmPackageManifest,
  getNpmLatestVersion,
  type NpmPackageManifest,
} from "@patch-pulse/shared";

/**
 * Test helper — fetches real npm data and sends a batched update notification.
 * Run from the Convex dashboard: Functions → testNotification → sendBatchedUpdate
 * Delete this file when done testing.
 */

function extractGitHubUrl(manifest: NpmPackageManifest): string | undefined {
  const repo = manifest.repository;
  let raw: string | undefined;

  if (typeof repo === "string") {
    raw = repo;
  } else if (repo && typeof repo === "object" && "url" in repo) {
    raw = (repo as { url: string }).url;
  }

  if (!raw) return undefined;

  const normalized = raw
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/\.git$/, "")
    .replace(/^github:/, "https://github.com/");

  return normalized.includes("github.com") ? normalized : undefined;
}

function getIntermediateVersions(
  manifest: NpmPackageManifest,
  fromVersion: string,
  toVersion: string,
): string[] {
  return Object.keys(manifest.versions ?? {})
    .filter((v) => {
      if (v.includes("-")) return false;
      const newerThanFrom = isVersionOutdated({ current: fromVersion, latest: v });
      const notNewerThanTo = !isVersionOutdated({ current: toVersion, latest: v });
      return newerThanFrom && notNewerThanTo;
    })
    .sort((a, b) => (isVersionOutdated({ current: a, latest: b }) ? -1 : 1));
}

export const sendBatchedUpdate = action({
  args: {
    teamId: v.string(),
    updates: v.array(
      v.object({ name: v.string(), fromVersion: v.string(), toVersion: v.string() }),
    ),
  },
  handler: async (ctx, { teamId, updates }) => {
    const subscriber = await ctx.runQuery(internal.subscribers.getByTeamId, { teamId });
    if (!subscriber) throw new Error(`No subscriber found for teamId: ${teamId}`);

    const details = await ctx.runQuery(internal.subscribers.getSlackDetails, {
      subscriberId: subscriber._id,
    });
    if (!details) throw new Error(`No Slack details found for teamId: ${teamId}`);

    const lines = await Promise.all(
      updates.map(async (u) => {
        const type = getUpdateType({ current: u.fromVersion, latest: u.toVersion });
        const npmUrl = `https://www.npmjs.com/package/${u.name}`;

        let releaseLinks: string[] = [];
        try {
          const manifest = await fetchNpmPackageManifest(u.name, {
            userAgent: "patch-pulse-notifier-bot",
          });
          const githubUrl = extractGitHubUrl(manifest);
          if (githubUrl) {
            releaseLinks = getIntermediateVersions(manifest, u.fromVersion, u.toVersion).map(
              (v) => `<${githubUrl}/releases/tag/v${v}|v${v}>`,
            );
          }
        } catch {
          // fall through without release links
        }

        const links = [...releaseLinks, `<${npmUrl}|npm>`].join(" · ");
        return `• *${u.name}* ${u.fromVersion} → ${u.toVersion} [${type}]\n  ↳ ${links}`;
      }),
    );

    const text =
      `📦 *${lines.length} npm package update${lines.length === 1 ? "" : "s"}*\n\n` +
      lines.join("\n");

    const response = await fetch(details.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      throw new Error(`Slack returned ${response.status}: ${response.statusText}`);
    }

    return { ok: true, message: text };
  },
});
