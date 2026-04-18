import { type NpmPackageManifest } from '@patch-pulse/shared';
import { getTimeoutMs, withTimeout } from './async';
import { extractGitHubRepoUrl } from './slack/links';

type GitHubRelease = {
  html_url?: string;
  body?: string | null;
  tag_name?: string;
  name?: string | null;
};

type GitHubCompare = {
  html_url?: string;
  commits?: Array<{
    commit?: {
      message?: string;
    };
  }>;
  files?: Array<{
    filename?: string;
  }>;
};

export type ReleaseEvidence = {
  shouldRetry: boolean;
  releaseBody?: string;
  releaseName?: string;
  releaseTag?: string;
  commitTitles: string[];
  changedFiles: string[];
  sourceLinks: Array<{
    label: 'release' | 'compare';
    url: string;
  }>;
};

type GitHubRepoRef = {
  owner: string;
  repo: string;
};
const GITHUB_RELEASE_TIMEOUT_MS = getTimeoutMs(
  'GITHUB_RELEASE_TIMEOUT_MS',
  8_000,
);

function parseGitHubRepoRef(repoUrl: string): GitHubRepoRef | null {
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

function trimText(text: string | null | undefined, maxLength: number): string {
  const normalized = text?.trim();
  if (!normalized) return '';
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 1)}…`;
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

async function fetchGitHubJson<T>(path: string): Promise<T | null> {
  const response = await withTimeout(
    fetch(`https://api.github.com${path}`, {
      headers: buildGitHubHeaders(),
    }),
    {
      label: `GitHub API request (${path})`,
      timeoutMs: GITHUB_RELEASE_TIMEOUT_MS,
    },
  );

  if (response.status === 404) return null;

  if (response.status === 429) {
    console.warn(`GitHub API rate limited for ${path} — will retry later`);
    return null;
  }

  if (!response.ok) {
    throw new Error(`GitHub API error ${response.status} for ${path}`);
  }

  return (await response.json()) as T;
}

function collectCommitTitles(compare: GitHubCompare | null): string[] {
  const titles = new Set<string>();

  for (const commit of compare?.commits ?? []) {
    const title = commit.commit?.message?.split('\n')[0]?.trim();
    if (!title) continue;
    if (title.startsWith('Merge ')) continue;
    titles.add(title);
    if (titles.size >= 8) break;
  }

  return Array.from(titles);
}

function collectChangedFiles(compare: GitHubCompare | null): string[] {
  return (compare?.files ?? [])
    .map((file) => file.filename?.trim())
    .filter((value): value is string => Boolean(value))
    .slice(0, 12);
}

export async function collectReleaseEvidence(
  manifest: NpmPackageManifest,
  fromVersion: string,
  toVersion: string,
): Promise<ReleaseEvidence> {
  const githubRepoUrl = extractGitHubRepoUrl(manifest);
  if (!githubRepoUrl) {
    return {
      shouldRetry: true,
      commitTitles: [],
      changedFiles: [],
      sourceLinks: [],
    };
  }

  const repo = parseGitHubRepoRef(githubRepoUrl);
  if (!repo) {
    return {
      shouldRetry: true,
      commitTitles: [],
      changedFiles: [],
      sourceLinks: [],
    };
  }

  let release: GitHubRelease | null = null;
  for (const tag of normalizeTagCandidates(toVersion)) {
    release = await fetchGitHubJson<GitHubRelease>(
      `/repos/${repo.owner}/${repo.repo}/releases/tags/${encodeURIComponent(tag)}`,
    );
    if (release) break;
  }

  let compare: GitHubCompare | null = null;
  const fromTags = normalizeTagCandidates(fromVersion);
  const toTags = normalizeTagCandidates(toVersion);
  for (const fromTag of fromTags) {
    for (const toTag of toTags) {
      compare = await fetchGitHubJson<GitHubCompare>(
        `/repos/${repo.owner}/${repo.repo}/compare/${encodeURIComponent(fromTag)}...${encodeURIComponent(toTag)}`,
      );
      if (compare) break;
    }
    if (compare) break;
  }

  const releaseBody = trimText(release?.body, 5_000);
  const commitTitles = collectCommitTitles(compare);
  const changedFiles = collectChangedFiles(compare);
  const sourceLinks: ReleaseEvidence['sourceLinks'] = [];

  if (release?.html_url) {
    sourceLinks.push({ label: 'release', url: release.html_url });
  }
  if (compare?.html_url) {
    sourceLinks.push({ label: 'compare', url: compare.html_url });
  }

  const hasSummaryEvidence =
    releaseBody.length >= 40 ||
    commitTitles.length > 0 ||
    changedFiles.length > 0;

  return {
    shouldRetry: !hasSummaryEvidence,
    releaseBody: releaseBody || undefined,
    releaseName: trimText(release?.name, 200) || undefined,
    releaseTag: trimText(release?.tag_name, 80) || undefined,
    commitTitles,
    changedFiles,
    sourceLinks,
  };
}
