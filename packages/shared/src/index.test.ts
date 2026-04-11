import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PackageVersionCache,
  checkNpmDependencyStatuses,
  createDependencyCheckResult,
  fetchNpmLatestVersionCached,
  fetchNpmPackageManifest,
  getAllDependencyNames,
  getDependencySections,
  getDependencyStatus,
  getDependencyVersion,
  getNpmLatestVersion,
  getUpdateType,
  hasWildcardPrefix,
  isVersionOutdated,
  PACKAGE_JSON_DEPENDENCY_FIELDS,
  parseVersion,
  preserveWildcardPrefix,
} from './index';

// ---------------------------------------------------------------------------
// parseVersion
// ---------------------------------------------------------------------------

describe('parseVersion', () => {
  it('parses a plain version', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it.each(['^', '~', '>=', '>', '<=', '<'])('strips %s prefix', (prefix) => {
    expect(parseVersion(`${prefix}1.2.3`)).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
    });
  });

  it('parses zeros', () => {
    expect(parseVersion('0.0.0')).toEqual({ major: 0, minor: 0, patch: 0 });
  });

  it('throws on invalid version', () => {
    expect(() => parseVersion('not-a-version')).toThrow(
      'Invalid version format',
    );
  });
});

// ---------------------------------------------------------------------------
// hasWildcardPrefix
// ---------------------------------------------------------------------------

