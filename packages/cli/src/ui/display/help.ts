import chalk from 'chalk';

import { createCenteredBox } from '../createCenteredBox';
import { displayMadeWithLove } from './madeWithLove';

/**
 * Displays the help message
 */
export function displayHelp(): void {
  const boxWidth = 40;

  console.log(`${createCenteredBox('Patch Pulse CLI', boxWidth)}

${chalk.white.bold('🔍 A CLI tool for checking npm package dependency versions')}

${chalk.cyan.bold.underline('📖 Usage:')}
  ${chalk.white('npx patch-pulse')} ${chalk.gray('[options]')}

${chalk.cyan.bold.underline('⚙️  Options:')}
  ${chalk.white('-i, -h, --info, --help')}   ${chalk.gray('Show current message')}
  ${chalk.white('-v, --version')}            ${chalk.gray('Show version information')}
  ${chalk.white('-l, --license')}            ${chalk.gray('Show license information')}

${chalk.cyan.bold.underline('🔧 Configuration Options:')}
  ${chalk.white('-s, --skip <packages>')}    ${chalk.gray('Skip packages (supports exact names and patterns)')}
  ${chalk.white('--package-manager <pm>')}   ${chalk.gray('Override detected package manager (npm, pnpm, yarn, bun)')}
  ${chalk.white('--no-update-prompt')}       ${chalk.gray('Skip update prompt after summary (exit immediately)')}
  ${chalk.white('--update-prompt')}          ${chalk.gray('Force update prompt after summary (even if config disables it)')}

${chalk.cyan.bold.underline('📁 Configuration File:')}
  Create a \`patchpulse.config.json\` file in your project root:
  ${chalk.gray('{')}
    ${chalk.gray('"skip": ["lodash", "@types/*", "test-*"],')}
    ${chalk.gray('"packageManager": "npm",')}
    ${chalk.gray('"noUpdatePrompt": true')}
  ${chalk.gray('}')}

${chalk.cyan.bold.underline('📝 Description:')}
  Scans the current project for \`package.json\` files outside
  \`node_modules\` and displays information about each package's
  dependencies, including version status and update availability.
  In pnpm workspaces, \`catalog:\` dependencies are resolved from
  \`pnpm-workspace.yaml\`, while \`workspace:*\` dependencies are ignored.
  After the summary, you can choose to update patch, minor, or all
  outdated dependencies across the scanned project, unless
  --no-update-prompt is set (in which case the CLI exits after summary).

${chalk.cyan.bold.underline('💡 Examples:')}
  ${chalk.white('npx patch-pulse')}                          ${chalk.gray('# Check dependencies across the current project')}
  ${chalk.white('npx patch-pulse --version')}                ${chalk.gray('# Show version information')}
  ${chalk.white('npx patch-pulse --license')}                ${chalk.gray('# Show license information')}
  ${chalk.white('npx patch-pulse --skip "lodash,@types/*"')} ${chalk.gray('# Skip specific packages and patterns')}
  ${chalk.white('npx patch-pulse --package-manager pnpm')}   ${chalk.gray('# Use pnpm for updates (overrides automatic package manager detection)')}
  ${chalk.white('npx patch-pulse --no-update-prompt')}       ${chalk.gray('# Exit after summary (no update prompt)')}
  ${chalk.white('npx patch-pulse --update-prompt')}          ${chalk.gray('# Force update prompt after summary (overrides patchpulse.config.json file)')}

${chalk.cyan.bold.underline('🔗 Links:')}
  ${chalk.blue('📚 Docs:')}      ${chalk.white.underline('https://github.com/PatchPulse/cli')}
  ${chalk.blue('🐛 Issues:')}    ${chalk.white.underline('https://github.com/PatchPulse/cli/issues')}
  ${chalk.blue('👨‍ Author:')}    ${chalk.white.underline('https://github.com/barrymichaeldoyle')}
  ${chalk.blue('🤖 Slack Bot:')} ${chalk.white.underline('https://slack.com/oauth/v2/authorize?client_id=180374136631.6017466448468&scope=chat:write,commands,incoming-webhook')}`);

  displayMadeWithLove();
}
