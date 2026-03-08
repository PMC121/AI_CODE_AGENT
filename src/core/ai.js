// src/core/ai.js
// AI reasoning and code generation engine.
//
// KEY: Supports TWO different OpenAI APIs automatically:
//
//  ┌─────────────────────────────────────────────────────────────┐
//  │  Model             API to use          Notes                │
//  │  ──────────────    ─────────────────   ─────────────────    │
//  │  codex-mini-latest responses.create()  New Codex (2025)     │
//  │  o3-mini           responses.create()  Reasoning model      │
//  │  o1, o1-mini       responses.create()  Reasoning model      │
//  │  gpt-4o, gpt-4*    chat.completions    Standard chat API    │
//  └─────────────────────────────────────────────────────────────┘
//
//  The Codex / Responses API is NOT compatible with chat.completions.
//  Using chat.completions with codex-mini-latest will FAIL.

import OpenAI from 'openai';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const openai = new OpenAI({ apiKey: config.openai.apiKey });

// ─────────────────────────────────────────────────────────────────────────────
// Model routing helpers
// ─────────────────────────────────────────────────────────────────────────────



/**
 * Returns true for models that use the Responses API (Codex, o1, o3 families).
 * These models do NOT support: temperature, response_format, system role.
 */
function usesResponsesAPI(model) {
  return /codex|o1|o3/i.test(model ?? '');
}

/**
 * Unified AI call — routes to the correct API based on the configured model.
 *
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {{ temperature?: number, maxTokens?: number, jsonMode?: boolean }} [opts]
 * @returns {Promise<string>} - Raw text response from the model
 */
