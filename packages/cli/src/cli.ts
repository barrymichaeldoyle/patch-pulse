import { PACKAGE_JSON_DEPENDENCY_FIELDS } from '@patch-pulse/shared';
import {
  checkDependencyVersions,
  displayDependencyResults,
  formatDependencyResult,
} from './core/dependency-checker';
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
import { displayAbout } from './ui/display/about';
import { displaySummary } from './ui/display/summary';
import { displayThankYouMessage } from './ui/display/thankYouMessage';
import { displayUnknownArguments } from './ui/display/unknownArguments';
import { displayUpdatePrompt } from './ui/display/updatePrompt';
import { displayVersion } from './ui/display/version';
import { ansi } from './ui/ansi';
import { ProgressSpinner } from './ui/progress';
import { debugLog } from './utils/debug';
import { getUnknownArgs } from './utils/getUnknownArgs';
import { hasAnyFlag } from './utils/hasAnyFlag';
import { pluralize } from './utils/pluralize';

type SectionResult = {
  category: string;
  dependencyInfos: DependencyInfo[];
};

type ProjectReport = {
  displayName: string;
  relativePath: string;
  sectionResults: SectionResult[];
  projectDependencies: DependencyInfo[];
  projectNeedsAttention: boolean;
};

const VALID_FLAGS = [
  '-h',
  '--help',
  '-i',
  '--info',
  '-v',
  '--version',
  '--about',
  '--json',
  '-l',
  '--license',
  '-s',
  '--skip',
  '--package-manager',
  '--project',
  '--update-prompt',
  '--no-update-prompt',
  '--only-outdated',
  '--verbose-projects',
];

