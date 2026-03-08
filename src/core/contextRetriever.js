// src/core/contextRetriever.js
// Semantic context retrieval:
//   1. Embed the task description / Jira ticket
//   2. Search the VectorStore for the most relevant files
//   3. Return FULL content for top-K relevant files + 1-line summaries for the rest
//
// This replaces the naive "concatenate everything up to 80K chars" strategy.

import fs from 'fs/promises';
import path from 'path';
import OpenAI from 'openai';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const openai = new OpenAI({ apiKey: config.openai.apiKey });

const MAX_FULL_CHARS = 120_000;  // Total chars budget for full-content files
const MAX_FILE_CHARS =  10_000;  // Per-file cap before truncation

// ─────────────────────────────────────────────────────────────────────────────
// Embed a short query string
// ─────────────────────────────────────────────────────────────────────────────

async function embedQuery(text) {
  const response = await openai.embeddings.create({
    model: config.openai.embeddingModel,
    input: text.slice(0, 8000), // embedding API limit
  });
  return response.data[0].embedding;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a rich, semantically-targeted context string for the AI.
 * Instead of dumping the whole repo, we pick the most relevant files.
 *
 * @param {object} ticket       - Normalised Jira ticket
 * @param {string} rootPath     - Absolute path to the cloned repo
 * @param {import('./vectorStore.js').VectorStore} store - Loaded vector store
 * @param {object} [importGraph] - Output from buildImportGraph (optional)
 * @param {number} [topK]       - Number of files to include with full content
 * @returns {{ context: string, relevantFiles: string[], repoMap: string }}
 */
export async function buildSemanticContext(ticket, rootPath, store, importGraph, topK = config.agent.topKFullContext) {
  // ── Compose query — tolerant of vague tickets ─────────────────────────────
  const queryParts = [
    ticket.summary        ? `Task: ${ticket.summary}`        : '',
    ticket.description    ? `Details: ${ticket.description.slice(0, 400)}` : '',
    ticket.type           ? `Type: ${ticket.type}`           : '',
    ticket.labels?.length ? `Labels: ${ticket.labels.join(', ')}`          : '',
  ].filter(Boolean);

  const queryText = queryParts.length > 0
    ? queryParts.join('\n')
    : 'general code modification';

  logger.ai('Computing semantic similarity for file retrieval…');
  const queryEmbedding = await embedQuery(queryText);

  // ── Semantic search ───────────────────────────────────────────────────────
  const topResults = store.search(queryEmbedding, topK);
  const topPaths   = new Set(topResults.map((r) => r.path));

  // ── Always include structural / entry-point files ──────────────────────────
  const mustIncludePaths = new Set([
    ...(importGraph?.entryPoints ?? []),
    'package.json',
    'pyproject.toml',
    'requirements.txt',
    '.env.example',
    'tsconfig.json',
    'Dockerfile',
    'Makefile',
    'README.md',
  ]);

  // ── Build Repo Map (all files with 1-line purpose, sorted) ────────────────
  const allRecords = store.all().sort((a, b) => a.path.localeCompare(b.path));
  const repoMapLines = ['## Repository Map\n'];
  for (const rec of allRecords) {
    const marker = topPaths.has(rec.path) ? '★' : ' '; // ★ = selected for full content
    repoMapLines.push(`  ${marker} ${rec.path}`);
    repoMapLines.push(`      → ${rec.purpose}`);
  }
  const repoMap = repoMapLines.join('\n');

  // ── Load full content for top-K + must-include files ──────────────────────
  const orderedPaths = [
    ...topResults.map((r) => r.path),
    ...[...mustIncludePaths].filter((p) => !topPaths.has(p)),
  ];

  const parts = ['## Relevant Source Files (full content, ★ in repo map)\n'];
  let totalChars = 0;
  const alreadyAdded = new Set();

  for (const relPath of orderedPaths) {
    if (alreadyAdded.has(relPath)) continue;
    if (totalChars >= MAX_FULL_CHARS) break;

    const absPath = path.join(rootPath, relPath);
    let content;
    try {
      content = await fs.readFile(absPath, 'utf8');
    } catch {
      continue; // file may not exist (must-include candidates)
    }

    if (content.length > MAX_FILE_CHARS) {
      content = content.slice(0, MAX_FILE_CHARS) + '\n... [truncated — file continues]';
    }

    const scoreEntry = topResults.find((r) => r.path === relPath);
    const scoreLabel = scoreEntry
      ? ` (relevance: ${(scoreEntry.score * 100).toFixed(1)}%)`
      : ' (always included)';

    const snippet = `### ${relPath}${scoreLabel}\n\`\`\`\n${content}\n\`\`\`\n`;
    parts.push(snippet);
    totalChars += snippet.length;
    alreadyAdded.add(relPath);
  }

  logger.info(
    'Semantic context ready',
    `${alreadyAdded.size} files with full content (~${Math.round(totalChars / 1000)}k chars)`
  );

  return {
    context:       parts.join('\n'),
    relevantFiles: [...alreadyAdded],
    repoMap,
  };
}
