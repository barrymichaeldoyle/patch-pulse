import { fileURLToPath } from 'url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkNpmDependencyStatuses,
  fetchNpmPackageManifest,
  type DependencyStatusResult,
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

const mockResults: Record<string, DependencyStatusResult> = {
  chalk: {
    packageName: 'chalk',
    currentVersion: '5.0.0',
    latestVersion: '5.6.2',
    isOutdated: true,
    updateType: 'minor',
    category: 'Dependencies',
    status: 'update-available',
  },
  lodash: {
    packageName: 'lodash',
    currentVersion: '4.17.21',
    latestVersion: '4.17.21',
    isOutdated: false,
    category: 'Dependencies',
    status: 'up-to-date',
  },
  vitest: {
    packageName: 'vitest',
    currentVersion: '4.0.0',
    latestVersion: '4.1.4',
    isOutdated: true,
    updateType: 'minor',
    category: 'Dev Dependencies',
    status: 'update-available',
  },
};

describe('basic project', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchNpmPackageManifest).mockResolvedValue({
      'dist-tags': { latest: '2.9.0' },
    });
    vi.mocked(checkNpmDependencyStatuses).mockImplementation(
      async (dependencies, options) => {
        return Object.keys(dependencies).map((packageName, index) => {
          const result = mockResults[packageName];
          options?.onResolved?.({
            completedCount: index + 1,
            totalCount: Object.keys(dependencies).length,
            result,
          });
          return result;
        });
      },
    );
  });

  it('checks dependencies and dev dependencies separately', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const exitCode = await runCli({
      argv: ['--no-update-prompt'],
      cwd: fixturePath,
    });

    expect(exitCode).toBe(0);
    expect(checkNpmDependencyStatuses).toHaveBeenCalledTimes(2);
    expect(checkNpmDependencyStatuses).toHaveBeenCalledWith(
      { chalk: '^5.0.0', lodash: '^4.17.21' },
      expect.objectContaining({ category: 'Dependencies' }),
    );
    expect(checkNpmDependencyStatuses).toHaveBeenCalledWith(
      { vitest: '^4.0.0' },
      expect.objectContaining({ category: 'Dev Dependencies' }),
    );
  });

  it('prints a full dependency summary', async () => {
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
