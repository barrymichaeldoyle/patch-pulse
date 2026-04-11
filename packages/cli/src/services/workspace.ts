import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import {
  PACKAGE_JSON_DEPENDENCY_FIELDS,
  getDependencySections,
} from '@patch-pulse/shared';
import { type DependencySource, type PackageJson } from '../types';
import { type PatchPulseConfig, shouldIgnorePath } from './config';
import { readPackageJson } from './package';

type DependencySectionName = (typeof PACKAGE_JSON_DEPENDENCY_FIELDS)[number];

interface ResolvedCatalogs {
  default: Record<string, string>;
  named: Record<string, Record<string, string>>;
}

interface WorkspaceProject {
  cwd: string;
  displayName: string;
  packageJson: PackageJson;
  packageJsonPath: string;
  relativePath: string;
  sections: Partial<Record<DependencySectionName, ResolvedDependencySpec[]>>;
  usesCatalogProtocol: boolean;
}

interface WorkspaceScanResult {
  hasCatalogDependencies: boolean;
  isMonorepo: boolean;
  projects: WorkspaceProject[];
}

const IGNORED_DIRECTORIES = new Set(['node_modules', '.git']);

interface ResolvedDependencySpec {
  packageName: string;
  source: DependencySource;
}

export async function scanWorkspace(
  rootCwd: string,
  config?: PatchPulseConfig,
): Promise<WorkspaceScanResult> {
  const packageJsonPaths = findPackageJsonPaths(rootCwd, config);
  const catalogs = readPnpmCatalogs(rootCwd);
  const workspaceManifestPath = join(rootCwd, 'pnpm-workspace.yaml');
  const projects: WorkspaceProject[] = [];
  let hasCatalogDependencies = false;

  for (const packageJsonPath of packageJsonPaths) {
    const packageJson = await readPackageJson(packageJsonPath);
    const cwd = packageJsonPath.slice(0, -'/package.json'.length);
    const relativePath = relative(rootCwd, cwd) || '.';
    const sections = resolveDependencySections({
      catalogs,
      packageJson,
      packageJsonPath,
      relativePath,
      workspaceManifestPath,
    });

    const dependencyCount = Object.values(sections).reduce(
      (count, section) => count + Object.keys(section ?? {}).length,
      0,
    );

    if (dependencyCount === 0) {
      continue;
    }

    const usesCatalogProtocol = packageUsesCatalogProtocol(packageJson);

    hasCatalogDependencies ||= usesCatalogProtocol;

    projects.push({
      cwd,
      displayName: getProjectDisplayName({ packageJson, relativePath }),
      packageJson,
      packageJsonPath,
      relativePath,
      sections,
      usesCatalogProtocol,
    });
  }

  return {
    hasCatalogDependencies,
    isMonorepo: projects.length > 1,
    projects,
  };
}

function findPackageJsonPaths(
  rootCwd: string,
  config?: PatchPulseConfig,
): string[] {
  const packageJsonPaths: string[] = [];

  function visitDirectory(directory: string): void {
    const relativeDirectory = relative(rootCwd, directory) || '.';

    if (
      relativeDirectory !== '.' &&
      shouldIgnorePath({ path: relativeDirectory, config })
    ) {
      return;
    }

    const entries = readdirSync(directory, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) {
          continue;
        }

        visitDirectory(join(directory, entry.name));
        continue;
      }

      if (entry.isFile() && entry.name === 'package.json') {
        const packageJsonPath = join(directory, entry.name);
        const relativePackageJsonPath = relative(rootCwd, packageJsonPath);

        if (shouldIgnorePath({ path: relativePackageJsonPath, config })) {
          continue;
        }

        packageJsonPaths.push(packageJsonPath);
      }
    }
  }

  visitDirectory(rootCwd);

  return packageJsonPaths.sort((a, b) => a.localeCompare(b));
}

function resolveDependencySections({
  catalogs,
  packageJson,
  packageJsonPath,
  relativePath,
  workspaceManifestPath,
}: {
  catalogs: ResolvedCatalogs;
  packageJson: PackageJson;
  packageJsonPath: string;
  relativePath: string;
  workspaceManifestPath: string;
}): Partial<Record<DependencySectionName, ResolvedDependencySpec[]>> {
  const sections = getDependencySections(packageJson);
  const resolvedSections: Partial<
    Record<DependencySectionName, ResolvedDependencySpec[]>
  > = {};
  const projectDisplayName = getProjectDisplayName({
    packageJson,
    relativePath,
  });

  for (const field of PACKAGE_JSON_DEPENDENCY_FIELDS) {
    const section = sections[field];
    if (!section) {
      continue;
    }

    const resolvedEntries = Object.entries(section).flatMap(
      ([packageName, versionRange]) => {
        const resolvedVersion = resolveVersionSpecifier({
          catalogs,
          packageName,
          versionRange,
        });

        if (!resolvedVersion) {
          return [];
        }

        return [
          {
            packageName,
            source: {
              catalogName: resolvedVersion.catalogName,
              packageJsonPath,
              projectDisplayName,
              projectRelativePath: relativePath,
              rawVersion: versionRange,
              resolvedVersion: resolvedVersion.version,
              section: field,
              sourceType: resolvedVersion.sourceType,
              workspaceManifestPath,
            },
          },
        ];
      },
    );

    if (resolvedEntries.length > 0) {
      resolvedSections[field] = resolvedEntries;
    }
  }

  return resolvedSections;
}

