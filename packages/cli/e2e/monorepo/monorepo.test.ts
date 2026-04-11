import { fileURLToPath } from 'url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkNpmDependencyStatuses,
  fetchNpmPackageManifest,
} from '@patch-pulse/shared';
import { runCli } from '../../src/cli';
import { stripAnsi } from '../test-utils';

vi.mock('@patch-pulse/shared', async () => {
  const actual = await vi.importActual<typeof import('@patch-pulse/shared')>(
    '@patch-pulse/shared',
  );
  return {
    ...actual,
    checkNpmDependencyStatuses: vi.fn(),
    fetchNpmPackageManifest: vi.fn(),
  };
});

const fixturePath = fileURLToPath(new URL('./fixtures/', import.meta.url));

describe('monorepo project', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchNpmPackageManifest).mockResolvedValue({
      'dist-tags': { latest: '3.0.0' },
    });
    vi.mocked(checkNpmDependencyStatuses).mockImplementation(
      async (dependencies, options) => {
        const results = Object.entries(dependencies).map(
          ([packageName, currentVersion]) => ({
            packageName,
            currentVersion,
            latestVersion: currentVersion,
            isOutdated: false,
            category: options?.category,
            status: 'up-to-date' as const,
          }),
        );
        results.forEach((result, index) => {
          options?.onResolved?.({
            completedCount: index + 1,
            totalCount: results.length,
            result,
          });
        });
        return results;
      },
    );
  });

  it('scans all workspace packages and resolves pnpm catalogs', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const exitCode = await runCli({
      argv: ['--no-update-prompt'],
      cwd: fixturePath,
    });

    expect(exitCode).toBe(0);
    // admin (lodash), app (react), app devDeps (vitest)
    expect(checkNpmDependencyStatuses).toHaveBeenCalledTimes(3);
  });

  it('excludes workspace:* dependencies and packages with no external deps', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await runCli({ argv: ['--no-update-prompt'], cwd: fixturePath });

    // @repo/shared (no deps) and workspace:* entries should never appear
    const allCalls = vi
      .mocked(checkNpmDependencyStatuses)
      .mock.calls.flatMap(([deps]) => Object.keys(deps));

    expect(allCalls).not.toContain('@repo/shared');
  });

  it('prints a full monorepo summary', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const exitCode = await runCli({
      argv: ['--no-update-prompt'],
      cwd: fixturePath,
    });

    expect(exitCode).toBe(0);
    expect(stripAnsi(logSpy.mock.calls.flat().join('\n'))).toMatchSnapshot();
  });

  it('prints full sections for clean projects with --verbose-projects', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const exitCode = await runCli({
      argv: ['--verbose-projects', '--no-update-prompt'],
      cwd: fixturePath,
    });

    expect(exitCode).toBe(0);
    const output = stripAnsi(logSpy.mock.calls.flat().join('\n'));
    expect(output).toContain('Dependencies:');
    expect(output).toContain('Dev Dependencies:');
    expect(output).not.toContain('✓  Up to date: 1 package');
  });

  it('hides clean projects with --only-outdated', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.mocked(checkNpmDependencyStatuses).mockImplementation(
      async (dependencies, options) => {
        const results = Object.entries(dependencies).map(
          ([packageName, currentVersion]) => ({
            packageName,
            currentVersion,
            latestVersion: packageName === 'react' ? '19.0.0' : currentVersion,
            isOutdated: packageName === 'react',
            updateType:
              packageName === 'react' ? ('major' as const) : undefined,
            category: options?.category,
            status:
              packageName === 'react'
                ? ('update-available' as const)
                : ('up-to-date' as const),
          }),
        );
        results.forEach((result, index) => {
          options?.onResolved?.({
            completedCount: index + 1,
            totalCount: results.length,
            result,
          });
        });
        return results;
      },
    );

    const exitCode = await runCli({
      argv: ['--only-outdated', '--no-update-prompt'],
      cwd: fixturePath,
    });

    expect(exitCode).toBe(0);
    const output = stripAnsi(logSpy.mock.calls.flat().join('\n'));
    expect(output).not.toContain('@fixture/admin (packages/admin)');
    expect(output).toContain('@fixture/app (packages/app)');
    expect(output).toContain(
      '!  Attention: 1 package needs review (1 outdated)',
    );
  });

  it('filters to one project with --project', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const exitCode = await runCli({
      argv: ['--project', 'packages/app', '--no-update-prompt'],
      cwd: fixturePath,
    });

    expect(exitCode).toBe(0);
    const output = stripAnsi(logSpy.mock.calls.flat().join('\n'));
    expect(output).toContain('@fixture/app (packages/app)');
    expect(output).not.toContain('@fixture/admin (packages/admin)');
    expect(output).not.toContain('@repo/shared');
  });

  it('prints filtered monorepo json with --json and --project', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.mocked(checkNpmDependencyStatuses).mockImplementation(
      async (dependencies, options) => {
        const results = Object.entries(dependencies).map(
          ([packageName, currentVersion]) => ({
            packageName,
            currentVersion,
            latestVersion: packageName === 'react' ? '19.0.0' : currentVersion,
            isOutdated: packageName === 'react',
            updateType:
              packageName === 'react' ? ('major' as const) : undefined,
            category: options?.category,
            status:
              packageName === 'react'
                ? ('update-available' as const)
                : ('up-to-date' as const),
          }),
        );
        results.forEach((result, index) => {
          options?.onResolved?.({
            completedCount: index + 1,
            totalCount: results.length,
            result,
          });
        });
        return results;
      },
    );

    const exitCode = await runCli({
      argv: ['--json', '--project', 'packages/app', '--no-update-prompt'],
      cwd: fixturePath,
    });

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(logSpy.mock.calls.flat().join('\n')) as {
      projectFilter: string | null;
      visibleProjectCount: number;
      projects: Array<{
        displayName: string;
        relativePath: string;
        needsAttention: boolean;
      }>;
      summary: { projectCount: number; projectsWithAttention: number };
    };

    expect(parsed.projectFilter).toBe('packages/app');
    expect(parsed.visibleProjectCount).toBe(1);
    expect(parsed.projects).toMatchObject([
      {
        displayName: '@fixture/app (packages/app)',
        relativePath: 'packages/app',
        needsAttention: true,
      },
    ]);
    expect(parsed.summary.projectCount).toBe(1);
    expect(parsed.summary.projectsWithAttention).toBe(1);
  });
});
