import { type PackageManager } from './types';

/**
 * The package managers that PatchPulse supports.
 * Used for running the command to update the dependencies.
 */
export const PACKAGE_MANAGERS: readonly PackageManager[] = [
  'npm',
  'pnpm',
  'yarn',
  'bun',
];

/**
 * The filenames of the configuration files that PatchPulse looks for.
 */
export const CONFIG_FILENAMES: readonly string[] = [
  'patchpulse.config.json',
  '.patchpulserc.json',
  '.patchpulserc',
];

const ROOT_REPO_URL = 'https://github.com/barrymichaeldoyle/patch-pulse';
export const CLI_REPO_URL = `${ROOT_REPO_URL}/tree/main/packages/cli`;
export const ISSUES_URL = `${ROOT_REPO_URL}/issues`;
export const SPONSORS_URL = 'https://github.com/sponsors/barrymichaeldoyle';
export const SLACK_BOT_URL = 'https://grand-yak-92.convex.site/slack/install';
