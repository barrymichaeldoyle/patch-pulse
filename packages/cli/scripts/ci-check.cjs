#!/usr/bin/env node

const { execSync } = require('child_process');

function runCommand(command, description) {
  console.log(`🔍 ${description}...`);
  try {
    execSync(command, { stdio: 'inherit' });
  } catch {
    console.error(`❌ ${description} failed!`);
    process.exit(1);
  }
}

console.log('🔍 Running local CI checks...\n');

runCommand('pnpm install --frozen-lockfile', 'Installing dependencies');
runCommand('pnpm run typecheck', 'Type checking');
runCommand('pnpm run lint', 'Linting');
runCommand('pnpm run format:check', 'Checking formatting');
runCommand('pnpm run test:coverage', 'Running tests with coverage');
runCommand('pnpm run build', 'Building');

console.log('\n✅ All checks passed!');
