/**
 * Structured audit logger — writes JSON lines to stderr.
 *
 * stdout is reserved for the MCP stdio protocol — we MUST NOT write
 * anything to stdout or the protocol will break.
 *
 * Destructive operations (sf_delete, sf_bulk_upsert, sf_apex) are
 * logged at WARN level; everything else at INFO.
 */

const WARN_TOOLS = new Set([
  'sf_delete', 'sf_bulk_upsert', 'sf_apex',
  'fs_patch_file', 'fs_write_file', 'fs_deploy',
]);

/**
 * Log a tool invocation.
 *
 * @param {string} tool    — tool name (e.g. "sf_query")
 * @param {object} args    — sanitized input arguments (scrubbed of large payloads)
 * @param {"success"|"error"} status
 * @param {string} [errorMessage] — error details on failure
 */
export function auditLog(tool, args, status, errorMessage) {
  const entry = {
    ts: new Date().toISOString(),
    level: WARN_TOOLS.has(tool) ? 'WARN' : 'INFO',
    tool,
    args: summarizeArgs(args),
    status,
  };
  if (errorMessage) entry.error = errorMessage;

  // Write to stderr as a single JSON line
  process.stderr.write(JSON.stringify(entry) + '\n');
}

/**
 * Summarizes arguments for the audit log — truncates large arrays
 * and long strings to keep log entries manageable.
 */
function summarizeArgs(args) {
  if (!args || typeof args !== 'object') return args;

  const summary = {};
  for (const [key, value] of Object.entries(args)) {
    if (Array.isArray(value)) {
      summary[key] = `[Array: ${value.length} items]`;
    } else if (typeof value === 'string' && value.length > 200) {
      summary[key] = value.slice(0, 200) + '… (truncated)';
    } else {
      summary[key] = value;
    }
  }
  return summary;
}
