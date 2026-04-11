import { describe, expect, it } from 'vitest';
import { formatDependencyResult } from '../dependency-checker';

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
