import { type DependencyInfo } from '../../types';
import { ansi } from '../ansi';

export function displaySummary(
  allDependencies: DependencyInfo[],
  options: {
    projectCount?: number;
    projectsWithAttention?: number;
  } = {},
): void {
  const { projectCount, projectsWithAttention } = options;
  const total = allDependencies.length;
  const upToDate = allDependencies.filter(
    (d) => !d.isOutdated && !d.isSkipped && d.latestVersion,
  ).length;
  const unknown = allDependencies.filter(
    (d) => !d.latestVersion && !d.isSkipped,
  ).length;
  const outdated = allDependencies.filter(
    (d) => d.isOutdated && !d.isSkipped,
  ).length;
  const skipped = allDependencies.filter((d) => d.isSkipped).length;

  // Count by update type (only for non-skipped packages)
  const majorUpdates = allDependencies.filter(
    (d) => d.updateType === 'major' && !d.isSkipped,
  ).length;
  const minorUpdates = allDependencies.filter(
    (d) => d.updateType === 'minor' && !d.isSkipped,
  ).length;
  const patchUpdates = allDependencies.filter(
    (d) => d.updateType === 'patch' && !d.isSkipped,
  ).length;

  console.log(ansi.gray('═'.repeat(60)));
  console.log(ansi.cyanBold(`📊 Summary (${total} packages)`));
  console.log(ansi.gray('═'.repeat(60)));

  if (upToDate > 0) {
    console.log(`  ${ansi.green('✓  Up to date:')} ${upToDate}`);
  }

  if (outdated > 0) {
    const breakdown = [
      majorUpdates > 0 && `${majorUpdates} major`,
      minorUpdates > 0 && `${minorUpdates} minor`,
      patchUpdates > 0 && `${patchUpdates} patch`,
    ].filter(Boolean);

    const breakdownText =
      breakdown.length > 0 ? ` ${ansi.gray(`(${breakdown.join(', ')})`)}` : '';
    console.log(`  ${ansi.blue('⚠  Outdated:')} ${outdated}${breakdownText}`);
  }

  if (unknown > 0) {
    console.log(`  ${ansi.magenta('?  Unknown:')} ${unknown}`);
  }

  if (
    typeof projectCount === 'number' &&
    projectCount > 1 &&
    typeof projectsWithAttention === 'number'
  ) {
    console.log(
      `  ${ansi.white('📦 Projects flagged:')} ${projectsWithAttention}/${projectCount}`,
    );
  }

  if (skipped > 0) {
    console.log(`  ${ansi.gray('⏭  Skipped:')} ${skipped}`);
  }

  console.log(ansi.gray('═'.repeat(60)));
}
