#!/usr/bin/env node

'use strict';

const esbuild = require('esbuild');
const path = require('path');

async function main() {
  await esbuild.build({
    entryPoints: [path.join(__dirname, '../src/index.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    outfile: path.join(__dirname, '../lib/index.js'),
    // @patch-pulse/shared is a private workspace package — bundle it inline
    // so the published CLI has zero runtime dependencies.
    external: [],
  });

  console.log('✅ Build complete');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
