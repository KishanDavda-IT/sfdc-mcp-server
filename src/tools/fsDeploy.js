import { z } from 'zod';
import fs from 'fs/promises';
import { execFile } from 'child_process';
import { resolveSafePath } from '../pathSecurity.js';
import { checkToolEnabled } from '../security.js';
import { checkRateLimit } from '../rateLimiter.js';
import { auditLog } from '../auditLog.js';

/** Default deploy timeout in ms (2 minutes). */
const DEPLOY_TIMEOUT = parseInt(
  process.env.FS_DEPLOY_TIMEOUT_MS || '120000',
  10,
);

/**
 * Promisified execFile with timeout support.
 *
 * Uses execFile (not exec) to avoid shell injection — arguments are
 * passed as an array, not interpolated into a shell command string.
 */
function execFileAsync(cmd, args, options) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, options, (error, stdout, stderr) => {
      if (error) {
        // Attach stdout/stderr to the error for richer diagnostics
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

export function registerFsDeploy(server) {
  server.tool(
    'fs_deploy',
    'Deploy Salesforce metadata from a local directory to the org using the Salesforce CLI. ' +
      'Executes "sf project deploy start --metadata-dir <path>". ' +
      'Disabled by default — requires SF_ENABLE_FS_DEPLOY=true.',
    {
      path: z
        .string()
        .describe(
          'Directory path relative to FS_ROOT_DIR containing the metadata to deploy.',
        ),
    },
    async (input) => {
      try {
        checkRateLimit(5); // heavy operation
        checkToolEnabled('fs_deploy');

        const resolved = await resolveSafePath(input.path);

        // Verify it's a directory
        let stat;
        try {
          stat = await fs.stat(resolved);
        } catch {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: `Path not found: "${input.path}". Verify it exists using fs_list_tree.`,
                  errorCode: 'PATH_NOT_FOUND',
                }),
              },
            ],
            isError: true,
          };
        }

        if (!stat.isDirectory()) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: `"${input.path}" is not a directory. fs_deploy requires a metadata directory.`,
                  errorCode: 'NOT_A_DIRECTORY',
                }),
              },
            ],
            isError: true,
          };
        }

        // Execute the Salesforce CLI deploy
        const args = [
          'project', 'deploy', 'start',
          '--metadata-dir', resolved,
          '--json',
          '--wait', '10',
        ];

        const { stdout, stderr } = await execFileAsync('sf', args, {
          timeout: DEPLOY_TIMEOUT,
          maxBuffer: 10 * 1024 * 1024, // 10 MB buffer for large deploy outputs
        });

        // Try to parse the JSON output from the CLI
        let result;
        try {
          result = JSON.parse(stdout);
        } catch {
          // CLI didn't return JSON — return raw output
          result = { rawOutput: stdout };
        }

        auditLog('fs_deploy', { path: input.path }, 'success');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  path: input.path,
                  result,
                  ...(stderr ? { warnings: stderr } : {}),
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        // Handle deploy-specific errors with richer context
        const errorDetail = {
          error: err.message,
          errorCode: err.errorCode ?? 'DEPLOY_FAILED',
        };

        // If the CLI returned output before failing, include it
        if (err.stdout) {
          try {
            errorDetail.cliOutput = JSON.parse(err.stdout);
          } catch {
            errorDetail.cliOutput = err.stdout;
          }
        }
        if (err.stderr) {
          errorDetail.cliErrors = err.stderr;
        }
        if (err.code === 'ENOENT') {
          errorDetail.error = 'The Salesforce CLI ("sf") is not installed or not available in the system PATH. fs_deploy requires the sf CLI to be installed.';
          errorDetail.errorCode = 'SF_CLI_NOT_FOUND';
        } else if (err.killed) {
          errorDetail.error = `Deploy timed out after ${DEPLOY_TIMEOUT / 1000} seconds. ` +
            'Increase FS_DEPLOY_TIMEOUT_MS or deploy fewer components.';
          errorDetail.errorCode = 'DEPLOY_TIMEOUT';
        }

        auditLog('fs_deploy', { path: input.path }, 'error', err.message);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(errorDetail),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