describe('hasWildcardPrefix', () => {
  it.each(['^1.0.0', '~1.0.0', '>=1.0.0', '>1.0.0'])(
    'returns true for %s',
    (v) => {
      expect(hasWildcardPrefix(v)).toBe(true);
    },
  );

  it('returns false for a plain version', () => {
    expect(hasWildcardPrefix('1.0.0')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// preserveWildcardPrefix
// ---------------------------------------------------------------------------

describe('preserveWildcardPrefix', () => {
  it('preserves ^ prefix', () => {
    expect(preserveWildcardPrefix('^1.0.0', '2.0.0')).toBe('^2.0.0');
  });

  it('preserves ~ prefix', () => {
    expect(preserveWildcardPrefix('~1.0.0', '1.1.0')).toBe('~1.1.0');
  });

  it('preserves >= prefix', () => {
    expect(preserveWildcardPrefix('>=1.0.0', '2.0.0')).toBe('>=2.0.0');
  });

  it('returns plain version when no prefix', () => {
    expect(preserveWildcardPrefix('1.0.0', '2.0.0')).toBe('2.0.0');
  });
});

// ---------------------------------------------------------------------------
// isVersionOutdated
// ---------------------------------------------------------------------------

describe('isVersionOutdated', () => {
  it('returns false when versions are equal', () => {
    expect(isVersionOutdated({ current: '1.0.0', latest: '1.0.0' })).toBe(
      false,
    );
  });

  it('returns true for a major bump', () => {
    expect(isVersionOutdated({ current: '1.0.0', latest: '2.0.0' })).toBe(true);
  });

  it('returns true for a minor bump', () => {
    expect(isVersionOutdated({ current: '1.0.0', latest: '1.1.0' })).toBe(true);
  });

  it('returns true for a patch bump', () => {
    expect(isVersionOutdated({ current: '1.0.0', latest: '1.0.1' })).toBe(true);
  });

  it('returns false when current is ahead', () => {
    expect(isVersionOutdated({ current: '2.0.0', latest: '1.0.0' })).toBe(
      false,
    );
  });

  it('returns false on invalid version instead of throwing', () => {
    expect(isVersionOutdated({ current: 'invalid', latest: '1.0.0' })).toBe(
      false,
    );
  });

  it('handles wildcard prefixes', () => {
    expect(isVersionOutdated({ current: '^1.0.0', latest: '1.1.0' })).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// getUpdateType
// ---------------------------------------------------------------------------

describe('getUpdateType', () => {
  it('detects major', () => {
    expect(getUpdateType({ current: '1.0.0', latest: '2.0.0' })).toBe('major');
  });

  it('detects minor', () => {
    expect(getUpdateType({ current: '1.0.0', latest: '1.1.0' })).toBe('minor');
  });

  it('detects patch', () => {
    expect(getUpdateType({ current: '1.0.0', latest: '1.0.1' })).toBe('patch');
  });

  it('returns patch on invalid version instead of throwing', () => {
    expect(getUpdateType({ current: 'invalid', latest: '1.0.0' })).toBe(
      'patch',
    );
  });
});

// ---------------------------------------------------------------------------
// getDependencySections
// ---------------------------------------------------------------------------

describe('getDependencySections', () => {
  it('returns empty object for null', () => {
    expect(getDependencySections(null)).toEqual({});
  });

  it('returns empty object for undefined', () => {
    expect(getDependencySections(undefined)).toEqual({});
  });

  it('returns only sections that are present', () => {
    const result = getDependencySections({
      dependencies: { react: '18.0.0' },
      devDependencies: { typescript: '6.0.0' },
    });
    expect(result).toEqual({
      dependencies: { react: '18.0.0' },
      devDependencies: { typescript: '6.0.0' },
    });
    expect(result).not.toHaveProperty('peerDependencies');
    expect(result).not.toHaveProperty('optionalDependencies');
  });

  it('covers all four dependency fields', () => {
    const pkg = {
      dependencies: { a: '1.0.0' },
      devDependencies: { b: '1.0.0' },
      peerDependencies: { c: '1.0.0' },
      optionalDependencies: { d: '1.0.0' },
    };
    expect(Object.keys(getDependencySections(pkg))).toEqual(
      PACKAGE_JSON_DEPENDENCY_FIELDS.filter((f) => f in pkg),
    );
  });
});

// ---------------------------------------------------------------------------
// getAllDependencyNames
// ---------------------------------------------------------------------------

describe('getAllDependencyNames', () => {
  it('returns empty array for null', () => {
    expect(getAllDependencyNames(null)).toEqual([]);
  });

  it('returns names from all sections', () => {
    const names = getAllDependencyNames({
      dependencies: { react: '18.0.0' },
      devDependencies: { vitest: '2.0.0' },
      peerDependencies: { typescript: '6.0.0' },
    });
    expect(names).toContain('react');
    expect(names).toContain('vitest');
    expect(names).toContain('typescript');
  });

  it('deduplicates names across sections', () => {
    const names = getAllDependencyNames({
      dependencies: { react: '18.0.0' },
      peerDependencies: { react: '>=17.0.0' },
    });
    expect(names.filter((n) => n === 'react')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// getDependencyVersion
// ---------------------------------------------------------------------------

describe('getDependencyVersion', () => {
  const pkg = {
    dependencies: { react: '18.0.0' },
    devDependencies: { vitest: '2.0.0' },
  };

  it('finds version in dependencies', () => {
    expect(getDependencyVersion(pkg, 'react')).toBe('18.0.0');
  });

  it('finds version in devDependencies', () => {
    expect(getDependencyVersion(pkg, 'vitest')).toBe('2.0.0');
  });

  it('returns undefined for unknown package', () => {
    expect(getDependencyVersion(pkg, 'unknown')).toBeUndefined();
  });

  it('returns undefined for null packageJson', () => {
    expect(getDependencyVersion(null, 'react')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// createDependencyCheckResult
// ---------------------------------------------------------------------------

describe('createDependencyCheckResult', () => {
  it('marks outdated when latest is newer', () => {
    const result = createDependencyCheckResult({
      packageName: 'react',
      currentVersion: '17.0.0',
      latestVersion: '18.0.0',
    });
    expect(result.isOutdated).toBe(true);
    expect(result.updateType).toBe('major');
  });

  it('marks not outdated when up to date', () => {
    const result = createDependencyCheckResult({
      packageName: 'react',
      currentVersion: '18.0.0',
      latestVersion: '18.0.0',
    });
    expect(result.isOutdated).toBe(false);
    expect(result.updateType).toBeUndefined();
  });

  it('marks not outdated when no latest version', () => {
    const result = createDependencyCheckResult({
      packageName: 'react',
      currentVersion: '18.0.0',
    });
    expect(result.isOutdated).toBe(false);
    expect(result.updateType).toBeUndefined();
  });

  it('includes category when provided', () => {
    const result = createDependencyCheckResult({
      packageName: 'react',
      currentVersion: '18.0.0',
      category: 'dependencies',
    });
    expect(result.category).toBe('dependencies');
  });
});

// ---------------------------------------------------------------------------
// getDependencyStatus
// ---------------------------------------------------------------------------

describe('getDependencyStatus', () => {
  it('returns not-found when no latest version', () => {
    const result = getDependencyStatus({
      packageName: 'react',
      currentVersion: '18.0.0',
    });
    expect(result.status).toBe('not-found');
  });

  it('returns latest-tag for "latest" current version', () => {
    const result = getDependencyStatus({
      packageName: 'react',
      currentVersion: 'latest',
      latestVersion: '18.0.0',
    });
    expect(result.status).toBe('latest-tag');
  });

  it('returns latest-tag for "*" current version', () => {
    const result = getDependencyStatus({
      packageName: 'react',
      currentVersion: '*',
      latestVersion: '18.0.0',
    });
    expect(result.status).toBe('latest-tag');
  });

  it('returns update-available when outdated', () => {
    const result = getDependencyStatus({
      packageName: 'react',
      currentVersion: '17.0.0',
      latestVersion: '18.0.0',
    });
    expect(result.status).toBe('update-available');
  });

  it('returns up-to-date when current matches latest', () => {
    const result = getDependencyStatus({
      packageName: 'react',
      currentVersion: '18.0.0',
      latestVersion: '18.0.0',
    });
    expect(result.status).toBe('up-to-date');
  });
});

// ---------------------------------------------------------------------------
// getNpmLatestVersion
// ---------------------------------------------------------------------------

describe('getNpmLatestVersion', () => {
  it('returns the latest version from dist-tags', () => {
    expect(getNpmLatestVersion({ 'dist-tags': { latest: '18.0.0' } })).toBe(
      '18.0.0',
    );
  });

  it('returns undefined for null manifest', () => {
    expect(getNpmLatestVersion(null)).toBeUndefined();
  });

  it('returns undefined when dist-tags is missing', () => {
    expect(getNpmLatestVersion({})).toBeUndefined();
  });

  it('returns undefined when latest tag is missing', () => {
    expect(getNpmLatestVersion({ 'dist-tags': {} })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// PackageVersionCache
// ---------------------------------------------------------------------------

describe('PackageVersionCache', () => {
  it('stores and retrieves a version', () => {
    const cache = new PackageVersionCache({ defaultTtlMs: 60_000 });
    cache.set('react', '18.0.0', undefined);
    expect(cache.getVersion('react')).toBe('18.0.0');
  });

  it('returns null for a missing entry', () => {
    const cache = new PackageVersionCache({ defaultTtlMs: 60_000 });
    expect(cache.getVersion('react')).toBeNull();
  });

  it('returns null after TTL expires', () => {
    vi.useFakeTimers();
    const cache = new PackageVersionCache({ defaultTtlMs: 1_000 });
    cache.set('react', '18.0.0', undefined);
    vi.advanceTimersByTime(1_001);
    expect(cache.getVersion('react')).toBeNull();
    vi.useRealTimers();
  });

  it('respects per-package TTL override', () => {
    vi.useFakeTimers();
    const cache = new PackageVersionCache({
      defaultTtlMs: 60_000,
      ttlByPackageName: { react: 500 },
    });
    cache.set('react', '18.0.0', undefined);
    cache.set('vue', '3.0.0', undefined);
    vi.advanceTimersByTime(600);
    expect(cache.getVersion('react')).toBeNull();
    expect(cache.getVersion('vue')).toBe('3.0.0');
    vi.useRealTimers();
  });

  it('clears a specific package', () => {
    const cache = new PackageVersionCache({ defaultTtlMs: 60_000 });
    cache.set('react', '18.0.0', undefined);
    cache.set('vue', '3.0.0', undefined);
    cache.clear('react');
    expect(cache.getVersion('react')).toBeNull();
    expect(cache.getVersion('vue')).toBe('3.0.0');
  });

  it('clears all entries', () => {
    const cache = new PackageVersionCache({ defaultTtlMs: 60_000 });
    cache.set('react', '18.0.0', undefined);
    cache.set('vue', '3.0.0', undefined);
    cache.clearAll();
    expect(cache.getVersion('react')).toBeNull();
    expect(cache.getVersion('vue')).toBeNull();
  });

  it('stores and retrieves typed meta', () => {
    const cache = new PackageVersionCache<{ tracked: boolean }>({
      defaultTtlMs: 60_000,
    });
    cache.set('react', '18.0.0', { tracked: true });
    expect(cache.get('react')?.meta).toEqual({ tracked: true });
  });
});

// ---------------------------------------------------------------------------
// fetchNpmPackageManifest
// ---------------------------------------------------------------------------

describe('fetchNpmPackageManifest', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns parsed manifest on success', async () => {
    const manifest = { 'dist-tags': { latest: '18.0.0' } };
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(manifest), { status: 200 }),
    );
    const result = await fetchNpmPackageManifest('react');
    expect(result).toEqual(manifest);
  });

  it('throws on non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('Not Found', { status: 404, statusText: 'Not Found' }),
    );
    await expect(fetchNpmPackageManifest('nonexistent')).rejects.toThrow(
      'HTTP 404',
    );
  });

  it('passes userAgent header when provided', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 }),
    );
    await fetchNpmPackageManifest('react', { userAgent: 'test-agent/1.0' });
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ 'User-Agent': 'test-agent/1.0' }),
      }),
    );
  });

  it('uses custom registryUrl when provided', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 }),
    );
    await fetchNpmPackageManifest('react', {
      registryUrl: 'https://my-registry.example.com',
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://my-registry.example.com/react',
      expect.any(Object),
    );
  });
});

// ---------------------------------------------------------------------------
// fetchNpmLatestVersionCached
// ---------------------------------------------------------------------------

describe('fetchNpmLatestVersionCached', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns cached version without fetching', async () => {
    const cache = new PackageVersionCache({ defaultTtlMs: 60_000 });
    cache.set('react', '18.0.0', undefined);
    const fetchSpy = vi.spyOn(global, 'fetch');
    const version = await fetchNpmLatestVersionCached('react', { cache });
    expect(version).toBe('18.0.0');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches and caches on cache miss', async () => {
    const cache = new PackageVersionCache({ defaultTtlMs: 60_000 });
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ 'dist-tags': { latest: '18.0.0' } }), {
        status: 200,
      }),
    );
    const version = await fetchNpmLatestVersionCached('react', { cache });
    expect(version).toBe('18.0.0');
    expect(cache.getVersion('react')).toBe('18.0.0');
  });
});

