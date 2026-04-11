import { ansi } from '../ansi';

/**
 * Displays the CLI closeout message
 */
export function displayThankYouMessage(): void {
  console.log();
  console.log(
    `${ansi.cyanBold('Done.')} Re-run with ${ansi.whiteBold('--help')} for options or ${ansi.whiteBold('--about')} for project links.`,
  );
}