export async function runCli({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
}: {
  argv?: string[];
  cwd?: string;
} = {}): Promise<number> {
  argv = argv.filter((arg) => arg !== '--');
  const jsonOutput = argv.includes('--json');
  const onlyOutdated = argv.includes('--only-outdated');
  const projectFilter = getFlagValue(argv, '--project');
  const verboseProjects = argv.includes('--verbose-projects');

  const unknownArgs = getUnknownArgs({
    args: argv,
    validFlags: VALID_FLAGS,
    singleValueFlags: ['--package-manager', '--project'],
  });
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

  if (argv.includes('--about')) {
    displayAbout();
    return 0;
  }

  if (hasAnyFlag({ args: argv, flags: ['--license', '-l'] })) {
    displayLicense();
    return 0;
  }

  if (argv.includes('--project') && !projectFilter) {
    console.error(ansi.red('Error: --project requires a project name or path'));
    return 1;
  }

  try {
    const allDependencies: DependencyInfo[] = [];
    const config = getConfig({ argv, cwd });
    const workspace = await scanWorkspace(cwd, config);
    const filteredProjects = filterProjects({
      projectFilter,
      projects: workspace.projects,
    });

    if (projectFilter && filteredProjects.length === 0) {
      const message = createProjectNotFoundMessage({
        projectFilter,
        availableProjects: workspace.projects.map((project) => ({
          displayName: project.displayName,
          relativePath: project.relativePath,
        })),
      });

      if (jsonOutput) {
        console.log(JSON.stringify({ error: message }, null, 2));
      } else {
        console.error(ansi.red(`Error: ${message}`));
      }

      return 1;
    }

    const projectReports: ProjectReport[] = [];

    const dependencyTypeLabels: Record<string, string> = {
      dependencies: 'Dependencies',
      devDependencies: 'Dev Dependencies',
      peerDependencies: 'Peer Dependencies',
      optionalDependencies: 'Optional Dependencies',
    };

    if (filteredProjects.length > 0) {
      // --only-outdated monorepo: buffer all results then display only outdated projects.
      // All other modes stream output per-project as data arrives.
      const bufferAll = onlyOutdated && workspace.isMonorepo;

      // Top-level scan spinner for the buffer-all case so the user sees progress.
      let scanSpinner: ProgressSpinner | null = null;
      if (bufferAll && !jsonOutput) {
        const projectWord = pluralize({
          count: filteredProjects.length,
          singular: 'project',
          plural: 'projects',
        });
        scanSpinner = new ProgressSpinner();
        scanSpinner.start(
          `Scanning ${filteredProjects.length} ${projectWord}... (0/${filteredProjects.length})`,
        );
      }

      let scannedCount = 0;

      for (const project of filteredProjects) {
        const projectDependencies: DependencyInfo[] = [];
        const sectionResults: SectionResult[] = [];

        // Sections stream inline (with their own spinner + results) when:
        //   - single project (non-monorepo), OR
        //   - verbose monorepo
        // In both cases silent: false lets checkDependencyVersions handle display.
        const streamInline =
          (!workspace.isMonorepo || verboseProjects) && !jsonOutput && !bufferAll;

        // Show a per-project spinner for non-verbose monorepo (non-buffered).
        const useProjectSpinner =
          workspace.isMonorepo && !verboseProjects && !bufferAll && !jsonOutput;

        let projectSpinner: ProgressSpinner | null = null;

        if (!jsonOutput && !bufferAll) {
          if (workspace.isMonorepo) {
            console.log(ansi.whiteBold(project.displayName));
            console.log(ansi.gray(`Location: ${project.relativePath}`));
            console.log(ansi.gray('─'.repeat(60)));
          }
          if (useProjectSpinner) {
            projectSpinner = new ProgressSpinner();
          }
        }

        for (const key of PACKAGE_JSON_DEPENDENCY_FIELDS) {
          const value = project.sections[key];
          if (!value) {
            continue;
          }

          const sectionLabel = dependencyTypeLabels[key];

          projectSpinner?.start(`Checking ${sectionLabel.toLowerCase()}...`);

          try {
            const dependencyMap = Object.fromEntries(
              value.map((dependency) => [
                dependency.packageName,
                dependency.source.resolvedVersion,
              ]),
            );
            const sourceMap = new Map(
              value.map((dependency) => [
                dependency.packageName,
                dependency.source,
              ]),
            );
            const dependencies = await checkDependencyVersions(
              dependencyMap,
              sectionLabel,
              config,
              { silent: !streamInline },
            );

            projectSpinner?.stop();

            const enrichedDependencies = dependencies.map((dependency) => ({
              ...dependency,
              source: sourceMap.get(dependency.packageName),
            }));
            projectDependencies.push(...enrichedDependencies);
            sectionResults.push({
              category: sectionLabel,
              dependencyInfos: enrichedDependencies,
            });
          } catch (error) {
            projectSpinner?.stop();
            console.error(
              ansi.red(
                `Error checking ${key.toLowerCase()} in ${project.relativePath}: ${error}`,
              ),
            );
          }
        }

        allDependencies.push(...projectDependencies);

        scannedCount++;
        scanSpinner?.updateMessage(
          `Scanning ${filteredProjects.length} ${pluralize({
            count: filteredProjects.length,
            singular: 'project',
            plural: 'projects',
          })}... (${scannedCount}/${filteredProjects.length})`,
        );

        if (projectDependencies.length === 0) {
          continue;
        }

        const projectNeedsAttention = projectDependencies.some(
          (dependency) =>
            !dependency.isSkipped &&
            (dependency.isOutdated || !dependency.latestVersion),
        );

        // Display this project's results immediately (non-buffered cases).
        if (!jsonOutput && !bufferAll) {
          if (workspace.isMonorepo) {
            // Verbose: sections were already streamed inline by checkDependencyVersions.
            if (!verboseProjects) {
              if (projectNeedsAttention) {
                displayAttentionProjectStatus(sectionResults);
              } else {
                displayCompactProjectStatus(projectDependencies);
              }
            }
          }
          // Non-monorepo: sections already streamed inline.
        }

        projectReports.push({
          displayName: project.displayName,
          relativePath: project.relativePath,
          sectionResults,
          projectDependencies,
          projectNeedsAttention,
        });
      }

      scanSpinner?.stop();

      // JSON output always uses the fully buffered data.
      if (jsonOutput) {
        const visibleProjectReports = bufferAll
          ? projectReports.filter((project) => project.projectNeedsAttention)
          : projectReports;
        console.log(
          JSON.stringify(
            createJsonOutput({
              cwd,
              hasCatalogDependencies: workspace.hasCatalogDependencies,
              isMonorepo: workspace.isMonorepo,
              allProjectReports: projectReports,
              projectFilter,
              visibleProjectReports,
            }),
            null,
            2,
          ),
        );
        return 0;
      }

      // Buffer-all display: show only outdated projects after the full scan.
      if (bufferAll) {
        for (const project of projectReports.filter(
          (p) => p.projectNeedsAttention,
        )) {
          console.log(ansi.whiteBold(project.displayName));
          console.log(ansi.gray(`Location: ${project.relativePath}`));
          console.log(ansi.gray('─'.repeat(60)));
          if (verboseProjects) {
            for (const section of project.sectionResults) {
              displayDependencyResults(section);
            }
          } else {
            displayAttentionProjectStatus(project.sectionResults);
          }
        }
      }

      displaySummary(allDependencies, {
        projectCount: projectReports.length,
        projectsWithAttention: projectReports.filter(
          (project) => project.projectNeedsAttention,
        ).length,
      });

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
      if (jsonOutput) {
        console.log(
          JSON.stringify(
            createJsonOutput({
              cwd,
              hasCatalogDependencies: workspace.hasCatalogDependencies,
              isMonorepo: workspace.isMonorepo,
              allProjectReports: [],
              projectFilter,
              visibleProjectReports: [],
            }),
            null,
            2,
          ),
        );
        return 0;
      }

      console.log(ansi.yellow('⚠️  No dependencies found to check'));
    }

    if (!jsonOutput) {
      try {
        await checkForCliUpdate();
      } catch (error) {
        debugLog(`CLI update check failed: ${String(error)}`);
        // Silently fail for CLI updates, i.e. don't let CLI update errors stop the main flow
      }
    }

    return 0;
  } catch (error) {
    console.error(ansi.red(`Error: ${error}`));
    return 1;
  }
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);

  if (index === -1 || index + 1 >= args.length) {
    return undefined;
  }

  const value = args[index + 1];
  return value.startsWith('-') ? undefined : value;
}

