import { ansi } from '../ansi';

/**
 * Displays the "Made with love" message
 */
export function displayMadeWithLove(): void {
  console.log(ansi.gray('─'.repeat(40)));
  console.log(
    `${ansi.gray('Made with ❤️  by ')}${ansi.underline('Barry Michael Doyle')}`,
  );
}
