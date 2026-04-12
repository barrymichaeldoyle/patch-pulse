import { describe, expect, it } from 'vitest';
import {
  gitignorePatternToRegex,
  isGitignored,
  parseGitignorePatterns,
} from '../gitignore';

describe('gitignorePatternToRegex', () => {
  it('returns null for empty pattern', () => {
    expect(gitignorePatternToRegex('')).toBeNull();
    expect(gitignorePatternToRegex('/')).toBeNull();
    expect(gitignorePatternToRegex('**/')).toBeNull();
  });

  describe('unanchored patterns', () => {
    it('matches a directory at the root', () => {
      const re = gitignorePatternToRegex('dist')!;
      expect(re.test('dist')).toBe(true);
    });

    it('matches a directory at any depth', () => {
      const re = gitignorePatternToRegex('dist')!;
      expect(re.test('packages/app/dist')).toBe(true);
      expect(re.test('apps/web/dist')).toBe(true);
    });

    it('does not match a directory that merely contains the pattern name', () => {
      const re = gitignorePatternToRegex('dist')!;
      expect(re.test('distribution')).toBe(false);
      expect(re.test('packages/distribution')).toBe(false);
    });

    it('matches sub-paths inside the ignored directory', () => {
      const re = gitignorePatternToRegex('dist')!;
      expect(re.test('dist/server')).toBe(true);
      expect(re.test('apps/web/dist/server/chunks')).toBe(true);
    });

    it('handles trailing slash (directory marker)', () => {
      const re = gitignorePatternToRegex('dist/')!;
      expect(re.test('dist')).toBe(true);
      expect(re.test('packages/app/dist')).toBe(true);
    });
  });

  describe('anchored patterns', () => {
    it('matches only at the root when pattern starts with /', () => {
      const re = gitignorePatternToRegex('/dist')!;
      expect(re.test('dist')).toBe(true);
      expect(re.test('packages/app/dist')).toBe(false);
    });

    it('matches only at the root when pattern contains a middle slash', () => {
      const re = gitignorePatternToRegex('apps/web')!;
      expect(re.test('apps/web')).toBe(true);
      expect(re.test('packages/apps/web')).toBe(false);
    });

    it('matches sub-paths of an anchored pattern', () => {
      const re = gitignorePatternToRegex('/dist')!;
      expect(re.test('dist/server')).toBe(true);
    });
  });

  describe('**/ prefix patterns', () => {
    it('treats **/ as unanchored', () => {
      const re = gitignorePatternToRegex('**/dist')!;
      expect(re.test('dist')).toBe(true);
      expect(re.test('packages/app/dist')).toBe(true);
    });
  });

  describe('wildcard patterns', () => {
    it('handles * within a segment', () => {
      const re = gitignorePatternToRegex('*.log')!;
      expect(re.test('error.log')).toBe(true);
      expect(re.test('logs/error.log')).toBe(true);
      expect(re.test('error.log.bak')).toBe(false);
    });

    it('handles ? for a single character', () => {
      const re = gitignorePatternToRegex('?.log')!;
      expect(re.test('a.log')).toBe(true);
      expect(re.test('ab.log')).toBe(false);
    });

    it('handles ** across segments', () => {
      const re = gitignorePatternToRegex('apps/**/dist')!;
      expect(re.test('apps/web/dist')).toBe(true);
      expect(re.test('apps/web/nested/dist')).toBe(true);
      expect(re.test('packages/web/dist')).toBe(false);
    });
  });
});

describe('parseGitignorePatterns', () => {
  it('filters out blank lines and comments', () => {
    const patterns = parseGitignorePatterns(`
# build output
dist/
build/

# logs
*.log
`);
    expect(patterns).toHaveLength(3);
  });

  it('filters out negation patterns', () => {
    const patterns = parseGitignorePatterns(`
dist/
!dist/keep-me/
`);
    expect(patterns).toHaveLength(1);
  });
});

describe('isGitignored', () => {
  it('returns false when there are no patterns', () => {
    expect(isGitignored('dist', [])).toBe(false);
  });

  it('returns true when a path matches a pattern', () => {
    const patterns = parseGitignorePatterns('dist/\nbuild/\n.next/');
    expect(isGitignored('dist', patterns)).toBe(true);
    expect(isGitignored('build', patterns)).toBe(true);
    expect(isGitignored('apps/web/.next', patterns)).toBe(true);
  });

  it('returns false when no patterns match', () => {
    const patterns = parseGitignorePatterns('dist/\nbuild/');
    expect(isGitignored('src', patterns)).toBe(false);
    expect(isGitignored('packages/app/src', patterns)).toBe(false);
  });

  it('normalises backslashes on Windows-style paths', () => {
    const patterns = parseGitignorePatterns('dist/');
    expect(isGitignored('packages\\app\\dist', patterns)).toBe(true);
  });
});
