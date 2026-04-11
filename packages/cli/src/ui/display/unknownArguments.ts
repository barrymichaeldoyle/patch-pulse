import { ansi } from '../ansi';

export function displayUnknownArguments(unknownArgs: string[]): void {
  console.error(
    ansi.redBold('❌ Unknown command:') + ` ${ansi.white(unknownArgs.join(' '))}`,
  );
  console.log();
  console.log(ansi.blueBold(' Available commands:'));
  console.log(
    ansi.white('  npx patch-pulse') +
      ansi.gray('           # Check dependencies'),
  );
  console.log(
    ansi.white('  npx patch-pulse --help') + ansi.gray('    # Show help'),
  );
  console.log(
    ansi.white('  npx patch-pulse --version') + ansi.gray(' # Show version'),
  );
  console.log(
    ansi.white('  npx patch-pulse --about') + ansi.gray('   # Show project links'),
  );
  console.log(
    ansi.white('  npx patch-pulse --json') + ansi.gray('    # Print JSON output'),
  );
  console.log(
    ansi.white('  npx patch-pulse --license') + ansi.gray(' # Show license'),
  );
  console.log();
  console.log(ansi.blueBold(' Configuration options:'));
  console.log(
    ansi.white('  npx patch-pulse -s <packages>') +
      ansi.gray('     # Skip packages (supports exact names and patterns)'),
  );
  console.log();
  console.log(
    ansi.cyanBold('For more information:') +
      ` ${ansi.whiteBold('npx patch-pulse --help')}`,
  );
}
