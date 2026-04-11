import { ansi } from '../ansi';

/**
 * Displays a message when an update is available
 * @param currentVersion - The current version of the package
 * @param latestVersion - The latest version of the package
 */
export function displayUpdateAvailable(
  currentVersion: string,
  latestVersion: string,
): void {
  console.log(ansi.gray('\n' + '═'.repeat(50)));
  console.log(ansi.yellowBold('🚀 UPDATE AVAILABLE!'));
  console.log(ansi.gray('═'.repeat(50)));

  console.log(
    ansi.whiteBold('Current Version:') + ` ${ansi.gray(currentVersion)}`,
  );
  console.log(
    ansi.whiteBold('Latest Version:') + ` ${ansi.yellowBold(latestVersion)}`,
  );

  console.log(ansi.gray('\nTo update, run:'));
  console.log(ansi.cyanBold('  npx patch-pulse@latest'));

  console.log(ansi.gray('═'.repeat(50)));
}
