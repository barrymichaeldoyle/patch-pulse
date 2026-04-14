import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const textLikeExtensions = new Set([
  '.astro',
  '.cjs',
  '.css',
  '.cts',
  '.html',
  '.js',
  '.json',
  '.jsonc',
  '.jsx',
  '.less',
  '.md',
  '.mdx',
  '.mjs',
  '.mts',
  '.scss',
  '.svelte',
  '.toml',
  '.ts',
  '.tsx',
  '.vue',
  '.yaml',
  '.yml',
]);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'pipe',
    encoding: 'utf8',
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  return result;
}

function fail(message, detail = '') {
  console.error(message);
  if (detail.trim()) {
    console.error(detail.trim());
  }
  process.exit(1);
}

const staged = run('git', [
  'diff',
  '--cached',
  '--name-only',
  '--diff-filter=ACMR',
  '-z',
]);

if (staged.status !== 0) {
  fail('Failed to read staged files.', staged.stderr);
}

const files = staged.stdout
  .split('\0')
  .filter(Boolean)
  .filter((file) => existsSync(file))
  .filter((file) => !file.startsWith('packages/docs/.astro/'))
  .filter((file) => !/^packages\/[^/]+\/convex\/_generated\//.test(file))
  .filter((file) => {
    const extensionIndex = file.lastIndexOf('.');
    if (extensionIndex === -1) {
      return false;
    }
    return textLikeExtensions.has(file.slice(extensionIndex));
  });

if (files.length === 0) {
  process.exit(0);
}

const format = run('pnpm', ['exec', 'oxfmt', '--write', ...files], {
  stdio: 'inherit',
});

if (format.status !== 0) {
  process.exit(format.status ?? 1);
}

const add = run('git', ['add', '--', ...files], {
  stdio: 'inherit',
});

if (add.status !== 0) {
  process.exit(add.status ?? 1);
}
