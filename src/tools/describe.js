import { z } from 'zod';
import { getConnection, resetConnection } from '../connection.js';
import { validateObjectType, checkObjectAccess } from '../security.js';
import { checkRateLimit } from '../rateLimiter.js';
import { auditLog } from '../auditLog.js';

export function registerDescribe(server) {
  server.tool(
    'sf_describe',
    'Get the metadata of a Salesforce object: all field names, types, picklist values, required status, and relationships.',
    {
      objectType: z
        .string()
        .describe(
          'API name of the object to describe, e.g. "Opportunity"',
        ),
    },
    async (input) => {
      try {
        checkRateLimit();
        validateObjectType(input.objectType);
        checkObjectAccess(input.objectType);

        const conn = await getConnection();
        const meta = await conn.sobject(input.objectType).describe();
        const fields = meta.fields.map((f) => ({
          name: f.name,
          label: f.label,
          type: f.type,
          required: !f.nillable && !f.defaultedOnCreate,
          picklistValues: f.picklistValues?.map((p) => p.value) ?? [],
        }));

        auditLog('sf_describe', input, 'success');
        return {
          content: [
            { type: 'text', text: JSON.stringify(fields, null, 2) },
          ],
        };
      } catch (err) {
        if (err.errorCode === 'INVALID_SESSION_ID') resetConnection();
        auditLog('sf_describe', input, 'error', err.message);
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