function filterProjects<
  T extends { displayName: string; relativePath: string },
>({ projectFilter, projects }: { projectFilter?: string; projects: T[] }): T[] {
  if (!projectFilter) {
    return projects;
  }

  const normalizedFilter = normalizeProjectFilter(projectFilter);

  return projects.filter((project) => {
    const normalizedRelativePath = normalizeProjectFilter(project.relativePath);
    const normalizedDisplayName = normalizeProjectFilter(project.displayName);
    const basename = normalizeProjectFilter(
      normalizedRelativePath.split('/').at(-1) ?? normalizedRelativePath,
    );

    return (
      normalizedFilter === normalizedRelativePath ||
      normalizedFilter === normalizedDisplayName ||
      normalizedFilter === basename
    );
  });
}

function normalizeProjectFilter(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/$/, '').replace(/^\.\//, '');
}

function createProjectNotFoundMessage({
  projectFilter,
  availableProjects,
}: {
  projectFilter: string;
  availableProjects: Array<{ displayName: string; relativePath: string }>;
}): string {
  const projectList = availableProjects
    .map((project) => `${project.displayName} (${project.relativePath})`)
    .join(', ');

  return `No project matched "${projectFilter}". Available projects: ${projectList}`;
}

function createJsonOutput({
  allProjectReports,
  cwd,
  hasCatalogDependencies,
  isMonorepo,
  projectFilter,
  visibleProjectReports,
}: {
  allProjectReports: ProjectReport[];
  cwd: string;
  hasCatalogDependencies: boolean;
  isMonorepo: boolean;
  projectFilter?: string;
  visibleProjectReports: ProjectReport[];
}) {
  const allDependencies = allProjectReports.flatMap(
    (project) => project.projectDependencies,
  );
  const summary = summarizeDependencies(allDependencies);

  return {
    cwd,
    generatedAt: new Date().toISOString(),
    hasCatalogDependencies,
    isMonorepo,
    projectFilter: projectFilter ?? null,
    visibleProjectCount: visibleProjectReports.length,
    projects: visibleProjectReports.map((project) => ({
      displayName: project.displayName,
      relativePath: project.relativePath,
      needsAttention: project.projectNeedsAttention,
      summary: summarizeDependencies(project.projectDependencies),
      sections: project.sectionResults.map((section) => ({
        category: section.category,
        dependencies: section.dependencyInfos,
      })),
    })),
    summary: {
      ...summary,
      projectCount: allProjectReports.length,
      projectsWithAttention: allProjectReports.filter(
        (project) => project.projectNeedsAttention,
      ).length,
    },
  };
}

