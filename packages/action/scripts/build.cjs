#!/usr/bin/env node

'use strict';

const esbuild = require('esbuild');
const path = require('path');

async function main() {
  await esbuild.build({
    entryPoints: [path.join(__dirname, '../src/main.ts')],
    bundle: true,
    // GitHub Actions runs on Node.js — CJS avoids ESM interop edge cases
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    outfile: path.join(__dirname, '../dist/index.js'),
    // Bundle everything including @patch-pulse/shared
    external: [],
  });

  console.log('✅ Build complete: dist/index.js');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
