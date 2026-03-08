// src/core/codeFlow.js
// Regex-based static import/require graph analysis.
// Works with JS, TS, Python. No AST parser required.

import fs from 'fs/promises';
import path from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// Extract import strings from source content
// ─────────────────────────────────────────────────────────────────────────────

const JS_IMPORT_RE = /(?:import\s+.*?\s+from\s+['"](.+?)['"]|require\s*\(\s*['"](.+?)['"]\s*\))/g;
const PY_IMPORT_RE = /^\s*(?:from\s+(\S+)\s+import|import\s+(\S+))/gm;

function extractImports(content, ext) {
  const imports = new Set();
  const re = (ext === '.py') ? PY_IMPORT_RE : JS_IMPORT_RE;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(content)) !== null) {
    const imp = (m[1] || m[2] || '').trim();
    if (imp) imports.add(imp);
  }
  return [...imports];
}

/**
 * Resolve a raw import string (e.g. '../utils/logger') to a canonical
 * repo-relative path. Returns null for external packages.
 */
function resolveLocal(importStr, importerDir, rootPath) {
  if (!importStr.startsWith('.')) return null;

  const candidates = [
    importStr,
    `${importStr}.js`, `${importStr}.ts`,
    `${importStr}.jsx`, `${importStr}.tsx`,
    `${importStr}/index.js`, `${importStr}/index.ts`,
  ];

  for (const c of candidates) {
    const abs = path.resolve(importerDir, c);
    const rel = path.relative(rootPath, abs).replace(/\\/g, '/');
    if (!rel.startsWith('..')) return rel;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Build full import graph across the repo
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string[]} filePaths - Absolute paths to all repo files
 * @param {string}   rootPath  - Repo root (absolute)
 * @returns {{
 *   graph: Record<string, string[]>,
 *   entryPoints: string[],
 *   summary: string
 * }}
 */
export async function buildImportGraph(filePaths, rootPath) {
  const graph = {};

  for (const absPath of filePaths) {
    const ext = path.extname(absPath);
    const rel = path.relative(rootPath, absPath).replace(/\\/g, '/');

    let content = '';
    try { content = await fs.readFile(absPath, 'utf8'); } catch { /* skip */ }

    const rawImports = extractImports(content, ext);
    const localImports = rawImports
      .map((imp) => resolveLocal(imp, path.dirname(absPath), rootPath))
      .filter(Boolean);

    graph[rel] = [...new Set(localImports)];
  }

  // ── Entry points: files that are never imported by any other file ──────────
  const allImported = new Set(Object.values(graph).flat());
  const entryPoints = Object.keys(graph).filter((f) => !allImported.has(f));

  // ── Human-readable summary for the AI ─────────────────────────────────────
  const lines = ['## Code Flow / Import Graph\n'];
  lines.push('### Entry Points (top-level files, not imported by others)');
  for (const ep of entryPoints) lines.push(`  - ${ep}`);
  lines.push('');
  lines.push('### Import Relationships');
  for (const [file, imports] of Object.entries(graph)) {
    if (imports.length === 0) continue;
    lines.push(`  ${file}`);
    for (const imp of imports) lines.push(`    └─ ${imp}`);
  }

  return { graph, entryPoints, summary: lines.join('\n') };
}

/**
 * Find all files that directly import a given target file.
 * Useful for impact analysis ("what breaks if I change X?").
 */
export function findDependents(graph, targetRelPath) {
  return Object.entries(graph)
    .filter(([, imports]) => imports.includes(targetRelPath))
    .map(([file]) => file);
}
