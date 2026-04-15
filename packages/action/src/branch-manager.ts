import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function git(args: string, cwd: string): Promise<string> {
  const { stdout } = await execAsync(`git ${args}`, { cwd });
  return stdout.trim();
}

/** Configures the git user for commits made by the action. */
export async function configureGit(
  cwd: string,
  owner: string,
  repo: string,
  token: string,
): Promise<void> {
  await git(
    'config user.email "github-actions[bot]@users.noreply.github.com"',
    cwd,
  );
  await git('config user.name "github-actions[bot]"', cwd);
  // Use the token for HTTPS pushes
  await git(
    `remote set-url origin https://x-access-token:${token}@github.com/${owner}/${repo}.git`,
    cwd,
  );
}

/**
 * Creates a fresh local branch from the default branch.
 * If the local branch already exists it is deleted first so the new one starts clean.
 */
export async function setupBranch({
  branchName,
  defaultBranch,
  cwd,
}: {
  branchName: string;
  defaultBranch: string;
  cwd: string;
}): Promise<void> {
  await git(`checkout ${defaultBranch}`, cwd);
  await git('pull --ff-only', cwd);

  // Delete local branch if it exists from a previous run
  try {
    await git(`branch -D ${branchName}`, cwd);
  } catch {
    // Branch didn't exist — that's fine
  }

  await git(`checkout -b ${branchName}`, cwd);
}

/** Stages all changes, commits, and force-pushes the branch. */
export async function commitAndPush({
  branchName,
  message,
  cwd,
}: {
  branchName: string;
  message: string;
  cwd: string;
}): Promise<void> {
  await git('add .', cwd);
  // Use -m with escaped message to avoid shell injection
  const safeMessage = message.replace(/'/g, "'\\''");
  await git(`commit -m '${safeMessage}'`, cwd);
  // --force-with-lease is safer than --force: fails if someone else pushed
  await git(`push --force-with-lease origin ${branchName}`, cwd);
}
