import {
  isVersionOutdated,
  type UpdateType,
  type NpmPackageManifest,
} from '@patch-pulse/shared';
import {
  extractGitHubRepoUrl,
  formatSlackPackageLink,
  formatSlackVersionText,
} from './links';

export function getIntermediateVersions(
  manifest: NpmPackageManifest,
  fromVersion: string,
  toVersion: string,
): string[] {
  return Object.keys(manifest.versions ?? {})
    .filter((v) => {
      if (v.includes('-')) return false;
      const newerThanFrom = isVersionOutdated({ current: fromVersion, latest: v });
      const notNewerThanTo = !isVersionOutdated({ current: toVersion, latest: v });
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
        (v) => `<${githubUrl}/releases/tag/v${v}|v${v}>`,
      )
    : [];

  const suffix =
    releaseLinks.length > 0 ? `\n  ↳ ${releaseLinks.join(' · ')}` : '';

  return (
    `• ${formatSlackPackageLink(name)} ${fromVersion} → ` +
    `${formatSlackVersionText(name, toVersion, null, githubUrl)} [${updateType}]${suffix}`
  );
}
