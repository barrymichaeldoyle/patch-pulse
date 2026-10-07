export interface NpmDistTags {
  latest?: string;
  [tag: string]: string | undefined;
}

export interface PackageJsonLike {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  bundledDependencies?: Record<string, string>;
  [key: string]: unknown;
}

export type UpdateType = 'patch' | 'minor' | 'major';

export interface VersionInfo {
  major: number;
  minor: number;
  patch: number;
}

export interface DependencyCheckResult {
  packageName: string;
  currentVersion: string;
  latestVersion?: string;
  isOutdated: boolean;
  updateType?: UpdateType;
  category?: string;
  /**
   * The newest published version that was ignored because it is younger than
   * the configured minimum release age. Only set when a release age policy is
   * active and withheld a version.
   */
  withheldVersion?: string;
}

export type DependencyStatusKind =
  | 'lookup-failed'
  | 'not-found'
  | 'latest-tag'
  | 'up-to-date'
  | 'update-available';

export interface DependencyStatusResult extends DependencyCheckResult {
  status: DependencyStatusKind;
}

export interface PackageVersionCacheEntry<TMeta = undefined> {
  version: string;
  timestamp: number;
  meta: TMeta;
  withheldVersion?: string;
}

/**
 * Mirrors package manager "minimum release age" gates (pnpm
 * `minimumReleaseAge`, bun `minimumReleaseAge`, npm `min-release-age`, yarn
 * `npmMinimalAgeGate`). Versions published more recently than `minimumAgeMs`
 * are not reported as available updates.
 */
export interface ReleaseAgePolicy {
  minimumAgeMs: number;
  /** Return true to exempt a package (or a specific version of it) from the gate. */
  isExcluded?: (packageName: string, version: string) => boolean;
}

export interface ResolvedLatestVersion {
  latestVersion?: string;
  withheldVersion?: string;
}

export interface PackageVersionCacheOptions {
  defaultTtlMs: number;
  ttlByPackageName?: Record<string, number>;
}

export interface NpmCheckBaseOptions<TMeta = undefined> {
  cache?: PackageVersionCache<TMeta>;
  userAgent?: string;
  releaseAge?: ReleaseAgePolicy;
}

export interface PrefetchNpmPackageVersionsOptions<
  TMeta = undefined,
> extends NpmCheckBaseOptions<TMeta> {
  concurrency?: number;
  createMeta?: (packageName: string) => TMeta;
  onError?: (args: { error: unknown; packageName: string }) => void;
  onResolved?: (args: { latestVersion?: string; packageName: string }) => void;
}

export interface CheckNpmDependencyStatusesOptions<
  TMeta = undefined,
> extends NpmCheckBaseOptions<TMeta> {
  category?: string;
  concurrency?: number;
  onError?: (args: { error: unknown; packageName: string }) => void;
  onResolved?: (args: {
    completedCount: number;
    result: DependencyStatusResult;
    totalCount: number;
  }) => void;
}

export interface NpmPackageManifest {
  'dist-tags'?: NpmDistTags;
  versions?: Record<string, object>;
  /** Publish timestamps keyed by version. Only present on full metadata. */
  time?: Record<string, string>;
  [key: string]: unknown;
}

export interface FetchNpmPackageOptions {
  registryUrl?: string;
  userAgent?: string;
  /**
   * Request the full package document instead of the abbreviated install
   * manifest. Needed for publish times (`time`), at the cost of a larger
   * response.
   */
  fullMetadata?: boolean;
}

const ABBREVIATED_MANIFEST_ACCEPT = 'application/vnd.npm.install-v1+json';
const FULL_MANIFEST_ACCEPT = 'application/json';

const DEFAULT_NPM_REGISTRY_URL = 'https://registry.npmjs.org';

export const PACKAGE_JSON_DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

function createRegistryUrl(
  packageName: string,
  registryUrl = DEFAULT_NPM_REGISTRY_URL,
): string {
  return `${registryUrl.replace(/\/$/, '')}/${encodeURIComponent(packageName)}`;
}

