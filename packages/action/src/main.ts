import * as core from '@actions/core';
import * as github from '@actions/github';
import { detectUpdates } from './detect-updates';
import { groupPackages } from './group-packages';
import { bumpVersions } from './version-bumper';
import { configureGit, setupBranch, commitAndPush } from './branch-manager';
import { composePrBody, composePrTitle } from './pr-composer';
import type { PackageGroup, RepoContext } from './types';
import type { UpdateType } from './types';

const UPDATE_TYPE_RANK: Record<UpdateType, number> = {
  patch: 0,
  minor: 1,
  major: 2,
};
const AUTO_MERGE_THRESHOLD: Record<string, number> = {
  none: -1,
  patch: 0,
  minor: 1,
};

function shouldAutoMerge(updateType: UpdateType, autoMerge: string): boolean {
  const updateRank = UPDATE_TYPE_RANK[updateType];
  const threshold = AUTO_MERGE_THRESHOLD[autoMerge] ?? -1;
  return updateRank <= threshold;
}

async function processGroup({
  group,
  octokit,
  repoContext,
  autoMerge,
  cwd,
}: {
  group: PackageGroup;
  octokit: ReturnType<typeof github.getOctokit>;
  repoContext: RepoContext;
  autoMerge: string;
  cwd: string;
}): Promise<void> {
  const { owner, repo, defaultBranch } = repoContext;

  core.info(`\nProcessing: ${group.name} (${group.highestUpdateType})`);
  for (const pkg of group.packages) {
    core.info(
      `  ${pkg.packageName}: ${pkg.currentVersion} → ${pkg.latestVersion}`,
    );
  }

  // Check for an existing open PR on this branch
  const { data: existingPrs } = await octokit.rest.pulls.list({
    owner,
    repo,
    head: `${owner}:${group.branchName}`,
    state: 'open',
  });

  await setupBranch({ branchName: group.branchName, defaultBranch, cwd });

  const touchedFiles = await bumpVersions(group.packages);

  if (touchedFiles.length === 0) {
    core.info(`  No files changed — skipping`);
    return;
  }

  const packageList = group.packages
    .map((p) => `${p.packageName}@${p.latestVersion}`)
    .join(', ');
  await commitAndPush({
    branchName: group.branchName,
    message: `chore(deps): update ${packageList}`,
    cwd,
  });

  const title = composePrTitle(group);
  const body = await composePrBody(group);

  if (existingPrs.length > 0) {
    const pr = existingPrs[0];
    core.info(`  Updating existing PR #${pr.number}`);
    await octokit.rest.pulls.update({
      owner,
      repo,
      pull_number: pr.number,
      title,
      body,
    });
    return;
  }

  core.info(`  Creating PR: ${title}`);
  const { data: pr } = await octokit.rest.pulls.create({
    owner,
    repo,
    title,
    body,
    head: group.branchName,
    base: defaultBranch,
  });
  core.info(`  Opened PR #${pr.number}: ${pr.html_url}`);

  // Apply labels (non-fatal if labels don't exist in the repo)
  try {
    await octokit.rest.issues.addLabels({
      owner,
      repo,
      issue_number: pr.number,
      labels: ['patch-pulse', `${group.highestUpdateType}-update`],
    });
  } catch {
    // Labels may not exist — silently skip
  }

  if (shouldAutoMerge(group.highestUpdateType, autoMerge)) {
    try {
      await octokit.rest.pulls.merge({
        owner,
        repo,
        pull_number: pr.number,
        merge_method: 'squash',
      });
      core.info(`  Auto-merged PR #${pr.number}`);
    } catch (error) {
      core.warning(`  Could not auto-merge PR #${pr.number}: ${String(error)}`);
    }
  }
}

async function run(): Promise<void> {
  try {
    const githubToken = core.getInput('github-token', { required: true });
    const updateTypesRaw = core.getInput('update-types') || 'patch,minor,major';
    const groupsRaw = core.getInput('groups') || '{}';
    const autoMerge = core.getInput('auto-merge') || 'none';
    const workingDirectoryInput = core.getInput('working-directory') || '.';

    const updateTypes = updateTypesRaw.split(',').map((s) => s.trim());
    const groups = JSON.parse(groupsRaw) as Record<string, string[]>;
    const cwd =
      workingDirectoryInput === '.' ? process.cwd() : workingDirectoryInput;

    const octokit = github.getOctokit(githubToken);
    const { owner, repo } = github.context.repo;

    const { data: repoData } = await octokit.rest.repos.get({ owner, repo });
    const defaultBranch = repoData.default_branch;

    const repoContext: RepoContext = { owner, repo, defaultBranch };

    await configureGit(cwd, owner, repo, githubToken);

    core.info('Running PatchPulse to detect outdated packages...');
    const cliOutput = await detectUpdates({ cwd });

    if (cliOutput.summary.outdated === 0) {
      core.info('All packages are up to date!');
      return;
    }

    core.info(
      `Found ${cliOutput.summary.outdated} outdated package(s) across ${cliOutput.summary.projectCount} project(s)`,
    );

    const packageGroups = groupPackages({ cliOutput, groups, updateTypes });
    core.info(`Grouped into ${packageGroups.length} PR(s)`);

    for (const group of packageGroups) {
      await processGroup({ group, octokit, repoContext, autoMerge, cwd });
    }

    core.info('\nDone!');
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

run();