function summarizeDependencies(allDependencies: DependencyInfo[]) {
  const upToDate = allDependencies.filter(
    (dependency) =>
      !dependency.isOutdated &&
      !dependency.isSkipped &&
      Boolean(dependency.latestVersion),
  ).length;
  const unknown = allDependencies.filter(
    (dependency) => !dependency.latestVersion && !dependency.isSkipped,
  ).length;
  const outdated = allDependencies.filter(
    (dependency) => dependency.isOutdated && !dependency.isSkipped,
  ).length;
  const skipped = allDependencies.filter(
    (dependency) => dependency.isSkipped,
  ).length;

  return {
    total: allDependencies.length,
    upToDate,
    outdated,
    unknown,
    skipped,
    majorUpdates: allDependencies.filter(
      (dependency) =>
        dependency.updateType === 'major' && !dependency.isSkipped,
    ).length,
    minorUpdates: allDependencies.filter(
      (dependency) =>
        dependency.updateType === 'minor' && !dependency.isSkipped,
    ).length,
    patchUpdates: allDependencies.filter(
      (dependency) =>
        dependency.updateType === 'patch' && !dependency.isSkipped,
    ).length,
  };
}

function displayCompactProjectStatus(
  projectDependencies: DependencyInfo[],
): void {
  const upToDateCount = projectDependencies.filter(
    (dependency) =>
      !dependency.isSkipped &&
      !dependency.isOutdated &&
      Boolean(dependency.latestVersion),
  ).length;
  const skippedCount = projectDependencies.filter(
    (dependency) => dependency.isSkipped,
  ).length;

  if (upToDateCount > 0) {
    const packageWord = pluralize({
      count: upToDateCount,
      singular: 'package',
      plural: 'packages',
    });
    console.log(
      `${ansi.green('✓  Up to date:')} ${upToDateCount} ${packageWord}`,
    );
  }

  if (skippedCount > 0) {
    console.log(`  ${ansi.gray('⏭  Skipped:')} ${skippedCount}`);
  }

  console.log();
}

function displayAttentionProjectStatus(
  sectionResults: Array<{
    category: string;
    dependencyInfos: DependencyInfo[];
  }>,
): void {
  const attentionDependencies = sectionResults.flatMap((section) =>
    section.dependencyInfos.filter(
      (dependency) =>
        !dependency.isSkipped &&
        (dependency.isOutdated || !dependency.latestVersion),
    ),
  );
  const outdatedCount = attentionDependencies.filter(
    (dependency) => dependency.isOutdated,
  ).length;
  const unknownCount = attentionDependencies.filter(
    (dependency) => !dependency.latestVersion,
  ).length;

  if (attentionDependencies.length > 0) {
    const packageWord = pluralize({
      count: attentionDependencies.length,
      singular: 'package',
      plural: 'packages',
    });
    const reviewWord = attentionDependencies.length === 1 ? 'needs' : 'need';
    const parts = [
      outdatedCount > 0 && `${outdatedCount} outdated`,
      unknownCount > 0 && `${unknownCount} unknown`,
    ].filter(Boolean);
    const detailText =
      parts.length > 0 ? ` ${ansi.gray(`(${parts.join(', ')})`)}` : '';
    console.log(
      `${ansi.yellow('!  Attention:')} ${attentionDependencies.length} ${packageWord} ${reviewWord} review${detailText}`,
    );
    console.log();
  }

  for (const section of sectionResults) {
    const relevantDependencies = section.dependencyInfos.filter(
      (dependency) =>
        !dependency.isSkipped &&
        (dependency.isOutdated || !dependency.latestVersion),
    );

    if (relevantDependencies.length === 0) {
      continue;
    }

    console.log(ansi.cyanBold(`${section.category}:`));
    console.log(ansi.cyan('─'.repeat(section.category.length + 1)));

    for (const dependency of relevantDependencies) {
      console.log(formatDependencyResult(dependency));
    }

    console.log();
  }
}