export function getDependencySections(
  packageJson: PackageJsonLike | null | undefined,
): Partial<
  Record<
    (typeof PACKAGE_JSON_DEPENDENCY_FIELDS)[number],
    Record<string, string>
  >
> {
  const sections: Partial<
    Record<
      (typeof PACKAGE_JSON_DEPENDENCY_FIELDS)[number],
      Record<string, string>
    >
  > = {};

  for (const field of PACKAGE_JSON_DEPENDENCY_FIELDS) {
    const value = packageJson?.[field];
    if (value && typeof value === 'object') {
      sections[field] = value as Record<string, string>;
    }
  }

  return sections;
}

export function getAllDependencyNames(
  packageJson: PackageJsonLike | null | undefined,
): string[] {
  return Object.keys(
    PACKAGE_JSON_DEPENDENCY_FIELDS.reduce<Record<string, string>>(
      (allDependencies, field) => {
        const section = packageJson?.[field];
        if (section && typeof section === 'object') {
          Object.assign(allDependencies, section);
        }
        return allDependencies;
      },
      {},
    ),
  );
}

export function getDependencyVersion(
  packageJson: PackageJsonLike | null | undefined,
  packageName: string,
): string | undefined {
  for (const field of PACKAGE_JSON_DEPENDENCY_FIELDS) {
    const version = packageJson?.[field]?.[packageName];
    if (version) return version;
  }
  return undefined;
}