function resolveVersionSpecifier({
  catalogs,
  packageName,
  versionRange,
}: {
  catalogs: ResolvedCatalogs;
  packageName: string;
  versionRange: string;
}):
  | {
      catalogName?: string;
      sourceType: 'catalog' | 'direct';
      version: string;
    }
  | undefined {
  if (versionRange.startsWith('workspace:')) {
    return undefined;
  }

  if (versionRange.startsWith('catalog:')) {
    return resolveCatalogVersion({
      catalogs,
      packageName,
      versionRange,
    });
  }

  return {
    sourceType: 'direct',
    version: versionRange,
  };
}

function resolveCatalogVersion({
  catalogs,
  packageName,
  versionRange,
}: {
  catalogs: ResolvedCatalogs;
  packageName: string;
  versionRange: string;
}):
  | {
      catalogName: string;
      sourceType: 'catalog';
      version: string;
    }
  | undefined {
  const catalogName =
    versionRange === 'catalog:'
      ? 'default'
      : versionRange.slice('catalog:'.length);

  if (catalogName === 'default') {
    const version = catalogs.default[packageName];
    return version
      ? {
          catalogName,
          sourceType: 'catalog',
          version,
        }
      : undefined;
  }

  const version = catalogs.named[catalogName]?.[packageName];
  return version
    ? {
        catalogName,
        sourceType: 'catalog',
        version,
      }
    : undefined;
}

function packageUsesCatalogProtocol(packageJson: PackageJson): boolean {
  const sections = getDependencySections(packageJson);

  return Object.values(sections).some((section) =>
    Object.values(section ?? {}).some((versionRange) =>
      versionRange.startsWith('catalog:'),
    ),
  );
}

function getProjectDisplayName({
  packageJson,
  relativePath,
}: {
  packageJson: PackageJson;
  relativePath: string;
}): string {
  const packageName =
    typeof packageJson.name === 'string' && packageJson.name.length > 0
      ? packageJson.name
      : 'package.json';

  if (relativePath === '.') {
    return packageName;
  }

  return `${packageName} (${relativePath})`;
}

function readPnpmCatalogs(rootCwd: string): ResolvedCatalogs {
  const workspacePath = join(rootCwd, 'pnpm-workspace.yaml');

  try {
    const contents = readFileSync(workspacePath, 'utf-8');
    return parsePnpmCatalogs(contents);
  } catch {
    return {
      default: {},
      named: {},
    };
  }
}

function parsePnpmCatalogs(contents: string): ResolvedCatalogs {
  const catalogs: ResolvedCatalogs = {
    default: {},
    named: {},
  };

  let mode: 'catalog' | 'catalogs' | null = null;
  let currentNamedCatalog: string | null = null;

  for (const rawLine of contents.split('\n')) {
    const line = rawLine.replace(/\t/g, '  ');
    const trimmed = line.trim();

    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue;
    }

    const indent = line.length - line.trimStart().length;

    if (indent === 0) {
      currentNamedCatalog = null;
      if (trimmed === 'catalog:') {
        mode = 'catalog';
      } else if (trimmed === 'catalogs:') {
        mode = 'catalogs';
      } else {
        mode = null;
      }
      continue;
    }

    if (mode === 'catalog' && indent >= 2) {
      const entry = parseYamlKeyValue(trimmed);
      if (entry) {
        catalogs.default[entry.key] = entry.value;
      }
      continue;
    }

    if (mode === 'catalogs') {
      if (indent === 2 && trimmed.endsWith(':')) {
        currentNamedCatalog = trimmed.slice(0, -1).trim();
        if (!(currentNamedCatalog in catalogs.named)) {
          catalogs.named[currentNamedCatalog] = {};
        }
        continue;
      }

      if (indent >= 4 && currentNamedCatalog) {
        const entry = parseYamlKeyValue(trimmed);
        if (entry) {
          catalogs.named[currentNamedCatalog][entry.key] = entry.value;
        }
      }
    }
  }

  return catalogs;
}

function parseYamlKeyValue(
  line: string,
): { key: string; value: string } | null {
  const separatorIndex = line.indexOf(':');
  if (separatorIndex === -1) {
    return null;
  }

  const key = stripYamlQuotes(line.slice(0, separatorIndex).trim());
  const value = stripYamlQuotes(line.slice(separatorIndex + 1).trim());

  if (key.length === 0 || value.length === 0) {
    return null;
  }

  return { key, value };
}

function stripYamlQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
