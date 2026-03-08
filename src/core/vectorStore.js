// src/core/vectorStore.js
// Lightweight local vector store using JSON + cosine similarity.
// No external DB required — index is persisted as a single JSON file.

import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Cosine similarity between two float arrays
// ─────────────────────────────────────────────────────────────────────────────
function cosineSimilarity(a, b) {
  if (a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// ─────────────────────────────────────────────────────────────────────────────
// VectorStore class
// ─────────────────────────────────────────────────────────────────────────────
export class VectorStore {
  /**
   * @param {string} indexPath - Absolute path to the JSON index file
   */
  constructor(indexPath) {
    this.indexPath = indexPath;
    /** @type {Array<{path:string, purpose:string, embedding:number[], lastModified:number, size:number}>} */
    this.records = [];
    this._loaded = false;
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  async load() {
    try {
      const raw = await fs.readFile(this.indexPath, 'utf8');
      const data = JSON.parse(raw);
      this.records = data.files ?? [];
      this._loaded = true;
      logger.info('Vector store loaded', `${this.records.length} files indexed`);
    } catch {
      // First run — start empty
      this.records = [];
      this._loaded = true;
    }
  }

  async save() {
    await fs.mkdir(path.dirname(this.indexPath), { recursive: true });
    await fs.writeFile(
      this.indexPath,
      JSON.stringify({ files: this.records, updatedAt: Date.now() }, null, 2),
      'utf8'
    );
  }

  // ── Mutation ───────────────────────────────────────────────────────────────

  /**
   * Upsert a record (insert or replace by path).
   */
  upsert({ filePath, purpose, embedding, lastModified, size }) {
    const idx = this.records.findIndex((r) => r.path === filePath);
    const record = { path: filePath, purpose, embedding, lastModified, size };
    if (idx >= 0) {
      this.records[idx] = record;
    } else {
      this.records.push(record);
    }
  }

  /**
   * Remove records for files that no longer exist on disk.
   */
  prune(existingPaths) {
    const set = new Set(existingPaths);
    const before = this.records.length;
    this.records = this.records.filter((r) => set.has(r.path));
    const removed = before - this.records.length;
    if (removed > 0) logger.info('Vector store pruned', `${removed} stale records removed`);
  }

  // ── Query ──────────────────────────────────────────────────────────────────

  /**
   * Return the top-K most semantically similar files for a query embedding.
   * @param {number[]} queryEmbedding
   * @param {number}   topK
   * @returns {Array<{path, purpose, size, score}>}
   */
  search(queryEmbedding, topK = 20) {
    const scored = this.records.map((r) => ({
      path:    r.path,
      purpose: r.purpose,
      size:    r.size,
      score:   cosineSimilarity(queryEmbedding, r.embedding),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  /** Return ALL records (for building the repo map). */
  all() {
    return this.records.map(({ path, purpose, size, lastModified }) => ({
      path, purpose, size, lastModified,
    }));
  }

  /**
   * Returns true if a file is new or has been modified since last index.
   * @param {string} filePath - relative path
   * @param {number} mtime    - last modified timestamp in ms
   */
  needsReindex(filePath, mtime) {
    const rec = this.records.find((r) => r.path === filePath);
    return !rec || rec.lastModified < mtime;
  }

  get size() { return this.records.length; }
}
