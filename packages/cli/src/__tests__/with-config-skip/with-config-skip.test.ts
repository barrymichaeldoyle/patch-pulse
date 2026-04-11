import { fileURLToPath } from 'url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkNpmDependencyStatuses,
  fetchNpmPackageManifest,
} from '@patch-pulse/shared';
import { runCli } from '../../cli';

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
const stripAnsi = (str: string) => str.replace(/\x1B\[[0-9;]*m/g, '');

describe('project with config skip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchNpmPackageManifest).mockResolvedValue({
      'dist-tags': { latest: '2.9.0' },
    });
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
  });

  it('skips packages listed in patchpulse.config.json before checking versions', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const exitCode = await runCli({ cwd: fixturePath });

    expect(exitCode).toBe(0);
    // react is in the config skip list — only lodash should be checked
    expect(checkNpmDependencyStatuses).toHaveBeenCalledWith(
      { lodash: '^4.17.20' },
      expect.objectContaining({ category: 'Dependencies' }),
    );
  });

  it('prints skipped packages alongside checked ones', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const exitCode = await runCli({ cwd: fixturePath });

    expect(exitCode).toBe(0);
    expect(stripAnsi(logSpy.mock.calls.flat().join('\n'))).toMatchSnapshot();
  });
});
