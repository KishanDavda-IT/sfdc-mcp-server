/**
 * Central security module — input validation and object access control.
 *
 * All validation functions throw a SecurityError (caught by tool handlers)
 * or return silently on success.
 */

// ── Custom error class ──────────────────────────────────────────────
export class SecurityError extends Error {
  constructor(message, code = 'SECURITY_VIOLATION') {
    super(message);
    this.name = 'SecurityError';
    this.errorCode = code;
  }
}

// ── Input validators ────────────────────────────────────────────────

/**
 * Validates an SObject API name (e.g. "Account", "My_Custom__c").
 * Blocks path traversal, injection chars, whitespace, etc.
 */
const OBJECT_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,99}$/;
export function validateObjectType(name) {
  if (!name || !OBJECT_NAME_RE.test(name)) {
    throw new SecurityError(
      `Invalid SObject API name: "${name}". Must match /^[A-Za-z][A-Za-z0-9_]{0,99}$/.`,
      'INVALID_OBJECT_NAME',
    );
  }
}

/**
 * Validates a Salesforce record ID (15 or 18 char, case-insensitive alphanumeric).
 */
const RECORD_ID_RE = /^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$/;
export function validateRecordId(id) {
  if (!id || !RECORD_ID_RE.test(id)) {
    throw new SecurityError(
      `Invalid Salesforce record ID: "${id}". Must be 15 or 18 alphanumeric characters.`,
      'INVALID_RECORD_ID',
    );
  }
}

/**
 * SOQL sanitization — validates type and length only.
 *
 * We intentionally do NOT block semicolons or comment patterns here.
 * The Salesforce REST API does not support multi-statement SOQL — if you
 * send "SELECT Id FROM Account; SELECT Id FROM Contact", Salesforce will
 * return a MALFORMED_QUERY error. Blocking semicolons client-side causes
 * false positives on legitimate queries with string literals like
 * "WHERE Formula__c = 'a;b'". Length limit + Object Access Control are
 * sufficient protection.
 */
const SOQL_MAX_LENGTH = 20_000;
export function sanitizeSOQL(soql) {
  if (!soql || typeof soql !== 'string') {
    throw new SecurityError('SOQL query must be a non-empty string.', 'INVALID_SOQL');
  }
  if (soql.length > SOQL_MAX_LENGTH) {
    throw new SecurityError(
      `SOQL query exceeds maximum length of ${SOQL_MAX_LENGTH} characters.`,
      'SOQL_TOO_LONG',
    );
  }
}

/**
 * Programmatically appends a LIMIT clause to SOQL if one is missing.
 * LLMs frequently forget to add LIMIT, which can pull thousands of records
 * from large orgs and cause hallucinations or OOM.
 *
 * @param {string} soql — validated SOQL string
 * @param {number} defaultLimit — default max rows (default: 2000)
 * @returns {string} SOQL with LIMIT guaranteed
 */
const LIMIT_RE = /\bLIMIT\s+\d+/i;
export function enforceSOQLLimit(soql, defaultLimit = 2000) {
  if (!LIMIT_RE.test(soql)) {
    return `${soql} LIMIT ${defaultLimit}`;
  }
  return soql;
}

/**
 * Validates SOSL search strings with similar rules.
 */
export function sanitizeSOSL(sosl) {
  if (!sosl || typeof sosl !== 'string') {
    throw new SecurityError('SOSL search string must be a non-empty string.', 'INVALID_SOSL');
  }
  if (sosl.length > SOQL_MAX_LENGTH) {
    throw new SecurityError(
      `SOSL search string exceeds maximum length of ${SOQL_MAX_LENGTH} characters.`,
      'SOSL_TOO_LONG',
    );
  }
}

/**
 * Enforces a maximum record count on bulk operations.
 */
