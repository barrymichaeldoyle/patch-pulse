import { exec } from 'child_process';
import { promisify } from 'util';
import {
  detectPackageManager,
  type PackageManager,
} from './detect-package-manager';

const execAsync = promisify(exec);

const INSTALL_COMMANDS: Record<PackageManager, string> = {
  pnpm: 'pnpm install --no-frozen-lockfile',
  yarn: 'yarn install',
  bun: 'bun install',
  npm: 'npm install',
};

/**
 * Runs the appropriate package manager install after package.json versions have
 * been bumped, so the lockfile stays in sync with the updated dependencies.
 */
export async function updateLockfile(cwd: string): Promise<void> {
  const pm = detectPackageManager(cwd);
  await execAsync(INSTALL_COMMANDS[pm], {
    cwd,
    maxBuffer: 50 * 1024 * 1024,
  });
}
