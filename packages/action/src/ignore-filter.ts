import type { PackageGroup } from './types';

/**
 * Returns true if the package name matches the pattern.
 * Supports exact matches and simple glob patterns using `*` as a wildcard.
 * Examples: "lodash", "@types/*", "@tanstack/react-*"
 */
function matchesPattern(packageName: string, pattern: string): boolean {
  if (!pattern.includes('*')) return packageName === pattern;

  const regex = new RegExp(
    '^' +
      pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') +
      '$',
  );
  return regex.test(packageName);
}

/**
 * Filters packages matching the ignore list out of every group.
 * Groups that become empty after filtering are removed entirely.
 */
export function applyIgnoreList(
  groups: PackageGroup[],
  ignoreList: string[],
): PackageGroup[] {
  if (ignoreList.length === 0) return groups;

  return groups
    .map((group) => ({
      ...group,
      packages: group.packages.filter(
        (pkg) =>
          !ignoreList.some((pattern) =>
            matchesPattern(pkg.packageName, pattern),
          ),
      ),
    }))
    .filter((group) => group.packages.length > 0);
}
