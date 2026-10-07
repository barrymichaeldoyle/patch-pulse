import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createReleaseAgePolicy,
  formatReleaseAge,
  resolveReleaseAgeSettings,
} from '../releaseAge';

describe('resolveReleaseAgeSettings', () => {
  const tempDirs: string[] = [];

  function makeDir(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'patch-pulse-release-age-'));
    tempDirs.push(dir);
    for (const [name, contents] of Object.entries(files)) {
      writeFileSync(join(dir, name), contents);
    }
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs) rmSync(dir, { force: true, recursive: true });
    tempDirs.length = 0;
  });

  it('prefers explicit patch-pulse config over package manager settings', () => {
    const cwd = makeDir({ 'pnpm-workspace.yaml': 'minimumReleaseAge: 10\n' });
    expect(
      resolveReleaseAgeSettings({
        cwd,
        config: { minimumReleaseAge: 120, minimumReleaseAgeExclude: ['foo'] },
        packageManager: 'pnpm',
      }),
    ).toEqual({
      minimumAgeMinutes: 120,
      exclude: ['foo'],
      source: 'patch-pulse config',
    });
  });

  it('returns null when the gate is explicitly disabled', () => {
    const cwd = makeDir({ 'pnpm-workspace.yaml': 'minimumReleaseAge: 10\n' });
    expect(
      resolveReleaseAgeSettings({
        cwd,
        config: { minimumReleaseAge: 0 },
        packageManager: 'pnpm',
      }),
    ).toBeNull();
  });

  it('returns null when nothing is configured', () => {
    const cwd = makeDir({ 'package.json': '{}' });
    expect(
      resolveReleaseAgeSettings({ cwd, packageManager: 'npm' }),
    ).toBeNull();
  });

  describe('pnpm', () => {
    it('reads minutes and the exclude list from pnpm-workspace.yaml', () => {
      const cwd = makeDir({
        'pnpm-workspace.yaml': [
          'packages:',
          '  - packages/*',
          '',
          'minimumReleaseAge: 1440 # one day',
          'minimumReleaseAgeExclude:',
          "  - '@myorg/*'",
          '  - webpack@4.47.0 || 5.102.1',
          '',
        ].join('\n'),
      });
      expect(
        resolveReleaseAgeSettings({ cwd, packageManager: 'pnpm' }),
      ).toEqual({
        minimumAgeMinutes: 1440,
        exclude: ['@myorg/*', 'webpack@4.47.0 || 5.102.1'],
        source: 'pnpm-workspace.yaml',
      });
    });

    it('reads .npmrc when the workspace file has no setting', () => {
      const cwd = makeDir({
        '.npmrc': [
          'minimum-release-age=60',
          'minimum-release-age-exclude[]=react',
          'minimum-release-age-exclude[]=@types/node',
          '',
        ].join('\n'),
      });
      expect(
        resolveReleaseAgeSettings({ cwd, packageManager: 'pnpm' }),
      ).toEqual({
        minimumAgeMinutes: 60,
        exclude: ['react', '@types/node'],
        source: '.npmrc',
      });
    });

    it('applies the one day default for pnpm 11', () => {
      const cwd = makeDir({
        'package.json': JSON.stringify({ packageManager: 'pnpm@11.17.0' }),
      });
      expect(
        resolveReleaseAgeSettings({ cwd, packageManager: 'pnpm' }),
      ).toEqual({
        minimumAgeMinutes: 1440,
        exclude: [],
        source: 'pnpm 11 default',
      });
    });

    it('does not apply the default for pnpm 10', () => {
      const cwd = makeDir({
        'package.json': JSON.stringify({ packageManager: 'pnpm@10.20.0' }),
      });
      expect(
        resolveReleaseAgeSettings({ cwd, packageManager: 'pnpm' }),
      ).toBeNull();
    });

    it('merges patch-pulse excludes with the package manager list', () => {
      const cwd = makeDir({
        'pnpm-workspace.yaml':
          'minimumReleaseAge: 30\nminimumReleaseAgeExclude:\n  - a\n',
      });
      expect(
        resolveReleaseAgeSettings({
          cwd,
          config: { minimumReleaseAgeExclude: ['b'] },
          packageManager: 'pnpm',
        }),
      ).toMatchObject({ exclude: ['a', 'b'] });
    });
  });

  describe('bun', () => {
    it('converts seconds from bunfig.toml to minutes', () => {
      const cwd = makeDir({
        'bunfig.toml': [
          '[install]',
          'minimumReleaseAge = 259200 # 3 days',
          'minimumReleaseAgeExcludes = ["@types/node", "typescript"]',
          '',
        ].join('\n'),
      });
      expect(resolveReleaseAgeSettings({ cwd, packageManager: 'bun' })).toEqual(
        {
          minimumAgeMinutes: 4320,
          exclude: ['@types/node', 'typescript'],
          source: 'bunfig.toml',
        },
      );
    });
  });

  describe('npm', () => {
    it('converts days from .npmrc to minutes', () => {
      const cwd = makeDir({ '.npmrc': 'min-release-age=2\n' });
      expect(resolveReleaseAgeSettings({ cwd, packageManager: 'npm' })).toEqual(
        { minimumAgeMinutes: 2880, exclude: [], source: '.npmrc' },
      );
    });
  });

  describe('yarn', () => {
    it('parses duration strings from .yarnrc.yml', () => {
      const cwd = makeDir({
        '.yarnrc.yml':
          'npmMinimalAgeGate: 7d\nnpmPreapprovedPackages:\n  - "@yarnpkg/*"\n',
      });
      expect(
        resolveReleaseAgeSettings({ cwd, packageManager: 'yarn' }),
      ).toEqual({
        minimumAgeMinutes: 10080,
        exclude: ['@yarnpkg/*'],
        source: '.yarnrc.yml',
      });
    });

    it('parses plain minutes from .yarnrc.yml', () => {
      const cwd = makeDir({ '.yarnrc.yml': 'npmMinimalAgeGate: 90\n' });
      expect(
        resolveReleaseAgeSettings({ cwd, packageManager: 'yarn' }),
      ).toMatchObject({ minimumAgeMinutes: 90 });
    });
  });
});

describe('createReleaseAgePolicy', () => {
  const policy = createReleaseAgePolicy({
    minimumAgeMinutes: 60,
    exclude: ['react', '@myorg/*', 'webpack@4.47.0 || 5.102.1'],
    source: 'test',
  });

  it('converts minutes to milliseconds', () => {
    expect(policy.minimumAgeMs).toBe(3_600_000);
  });

  it('excludes exact names and glob patterns for any version', () => {
    expect(policy.isExcluded?.('react', '19.0.0')).toBe(true);
    expect(policy.isExcluded?.('@myorg/ui', '0.0.1')).toBe(true);
    expect(policy.isExcluded?.('vue', '3.0.0')).toBe(false);
  });

  it('excludes only the listed versions for version specifiers', () => {
    expect(policy.isExcluded?.('webpack', '4.47.0')).toBe(true);
    expect(policy.isExcluded?.('webpack', '5.102.1')).toBe(true);
    expect(policy.isExcluded?.('webpack', '5.103.0')).toBe(false);
  });
});

describe('formatReleaseAge', () => {
  it('picks the largest whole unit', () => {
    expect(formatReleaseAge(1440)).toBe('1 day');
    expect(formatReleaseAge(4320)).toBe('3 days');
    expect(formatReleaseAge(120)).toBe('2 hours');
    expect(formatReleaseAge(90)).toBe('90 minutes');
    expect(formatReleaseAge(1)).toBe('1 minute');
  });
});
