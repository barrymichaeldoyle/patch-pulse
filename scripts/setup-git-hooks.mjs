import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

if (process.env.CI) {
  process.exit(0);
}

const gitDirectory = resolve('.git');

if (!existsSync(gitDirectory)) {
  process.exit(0);
}

const result = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], {
  stdio: 'inherit',
});

if (result.error) {
  console.warn('Skipping git hook setup:', result.error.message);
  process.exit(0);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
