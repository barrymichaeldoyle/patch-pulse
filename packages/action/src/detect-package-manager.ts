import { existsSync } from 'fs';
import { join } from 'path';

export type PackageManager = 'pnpm' | 'yarn' | 'bun' | 'npm';

/** Detects the package manager by looking for lockfiles in the given directory. */
export function detectPackageManager(cwd: string): PackageManager {
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(cwd, 'bun.lockb')) || existsSync(join(cwd, 'bun.lock')))
    return 'bun';
  return 'npm';
}
