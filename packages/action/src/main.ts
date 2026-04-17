import * as core from '@actions/core';
import * as github from '@actions/github';
import { detectUpdates } from './detect-updates';
import { groupPackages } from './group-packages';
import { applyIgnoreList } from './ignore-filter';
import { bumpVersions } from './version-bumper';
import { updateLockfile } from './lockfile-updater';
import { configureGit, setupBranch, commitAndPush } from './branch-manager';
import { composePrBody, composePrTitle } from './pr-composer';
import type { PackageGroup, RepoContext, UpdateType } from './types';

const VALID_UPDATE_TYPES: UpdateType[] = ['patch', 'minor', 'major'];
const VALID_AUTO_MERGE = ['none', 'patch', 'minor'] as const;

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

function parseJsonInput<T>(inputName: string, raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(
      `Invalid JSON in '${inputName}' input: ${raw}\n` +
        `Please check that it is valid JSON.`,
    );
  }
}

function shouldAutoMerge(updateType: UpdateType, autoMerge: string): boolean {
  return (
    UPDATE_TYPE_RANK[updateType] <= (AUTO_MERGE_THRESHOLD[autoMerge] ?? -1)
  );
}

async function enableNativeAutoMerge(
  octokit: ReturnType<typeof github.getOctokit>,
  pullRequestNodeId: string,
): Promise<void> {
  await octokit.graphql(
    `mutation($id: ID!) {
      enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: SQUASH }) {
        clientMutationId
      }
    }`,
    { id: pullRequestNodeId },
  );
}

/**
 * Processes one package group: bumps versions, updates the lockfile,
 * pushes the branch, and creates or updates the PR.
 *
 * Returns true if a brand-new PR was created (so the caller can track the limit).
 */
async function processGroup({
  group,
  octokit,
  repoContext,
  autoMerge,
  commitPrefix,
  assignees,
  reviewers,
  teamReviewers,
  canCreateNewPr,
  cwd,
  dryRun,
}: {
  group: PackageGroup;
  octokit: ReturnType<typeof github.getOctokit>;
  repoContext: RepoContext;
  autoMerge: string;
  commitPrefix: string;
  assignees: string[];
  reviewers: string[];
  teamReviewers: string[];
  canCreateNewPr: boolean;
  cwd: string;
  dryRun: boolean;
}): Promise<boolean> {
  const { owner, repo, defaultBranch } = repoContext;

  core.info(`\nProcessing: ${group.name} (${group.highestUpdateType})`);
  for (const pkg of group.packages) {
    core.info(
      `  ${pkg.packageName}: ${pkg.currentVersion} → ${pkg.latestVersion}`,
    );
  }

  // Check for an existing open PR on this branch
  const { data: openPrs } = await octokit.rest.pulls.list({
    owner,
    repo,
    head: `${owner}:${group.branchName}`,
    state: 'open',
  });

  const hasExistingOpenPr = openPrs.length > 0;

  // Check if the user previously closed a PR on this branch without merging.
  // Respect that decision — don't re-open until they delete the branch.
  if (!hasExistingOpenPr) {
    const { data: closedPrs } = await octokit.rest.pulls.list({
      owner,
      repo,
      head: `${owner}:${group.branchName}`,
      state: 'closed',
    });

    const wasRejected = closedPrs.some((pr) => pr.merged_at === null);
    if (wasRejected) {
      core.info(
        `  Skipping — a PR for this group was previously closed without merging`,
      );
      core.info(
        `  Delete the \`${group.branchName}\` branch to allow re-creation`,
      );
      return false;
    }
  }

  // Respect the open PR limit for new PRs (existing PRs are always updated)
  if (!hasExistingOpenPr && !canCreateNewPr) {
    core.info(`  Skipping — open PR limit reached`);
    return false;
  }

  if (dryRun) {
    const action = hasExistingOpenPr ? 'update PR' : 'open PR';
    core.info(`  [DRY RUN] Would ${action} for branch \`${group.branchName}\``);
    return !hasExistingOpenPr;
  }

  await setupBranch({ branchName: group.branchName, defaultBranch, cwd });

  const touchedFiles = await bumpVersions(group.packages);

  if (touchedFiles.length === 0) {
    core.info(`  No files changed — skipping`);
    return false;
  }

  core.info(`  Updating lockfile...`);
  await updateLockfile(cwd);

  const packageList = group.packages
    .map((p) => `${p.packageName}@${p.latestVersion}`)
    .join(', ');
  await commitAndPush({
    branchName: group.branchName,
    message: `${commitPrefix} update ${packageList}`,
    cwd,
  });

  const title = composePrTitle(group, commitPrefix);
  const body = await composePrBody(group);

  // Update existing PR
  if (hasExistingOpenPr) {
    const pr = openPrs[0];
    core.info(`  Updating existing PR #${pr.number}`);
    await octokit.rest.pulls.update({
      owner,
      repo,
      pull_number: pr.number,
      title,
      body,
    });
    return false;
  }

  // Create new PR
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

  // Labels (non-fatal)
  try {
    await octokit.rest.issues.addLabels({
      owner,
      repo,
      issue_number: pr.number,
      labels: ['patch-pulse', `${group.highestUpdateType}-update`],
    });
  } catch {
    // Labels may not exist in the repo — silently skip
  }

  // Assignees (non-fatal)
  if (assignees.length > 0) {
    try {
      await octokit.rest.issues.addAssignees({
        owner,
        repo,
        issue_number: pr.number,
        assignees,
      });
    } catch (error) {
      core.warning(`  Could not add assignees: ${String(error)}`);
    }
  }

  // Reviewers (non-fatal)
  if (reviewers.length > 0 || teamReviewers.length > 0) {
    try {
      await octokit.rest.pulls.requestReviewers({
        owner,
        repo,
        pull_number: pr.number,
        reviewers,
        team_reviewers: teamReviewers,
      });
    } catch (error) {
      core.warning(`  Could not request reviewers: ${String(error)}`);
    }
  }

  // Auto-merge via GitHub's native mechanism (waits for required CI checks)
  if (shouldAutoMerge(group.highestUpdateType, autoMerge)) {
    try {
      await enableNativeAutoMerge(octokit, pr.node_id);
      core.info(
        `  Enabled auto-merge on PR #${pr.number} (will merge once CI passes)`,
      );
    } catch (error) {
      core.warning(
        `  Could not enable auto-merge on PR #${pr.number}: ${String(error)}. ` +
          `Ensure auto-merge is allowed in your repository settings.`,
      );
    }
  }

  return true;
}

