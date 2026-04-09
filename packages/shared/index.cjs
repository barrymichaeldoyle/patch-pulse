const DEFAULT_NPM_REGISTRY_URL = 'https://registry.npmjs.org';
const PACKAGE_JSON_DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

function createRegistryUrl(
  packageName,
  registryUrl = DEFAULT_NPM_REGISTRY_URL,
) {
  return `${registryUrl.replace(/\/$/, '')}/${encodeURIComponent(packageName)}`;
}

function getDependencySections(packageJson) {
  const sections = {};

  for (const field of PACKAGE_JSON_DEPENDENCY_FIELDS) {
    const value = packageJson?.[field];
    if (value && typeof value === 'object') {
      sections[field] = value;
    }
  }

  return sections;
}

function getAllDependencyNames(packageJson) {
  return Object.keys(
    PACKAGE_JSON_DEPENDENCY_FIELDS.reduce((allDependencies, field) => {
      const section = packageJson?.[field];
      if (section && typeof section === 'object') {
        Object.assign(allDependencies, section);
      }
      return allDependencies;
    }, {}),
  );
}

function getDependencyVersion(packageJson, packageName) {
  for (const field of PACKAGE_JSON_DEPENDENCY_FIELDS) {
    const version = packageJson?.[field]?.[packageName];
    if (version) {
      return version;
    }
  }

  return undefined;
}

function parseVersion(version) {
  const cleanVersion = version.replace(/^[\^~>=<]+/, '');
  const match = cleanVersion.match(/^(\d+)\.(\d+)\.(\d+)/);

  if (!match) {
    throw new Error(
      `Invalid version format: ${version}. Expected format: x.y.z`,
    );
  }

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  };
}

function preserveWildcardPrefix(currentVersion, latestVersion) {
  const wildcardMatch = currentVersion.match(/^([\^~>=<]+)/);
  const wildcardPrefix = wildcardMatch ? wildcardMatch[1] : '';

  return wildcardPrefix + latestVersion;
}

function hasWildcardPrefix(version) {
  return /^[\^~>=<]+/.test(version);
}

function isVersionOutdated({ current, latest }) {
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

function getUpdateType({ current, latest }) {
  try {
    const currentVersion = parseVersion(current);
    const latestVersion = parseVersion(latest);

    if (latestVersion.major > currentVersion.major) {
      return 'major';
    }
    if (latestVersion.minor > currentVersion.minor) {
      return 'minor';
    }
    if (latestVersion.patch > currentVersion.patch) {
      return 'patch';
    }
    return 'patch';
  } catch {
    return 'patch';
  }
}

function createDependencyCheckResult({
  packageName,
  currentVersion,
  latestVersion,
  category,
}) {
  const isOutdated = latestVersion
    ? isVersionOutdated({ current: currentVersion, latest: latestVersion })
    : false;

  return {
    packageName,
    currentVersion,
    latestVersion,
    isOutdated,
    updateType: isOutdated && latestVersion
      ? getUpdateType({ current: currentVersion, latest: latestVersion })
      : undefined,
    category,
  };
}

function getDependencyStatus({
  packageName,
  currentVersion,
  latestVersion,
  category,
}) {
  const base = createDependencyCheckResult({
    packageName,
    currentVersion,
    latestVersion,
    category,
  });

  if (!latestVersion) {
    return {
      ...base,
      status: 'not-found',
    };
  }

  if (['latest', '*'].includes(currentVersion)) {
    return {
      ...base,
      status: 'latest-tag',
    };
  }

  return {
    ...base,
    status: base.isOutdated ? 'update-available' : 'up-to-date',
  };
}

async function fetchNpmLatestVersionCached(packageName, options = {}) {
  const { cache, userAgent } = options;
  const cachedVersion = cache?.getVersion(packageName);
  if (cachedVersion) {
    return cachedVersion;
  }

  const latestVersion = await fetchNpmLatestVersion(packageName, { userAgent });
  if (latestVersion && cache) {
    const existingMeta = cache.get(packageName)?.meta;
    cache.set(packageName, latestVersion, existingMeta);
  }

  return latestVersion;
}

async function prefetchNpmPackageVersions(packageNames, options = {}) {
  const {
    cache,
    concurrency = 10,
    createMeta,
    onError,
    onResolved,
    userAgent,
  } = options;

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

async function checkNpmDependencyStatuses(dependencies, options = {}) {
  const {
    cache,
    category,
    concurrency = 10,
    onError,
    onResolved,
    userAgent,
  } = options;
  const packageNames = Object.keys(dependencies);
  const results = [];
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
          onResolved?.({
            completedCount,
            result,
            totalCount: packageNames.length,
          });
          return result;
        } catch (error) {
          onError?.({ error, packageName });
          const result = getDependencyStatus({
            packageName,
            currentVersion: dependencies[packageName],
            category,
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

class PackageVersionCache {
  #cache = new Map();
  #defaultTtlMs;
  #ttlByPackageName;

  constructor({ defaultTtlMs, ttlByPackageName = {} }) {
    this.#defaultTtlMs = defaultTtlMs;
    this.#ttlByPackageName = ttlByPackageName;
  }

  #getTtlMs(packageName) {
    return this.#ttlByPackageName[packageName] ?? this.#defaultTtlMs;
  }

  get(packageName) {
    const entry = this.#cache.get(packageName);
    if (!entry) {
      return null;
    }

    if (Date.now() - entry.timestamp >= this.#getTtlMs(packageName)) {
      this.#cache.delete(packageName);
      return null;
    }

    return entry;
  }

  getVersion(packageName) {
    return this.get(packageName)?.version ?? null;
  }

  set(packageName, version, meta) {
    this.#cache.set(packageName, {
      version,
      timestamp: Date.now(),
      meta,
    });
  }

  clear(packageName) {
    if (typeof packageName === 'undefined') {
      this.#cache.clear();
      return;
    }

    this.#cache.delete(packageName);
  }

  clearAll() {
    this.#cache.clear();
  }

  entries() {
    return this.#cache.entries();
  }

  values() {
    return this.#cache.values();
  }
}

function getNpmLatestVersion(manifest) {
  return manifest?.['dist-tags']?.latest;
}

async function fetchNpmPackageManifest(packageName, options = {}) {
  const { registryUrl = DEFAULT_NPM_REGISTRY_URL, userAgent } = options;
  const response = await fetch(createRegistryUrl(packageName, registryUrl), {
    headers: userAgent ? { 'User-Agent': userAgent } : undefined,
  });

  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

async function fetchNpmLatestVersion(packageName, options = {}) {
  const manifest = await fetchNpmPackageManifest(packageName, options);
  return getNpmLatestVersion(manifest);
}

module.exports = {
  DEFAULT_NPM_REGISTRY_URL,
  PACKAGE_JSON_DEPENDENCY_FIELDS,
  getAllDependencyNames,
  getDependencySections,
  getDependencyVersion,
  createDependencyCheckResult,
  checkNpmDependencyStatuses,
  fetchNpmLatestVersionCached,
  getDependencyStatus,
  getUpdateType,
  hasWildcardPrefix,
  isVersionOutdated,
  PackageVersionCache,
  prefetchNpmPackageVersions,
  fetchNpmLatestVersion,
  fetchNpmPackageManifest,
  getNpmLatestVersion,
  parseVersion,
  preserveWildcardPrefix,
};
