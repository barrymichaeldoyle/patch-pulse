import { exec } from 'child_process';
import { promisify } from 'util';
import type { CliOutput } from './types';

const execAsync = promisify(exec);

export async function detectUpdates({
  cwd,
}: {
  cwd: string;
}): Promise<CliOutput> {
  const { stdout, stderr } = await execAsync(
    'npx --yes patch-pulse --json --hide-clean',
    {
      cwd,
      // 10 MB buffer — large monorepos can produce verbose JSON
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  if (stderr) {
    process.stderr.write(stderr);
  }

  try {
    return JSON.parse(stdout) as CliOutput;
  } catch {
    throw new Error(
      `Failed to parse patch-pulse JSON output:\n${stdout.slice(0, 500)}`,
    );
  }
}