export function checkPayloadSize(records, maxRecords = 10_000) {
  if (!Array.isArray(records)) {
    throw new SecurityError('Records must be an array.', 'INVALID_PAYLOAD');
  }
  if (records.length === 0) {
    throw new SecurityError('Records array must not be empty.', 'EMPTY_PAYLOAD');
  }
  if (records.length > maxRecords) {
    throw new SecurityError(
      `Payload contains ${records.length} records, exceeding the maximum of ${maxRecords}.`,
      'PAYLOAD_TOO_LARGE',
    );
  }
}

// ── Object allow/block list ─────────────────────────────────────────

function parseList(envVar) {
  const raw = process.env[envVar];
  if (!raw) return null;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Checks whether an object is allowed based on SF_ALLOWED_OBJECTS and SF_BLOCKED_OBJECTS.
 * - If SF_ALLOWED_OBJECTS is set, only those objects are permitted.
 * - SF_BLOCKED_OBJECTS always takes priority (reject even if in allow list).
 */
export function checkObjectAccess(objectType) {
  const blocked = parseList('SF_BLOCKED_OBJECTS');
  if (blocked && blocked.includes(objectType)) {
    throw new SecurityError(
      `Access to object "${objectType}" is blocked by SF_BLOCKED_OBJECTS policy.`,
      'OBJECT_BLOCKED',
    );
  }

  const allowed = parseList('SF_ALLOWED_OBJECTS');
  if (allowed && !allowed.includes(objectType)) {
    throw new SecurityError(
      `Object "${objectType}" is not in SF_ALLOWED_OBJECTS. Allowed: ${allowed.join(', ')}.`,
      'OBJECT_NOT_ALLOWED',
    );
  }
}

// ── Feature toggles ─────────────────────────────────────────────────

/**
 * Checks if a tool is enabled.
 *
 * sf_delete: disabled via SF_DISABLE_DELETE=true (default: enabled)
 * sf_apex:   enabled via SF_ENABLE_APEX=true  (default: DISABLED)
 *
 * Apex defaults to disabled because anonymous Apex execution is
 * extremely dangerous — an LLM could hallucinate destructive DML
 * like `delete [SELECT Id FROM Account LIMIT 10000];`.
 */
export function checkToolEnabled(toolName) {
  // Tools requiring explicit opt-in (disabled by default)
  const optInTools = {
    sf_apex: 'SF_ENABLE_APEX',
    fs_deploy: 'SF_ENABLE_FS_DEPLOY',
  };

  if (optInTools[toolName]) {
    const envVar = optInTools[toolName];
    if (process.env[envVar] !== 'true') {
      throw new SecurityError(
        `Tool "${toolName}" is disabled by default. Set ${envVar}=true to enable it.`,
        'TOOL_DISABLED',
      );
    }
    return;
  }

  // Tools that can be disabled via env var (enabled by default)
  const optOutTools = {
    sf_delete: 'SF_DISABLE_DELETE',
  };
  const envVar = optOutTools[toolName];
  if (envVar && process.env[envVar] === 'true') {
    throw new SecurityError(
      `Tool "${toolName}" is disabled by ${envVar}=true.`,
      'TOOL_DISABLED',
    );
  }
}

// ── Apex DML safeguard ──────────────────────────────────────────────

/**
 * Blocks DML operations in anonymous Apex unless SF_APEX_ALLOW_DML=true.
 * This limits LLM-generated Apex to read-only operations, preventing
 * accidental mass-deletes or data corruption.
 *
 * Blocked keywords: insert, update, delete, upsert, merge, undelete
 */
const DML_RE = /\b(insert|update|delete|upsert|merge|undelete)\b/i;
export function sanitizeApex(code) {
  if (process.env.SF_APEX_ALLOW_DML === 'true') return;

  if (DML_RE.test(code)) {
    throw new SecurityError(
      'Apex code contains DML operations (insert/update/delete/upsert/merge/undelete), which are blocked by default. ' +
        'Set SF_APEX_ALLOW_DML=true to allow DML in anonymous Apex.',
      'APEX_DML_BLOCKED',
    );
  }
}
