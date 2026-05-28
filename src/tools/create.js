import { z } from 'zod';
import { getConnection, resetConnection } from '../connection.js';
import { validateObjectType, checkObjectAccess } from '../security.js';
import { checkRateLimit } from '../rateLimiter.js';
import { auditLog } from '../auditLog.js';

export function registerCreate(server) {
  server.tool(
    'sf_create',
    'Create a new record in any Salesforce object (Account, Contact, Lead, Opportunity, or any custom object).',
    {
      objectType: z
        .string()
        .describe('API name of the SObject, e.g. "Account", "Contact__c"'),
      fields: z
        .record(z.unknown())
        .describe('Key-value pairs of field API names to values'),
    },
    async (input) => {
      try {
        checkRateLimit(2);
        validateObjectType(input.objectType);
        checkObjectAccess(input.objectType);

        const conn = await getConnection();
        const result = await conn
          .sobject(input.objectType)
          .create(input.fields);

        auditLog('sf_create', input, 'success');
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        };
      } catch (err) {
        if (err.errorCode === 'INVALID_SESSION_ID') resetConnection();
        auditLog('sf_create', input, 'error', err.message);
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
