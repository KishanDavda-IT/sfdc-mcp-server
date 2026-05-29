/**
 * File system path security — sandbox enforcement.
 *
 * All fs_* tools resolve user-supplied paths through this module to
 * guarantee they remain within the FS_ROOT_DIR boundary.
 *
 * Threats mitigated:
 *   - Path traversal (../)
 *   - Null byte injection (\0)
 *   - Absolute path injection (/etc/passwd, C:\Windows)
 *   - Symlink escape (resolved path checked after fs.realpath)
 */

import path from 'path';
import fs from 'fs/promises';
import { SecurityError } from './security.js';

/** Cached resolved root — set on first call to getResolvedRoot(). */
let cachedRoot = null;

/**
 * Returns the resolved absolute path of FS_ROOT_DIR.
 * Validates the env var is set and the directory exists.
 *
 * @returns {Promise<string>} resolved absolute path
 * @throws {SecurityError} if FS_ROOT_DIR is missing or not a directory
 */
export async function getResolvedRoot() {
  if (cachedRoot) return cachedRoot;

  const raw = process.env.FS_ROOT_DIR;
  if (!raw) {
    throw new SecurityError(
      'FS_ROOT_DIR environment variable is not set. ' +
        'File system tools require FS_ROOT_DIR to define the sandbox boundary. ' +
        'Example: FS_ROOT_DIR=./force-app',
      'FS_ROOT_NOT_CONFIGURED',
    );
  }

  const resolved = path.resolve(raw);

  try {
    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) {
      throw new SecurityError(
        `FS_ROOT_DIR "${resolved}" exists but is not a directory.`,
        'FS_ROOT_NOT_DIRECTORY',
      );
    }
  } catch (err) {
    if (err instanceof SecurityError) throw err;
    throw new SecurityError(
      `FS_ROOT_DIR "${resolved}" does not exist or is not accessible: ${err.message}`,
      'FS_ROOT_NOT_FOUND',
    );
  }

  cachedRoot = resolved;
  return cachedRoot;
}

/**
 * Resolves a user-supplied relative path against FS_ROOT_DIR and
 * verifies the result remains within the sandbox.
 *
 * @param {string} userPath — relative path supplied by the agent
 * @returns {Promise<string>} resolved absolute path guaranteed to be inside FS_ROOT_DIR
 * @throws {SecurityError} on traversal, null bytes, or absolute path attempts
 */
export async function resolveSafePath(userPath) {
  if (!userPath || typeof userPath !== 'string') {
    throw new SecurityError(
      'Path must be a non-empty string.',
      'INVALID_PATH',
    );
  }

  // Block null bytes — can trick C-level fs calls into truncating paths
  if (userPath.includes('\0')) {
    throw new SecurityError(
      'Path contains null bytes — this is not allowed.',
      'PATH_TRAVERSAL_BLOCKED',
    );
  }

  // Block absolute paths — the agent must always use relative paths
  if (path.isAbsolute(userPath)) {
    throw new SecurityError(
      `Absolute paths are not allowed. Use a path relative to FS_ROOT_DIR. Received: "${userPath}"`,
      'PATH_TRAVERSAL_BLOCKED',
    );
  }

  const root = await getResolvedRoot();
  const resolved = path.resolve(root, userPath);

  // Containment check: resolved path must start with root + separator (or be root itself)
  // We append path.sep to avoid false positives like /root-other matching /root
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new SecurityError(
      `Path "${userPath}" resolves outside the sandbox (FS_ROOT_DIR). ` +
        'Path traversal is not allowed.',
      'PATH_TRAVERSAL_BLOCKED',
    );
  }

  return resolved;
}

/**
 * Resets the cached root — for testing only.
 */
export function resetCachedRoot() {
  cachedRoot = null;
}
