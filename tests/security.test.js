import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SecurityError,
  validateObjectType,
  validateRecordId,
  sanitizeSOQL,
  sanitizeSOSL,
  enforceSOQLLimit,
  checkPayloadSize,
  checkObjectAccess,
  checkToolEnabled,
  sanitizeApex,
} from '../src/security.js';
import { checkRateLimit, resetRateLimit } from '../src/rateLimiter.js';

// ── Input Validation ────────────────────────────────────────────────

describe('validateObjectType', () => {
  it('accepts valid standard object names', () => {
    expect(() => validateObjectType('Account')).not.toThrow();
    expect(() => validateObjectType('Contact')).not.toThrow();
    expect(() => validateObjectType('Opportunity')).not.toThrow();
  });

  it('accepts valid custom object names', () => {
    expect(() => validateObjectType('My_Custom__c')).not.toThrow();
    expect(() => validateObjectType('Invoice_Line_Item__c')).not.toThrow();
  });

  it('rejects empty/null', () => {
    expect(() => validateObjectType('')).toThrow(SecurityError);
    expect(() => validateObjectType(null)).toThrow(SecurityError);
    expect(() => validateObjectType(undefined)).toThrow(SecurityError);
  });

  it('rejects names with special characters', () => {
    expect(() => validateObjectType('Account; DROP')).toThrow(SecurityError);
    expect(() => validateObjectType('../etc/passwd')).toThrow(SecurityError);
    expect(() => validateObjectType('Account\n')).toThrow(SecurityError);
  });

  it('rejects names starting with a number', () => {
    expect(() => validateObjectType('123Account')).toThrow(SecurityError);
  });
});

describe('validateRecordId', () => {
  it('accepts valid 18-char IDs', () => {
    expect(() => validateRecordId('001xx000003DHP0AAO')).not.toThrow();
  });

  it('accepts valid 15-char IDs', () => {
    expect(() => validateRecordId('001xx000003DHP0')).not.toThrow();
  });

  it('rejects IDs with wrong length', () => {
    expect(() => validateRecordId('001xx')).toThrow(SecurityError);
    expect(() => validateRecordId('001xx000003DHP0AAO_EXTRA')).toThrow(SecurityError);
  });

  it('rejects IDs with special characters', () => {
    expect(() => validateRecordId('001xx000003DHP!')).toThrow(SecurityError);
  });

  it('rejects empty/null', () => {
    expect(() => validateRecordId('')).toThrow(SecurityError);
    expect(() => validateRecordId(null)).toThrow(SecurityError);
  });
});

// ── SOQL Sanitization ───────────────────────────────────────────────

describe('sanitizeSOQL', () => {
  it('accepts valid SOQL', () => {
    expect(() =>
      sanitizeSOQL("SELECT Id, Name FROM Account WHERE Industry = 'Technology' LIMIT 10"),
    ).not.toThrow();
  });

  it('accepts SOQL with date literals', () => {
    expect(() =>
      sanitizeSOQL('SELECT Id FROM Account WHERE CreatedDate > LAST_N_DAYS:30'),
    ).not.toThrow();
  });

  it('accepts SOQL with semicolons in string literals (no false positive)', () => {
    expect(() =>
      sanitizeSOQL("SELECT Id FROM Account WHERE Formula__c = 'a;b'"),
    ).not.toThrow();
  });

  it('accepts SOQL with comment-like patterns in string literals', () => {
    expect(() =>
      sanitizeSOQL("SELECT Id FROM Account WHERE Name = 'test -- value'"),
    ).not.toThrow();
  });

  it('rejects excessively long queries', () => {
    const longQuery = 'SELECT Id FROM Account WHERE Name = \'' + 'A'.repeat(25000) + '\'';
    expect(() => sanitizeSOQL(longQuery)).toThrow(SecurityError);
  });

  it('rejects empty/null', () => {
    expect(() => sanitizeSOQL('')).toThrow(SecurityError);
    expect(() => sanitizeSOQL(null)).toThrow(SecurityError);
  });
});

// ── SOQL LIMIT Enforcement ──────────────────────────────────────────

describe('enforceSOQLLimit', () => {
  it('appends LIMIT 2000 when no LIMIT clause exists', () => {
    const result = enforceSOQLLimit('SELECT Id FROM Account');
    expect(result).toBe('SELECT Id FROM Account LIMIT 2000');
  });

  it('preserves existing LIMIT clause', () => {
    const result = enforceSOQLLimit('SELECT Id FROM Account LIMIT 10');
    expect(result).toBe('SELECT Id FROM Account LIMIT 10');
  });

  it('preserves existing LIMIT clause (case-insensitive)', () => {
    const result = enforceSOQLLimit('SELECT Id FROM Account limit 50');
    expect(result).toBe('SELECT Id FROM Account limit 50');
  });

  it('allows custom default limit', () => {
    const result = enforceSOQLLimit('SELECT Id FROM Account', 500);
    expect(result).toBe('SELECT Id FROM Account LIMIT 500');
  });
});

// ── SOSL Sanitization ───────────────────────────────────────────────

describe('sanitizeSOSL', () => {
  it('accepts valid SOSL', () => {
    expect(() =>
      sanitizeSOSL('FIND {John Smith} IN ALL FIELDS RETURNING Contact(Id, Name)'),
    ).not.toThrow();
  });

  it('rejects empty/null', () => {
    expect(() => sanitizeSOSL('')).toThrow(SecurityError);
    expect(() => sanitizeSOSL(null)).toThrow(SecurityError);
  });
});

