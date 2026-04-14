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

function parseNullSeparated(output) {
  return output.split('\0').filter(Boolean);
}

function isFormattable(file) {
  if (!existsSync(file)) {
    return false;
  }
  if (file.startsWith('packages/docs/.astro/')) {
    return false;
  }
  if (/^packages\/[^/]+\/convex\/_generated\//.test(file)) {
    return false;
  }

  const extensionIndex = file.lastIndexOf('.');
  if (extensionIndex === -1) {
    return false;
  }

  return textLikeExtensions.has(file.slice(extensionIndex));
}

const trackedChanged = run('git', ['diff', '--name-only', '-z', 'HEAD', '--']);
if (trackedChanged.status !== 0) {
  fail('Failed to read changed tracked files.', trackedChanged.stderr);
}

const untracked = run('git', [
  'ls-files',
  '--others',
  '--exclude-standard',
  '-z',
]);
if (untracked.status !== 0) {
  fail('Failed to read untracked files.', untracked.stderr);
}

const files = [
  ...parseNullSeparated(trackedChanged.stdout),
  ...parseNullSeparated(untracked.stdout),
]
  .filter(isFormattable)
  .filter((file, index, array) => array.indexOf(file) === index);

if (files.length === 0) {
  process.exit(0);
}

const format = run('pnpm', ['exec', 'oxfmt', '--write', ...files], {
  stdio: 'inherit',
});

if (format.status !== 0) {
  process.exit(format.status ?? 1);
}
