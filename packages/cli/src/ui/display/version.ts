import { VERSION } from '../../gen/version.gen';
import { CLI_REPO_URL, DOCS_URL } from '../../constant';
import { ansi } from '../ansi';
import { createCenteredBox } from '../createCenteredBox';
import { displayMadeWithLove } from './madeWithLove';

/**
 * Displays the version information
 */
export function displayVersion(): void {
  console.log(`${createCenteredBox('Patch Pulse CLI', 40)}

${ansi.cyanBold('Version:')} ${ansi.white(VERSION)}
${ansi.cyanBold('Author:')}  ${ansi.underline('<https://github.com/barrymichaeldoyle>')}
${ansi.cyanBold('Docs:')}    ${ansi.white(DOCS_URL)}
${ansi.cyanBold('Repo:')}    ${ansi.white(CLI_REPO_URL)}
${ansi.cyanBold('License:')} ${ansi.white('MIT')}`);

  displayMadeWithLove();
}
