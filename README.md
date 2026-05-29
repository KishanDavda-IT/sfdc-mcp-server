# Salesforce MCP Server

[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520-brightgreen.svg)](https://nodejs.org)
[![Model Context Protocol](https://img.shields.io/badge/MCP-Protocol-blue.svg)](https://modelcontextprotocol.io)
[![Tests](https://img.shields.io/badge/tests-46%20passed-success.svg)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A production-grade Node.js MCP (Model Context Protocol) server that gives any AI agent full CRUD + query + Apex control over a Salesforce org, plus a fully sandboxed local File System toolset for metadata deployment, via **15 typed tools**.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure credentials
cp .env.example .env
# Edit .env with your Salesforce org credentials and FS_ROOT_DIR

# 3. Run the server
npm start
```

## Tools

| Tool | Description |
|------|-------------|
| `sf_query` | Run SOQL queries (up to 2000 records) |
| `sf_create` | Create a record in any SObject |
| `sf_update` | Update a record by 18-char ID |
| `sf_delete` | Delete a record by ID (Recycle Bin for standard objects) |
| `sf_get` | Retrieve a single record by ID with optional field selection |
| `sf_describe` | Get object metadata: fields, types, picklists, required status |
| `sf_search` | SOSL full-text search across multiple objects |
| `sf_list_objects` | List all available SObjects (standard + custom) |
| `sf_bulk_upsert` | Bulk upsert up to 10,000 records via external ID |
| `sf_apex` | Execute anonymous Apex code via the Tooling API |
| `fs_list_tree` | List files recursively within FS_ROOT_DIR |
| `fs_read_file` | Read file contents (supports start_line/end_line to save tokens) |
| `fs_patch_file` | Surgical text replacement (requires exactly 1 match of old_string) |
| `fs_write_file` | Create new files (refuses to overwrite to prevent truncation) |
| `fs_deploy` | Deploy metadata via `sf project deploy start` (requires sf CLI) |

## Authentication

Two auth modes, controlled by `SF_AUTH_MODE` in `.env`:

### Password (default) — for dev/sandbox

```env
SF_AUTH_MODE=password
SF_LOGIN_URL=https://login.salesforce.com
SF_USERNAME=your@email.com
SF_PASSWORD=yourpassword
SF_SECURITY_TOKEN=yourSecurityToken
```

> For sandbox orgs, set `SF_LOGIN_URL=https://test.salesforce.com`.

### JWT Bearer — for production

```env
SF_AUTH_MODE=jwt
SF_CLIENT_ID=3MVG9...
SF_PRIVATE_KEY_PATH=./certs/server.key
SF_JWT_SUBJECT=your@email.com
SF_INSTANCE_URL=https://yourorg.my.salesforce.com
```

## Claude Desktop Configuration

Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "salesforce": {
      "command": "node",
      "args": ["/absolute/path/to/salesforce-mcp/src/index.js"],
      "env": {
        "SF_LOGIN_URL": "https://login.salesforce.com",
        "SF_USERNAME": "your@email.com",
        "SF_PASSWORD": "yourpassword",
        "SF_SECURITY_TOKEN": "yourToken",
        "FS_ROOT_DIR": "/absolute/path/to/your/sfdx-project"
      }
    }
  }
}
```

## Architecture

```
src/
├── index.js          # Registers all 15 tools, starts StdioServerTransport
├── connection.js     # jsforce singleton with auto-reconnect on token expiry
├── pathSecurity.js   # Sandboxes fs_* tools to FS_ROOT_DIR
└── tools/
    ├── query.js      # sf_query
    ├── create.js     # sf_create
    ├── update.js     # sf_update
    ├── delete.js     # sf_delete
    ├── get.js        # sf_get
    ├── describe.js   # sf_describe
    ├── search.js     # sf_search
    ├── listObjects.js # sf_list_objects
    ├── bulkUpsert.js # sf_bulk_upsert
    ├── apex.js       # sf_apex
    ├── fsListTree.js # fs_list_tree
    ├── fsReadFile.js # fs_read_file
    ├── fsPatchFile.js # fs_patch_file
    ├── fsWriteFile.js # fs_write_file
    └── fsDeploy.js   # fs_deploy
```

- **Transport:** Stdio only (stdin/stdout MCP protocol). No HTTP server.
- **Connection:** Singleton pattern — one `jsforce.Connection` per process. Auto re-authenticates on `INVALID_SESSION_ID`.
- **Error handling:** All tool handlers wrap logic in try/catch and return `isError: true` on failure — the MCP server never crashes.

## Notes

- `jsforce` v2 beta is required for ESM compatibility. v1 is CJS only.
- `sf_apex` requires the Tooling API — the org user must have "Author Apex" permission.
- `sf_bulk_upsert` uses Bulk API v1. For >10M records, swap to Bulk API 2.0 via `conn.bulk2`.
- SOQL date literals (`TODAY`, `LAST_N_DAYS:30`) are supported natively — no escaping needed.
- `sf_describe` response is intentionally stripped to avoid 50KB+ payloads.

## Tech Stack

| Package | Version |
|---------|---------|
| `@modelcontextprotocol/sdk` | ^1.12.0 |
| `jsforce` | ^2.0.0-beta.32 |
| `zod` | ^3.23.8 |
| `dotenv` | ^16.4.5 |

Runtime: Node.js ≥ 20
