import { z } from 'zod';
import { getConnection, resetConnection } from '../connection.js';
import { validateObjectType, validateRecordId, checkObjectAccess } from '../security.js';
import { checkRateLimit } from '../rateLimiter.js';
import { auditLog } from '../auditLog.js';

export function registerGet(server) {
  server.tool(
    'sf_get',
    'Retrieve a single Salesforce record by ID with specified fields.',
    {
      objectType: z.string().describe('API name of the SObject'),
      id: z.string().describe('18-character Salesforce record ID'),
      fields: z
        .array(z.string())
        .optional()
        .describe(
          'Field API names to retrieve. If omitted, returns all fields.',
        ),
    },
    async (input) => {
      try {
        checkRateLimit();
        validateObjectType(input.objectType);
        validateRecordId(input.id);
        checkObjectAccess(input.objectType);

        const conn = await getConnection();
        const record = input.fields
          ? await conn
              .sobject(input.objectType)
              .retrieve(input.id, input.fields)
          : await conn.sobject(input.objectType).retrieve(input.id);

        auditLog('sf_get', input, 'success');
        return {
          content: [
            { type: 'text', text: JSON.stringify(record, null, 2) },
          ],
        };
      } catch (err) {
        if (err.errorCode === 'INVALID_SESSION_ID') resetConnection();
        auditLog('sf_get', input, 'error', err.message);
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
