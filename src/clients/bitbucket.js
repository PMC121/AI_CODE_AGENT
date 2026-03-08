// src/clients/bitbucket.js
// Bitbucket Cloud REST API 2.0 client

import axios from 'axios';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const { workspace, repoSlug, username, token, baseBranch, baseUrl } = config.bitbucket;

// If baseUrl is effectively undefined, default to api.bitbucket.org/2.0
const bUrl = baseUrl && baseUrl.length > 5 ? baseUrl.replace(/\/$/, '') : 'https://api.bitbucket.org/2.0';

const bbHttp = axios.create({
  baseURL: bUrl,
  auth: {
    username: username || 'x-token-auth',
    password: token
  },
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  },
});

/**
 * Returns the clone URL (HTTPS) for the configured repository.
 */
export async function getCloneUrl() {
  const res = await bbHttp.get(`/repositories/${workspace}/${repoSlug}`);
  const httpsLink = res.data.links.clone.find((l) => l.name === 'https');
  if (!httpsLink) throw new Error('No HTTPS clone URL found for repository');

  // Embed credentials into the URL so simple-git can authenticate
  const url = new URL(httpsLink.href);
  url.username = encodeURIComponent(username || 'x-token-auth');
  url.password = encodeURIComponent(token);
  return url.toString();
}

/**
 * Create a feature branch from `baseBranch`.
 * Returns the branch name.
 */
export async function createFeatureBranch(ticket) {
  const branchName = `feature/${ticket.id}`;
  logger.info('Creating feature branch…', branchName);

  try {
    // Get the HEAD commit of the base branch
    const refRes = await bbHttp.get(
      `/repositories/${workspace}/${repoSlug}/refs/branches/${baseBranch}`
    );
    logger.info('Creating feature branch… refRes', refRes);
    const targetHash = refRes.data.target.hash;

    // Create the branch
    await bbHttp.post(`/repositories/${workspace}/${repoSlug}/refs/branches`, {
      name: branchName,
      target: { hash: targetHash },
    });

    logger.success('Feature branch created', branchName);
    return branchName;
  } catch (err) {
    if (err.response?.status === 401) {
      throw new Error(`Bitbucket authentication failed (HTTP 401). Check your username (${username}), token, and that the workspace (${workspace}) is correct.`);
    }
    throw err;
  }
}

/**
 * Open a Pull Request from `branchName` → `baseBranch`.
 * Returns the PR URL.
 */
export async function createPullRequest(ticket, branchName, commitSummary) {
  logger.info('Creating Pull Request…');

  const title = `[${ticket.id}] ${ticket.summary}`;
  const description =
    `## Jira Ticket\n[${ticket.id}](${ticket.url})\n\n` +
    `## Summary\n${ticket.description}\n\n` +
    `## Changes\n${commitSummary}\n\n` +
    `---\n*Opened automatically by Autonomous AI Agent*`;

  const res = await bbHttp.post(`/repositories/${workspace}/${repoSlug}/pullrequests`, {
    title,
    description,
    source: { branch: { name: branchName } },
    destination: { branch: { name: baseBranch } },
    close_source_branch: true,
  });

  const prUrl = res.data.links.html.href;
  logger.success('Pull Request created!', prUrl);
  return prUrl;
}
