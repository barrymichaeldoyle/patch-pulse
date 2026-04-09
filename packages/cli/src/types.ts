import {
  type DependencyCheckResult,
  type DependencyStatusKind,
  type PackageJsonLike,
  type UpdateType,
} from '@patch-pulse/shared';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';
export type { UpdateType };

export interface PackageJson extends PackageJsonLike {}

export interface DependencyInfo extends DependencyCheckResult {
  isSkipped?: boolean;
  status?: DependencyStatusKind;
}

/**
 * A dependency that is guaranteed to have latestVersion and updateType fields
 * Used for dependencies that have been filtered and validated for updates
 */
export interface UpdateableDependency {
  packageName: string;
  currentVersion: string;
  latestVersion: string;
  updateType: UpdateType;
  category: string;
}