// ---------------------------------------------------------------------------
// checkNpmDependencyStatuses
// ---------------------------------------------------------------------------

describe('checkNpmDependencyStatuses', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns statuses for all dependencies', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ 'dist-tags': { latest: '18.0.0' } }), {
        status: 200,
      }),
    );
    const results = await checkNpmDependencyStatuses({ react: '17.0.0' });
    expect(results).toHaveLength(1);
    expect(results[0].packageName).toBe('react');
    expect(results[0].status).toBe('update-available');
  });

  it('calls onResolved for each package', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ 'dist-tags': { latest: '18.0.0' } }), {
        status: 200,
      }),
    );
    const onResolved = vi.fn();
    await checkNpmDependencyStatuses(
      { react: '17.0.0', vue: '3.0.0' },
      { onResolved },
    );
    expect(onResolved).toHaveBeenCalledTimes(2);
    expect(onResolved).toHaveBeenCalledWith(
      expect.objectContaining({ totalCount: 2 }),
    );
  });

  it('calls onError and still returns a result on fetch failure', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network error'));
    const onError = vi.fn();
    const results = await checkNpmDependencyStatuses(
      { react: '17.0.0' },
      { onError },
    );
    expect(onError).toHaveBeenCalledOnce();
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('not-found');
  });
});
