import {
  isVersionOutdated,
  type UpdateType,
  type NpmPackageManifest,
} from '@patch-pulse/shared';
import { extractGitHubRepoUrl } from '../slack/links';

function buildNpmUrl(packageName: string): string {
  return `https://www.npmjs.com/package/${encodeURIComponent(packageName)}`;
}

export function formatDiscordPackageLink(packageName: string): string {
  return `**[\`${packageName}\`](<${buildNpmUrl(packageName)}>)**`;
}

export function formatDiscordVersionText(
  packageName: string,
  version: string,
  githubUrl: string | undefined,
): string {
  const url = githubUrl
    ? `${githubUrl}/releases`
    : `${buildNpmUrl(packageName)}/v/${version}`;
  return `[\`${version}\`](<${url}>)`;
}

function getIntermediateVersions(
  manifest: NpmPackageManifest,
  fromVersion: string,
  toVersion: string,
): string[] {
  return Object.keys(manifest.versions ?? {})
    .filter((v) => {
      if (v.includes('-')) return false;
      const newerThanFrom = isVersionOutdated({
        current: fromVersion,
        latest: v,
      });
      const notNewerThanTo = !isVersionOutdated({
        current: toVersion,
        latest: v,
      });
      return newerThanFrom && notNewerThanTo;
    })
    .sort((a, b) => (isVersionOutdated({ current: a, latest: b }) ? -1 : 1))
    .slice(0, 10);
}

export function formatUpdateLine(
  name: string,
  fromVersion: string,
  toVersion: string,
  updateType: UpdateType,
  manifest: NpmPackageManifest,
): string {
  const githubUrl = extractGitHubRepoUrl(manifest);

  const releaseLinks = githubUrl
    ? getIntermediateVersions(manifest, fromVersion, toVersion).map(
        (v) => `[\`v${v}\`](<${githubUrl}/releases/tag/v${v}>)`,
      )
    : [];

  const suffix =
    releaseLinks.length > 0 ? `\n  ↳ ${releaseLinks.join(' · ')}` : '';

  const packageLink = `**[\`${name}\`](<${buildNpmUrl(name)}>)**`;
  const toVersionText = githubUrl
    ? `[\`${toVersion}\`](<${githubUrl}/releases>)`
    : `\`${toVersion}\``;

  return `• ${packageLink} \`${fromVersion}\` → ${toVersionText} [${updateType}]${suffix}`;
}
