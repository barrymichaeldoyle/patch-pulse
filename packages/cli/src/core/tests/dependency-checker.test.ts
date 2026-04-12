import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkNpmDependencyStatuses } from '@patch-pulse/shared';
import {
  checkDependencyVersions,
  formatDependencyResult,
} from '../dependency-checker';

vi.mock('@patch-pulse/shared', async () => {
  const actual = await vi.importActual<typeof import('@patch-pulse/shared')>(
    '@patch-pulse/shared',
  );

  return {
    ...actual,
    checkNpmDependencyStatuses: vi.fn(),
  };
});

describe('formatDependencyResult', () => {
  it('renders lookup-failed dependencies as UNKNOWN', () => {
    const result = formatDependencyResult({
      packageName: 'react',
      currentVersion: '18.2.0',
      latestVersion: undefined,
      isOutdated: false,
      status: 'lookup-failed',
    });

    expect(result).toContain('UNKNOWN');
    expect(result).toContain('lookup failed');
    expect(result).not.toContain('NOT FOUND');
  });
});

describe('checkDependencyVersions', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stops the progress spinner before returning results', async () => {
    vi.mocked(checkNpmDependencyStatuses).mockResolvedValue([
      {
        packageName: 'react',
        currentVersion: '18.2.0',
        latestVersion: '19.2.0',
        isOutdated: true,
        status: 'update-available',
        updateType: 'major',
      },
    ]);

    await checkDependencyVersions(
      { react: '18.2.0' },
      'Dependencies',
      undefined,
      { silent: false },
    );

    expect(process.stdout.write).toHaveBeenCalledWith('\r\x1B[2K');
  });
});
