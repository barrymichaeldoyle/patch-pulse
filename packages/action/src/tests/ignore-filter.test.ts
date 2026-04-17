import { describe, expect, it } from 'vitest';
import { applyIgnoreList } from '../ignore-filter';
import type { PackageGroup } from '../types';

function makeGroup(name: string, packageNames: string[]): PackageGroup {
  return {
    name,
    packages: packageNames.map((packageName) => ({
      packageName,
      currentVersion: '1.0.0',
      latestVersion: '2.0.0',
      updateType: 'major',
      occurrences: [
        {
          packageJsonPath: '/project/package.json',
          rawVersion: '1.0.0',
          section: 'dependencies',
        },
      ],
    })),
    highestUpdateType: 'major',
    branchName: `patch-pulse/${name}`,
  };
}

describe('applyIgnoreList', () => {
  it('returns all groups unchanged when ignore list is empty', () => {
    const groups = [
      makeGroup('react', ['react']),
      makeGroup('lodash', ['lodash']),
    ];
    expect(applyIgnoreList(groups, [])).toEqual(groups);
  });

  it('removes packages matching exact names', () => {
    const groups = [makeGroup('group', ['react', 'react-dom'])];
    const result = applyIgnoreList(groups, ['react']);
    expect(result[0].packages).toHaveLength(1);
    expect(result[0].packages[0].packageName).toBe('react-dom');
  });

  it('does not partially match names without a wildcard', () => {
    // 'react' should NOT remove 'react-dom'
    const groups = [makeGroup('group', ['react', 'react-dom'])];
    const result = applyIgnoreList(groups, ['react']);
    expect(result[0].packages.map((p) => p.packageName)).toContain('react-dom');
  });

  it('removes groups that become empty after filtering', () => {
    const groups = [makeGroup('react', ['react'])];
    expect(applyIgnoreList(groups, ['react'])).toHaveLength(0);
  });

  it('matches @scope/* wildcard patterns', () => {
    const groups = [
      makeGroup('types', ['@types/react', '@types/node', 'typescript']),
    ];
    const result = applyIgnoreList(groups, ['@types/*']);
    expect(result[0].packages).toHaveLength(1);
    expect(result[0].packages[0].packageName).toBe('typescript');
  });

  it('matches prefix wildcard patterns', () => {
    const groups = [
      makeGroup('eslint', [
        'eslint',
        'eslint-plugin-react',
        'eslint-config-prettier',
      ]),
    ];
    const result = applyIgnoreList(groups, ['eslint-*']);
    expect(result[0].packages).toHaveLength(1);
    expect(result[0].packages[0].packageName).toBe('eslint');
  });

  it('applies multiple patterns across multiple groups', () => {
    const groups = [
      makeGroup('group1', ['react', 'lodash']),
      makeGroup('group2', ['@types/node', 'typescript']),
    ];
    const result = applyIgnoreList(groups, ['react', '@types/*']);
    expect(result[0].packages.map((p) => p.packageName)).toEqual(['lodash']);
    expect(result[1].packages.map((p) => p.packageName)).toEqual([
      'typescript',
    ]);
  });

  it('handles a mix of exact and wildcard patterns', () => {
    const groups = [
      makeGroup('group', ['vite', 'vitest', '@vitejs/plugin-react']),
    ];
    const result = applyIgnoreList(groups, ['vite', '@vitejs/*']);
    expect(result[0].packages.map((p) => p.packageName)).toEqual(['vitest']);
  });
});
