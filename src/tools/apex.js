import { z } from 'zod';
import { getConnection, resetConnection } from '../connection.js';
import { checkToolEnabled, sanitizeApex } from '../security.js';
import { checkRateLimit } from '../rateLimiter.js';
import { auditLog } from '../auditLog.js';

export function registerApex(server) {
  server.tool(
    'sf_apex',
    'Execute anonymous Apex code in the Salesforce org. Use for complex logic, triggers testing, or operations not possible via REST API. Disabled by default — requires SF_ENABLE_APEX=true.',
    {
      code: z
        .string()
        .describe(
          'Anonymous Apex code to execute. Must be valid Apex syntax.',
        ),
    },
    async (input) => {
      try {
        checkRateLimit(5); // heavy operation
        checkToolEnabled('sf_apex');
        sanitizeApex(input.code);

        const conn = await getConnection();
        const result = await conn.tooling.executeAnonymous(input.code);

        auditLog('sf_apex', input, 'success');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: result.success,
                  compiled: result.compiled,
                  compileProblem: result.compileProblem,
                  exceptionMessage: result.exceptionMessage,
                  exceptionStackTrace: result.exceptionStackTrace,
                  logs: result.logs,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        if (err.errorCode === 'INVALID_SESSION_ID') resetConnection();
        auditLog('sf_apex', input, 'error', err.message);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: err.message,
                errorCode: err.errorCode ?? null,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
