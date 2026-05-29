import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { resetCachedRoot } from '../src/pathSecurity.js';

// Mock rate limiter and audit log — tested independently
vi.mock('../src/rateLimiter.js', () => ({
  checkRateLimit: vi.fn(),
  resetRateLimit: vi.fn(),
}));

vi.mock('../src/auditLog.js', () => ({
  auditLog: vi.fn(),
}));

vi.mock('../src/security.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    // Keep SecurityError and checkToolEnabled real, mock others
    checkToolEnabled: vi.fn(),
  };
});

import { registerFsListTree } from '../src/tools/fsListTree.js';
import { registerFsReadFile } from '../src/tools/fsReadFile.js';
import { registerFsPatchFile } from '../src/tools/fsPatchFile.js';
import { registerFsWriteFile } from '../src/tools/fsWriteFile.js';
import { registerFsDeploy } from '../src/tools/fsDeploy.js';
import { checkToolEnabled } from '../src/security.js';

/**
 * File System Tools tests run against a real temp directory.
 * Each test suite gets a fresh set of files.
 */
let tmpDir;
let registeredTools;
let mockServer;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sfdc-mcp-fstools-'));
  process.env.FS_ROOT_DIR = tmpDir;
  resetCachedRoot();

  // Create test fixture files
  await fs.mkdir(path.join(tmpDir, 'src', 'classes'), { recursive: true });
  await fs.mkdir(path.join(tmpDir, 'src', 'lwc', 'myComponent'), { recursive: true });

  await fs.writeFile(
    path.join(tmpDir, 'src', 'classes', 'AccountController.cls'),
    [
      'public class AccountController {',
      '    public static List<Account> getAccounts() {',
      '        return [SELECT Id, Name FROM Account LIMIT 100];',
      '    }',
      '',
      '    public static Account getById(Id accountId) {',
      '        return [SELECT Id, Name, Industry FROM Account WHERE Id = :accountId];',
      '    }',
      '}',
    ].join('\n'),
  );

  await fs.writeFile(
    path.join(tmpDir, 'src', 'classes', 'AccountController.cls-meta.xml'),
    '<?xml version="1.0" encoding="UTF-8"?>\n<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">\n    <apiVersion>59.0</apiVersion>\n    <status>Active</status>\n</ApexClass>',
  );

  await fs.writeFile(
    path.join(tmpDir, 'src', 'lwc', 'myComponent', 'myComponent.js'),
    'import { LightningElement } from "lwc";\nexport default class MyComponent extends LightningElement {}',
  );
});

afterAll(async () => {
  delete process.env.FS_ROOT_DIR;
  resetCachedRoot();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.FS_ROOT_DIR = tmpDir;
  resetCachedRoot();

  registeredTools = {};
  mockServer = {
    tool: vi.fn((name, description, schema, handler) => {
      registeredTools[name] = handler;
    }),
  };
});

// ── fs_list_tree ────────────────────────────────────────────────────

describe('fs_list_tree', () => {
  it('returns a nested tree of the project', async () => {
    registerFsListTree(mockServer);
    const handler = registeredTools['fs_list_tree'];

    const result = await handler({ path: '.', depth: 5 });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.root).toBe('.');
    expect(parsed.tree).toBeInstanceOf(Array);

    // Should find the src directory
    const srcNode = parsed.tree.find((n) => n.name === 'src');
    expect(srcNode).toBeDefined();
    expect(srcNode.type).toBe('directory');
    expect(srcNode.children).toBeInstanceOf(Array);
  });

  it('respects depth=1 to only show top-level', async () => {
    registerFsListTree(mockServer);
    const handler = registeredTools['fs_list_tree'];

    const result = await handler({ path: '.', depth: 1 });

    const parsed = JSON.parse(result.content[0].text);
    const srcNode = parsed.tree.find((n) => n.name === 'src');
    expect(srcNode).toBeDefined();
    // At depth=1, src's children should be listed but their children should be empty
    for (const child of srcNode.children) {
      if (child.type === 'directory') {
        expect(child.children).toEqual([]);
      }
    }
  });

  it('returns error for non-existent subdirectory', async () => {
    registerFsListTree(mockServer);
    const handler = registeredTools['fs_list_tree'];

    const result = await handler({ path: 'nonexistent', depth: 3 });

    expect(result.isError).toBe(true);
  });

  it('blocks path traversal', async () => {
    registerFsListTree(mockServer);
    const handler = registeredTools['fs_list_tree'];

    const result = await handler({ path: '../', depth: 3 });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.errorCode).toBe('PATH_TRAVERSAL_BLOCKED');
  });
});