export function parseVersion(version: string): VersionInfo {
  const cleanVersion = version.replace(/^[\^~>=<]+/, '');
  const match = cleanVersion.match(/^(\d+)\.(\d+)\.(\d+)/);

  if (!match) {
    throw new Error(
      `Invalid version format: ${version}. Expected format: x.y.z`,
    );
  }

  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

export function preserveWildcardPrefix(
  currentVersion: string,
  latestVersion: string,
): string {
  const wildcardMatch = currentVersion.match(/^([\^~>=<]+)/);
  const wildcardPrefix = wildcardMatch ? wildcardMatch[1] : '';
  return wildcardPrefix + latestVersion;
}

export function hasWildcardPrefix(version: string): boolean {
  return /^[\^~>=<]+/.test(version);
}

export function isVersionOutdated({
  current,
  latest,
}: {
  current: string;
  latest: string;
}): boolean {
  try {
    const currentVersion = parseVersion(current);
    const latestVersion = parseVersion(latest);

    if (latestVersion.major > currentVersion.major) return true;
    if (latestVersion.major < currentVersion.major) return false;
    if (latestVersion.minor > currentVersion.minor) return true;
    if (latestVersion.minor < currentVersion.minor) return false;
    return latestVersion.patch > currentVersion.patch;
  } catch {
    return false;
  }
}

export function getUpdateType({
  current,
  latest,
}: {
  current: string;
  latest: string;
}): UpdateType {
  try {
    const currentVersion = parseVersion(current);
    const latestVersion = parseVersion(latest);

    if (latestVersion.major > currentVersion.major) return 'major';
    if (latestVersion.minor > currentVersion.minor) return 'minor';
    if (latestVersion.patch > currentVersion.patch) return 'patch';
    return 'patch';
  } catch {
    return 'patch';
  }
}

export function createDependencyCheckResult({
  packageName,
  currentVersion,
  latestVersion,
  category,
  withheldVersion,
}: {
  packageName: string;
  currentVersion: string;
  latestVersion?: string;
  category?: string;
  withheldVersion?: string;
}): DependencyCheckResult {
  const isOutdated = latestVersion
    ? isVersionOutdated({ current: currentVersion, latest: latestVersion })
    : false;

  return {
    packageName,
    currentVersion,
    latestVersion,
    isOutdated,
    updateType:
      isOutdated && latestVersion
        ? getUpdateType({ current: currentVersion, latest: latestVersion })
        : undefined,
    category,
    ...(withheldVersion ? { withheldVersion } : {}),
  };
}

export function getDependencyStatus({
  packageName,
  currentVersion,
  latestVersion,
  category,
  status,
  withheldVersion,
}: {
  packageName: string;
  currentVersion: string;
  latestVersion?: string;
  category?: string;
  status?: DependencyStatusKind;
  withheldVersion?: string;
}): DependencyStatusResult {
  const base = createDependencyCheckResult({
    packageName,
    currentVersion,
    latestVersion,
    category,
    withheldVersion,
  });

  if (status === 'lookup-failed') {
    return { ...base, status };
  }

  if (!latestVersion) {
    // Every published version is younger than the release age gate, so the
    // installed version is the best available one for now.
    if (withheldVersion) {
      return { ...base, latestVersion: currentVersion, status: 'up-to-date' };
    }
    return { ...base, status: 'not-found' };
  }

  if (['latest', '*'].includes(currentVersion)) {
    return { ...base, status: 'latest-tag' };
  }

  return {
    ...base,
    status: base.isOutdated ? 'update-available' : 'up-to-date',
  };
}

export class PackageVersionCache<TMeta = undefined> {
  #cache = new Map<string, PackageVersionCacheEntry<TMeta>>();
  #defaultTtlMs: number;
  #ttlByPackageName: Record<string, number>;

  constructor({
    defaultTtlMs,
    ttlByPackageName = {},
  }: PackageVersionCacheOptions) {
    this.#defaultTtlMs = defaultTtlMs;
    this.#ttlByPackageName = ttlByPackageName;
  }

  #getTtlMs(packageName: string): number {
    return this.#ttlByPackageName[packageName] ?? this.#defaultTtlMs;
  }

  get(packageName: string): PackageVersionCacheEntry<TMeta> | null {
    const entry = this.#cache.get(packageName);
    if (!entry) return null;

    if (Date.now() - entry.timestamp >= this.#getTtlMs(packageName)) {
      this.#cache.delete(packageName);
      return null;
    }

    return entry;
  }

  getVersion(packageName: string): string | null {
    return this.get(packageName)?.version ?? null;
  }

  set(
    packageName: string,
    version: string,
    meta: TMeta,
    withheldVersion?: string,
  ): void {
    this.#cache.set(packageName, {
      version,
      timestamp: Date.now(),
      meta,
      ...(withheldVersion ? { withheldVersion } : {}),
    });
  }

  clear(packageName?: string): void {
    if (typeof packageName === 'undefined') {
      this.#cache.clear();
      return;
    }
    this.#cache.delete(packageName);
  }

  clearAll(): void {
    this.#cache.clear();
  }

  entries(): IterableIterator<[string, PackageVersionCacheEntry<TMeta>]> {
    return this.#cache.entries();
  }

  values(): IterableIterator<PackageVersionCacheEntry<TMeta>> {
    return this.#cache.values();
  }
}

export function getNpmLatestVersion(
  manifest: NpmPackageManifest | null | undefined,
): string | undefined {
  return manifest?.['dist-tags']?.latest;
}

function isStableVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(version);
}

function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  return (
    left.major - right.major ||
    left.minor - right.minor ||
    left.patch - right.patch
  );
}

/**
 * Picks the version to report as "latest" for a package, honouring an optional
 * release age policy. Without a policy this is simply the `latest` dist-tag.
 * With one, the dist-tag is used when it is old enough (or exempt); otherwise
 * the newest stable version that satisfies the policy is reported instead and
 * the dist-tag is surfaced as `withheldVersion`.
 */
