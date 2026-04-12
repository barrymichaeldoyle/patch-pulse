import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getConfig,
  mergeConfigs,
  parseCliConfig,
  readConfigFile,
  shouldIgnorePath,
  shouldIncludePath,
  shouldSkipPackage,
  type PatchPulseConfig,
} from '../config';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock('path', () => ({
  join: vi.fn(),
}));

describe('Configuration Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getConfig', () => {
    it('should return the config', () => {
      const config = getConfig();
      expect(config).toEqual({
        skip: [],
        ignorePaths: [],
        includePaths: [],
        interactive: false,
      });
    });
  });

  describe('readConfigFile', () => {
    it('should return null when no config file exists', () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(join).mockReturnValue('/test/patchpulse.config.json');

      const result = readConfigFile('/test');

      expect(result).toBeNull();
    });

    it('should read and parse patchpulse.config.json file', () => {
      const mockConfig = {
        skip: ['lodash', 'express', '@types/*', 'test-*'],
        ignorePaths: ['packages/cli/e2e'],
      };

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(join).mockReturnValue('/test/patchpulse.config.json');
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockConfig));

      const result = readConfigFile('/test');

      expect(result).toEqual(mockConfig);
    });

    it('should handle invalid JSON gracefully', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(join).mockReturnValue('/test/patchpulse.config.json');
      vi.mocked(readFileSync).mockReturnValue('invalid json');

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = readConfigFile('/test');

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(
          /Warning: Could not parse patchpulse(\.(config))?\.json: SyntaxError: Unexpected token/,
        ),
      );

      consoleSpy.mockRestore();
    });

    it('should ignore unsupported package manager values from file config', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(join).mockReturnValue('/test/patchpulse.json');
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          interactive: true,
          packageManager: 'nope',
          skip: ['lodash'],
        }),
      );

      const result = readConfigFile('/test');

      expect(result).toEqual({
        interactive: true,
        skip: ['lodash'],
      });
    });
  });

  describe('parseCliConfig', () => {
    it('should parse --skip argument', () => {
      const args = ['--skip', 'lodash,express,chalk,@types/*'];
      const result = parseCliConfig(args);

      expect(result).toEqual({
        skip: ['lodash', 'express', 'chalk', '@types/*'],
      });
    });

    it('should parse -s argument', () => {
      const args = ['-s', 'lodash,express,chalk,@types/*'];
      const result = parseCliConfig(args);

      expect(result).toEqual({
        skip: ['lodash', 'express', 'chalk', '@types/*'],
      });
    });

    it('should ignore arguments that start with dash', () => {
      const args = ['--skip', '--help'];
      const result = parseCliConfig(args);

      expect(result).toEqual({});
    });

    it('should ignore arguments that start with dash for short flag', () => {
      const args = ['-s', '--help'];
      const result = parseCliConfig(args);

      expect(result).toEqual({});
    });
  });

  describe('mergeConfigs', () => {
    it('should merge file and CLI configs', () => {
      const fileConfig: PatchPulseConfig = {
        skip: ['lodash', '@types/*'],
        ignorePaths: ['packages/cli/e2e'],
        includePaths: ['dist/special'],
      };

      const cliConfig: PatchPulseConfig = {
        skip: ['express', 'test-*'],
        ignorePaths: ['packages/shared/tests'],
        includePaths: ['build/other'],
      };

      const result = mergeConfigs(fileConfig, cliConfig);

      expect(result).toEqual({
        skip: ['lodash', '@types/*', 'express', 'test-*'],
        ignorePaths: ['packages/cli/e2e', 'packages/shared/tests'],
        includePaths: ['dist/special', 'build/other'],
        interactive: false,
      });
    });

    it('should handle null file config', () => {
      const cliConfig: PatchPulseConfig = {
        skip: ['express', 'test-*'],
      };

      const result = mergeConfigs(null, cliConfig);

      expect(result).toEqual({
        skip: ['express', 'test-*'],
        ignorePaths: [],
        includePaths: [],
        interactive: false,
      });
    });

    it('should handle empty CLI config', () => {
      const fileConfig: PatchPulseConfig = {
        skip: ['lodash', '@types/*'],
        ignorePaths: ['packages/cli/e2e'],
        includePaths: ['dist/special'],
      };

      const result = mergeConfigs(fileConfig, {});

      expect(result).toEqual({
        skip: ['lodash', '@types/*'],
        ignorePaths: ['packages/cli/e2e'],
        includePaths: ['dist/special'],
        interactive: false,
      });
    });
  });

  describe('shouldSkipPackage', () => {
    it('should skip exact matches', () => {
      const config: PatchPulseConfig = {
        skip: ['lodash', 'express'],
      };

      expect(shouldSkipPackage({ packageName: 'lodash', config })).toBe(true);
      expect(shouldSkipPackage({ packageName: 'express', config })).toBe(true);
      expect(shouldSkipPackage({ packageName: 'chalk', config })).toBe(false);
    });

    it('should skip packages matching patterns', () => {
      const config: PatchPulseConfig = {
        skip: ['@types/*', 'test-*'],
      };

      expect(
        shouldSkipPackage({
          packageName: '@types/node',
          config,
        }),
      ).toBe(true);
      expect(
        shouldSkipPackage({
          packageName: 'test-utils',
          config,
        }),
      ).toBe(true);
      expect(
        shouldSkipPackage({
          packageName: '@typescript-eslint/parser',
          config,
        }),
      ).toBe(false);
      expect(shouldSkipPackage({ packageName: 'chalk', config })).toBe(false);
    });

    it('should not match patterns containing special characters as substrings', () => {
      const config: PatchPulseConfig = {
        skip: ['[invalid-regex'],
      };

      expect(
        shouldSkipPackage({
          packageName: 'test-package',
          config,
        }),
      ).toBe(false);
    });

    it('should check both exact matches and patterns', () => {
      const config: PatchPulseConfig = {
        skip: ['lodash', '@types/*'],
      };

      expect(shouldSkipPackage({ packageName: 'lodash', config })).toBe(true);
      expect(
        shouldSkipPackage({
          packageName: '@types/node',
          config,
        }),
      ).toBe(true);
      expect(shouldSkipPackage({ packageName: 'chalk', config })).toBe(false);
    });

    it('should treat patterns without regex chars as exact matches', () => {
      const config: PatchPulseConfig = {
        skip: ['lodash', 'test-package'],
      };

      expect(shouldSkipPackage({ packageName: 'lodash', config })).toBe(true);
      expect(
        shouldSkipPackage({
          packageName: 'test-package',
          config,
        }),
      ).toBe(true);
      expect(
        shouldSkipPackage({
          packageName: 'test-package-extra',
          config,
        }),
      ).toBe(false);
    });
  });

  it('should handle no defined config skip parameter', () => {
    expect(shouldSkipPackage({ packageName: 'lodash', config: {} })).toBe(
      false,
    );
  });

  describe('shouldIncludePath', () => {
    it('returns false when includePaths is not set', () => {
      expect(shouldIncludePath({ path: 'dist', config: {} })).toBe(false);
    });

    it('returns false when includePaths is empty', () => {
      expect(
        shouldIncludePath({ path: 'dist', config: { includePaths: [] } }),
      ).toBe(false);
    });

    it('returns true for an exact match', () => {
      const config: PatchPulseConfig = { includePaths: ['dist'] };
      expect(shouldIncludePath({ path: 'dist', config })).toBe(true);
    });

    it('returns true for a descendant of an included path', () => {
      const config: PatchPulseConfig = { includePaths: ['dist'] };
      expect(shouldIncludePath({ path: 'dist/server', config })).toBe(true);
    });

    it('returns false for paths not in includePaths', () => {
      const config: PatchPulseConfig = { includePaths: ['dist'] };
      expect(shouldIncludePath({ path: 'build', config })).toBe(false);
    });

    it('normalises leading ./ and trailing /', () => {
      const config: PatchPulseConfig = { includePaths: ['./dist/'] };
      expect(shouldIncludePath({ path: 'dist', config })).toBe(true);
    });
  });

  describe('shouldIgnorePath', () => {
    it('should ignore exact directory matches and descendants', () => {
      const config: PatchPulseConfig = {
        ignorePaths: ['packages/cli/e2e'],
      };

      expect(shouldIgnorePath({ path: 'packages/cli/e2e', config })).toBe(true);
      expect(
        shouldIgnorePath({
          path: 'packages/cli/e2e/monorepo/fixtures',
          config,
        }),
      ).toBe(true);
      expect(shouldIgnorePath({ path: 'packages/cli/src/tests', config })).toBe(
        false,
      );
    });

    it('should normalize leading ./ in ignore paths', () => {
      const config: PatchPulseConfig = {
        ignorePaths: ['./packages/cli/e2e/'],
      };

      expect(shouldIgnorePath({ path: 'packages/cli/e2e', config })).toBe(true);
    });
  });
});
