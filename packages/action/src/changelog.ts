/** Fetches the GitHub releases URL for a given npm package, or null if unavailable. */
export async function getChangelogUrl(
  packageName: string,
): Promise<string | null> {
  try {
    const response = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`,
    );
    if (!response.ok) return null;

    const manifest = (await response.json()) as Record<string, unknown>;
    const repository = manifest['repository'];

    let repoUrl: string | undefined;
    if (typeof repository === 'string') {
      repoUrl = repository;
    } else if (
      repository &&
      typeof repository === 'object' &&
      'url' in repository
    ) {
      repoUrl = String((repository as Record<string, unknown>)['url']);
    }

    if (!repoUrl) return null;

    // Normalise GitHub URLs in any format (git+https://, git://, shorthand)
    const match = repoUrl.match(/github\.com[/:]([^/\s]+\/[^/.?\s]+)/);
    if (!match) return null;

    return `https://github.com/${match[1]}/releases`;
  } catch {
    return null;
  }
}
