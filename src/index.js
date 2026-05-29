// Load .env FIRST — before any module reads process.env
import 'dotenv/config';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

// ── Salesforce API tools ────────────────────────────────────────────
import { registerQuery } from './tools/query.js';
import { registerCreate } from './tools/create.js';
import { registerUpdate } from './tools/update.js';
import { registerDelete } from './tools/delete.js';
import { registerGet } from './tools/get.js';
import { registerDescribe } from './tools/describe.js';
import { registerSearch } from './tools/search.js';
import { registerListObjects } from './tools/listObjects.js';
import { registerBulkUpsert } from './tools/bulkUpsert.js';
import { registerApex } from './tools/apex.js';

// ── File System tools ───────────────────────────────────────────────
import { registerFsListTree } from './tools/fsListTree.js';
import { registerFsReadFile } from './tools/fsReadFile.js';
import { registerFsPatchFile } from './tools/fsPatchFile.js';
import { registerFsWriteFile } from './tools/fsWriteFile.js';
import { registerFsDeploy } from './tools/fsDeploy.js';

const server = new McpServer({
  name: 'salesforce-mcp',
  version: '1.0.0',
});

// Register all 10 Salesforce API tools
registerQuery(server);
registerCreate(server);
registerUpdate(server);
registerDelete(server);
registerGet(server);
registerDescribe(server);
registerSearch(server);
registerListObjects(server);
registerBulkUpsert(server);
registerApex(server);

// Register all 5 File System tools
registerFsListTree(server);
registerFsReadFile(server);
registerFsPatchFile(server);
registerFsWriteFile(server);
registerFsDeploy(server);

// Start stdio transport — no HTTP, no Express
const transport = new StdioServerTransport();
await server.connect(transport);
