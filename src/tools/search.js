import { z } from 'zod';
import { getConnection, resetConnection } from '../connection.js';
import { sanitizeSOSL } from '../security.js';
import { checkRateLimit } from '../rateLimiter.js';
import { auditLog } from '../auditLog.js';

export function registerSearch(server) {
  server.tool(
    'sf_search',
    'Run a SOSL full-text search across Salesforce objects. Use when you don\'t know the exact record ID or want to search across multiple objects.',
    {
      searchString: z
        .string()
        .describe(
          'SOSL query, e.g. FIND {John Smith} IN ALL FIELDS RETURNING Contact(Id, Name, Email), Account(Id, Name)',
        ),
    },
    async (input) => {
      try {
        checkRateLimit();
        sanitizeSOSL(input.searchString);

        const conn = await getConnection();
        const result = await conn.search(input.searchString);

        auditLog('sf_search', input, 'success');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result.searchRecords, null, 2),
            },
          ],
        };
      } catch (err) {
        if (err.errorCode === 'INVALID_SESSION_ID') resetConnection();
        auditLog('sf_search', input, 'error', err.message);
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
