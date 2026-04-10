#!/usr/bin/env node

import { runCli } from './cli';

runCli().then((exitCode) => {
  process.exit(exitCode);
});
