import type {
  CliOutput,
  OutdatedPackage,
  PackageGroup,
  UpdateType,
} from './types';

const UPDATE_TYPE_RANK: Record<UpdateType, number> = {
  patch: 0,
  minor: 1,
  major: 2,
};

function higherUpdateType(a: UpdateType, b: UpdateType): UpdateType {
  return UPDATE_TYPE_RANK[a] >= UPDATE_TYPE_RANK[b] ? a : b;
}

/** Converts a package name or group name to a safe git branch slug */
function toBranchSlug(name: string): string {
  return name
    .replace(/^@/, '')
    .replace(/\//g, '-')
    .replace(/[^a-zA-Z0-9-_.]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function groupPackages({
  cliOutput,
  groups,
  updateTypes,
}: {
  cliOutput: CliOutput;
  groups: Record<string, string[]>;
  updateTypes: string[];
}): PackageGroup[] {
  // Build a flat map of packageName -> OutdatedPackage, deduplicating occurrences
  const outdatedMap = new Map<string, OutdatedPackage>();

  for (const project of cliOutput.projects) {
    for (const section of project.sections) {
      for (const dep of section.dependencies) {
        if (
          !dep.isOutdated ||
          dep.isSkipped ||
          !dep.latestVersion ||
          !dep.updateType
        )
          continue;
        if (!updateTypes.includes(dep.updateType)) continue;

        // Derive the occurrence from the source field when available
        const occurrence = dep.source
          ? {
              packageJsonPath: dep.source.packageJsonPath,
              rawVersion: dep.source.rawVersion,
              section: dep.source.section,
            }
          : {
              packageJsonPath:
                project.relativePath === '.'
                  ? 'package.json'
                  : `${project.relativePath}/package.json`,
              rawVersion: dep.currentVersion,
              section: section.category,
            };

        const existing = outdatedMap.get(dep.packageName);
        if (existing) {
          const alreadyTracked = existing.occurrences.some(
            (o) => o.packageJsonPath === occurrence.packageJsonPath,
          );
          if (!alreadyTracked) {
            existing.occurrences.push(occurrence);
          }
        } else {
          outdatedMap.set(dep.packageName, {
            packageName: dep.packageName,
            currentVersion: dep.currentVersion,
            latestVersion: dep.latestVersion,
            updateType: dep.updateType,
            occurrences: [occurrence],
          });
        }
      }
    }
  }

  if (outdatedMap.size === 0) return [];

  // Build reverse map: packageName -> groupName
  const packageToGroup = new Map<string, string>();
  for (const [groupName, packageNames] of Object.entries(groups)) {
    for (const packageName of packageNames) {
      packageToGroup.set(packageName, groupName);
    }
  }

  // Bucket packages into their groups (or their own name for singles)
  const buckets = new Map<string, OutdatedPackage[]>();
  for (const pkg of outdatedMap.values()) {
    const groupName = packageToGroup.get(pkg.packageName) ?? pkg.packageName;
    const existing = buckets.get(groupName) ?? [];
    existing.push(pkg);
    buckets.set(groupName, existing);
  }

  return Array.from(buckets.entries()).map(([name, packages]) => {
    const highestUpdateType = packages.reduce<UpdateType>(
      (highest, pkg) => higherUpdateType(highest, pkg.updateType),
      'patch',
    );

    return {
      name,
      packages,
      highestUpdateType,
      branchName: `patch-pulse/${toBranchSlug(name)}`,
    };
  });
}
