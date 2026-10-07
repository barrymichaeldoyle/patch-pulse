import {
  closeSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'fs';

export interface FileLockOptions {
  /** How long to keep retrying before giving up. */
  timeoutMs?: number;
  /** Delay between acquisition attempts. */
  retryDelayMs?: number;
  /** A lock older than this is treated as abandoned and removed. */
  staleMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_DELAY_MS = 50;
const DEFAULT_STALE_MS = 30_000;

export function getLockPath(filePath: string): string {
  return `${filePath}.patch-pulse.lock`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function isLockStale(lockPath: string, staleMs: number): boolean {
  try {
    const pid = Number.parseInt(readFileSync(lockPath, 'utf-8').trim(), 10);
    if (Number.isInteger(pid) && pid > 0 && !isProcessAlive(pid)) {
      return true;
    }
    return Date.now() - statSync(lockPath).mtimeMs > staleMs;
  } catch {
    // The lock disappeared between our attempt and this check.
    return false;
  }
}

function tryAcquire(lockPath: string): boolean {
  let fd: number;
  try {
    // 'wx' fails atomically if the file already exists, which is what makes
    // this safe across concurrent processes.
    fd = openSync(lockPath, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return false;
    }
    throw error;
  }

  try {
    writeSync(fd, String(process.pid));
  } finally {
    closeSync(fd);
  }
  return true;
}

function removeLock(lockPath: string): void {
  try {
    unlinkSync(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

/**
 * Runs `fn` while holding an exclusive lock on `filePath`, so concurrent
 * patch-pulse processes editing the same manifest queue up instead of
 * overwriting each other's changes. The lock is a sibling sentinel file
 * created with an exclusive open, and locks left behind by dead or stalled
 * processes are reclaimed automatically.
 */
export async function withFileLock<T>(
  filePath: string,
  fn: () => T | Promise<T>,
  options: FileLockOptions = {},
): Promise<T> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    staleMs = DEFAULT_STALE_MS,
  } = options;
  const lockPath = getLockPath(filePath);
  const deadline = Date.now() + timeoutMs;

  while (!tryAcquire(lockPath)) {
    if (isLockStale(lockPath, staleMs)) {
      removeLock(lockPath);
      continue;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for lock on ${filePath}. If no other patch-pulse process is running, delete ${lockPath} and retry.`,
      );
    }
    await sleep(retryDelayMs);
  }

  try {
    return await fn();
  } finally {
    removeLock(lockPath);
  }
}
