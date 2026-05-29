import { z } from 'zod';
import fs from 'fs/promises';
import { resolveSafePath } from '../pathSecurity.js';
import { checkRateLimit } from '../rateLimiter.js';
import { auditLog } from '../auditLog.js';

/** Default max file size in bytes (5 MB). */
const MAX_FILE_SIZE = parseInt(
  process.env.FS_MAX_FILE_SIZE || '5242880',
  10,
);

export function registerFsReadFile(server) {
  server.tool(
    'fs_read_file',
    'Read the contents of a file within FS_ROOT_DIR. ' +
      'Supports optional start_line / end_line to read a slice of large files (1-indexed, inclusive). ' +
      'Returns the file content as text with metadata.',
    {
      path: z
        .string()
        .describe('File path relative to FS_ROOT_DIR.'),
      start_line: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe('First line to return (1-indexed, inclusive). Omit to start from the beginning.'),
      end_line: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe('Last line to return (1-indexed, inclusive). Omit to read to the end.'),
    },
    async (input) => {
      try {
        checkRateLimit(1);

        const resolved = await resolveSafePath(input.path);

        // Check the file exists and is a file
        let stat;
        try {
          stat = await fs.stat(resolved);
        } catch {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: `File not found: "${input.path}". Verify the path using fs_list_tree.`,
                  errorCode: 'FILE_NOT_FOUND',
                }),
              },
            ],
            isError: true,
          };
        }

        if (!stat.isFile()) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: `"${input.path}" is not a file. Use fs_list_tree for directories.`,
                  errorCode: 'NOT_A_FILE',
                }),
              },
            ],
            isError: true,
          };
        }

        // File size guard
        if (stat.size > MAX_FILE_SIZE) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: `File "${input.path}" is ${stat.size} bytes, exceeding the ${MAX_FILE_SIZE} byte limit. ` +
                    'Use start_line/end_line to read a portion, or increase FS_MAX_FILE_SIZE.',
                  errorCode: 'FILE_TOO_LARGE',
                }),
              },
            ],
            isError: true,
          };
        }

        const raw = await fs.readFile(resolved, 'utf-8');
        const allLines = raw.split('\n');
        const totalLines = allLines.length;

        // Apply line slicing (1-indexed, inclusive)
        let startLine = input.start_line ?? 1;
        let endLine = input.end_line ?? totalLines;

        // Clamp to valid range
        startLine = Math.max(1, Math.min(startLine, totalLines));
        endLine = Math.max(startLine, Math.min(endLine, totalLines));

        if (input.start_line && input.end_line && input.start_line > input.end_line) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: `start_line (${input.start_line}) must be ≤ end_line (${input.end_line}).`,
                  errorCode: 'INVALID_LINE_RANGE',
                }),
              },
            ],
            isError: true,
          };
        }

        const sliced = allLines.slice(startLine - 1, endLine);
        const content = sliced.join('\n');

        auditLog('fs_read_file', { path: input.path, startLine, endLine }, 'success');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  path: input.path,
                  totalLines,
                  startLine,
                  endLine,
                  content,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        auditLog('fs_read_file', input, 'error', err.message);
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
