import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('End-to-End Server Protocol Test', () => {
  let client;
  let transport;

  beforeAll(async () => {
    // 1. Create a transport that spawns the MCP server as a child process
    const serverPath = path.resolve(__dirname, '../src/index.js');
    transport = new StdioClientTransport({
      command: 'node',
      args: [serverPath],
      // We explicitly don't pass Salesforce credentials here.
      // This test verifies the server starts, speaks the MCP protocol over stdio,
      // and accurately registers and reports its capabilities.
    });

    // 2. Create the MCP Client
    client = new Client(
      {
        name: 'test-client',
        version: '1.0.0',
      },
      {
        capabilities: {},
      }
    );

    // 3. Connect to the server (performs initialization handshake)
    await client.connect(transport);
  });

  afterAll(async () => {
    if (transport) {
      await transport.close();
    }
  });

  it('should start the server, complete handshake, and list all 10 tools', async () => {
    // Call tools/list via the MCP client
    const response = await client.listTools();

    expect(response).toBeDefined();
    expect(response.tools).toBeInstanceOf(Array);

    const toolNames = response.tools.map((t) => t.name);

    // Verify all 10 tools are exposed correctly over the protocol
    expect(toolNames).toContain('sf_query');
    expect(toolNames).toContain('sf_create');
    expect(toolNames).toContain('sf_update');
    expect(toolNames).toContain('sf_delete');
    expect(toolNames).toContain('sf_get');
    expect(toolNames).toContain('sf_describe');
    expect(toolNames).toContain('sf_search');
    expect(toolNames).toContain('sf_list_objects');
    expect(toolNames).toContain('sf_bulk_upsert');
    expect(toolNames).toContain('sf_apex');

    expect(response.tools.length).toBe(10);
  });
});
