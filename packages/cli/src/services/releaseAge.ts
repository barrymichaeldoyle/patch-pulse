import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { type ReleaseAgePolicy } from '@patch-pulse/shared';
import { type PackageManager } from '../types';
import { matchesPattern, type PatchPulseConfig } from './config';

export interface ReleaseAgeSettings {
  /** Minimum age a version must have before it is reported, in minutes. */
  minimumAgeMinutes: number;
  /** Package names, glob patterns, or `name@version` specifiers exempt from the gate. */
  exclude: string[];
  /** Where the setting came from, for display purposes. */
  source: string;
}

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

/** pnpm 11 gates releases for a day unless told otherwise. */
const PNPM_V11_DEFAULT_MINUTES = MINUTES_PER_DAY;

/**
 * Works out which release age gate applies to this workspace. Explicit
 * patch-pulse configuration wins; otherwise the package manager's own setting
 * is mirrored so patch-pulse never suggests a version the install step would
 * refuse.
 */
export function resolveReleaseAgeSettings({
  cwd,
  config,
  packageManager,
}: {
  cwd: string;
  config?: PatchPulseConfig;
  packageManager: PackageManager;
}): ReleaseAgeSettings | null {
  if (config?.minimumReleaseAge !== undefined) {
    return withSettings({
      minimumAgeMinutes: config.minimumReleaseAge,
      exclude: config.minimumReleaseAgeExclude ?? [],
      source: 'patch-pulse config',
    });
  }

  const detected = detectPackageManagerSettings({ cwd, packageManager });
  if (!detected) return null;

  return withSettings({
    ...detected,
    exclude: [...detected.exclude, ...(config?.minimumReleaseAgeExclude ?? [])],
  });
}

function withSettings(settings: ReleaseAgeSettings): ReleaseAgeSettings | null {
  if (!Number.isFinite(settings.minimumAgeMinutes)) return null;
  if (settings.minimumAgeMinutes <= 0) return null;
  return settings;
}

