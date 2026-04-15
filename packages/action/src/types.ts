import type { UpdateType } from '@patch-pulse/shared';

export type { UpdateType };

export interface CliDependencySource {
  packageJsonPath: string;
  projectDisplayName: string;
  projectRelativePath: string;
  rawVersion: string;
  resolvedVersion: string;
  section:
    | 'dependencies'
    | 'devDependencies'
    | 'peerDependencies'
    | 'optionalDependencies';
  sourceType: 'direct' | 'catalog';
  workspaceManifestPath?: string;
}

export interface CliDependency {
  packageName: string;
  currentVersion: string;
  latestVersion?: string;
  isOutdated: boolean;
  updateType?: UpdateType;
  category?: string;
  isSkipped?: boolean;
  source?: CliDependencySource;
}

export interface CliProject {
  displayName: string;
  relativePath: string;
  needsAttention: boolean;
  sections: Array<{
    category: string;
    dependencies: CliDependency[];
  }>;
}

export interface CliOutput {
  cwd: string;
  generatedAt: string;
  isMonorepo: boolean;
  projects: CliProject[];
  summary: {
    total: number;
    upToDate: number;
    outdated: number;
    unknown: number;
    skipped: number;
    majorUpdates: number;
    minorUpdates: number;
    patchUpdates: number;
    projectCount: number;
    projectsWithAttention: number;
  };
}

export interface PackageOccurrence {
  packageJsonPath: string;
  rawVersion: string;
  section: string;
}

export interface OutdatedPackage {
  packageName: string;
  currentVersion: string;
  latestVersion: string;
  updateType: UpdateType;
  occurrences: PackageOccurrence[];
}

export interface PackageGroup {
  /** Group name — either the configured group key or the package name for singles */
  name: string;
  packages: OutdatedPackage[];
  highestUpdateType: UpdateType;
  /** Branch name: patch-pulse/<slug>, no version so at most one open PR per group */
  branchName: string;
}

export interface RepoContext {
  owner: string;
  repo: string;
  defaultBranch: string;
}
