---
'patch-pulse': major
---

## Breaking Changes

### Non-interactive by default

The CLI now exits immediately after the summary. The interactive update prompt no longer appears unless explicitly requested.

- Use `--interactive` (or `-i`) to enter interactive mode
- `--no-interactive` suppresses the prompt explicitly (now the default behavior)
- `"interactive": true` in `patchpulse.config.json` to opt in project-wide

### Flag renames

| Old flag             | New flag               |
| -------------------- | ---------------------- |
| `--update-prompt`    | `--interactive` / `-i` |
| `--no-update-prompt` | `--no-interactive`     |
| `--verbose-projects` | `--expand`             |
| `--only-outdated`    | `--hide-clean`         |

`--info` and its `-i` alias have been removed. Use `--help` / `-h` instead. `-i` is now the short form of `--interactive`.

### Config file key rename

`"noUpdatePrompt"` has been renamed to `"interactive"` in `patchpulse.config.json`. The value is also inverted — set `"interactive": true` to opt in to the update prompt.

## New

- `--fail` — exits with code `1` if any outdated packages are found, making it easy to use patch-pulse as a CI gate (pairs well with `--json`)
- `llms.txt` — added LLM-consumable documentation to the CLI package (included in the published files) and a brief overview at the repo root

## Improvements

- Added a blank line between the package manager download output and the start of the report
- `Location:` now shows the full `package.json` path (e.g. `apps/backend/package.json`) for IDE ctrl-click navigation. Single-project runs now also show the project name and location header
- Projects with outdated dependencies now also show a `✓  Up to date: N` count alongside the attention summary
- Interactive prompt menu simplified — removed the `h` (help) and `v` (version) options that interrupted the update flow

## Fixes

- Progress spinners now stop cleanly before dependency results and the final summary print, preventing stray terminal repainting after the CLI has finished
- Pressing `Ctrl+C` in interactive mode now exits with code `130` instead of falling through to a normal success exit
- Unsupported `packageManager` values in config files are now ignored during validation instead of causing failures later in the interactive update flow
