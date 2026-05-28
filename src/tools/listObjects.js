import { z } from 'zod';
import { getConnection, resetConnection } from '../connection.js';
import { checkRateLimit } from '../rateLimiter.js';
import { auditLog } from '../auditLog.js';

export function registerListObjects(server) {
  server.tool(
    'sf_list_objects',
    'List all available Salesforce objects (standard and custom) in the org. Useful for discovery before querying.',
    {
      customOnly: z
        .boolean()
        .optional()
        .describe(
          'If true, return only custom objects (API names ending in __c)',
        ),
    },
    async (input) => {
      try {
        checkRateLimit();

        const conn = await getConnection();
        const meta = await conn.describeGlobal();
        let objects = meta.sobjects.map((o) => ({
          name: o.name,
          label: o.label,
          queryable: o.queryable,
        }));
        if (input.customOnly) {
          objects = objects.filter((o) => o.name.endsWith('__c'));
        }

        auditLog('sf_list_objects', input, 'success');
        return {
          content: [
            { type: 'text', text: JSON.stringify(objects, null, 2) },
          ],
        };
      } catch (err) {
        if (err.errorCode === 'INVALID_SESSION_ID') resetConnection();
        auditLog('sf_list_objects', input, 'error', err.message);
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
