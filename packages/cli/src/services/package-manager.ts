import { spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { type PackageManager, type UpdateableDependency } from '../types';
import { ansi } from '../ui/ansi';
import { preserveWildcardPrefix } from '../utils/parseVersion';
import { pluralize } from '../utils/pluralize';

interface PackageManagerInfo {
  installArgs: string[];
  lockFiles: string[];
  name: PackageManager;
}

const PACKAGE_MANAGERS: Record<PackageManager, PackageManagerInfo> = {
  npm: {
    installArgs: ['install'],
    lockFiles: ['package-lock.json'],
    name: 'npm',
  },
  pnpm: {
    installArgs: ['install'],
    lockFiles: ['pnpm-lock.yaml'],
    name: 'pnpm',
  },
  bun: {
    installArgs: ['install'],
    lockFiles: ['bun.lock', 'bun.lockb'],
    name: 'bun',
  },
  yarn: {
    installArgs: ['install'],
    lockFiles: ['yarn.lock'],
    name: 'yarn',
  },
};

type RunInstallCommand = (args: {
  command: string;
  cwd: string;
  installArgs: string[];
}) => Promise<void>;

interface DirectDependencyUpdate {
  packageName: string;
  targetVersion: string;
  category: string;
  packageJsonPath: string;
  projectDisplayName: string;
  projectRelativePath: string;
  section: UpdateableDependency['source']['section'];
}

interface CatalogDependencyUpdate {
  catalogName: string;
  packageName: string;
  targetVersion: string;
  workspaceManifestPath: string;
}

/**
 * Detects the package manager being used in the current directory
 * @param cwd - The current working directory
 * @returns The detected package manager info or npm as default
 */
export function detectPackageManager(
  cwd: string = process.cwd(),
): PackageManagerInfo {
  for (const [, info] of Object.entries(PACKAGE_MANAGERS)) {
    const hasLockFile = info.lockFiles.some((lockFile) => {
      const lockFilePath = join(cwd, lockFile);
      return existsSync(lockFilePath);
    });

    if (hasLockFile) {
      return info;
    }
  }

  return PACKAGE_MANAGERS.npm;
}

/**
 * Gets package manager info by name
 * @param name - The package manager name
 * @returns The package manager info
 */
export function getPackageManagerInfo(
  name: PackageManager,
): PackageManagerInfo {
  return PACKAGE_MANAGERS[name];
}

function runPackageManagerCommand({
  command,
  cwd,
  installArgs,
}: {
  command: string;
  cwd: string;
  installArgs: string[];
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, installArgs, {
      cwd,
      stdio: 'inherit',
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Updates dependencies based on update type
 * @param dependencies - Array of dependencies to update
 * @param packageManager - The package manager to use
 * @returns Promise that resolves when all updates are complete
 */
export async function updateDependencies({
  cwd,
  dependencies,
  packageManager,
  runInstallCommand = runPackageManagerCommand,
}: {
  cwd: string;
  dependencies: UpdateableDependency[];
  packageManager: PackageManagerInfo;
  runInstallCommand?: RunInstallCommand;
}): Promise<void> {
  if (dependencies.length === 0) {
    console.log(ansi.yellow('No dependencies to update'));
    return;
  }

  const dependencyWord = pluralize({
    count: dependencies.length,
    singular: 'dependency',
    plural: 'dependencies',
  });

  console.log(
    ansi.cyan(
      `\n🔄 Updating ${dependencies.length} ${dependencyWord} using ${packageManager.name}...`,
    ),
  );

  logDependencyChanges(dependencies);

  try {
    const directUpdates = collectDirectUpdates(dependencies);
    const catalogUpdates = collectCatalogUpdates(dependencies);

    if (directUpdates.length > 0) {
      updatePackageJsonFiles(directUpdates);
    }

    if (catalogUpdates.length > 0) {
      updateCatalogFiles(catalogUpdates);
    }

    await runInstallCommand({
      command: packageManager.name,
      cwd,
      installArgs: packageManager.installArgs,
    });

    console.log(
      ansi.green(
        `\n✅ Successfully updated ${dependencies.length} ${dependencyWord}!`,
      ),
    );
  } catch (error) {
    console.error(ansi.red(`Failed to update dependencies: ${error}`));
    throw error;
  }
}

function logDependencyChanges(dependencies: UpdateableDependency[]): void {
  const groupedDeps = dependencies.reduce(
    (groups, dep) => {
      const category = dep.category || 'Dependencies';
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(dep);
      return groups;
    },
    {} as Record<string, typeof dependencies>,
  );

  for (const [category, deps] of Object.entries(groupedDeps)) {
    if (deps.length === 0) {
      continue;
    }

    console.log(ansi.gray(`${category}:`));

    for (const dep of deps) {
      const updateTypeColor = {
        major: ansi.yellow,
        minor: ansi.magenta,
        patch: ansi.blue,
      }[dep.updateType];
      const updateTypeLabel = updateTypeColor(`[${dep.updateType}]`);
      const locationLabel =
        dep.source.sourceType === 'catalog'
          ? `catalog:${dep.source.catalogName}`
          : dep.source.projectRelativePath;

      console.log(
        ansi.gray(
          `   ${dep.packageName}: ${dep.currentVersion} → ${dep.latestVersion} ${updateTypeLabel} (${locationLabel})`,
        ),
      );
    }
  }
}

function collectDirectUpdates(
  dependencies: UpdateableDependency[],
): DirectDependencyUpdate[] {
  const updatesByKey = new Map<string, DirectDependencyUpdate>();

  for (const dep of dependencies) {
    if (dep.source.sourceType !== 'direct') {
      continue;
    }

    const key = [
      dep.source.packageJsonPath,
      dep.packageName,
      dep.source.section,
    ].join('::');
    updatesByKey.set(key, {
      category: dep.category,
      packageJsonPath: dep.source.packageJsonPath,
      packageName: dep.packageName,
      projectDisplayName: dep.source.projectDisplayName,
      projectRelativePath: dep.source.projectRelativePath,
      section: dep.source.section,
      targetVersion: preserveWildcardPrefix(
        dep.source.rawVersion,
        dep.latestVersion,
      ),
    });
  }

  return [...updatesByKey.values()];
}

function collectCatalogUpdates(
  dependencies: UpdateableDependency[],
): CatalogDependencyUpdate[] {
  const updatesByKey = new Map<string, CatalogDependencyUpdate>();

  for (const dep of dependencies) {
    if (
      dep.source.sourceType !== 'catalog' ||
      !dep.source.workspaceManifestPath
    ) {
      continue;
    }

    const catalogName = dep.source.catalogName || 'default';
    const key = [
      dep.source.workspaceManifestPath,
      catalogName,
      dep.packageName,
    ].join('::');

    updatesByKey.set(key, {
      catalogName,
      packageName: dep.packageName,
      targetVersion: preserveWildcardPrefix(
        dep.source.resolvedVersion,
        dep.latestVersion,
      ),
      workspaceManifestPath: dep.source.workspaceManifestPath,
    });
  }

  return [...updatesByKey.values()];
}

function updatePackageJsonFiles(updates: DirectDependencyUpdate[]): void {
  const updatesByFile = updates.reduce(
    (accumulator, update) => {
      if (!accumulator[update.packageJsonPath]) {
        accumulator[update.packageJsonPath] = [];
      }
      accumulator[update.packageJsonPath].push(update);
      return accumulator;
    },
    {} as Record<string, DirectDependencyUpdate[]>,
  );

  for (const [packageJsonPath, fileUpdates] of Object.entries(updatesByFile)) {
    let packageJson: Record<string, unknown>;
    try {
      packageJson = JSON.parse(
        readFileSync(packageJsonPath, 'utf-8'),
      ) as Record<string, unknown>;
    } catch (error) {
      throw new Error(
        `Failed to parse ${packageJsonPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    for (const update of fileUpdates) {
      const section = packageJson[update.section];
      if (section && typeof section === 'object' && section !== null) {
        (section as Record<string, string>)[update.packageName] =
          update.targetVersion;
      }
    }

    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
  }
}

function updateCatalogFiles(updates: CatalogDependencyUpdate[]): void {
  const updatesByFile = updates.reduce(
    (accumulator, update) => {
      if (!accumulator[update.workspaceManifestPath]) {
        accumulator[update.workspaceManifestPath] = [];
      }
      accumulator[update.workspaceManifestPath].push(update);
      return accumulator;
    },
    {} as Record<string, CatalogDependencyUpdate[]>,
  );

  for (const [workspaceManifestPath, fileUpdates] of Object.entries(
    updatesByFile,
  )) {
    const contents = readFileSync(workspaceManifestPath, 'utf-8');
    const lines = contents.split('\n');

    for (const update of fileUpdates) {
      const lineIndex = findCatalogEntryLineIndex({
        catalogName: update.catalogName,
        lines,
        packageName: update.packageName,
      });

      if (lineIndex === -1) {
        throw new Error(
          `Catalog entry not found for ${update.packageName} in ${workspaceManifestPath}`,
        );
      }

      lines[lineIndex] = replaceYamlValue(
        lines[lineIndex],
        update.targetVersion,
      );
    }

    writeFileSync(workspaceManifestPath, lines.join('\n'));
  }
}

function findCatalogEntryLineIndex({
  catalogName,
  lines,
  packageName,
}: {
  catalogName: string;
  lines: string[];
  packageName: string;
}): number {
  let mode: 'catalog' | 'catalogs' | null = null;
  let currentNamedCatalog: string | null = null;

  for (const [index, rawLine] of lines.entries()) {
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

    if (catalogName === 'default' && mode === 'catalog' && indent >= 2) {
      const entry = parseYamlKeyValue(trimmed);
      if (entry?.key === packageName) {
        return index;
      }
      continue;
    }

    if (mode !== 'catalogs') {
      continue;
    }

    if (indent === 2 && trimmed.endsWith(':')) {
      currentNamedCatalog = trimmed.slice(0, -1).trim();
      continue;
    }

    if (indent >= 4 && currentNamedCatalog === catalogName) {
      const entry = parseYamlKeyValue(trimmed);
      if (entry?.key === packageName) {
        return index;
      }
    }
  }

  return -1;
}

function replaceYamlValue(line: string, value: string): string {
  const separatorIndex = line.indexOf(':');
  if (separatorIndex === -1) {
    return line;
  }

  const prefix = line.slice(0, separatorIndex + 1);
  const currentValue = line.slice(separatorIndex + 1).trim();
  const quote =
    (currentValue.startsWith('"') && currentValue.endsWith('"')) ||
    (currentValue.startsWith("'") && currentValue.endsWith("'"))
      ? currentValue[0]
      : '';

  const formattedValue = quote ? `${quote}${value}${quote}` : value;
  return `${prefix} ${formattedValue}`;
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
