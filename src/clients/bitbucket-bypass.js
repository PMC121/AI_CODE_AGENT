// src/clients/bitbucket-bypass.js
// A strictly Git-based workflow that bypasses Bitbucket's REST APIs.
// This is to avoid HTTP 401 errors from strict server setups.

import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const { workspace, repoSlug, username, token } = config.bitbucket;

/**
 * Construct the clone URL locally without calling the REST API.
 */
export async function getCloneUrl() {
  const encUser = encodeURIComponent(username || 'x-token-auth');
  const encToken = encodeURIComponent(token);
  
  // Create an HTTPS Git clone URL directly
  return `https://${encUser}:${encToken}@bitbucket.org/${workspace}/${repoSlug}.git`;
}

/**
 * Generate a branch name without calling the REST API. 
 * The actual branch will be created locally via `git checkout -b` later in the pipeline.
 */
export async function createFeatureBranch(ticket) {
  const branchName = `feature/${ticket.id}`;
  logger.info('Branch will be created locally via Git (REST API bypassed)', branchName);
  return branchName;
}

/**
 * Skip Pull Request creation to avoid REST API calls. 
 * Returns a template URL so the user can open it manually.
 */
export async function createPullRequest(ticket, branchName, commitSummary) {
  logger.warn('Skipping automated Pull Request (REST API bypassed)');
  logger.info('--> Please open the Pull Request manually in your browser when ready. <--');
  
  // Return a guess of the PR creation link
  return `https://bitbucket.org/${workspace}/${repoSlug}/branch/${branchName}`;
}
