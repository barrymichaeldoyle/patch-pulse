import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  utimesSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { getLockPath, withFileLock } from '../fileLock';

describe('withFileLock', () => {
  const tempDirs: string[] = [];

  function makeTarget(): string {
    const dir = mkdtempSync(join(tmpdir(), 'patch-pulse-lock-'));
    tempDirs.push(dir);
    const target = join(dir, 'package.json');
    writeFileSync(target, '{"count":0}\n');
    return target;
  }

  afterEach(() => {
    for (const dir of tempDirs) rmSync(dir, { force: true, recursive: true });
    tempDirs.length = 0;
  });

  it('runs the callback, returns its value and removes the lock afterwards', async () => {
    const target = makeTarget();
    const result = await withFileLock(target, () => {
      expect(existsSync(getLockPath(target))).toBe(true);
      return 42;
    });
    expect(result).toBe(42);
    expect(existsSync(getLockPath(target))).toBe(false);
  });

  it('removes the lock when the callback throws', async () => {
    const target = makeTarget();
    await expect(
      withFileLock(target, () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(existsSync(getLockPath(target))).toBe(false);
  });

  it('serialises concurrent read-modify-write cycles on the same file', async () => {
    const target = makeTarget();
    const increment = () =>
      withFileLock(
        target,
        async () => {
          const value = JSON.parse(readFileSync(target, 'utf-8')) as {
            count: number;
          };
          // Yield so the other writers get a chance to interleave if unlocked.
          await new Promise((resolve) => setTimeout(resolve, 5));
          writeFileSync(
            target,
            `${JSON.stringify({ count: value.count + 1 })}\n`,
          );
        },
        { retryDelayMs: 1 },
      );

    await Promise.all([increment(), increment(), increment(), increment()]);

    const final = JSON.parse(readFileSync(target, 'utf-8')) as {
      count: number;
    };
    expect(final.count).toBe(4);
    expect(existsSync(getLockPath(target))).toBe(false);
  });

  it('waits for a held lock to be released', async () => {
    const target = makeTarget();
    const lockPath = getLockPath(target);
    writeFileSync(lockPath, String(process.pid));
    setTimeout(() => rmSync(lockPath), 30);

    const start = Date.now();
    await withFileLock(target, () => 'done', { retryDelayMs: 5 });
    expect(Date.now() - start).toBeGreaterThanOrEqual(20);
  });

  it('reclaims a lock whose owning process is no longer alive', async () => {
    const target = makeTarget();
    // PID 2^31-1 is not going to be a live process.
    writeFileSync(getLockPath(target), '2147483647');
    await expect(
      withFileLock(target, () => 'ok', { timeoutMs: 500, retryDelayMs: 5 }),
    ).resolves.toBe('ok');
  });

  it('reclaims a lock older than staleMs', async () => {
    const target = makeTarget();
    const lockPath = getLockPath(target);
    writeFileSync(lockPath, String(process.pid));
    const old = new Date(Date.now() - 60_000);
    utimesSync(lockPath, old, old);
    await expect(
      withFileLock(target, () => 'ok', {
        timeoutMs: 500,
        retryDelayMs: 5,
        staleMs: 1_000,
      }),
    ).resolves.toBe('ok');
  });

  it('times out with a helpful message when the lock is held by a live process', async () => {
    const target = makeTarget();
    writeFileSync(getLockPath(target), String(process.pid));
    await expect(
      withFileLock(target, () => 'never', { timeoutMs: 50, retryDelayMs: 5 }),
    ).rejects.toThrow(/Timed out waiting for lock/);
  });
});