async function run(): Promise<void> {
  try {
    const githubToken = core.getInput('github-token', { required: true });
    const updateTypesRaw = core.getInput('update-types') || 'patch,minor,major';
    const groupsRaw = core.getInput('groups') || '{}';
    const autoMerge = core.getInput('auto-merge') || 'none';
    const workingDirectoryInput = core.getInput('working-directory') || '.';
    const maxOpenPrsInput = core.getInput('max-open-prs') || '10';
    const ignoreRaw = core.getInput('ignore') || '[]';
    const assigneesRaw = core.getInput('assignees') || '[]';
    const reviewersRaw = core.getInput('reviewers') || '[]';
    const teamReviewersRaw = core.getInput('team-reviewers') || '[]';
    const commitPrefix =
      core.getInput('commit-message-prefix') || 'chore(deps):';
    const dryRun = core.getInput('dry-run') === 'true';

    // Validate update-types
    const updateTypes = updateTypesRaw.split(',').map((s) => s.trim());
    const invalidTypes = updateTypes.filter(
      (t) => !VALID_UPDATE_TYPES.includes(t as UpdateType),
    );
    if (invalidTypes.length > 0) {
      throw new Error(
        `Invalid value(s) in 'update-types': ${invalidTypes.join(', ')}. ` +
          `Allowed values: patch, minor, major`,
      );
    }

    // Validate auto-merge
    if (
      !VALID_AUTO_MERGE.includes(autoMerge as (typeof VALID_AUTO_MERGE)[number])
    ) {
      throw new Error(
        `Invalid value for 'auto-merge': ${autoMerge}. ` +
          `Allowed values: none, patch, minor`,
      );
    }

    // Validate max-open-prs
    const maxOpenPrs = parseInt(maxOpenPrsInput, 10);
    if (isNaN(maxOpenPrs) || maxOpenPrs < 0) {
      throw new Error(
        `Invalid value for 'max-open-prs': ${maxOpenPrsInput}. ` +
          `Must be a non-negative integer (0 = unlimited).`,
      );
    }

    // Parse JSON inputs
    const groups = parseJsonInput<Record<string, string[]>>(
      'groups',
      groupsRaw,
    );
    const ignoreList = parseJsonInput<string[]>('ignore', ignoreRaw);
    const assignees = parseJsonInput<string[]>('assignees', assigneesRaw);
    const reviewers = parseJsonInput<string[]>('reviewers', reviewersRaw);
    const teamReviewers = parseJsonInput<string[]>(
      'team-reviewers',
      teamReviewersRaw,
    );

    const cwd =
      workingDirectoryInput === '.' ? process.cwd() : workingDirectoryInput;

    if (dryRun) {
      core.info(
        'DRY RUN mode enabled — no branches, commits, or PRs will be created',
      );
    }

    const octokit = github.getOctokit(githubToken);
    const { owner, repo } = github.context.repo;

    const { data: repoData } = await octokit.rest.repos.get({ owner, repo });
    const defaultBranch = repoData.default_branch;
    const repoContext: RepoContext = { owner, repo, defaultBranch };

    if (!dryRun) {
      await configureGit(cwd, owner, repo, githubToken);
    }

    // Count existing open patch-pulse PRs for the limit check
    const { data: allOpenPrs } = await octokit.rest.pulls.list({
      owner,
      repo,
      state: 'open',
      per_page: 100,
    });
    const openPatchPulseBranches = new Set(
      allOpenPrs
        .filter((pr) => pr.head.ref.startsWith('patch-pulse/'))
        .map((pr) => pr.head.ref),
    );

    core.info('Running PatchPulse to detect outdated packages...');
    const cliOutput = await detectUpdates({ cwd });

    if (cliOutput.summary.outdated === 0) {
      core.info('All packages are up to date!');
      return;
    }

    core.info(
      `Found ${cliOutput.summary.outdated} outdated package(s) across ${cliOutput.summary.projectCount} project(s)`,
    );

    let packageGroups = groupPackages({ cliOutput, groups, updateTypes });
    packageGroups = applyIgnoreList(packageGroups, ignoreList);

    core.info(`Processing ${packageGroups.length} update group(s)`);

    let newPrsCreated = 0;

    for (const group of packageGroups) {
      const alreadyHasOpenPr = openPatchPulseBranches.has(group.branchName);
      const underLimit =
        maxOpenPrs <= 0 ||
        openPatchPulseBranches.size + newPrsCreated < maxOpenPrs;
      // Existing PRs are always updated; new PRs respect the limit
      const canCreateNewPr = alreadyHasOpenPr || underLimit;

      const created = await processGroup({
        group,
        octokit,
        repoContext,
        autoMerge,
        commitPrefix,
        assignees,
        reviewers,
        teamReviewers,
        canCreateNewPr,
        cwd,
        dryRun,
      });

      if (created) newPrsCreated++;
    }

    core.info('\nDone!');
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

run();
