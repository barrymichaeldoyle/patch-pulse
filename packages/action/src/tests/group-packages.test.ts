import { describe, expect, it } from 'vitest';
import { groupPackages } from '../group-packages';
import type { CliDependency, CliOutput } from '../types';

function makeCliOutput(
  deps: Array<
    Pick<
      CliDependency,
      'packageName' | 'currentVersion' | 'latestVersion' | 'updateType'
    > & {
      packageJsonPath?: string;
      isSkipped?: boolean;
    }
  >,
  isMonorepo = false,
): CliOutput {
  return {
    cwd: '/project',
    generatedAt: new Date().toISOString(),
    isMonorepo,
    projects: [
      {
        displayName: 'my-app',
        relativePath: '.',
        needsAttention: true,
        sections: [
          {
            category: 'Dependencies',
            dependencies: deps.map((dep) => ({
              packageName: dep.packageName,
              currentVersion: dep.currentVersion,
              latestVersion: dep.latestVersion,
              isOutdated: true,
              updateType: dep.updateType,
              isSkipped: dep.isSkipped ?? false,
              source: {
                packageJsonPath: dep.packageJsonPath ?? '/project/package.json',
                rawVersion: dep.currentVersion,
                resolvedVersion: dep.currentVersion,
                section: 'dependencies' as const,
                sourceType: 'direct' as const,
                projectDisplayName: 'my-app',
                projectRelativePath: '.',
              },
            })),
          },
        ],
      },
    ],
    summary: {
      total: deps.length,
      upToDate: 0,
      outdated: deps.length,
      unknown: 0,
      skipped: 0,
      majorUpdates: 0,
      minorUpdates: 0,
      patchUpdates: 0,
      projectCount: 1,
      projectsWithAttention: 1,
    },
  };
}

