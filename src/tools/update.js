import { z } from 'zod';
import { getConnection, resetConnection } from '../connection.js';
import { validateObjectType, validateRecordId, checkObjectAccess } from '../security.js';
import { checkRateLimit } from '../rateLimiter.js';
import { auditLog } from '../auditLog.js';

export function registerUpdate(server) {
  server.tool(
    'sf_update',
    'Update an existing Salesforce record by its 18-character Salesforce ID.',
    {
      objectType: z.string().describe('API name of the SObject'),
      id: z.string().describe('18-character Salesforce record ID'),
      fields: z
        .record(z.unknown())
        .describe('Fields to update — only changed fields needed'),
    },
    async (input) => {
      try {
        checkRateLimit(2);
        validateObjectType(input.objectType);
        validateRecordId(input.id);
        checkObjectAccess(input.objectType);

        const conn = await getConnection();
        const result = await conn
          .sobject(input.objectType)
          .update({ Id: input.id, ...input.fields });

        auditLog('sf_update', input, 'success');
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        };
      } catch (err) {
        if (err.errorCode === 'INVALID_SESSION_ID') resetConnection();
        auditLog('sf_update', input, 'error', err.message);
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
