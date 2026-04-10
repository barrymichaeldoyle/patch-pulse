import { type NpmPackageManifest } from "@patch-pulse/shared";

export function buildNpmPackageUrl(packageName: string): string {
  return `https://www.npmjs.com/package/${packageName}`;
}

export function extractGitHubRepoUrl(manifest: NpmPackageManifest): string | undefined {
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

export function buildVersionUrl(
  packageName: string,
  manifest: NpmPackageManifest | null | undefined,
  githubRepoUrl?: string,
): string {
  const githubUrl = githubRepoUrl ?? (manifest ? extractGitHubRepoUrl(manifest) : undefined);
  return githubUrl ? `${githubUrl}/releases` : buildNpmPackageUrl(packageName);
}

export function formatSlackPackageLink(packageName: string): string {
  return `*<${buildNpmPackageUrl(packageName)}|${packageName}>*`;
}

export function formatSlackVersionLink(
  packageName: string,
  version: string,
  manifest: NpmPackageManifest | null | undefined,
  githubRepoUrl?: string,
): string {
  return `<${buildVersionUrl(packageName, manifest, githubRepoUrl)}|${version}>`;
}

export function formatSlackVersionText(
  packageName: string,
  version: string,
  manifest: NpmPackageManifest | null | undefined,
  githubRepoUrl?: string,
): string {
  const githubUrl = githubRepoUrl ?? (manifest ? extractGitHubRepoUrl(manifest) : undefined);
  return githubUrl ? `<${githubUrl}/releases|${version}>` : version;
}
