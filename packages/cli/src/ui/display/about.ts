import { ansi } from '../ansi';
import { createCenteredBox } from '../createCenteredBox';
import {
  CLI_REPO_URL,
  ISSUES_URL,
  SLACK_BOT_URL,
  SPONSORS_URL,
} from '../../constant';

export function displayAbout(): void {
  console.log(`${createCenteredBox('About Patch Pulse', 40)}

${ansi.white('Patch Pulse checks npm dependency versions across apps and monorepos.')}
${ansi.white('It keeps the CLI lean: zero runtime dependencies, pnpm catalog support,')}
${ansi.white('interactive updates, and now machine-readable output with --json.')}

${ansi.cyanBold('Repo:')}      ${ansi.white(ansi.link('barrymichaeldoyle/patch-pulse', CLI_REPO_URL))}
${ansi.cyanBold('Issues:')}    ${ansi.white(ansi.link('Report a bug or request a feature', ISSUES_URL))}
${ansi.cyanBold('Sponsors:')}  ${ansi.white(ansi.link('Support development on GitHub Sponsors', SPONSORS_URL))}
${ansi.cyanBold('Slack Bot:')} ${ansi.white(ansi.link('Add the Patch Pulse Slack bot to your workspace', SLACK_BOT_URL))}

${ansi.gray('Tip:')}
  ${ansi.white('Use --json for scripts, --project <name-or-path> to focus one workspace,')}
  ${ansi.white('and --verbose-projects when you want the full monorepo report.')}`);
}
