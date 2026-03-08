// src/core/repoIndexer.js
// Indexes a repository by:
//   1. Walking all source files
//   2. Generating a 1-sentence purpose summary per file (via Codex/GPT)
//   3. Embedding the summary (text-embedding-3-small)
//   4. Persisting to a local VectorStore
//
// Incremental: only re-indexes files that are new or modified since last run.

import fs from 'fs/promises';
import path from 'path';
import OpenAI from 'openai';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { VectorStore } from './vectorStore.js';
import { collectRepoFiles } from './fileManager.js';

const openai = new OpenAI({ apiKey: config.openai.apiKey });

const BATCH_SIZE = 8;      // Files per summarisation request (fewer API calls)
const MAX_FILE_CHARS = 6000;  // Chars of file content sent to summariser

// ─────────────────────────────────────────────────────────────────────────────
// Summarise a batch of files in a single AI call
// ─────────────────────────────────────────────────────────────────────────────

async function summariseBatch(batch) {
  // batch: Array<{ path: string, content: string }>
  const batchText = batch
    .map(
      (f, i) =>
        `### File ${i + 1}: ${f.path}\n\`\`\`\n${f.content.slice(0, MAX_FILE_CHARS)}\n\`\`\``
    )
    .join('\n\n');

  const systemPrompt =
    'You are a senior engineer analysing a codebase. ' +
    'For each file provided, write exactly ONE sentence (≤ 25 words) describing its purpose and role. ' +
    'Return ONLY a valid JSON object: { "summaries": ["sentence1", "sentence2", ...] }. ' +
    'One entry per file, in the same order. No other text.';

  const userPrompt = `Summarise the following ${batch.length} file(s):\n\n${batchText}`;

  // Use the configured model (Codex or fallback GPT)
  const raw = await callAI(systemPrompt, userPrompt, { temperature: 0, maxTokens: 2048, jsonMode: true });

  let parsed;
  try {
    const obj = JSON.parse(raw);
    parsed = Array.isArray(obj) ? obj : (obj.summaries ?? Object.values(obj));
  } catch {
    parsed = batch.map((f) => `Source file: ${path.basename(f.path)}`);
  }

  // Guard against wrong array length
  while (parsed.length < batch.length) {
    parsed.push(`Source file: ${path.basename(batch[parsed.length]?.path ?? 'unknown')}`);
  }
  return parsed.slice(0, batch.length);
}

// ─────────────────────────────────────────────────────────────────────────────
// Generate embeddings (text-embedding-3-small, batched)
// ─────────────────────────────────────────────────────────────────────────────

async function embedTexts(texts) {
  const response = await openai.embeddings.create({
    model: config.openai.embeddingModel,
    input: texts,
  });
  return response.data.map((d) => d.embedding);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Index (or incrementally refresh) the repository.
 * Returns the hydrated VectorStore ready for semantic search.
 *
 * @param {string} rootPath - Absolute path to the cloned repo
 * @returns {Promise<VectorStore>}
 */
export async function indexRepository(rootPath) {
  const indexPath = path.join(rootPath, '.agent-index', 'index.json');
  const store = new VectorStore(indexPath);
  await store.load();

  // ── Collect all readable files ─────────────────────────────────────────────
  const allFiles = await collectRepoFiles(rootPath);
  logger.info('Repo indexer', `${allFiles.length} readable files found`);

  // ── Prune deleted files from index ────────────────────────────────────────
  const relativePaths = allFiles.map((f) =>
    path.relative(rootPath, f).replace(/\\/g, '/')
  );
  store.prune(relativePaths);

  // ── Determine which files need re-indexing ────────────────────────────────
  const toIndex = [];
  for (const absPath of allFiles) {
    const rel = path.relative(rootPath, absPath).replace(/\\/g, '/');
    let stat;
    try { stat = await fs.stat(absPath); } catch { continue; }
    if (store.needsReindex(rel, stat.mtimeMs)) {
      toIndex.push({ absPath, rel, mtime: stat.mtimeMs, size: stat.size });
    }
  }

  if (toIndex.length === 0) {
    logger.success('Repo index is up to date', `${store.size} files`);
    return store;
  }

  logger.info('Repo indexer', `Indexing ${toIndex.length} new/modified files…`);

  // ── Read contents ─────────────────────────────────────────────────────────
  const withContent = (
    await Promise.all(
      toIndex.map(async (f) => {
        try {
          const content = await fs.readFile(f.absPath, 'utf8');
          return { ...f, content };
        } catch { return null; }
      })
    )
  ).filter(Boolean);

  // ── Summarise in batches ───────────────────────────────────────────────────
  const summaries = [];
  for (let i = 0; i < withContent.length; i += BATCH_SIZE) {
    const batch = withContent.slice(i, i + BATCH_SIZE);
    logger.info(
      'Summarising files',
      `${i + 1}–${Math.min(i + BATCH_SIZE, withContent.length)} / ${withContent.length}`
    );
    const batchSummaries = await summariseBatch(
      batch.map((f) => ({ path: f.rel, content: f.content }))
    );
    summaries.push(...batchSummaries);
  }

  // ── Embed (path + summary combined for richer signal) ─────────────────────
  const textsToEmbed = withContent.map((f, i) => `${f.rel}: ${summaries[i] ?? ''}`);

  logger.info('Generating embeddings', `${textsToEmbed.length} files…`);
  const embeddings = [];
  // Embedding API accepts up to 100 inputs per request
  for (let i = 0; i < textsToEmbed.length; i += 100) {
    const batch = textsToEmbed.slice(i, i + 100);
    const batchEmbs = await embedTexts(batch);
    embeddings.push(...batchEmbs);
  }

  // ── Upsert into store and persist ────────────────────────────────────────
  for (let i = 0; i < withContent.length; i++) {
    store.upsert({
      filePath: withContent[i].rel,
      purpose: summaries[i] ?? '',
      embedding: embeddings[i],
      lastModified: withContent[i].mtime,
      size: withContent[i].size,
    });
  }

  await store.save();
  logger.success('Repo index saved', `${store.size} files total`);
  return store;
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-export the low-level AI caller so repoIndexer works with Codex or GPT
// (imported lazily to avoid circular deps)
// ─────────────────────────────────────────────────────────────────────────────
async function callAI(systemPrompt, userPrompt, opts) {
  const { callAI: _callAI } = await import('./ai.js');
  return _callAI(systemPrompt, userPrompt, opts);
}