function detectPackageManagerSettings({
  cwd,
  packageManager,
}: {
  cwd: string;
  packageManager: PackageManager;
}): ReleaseAgeSettings | null {
  switch (packageManager) {
    case 'pnpm':
      return readPnpmSettings(cwd);
    case 'bun':
      return readBunSettings(cwd);
    case 'npm':
      return readNpmSettings(cwd);
    case 'yarn':
      return readYarnSettings(cwd);
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// pnpm: `minimumReleaseAge` (minutes) in pnpm-workspace.yaml, or
// `minimum-release-age` in .npmrc. pnpm 11 defaults to one day.
// ---------------------------------------------------------------------------

function readPnpmSettings(cwd: string): ReleaseAgeSettings | null {
  const workspace = readYamlLike(join(cwd, 'pnpm-workspace.yaml'));
  if (workspace) {
    const minutes = toNumber(workspace.scalars.minimumReleaseAge);
    if (minutes !== undefined) {
      return {
        minimumAgeMinutes: minutes,
        exclude: workspace.lists.minimumReleaseAgeExclude ?? [],
        source: 'pnpm-workspace.yaml',
      };
    }
  }

  const npmrc = readIni(join(cwd, '.npmrc'));
  if (npmrc) {
    const minutes = toNumber(npmrc.scalars['minimum-release-age']);
    if (minutes !== undefined) {
      return {
        minimumAgeMinutes: minutes,
        exclude: npmrc.lists['minimum-release-age-exclude'] ?? [],
        source: '.npmrc',
      };
    }
  }

  const pnpmMajor = readPackageManagerMajor(cwd, 'pnpm');
  if (pnpmMajor !== undefined && pnpmMajor >= 11) {
    return {
      minimumAgeMinutes: PNPM_V11_DEFAULT_MINUTES,
      exclude: workspace?.lists.minimumReleaseAgeExclude ?? [],
      source: 'pnpm 11 default',
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// bun: `[install] minimumReleaseAge = <seconds>` and
// `minimumReleaseAgeExcludes = [...]` in bunfig.toml.
// ---------------------------------------------------------------------------

function readBunSettings(cwd: string): ReleaseAgeSettings | null {
  const bunfig = readToml(join(cwd, 'bunfig.toml'));
  const seconds = toNumber(bunfig?.scalars['install.minimumReleaseAge']);
  if (seconds === undefined) return null;

  return {
    minimumAgeMinutes: seconds / 60,
    exclude: bunfig?.lists['install.minimumReleaseAgeExcludes'] ?? [],
    source: 'bunfig.toml',
  };
}

// ---------------------------------------------------------------------------
// npm: `min-release-age=<days>` in .npmrc (npm 11.10+).
// ---------------------------------------------------------------------------

function readNpmSettings(cwd: string): ReleaseAgeSettings | null {
  const npmrc = readIni(join(cwd, '.npmrc'));
  const days = toNumber(npmrc?.scalars['min-release-age']);
  if (days === undefined) return null;

  return {
    minimumAgeMinutes: days * MINUTES_PER_DAY,
    exclude: npmrc?.lists['min-release-age-exclude'] ?? [],
    source: '.npmrc',
  };
}

// ---------------------------------------------------------------------------
// yarn: `npmMinimalAgeGate: <minutes | 1d | 12h | 30m>` in .yarnrc.yml,
// with `npmPreapprovedPackages` as the exclusion list.
// ---------------------------------------------------------------------------

function readYarnSettings(cwd: string): ReleaseAgeSettings | null {
  const yarnrc = readYamlLike(join(cwd, '.yarnrc.yml'));
  const minutes = parseDurationMinutes(yarnrc?.scalars.npmMinimalAgeGate);
  if (minutes === undefined) return null;

  return {
    minimumAgeMinutes: minutes,
    exclude: yarnrc?.lists.npmPreapprovedPackages ?? [],
    source: '.yarnrc.yml',
  };
}

// ---------------------------------------------------------------------------
// Policy construction
// ---------------------------------------------------------------------------

/**
 * Builds the policy handed to the shared version checker. Exclusions may be
 * exact names, glob patterns (`@myorg/*`), or version specifiers such as
 * `nx@21.6.5` and `webpack@4.47.0 || 5.102.1`.
 */
export function createReleaseAgePolicy(
  settings: ReleaseAgeSettings,
): ReleaseAgePolicy {
  const rules = settings.exclude.map(parseExcludeRule);

  return {
    minimumAgeMs: settings.minimumAgeMinutes * 60 * 1000,
    isExcluded: (packageName, version) =>
      rules.some(
        (rule) =>
          matchesPattern({ value: packageName, pattern: rule.pattern }) &&
          (rule.versions === null || rule.versions.includes(version)),
      ),
  };
}

function parseExcludeRule(entry: string): {
  pattern: string;
  versions: string[] | null;
} {
  const trimmed = entry.trim();
  // Scoped names start with "@", so look for the version separator after it.
  const separatorIndex = trimmed.indexOf('@', 1);
  if (separatorIndex === -1) {
    return { pattern: trimmed, versions: null };
  }

  const versions = trimmed
    .slice(separatorIndex + 1)
    .split('||')
    .map((version) => version.trim())
    .filter(Boolean);

  return {
    pattern: trimmed.slice(0, separatorIndex),
    versions: versions.length > 0 ? versions : null,
  };
}

export function formatReleaseAge(minutes: number): string {
  if (minutes % MINUTES_PER_DAY === 0) {
    const days = minutes / MINUTES_PER_DAY;
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  if (minutes % MINUTES_PER_HOUR === 0) {
    const hours = minutes / MINUTES_PER_HOUR;
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

// ---------------------------------------------------------------------------
// Minimal config file readers. These only extract top-level scalars and
// simple lists, which is all the release age settings need.
// ---------------------------------------------------------------------------

interface ParsedConfig {
  scalars: Record<string, string>;
  lists: Record<string, string[]>;
}

function readFileIfExists(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

function readYamlLike(path: string): ParsedConfig | null {
  const contents = readFileIfExists(path);
  if (contents === null) return null;

  const parsed: ParsedConfig = { scalars: {}, lists: {} };
  let currentList: string | null = null;

  for (const rawLine of contents.split('\n')) {
    const line = rawLine.replace(/\t/g, '  ');
    const trimmed = stripComment(line).trim();
    if (trimmed.length === 0) continue;

    const indent = line.length - line.trimStart().length;

    if (indent === 0) {
      currentList = null;
      const separatorIndex = trimmed.indexOf(':');
      if (separatorIndex === -1) continue;
      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();

      if (value.length === 0) {
        currentList = key;
        parsed.lists[key] = [];
      } else if (value.startsWith('[') && value.endsWith(']')) {
        parsed.lists[key] = parseInlineList(value);
      } else {
        parsed.scalars[key] = stripQuotes(value);
      }
      continue;
    }

    if (currentList && trimmed.startsWith('- ')) {
      parsed.lists[currentList].push(stripQuotes(trimmed.slice(2).trim()));
    }
  }

  return parsed;
}

function readIni(path: string): ParsedConfig | null {
  const contents = readFileIfExists(path);
  if (contents === null) return null;

  const parsed: ParsedConfig = { scalars: {}, lists: {} };

  for (const rawLine of contents.split('\n')) {
    const trimmed = stripComment(rawLine, ['#', ';']).trim();
    if (trimmed.length === 0) continue;

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;
    let key = trimmed.slice(0, separatorIndex).trim();
    const value = stripQuotes(trimmed.slice(separatorIndex + 1).trim());

    // npm-style array keys: `key[]=value` repeated per entry.
    if (key.endsWith('[]')) {
      key = key.slice(0, -2);
      (parsed.lists[key] ??= []).push(value);
      continue;
    }

    parsed.scalars[key] = value;
    // pnpm also accepts comma-separated values for list settings.
    parsed.lists[key] = value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return parsed;
}

function readToml(path: string): ParsedConfig | null {
  const contents = readFileIfExists(path);
  if (contents === null) return null;

  const parsed: ParsedConfig = { scalars: {}, lists: {} };
  let section = '';

  for (const rawLine of contents.split('\n')) {
    const trimmed = stripComment(rawLine).trim();
    if (trimmed.length === 0) continue;

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      section = trimmed.slice(1, -1).trim();
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;
    const key = stripQuotes(trimmed.slice(0, separatorIndex).trim());
    const value = trimmed.slice(separatorIndex + 1).trim();
    const fullKey = section ? `${section}.${key}` : key;

    if (value.startsWith('[') && value.endsWith(']')) {
      parsed.lists[fullKey] = parseInlineList(value);
    } else {
      parsed.scalars[fullKey] = stripQuotes(value);
    }
  }

  return parsed;
}

function readPackageManagerMajor(
  cwd: string,
  name: PackageManager,
): number | undefined {
  const contents = readFileIfExists(join(cwd, 'package.json'));
  if (contents === null) return undefined;

  try {
    const packageManager = (
      JSON.parse(contents) as { packageManager?: unknown }
    ).packageManager;
    if (typeof packageManager !== 'string') return undefined;
    const match = packageManager.match(/^([^@]+)@(\d+)/);
    if (!match || match[1] !== name) return undefined;
    return Number.parseInt(match[2], 10);
  } catch {
    return undefined;
  }
}

function parseInlineList(value: string): string[] {
  return value
    .slice(1, -1)
    .split(',')
    .map((entry) => stripQuotes(entry.trim()))
    .filter(Boolean);
}

function stripComment(line: string, markers: string[] = ['#']): string {
  let result = line;
  for (const marker of markers) {
    const index = result.indexOf(marker);
    // Only treat the marker as a comment when it starts the line or follows
    // whitespace, so scoped package names like "@types/node" survive.
    if (index === 0) return '';
    if (index > 0 && /\s/.test(result[index - 1])) {
      result = result.slice(0, index);
    }
  }
  return result;
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function toNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim().length === 0) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Accepts plain minutes or yarn-style durations such as `1d`, `12h`, `30m`. */
function parseDurationMinutes(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  const asNumber = toNumber(trimmed);
  if (asNumber !== undefined) return asNumber;

  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(m|min|h|d|w)$/i);
  if (!match) return undefined;
  const amount = Number(match[1]);
  switch (match[2].toLowerCase()) {
    case 'm':
    case 'min':
      return amount;
    case 'h':
      return amount * MINUTES_PER_HOUR;
    case 'd':
      return amount * MINUTES_PER_DAY;
    case 'w':
      return amount * 7 * MINUTES_PER_DAY;
    default:
      return undefined;
  }
}
