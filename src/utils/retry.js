// src/utils/retry.js
// Generic retry helper with exponential backoff

import { logger } from './logger.js';

/**
 * Retry an async function up to `maxAttempts` times.
 * @param {Function} fn          - Async function to run
 * @param {number}   maxAttempts - Max total tries (default 3)
 * @param {number}   baseDelayMs - Initial delay in ms (doubles each retry)
 */
export async function withRetry(fn, maxAttempts = 3, baseDelayMs = 1000) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        logger.warn(`Attempt ${attempt} failed. Retrying in ${delay}ms…`, err.message);
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
