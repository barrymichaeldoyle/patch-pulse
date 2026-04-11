import chalk from 'chalk';
import { getUpdateType as getSharedUpdateType } from '@patch-pulse/shared';
import { UpdateType } from '../types';

/**
 * Determines the type of update required based on the current and latest versions
 * @returns The type of update required ('patch', 'minor', or 'major')
 */
export function getUpdateType({
  current,
  latest,
}: {
  current: string;
  latest: string;
}): UpdateType {
  const updateType = getSharedUpdateType({ current, latest });

  if (updateType === 'patch') {
    const hasInvalidVersion =
      !/^[\^~>=<]*\d+\.\d+\.\d+/.test(current) ||
      !/^[\^~>=<]*\d+\.\d+\.\d+/.test(latest);

    if (hasInvalidVersion) {
      console.warn(
        chalk.yellow(
          `⚠️  Invalid version format: ${current} or ${latest}. Defaulting to patch update.`,
        ),
      );
    }
  }

  return updateType;
}
