import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { resolveSafePath, getResolvedRoot, resetCachedRoot } from '../src/pathSecurity.js';

/**
 * Path Security tests run against a real temp directory.
 * No mocking of fs needed — these are actual filesystem operations.
 */
let tmpDir;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sfdc-mcp-pathsec-'));
  process.env.FS_ROOT_DIR = tmpDir;
  resetCachedRoot();
});

afterAll(async () => {
  delete process.env.FS_ROOT_DIR;
  resetCachedRoot();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  // Ensure root is always set for each test
  process.env.FS_ROOT_DIR = tmpDir;
  resetCachedRoot();
});

// ── getResolvedRoot ─────────────────────────────────────────────────

describe('getResolvedRoot', () => {
  it('returns the resolved path when FS_ROOT_DIR is valid', async () => {
    const root = await getResolvedRoot();
    expect(root).toBe(path.resolve(tmpDir));
  });

  it('throws when FS_ROOT_DIR is not set', async () => {
    delete process.env.FS_ROOT_DIR;
    resetCachedRoot();
    await expect(getResolvedRoot()).rejects.toThrow('FS_ROOT_DIR');
  });

  it('throws when FS_ROOT_DIR points to a non-existent directory', async () => {
    process.env.FS_ROOT_DIR = path.join(tmpDir, 'does-not-exist');
    resetCachedRoot();
    await expect(getResolvedRoot()).rejects.toThrow('does not exist');
  });

  it('throws when FS_ROOT_DIR points to a file', async () => {
    const filePath = path.join(tmpDir, 'notadir.txt');
    await fs.writeFile(filePath, 'hello');
    process.env.FS_ROOT_DIR = filePath;
    resetCachedRoot();
    await expect(getResolvedRoot()).rejects.toThrow('not a directory');
    await fs.unlink(filePath);
  });
});

// ── resolveSafePath ─────────────────────────────────────────────────

describe('resolveSafePath', () => {
  it('resolves a simple relative path', async () => {
    const result = await resolveSafePath('src/main.js');
    expect(result).toBe(path.join(path.resolve(tmpDir), 'src', 'main.js'));
  });

  it('resolves "." to the root itself', async () => {
    const result = await resolveSafePath('.');
    expect(result).toBe(path.resolve(tmpDir));
  });

  it('blocks ../ traversal (simple)', async () => {
    await expect(resolveSafePath('../etc/passwd')).rejects.toThrow(
      'resolves outside the sandbox',
    );
  });

  it('blocks ../ traversal (nested)', async () => {
    await expect(resolveSafePath('src/../../secrets.txt')).rejects.toThrow(
      'resolves outside the sandbox',
    );
  });

  it('blocks ../ traversal (backslash on Windows)', async () => {
    await expect(resolveSafePath('..\\..\\Windows\\System32')).rejects.toThrow(
      'resolves outside the sandbox',
    );
  });

  it('blocks null byte injection', async () => {
    await expect(resolveSafePath('file\0.txt')).rejects.toThrow(
      'null bytes',
    );
  });

  it('blocks absolute paths (Unix-style)', async () => {
    await expect(resolveSafePath('/etc/passwd')).rejects.toThrow(
      'Absolute paths are not allowed',
    );
  });

  it('blocks absolute paths (Windows-style)', async () => {
    await expect(resolveSafePath('C:\\Windows\\System32')).rejects.toThrow(
      'Absolute paths are not allowed',
    );
  });

  it('rejects empty path', async () => {
    await expect(resolveSafePath('')).rejects.toThrow('non-empty string');
  });

  it('rejects null path', async () => {
    await expect(resolveSafePath(null)).rejects.toThrow('non-empty string');
  });

  it('allows deeply nested valid paths', async () => {
    const result = await resolveSafePath('a/b/c/d/e/file.xml');
    expect(result).toBe(
      path.join(path.resolve(tmpDir), 'a', 'b', 'c', 'd', 'e', 'file.xml'),
    );
  });
});
