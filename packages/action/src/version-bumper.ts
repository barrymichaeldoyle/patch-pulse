import { readFile, writeFile } from 'fs/promises';
import { preserveWildcardPrefix } from '@patch-pulse/shared';
import type { OutdatedPackage } from './types';

const DEPENDENCY_SECTIONS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

/**
 * Bumps package versions in all affected package.json files.
 * Preserves the existing version range prefix (^, ~, exact).
 * Returns the list of files that were modified.
 */
export async function bumpVersions(
  packages: OutdatedPackage[],
): Promise<string[]> {
  // Group updates by file so we only read/write each file once
  const fileUpdates = new Map<
    string,
    Array<{ packageName: string; newVersion: string }>
  >();

  for (const pkg of packages) {
    for (const occurrence of pkg.occurrences) {
      const newVersion = preserveWildcardPrefix(
        occurrence.rawVersion,
        pkg.latestVersion,
      );
      const updates = fileUpdates.get(occurrence.packageJsonPath) ?? [];
      updates.push({ packageName: pkg.packageName, newVersion });
      fileUpdates.set(occurrence.packageJsonPath, updates);
    }
  }

  const touchedFiles: string[] = [];

  for (const [filePath, updates] of fileUpdates.entries()) {
    const raw = await readFile(filePath, 'utf-8');
    const packageJson = JSON.parse(raw) as Record<string, unknown>;
    let changed = false;

    for (const { packageName, newVersion } of updates) {
      for (const section of DEPENDENCY_SECTIONS) {
        const deps = packageJson[section] as Record<string, string> | undefined;
        if (deps?.[packageName] !== undefined) {
          deps[packageName] = newVersion;
          changed = true;
        }
      }
    }

    if (changed) {
      // Preserve the original indentation style
      const indentMatch = raw.match(/^{\n(\s+)/m);
      const indent = indentMatch ? indentMatch[1] : '  ';
      await writeFile(
        filePath,
        JSON.stringify(packageJson, null, indent) + '\n',
        'utf-8',
      );
      touchedFiles.push(filePath);
    }
  }

  return touchedFiles;
}