export function resolveLatestVersion(
  packageName: string,
  manifest: NpmPackageManifest | null | undefined,
  options: { releaseAge?: ReleaseAgePolicy; now?: number } = {},
): ResolvedLatestVersion {
  const taggedLatest = getNpmLatestVersion(manifest);
  const { releaseAge, now = Date.now() } = options;

  if (!taggedLatest || !releaseAge || releaseAge.minimumAgeMs <= 0) {
    return { latestVersion: taggedLatest };
  }

  const times = manifest?.time ?? {};
  const cutoff = now - releaseAge.minimumAgeMs;
  const isEligible = (version: string): boolean => {
    if (releaseAge.isExcluded?.(packageName, version)) return true;
    const publishedAt = Date.parse(times[version] ?? '');
    // Unknown publish time: assume old enough rather than hiding it forever.
    return Number.isNaN(publishedAt) || publishedAt <= cutoff;
  };

  if (isEligible(taggedLatest)) {
    return { latestVersion: taggedLatest };
  }

  let fallback: string | undefined;
  for (const version of Object.keys(manifest?.versions ?? {})) {
    if (!isStableVersion(version)) continue;
    try {
      if (compareVersions(version, taggedLatest) >= 0) continue;
      if (!isEligible(version)) continue;
      if (!fallback || compareVersions(version, fallback) > 0) {
        fallback = version;
      }
    } catch {
      continue;
    }
  }

  return { latestVersion: fallback, withheldVersion: taggedLatest };
}

export interface FetchNpmPackageConditionalOptions extends FetchNpmPackageOptions {
  /** ETag from a previous response. When provided it is sent as `If-None-Match`. */
  etag?: string;
}

export type NpmPackageManifestFetchResult =
  | { status: 'not-modified'; etag: string }
  | { status: 'modified'; manifest: NpmPackageManifest; etag?: string };

/**
 * Fetches a package manifest using a conditional request when a previous ETag
 * is known. A `304 Not Modified` response is returned as `not-modified` without
 * downloading or parsing the body, which is what the registry answers for the
 * vast majority of polling checks.
 */
export async function fetchNpmPackageManifestConditional(
  packageName: string,
  options: FetchNpmPackageConditionalOptions = {},
): Promise<NpmPackageManifestFetchResult> {
  const {
    registryUrl = DEFAULT_NPM_REGISTRY_URL,
    userAgent,
    etag,
    fullMetadata = false,
  } = options;
  const response = await fetch(createRegistryUrl(packageName, registryUrl), {
    headers: {
      Accept: fullMetadata ? FULL_MANIFEST_ACCEPT : ABBREVIATED_MANIFEST_ACCEPT,
      ...(userAgent ? { 'User-Agent': userAgent } : {}),
      ...(etag ? { 'If-None-Match': etag } : {}),
    },
  });

  if (response.status === 304 && etag) {
    return { status: 'not-modified', etag };
  }

  if (!response.ok) {
    const error = Object.assign(
      new Error(`HTTP ${response.status}: ${response.statusText}`),
      { status: response.status },
    );
    throw error;
  }

  const manifest = (await response.json()) as NpmPackageManifest;
  const responseEtag = response.headers.get('etag') ?? undefined;
  return { status: 'modified', manifest, etag: responseEtag };
}

export async function fetchNpmPackageManifest(
  packageName: string,
  options: FetchNpmPackageOptions = {},
): Promise<NpmPackageManifest> {
  const result = await fetchNpmPackageManifestConditional(packageName, options);
  // Without an ETag in the request the registry never answers 304.
  if (result.status === 'not-modified') {
    throw new Error('Unexpected 304 Not Modified without If-None-Match');
  }
  return result.manifest;
}

export async function fetchNpmLatestVersion(
  packageName: string,
  options: FetchNpmPackageOptions = {},
): Promise<string | undefined> {
  const manifest = await fetchNpmPackageManifest(packageName, options);
  return getNpmLatestVersion(manifest);
}

