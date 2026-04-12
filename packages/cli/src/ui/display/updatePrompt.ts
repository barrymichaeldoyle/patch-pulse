import { type PatchPulseConfig } from '../../services/config';
import { type DependencyInfo } from '../../types';
import { ansi } from '../ansi';

type UpdateType = 'patch' | 'minor' | 'all';
type UpdatePromptResult = UpdateType | 'interrupt' | null;

const UPDATE_OPTION_CHARS: Record<UpdateType, string> = {
  patch: 'p',
  minor: 'm',
  all: 'u',
};

const QUIT_CHAR = 'q';

interface UpdateOption {
  packageName: string;
  latestVersion: string;
}

interface UpdateOptions {
  patch: UpdateOption[];
  minor: UpdateOption[];
  all: UpdateOption[];
}

/**
 * Sets up raw mode for single key press detection
 * @param stdin - The stdin stream
 * @param _wasRaw - The original raw mode state (unused but kept for consistency)
 * @param _wasPaused - The original paused state (unused but kept for consistency)
 */
function setupRawMode(stdin: typeof process.stdin) {
  // Check if stdin is a TTY before calling setRawMode
  if (stdin.isTTY) {
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
  }
}

/**
 * Restores the original terminal settings
 * @param stdin - The stdin stream
 * @param wasRaw - The original raw mode state
 * @param wasPaused - The original paused state
 */
function restoreTerminalSettings({
  stdin,
  wasRaw,
  wasPaused,
}: {
  stdin: typeof process.stdin;
  wasRaw: boolean;
  wasPaused: boolean;
}) {
  // Only call setRawMode if stdin is a TTY
  if (stdin.isTTY) {
    stdin.setRawMode(wasRaw);
    if (wasPaused) {
      stdin.pause();
    }
  }
}

/**
 * Displays the interactive update prompt after the summary
 * @param dependencies - Array of outdated dependencies
 * @param config - The configuration object
 * @returns Promise that resolves with the selected update type or null if cancelled
 */
export function displayUpdatePrompt(
  dependencies: DependencyInfo[],
  config?: PatchPulseConfig,
): Promise<UpdatePromptResult> {
  return new Promise((resolve) => {
    const outdatedDeps = dependencies.filter(
      (d) => d.isOutdated && !d.isSkipped,
    );

    if (outdatedDeps.length === 0) {
      resolve(null);
      return;
    }

    // Check if interactive mode is disabled via config
    if (!config?.interactive) {
      resolve(null);
      return;
    }

    // Check if we're in a non-interactive environment (CI/CD)
    if (!process.stdin.isTTY) {
      console.log(
        ansi.yellow(
          '⚠️  Running in non-interactive environment. Skipping update prompt.',
        ),
      );
      resolve(null);
      return;
    }

    const updateOptions = categorizeUpdates(outdatedDeps);
    const affectedProjects = new Set(
      outdatedDeps.map(
        (dependency) => dependency.source?.projectRelativePath ?? '.',
      ),
    ).size;

    function showOptions() {
      console.log();
      console.log(ansi.gray('═'.repeat(60)));
      console.log(
        ansi.cyanBold(
          `Update Options (${outdatedDeps.length} outdated package${outdatedDeps.length === 1 ? '' : 's'} across ${affectedProjects} project${affectedProjects === 1 ? '' : 's'})`,
        ),
      );
      console.log(ansi.gray('═'.repeat(60)));

      if (updateOptions.patch.length > 0) {
        console.log(
          `  ${ansi.cyan(UPDATE_OPTION_CHARS.patch)} - Update outdated patch dependencies`,
        );
      }
      if (updateOptions.minor.length > 0) {
        console.log(
          `  ${ansi.cyan(UPDATE_OPTION_CHARS.minor)} - Update outdated minor & patch dependencies`,
        );
      }
      if (updateOptions.all.length > 0) {
        console.log(
          `  ${ansi.cyan(UPDATE_OPTION_CHARS.all)} - Update all outdated dependencies`,
        );
      }

      console.log();
      console.log(`  ${ansi.gray(QUIT_CHAR)} - Quit`);
      console.log();
      console.log(ansi.white('Press a key to select an option...'));
    }

    showOptions();

    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    const wasPaused = stdin.isPaused();
    let isSettled = false;

    function settle(result: UpdatePromptResult) {
      if (isSettled) {
        return;
      }

      isSettled = true;
      cleanup();
      resolve(result);
    }

    function handleKeyPress(key: string) {
      const choice = key.toLowerCase();

      switch (choice) {
        case UPDATE_OPTION_CHARS.patch:
          if (updateOptions.patch.length > 0) {
            settle('patch');
          } else {
            console.log(ansi.red('\nNo patch updates available'));
          }
          break;
        case UPDATE_OPTION_CHARS.minor:
          if (updateOptions.minor.length > 0) {
            settle('minor');
          } else {
            console.log(ansi.red('\nNo minor updates available'));
          }
          break;
        case UPDATE_OPTION_CHARS.all:
          if (updateOptions.all.length > 0) {
            settle('all');
          } else {
            console.log(ansi.red('\nNo updates available'));
          }
          break;
        case QUIT_CHAR:
          settle(null);
          break;
        case '\u0003': // Ctrl+C
          settle('interrupt');
          break;
        default:
          // Ignore other keys
          break;
      }
    }

    function cleanup() {
      restoreTerminalSettings({ stdin, wasRaw, wasPaused });
      stdin.removeListener('data', handleKeyPress);
      process.removeListener('exit', cleanup);
      process.removeListener('SIGTERM', handleSignal);
    }

    function handleSignal() {
      settle('interrupt');
    }

    function setupListeners() {
      setupRawMode(stdin);
      process.once('exit', cleanup);
      process.once('SIGTERM', handleSignal);
      stdin.on('data', handleKeyPress);
    }

    setupListeners();
  });
}

/**
 * Categorizes dependencies by update type
 * @param dependencies - Array of outdated dependencies
 * @returns Object with categorized dependencies
 */
function categorizeUpdates(dependencies: DependencyInfo[]): UpdateOptions {
  const patch: UpdateOption[] = [];
  const minor: UpdateOption[] = [];
  const all: UpdateOption[] = [];

  for (const dep of dependencies) {
    if (!dep.latestVersion) continue;

    const updateEntry = {
      packageName: dep.packageName,
      latestVersion: dep.latestVersion,
    };

    all.push(updateEntry);

    if (dep.updateType === 'patch') {
      patch.push(updateEntry);
    } else if (dep.updateType === 'minor') {
      minor.push(updateEntry);
    }
  }

  return { patch, minor, all };
}
