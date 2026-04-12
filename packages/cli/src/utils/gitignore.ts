import { readFileSync } from 'fs';
import { join } from 'path';

export function readGitignorePatterns(rootCwd: string): RegExp[] {
  try {
    const content = readFileSync(join(rootCwd, '.gitignore'), 'utf-8');
    return parseGitignorePatterns(content);
  } catch {
    return [];
  }
}

export function parseGitignorePatterns(content: string): RegExp[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 && !line.startsWith('#') && !line.startsWith('!'),
    )
    .flatMap((pattern) => {
      const regex = gitignorePatternToRegex(pattern);
      return regex ? [regex] : [];
    });
}

export function gitignorePatternToRegex(pattern: string): RegExp | null {
  // Strip trailing slash (only marks directory intent, irrelevant for our traversal)
  let p = pattern.endsWith('/') ? pattern.slice(0, -1) : pattern;

  if (p.length === 0 || p === '**') {
    return null;
  }

  // Strip leading **/ — means "match at any depth", same as an unanchored pattern
  let anchored = false;

  if (p.startsWith('**/')) {
    p = p.slice(3);
  } else if (p.startsWith('/')) {
    // Leading slash anchors the pattern to the root
    p = p.slice(1);
    anchored = true;
  } else if (p.includes('/')) {
    // A slash in the middle also anchors to root
    anchored = true;
  }

  if (p.length === 0) {
    return null;
  }

  // Convert glob syntax to regex, escaping regex special chars first
  const body = p
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex special chars
    .replace(/\*\*/g, '\x00') // temporarily protect **
    .replace(/\*/g, '[^/]*') // * matches within a single segment
    .replace(/\?/g, '[^/]') // ? matches one char within a segment
    .replace(/\x00/g, '.*'); // ** matches across segments

  if (anchored) {
    // Must match from the start of the relative path
    return new RegExp(`^${body}(?:/.*)?$`);
  }

  // Unanchored: can match at the root or after any slash
  return new RegExp(`(?:^|/)${body}(?:/.*)?$`);
}

export function isGitignored(relativePath: string, patterns: RegExp[]): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  return patterns.some((pattern) => pattern.test(normalized));
}