// ── fs_read_file ────────────────────────────────────────────────────

describe('fs_read_file', () => {
  it('reads an entire file', async () => {
    registerFsReadFile(mockServer);
    const handler = registeredTools['fs_read_file'];

    const result = await handler({
      path: 'src/classes/AccountController.cls',
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.content).toContain('AccountController');
    expect(parsed.totalLines).toBe(9);
    expect(parsed.startLine).toBe(1);
    expect(parsed.endLine).toBe(9);
  });

  it('reads a specific line range', async () => {
    registerFsReadFile(mockServer);
    const handler = registeredTools['fs_read_file'];

    const result = await handler({
      path: 'src/classes/AccountController.cls',
      start_line: 2,
      end_line: 4,
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.startLine).toBe(2);
    expect(parsed.endLine).toBe(4);
    expect(parsed.content).toContain('getAccounts');
    expect(parsed.content).not.toContain('public class AccountController');
  });

  it('returns error for non-existent file', async () => {
    registerFsReadFile(mockServer);
    const handler = registeredTools['fs_read_file'];

    const result = await handler({ path: 'does/not/exist.txt' });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.errorCode).toBe('FILE_NOT_FOUND');
  });

  it('returns error when start_line > end_line', async () => {
    registerFsReadFile(mockServer);
    const handler = registeredTools['fs_read_file'];

    const result = await handler({
      path: 'src/classes/AccountController.cls',
      start_line: 5,
      end_line: 2,
    });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.errorCode).toBe('INVALID_LINE_RANGE');
  });

  it('returns error for a directory path', async () => {
    registerFsReadFile(mockServer);
    const handler = registeredTools['fs_read_file'];

    const result = await handler({ path: 'src/classes' });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.errorCode).toBe('NOT_A_FILE');
  });
});

// ── fs_patch_file ───────────────────────────────────────────────────

describe('fs_patch_file', () => {
  const PATCH_FILE = 'src/classes/patchable.cls';

  beforeEach(async () => {
    // Reset the patchable file before each test
    await fs.writeFile(
      path.join(tmpDir, PATCH_FILE),
      'public class Patchable {\n    // TODO: implement\n    public void doWork() {}\n}',
    );
  });

  it('patches a unique string successfully', async () => {
    registerFsPatchFile(mockServer);
    const handler = registeredTools['fs_patch_file'];

    const result = await handler({
      path: PATCH_FILE,
      old_string: '// TODO: implement',
      new_string: '// Implemented in v2',
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);

    // Verify the file was actually patched
    const content = await fs.readFile(path.join(tmpDir, PATCH_FILE), 'utf-8');
    expect(content).toContain('// Implemented in v2');
    expect(content).not.toContain('// TODO: implement');
  });

  it('returns PATCH_NO_MATCH when old_string is not found', async () => {
    registerFsPatchFile(mockServer);
    const handler = registeredTools['fs_patch_file'];

    const result = await handler({
      path: PATCH_FILE,
      old_string: 'this text does not exist in the file',
      new_string: 'replacement',
    });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.errorCode).toBe('PATCH_NO_MATCH');
    expect(parsed.file_preview).toBeDefined();
  });

  it('returns PATCH_AMBIGUOUS when old_string appears multiple times', async () => {
    // Write a file with duplicate text
    await fs.writeFile(
      path.join(tmpDir, PATCH_FILE),
      'public void doWork() {}\npublic void doWork() {}',
    );

    registerFsPatchFile(mockServer);
    const handler = registeredTools['fs_patch_file'];

    const result = await handler({
      path: PATCH_FILE,
      old_string: 'public void doWork() {}',
      new_string: 'public void doWorkV2() {}',
    });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.errorCode).toBe('PATCH_AMBIGUOUS');
    expect(parsed.occurrences).toBe(2);
  });

  it('returns FILE_NOT_FOUND for non-existent file', async () => {
    registerFsPatchFile(mockServer);
    const handler = registeredTools['fs_patch_file'];

    const result = await handler({
      path: 'nonexistent.cls',
      old_string: 'foo',
      new_string: 'bar',
    });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.errorCode).toBe('FILE_NOT_FOUND');
  });

  it('can delete text by using empty new_string', async () => {
    registerFsPatchFile(mockServer);
    const handler = registeredTools['fs_patch_file'];

    const result = await handler({
      path: PATCH_FILE,
      old_string: '    // TODO: implement\n',
      new_string: '',
    });

    expect(result.isError).toBeUndefined();
    const content = await fs.readFile(path.join(tmpDir, PATCH_FILE), 'utf-8');
    expect(content).not.toContain('TODO');
  });
});

