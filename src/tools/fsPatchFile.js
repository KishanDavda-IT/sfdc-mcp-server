import { z } from 'zod';
import fs from 'fs/promises';
import { resolveSafePath } from '../pathSecurity.js';
import { checkRateLimit } from '../rateLimiter.js';
import { auditLog } from '../auditLog.js';

export function registerFsPatchFile(server) {
  server.tool(
    'fs_patch_file',
    'Apply a surgical text replacement to a file within FS_ROOT_DIR. ' +
      'Finds old_string (must appear exactly once) and replaces it with new_string. ' +
      'Use this instead of rewriting entire files to avoid truncation.',
    {
      path: z
        .string()
        .describe('File path relative to FS_ROOT_DIR.'),
      old_string: z
        .string()
        .min(1)
        .describe(
          'Exact text to find in the file. Must appear exactly once. ' +
            'Include enough surrounding context to ensure uniqueness.',
        ),
      new_string: z
        .string()
        .describe('Replacement text. Can be empty to delete the old_string.'),
    },
    async (input) => {
      try {
        checkRateLimit(2); // write operation

        const resolved = await resolveSafePath(input.path);

        // Read the file
        let content;
        try {
          content = await fs.readFile(resolved, 'utf-8');
        } catch (err) {
          if (err.code === 'ENOENT') {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    error: `File not found: "${input.path}". Cannot patch a file that doesn't exist. Use fs_write_file to create it.`,
                    errorCode: 'FILE_NOT_FOUND',
                  }),
                },
              ],
              isError: true,
            };
          }
          throw err;
        }

        // Count occurrences of old_string
        const occurrences = countOccurrences(content, input.old_string);

        if (occurrences === 0) {
          // Provide helpful debugging context: show a snippet of the file
          const preview = content.length > 500
            ? content.slice(0, 500) + '\n... (truncated)'
            : content;

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error:
                    'old_string not found in the file. The file may have changed since you last read it. ' +
                    'Re-read the file with fs_read_file to get the current content.',
                  errorCode: 'PATCH_NO_MATCH',
                  old_string_preview: input.old_string.slice(0, 200),
                  file_preview: preview,
                }),
              },
            ],
            isError: true,
          };
        }

        if (occurrences > 1) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error:
                    `old_string was found ${occurrences} times in the file. ` +
                    'It must appear exactly once to avoid ambiguous edits. ' +
                    'Include more surrounding context in old_string to disambiguate.',
                  errorCode: 'PATCH_AMBIGUOUS',
                  occurrences,
                }),
              },
            ],
            isError: true,
          };
        }

        // Exactly one occurrence — apply the patch
        const matchIndex = content.indexOf(input.old_string);
        const lineNumber =
          content.slice(0, matchIndex).split('\n').length;

        const patched = content.replace(input.old_string, input.new_string);
        await fs.writeFile(resolved, patched, 'utf-8');

        auditLog('fs_patch_file', { path: input.path, line: lineNumber }, 'success');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                path: input.path,
                message: `Patch applied at line ${lineNumber}.`,
                replacedChars: input.old_string.length,
                newChars: input.new_string.length,
              }),
            },
          ],
        };
      } catch (err) {
        auditLog('fs_patch_file', { path: input.path }, 'error', err.message);
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

/**
 * Counts non-overlapping occurrences of `needle` in `haystack`.
 *
 * @param {string} haystack — full file content
 * @param {string} needle   — substring to count
 * @returns {number}
 */
function countOccurrences(haystack, needle) {
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}
