# patch-pulse

## 3.0.0

### Major Changes

This is the first major release of Patch Pulse CLI — a ground-up rewrite focused on monorepo support, zero dependencies, and a polished interactive experience.

#### Highlights

- **Zero runtime dependencies.** The entire CLI ships without any third-party runtime packages. All npm registry communication, version comparison, and workspace scanning is handled internally.
- **Full monorepo support.** Patch Pulse scans all `package.json` files in a workspace, groups results by project, and gives each project its own status view. Works with npm, pnpm, Yarn, and Bun workspaces.
- **pnpm `catalog:` support.** Dependencies using pnpm's catalog protocol are resolved, checked, and updated in the correct workspace manifest file.
- **Interactive update prompt.** After displaying results, an interactive prompt lets you apply patch, minor, or all updates in one keypress. Patch Pulse writes the version bumps directly and runs the appropriate package manager install command.
- **Progressive streaming output.** Results stream to the terminal as each section resolves rather than waiting for all lookups to finish:
  - Single project: each dependency section streams inline with a live progress counter.
  - Monorepo (default): project header prints immediately, a per-section spinner tracks progress, compact/attention results appear per-project as each finishes.
  - Monorepo `--verbose-projects`: full section results stream per-project.
  - Monorepo `--only-outdated`: a top-level scan spinner shows progress while all projects are checked, then only projects needing attention are shown.
- **Multiple display modes for monorepos:**
  - Default — compact summary per project (up-to-date count and outdated list).
  - `--verbose-projects` — full dependency table for every project.
  - `--only-outdated` — hides projects where everything is up to date.
  - `--project <name>` — focus on a single workspace project by name or path.
- **JSON output mode.** `--json` emits a structured report suitable for CI pipelines, editor integrations, and scripts.
- **Configuration file support.** Create `patchpulse.config.json`, `.patchpulserc.json`, or `.patchpulserc` at the project root to persist settings. CLI flags always take precedence.

#### Security

- Removed `shell: true` from the internal `spawn` call used to run package manager install commands. Arguments are already passed as an array, making shell interpolation unnecessary and a potential injection surface.
- Removed undocumented regex pattern matching from `skip` and `ignorePaths` config options. Patterns were previously compiled directly via `new RegExp()`, opening a ReDoS vector. Patterns now support glob wildcards (`*`, `?`) and exact matches only — which covers every legitimate use case.

#### Fixed

- `updatePackageJsonFiles` now wraps `JSON.parse`/`readFileSync` in a try-catch and throws a descriptive error (`Failed to parse <path>: <reason>`) instead of crashing with an unhandled exception if a `package.json` is malformed between scan and update.
- The `--license` flag no longer exits with code 1 when the bundled `LICENSE` file cannot be read. It prints the MIT fallback and returns normally.
- The interactive update prompt now registers `process.once('exit')` and `process.once('SIGTERM')` guards, guaranteeing terminal raw mode is restored if the process exits unexpectedly. Previously an unexpected exit while the prompt was active left the terminal unusable, requiring a manual `reset`.

#### Breaking Changes

- **Regex patterns in `skip` and `ignorePaths` are no longer supported.** This feature was undocumented and removed as a security hardening measure. Use glob wildcards (`*`, `?`) instead — patterns such as `@types/*`, `test-*`, and `*-dev` all work as globs.
