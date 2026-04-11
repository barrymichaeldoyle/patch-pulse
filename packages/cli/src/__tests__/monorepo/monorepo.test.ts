import { fileURLToPath } from 'url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkNpmDependencyStatuses,
  fetchNpmPackageManifest,
} from '@patch-pulse/shared';
import { runCli } from '../../cli';
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

const fixturePath = fileURLToPath(new URL('./__fixtures__/', import.meta.url));

describe('monorepo project', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchNpmPackageManifest).mockResolvedValue({
      'dist-tags': { latest: '2.9.0' },
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
});
