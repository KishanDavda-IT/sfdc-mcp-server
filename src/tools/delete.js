import { z } from 'zod';
import { getConnection, resetConnection } from '../connection.js';
import { validateObjectType, validateRecordId, checkObjectAccess, checkToolEnabled } from '../security.js';
import { checkRateLimit } from '../rateLimiter.js';
import { auditLog } from '../auditLog.js';

export function registerDelete(server) {
  server.tool(
    'sf_delete',
    'Permanently delete a Salesforce record by ID. This cannot be undone (goes to Recycle Bin for standard objects).',
    {
      objectType: z.string().describe('API name of the SObject'),
      id: z
        .string()
        .describe('18-character Salesforce record ID to delete'),
    },
    async (input) => {
      try {
        checkRateLimit(2);
        checkToolEnabled('sf_delete');
        validateObjectType(input.objectType);
        validateRecordId(input.id);
        checkObjectAccess(input.objectType);

        const conn = await getConnection();
        const result = await conn
          .sobject(input.objectType)
          .destroy(input.id);

        auditLog('sf_delete', input, 'success');
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        };
      } catch (err) {
        if (err.errorCode === 'INVALID_SESSION_ID') resetConnection();
        auditLog('sf_delete', input, 'error', err.message);
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
