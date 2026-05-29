import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { resolveSafePath } from '../pathSecurity.js';
import { checkRateLimit } from '../rateLimiter.js';
import { auditLog } from '../auditLog.js';

/** Directories to skip during recursive traversal. */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.sfdx',
  '.sf',
  '.husky',
]);

/**
 * Recursively builds a directory tree structure.
 *
 * @param {string} dirPath  — absolute path to the directory
 * @param {number} current  — current depth level
 * @param {number} maxDepth — maximum depth to recurse
 * @returns {Promise<object[]>} nested tree nodes
 */
async function buildTree(dirPath, current, maxDepth) {
  if (current > maxDepth) return [];

  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return []; // silently skip unreadable dirs (permissions, etc.)
  }

  // Sort entries: directories first, then files, both alphabetically
  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  const nodes = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;

      const children = await buildTree(
        path.join(dirPath, entry.name),
        current + 1,
        maxDepth,
      );
      nodes.push({
        name: entry.name,
        type: 'directory',
        children,
      });
    } else if (entry.isFile()) {
      nodes.push({
        name: entry.name,
        type: 'file',
      });
    }
    // Symlinks, sockets, etc. are intentionally excluded
  }

  return nodes;
}

export function registerFsListTree(server) {
  server.tool(
    'fs_list_tree',
    'List files and directories recursively from the project root (FS_ROOT_DIR). ' +
      'Returns a nested JSON tree structure. Use to discover project layout before reading files.',
    {
      path: z
        .string()
        .optional()
        .default('.')
        .describe(
          'Subdirectory relative to FS_ROOT_DIR to list. Defaults to "." (root).',
        ),
      depth: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .default(5)
        .describe(
          'Maximum recursion depth (1–10). Default: 5.',
        ),
    },
    async (input) => {
      try {
        checkRateLimit(1);

        const resolved = await resolveSafePath(input.path);

        // Verify it's a directory
        const stat = await fs.stat(resolved);
        if (!stat.isDirectory()) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: `"${input.path}" is not a directory.`,
                  errorCode: 'NOT_A_DIRECTORY',
                }),
              },
            ],
            isError: true,
          };
        }

        const tree = await buildTree(resolved, 1, input.depth);

        auditLog('fs_list_tree', input, 'success');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                { root: input.path, depth: input.depth, tree },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        auditLog('fs_list_tree', input, 'error', err.message);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: err.message,
                errorCode: err.errorCode ?? 'FS_ERROR',
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