describe('groupPackages', () => {
  it('returns empty array when no packages are outdated', () => {
    expect(
      groupPackages({
        cliOutput: makeCliOutput([]),
        groups: {},
        updateTypes: ['patch', 'minor', 'major'],
      }),
    ).toEqual([]);
  });

  it('creates one group per package when no groups are configured', () => {
    const cliOutput = makeCliOutput([
      {
        packageName: 'react',
        currentVersion: '18.0.0',
        latestVersion: '19.0.0',
        updateType: 'major',
      },
      {
        packageName: 'lodash',
        currentVersion: '4.0.0',
        latestVersion: '4.17.21',
        updateType: 'patch',
      },
    ]);
    const result = groupPackages({
      cliOutput,
      groups: {},
      updateTypes: ['patch', 'minor', 'major'],
    });
    expect(result).toHaveLength(2);
    expect(result.map((g) => g.name).sort()).toEqual(['lodash', 'react']);
  });

  it('bundles configured packages into a single group', () => {
    const cliOutput = makeCliOutput([
      {
        packageName: '@tanstack/router',
        currentVersion: '1.0.0',
        latestVersion: '1.1.0',
        updateType: 'minor',
      },
      {
        packageName: '@tanstack/start',
        currentVersion: '1.0.0',
        latestVersion: '1.1.0',
        updateType: 'minor',
      },
    ]);
    const result = groupPackages({
      cliOutput,
      groups: { tanstack: ['@tanstack/router', '@tanstack/start'] },
      updateTypes: ['patch', 'minor', 'major'],
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('tanstack');
    expect(result[0].packages).toHaveLength(2);
  });

  it('uses the highest update type for a group', () => {
    const cliOutput = makeCliOutput([
      {
        packageName: '@tanstack/router',
        currentVersion: '1.0.0',
        latestVersion: '2.0.0',
        updateType: 'major',
      },
      {
        packageName: '@tanstack/start',
        currentVersion: '1.0.0',
        latestVersion: '1.1.0',
        updateType: 'minor',
      },
    ]);
    const result = groupPackages({
      cliOutput,
      groups: { tanstack: ['@tanstack/router', '@tanstack/start'] },
      updateTypes: ['minor', 'major'],
    });
    expect(result[0].highestUpdateType).toBe('major');
  });

  it('filters out packages not in updateTypes', () => {
    const cliOutput = makeCliOutput([
      {
        packageName: 'react',
        currentVersion: '18.0.0',
        latestVersion: '19.0.0',
        updateType: 'major',
      },
      {
        packageName: 'lodash',
        currentVersion: '4.0.0',
        latestVersion: '4.17.21',
        updateType: 'patch',
      },
    ]);
    const result = groupPackages({
      cliOutput,
      groups: {},
      updateTypes: ['patch'],
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('lodash');
  });

  it('ignores skipped packages', () => {
    const cliOutput = makeCliOutput([
      {
        packageName: 'react',
        currentVersion: '18.0.0',
        latestVersion: '19.0.0',
        updateType: 'major',
        isSkipped: true,
      },
    ]);
    expect(
      groupPackages({ cliOutput, groups: {}, updateTypes: ['major'] }),
    ).toHaveLength(0);
  });

  it('ignores packages without a latestVersion', () => {
    const cliOutput = makeCliOutput([
      {
        packageName: 'react',
        currentVersion: '18.0.0',
        latestVersion: undefined,
        updateType: undefined,
      },
    ]);
    expect(
      groupPackages({
        cliOutput,
        groups: {},
        updateTypes: ['patch', 'minor', 'major'],
      }),
    ).toHaveLength(0);
  });

  describe('branch name generation', () => {
    it('uses the package name directly for plain packages', () => {
      const cliOutput = makeCliOutput([
        {
          packageName: 'lodash',
          currentVersion: '4.0.0',
          latestVersion: '5.0.0',
          updateType: 'major',
        },
      ]);
      const [group] = groupPackages({
        cliOutput,
        groups: {},
        updateTypes: ['major'],
      });
      expect(group.branchName).toBe('patch-pulse/lodash');
    });

    it('strips the @ and converts / to - for scoped packages', () => {
      const cliOutput = makeCliOutput([
        {
          packageName: '@tanstack/router',
          currentVersion: '1.0.0',
          latestVersion: '2.0.0',
          updateType: 'major',
        },
      ]);
      const [group] = groupPackages({
        cliOutput,
        groups: {},
        updateTypes: ['major'],
      });
      expect(group.branchName).toBe('patch-pulse/tanstack-router');
    });

    it('uses the group name for configured groups', () => {
      const cliOutput = makeCliOutput([
        {
          packageName: '@tanstack/router',
          currentVersion: '1.0.0',
          latestVersion: '2.0.0',
          updateType: 'major',
        },
      ]);
      const [group] = groupPackages({
        cliOutput,
        groups: { tanstack: ['@tanstack/router'] },
        updateTypes: ['major'],
      });
      expect(group.branchName).toBe('patch-pulse/tanstack');
    });
  });

  it('deduplicates occurrences of the same package across monorepo workspaces', () => {
    const cliOutput: CliOutput = {
      cwd: '/monorepo',
      generatedAt: new Date().toISOString(),
      isMonorepo: true,
      projects: ['packages/app-a', 'packages/app-b'].map((relativePath) => ({
        displayName: relativePath,
        relativePath,
        needsAttention: true,
        sections: [
          {
            category: 'Dependencies',
            dependencies: [
              {
                packageName: 'react',
                currentVersion: '18.0.0',
                latestVersion: '19.0.0',
                isOutdated: true,
                updateType: 'major' as const,
                source: {
                  packageJsonPath: `/monorepo/${relativePath}/package.json`,
                  rawVersion: '18.0.0',
                  resolvedVersion: '18.0.0',
                  section: 'dependencies' as const,
                  sourceType: 'direct' as const,
                  projectDisplayName: relativePath,
                  projectRelativePath: relativePath,
                },
              },
            ],
          },
        ],
      })),
      summary: {
        total: 2,
        upToDate: 0,
        outdated: 2,
        unknown: 0,
        skipped: 0,
        majorUpdates: 2,
        minorUpdates: 0,
        patchUpdates: 0,
        projectCount: 2,
        projectsWithAttention: 2,
      },
    };

    const result = groupPackages({
      cliOutput,
      groups: {},
      updateTypes: ['major'],
    });
    expect(result).toHaveLength(1);
    expect(result[0].packages[0].occurrences).toHaveLength(2);
    expect(
      result[0].packages[0].occurrences.map((o) => o.packageJsonPath),
    ).toEqual([
      '/monorepo/packages/app-a/package.json',
      '/monorepo/packages/app-b/package.json',
    ]);
  });
});
