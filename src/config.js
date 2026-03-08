// src/config.js
// Loads and validates all environment variables

import 'dotenv/config';
import path from 'path';

function require_env(key) {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optional_env(key, defaultValue = '') {
  return process.env[key] ?? defaultValue;
}

export const config = {
  jira: {
    baseUrl: require_env('JIRA_BASE_URL').replace(/\/$/, ''),
    email: require_env('JIRA_EMAIL'),
    apiToken: require_env('JIRA_API_TOKEN'),
    projectKey: optional_env('JIRA_PROJECT_KEY'),
  },

  bitbucket: {
    workspace: require_env('BITBUCKET_WORKSPACE'),
    repoSlug: require_env('BITBUCKET_REPO_SLUG'),
    username: optional_env('BITBUCKET_USERNAME', 'x-token-auth'),
    token: require_env('BITBUCKET_TOKEN'),
    baseBranch: optional_env('BITBUCKET_BASE_BRANCH', 'develop'),
    baseUrl: require_env('BITBUCKET_BASEURL')
  },

  openai: {
    apiKey: require_env('OPENAI_API_KEY'),

    // ── Code generation model ────────────────────────────────────────────────
    // Options:
    //   gpt-4o              Latest and recommended for coding and stability
    //   gpt-4o-mini         Fastest and cheapest
    //   o1-mini / o3-mini   Reasoning models (requires Tier 5 OpenAI account)
    //
    // Note: The original OpenAI "Codex" models (code-davinci-002) were
    // fully deprecated in 2023. GPT-4o is its official successor.
    model: optional_env('OPENAI_MODEL', 'gpt-4o'),

    // ── Embedding model (for semantic file retrieval) ────────────────────────
    // text-embedding-3-small is fast, cheap, and highly accurate.
    embeddingModel: optional_env('OPENAI_EMBEDDING_MODEL', 'text-embedding-3-small'),
  },

  agent: {
    cloneBasePath: path.resolve(optional_env('CLONE_BASE_PATH', './workspaces')),
    maxFixAttempts: parseInt(optional_env('MAX_FIX_ATTEMPTS', '3'), 10),
    appStartCommand: optional_env('APP_START_COMMAND', 'npm test'),
    appTimeoutMs: parseInt(optional_env('APP_TIMEOUT_MS', '30000'), 10),

    // ── Semantic retrieval ───────────────────────────────────────────────────
    // How many files to include with FULL content (top-K by semantic similarity)
    topKFullContext: parseInt(optional_env('TOP_K_FULL_CONTEXT', '20'), 10),

    // Skip indexing step (use raw file concatenation) — for tiny repos
    skipIndexing: optional_env('SKIP_INDEXING', 'false') === 'true',
  },
};
