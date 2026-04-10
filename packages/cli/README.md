# Patch Pulse CLI

This package lives in the Patch Pulse monorepo at `packages/cli`.

Check for outdated npm dependencies across your project.

![License](https://img.shields.io/github/license/PatchPulse/cli.svg?color=blue)
[![npm Version](https://img.shields.io/npm/v/patch-pulse.svg)](https://npmjs.com/package/patch-pulse)
[![npm Downloads](https://img.shields.io/npm/dm/patch-pulse.svg)](https://npmjs.com/package/patch-pulse)
[![CI/CD](https://github.com/PatchPulse/cli/actions/workflows/ci.yml/badge.svg)](https://github.com/PatchPulse/cli/actions/workflows/ci.yml)
![GitHub stars](https://img.shields.io/github/stars/PatchPulse/cli.svg?style=social)

![Patch Pulse Banner](../../assets/banner.png)

## Quick Start

```bash
npx patch-pulse
```

That's it! Patch Pulse scans the current project for `package.json` files and shows which dependencies are outdated.

![Example Screenshot](assets/example.png)

## Configuration

Patch Pulse supports configuration files for persistent settings. Create one of these files in your project root:

- `patchpulse.config.json`
- `.patchpulserc.json`
- `.patchpulserc`

### Configuration File Example

```json
{
  "skip": ["lodash", "@types/*", "test-*"],
  "packageManager": "npm",
  "noUpdatePrompt": false
}
```

### Skip Patterns

The `skip` array supports multiple pattern types:

- **Exact names**: `"lodash"`, `"chalk"`
- **Glob patterns**: `"@types/*"`, `"test-*"`, `"*-dev"`
- **Regex patterns**: `".*-dev"`, `"^@angular/.*"`, `"zone\\.js"`

### Package Manager

The `packageManager` option allows you to override the package manager detection.

- `npm`
- `pnpm`
- `yarn`
- `bun`

### No Update Prompt

The `noUpdatePrompt` option allows you to skip the update prompt.

### CLI vs File Configuration

CLI arguments override file configuration:

```bash
# This will override any settings in patchpulse.config.json
npx patch-pulse --skip "react,react-dom" --package-manager pnpm --no-update-prompt
```

## Monorepos

When run from a repository root, Patch Pulse scans every `package.json` under the current directory except anything inside `node_modules`.

- `workspace:*` dependencies are ignored
- pnpm `catalog:` dependencies are resolved from `pnpm-workspace.yaml`
- interactive dependency updates can update both direct dependency ranges and pnpm catalog entries

## Ecosystem

- **🔧 CLI Tool** (this repo) - Check dependencies from terminal
- **⚡ VSCode Extension** ([@PatchPulse/vscode-extension](https://github.com/PatchPulse/vscode-extension)) - Get updates in your editor _(Coming soon)_
- **🤖 Slack Bot** ([Add to Workspace](https://slack.com/oauth/v2/authorize?client_id=180374136631.6017466448468&scope=chat:write,commands,incoming-webhook)) - Get notified in Slack

## Troubleshooting

- **"No dependencies found"** - Run from a project directory that contains dependency-bearing `package.json` files
- **"Error reading package.json"** - Check JSON syntax and file permissions
- **Network errors** - Verify internet connection and npm registry access

## Contributing

1. Fork and clone
2. `npm install`
3. Make changes
4. Submit PR

**Guidelines:** Add tests, update docs, keep commits atomic.

## Support

- ⭐ **Star** the repo
- 🐛 **Report bugs** via [Issues](https://github.com/PatchPulse/cli/issues)
- 💬 **Join discussions** in [Discussions](https://github.com/PatchPulse/cli/discussions)

## License

MIT - see [LICENSE](LICENSE)

## Author

[@BarryMichaelDoyle](https://github.com/barrymichaeldoyle)

**🎥 Live Development:** Sometimes I stream on [Twitch](https://twitch.tv/barrymichaeldoyle) - drop by and say hello!

---

**Made with ❤️ for the Node.js community**