// ── fs_write_file ───────────────────────────────────────────────────

describe('fs_write_file', () => {
  it('creates a new file with parent directories', async () => {
    registerFsWriteFile(mockServer);
    const handler = registeredTools['fs_write_file'];

    const newPath = 'src/objects/Invoice__c/fields/Amount__c.field-meta.xml';
    const content =
      '<?xml version="1.0" encoding="UTF-8"?>\n<CustomField>\n    <fullName>Amount__c</fullName>\n    <type>Currency</type>\n</CustomField>';

    const result = await handler({ path: newPath, content });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.bytes).toBeGreaterThan(0);

    // Verify file was actually created
    const actual = await fs.readFile(path.join(tmpDir, newPath), 'utf-8');
    expect(actual).toBe(content);
  });

  it('refuses to overwrite an existing file', async () => {
    registerFsWriteFile(mockServer);
    const handler = registeredTools['fs_write_file'];

    const result = await handler({
      path: 'src/classes/AccountController.cls',
      content: 'overwritten!',
    });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.errorCode).toBe('FILE_ALREADY_EXISTS');

    // Verify the original file was NOT modified
    const content = await fs.readFile(
      path.join(tmpDir, 'src/classes/AccountController.cls'),
      'utf-8',
    );
    expect(content).toContain('AccountController');
    expect(content).not.toContain('overwritten');
  });

  it('blocks path traversal', async () => {
    registerFsWriteFile(mockServer);
    const handler = registeredTools['fs_write_file'];

    const result = await handler({
      path: '../../malicious.txt',
      content: 'hacked',
    });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.errorCode).toBe('PATH_TRAVERSAL_BLOCKED');
  });
});

// ── fs_deploy ───────────────────────────────────────────────────────

describe('fs_deploy', () => {
  it('is gated behind SF_ENABLE_FS_DEPLOY', async () => {
    // Make checkToolEnabled throw to simulate disabled state
    checkToolEnabled.mockImplementation(() => {
      const err = new Error('Tool "fs_deploy" is disabled by default.');
      err.errorCode = 'TOOL_DISABLED';
      throw err;
    });

    registerFsDeploy(mockServer);
    const handler = registeredTools['fs_deploy'];

    const result = await handler({ path: 'src' });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.errorCode).toBe('TOOL_DISABLED');
  });

  it('returns error for non-existent path', async () => {
    checkToolEnabled.mockImplementation(() => {});

    registerFsDeploy(mockServer);
    const handler = registeredTools['fs_deploy'];

    const result = await handler({ path: 'nonexistent-dir' });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.errorCode).toBe('PATH_NOT_FOUND');
  });

  it('returns error when path is a file, not directory', async () => {
    checkToolEnabled.mockImplementation(() => {});

    registerFsDeploy(mockServer);
    const handler = registeredTools['fs_deploy'];

    const result = await handler({
      path: 'src/classes/AccountController.cls',
    });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.errorCode).toBe('NOT_A_DIRECTORY');
  });

  it('blocks path traversal in deploy path', async () => {
    checkToolEnabled.mockImplementation(() => {});

    registerFsDeploy(mockServer);
    const handler = registeredTools['fs_deploy'];

    const result = await handler({ path: '../' });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.errorCode).toBe('PATH_TRAVERSAL_BLOCKED');
  });
});
