import { describe, it, expect, vi } from 'vitest';
import { registerQuery } from '../src/tools/query.js';
import { registerCreate } from '../src/tools/create.js';
import { registerUpdate } from '../src/tools/update.js';
import { registerDelete } from '../src/tools/delete.js';
import { registerGet } from '../src/tools/get.js';
import { registerDescribe } from '../src/tools/describe.js';
import { registerSearch } from '../src/tools/search.js';
import { registerListObjects } from '../src/tools/listObjects.js';
import { registerBulkUpsert } from '../src/tools/bulkUpsert.js';
import { registerApex } from '../src/tools/apex.js';

describe('Tool Registration', () => {
  it('should register all 10 tools on the MCP server', () => {
    const mockServer = {
      tool: vi.fn(),
    };

    registerQuery(mockServer);
    registerCreate(mockServer);
    registerUpdate(mockServer);
    registerDelete(mockServer);
    registerGet(mockServer);
    registerDescribe(mockServer);
    registerSearch(mockServer);
    registerListObjects(mockServer);
    registerBulkUpsert(mockServer);
    registerApex(mockServer);

    // Verify all 10 tools were registered
    expect(mockServer.tool).toHaveBeenCalledTimes(10);
    
    // Extract the names of the registered tools
    const registeredNames = mockServer.tool.mock.calls.map(call => call[0]);
    
    expect(registeredNames).toContain('sf_query');
    expect(registeredNames).toContain('sf_create');
    expect(registeredNames).toContain('sf_update');
    expect(registeredNames).toContain('sf_delete');
    expect(registeredNames).toContain('sf_get');
    expect(registeredNames).toContain('sf_describe');
    expect(registeredNames).toContain('sf_search');
    expect(registeredNames).toContain('sf_list_objects');
    expect(registeredNames).toContain('sf_bulk_upsert');
    expect(registeredNames).toContain('sf_apex');
  });
});
