import { type NpmPackageManifest } from '@patch-pulse/shared';

type GitHubRelease = {
  html_url?: string;
};

export function buildNpmPackageUrl(packageName: string): string {
  return `https://www.npmjs.com/package/${packageName}`;
}

export function extractGitHubRepoUrl(
  manifest: NpmPackageManifest,
): string | undefined {
  const repo = manifest.repository;
  let raw: string | undefined;

  if (typeof repo === 'string') {
    raw = repo;
  } else if (repo && typeof repo === 'object' && 'url' in repo) {
    raw = (repo as { url: string }).url;
  }

  if (!raw) return undefined;

  const normalized = raw
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/\.git$/, '')
    .replace(/^github:/, 'https://github.com/');

  return normalized.includes('github.com') ? normalized : undefined;
}

function parseGitHubRepoRef(
  repoUrl: string,
): { owner: string; repo: string } | null {
  try {
    const url = new URL(repoUrl);
    if (url.hostname !== 'github.com') return null;

    const [owner, repo] = url.pathname.split('/').filter(Boolean);
    if (!owner || !repo) return null;

    return { owner, repo };
  } catch {
    return null;
  }
}

function normalizeTagCandidates(version: string): string[] {
  return Array.from(new Set([`v${version}`, version]));
}

function buildGitHubHeaders(): HeadersInit {
  const token = process.env.GITHUB_TOKEN;
  return {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'patch-pulse-notifier-bot',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function fetchGitHubReleaseUrl(
  githubRepoUrl: string,
  version: string,
): Promise<string | undefined> {
  const repo = parseGitHubRepoRef(githubRepoUrl);
  if (!repo) return undefined;

  for (const tag of normalizeTagCandidates(version)) {
    try {
      const response = await fetch(
        `https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/tags/${encodeURIComponent(tag)}`,
        {
          headers: buildGitHubHeaders(),
        },
      );

      if (response.status === 404) continue;
      if (!response.ok) return undefined;

      const release = (await response.json()) as GitHubRelease;
      if (release.html_url) return release.html_url;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

export function formatSlackPackageLink(packageName: string): string {
  return `*<${buildNpmPackageUrl(packageName)}|${packageName}>*`;
}

export function formatSlackVersionText(
  packageName: string,
  version: string,
  manifest: NpmPackageManifest | null | undefined,
  githubRepoUrl?: string,
): string {
  const githubUrl =
    githubRepoUrl ?? (manifest ? extractGitHubRepoUrl(manifest) : undefined);
  return githubUrl ? `<${githubUrl}/releases|${version}>` : version;
}

export async function resolveSlackVersionText(
  version: string,
  manifest: NpmPackageManifest | null | undefined,
  githubRepoUrl?: string,
): Promise<string> {
  const githubUrl =
    githubRepoUrl ?? (manifest ? extractGitHubRepoUrl(manifest) : undefined);

  if (!githubUrl) {
    return `\`${version}\``;
  }

  const releaseUrl = await fetchGitHubReleaseUrl(githubUrl, version);
  return `<${releaseUrl ?? `${githubUrl}/releases`}|${version}>`;
}
