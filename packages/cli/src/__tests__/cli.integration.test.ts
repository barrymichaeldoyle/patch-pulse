import { fileURLToPath } from 'url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkNpmDependencyStatuses,
  fetchNpmPackageManifest,
  type DependencyStatusResult,
} from '@patch-pulse/shared';
import { runCli } from '../cli';

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

describe('runCli integration', () => {
  const basicFixturePath = fileURLToPath(
    new URL('../__fixtures__/projects/basic/', import.meta.url),
  );
  const monorepoFixturePath = fileURLToPath(
    new URL('../__fixtures__/projects/monorepo/', import.meta.url),
  );
  const skipFixturePath = fileURLToPath(
    new URL('../__fixtures__/projects/with-config-skip/', import.meta.url),
  );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchNpmPackageManifest).mockResolvedValue({
      'dist-tags': { latest: '2.9.0' },
    });
  });

  it('reads a fixture project and prints a dependency summary', async () => {
    vi.mocked(checkNpmDependencyStatuses).mockImplementation(
      async (dependencies, options) => {
        const packageNames = Object.keys(dependencies);
        const results = packageNames.map((packageName, index) => {
          const resultMap: Record<string, DependencyStatusResult> = {
            chalk: {
              packageName: 'chalk',
              currentVersion: '5.0.0',
              latestVersion: '5.6.2',
              isOutdated: true,
              updateType: 'minor',
              category: options?.category,
              status: 'update-available',
            },
            lodash: {
              packageName: 'lodash',
              currentVersion: '4.17.21',
              latestVersion: '4.17.21',
              isOutdated: false,
              category: options?.category,
              status: 'up-to-date',
            },
            vitest: {
              packageName: 'vitest',
              currentVersion: '4.0.0',
              latestVersion: '4.1.4',
              isOutdated: true,
              updateType: 'minor',
              category: options?.category,
              status: 'update-available',
            },
          };

          const result = resultMap[packageName as keyof typeof resultMap];
          options?.onResolved?.({
            completedCount: index + 1,
            totalCount: packageNames.length,
            result,
          });

          return result;
        });

        return results;
      },
    );

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const exitCode = await runCli({
      argv: ['--no-update-prompt'],
      cwd: basicFixturePath,
    });

    const output = logSpy.mock.calls.flat().join('\n');

    expect(exitCode).toBe(0);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(checkNpmDependencyStatuses).toHaveBeenCalledTimes(2);
    expect(output).toContain('Dependencies:');
    expect(output).toContain('Dev Dependencies:');
    expect(output).toContain('chalk');
    expect(output).toContain('vitest');
    expect(output).toContain('Summary (3 packages)');
    expect(output).toContain('Up to date:');
    expect(output).toContain('Outdated:');
  });

  it('uses fixture config to skip packages before checking versions', async () => {
    vi.mocked(checkNpmDependencyStatuses).mockResolvedValue([
      {
        packageName: 'lodash',
        currentVersion: '4.17.20',
        latestVersion: '4.17.21',
        isOutdated: true,
        updateType: 'patch',
        category: 'Dependencies',
        status: 'update-available',
      },
    ]);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const exitCode = await runCli({ cwd: skipFixturePath });
    const output = logSpy.mock.calls.flat().join('\n');

    expect(exitCode).toBe(0);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(checkNpmDependencyStatuses).toHaveBeenCalledWith(
      { lodash: '^4.17.20' },
      expect.objectContaining({
        category: 'Dependencies',
      }),
    );
    expect(output).toContain('react');
    expect(output).toContain('SKIPPED');
    expect(output).toContain('Skipped:');
  });

  it('scans monorepo package.json files and resolves pnpm catalogs', async () => {
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

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const exitCode = await runCli({ cwd: monorepoFixturePath });
    const output = logSpy.mock.calls.flat().join('\n');

    expect(exitCode).toBe(0);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(checkNpmDependencyStatuses).toHaveBeenCalledTimes(3);
    expect(output).toContain('@fixture/admin (packages/admin)');
    expect(output).toContain('@fixture/app (packages/app)');
    expect(output).toContain('react');
    expect(output).toContain('lodash');
    expect(output).toContain('vitest');
    expect(output).toContain('Summary (3 packages)');
    expect(output).not.toContain('@repo/shared');
  });
});
