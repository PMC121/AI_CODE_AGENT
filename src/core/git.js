// src/core/git.js
// Git operations via simple-git

import simpleGit from 'simple-git';
import path from 'path';
import fs from 'fs/promises';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

/**
 * Clone the repository into <cloneBasePath>/<ticketId>/
 * Returns the local path.
 */
export async function cloneRepository(cloneUrl, ticketId) {
  const localPath = path.join(config.agent.cloneBasePath, ticketId);

  // Clean up any previous attempt
  await fs.rm(localPath, { recursive: true, force: true });
  await fs.mkdir(localPath, { recursive: true });

  logger.info('Cloning repository…', localPath);
  const git = simpleGit();
  await git.clone(cloneUrl, localPath, ['--depth', '1']);

  logger.success('Repository cloned', localPath);
  return localPath;
}

/**
 * Checkout a branch (that already exists remotely).
 */
export async function checkoutBranch(localPath, branchName) {
  logger.info('Checking out branch…', branchName);
  const git = simpleGit(localPath);

  try {
    // Attempt to pull from remote if the branch already exists (old Bitbucket flow)
    await git.fetch('origin', branchName);
    await git.checkout(['-b', branchName, `origin/${branchName}`]);
    logger.success('Branch checked out from remote', branchName);
  } catch (err) {
    // If not on remote, create it locally via git (Bypass Git Flow)
    logger.info('Branch not on remote, creating locally via git…', branchName);
    await git.checkoutLocalBranch(branchName);
    logger.success('Local branch created successfully', branchName);
  }
}

/**
 * Stage all changes, commit them with a message.
 */
export async function commitChanges(localPath, message) {
  logger.info('Committing changes…');
  const git = simpleGit(localPath);

  await git.addConfig('user.email', config.jira.email);
  await git.addConfig('user.name', 'Autonomous AI Agent');

  await git.add('.');
  const result = await git.commit(message);
  logger.success('Changes committed', result.commit);
  return result.commit;
}

/**
 * Push the current branch to origin.
 */
export async function pushBranch(localPath, branchName) {
  logger.info('Pushing branch to remote…', branchName);
  const git = simpleGit(localPath);
  await git.push('origin', branchName, ['--set-upstream']);
  logger.success('Branch pushed', branchName);
}

/**
 * Returns the diff of all staged changes (for PR description).
 */
export async function getStagedDiff(localPath) {
  const git = simpleGit(localPath);
  return git.diff(['HEAD']);
}
