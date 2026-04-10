import chalk from 'chalk';
import { PACKAGE_JSON_DEPENDENCY_FIELDS } from '@patch-pulse/shared';
import { checkDependencyVersions } from './core/dependency-checker';
import { getConfig } from './services/config';
import { checkForCliUpdate } from './services/npm';
import {
  detectPackageManager,
  getPackageManagerInfo,
  updateDependencies,
} from './services/package-manager';
import { type DependencyInfo, type UpdateableDependency } from './types';
import { scanWorkspace } from './services/workspace';
import { displayHelp } from './ui/display/help';
import { displayLicense } from './ui/display/license';
import { displaySummary } from './ui/display/summary';
import { displayThankYouMessage } from './ui/display/thankYouMessage';
import { displayUnknownArguments } from './ui/display/unknownArguments';
import { displayUpdatePrompt } from './ui/display/updatePrompt';
import { displayVersion } from './ui/display/version';
import { getUnknownArgs } from './utils/getUnknownArgs';
import { hasAnyFlag } from './utils/hasAnyFlag';

const VALID_FLAGS = [
  '-h',
  '--help',
  '-i',
  '--info',
  '-v',
  '--version',
  '-l',
  '--license',
  '-s',
  '--skip',
  '--package-manager',
  '--update-prompt',
  '--no-update-prompt',
];

export async function runCli({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
}: {
  argv?: string[];
  cwd?: string;
} = {}): Promise<number> {
  process.env.FORCE_COLOR = '1';

  const unknownArgs = getUnknownArgs({ args: argv, validFlags: VALID_FLAGS });
  if (unknownArgs.length > 0) {
    displayUnknownArguments(unknownArgs);
    return 1;
  }

  if (hasAnyFlag({ args: argv, flags: ['--help', '-h', '--info', '-i'] })) {
    displayHelp();
    return 0;
  }

  if (hasAnyFlag({ args: argv, flags: ['--version', '-v'] })) {
    displayVersion();
    return 0;
  }

  if (hasAnyFlag({ args: argv, flags: ['--license', '-l'] })) {
    displayLicense();
    return 0;
  }

  try {
    const allDependencies: DependencyInfo[] = [];
    const config = getConfig({ argv, cwd });
    const workspace = await scanWorkspace(cwd);

    const dependencyTypeLabels: Record<string, string> = {
      dependencies: 'Dependencies',
      devDependencies: 'Dev Dependencies',
      peerDependencies: 'Peer Dependencies',
      optionalDependencies: 'Optional Dependencies',
    };

    if (workspace.projects.length > 0) {
      for (const project of workspace.projects) {
        if (workspace.isMonorepo) {
          console.log(chalk.white.bold(project.displayName));
          console.log(chalk.gray(`Location: ${project.relativePath}`));
          console.log(chalk.gray('─'.repeat(60)));
        }

        for (const key of PACKAGE_JSON_DEPENDENCY_FIELDS) {
          const value = project.sections[key];
          if (!value) {
            continue;
          }

          try {
            const dependencyMap = Object.fromEntries(
              value.map((dependency) => [
                dependency.packageName,
                dependency.source.resolvedVersion,
              ]),
            );
            const sourceMap = new Map(
              value.map((dependency) => [dependency.packageName, dependency.source]),
            );
            const dependencies = await checkDependencyVersions(
              dependencyMap,
              dependencyTypeLabels[key],
              config,
            );
            allDependencies.push(
              ...dependencies.map((dependency) => ({
                ...dependency,
                source: sourceMap.get(dependency.packageName),
              })),
            );
          } catch (error) {
            console.error(
              chalk.red(
                `Error checking ${key.toLowerCase()} in ${project.relativePath}: ${error}`,
              ),
            );
          }
        }
      }

      displaySummary(allDependencies);

      if (!config.noUpdatePrompt) {
        const packageManager = config.packageManager
          ? getPackageManagerInfo(config.packageManager)
          : detectPackageManager(cwd);

        const updateType = await displayUpdatePrompt(allDependencies, config);

        if (updateType) {
          const outdatedDeps = allDependencies.filter(
            (d) => d.isOutdated && !d.isSkipped,
          );

          let depsToUpdate: UpdateableDependency[] = [];

          if (updateType === 'patch') {
            depsToUpdate = outdatedDeps
              .filter((d) => d.updateType === 'patch' && d.latestVersion)
              .map((d) => ({
                packageName: d.packageName,
                currentVersion: d.currentVersion,
                latestVersion: d.latestVersion!,
                updateType: d.updateType!,
                category: d.category || 'Dependencies',
                source: d.source!,
              }));
          } else if (updateType === 'minor') {
            depsToUpdate = outdatedDeps
              .filter(
                (d) =>
                  (d.updateType === 'minor' || d.updateType === 'patch') &&
                  d.latestVersion,
              )
              .map((d) => ({
                packageName: d.packageName,
                currentVersion: d.currentVersion,
                latestVersion: d.latestVersion!,
                updateType: d.updateType!,
                category: d.category || 'Dependencies',
                source: d.source!,
              }));
          } else if (updateType === 'all') {
            depsToUpdate = outdatedDeps
              .filter((d) => d.latestVersion)
              .map((d) => ({
                packageName: d.packageName,
                currentVersion: d.currentVersion,
                latestVersion: d.latestVersion!,
                updateType: d.updateType!,
                category: d.category || 'Dependencies',
                source: d.source!,
              }));
          }

          if (depsToUpdate.length > 0) {
            await updateDependencies({
              dependencies: depsToUpdate,
              cwd,
              packageManager,
            });
          }
        }
      }

      displayThankYouMessage();
    } else {
      console.log(chalk.yellow('⚠️  No dependencies found to check'));
    }

    try {
      await checkForCliUpdate();
    } catch {
      // Silently fail for CLI updates, i.e. don't let CLI update errors stop the main flow
    }

    return 0;
  } catch (error) {
    console.error(chalk.red(`Error: ${error}`));
    return 1;
  }
}