export async function callAI(systemPrompt, userPrompt, opts = {}) {
  // Clean model name from weird unicode hyphens that copy/paste might introduce
  const model = (config.openai.model || 'gpt-4o').replace(/‑/g, '-');
  const { temperature = 0.2, maxTokens = 16000, jsonMode = false } = opts;

  if (usesResponsesAPI(model)) {
    // ── Codex / Responses API ────────────────────────────────────────────────
    logger.info(`Using Responses API for model: ${model}`);

    const combinedInput = systemPrompt
      ? `${systemPrompt}\n\n---\n\n${userPrompt}`
      : userPrompt;

    const params = {
      model,
      input: combinedInput,
      max_output_tokens: maxTokens,
    };

    // Strongly hint the response API to use JSON structure correctly
    if (jsonMode) {
      params.text = { format: { type: 'json_object' } };
    }

    const response = await openai.responses.create(params);

    // Responses API returns: response.output[n] (which can be 'reasoning' or 'message')
    let aiText = '';

    // First, try the direct extracted text field that the API adds at the root
    if (typeof response.output_text === 'string' && response.output_text.length > 0) {
      aiText = response.output_text;
    } 
    // Otherwise, iterate through the nested structure
    else if (Array.isArray(response.output)) {
      for (const item of response.output) {
        if (item.type === 'message' && Array.isArray(item.content)) {
          for (const contentBlock of item.content) {
            if (contentBlock.type === 'output_text') {
              aiText += contentBlock.text || '';
            }
          }
        }
      }
    }

    return aiText.trim();
  } else {
    // ── Chat Completions API (gpt-4o, gpt-4-turbo, etc.) ────────────────────
    logger.info(`Using Chat Completions API for model: ${model}`);

    const params = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
      temperature,
      max_tokens: maxTokens,
    };

    if (jsonMode) {
      params.response_format = { type: 'json_object' };
    }

    const response = await openai.chat.completions.create(params);
    return response.choices[0].message.content;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON parse helper — robust against models that wrap JSON in markdown fences
// ─────────────────────────────────────────────────────────────────────────────

function parseJSON(raw, label) {
  if (!raw) {
    throw new Error(`AI returned an empty response for ${label}`);
  }

  // Strip markdown code fences if present
  let stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  // Sometimes models hallucinate a prefix before the JSON
  const firstBrace = stripped.indexOf('{');
  const lastBrace = stripped.lastIndexOf('}');
  
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    stripped = stripped.slice(firstBrace, lastBrace + 1);
  }

  try {
    return JSON.parse(stripped);
  } catch (err) {
    logger.error('──────────────────────────────────────────────────');
    logger.error(`🚨 FATAL: AI returned invalid JSON (${label})`);
    logger.error('Error:', err.message);
    logger.error('Raw AI Output:', raw);
    logger.error('──────────────────────────────────────────────────');
    throw new Error(`AI returned invalid JSON (${label}): ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT — Implementation
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert software engineer acting as an autonomous coding agent.

You have been given:
1. A full Repository Map — every file in the repo with a 1-sentence description of its purpose.
2. A Code Flow / Import Graph — which files import which others, and entry points.
3. Full content of the most RELEVANT files (selected by semantic similarity to the task).
4. A Jira ticket describing the change (use as a hint — reason primarily from the code).

YOUR DUTY:
- Study the Repository Map and Import Graph to understand the full architecture.
- Read the relevant file contents carefully before writing any code.
- Implement only the minimal changes needed — follow existing patterns and conventions.
- Do not break any existing functionality visible in the code.

Return ONLY a valid JSON object with this exact shape:

{
  "reasoning": "Step-by-step: what you understand about the architecture, what files are involved, and exactly what you will change and why.",
  "plan": "One paragraph summary of your implementation approach.",
  "commitMessage": "Conventional commit, e.g. feat(auth): add JWT refresh endpoint",
  "files": [
    {
      "path": "relative/path/to/file.ext",
      "content": "Complete file content (not a diff — the full file)"
    }
  ]
}

Rules:
- ONLY include files that are new or modified.
- Do NOT include binary files.
- Paths are relative to the repository root, forward slashes.
- Return ONLY the raw JSON — no prose, no markdown fences around the JSON.`;

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT — Error Fix
// ─────────────────────────────────────────────────────────────────────────────

const FIX_SYSTEM_PROMPT = `You are an expert software engineer and debugger acting as an autonomous coding agent.

You previously implemented changes to a codebase to satisfy a Jira ticket.
Those changes caused test/application failures.

You have been given:
1. The Repository Map (all files + purpose).
2. The Code Flow / Import Graph.
3. The full content of the most relevant files (current state after your changes).
4. The full error output from the failing run.
5. The original Jira ticket.

Diagnose step by step:
- Identify the exact failure from the error output.
- Use the import graph to trace which files the failure propagates through.
- Produce minimal, targeted fixes — do not rewrite working parts of the code.

Return ONLY a valid JSON object with this exact shape:

{
  "reasoning": "Step-by-step diagnosis: exact error, root cause, which files need fixing and what change fixes them.",
  "diagnosis": "One paragraph summary of the root cause.",
  "commitMessage": "fix: brief fix description",
  "files": [
    {
      "path": "relative/path/to/file.ext",
      "content": "Complete corrected file content"
    }
  ]
}

Return ONLY the raw JSON — no prose, no markdown fences around the JSON.`;

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ask the AI to reason about the repository and produce file changes.
 *
 * @param {object} ticket            - Normalised Jira ticket
 * @param {string} relevantContext   - Full content of semantically relevant files
 * @param {string} repoMap           - All files + 1-line purpose summaries
 * @param {string} [codeFlowSummary] - Import graph text from buildImportGraph()
 * @returns {{ reasoning, plan, commitMessage, files }}
 */
export async function generateImplementation(ticket, relevantContext, repoMap, codeFlowSummary = '') {
  logger.ai(`Reasoning with model: ${config.openai.model}`);

  const userPrompt = [
    repoMap,
    '',
    codeFlowSummary,
    '',
    '---',
    '',
    relevantContext,
    '',
    '---',
    '',
    '## Jira Ticket (supplementary context)',
    `ID:       ${ticket.id}`,
    `Type:     ${ticket.type}`,
    `Priority: ${ticket.priority}`,
    `Summary:  ${ticket.summary}`,
    `Labels:   ${(ticket.labels ?? []).join(', ') || 'none'}`,
    `Assignee: ${ticket.assignee}`,
    '',
    'Description:',
    ticket.description || '(no description provided)',
    '',
    '---',
    '',
    '## Task',
    'Implement the changes required by the Jira ticket above.',
    'Reason primarily from the code you can see. Use the ticket as a supplementary guide.',
  ].join('\n');

  const raw = await callAI(SYSTEM_PROMPT, userPrompt, {
    temperature: 0.15,
    maxTokens: 16000,
    jsonMode: true,
  });

  logger.ai('Implementation response received.');
  const parsed = parseJSON(raw, 'implementation');

  if (parsed.reasoning) {
    logger.ai(`Reasoning: ${parsed.reasoning.slice(0, 300)}…`);
  }
  logger.ai(`Plan: ${parsed.plan ?? '(none)'}`);
  logger.info(`Files to write: ${parsed.files?.length ?? 0}`);

  return parsed;
}

/**
 * Ask the AI to fix errors in the current codebase.
 *
 * @param {object} ticket            - Normalised Jira ticket
 * @param {string} relevantContext   - Current state of the most relevant files
 * @param {string} errorOutput       - Captured stdout/stderr from the failed run
 * @param {string} repoMap           - All files + 1-line purpose summaries
 * @param {string} [codeFlowSummary] - Import graph text
 * @returns {{ reasoning, diagnosis, commitMessage, files }}
 */
export async function generateErrorFix(ticket, relevantContext, errorOutput, repoMap, codeFlowSummary = '') {
  logger.ai(`Analysing errors with model: ${config.openai.model}`);

  const userPrompt = [
    repoMap,
    '',
    codeFlowSummary,
    '',
    '---',
    '',
    '## Error Output',
    '```',
    errorOutput.slice(0, 10000),
    '```',
    '',
    '---',
    '',
    '## Current File State (after previous changes)',
    relevantContext,
    '',
    '---',
    '',
    '## Original Jira Ticket',
    `ID: ${ticket.id}`,
    `Summary: ${ticket.summary}`,
  ].join('\n');

  const raw = await callAI(FIX_SYSTEM_PROMPT, userPrompt, {
    temperature: 0.1,
    maxTokens: 16000,
    jsonMode: true,
  });

  const parsed = parseJSON(raw, 'error-fix');

  if (parsed.reasoning) {
    logger.ai(`Reasoning: ${parsed.reasoning.slice(0, 300)}…`);
  }
  logger.ai(`Diagnosis: ${parsed.diagnosis ?? '(none)'}`);

  return parsed;
}
