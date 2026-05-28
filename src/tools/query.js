import { z } from 'zod';
import { getConnection, resetConnection } from '../connection.js';
import { sanitizeSOQL, enforceSOQLLimit } from '../security.js';
import { checkRateLimit } from '../rateLimiter.js';
import { auditLog } from '../auditLog.js';

export function registerQuery(server) {
  server.tool(
    'sf_query',
    'Run a SOQL query against Salesforce. Returns up to 2000 records. Use LIMIT to restrict results.',
    {
      soql: z
        .string()
        .describe(
          "Full SOQL query string, e.g. SELECT Id, Name FROM Account WHERE Industry = 'Technology' LIMIT 10",
        ),
    },
    async (input) => {
      try {
        checkRateLimit(1);
        sanitizeSOQL(input.soql);

        // Auto-append LIMIT if the LLM forgot it
        const safeSoql = enforceSOQLLimit(input.soql);

        const conn = await getConnection();
        const result = await conn.query(safeSoql);

        auditLog('sf_query', { soql: safeSoql }, 'success');
        return {
          content: [
            { type: 'text', text: JSON.stringify(result.records, null, 2) },
          ],
        };
      } catch (err) {
        if (err.errorCode === 'INVALID_SESSION_ID') resetConnection();
        auditLog('sf_query', input, 'error', err.message);
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
