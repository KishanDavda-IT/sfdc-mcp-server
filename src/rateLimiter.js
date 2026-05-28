/**
 * In-process sliding-window rate limiter with weighted calls.
 *
 * Configured via environment variables:
 *   SF_RATE_LIMIT_MAX        — max cost units per window (default: 100)
 *   SF_RATE_LIMIT_WINDOW_MS  — window size in ms (default: 60000 = 1 min)
 *
 * Tool weights:
 *   - Lightweight ops (list_objects, describe, get, query, search): 1
 *   - Write ops (create, update, delete): 2
 *   - Heavy ops (bulk_upsert, apex): 5
 *
 * Returns an MCP-compatible error response when the budget is hit.
 */

import { SecurityError } from './security.js';

const MAX_COST = parseInt(process.env.SF_RATE_LIMIT_MAX || '100', 10);
const WINDOW_MS = parseInt(process.env.SF_RATE_LIMIT_WINDOW_MS || '60000', 10);

/** @type {{ ts: number, cost: number }[]} */
const entries = [];

/**
 * Checks the rate limit. Throws SecurityError if exceeded.
 *
 * @param {number} [weight=1] — cost of this call. Heavy operations
 *   should pass a higher weight (e.g. 5 for sf_bulk_upsert).
 */
export function checkRateLimit(weight = 1) {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  // Prune expired entries
  while (entries.length > 0 && entries[0].ts <= windowStart) {
    entries.shift();
  }

  // Sum current cost in window
  const currentCost = entries.reduce((sum, e) => sum + e.cost, 0);

  if (currentCost + weight > MAX_COST) {
    throw new SecurityError(
      `Rate limit exceeded: ${currentCost}/${MAX_COST} cost units used in ${WINDOW_MS / 1000}s window (this call costs ${weight}). Please wait before retrying.`,
      'RATE_LIMIT_EXCEEDED',
    );
  }

  entries.push({ ts: now, cost: weight });
}

/**
 * Resets the rate limiter (for testing purposes only).
 */
export function resetRateLimit() {
  entries.length = 0;
}