// ── Payload Size ────────────────────────────────────────────────────

describe('checkPayloadSize', () => {
  it('accepts arrays within the limit', () => {
    expect(() => checkPayloadSize([{ a: 1 }], 10)).not.toThrow();
  });

  it('rejects arrays exceeding the limit', () => {
    const big = Array.from({ length: 11 }, (_, i) => ({ id: i }));
    expect(() => checkPayloadSize(big, 10)).toThrow(SecurityError);
  });

  it('rejects empty arrays', () => {
    expect(() => checkPayloadSize([], 10)).toThrow(SecurityError);
  });

  it('rejects non-arrays', () => {
    expect(() => checkPayloadSize('not an array', 10)).toThrow(SecurityError);
  });
});

// ── Object Access Control ───────────────────────────────────────────

describe('checkObjectAccess', () => {
  afterEach(() => {
    delete process.env.SF_ALLOWED_OBJECTS;
    delete process.env.SF_BLOCKED_OBJECTS;
  });

  it('allows anything when no lists are configured', () => {
    expect(() => checkObjectAccess('Account')).not.toThrow();
    expect(() => checkObjectAccess('My_Custom__c')).not.toThrow();
  });

  it('blocks objects in SF_BLOCKED_OBJECTS', () => {
    process.env.SF_BLOCKED_OBJECTS = 'User,PermissionSet';
    expect(() => checkObjectAccess('User')).toThrow(SecurityError);
    expect(() => checkObjectAccess('PermissionSet')).toThrow(SecurityError);
    expect(() => checkObjectAccess('Account')).not.toThrow();
  });

  it('restricts to SF_ALLOWED_OBJECTS when set', () => {
    process.env.SF_ALLOWED_OBJECTS = 'Account,Contact';
    expect(() => checkObjectAccess('Account')).not.toThrow();
    expect(() => checkObjectAccess('Lead')).toThrow(SecurityError);
  });

  it('SF_BLOCKED_OBJECTS takes priority over SF_ALLOWED_OBJECTS', () => {
    process.env.SF_ALLOWED_OBJECTS = 'Account,User';
    process.env.SF_BLOCKED_OBJECTS = 'User';
    expect(() => checkObjectAccess('User')).toThrow(SecurityError);
    expect(() => checkObjectAccess('Account')).not.toThrow();
  });
});

// ── Feature Toggles ─────────────────────────────────────────────────

describe('checkToolEnabled', () => {
  afterEach(() => {
    delete process.env.SF_ENABLE_APEX;
    delete process.env.SF_DISABLE_DELETE;
  });

  it('blocks sf_apex by default (opt-in model)', () => {
    expect(() => checkToolEnabled('sf_apex')).toThrow(SecurityError);
  });

  it('allows sf_apex when SF_ENABLE_APEX=true', () => {
    process.env.SF_ENABLE_APEX = 'true';
    expect(() => checkToolEnabled('sf_apex')).not.toThrow();
  });

  it('allows sf_delete by default', () => {
    expect(() => checkToolEnabled('sf_delete')).not.toThrow();
  });

  it('blocks sf_delete when SF_DISABLE_DELETE=true', () => {
    process.env.SF_DISABLE_DELETE = 'true';
    expect(() => checkToolEnabled('sf_delete')).toThrow(SecurityError);
  });
});

// ── Apex DML Safeguard ──────────────────────────────────────────────

describe('sanitizeApex', () => {
  afterEach(() => {
    delete process.env.SF_APEX_ALLOW_DML;
  });

  it('allows read-only Apex by default', () => {
    expect(() => sanitizeApex('System.debug(\'hello\');')).not.toThrow();
    expect(() => sanitizeApex('List<Account> accts = [SELECT Id FROM Account];')).not.toThrow();
  });

  it('blocks DML keywords by default', () => {
    expect(() => sanitizeApex('insert new Account(Name=\'Test\');')).toThrow(SecurityError);
    expect(() => sanitizeApex('delete [SELECT Id FROM Account];')).toThrow(SecurityError);
    expect(() => sanitizeApex('update acct;')).toThrow(SecurityError);
    expect(() => sanitizeApex('upsert accts;')).toThrow(SecurityError);
  });

  it('allows DML when SF_APEX_ALLOW_DML=true', () => {
    process.env.SF_APEX_ALLOW_DML = 'true';
    expect(() => sanitizeApex('insert new Account(Name=\'Test\');')).not.toThrow();
    expect(() => sanitizeApex('delete [SELECT Id FROM Account];')).not.toThrow();
  });
});

// ── Rate Limiter (weighted) ─────────────────────────────────────────

describe('checkRateLimit', () => {
  beforeEach(() => {
    resetRateLimit();
  });

  it('allows calls within the limit', () => {
    for (let i = 0; i < 10; i++) {
      expect(() => checkRateLimit(1)).not.toThrow();
    }
  });

  it('throws SecurityError when limit is exceeded', () => {
    // Exhaust the budget (default 100) with weight-1 calls
    for (let i = 0; i < 100; i++) {
      checkRateLimit(1);
    }
    expect(() => checkRateLimit(1)).toThrow(SecurityError);
  });

  it('heavy operations consume more budget', () => {
    // 20 heavy calls at weight 5 = 100 cost units = full budget
    for (let i = 0; i < 20; i++) {
      checkRateLimit(5);
    }
    expect(() => checkRateLimit(1)).toThrow(SecurityError);
  });
});
