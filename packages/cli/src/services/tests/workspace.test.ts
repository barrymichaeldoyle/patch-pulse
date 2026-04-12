import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { scanWorkspace } from '../workspace';

describe('scanWorkspace', () => {
  it('discovers dependency-bearing package.json files in a monorepo', async () => {
    const workspacePath = fileURLToPath(
      new URL('../../../e2e/monorepo/fixtures/', import.meta.url),
    );

    const result = await scanWorkspace(workspacePath);

    expect(result.isMonorepo).toBe(true);
    expect(result.hasCatalogDependencies).toBe(true);
    expect(result.projects.map((project) => project.relativePath)).toEqual([
      'packages/admin',
      'packages/app',
    ]);

    const adminProject = result.projects[0];
    const appProject = result.projects[1];

    expect(adminProject.sections.dependencies).toEqual([
      expect.objectContaining({
        packageName: 'lodash',
        source: expect.objectContaining({
          sourceType: 'catalog',
          catalogName: 'legacy',
          resolvedVersion: '^4.17.21',
        }),
      }),
    ]);
    expect(appProject.sections.dependencies).toEqual([
      expect.objectContaining({
        packageName: 'react',
        source: expect.objectContaining({
          sourceType: 'catalog',
          catalogName: 'default',
          resolvedVersion: '^18.2.0',
        }),
      }),
    ]);
    expect(appProject.sections.devDependencies).toEqual([
      expect.objectContaining({
        packageName: 'vitest',
        source: expect.objectContaining({
          sourceType: 'direct',
          resolvedVersion: '^4.0.0',
        }),
      }),
    ]);
    expect(
      appProject.sections.dependencies?.some(
        (dependency) => dependency.packageName === '@repo/shared',
      ),
    ).toBe(false);
  });

  it('ignores configured paths while scanning workspace package.json files', async () => {
    const workspacePath = fileURLToPath(
      new URL('../../../e2e/monorepo/fixtures/', import.meta.url),
    );

    const result = await scanWorkspace(workspacePath, {
      ignorePaths: ['packages/admin'],
    });

    expect(result.projects.map((project) => project.relativePath)).toEqual([
      'packages/app',
    ]);
  });
});

describe('scanWorkspace (gitignore)', () => {
  it('skips directories listed in .gitignore', async () => {
    const workspacePath = fileURLToPath(
      new URL('../../../e2e/with-gitignore/fixtures/', import.meta.url),
    );

    const result = await scanWorkspace(workspacePath);

    const relativePaths = result.projects.map((project) => project.relativePath);
    expect(relativePaths).toContain('packages/app');
    expect(relativePaths).not.toContain('dist');
  });

  it('scans a gitignored directory when it is listed in includePaths', async () => {
    const workspacePath = fileURLToPath(
      new URL('../../../e2e/with-gitignore/fixtures/', import.meta.url),
    );

    const result = await scanWorkspace(workspacePath, {
      includePaths: ['dist'],
    });

    const relativePaths = result.projects.map((project) => project.relativePath);
    expect(relativePaths).toContain('dist');
    expect(relativePaths).toContain('packages/app');
  });
});
