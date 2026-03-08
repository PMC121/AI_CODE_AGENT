// src/index.js
// ─────────────────────────────────────────────────────────────────────────────
// Autonomous AI Coding Agent — Orchestrator
// ─────────────────────────────────────────────────────────────────────────────
//
// Usage:
//   node src/index.js <JIRA_TICKET_ID>
//   e.g.  node src/index.js PROJ-123
// ─────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';

import { logger } from './utils/logger.js';
import { config } from './config.js';
import { fetchJiraTicket } from './clients/jira.js';
import { createFeatureBranch, createPullRequest, getCloneUrl } from './clients/bitbucket-bypass.js';
import { cloneRepository, checkoutBranch, commitChanges, pushBranch } from './core/git.js';
import { collectRepoFiles, applyFileChanges } from './core/fileManager.js';
import { indexRepository } from './core/repoIndexer.js';
import { buildSemanticContext } from './core/contextRetriever.js';
import { buildImportGraph } from './core/codeFlow.js';
import { generateImplementation, generateErrorFix } from './core/ai.js';
import { runApplication } from './core/appRunner.js';

const TOTAL_STEPS = 13;

async function main() {
  // ── Parse ticket ID from CLI ─────────────────────────────────────────────
  const ticketId = process.argv[2];
  if (!ticketId) {
    console.error('Usage: node src/index.js <JIRA_TICKET_ID>');
    process.exit(1);
  }

  console.log('\n');
  logger.divider();
  logger.info('🚀 Autonomous AI Coding Agent starting', ticketId);
  logger.info('Model:', config.openai.model);
  logger.divider();

  try {
    // ── STEP 1: Fetch Jira Ticket ─────────────────────────────────────────
    logger.step(1, TOTAL_STEPS, 'Fetch Jira ticket');
    const ticket = await fetchJiraTicket(ticketId);

    // ── STEP 2: Create Feature Branch ────────────────────────────────────
    logger.step(2, TOTAL_STEPS, 'Create feature branch in Bitbucket');
    const branchName = await createFeatureBranch(ticket);

    // ── STEP 3: Clone Repository ──────────────────────────────────────────
    logger.step(3, TOTAL_STEPS, 'Clone repository');
    const cloneUrl = await getCloneUrl();
    const localPath = await cloneRepository(cloneUrl, ticketId);

    // ── STEP 4: Checkout Feature Branch ──────────────────────────────────
    logger.step(4, TOTAL_STEPS, 'Checkout feature branch');
    await checkoutBranch(localPath, branchName);

    // ── STEP 5: Index repository (embeddings + file summaries) ────────────
    logger.step(5, TOTAL_STEPS, 'Index repository (file summaries + embeddings)');
    let store = null;
    let importGraph = null;
    let repoMap = '';
    let codeFlow = '';

    if (config.agent.skipIndexing) {
      logger.warn('SKIP_INDEXING=true — using raw file concatenation (for small repos only)');
    } else {
      // Build import graph (code flow analysis)
      const allFiles = await collectRepoFiles(localPath);
      importGraph = await buildImportGraph(allFiles, localPath);
      codeFlow = importGraph.summary;
      logger.info('Code flow analysed', `${Object.keys(importGraph.graph).length} files mapped`);

      // Index files → embeddings
      store = await indexRepository(localPath);
      logger.success(
        'Repository indexed',
        `${store.size} files in embedding store`
      );
    }

    // ── STEP 6: Retrieve semantically relevant context ────────────────────
    logger.step(6, TOTAL_STEPS, 'Semantic context retrieval (embedding search)');
    let relevantContext;

    if (config.agent.skipIndexing || !store) {
      // Fallback: raw concatenation (v1 behaviour for tiny repos)
      const { buildRepoContext } = await import('./core/fileManager.js');
      relevantContext = await buildRepoContext(localPath);
      repoMap = '(repo map not available — SKIP_INDEXING=true)';
      codeFlow = '';
      logger.info('Raw context built', `~${Math.round(relevantContext.length / 1000)}k chars`);
    } else {
      const result = await buildSemanticContext(ticket, localPath, store, importGraph);
      relevantContext = result.context;
      repoMap = result.repoMap;
      logger.info('Semantic context ready', `${result.relevantFiles.length} files selected`);
    }

    // ── STEP 7: AI reasons about codebase and generates implementation ────
    logger.step(7, TOTAL_STEPS, `AI code generation (model: ${config.openai.model})`);
    const implementation = await generateImplementation(
      ticket,
      relevantContext,
      repoMap,
      codeFlow
    );
    await applyFileChanges(localPath, implementation.files);

    // ── STEP 8 & 9: Run app + auto-fix loop ──────────────────────────────
    logger.step(8, TOTAL_STEPS, 'Run application locally (tests)');

    let runResult = await runApplication(localPath);
    let fixAttempt = 0;
    let lastCommitMessage =
      implementation.commitMessage || `feat(${ticketId}): implement ${ticket.summary}`;

    while (!runResult.success && fixAttempt < config.agent.maxFixAttempts) {
      fixAttempt++;
      logger.step(9, TOTAL_STEPS, `Auto-fix errors (attempt ${fixAttempt}/${config.agent.maxFixAttempts})`);

      // Re-index to pick up the files the AI just wrote
      let fixContext, fixRepoMap = repoMap, fixCodeFlow = codeFlow;

      if (!config.agent.skipIndexing) {
        const freshStore = await indexRepository(localPath);
        const fixResult = await buildSemanticContext(ticket, localPath, freshStore, importGraph);
        fixContext = fixResult.context;
        fixRepoMap = fixResult.repoMap;
      } else {
        const { buildRepoContext } = await import('./core/fileManager.js');
        fixContext = await buildRepoContext(localPath);
      }

      const fix = await generateErrorFix(
        ticket,
        fixContext,
        runResult.output,
        fixRepoMap,
        fixCodeFlow
      );
      await applyFileChanges(localPath, fix.files);
      lastCommitMessage = fix.commitMessage || lastCommitMessage;

      runResult = await runApplication(localPath);
    }

    if (!runResult.success) {
      logger.warn(
        `Application still failing after ${config.agent.maxFixAttempts} fix attempts.`,
        'Committing anyway and opening a draft PR for manual review.'
      );
    }

    // ── STEP 10: Commit Changes ────────────────────────────────────────────
    logger.step(10, TOTAL_STEPS, 'Commit changes');
    await commitChanges(localPath, lastCommitMessage);

    // ── STEP 11: Push Branch ─────────────────────────────────────────────
    logger.step(11, TOTAL_STEPS, 'Push branch to Bitbucket');
    await pushBranch(localPath, branchName);

    // ── STEP 12 & 13: Create Pull Request ────────────────────────────────
    logger.step(12, TOTAL_STEPS, 'Create Pull Request');
    const prUrl = await createPullRequest(ticket, branchName, implementation.plan);

    // ── Done ──────────────────────────────────────────────────────────────
    logger.divider();
    logger.success('✅ All steps completed successfully!');
    logger.info('Pull Request:', prUrl);
    logger.info('Branch:', branchName);
    logger.info('Model used:', config.openai.model);
    logger.divider();

  } catch (err) {
    logger.divider();
    logger.error('Agent failed with an unrecoverable error');
    logger.error(err.stack || err.message);
    if (err.response?.data) {
      logger.error('API Response:', JSON.stringify(err.response.data, null, 2));
    }
    logger.divider();
    process.exit(1);
  }
}

main();