export async function fetchNpmLatestVersionResolved<TMeta = undefined>(
  packageName: string,
  options: NpmCheckBaseOptions<TMeta> = {},
): Promise<ResolvedLatestVersion> {
  const { cache, userAgent, releaseAge } = options;
  const cached = cache?.get(packageName);
  if (cached) {
    return {
      latestVersion: cached.version,
      withheldVersion: cached.withheldVersion,
    };
  }

  const manifest = await fetchNpmPackageManifest(packageName, {
    userAgent,
    // Publish times only exist on the full document.
    fullMetadata: Boolean(releaseAge && releaseAge.minimumAgeMs > 0),
  });
  const resolved = resolveLatestVersion(packageName, manifest, { releaseAge });

  if (resolved.latestVersion && cache) {
    cache.set(
      packageName,
      resolved.latestVersion,
      undefined as TMeta,
      resolved.withheldVersion,
    );
  }

  return resolved;
}

export async function fetchNpmLatestVersionCached<TMeta = undefined>(
  packageName: string,
  options: NpmCheckBaseOptions<TMeta> = {},
): Promise<string | undefined> {
  const { cache, userAgent, releaseAge } = options;
  const cachedVersion = cache?.getVersion(packageName);
  if (cachedVersion) return cachedVersion;

  const existingMeta = cache?.get(packageName)?.meta;
  const { latestVersion, withheldVersion } =
    await fetchNpmLatestVersionResolved(packageName, { userAgent, releaseAge });
  if (latestVersion && cache) {
    cache.set(
      packageName,
      latestVersion,
      existingMeta as TMeta,
      withheldVersion,
    );
  }

  return latestVersion;
}

export async function prefetchNpmPackageVersions<TMeta = undefined>(
  packageNames: string[],
  options: PrefetchNpmPackageVersionsOptions<TMeta> = {},
): Promise<void> {
  const {
    cache,
    concurrency = 10,
    createMeta,
    onError,
    onResolved,
    releaseAge,
    userAgent,
  } = options;

  for (let i = 0; i < packageNames.length; i += concurrency) {
    const batch = packageNames.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (packageName) => {
        try {
          const latestVersion = await fetchNpmLatestVersionCached(packageName, {
            cache,
            releaseAge,
            userAgent,
          });

          if (latestVersion && cache && createMeta) {
            cache.set(packageName, latestVersion, createMeta(packageName));
          }

          onResolved?.({ latestVersion, packageName });
        } catch (error) {
          onError?.({ error, packageName });
        }
      }),
    );
  }
}

export async function checkNpmDependencyStatuses<TMeta = undefined>(
  dependencies: Record<string, string>,
  options: CheckNpmDependencyStatusesOptions<TMeta> = {},
): Promise<DependencyStatusResult[]> {
  const {
    cache,
    category,
    concurrency = 10,
    onError,
    onResolved,
    releaseAge,
    userAgent,
  } = options;
  const packageNames = Object.keys(dependencies);
  const results: DependencyStatusResult[] = [];
  let completedCount = 0;

  for (let i = 0; i < packageNames.length; i += concurrency) {
    const batch = packageNames.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (packageName) => {
        try {
          const { latestVersion, withheldVersion } =
            await fetchNpmLatestVersionResolved(packageName, {
              cache,
              releaseAge,
              userAgent,
            });
          const result = getDependencyStatus({
            packageName,
            currentVersion: dependencies[packageName],
            latestVersion,
            category,
            withheldVersion,
          });
          completedCount += 1;
          onResolved?.({
            completedCount,
            result,
            totalCount: packageNames.length,
          });
          return result;
        } catch (error) {
          onError?.({ error, packageName });
          const result =
            error instanceof Error && 'status' in error && error.status === 404
              ? getDependencyStatus({
                  packageName,
                  currentVersion: dependencies[packageName],
                  category,
                })
              : getDependencyStatus({
                  packageName,
                  currentVersion: dependencies[packageName],
                  category,
                  status: 'lookup-failed',
                });
          completedCount += 1;
          onResolved?.({
            completedCount,
            result,
            totalCount: packageNames.length,
          });
          return result;
        }
      }),
    );

    results.push(...batchResults);
  }

  return results;
}
