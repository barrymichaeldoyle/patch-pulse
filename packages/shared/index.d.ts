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
}

export type DependencyStatusKind =
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
  onResolved?: (args: {
    latestVersion?: string;
    packageName: string;
  }) => void;
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
  'dist-tags'?: NpmDistTags;
  versions?: Record<string, object>;
  [key: string]: unknown;
}

export interface FetchNpmPackageOptions {
  registryUrl?: string;
  userAgent?: string;
}

export declare const DEFAULT_NPM_REGISTRY_URL: 'https://registry.npmjs.org';

export declare const PACKAGE_JSON_DEPENDENCY_FIELDS: readonly [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

export declare function getDependencySections(
  packageJson: PackageJsonLike | null | undefined,
): Partial<
  Record<
    (typeof PACKAGE_JSON_DEPENDENCY_FIELDS)[number],
    Record<string, string>
  >
>;

export declare function getAllDependencyNames(
  packageJson: PackageJsonLike | null | undefined,
): string[];

export declare function getDependencyVersion(
  packageJson: PackageJsonLike | null | undefined,
  packageName: string,
): string | undefined;

export declare function parseVersion(version: string): VersionInfo;

export declare function preserveWildcardPrefix(
  currentVersion: string,
  latestVersion: string,
): string;

export declare function hasWildcardPrefix(version: string): boolean;

export declare function isVersionOutdated(args: {
  current: string;
  latest: string;
}): boolean;

export declare function getUpdateType(args: {
  current: string;
  latest: string;
}): UpdateType;

export declare function createDependencyCheckResult(args: {
  packageName: string;
  currentVersion: string;
  latestVersion?: string;
  category?: string;
}): DependencyCheckResult;

export declare function getDependencyStatus(args: {
  packageName: string;
  currentVersion: string;
  latestVersion?: string;
  category?: string;
}): DependencyStatusResult;

export declare function fetchNpmLatestVersionCached<TMeta = undefined>(
  packageName: string,
  options?: NpmCheckBaseOptions<TMeta>,
): Promise<string | undefined>;

export declare function prefetchNpmPackageVersions<TMeta = undefined>(
  packageNames: string[],
  options?: PrefetchNpmPackageVersionsOptions<TMeta>,
): Promise<void>;

export declare function checkNpmDependencyStatuses<TMeta = undefined>(
  dependencies: Record<string, string>,
  options?: CheckNpmDependencyStatusesOptions<TMeta>,
): Promise<DependencyStatusResult[]>;

export declare class PackageVersionCache<TMeta = undefined> {
  constructor(options: PackageVersionCacheOptions);
  clear(packageName?: string): void;
  clearAll(): void;
  entries(): IterableIterator<[string, PackageVersionCacheEntry<TMeta>]>;
  get(packageName: string): PackageVersionCacheEntry<TMeta> | null;
  getVersion(packageName: string): string | null;
  set(packageName: string, version: string, meta: TMeta): void;
  values(): IterableIterator<PackageVersionCacheEntry<TMeta>>;
}

export declare function getNpmLatestVersion(
  manifest: NpmPackageManifest | null | undefined,
): string | undefined;

export declare function fetchNpmPackageManifest(
  packageName: string,
  options?: FetchNpmPackageOptions,
): Promise<NpmPackageManifest>;

export declare function fetchNpmLatestVersion(
  packageName: string,
  options?: FetchNpmPackageOptions,
): Promise<string | undefined>;
