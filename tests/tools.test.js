import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerQuery } from '../src/tools/query.js';
import { registerCreate } from '../src/tools/create.js';
import { registerUpdate } from '../src/tools/update.js';
import { registerDelete } from '../src/tools/delete.js';
import { registerGet } from '../src/tools/get.js';

// 1. Mock the connection module
vi.mock('../src/connection.js', () => {
  const mockSObject = {
    create: vi.fn(),
    update: vi.fn(),
    destroy: vi.fn(),
    retrieve: vi.fn(),
    describe: vi.fn(),
  };

  const mockConn = {
    query: vi.fn(),
    sobject: vi.fn(() => mockSObject),
    search: vi.fn(),
    describeGlobal: vi.fn(),
    tooling: { executeAnonymous: vi.fn() },
    bulk: { createJob: vi.fn() },
    // exposing the mock so we can spy on it in tests
    _mockSObject: mockSObject,
  };

  return {
    getConnection: vi.fn(async () => mockConn),
    resetConnection: vi.fn(),
  };
});

// 2. Mock security modules to passthrough — tested independently in security.test.js
vi.mock('../src/security.js', () => ({
  SecurityError: class SecurityError extends Error {},
  validateObjectType: vi.fn(),
  validateRecordId: vi.fn(),
  sanitizeSOQL: vi.fn(),
  sanitizeSOSL: vi.fn(),
  enforceSOQLLimit: vi.fn((soql) => soql), // passthrough
  checkPayloadSize: vi.fn(),
  checkObjectAccess: vi.fn(),
  checkToolEnabled: vi.fn(),
  sanitizeApex: vi.fn(),
}));

vi.mock('../src/rateLimiter.js', () => ({
  checkRateLimit: vi.fn(),
  resetRateLimit: vi.fn(),
}));

vi.mock('../src/auditLog.js', () => ({
  auditLog: vi.fn(),
}));

import { getConnection } from '../src/connection.js';

describe('Salesforce MCP Tools', () => {
  let mockServer;
  let registeredTools = {};
  let mockConn;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockConn = await getConnection();

    // 3. Mock the MCP server to capture registered tool handlers
    registeredTools = {};
    mockServer = {
      tool: vi.fn((name, description, schema, handler) => {
        registeredTools[name] = handler;
      }),
    };
  });

  it('sf_query should execute SOQL and return JSON string', async () => {
    registerQuery(mockServer);
    const handler = registeredTools['sf_query'];
    expect(handler).toBeDefined();

    mockConn.query.mockResolvedValueOnce({
      records: [{ Id: '123', Name: 'Acme' }],
    });

    const result = await handler({ soql: 'SELECT Id, Name FROM Account' });

    expect(mockConn.query).toHaveBeenCalledWith('SELECT Id, Name FROM Account');
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Acme');
  });

  it('sf_create should insert an SObject and return success', async () => {
    registerCreate(mockServer);
    const handler = registeredTools['sf_create'];
    
    mockConn._mockSObject.create.mockResolvedValueOnce({
      id: '001xx000003DHP0AAO',
      success: true,
      errors: [],
    });

    const result = await handler({
      objectType: 'Account',
      fields: { Name: 'New Account' },
    });

    expect(mockConn.sobject).toHaveBeenCalledWith('Account');
    expect(mockConn._mockSObject.create).toHaveBeenCalledWith({ Name: 'New Account' });
    expect(result.content[0].text).toContain('001xx000003DHP0AAO');
  });

  it('sf_update should update an SObject and return success', async () => {
    registerUpdate(mockServer);
    const handler = registeredTools['sf_update'];
    
    mockConn._mockSObject.update.mockResolvedValueOnce({
      id: '001xx000003DHP0AAO',
      success: true,
    });

    const result = await handler({
      objectType: 'Account',
      id: '001xx000003DHP0AAO',
      fields: { Name: 'Updated Account' },
    });

    expect(mockConn.sobject).toHaveBeenCalledWith('Account');
    expect(mockConn._mockSObject.update).toHaveBeenCalledWith({
      Id: '001xx000003DHP0AAO',
      Name: 'Updated Account',
    });
    expect(result.content[0].text).toContain('true');
  });

  it('should handle Salesforce API errors gracefully without crashing', async () => {
    registerQuery(mockServer);
    const handler = registeredTools['sf_query'];

    const apiError = new Error('INVALID_FIELD');
    apiError.errorCode = 'INVALID_FIELD';
    mockConn.query.mockRejectedValueOnce(apiError);

    const result = await handler({ soql: 'SELECT BadField FROM Account' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('INVALID_FIELD');
  });
});
