// src/core/fileManager.js
// File system utilities for reading repo structure and applying AI-generated changes

import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger.js';

// File extensions the AI will read for context
const READABLE_EXTENSIONS = new Set([
  '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.java', '.cs', '.php', '.rs', '.swift', '.kt',
  '.html', '.css', '.scss', '.less',
  '.json', '.yaml', '.yml', '.toml', '.env.example',
  '.md', '.txt', '.sh', '.bash',
  '.sql', '.graphql', '.proto',
  'Dockerfile', '.dockerignore', '.gitignore',
  'Makefile',
]);

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', '.cache',
  '__pycache__', '.venv', 'venv', 'vendor', 'coverage', '.nyc_output',
]);

const MAX_FILE_SIZE_BYTES = 100_000; // 100 KB – skip very large files
const MAX_CONTEXT_CHARS = 80_000;   // Cap total context sent to AI

/**
 * Walk the repo and collect file paths the AI should read.
 */
export async function collectRepoFiles(rootPath) {
  const files = [];

  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) await walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name) || entry.name;
        if (READABLE_EXTENSIONS.has(ext) || READABLE_EXTENSIONS.has(entry.name)) {
          files.push(fullPath);
        }
      }
    }
  }

  await walk(rootPath);
  return files;
}

/**
 * Build a condensed context string with the most relevant file contents.
 * Prioritises package.json, README, and small files.
 */
export async function buildRepoContext(rootPath) {
  const files = await collectRepoFiles(rootPath);

  // Sort: config/doc files first, then smallest files
  files.sort((a, b) => {
    const priority = (f) => {
      const base = path.basename(f).toLowerCase();
      if (base === 'package.json' || base === 'readme.md') return 0;
      if (base.endsWith('.json') || base.endsWith('.yaml') || base.endsWith('.yml')) return 1;
      return 2;
    };
    return priority(a) - priority(b);
  });

  const parts = [];
  let totalChars = 0;
  const relativeRoot = rootPath;

  for (const filePath of files) {
    if (totalChars >= MAX_CONTEXT_CHARS) break;

    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      continue;
    }
    if (stat.size > MAX_FILE_SIZE_BYTES) continue;

    let content;
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch {
      continue;
    }

    const relativePath = path.relative(relativeRoot, filePath).replace(/\\/g, '/');
    const snippet = `### File: ${relativePath}\n\`\`\`\n${content}\n\`\`\`\n`;
    parts.push(snippet);
    totalChars += snippet.length;
  }

  return parts.join('\n');
}

/**
 * Apply a list of file changes produced by the AI.
 * Each change is: { path: string, content: string }
 */
export async function applyFileChanges(rootPath, changes) {
  for (const change of changes) {
    const absolutePath = path.join(rootPath, change.path);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, change.content, 'utf8');
    logger.success('File written', change.path);
  }
}
