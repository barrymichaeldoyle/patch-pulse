import { cpSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPackageManagerInfo, updateDependencies } from '../package-manager';

describe('updateDependencies', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const directory of tempDirs) {
      rmSync(directory, { force: true, recursive: true });
    }
    tempDirs.length = 0;
  });

  it('updates direct dependencies in package.json files', async () => {
    const fixturePath = fileURLToPath(
      new URL('../../__tests__/basic/__fixtures__/', import.meta.url),
    );
    const testPath = createTempFixtureCopy({ fixturePath, tempDirs });
    const installSpy = vi.fn(async () => {});

    await updateDependencies({
      cwd: testPath,
      dependencies: [
        {
          packageName: 'chalk',
          currentVersion: '^5.0.0',
          latestVersion: '5.6.2',
          updateType: 'minor',
          category: 'Dependencies',
          source: {
            packageJsonPath: join(testPath, 'package.json'),
            projectDisplayName: 'fixture-basic',
            projectRelativePath: '.',
            rawVersion: '^5.0.0',
            resolvedVersion: '^5.0.0',
            section: 'dependencies',
            sourceType: 'direct',
          },
        },
      ],
      packageManager: getPackageManagerInfo('pnpm'),
      runInstallCommand: installSpy,
    });

    const packageJson = JSON.parse(
      readFileSync(join(testPath, 'package.json'), 'utf-8'),
    ) as { dependencies: Record<string, string> };

    expect(packageJson.dependencies.chalk).toBe('^5.6.2');
    expect(installSpy).toHaveBeenCalledWith({
      command: 'pnpm',
      cwd: testPath,
      installArgs: ['install'],
    });
  });

  it('updates pnpm catalog entries in pnpm-workspace.yaml', async () => {
    const fixturePath = fileURLToPath(
      new URL('../../__tests__/monorepo/__fixtures__/', import.meta.url),
    );
    const testPath = createTempFixtureCopy({ fixturePath, tempDirs });
    const installSpy = vi.fn(async () => {});
    const workspaceManifestPath = join(testPath, 'pnpm-workspace.yaml');

    await updateDependencies({
      cwd: testPath,
      dependencies: [
        {
          packageName: 'react',
          currentVersion: '^18.2.0',
          latestVersion: '18.3.1',
          updateType: 'minor',
          category: 'Dependencies',
          source: {
            catalogName: 'default',
            packageJsonPath: join(testPath, 'packages/app/package.json'),
            projectDisplayName: '@fixture/app (packages/app)',
            projectRelativePath: 'packages/app',
            rawVersion: 'catalog:',
            resolvedVersion: '^18.2.0',
            section: 'dependencies',
            sourceType: 'catalog',
            workspaceManifestPath,
          },
        },
        {
          packageName: 'lodash',
          currentVersion: '^4.17.21',
          latestVersion: '4.17.22',
          updateType: 'patch',
          category: 'Dependencies',
          source: {
            catalogName: 'legacy',
            packageJsonPath: join(testPath, 'packages/admin/package.json'),
            projectDisplayName: '@fixture/admin (packages/admin)',
            projectRelativePath: 'packages/admin',
            rawVersion: 'catalog:legacy',
            resolvedVersion: '^4.17.21',
            section: 'dependencies',
            sourceType: 'catalog',
            workspaceManifestPath,
          },
        },
      ],
      packageManager: getPackageManagerInfo('pnpm'),
      runInstallCommand: installSpy,
    });

    const workspaceManifest = readFileSync(workspaceManifestPath, 'utf-8');

    expect(workspaceManifest).toContain('react: ^18.3.1');
    expect(workspaceManifest).toContain('lodash: ^4.17.22');
    expect(installSpy).toHaveBeenCalledTimes(1);
  });
});

function createTempFixtureCopy({
  fixturePath,
  tempDirs,
}: {
  fixturePath: string;
  tempDirs: string[];
}): string {
  const tempDirectory = mkdtempSync(join(tmpdir(), 'patch-pulse-'));
  const targetPath = join(tempDirectory, 'fixture');
  cpSync(fixturePath, targetPath, { recursive: true });
  tempDirs.push(tempDirectory);
  return targetPath;
}
