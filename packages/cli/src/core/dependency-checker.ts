import chalk from 'chalk';
import {
  checkNpmDependencyStatuses,
  getDependencyStatus,
} from '@patch-pulse/shared';

import { PatchPulseConfig, shouldSkipPackage } from '../services/config';
import { packageCache } from '../services/cache';
import { type DependencyInfo } from '../types';
import { ProgressSpinner } from '../ui/progress';

export async function checkDependencyVersions(
  dependencies: Record<string, string> | undefined,
  category: string,
  config?: PatchPulseConfig,
): Promise<DependencyInfo[]> {
  if (!dependencies || Object.keys(dependencies).length === 0) {
    return [];
  }

  console.log(chalk.cyan.bold(`${category}:`));
  console.log(chalk.cyan('─'.repeat(category.length + 1)));

  const packageNames = Object.keys(dependencies);
  const progress = new ProgressSpinner();
  progress.start(`Checking ${packageNames.length} packages...`);

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

  const checkedResults =
    Object.keys(dependenciesToCheck).length === 0
      ? []
      : ((await checkNpmDependencyStatuses(dependenciesToCheck, {
          cache: packageCache,
          category,
          concurrency: 10,
          onResolved: ({ completedCount, totalCount }) => {
            progress.updateMessage(
              `Checking ${packageNames.length} packages... (${completedCount + skippedResults.length}/${totalCount + skippedResults.length})`,
            );
          },
          userAgent: 'patch-pulse-cli',
        })) as DependencyInfo[]);

  const dependencyInfos: DependencyInfo[] = [...checkedResults, ...skippedResults];

  progress.stop();
  displayResults(dependencyInfos);
  console.log();

  return dependencyInfos;
}

function displayResults(dependencyInfos: DependencyInfo[]): void {
  for (const dep of dependencyInfos) {
    let status: string;
    let versionInfo: string;
    const dependencyStatus = dep.isSkipped
      ? { ...dep, status: dep.status ?? 'not-found' }
      : getDependencyStatus({
          packageName: dep.packageName,
          currentVersion: dep.currentVersion,
          latestVersion: dep.latestVersion,
          category: dep.category,
        });

    if (dep.isSkipped) {
      status = chalk.gray('SKIPPED');
      versionInfo = dep.currentVersion;
    } else if (dependencyStatus.status === 'not-found') {
      status = chalk.red('NOT FOUND');
      versionInfo = `${dep.currentVersion} (not found on npm registry)`;
    } else if (dependencyStatus.status === 'latest-tag') {
      status = chalk.cyan('LATEST TAG');
      versionInfo = `${dep.currentVersion} → ${chalk.cyan(dep.latestVersion)} (actual latest version)`;
    } else if (dependencyStatus.status === 'update-available') {
      const updateTypeColor = {
        major: chalk.yellow,
        minor: chalk.magenta,
        patch: chalk.blue,
      }[dep.updateType || 'patch'];
      status = updateTypeColor(`${dep.updateType?.toUpperCase() || 'UPDATE'}`);
      versionInfo = `${dep.currentVersion} → ${chalk.cyan(dep.latestVersion)}`;
    } else {
      status = chalk.green('UP TO DATE');
      versionInfo = dep.currentVersion;
    }

    console.log(
      `${status} ${chalk.white(dep.packageName)} ${chalk.gray(versionInfo)}`,
    );
  }
}
