import { z } from 'zod';
import { getConnection, resetConnection } from '../connection.js';
import { validateObjectType, checkObjectAccess, checkPayloadSize } from '../security.js';
import { checkRateLimit } from '../rateLimiter.js';
import { auditLog } from '../auditLog.js';

export function registerBulkUpsert(server) {
  server.tool(
    'sf_bulk_upsert',
    'Bulk upsert (insert or update) up to 10,000 records using an external ID field. Ideal for sync operations.',
    {
      objectType: z.string().describe('API name of the SObject'),
      externalIdField: z
        .string()
        .describe(
          'API name of the external ID field used for matching, e.g. "External_Id__c"',
        ),
      records: z
        .array(z.record(z.unknown()))
        .describe(
          'Array of record objects. Each must include the externalIdField value.',
        ),
    },
    async (input) => {
      try {
        checkRateLimit(5); // heavy operation
        validateObjectType(input.objectType);
        checkObjectAccess(input.objectType);
        checkPayloadSize(input.records, 10_000);

        const conn = await getConnection();
        const job = conn.bulk.createJob(input.objectType, 'upsert', {
          extIdField: input.externalIdField,
        });
        const batch = job.createBatch();
        batch.execute(input.records);

        // Increased timeout to 5 minutes — 60s is too short when
        // triggers, workflows, or validation rules are involved.
        const result = await new Promise((resolve, reject) => {
          batch.on('queue', () => batch.poll(2000, 300_000));
          batch.on('response', resolve);
          batch.on('error', reject);
        });

        await job.close();

        auditLog('sf_bulk_upsert', { objectType: input.objectType, recordCount: input.records.length }, 'success');
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        };
      } catch (err) {
        if (err.errorCode === 'INVALID_SESSION_ID') resetConnection();
        auditLog('sf_bulk_upsert', { objectType: input.objectType, recordCount: input.records?.length }, 'error', err.message);
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
