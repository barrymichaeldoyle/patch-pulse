import {
  checkNpmDependencyStatuses,
  getDependencyStatus,
} from '@patch-pulse/shared';

import { PatchPulseConfig, shouldSkipPackage } from '../services/config';
import { packageCache } from '../services/cache';
import { type DependencyInfo } from '../types';
import { ansi } from '../ui/ansi';
import { ProgressSpinner } from '../ui/progress';
import { debugLog } from '../utils/debug';

export async function checkDependencyVersions(
  dependencies: Record<string, string> | undefined,
  category: string,
  config?: PatchPulseConfig,
  options: {
    silent?: boolean;
  } = {},
): Promise<DependencyInfo[]> {
  const { silent = false } = options;

  if (!dependencies || Object.keys(dependencies).length === 0) {
    return [];
  }

  const packageNames = Object.keys(dependencies);
  const progress = silent ? null : new ProgressSpinner();
  progress?.start(`Checking ${packageNames.length} packages...`);

  const skippedResults: DependencyInfo[] = [];
  const dependenciesToCheck = Object.fromEntries(
    Object.entries(dependencies).filter(([packageName, version]) => {
      const isSkipped = shouldSkipPackage({ packageName, config });
      if (isSkipped) {
        skippedResults.push({
          packageName,
          currentVersion: version,
          latestVersion: undefined,
          isOutdated: false,
          updateType: undefined,
          category,
          isSkipped: true,
          status: 'not-found',
        });
      }

      return !isSkipped;
    }),
  );

  let checkedResults: DependencyInfo[] = [];

  try {
    checkedResults =
      Object.keys(dependenciesToCheck).length === 0
        ? []
        : ((await checkNpmDependencyStatuses(dependenciesToCheck, {
            cache: packageCache,
            category,
            concurrency: 10,
            onError: ({ error, packageName }) => {
              if (
                !(error instanceof Error) ||
                !('status' in error) ||
                error.status !== 404
              ) {
                debugLog(
                  `Dependency lookup failed for ${packageName} in ${category}: ${describeLookupError(error)}`,
                );
              }
            },
            onResolved: ({ completedCount, totalCount }) => {
              progress?.updateMessage(
                `Checking ${packageNames.length} packages... (${completedCount + skippedResults.length}/${totalCount + skippedResults.length})`,
              );
            },
            userAgent: 'patch-pulse-cli',
          })) as DependencyInfo[]);
  } finally {
    progress?.stop();
  }

  const dependencyInfos: DependencyInfo[] = [
    ...checkedResults,
    ...skippedResults,
  ];

  if (!silent) {
    displayDependencyResults({
      category,
      dependencyInfos,
    });
  }

  return dependencyInfos;
}

export function displayDependencyResults({
  category,
  dependencyInfos,
}: {
  category: string;
  dependencyInfos: DependencyInfo[];
}): void {
  console.log(ansi.whiteBold(`${category}:`));
  console.log(ansi.gray('─'.repeat(category.length + 1)));
  displayResults(dependencyInfos);
  console.log();
}

function displayResults(dependencyInfos: DependencyInfo[]): void {
  for (const dep of dependencyInfos) {
    console.log(formatDependencyResult(dep));
  }
}

export function formatDependencyResult(dep: DependencyInfo): string {
  let status: string;
  let versionInfo: string;
  const dependencyStatus = dep.isSkipped
    ? { ...dep, status: dep.status ?? 'not-found' }
    : getDependencyStatus({
        packageName: dep.packageName,
        currentVersion: dep.currentVersion,
        latestVersion: dep.latestVersion,
        category: dep.category,
        status: dep.status,
      });

  if (dep.isSkipped) {
    status = ansi.gray('SKIPPED');
    versionInfo = dep.currentVersion;
  } else if (dependencyStatus.status === 'lookup-failed') {
    status = ansi.magenta('UNKNOWN');
    versionInfo = `${dep.currentVersion} (lookup failed)`;
  } else if (dependencyStatus.status === 'not-found') {
    status = ansi.red('NOT FOUND');
    versionInfo = `${dep.currentVersion} (not found on npm registry)`;
  } else if (dependencyStatus.status === 'latest-tag') {
    status = ansi.cyan('LATEST TAG');
    versionInfo = `${dep.currentVersion} → ${ansi.cyan(dep.latestVersion)} (actual latest version)`;
  } else if (dependencyStatus.status === 'update-available') {
    const updateTypeColor = {
      major: ansi.yellow,
      minor: ansi.magenta,
      patch: ansi.blue,
    }[dep.updateType || 'patch'];
    status = updateTypeColor(`${dep.updateType?.toUpperCase() || 'UPDATE'}`);
    versionInfo = `${dep.currentVersion} → ${ansi.cyan(dep.latestVersion)}`;
  } else {
    status = ansi.green('UP TO DATE');
    versionInfo = dep.currentVersion;
  }

  return `${status} ${ansi.white(dep.packageName)} ${ansi.gray(versionInfo)}`;
}

function describeLookupError(error: unknown): string {
  if (error instanceof Error && 'status' in error) {
    return `HTTP ${String(error.status)}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
