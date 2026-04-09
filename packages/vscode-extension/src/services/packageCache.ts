import { PackageVersionCache } from '@patch-pulse/shared';

interface PackageCacheService {
  getCachedPackageLatestVersion(packageName: string): string | null;
  getSharedCache(): PackageVersionCache<Set<string>>;
  setCachedVersion(
    packageName: string,
    version: string,
    filePath?: string,
  ): void;
  clearPackage(packageName: string): void;
  clearCacheForFile(filePath: string): void;
  clearExpiredEntries(): void;
  getStats(): { totalPackages: number; totalFiles: number };
  clearAll(): void;
}

class PackageCache implements PackageCacheService {
  private cache = new PackageVersionCache<Set<string>>({
    defaultTtlMs: 30 * 60 * 1000,
  });

  /**
   * Get the latest version of a package from the cache.
   * @param packageName - The name of the package.
   * @returns The latest version of the package or null if not found.
   */
  getCachedPackageLatestVersion(packageName: string): string | null {
    return this.cache.getVersion(packageName);
  }

  /**
   * Set the cached version for a package.
   * @param packageName - The name of the package.
   * @param version - The version of the package.
   * @param filePath - The file path of the package.
   */
  setCachedVersion(
    packageName: string,
    version: string,
    filePath?: string,
  ): void {
    const existing = this.cache.get(packageName);

    if (existing) {
      const files = existing.meta;
      if (filePath) {
        files.add(filePath);
      }
      this.cache.set(packageName, version, files);
    } else {
      const files = new Set<string>();
      if (filePath) {
        files.add(filePath);
      }
      this.cache.set(packageName, version, files);
    }
  }

  /**
   * Clear the cache for a package.
   * @param packageName - The name of the package.
   */
  clearPackage(packageName: string): void {
    this.cache.clear(packageName);
  }

  /**
   * Clear the cache for a file.
   * @param filePath - The file path.
   */
  clearCacheForFile(filePath: string): void {
    const packagesToRemove: string[] = [];

    for (const [packageName, entry] of this.cache.entries()) {
      entry.meta.delete(filePath);

      // If no files are using this package anymore, remove it
      if (entry.meta.size === 0) {
        packagesToRemove.push(packageName);
      }
    }

    packagesToRemove.forEach((packageName) => {
      this.cache.clear(packageName);
    });
  }

  /**
   * Clear expired entries from the cache.
   */
  clearExpiredEntries(): void {
    for (const [packageName] of this.cache.entries()) {
      this.cache.get(packageName);
    }
  }

  /**
   * Get the stats of the cache.
   * @returns The stats of the cache.
   */
  getStats(): { totalPackages: number; totalFiles: number } {
    const allFiles = new Set<string>();

    for (const entry of this.cache.values()) {
      entry.meta.forEach((file: string) => allFiles.add(file));
    }

    return {
      totalPackages: Array.from(this.cache.entries()).length,
      totalFiles: allFiles.size,
    };
  }

  /**
   * Clear all entries from the cache.
   */
  clearAll(): void {
    this.cache.clear();
  }

  // Additional helper methods for debugging/monitoring
  getPackageFiles(packageName: string): string[] {
    const entry = this.cache.get(packageName);
    return entry ? Array.from(entry.meta) : [];
  }

  getFilePackages(filePath: string): string[] {
    const packages: string[] = [];

    for (const [packageName, entry] of this.cache.entries()) {
      if (entry.meta.has(filePath)) {
        packages.push(packageName);
      }
    }

    return packages;
  }

  // Method to refresh specific packages (force re-fetch)
  markForRefresh(packageNames: string[]): void {
    packageNames.forEach((packageName) => {
      const entry = this.cache.get(packageName);
      if (entry) {
        this.cache.set(packageName, entry.version, entry.meta);
        const refreshedEntry = this.cache.get(packageName);
        if (refreshedEntry) {
          refreshedEntry.timestamp = 0;
        }
      }
    });
  }

  getSharedCache(): PackageVersionCache<Set<string>> {
    return this.cache;
  }
}

// Create singleton instance
export const packageCache = new PackageCache();

/**
 * The interval for the cache cleanup.
 */
let cleanupInterval: NodeJS.Timeout | undefined;

/**
 * Start the cache cleanup interval.
 */
export function startCacheCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
  }

  // Clean up expired entries every 5 minutes
  cleanupInterval = setInterval(
    () => {
      packageCache.clearExpiredEntries();
    },
    5 * 60 * 1000,
  );
}

/**
 * Stop the cache cleanup interval.
 */
export function stopCacheCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = undefined;
  }
}
