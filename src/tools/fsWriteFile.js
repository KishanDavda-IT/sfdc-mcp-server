import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { resolveSafePath } from '../pathSecurity.js';
import { checkRateLimit } from '../rateLimiter.js';
import { auditLog } from '../auditLog.js';

export function registerFsWriteFile(server) {
  server.tool(
    'fs_write_file',
    'Create a new file within FS_ROOT_DIR. Automatically creates missing parent directories. ' +
      'Refuses to overwrite existing files — use fs_patch_file to modify existing files.',
    {
      path: z
        .string()
        .describe(
          'File path relative to FS_ROOT_DIR. Parent directories will be created automatically.',
        ),
      content: z
        .string()
        .describe('Complete file content to write.'),
    },
    async (input) => {
      try {
        checkRateLimit(2); // write operation

        const resolved = await resolveSafePath(input.path);

        // Check if the file already exists
        try {
          await fs.access(resolved);
          // If we get here, the file exists — refuse to overwrite
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error:
                    `File "${input.path}" already exists. ` +
                    'Use fs_patch_file to modify existing files, or delete and recreate if you need a full rewrite.',
                  errorCode: 'FILE_ALREADY_EXISTS',
                }),
              },
            ],
            isError: true,
          };
        } catch {
          // File does not exist — good, proceed to create
        }

        // Create parent directories recursively
        const dir = path.dirname(resolved);
        await fs.mkdir(dir, { recursive: true });

        // Write the file
        await fs.writeFile(resolved, input.content, 'utf-8');

        const byteCount = Buffer.byteLength(input.content, 'utf-8');
        const lineCount = input.content.split('\n').length;

        auditLog('fs_write_file', { path: input.path, bytes: byteCount }, 'success');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                path: input.path,
                message: `File created successfully.`,
                bytes: byteCount,
                lines: lineCount,
              }),
            },
          ],
        };
      } catch (err) {
        auditLog('fs_write_file', { path: input.path }, 'error', err.message);
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
