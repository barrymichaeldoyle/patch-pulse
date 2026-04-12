import { ansi } from '../ansi';
import { createCenteredBox } from '../createCenteredBox';
import { CLI_REPO_URL, ISSUES_URL, SLACK_BOT_URL } from '../../constant';
import { displayMadeWithLove } from './madeWithLove';

/**
 * Displays the help message
 */
export function displayHelp(): void {
  const boxWidth = 40;

  console.log(`${createCenteredBox('Patch Pulse CLI', boxWidth)}

${ansi.whiteBold('🔍 A CLI tool for checking npm package dependency versions')}

${ansi.cyanBoldUnderline('📖 Usage:')}
  ${ansi.white('npx patch-pulse')} ${ansi.gray('[options]')}

${ansi.cyanBoldUnderline('⚙️  Options:')}
  ${ansi.white('-h, --help')}               ${ansi.gray('Show current message')}
  ${ansi.white('-v, --version')}            ${ansi.gray('Show version information')}
  ${ansi.white('--about')}                  ${ansi.gray('Show project links and support info')}
  ${ansi.white('--json')}                   ${ansi.gray('Print machine-readable JSON output')}
  ${ansi.white('-l, --license')}            ${ansi.gray('Show license information')}

${ansi.cyanBoldUnderline('🔧 Configuration Options:')}
  ${ansi.white('-s, --skip <packages>')}    ${ansi.gray('Skip packages (supports exact names and patterns)')}
  ${ansi.white('--package-manager <pm>')}   ${ansi.gray('Override detected package manager (npm, pnpm, yarn, bun)')}
  ${ansi.white('--project <name|path>')}    ${ansi.gray('Limit the scan output to one project in a monorepo')}
  ${ansi.white('-i, --interactive')}        ${ansi.gray('Show interactive update prompt after summary')}
  ${ansi.white('--no-interactive')}         ${ansi.gray('Skip update prompt after summary (default)')}
  ${ansi.white('--hide-clean')}             ${ansi.gray('Hide clean projects in monorepos')}
  ${ansi.white('--expand')}                 ${ansi.gray('Show full output for every project in monorepos')}
  ${ansi.white('--fail')}                   ${ansi.gray('Exit with code 1 if any outdated packages are found')}

${ansi.cyanBoldUnderline('📁 Configuration File:')}
  Prefer \`patchpulse.json\` in your project root
  (also supports \`patchpulse.config.json\`, \`.patchpulserc.json\`, and \`.patchpulserc\`):
  ${ansi.gray('{')}
    ${ansi.gray('"skip": ["lodash", "@types/*", "test-*"],')}
    ${ansi.gray('"ignorePaths": ["packages/cli/e2e"],')}
    ${ansi.gray('"packageManager": "npm",')}
    ${ansi.gray('"interactive": true')}
  ${ansi.gray('}')}

${ansi.cyanBoldUnderline('📝 Description:')}
  Scans the current project for \`package.json\` files outside
  \`node_modules\` and displays information about each package's
  dependencies, including version status and update availability.
  In pnpm workspaces, \`catalog:\` dependencies are resolved from
  \`pnpm-workspace.yaml\`, while \`workspace:*\` dependencies are ignored.
  Use \`ignorePaths\` to exclude fixture or generated directories from scanning.
  After the summary, the CLI exits immediately by default. Pass
  --interactive (or -i) to enter interactive mode, where you can
  choose to update patch, minor, or all outdated dependencies.

${ansi.cyanBoldUnderline('💡 Examples:')}
  ${ansi.white('npx patch-pulse')}                          ${ansi.gray('# Check dependencies across the current project')}
  ${ansi.white('npx patch-pulse --version')}                ${ansi.gray('# Show version information')}
  ${ansi.white('npx patch-pulse --about')}                  ${ansi.gray('# Show project links, sponsors, and Slack bot')}
  ${ansi.white('npx patch-pulse --json')}                   ${ansi.gray('# Emit machine-readable results')}
  ${ansi.white('npx patch-pulse --license')}                ${ansi.gray('# Show license information')}
  ${ansi.white('npx patch-pulse --skip "lodash,@types/*"')} ${ansi.gray('# Skip specific packages and patterns')}
  ${ansi.white('npx patch-pulse --package-manager pnpm')}   ${ansi.gray('# Use pnpm for updates (overrides automatic package manager detection)')}
  ${ansi.white('npx patch-pulse --project packages/app')}   ${ansi.gray('# Focus one project inside a monorepo')}
  ${ansi.white('npx patch-pulse --interactive')}            ${ansi.gray('# Show interactive update prompt after summary')}
  ${ansi.white('npx patch-pulse --hide-clean')}             ${ansi.gray('# Show only projects that need attention')}
  ${ansi.white('npx patch-pulse --expand')}                 ${ansi.gray('# Show full monorepo output including clean projects')}
  ${ansi.white('npx patch-pulse --fail')}                   ${ansi.gray('# Exit 1 if any outdated packages found (useful in CI)')}
  ${ansi.white('npx patch-pulse --json --fail')}            ${ansi.gray('# Machine-readable output + non-zero exit for CI scripts')}

${ansi.cyanBoldUnderline('🔗 Links:')}
  ${ansi.blue('📚 Docs:')}      ${ansi.white(ansi.link('barrymichaeldoyle/patch-pulse', CLI_REPO_URL))}
  ${ansi.blue('🐛 Issues:')}    ${ansi.white(ansi.link('Open an issue', ISSUES_URL))}
  ${ansi.blue('👨‍ Author:')}    ${ansi.white(ansi.link('github.com/barrymichaeldoyle', 'https://github.com/barrymichaeldoyle'))}
  ${ansi.blue('🤖 Slack Bot:')} ${ansi.white(ansi.link('Add to Slack', SLACK_BOT_URL))}`);

  displayMadeWithLove();
}
