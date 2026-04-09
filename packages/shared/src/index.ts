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

export type UpdateType = "patch" | "minor" | "major";

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
}

export type DependencyStatusKind =
  | "not-found"
  | "latest-tag"
  | "up-to-date"
  | "update-available";

export interface DependencyStatusResult extends DependencyCheckResult {
  status: DependencyStatusKind;
}

export interface PackageVersionCacheEntry<TMeta = undefined> {
  version: string;
  timestamp: number;
  meta: TMeta;
}

export interface PackageVersionCacheOptions {
  defaultTtlMs: number;
  ttlByPackageName?: Record<string, number>;
}

export interface NpmCheckBaseOptions<TMeta = undefined> {
  cache?: PackageVersionCache<TMeta>;
  userAgent?: string;
}

export interface PrefetchNpmPackageVersionsOptions<TMeta = undefined>
  extends NpmCheckBaseOptions<TMeta> {
  concurrency?: number;
  createMeta?: (packageName: string) => TMeta;
  onError?: (args: { error: unknown; packageName: string }) => void;
  onResolved?: (args: { latestVersion?: string; packageName: string }) => void;
}

export interface CheckNpmDependencyStatusesOptions<TMeta = undefined>
  extends NpmCheckBaseOptions<TMeta> {
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
  "dist-tags"?: NpmDistTags;
  versions?: Record<string, object>;
  [key: string]: unknown;
}

export interface FetchNpmPackageOptions {
  registryUrl?: string;
  userAgent?: string;
}

const DEFAULT_NPM_REGISTRY_URL = "https://registry.npmjs.org";

export const PACKAGE_JSON_DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

function createRegistryUrl(
  packageName: string,
  registryUrl = DEFAULT_NPM_REGISTRY_URL,
): string {
  return `${registryUrl.replace(/\/$/, "")}/${encodeURIComponent(packageName)}`;
}

export function getDependencySections(
  packageJson: PackageJsonLike | null | undefined,
): Partial<
  Record<(typeof PACKAGE_JSON_DEPENDENCY_FIELDS)[number], Record<string, string>>
> {
  const sections: Partial<
    Record<(typeof PACKAGE_JSON_DEPENDENCY_FIELDS)[number], Record<string, string>>
  > = {};

  for (const field of PACKAGE_JSON_DEPENDENCY_FIELDS) {
    const value = packageJson?.[field];
    if (value && typeof value === "object") {
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
        if (section && typeof section === "object") {
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
  const cleanVersion = version.replace(/^[\^~>=<]+/, "");
  const match = cleanVersion.match(/^(\d+)\.(\d+)\.(\d+)/);

  if (!match) {
    throw new Error(`Invalid version format: ${version}. Expected format: x.y.z`);
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
  const wildcardPrefix = wildcardMatch ? wildcardMatch[1] : "";
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

    if (latestVersion.major > currentVersion.major) return "major";
    if (latestVersion.minor > currentVersion.minor) return "minor";
    if (latestVersion.patch > currentVersion.patch) return "patch";
    return "patch";
  } catch {
    return "patch";
  }
}

export function createDependencyCheckResult({
  packageName,
  currentVersion,
  latestVersion,
  category,
}: {
  packageName: string;
  currentVersion: string;
  latestVersion?: string;
  category?: string;
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
  };
}

export function getDependencyStatus({
  packageName,
  currentVersion,
  latestVersion,
  category,
}: {
  packageName: string;
  currentVersion: string;
  latestVersion?: string;
  category?: string;
}): DependencyStatusResult {
  const base = createDependencyCheckResult({
    packageName,
    currentVersion,
    latestVersion,
    category,
  });

  if (!latestVersion) {
    return { ...base, status: "not-found" };
  }

  if (["latest", "*"].includes(currentVersion)) {
    return { ...base, status: "latest-tag" };
  }

  return { ...base, status: base.isOutdated ? "update-available" : "up-to-date" };
}

export class PackageVersionCache<TMeta = undefined> {
  #cache = new Map<string, PackageVersionCacheEntry<TMeta>>();
  #defaultTtlMs: number;
  #ttlByPackageName: Record<string, number>;

  constructor({ defaultTtlMs, ttlByPackageName = {} }: PackageVersionCacheOptions) {
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

  set(packageName: string, version: string, meta: TMeta): void {
    this.#cache.set(packageName, { version, timestamp: Date.now(), meta });
  }

  clear(packageName?: string): void {
    if (typeof packageName === "undefined") {
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
  return manifest?.["dist-tags"]?.latest;
}

export async function fetchNpmPackageManifest(
  packageName: string,
  options: FetchNpmPackageOptions = {},
): Promise<NpmPackageManifest> {
  const { registryUrl = DEFAULT_NPM_REGISTRY_URL, userAgent } = options;
  const response = await fetch(createRegistryUrl(packageName, registryUrl), {
    headers: userAgent ? { "User-Agent": userAgent } : undefined,
  });

  if (!response.ok) {
    const error = Object.assign(
      new Error(`HTTP ${response.status}: ${response.statusText}`),
      { status: response.status },
    );
    throw error;
  }

  return response.json();
}

export async function fetchNpmLatestVersion(
  packageName: string,
  options: FetchNpmPackageOptions = {},
): Promise<string | undefined> {
  const manifest = await fetchNpmPackageManifest(packageName, options);
  return getNpmLatestVersion(manifest);
}

export async function fetchNpmLatestVersionCached<TMeta = undefined>(
  packageName: string,
  options: NpmCheckBaseOptions<TMeta> = {},
): Promise<string | undefined> {
  const { cache, userAgent } = options;
  const cachedVersion = cache?.getVersion(packageName);
  if (cachedVersion) return cachedVersion;

  const latestVersion = await fetchNpmLatestVersion(packageName, { userAgent });
  if (latestVersion && cache) {
    const existingMeta = cache.get(packageName)?.meta;
    cache.set(packageName, latestVersion, existingMeta as TMeta);
  }

  return latestVersion;
}

export async function prefetchNpmPackageVersions<TMeta = undefined>(
  packageNames: string[],
  options: PrefetchNpmPackageVersionsOptions<TMeta> = {},
): Promise<void> {
  const { cache, concurrency = 10, createMeta, onError, onResolved, userAgent } = options;

  for (let i = 0; i < packageNames.length; i += concurrency) {
    const batch = packageNames.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (packageName) => {
        try {
          const latestVersion = await fetchNpmLatestVersionCached(packageName, {
            cache,
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
  const { cache, category, concurrency = 10, onError, onResolved, userAgent } = options;
  const packageNames = Object.keys(dependencies);
  const results: DependencyStatusResult[] = [];
  let completedCount = 0;

  for (let i = 0; i < packageNames.length; i += concurrency) {
    const batch = packageNames.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (packageName) => {
        try {
          const latestVersion = await fetchNpmLatestVersionCached(packageName, {
            cache,
            userAgent,
          });
          const result = getDependencyStatus({
            packageName,
            currentVersion: dependencies[packageName],
            latestVersion,
            category,
          });
          completedCount += 1;
          onResolved?.({ completedCount, result, totalCount: packageNames.length });
          return result;
        } catch (error) {
          onError?.({ error, packageName });
          const result = getDependencyStatus({
            packageName,
            currentVersion: dependencies[packageName],
            category,
          });
          completedCount += 1;
          onResolved?.({ completedCount, result, totalCount: packageNames.length });
          return result;
        }
      }),
    );

    results.push(...batchResults);
  }

  return results;
}
