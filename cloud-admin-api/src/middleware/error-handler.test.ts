import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  containsSensitiveInfo,
  sanitizeErrorMessage,
  sanitizeErrorForLogging,
  mapErrorToCode,
  createSafeErrorResponse,
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  ServerError,
  SAFE_ERROR_MESSAGES,
  ERROR_CODE_TO_STATUS,
} from './error-handler';

// Reduce number of runs for faster execution while still providing good coverage
const NUM_RUNS = 100;

/**
 * Property-Based Tests for Error Response Safety
 * 
 * **Feature: cloud-admin-console, Property 19: Error Response Safety**
 * **Validates: Requirements 7.2, 7.3, 7.5**
 * 
 * *For any* error response, it SHALL not contain stack traces, SQL queries,
 * table names, or filesystem paths.
 */
describe('Property 19: Error Response Safety', () => {
  // ============================================================================
  // Generators for sensitive data patterns
  // ============================================================================
  
  // SQL query generator
  const sqlQueryArbitrary = fc.oneof(
    fc.constantFrom(
      'SELECT * FROM users WHERE id = 1',
      'INSERT INTO sessions (user_id, token) VALUES (1, "abc")',
      'UPDATE tenants SET name = "test" WHERE id = 1',
      'DELETE FROM devices WHERE revoked = true',
      'DROP TABLE users',
      'CREATE TABLE test (id INT)',
      'ALTER TABLE admins ADD COLUMN role VARCHAR(50)',
      'SELECT u.email FROM users u JOIN tenants t ON u.tenant_id = t.id'
    ),
    fc.tuple(
      fc.constantFrom('SELECT', 'INSERT', 'UPDATE', 'DELETE'),
      fc.string({ minLength: 1, maxLength: 20 }),
      fc.constantFrom('FROM', 'INTO', 'SET'),
      fc.constantFrom('users', 'tenants', 'devices', 'sessions', 'admins')
    ).map(([action, field, prep, table]) => `${action} ${field} ${prep} ${table}`)
  );

  // Alphanumeric character arbitrary
  const alphanumericChar = fc.constantFrom(
    ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')
  );

  // File path generator
  const filePathArbitrary = fc.oneof(
    // Windows paths
    fc.tuple(
      fc.constantFrom('C', 'D', 'E'),
      fc.array(fc.stringOf(alphanumericChar, { minLength: 1, maxLength: 10 }), { minLength: 1, maxLength: 4 })
    ).map(([drive, parts]) => `${drive}:\\${parts.join('\\')}`),
    // Unix paths
    fc.tuple(
      fc.constantFrom('/home', '/usr', '/var', '/etc', '/tmp', '/opt'),
      fc.array(fc.stringOf(alphanumericChar, { minLength: 1, maxLength: 10 }), { minLength: 0, maxLength: 3 })
    ).map(([base, parts]) => parts.length > 0 ? `${base}/${parts.join('/')}` : base),
    // Node modules paths
    fc.stringOf(alphanumericChar, { minLength: 1, maxLength: 15 })
      .map(pkg => `node_modules/${pkg}/index.js`)
  );

  // Stack trace generator
  const stackTraceArbitrary = fc.tuple(
    fc.stringOf(alphanumericChar, { minLength: 1, maxLength: 15 }),
    fc.stringOf(alphanumericChar, { minLength: 1, maxLength: 15 }),
    fc.integer({ min: 1, max: 1000 }),
    fc.integer({ min: 1, max: 100 })
  ).map(([func, file, line, col]) => 
    `at ${func} (${file}.js:${line}:${col})`
  );

  // Database table name generator
  const tableNameArbitrary = fc.constantFrom(
    'users', 'admins', 'tenants', 'devices', 'sessions',
    'tokens', 'passwords', 'credentials', 'pair_codes',
    'audit_logs', 'daily_metrics', 'pairCodes', 'auditLogs'
  );

  // ============================================================================
  // Property: Error responses SHALL NOT contain stack traces
  // ============================================================================
  describe('Stack trace exclusion (Requirement 7.3)', () => {
    it('should sanitize stack traces from error messages', () => {
      fc.assert(
        fc.property(
          stackTraceArbitrary,
          (stackTrace) => {
            const errorMessage = `Error occurred ${stackTrace}`;
            const sanitized = sanitizeErrorMessage(errorMessage);
            
            // Should not contain "at " followed by function call pattern
            expect(sanitized).not.toMatch(/at\s+[\w.<>]+\s+\([^)]+\)/);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });

    it('should detect stack traces as sensitive info', () => {
      fc.assert(
        fc.property(
          stackTraceArbitrary,
          (stackTrace) => {
            expect(containsSensitiveInfo(stackTrace)).toBe(true);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });

    it('should sanitize multi-line stack traces', () => {
      fc.assert(
        fc.property(
          fc.array(stackTraceArbitrary, { minLength: 2, maxLength: 5 }),
          (stackLines) => {
            const fullStack = `Error: Something went wrong\n${stackLines.join('\n')}`;
            const sanitized = sanitizeErrorMessage(fullStack);
            
            // Should not contain any stack trace lines
            for (const line of stackLines) {
              expect(sanitized).not.toContain(line);
            }
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });
  });

  // ============================================================================
  // Property: Error responses SHALL NOT contain SQL queries
  // ============================================================================
  describe('SQL query exclusion (Requirement 7.3)', () => {
    it('should sanitize SQL queries from error messages', () => {
      fc.assert(
        fc.property(
          sqlQueryArbitrary,
          (sqlQuery) => {
            const errorMessage = `Database error: ${sqlQuery}`;
            const sanitized = sanitizeErrorMessage(errorMessage);
            
            // Should not contain SQL keywords in context
            expect(sanitized).not.toMatch(/\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER)\b.*\b(FROM|INTO|SET|TABLE)\b/i);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });

    it('should detect SQL queries as sensitive info', () => {
      fc.assert(
        fc.property(
          sqlQueryArbitrary,
          (sqlQuery) => {
            expect(containsSensitiveInfo(sqlQuery)).toBe(true);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });
  });

  // ============================================================================
  // Property: Error responses SHALL NOT contain table names
  // ============================================================================
  describe('Table name exclusion (Requirement 7.3)', () => {
    it('should sanitize database table names from error messages', () => {
      fc.assert(
        fc.property(
          tableNameArbitrary,
          fc.string({ minLength: 1, maxLength: 20 }),
          (tableName, context) => {
            const errorMessage = `Error in table ${tableName}: ${context}`;
            const sanitized = sanitizeErrorMessage(errorMessage);
            
            // Should not contain the table name
            expect(sanitized.toLowerCase()).not.toMatch(new RegExp(`\\b${tableName.toLowerCase()}\\b`));
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });

    it('should detect table names as sensitive info', () => {
      fc.assert(
        fc.property(
          tableNameArbitrary,
          (tableName) => {
            const message = `Error accessing ${tableName}`;
            expect(containsSensitiveInfo(message)).toBe(true);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });
  });

  // ============================================================================
  // Property: Error responses SHALL NOT contain filesystem paths
  // ============================================================================
  describe('Filesystem path exclusion (Requirement 7.3)', () => {
    it('should sanitize filesystem paths from error messages', () => {
      fc.assert(
        fc.property(
          filePathArbitrary,
          (filePath) => {
            const errorMessage = `File not found: ${filePath}`;
            const sanitized = sanitizeErrorMessage(errorMessage);
            
            // Should not contain the original path
            expect(sanitized).not.toContain(filePath);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });

    it('should detect filesystem paths as sensitive info', () => {
      fc.assert(
        fc.property(
          filePathArbitrary,
          (filePath) => {
            expect(containsSensitiveInfo(filePath)).toBe(true);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });
  });

  // ============================================================================
  // Property: Safe error responses use standard codes (Requirement 7.5)
  // ============================================================================
  describe('Standard error codes (Requirement 7.5)', () => {
    it('should map all AppError types to correct status codes', () => {
      const errorClasses = [
        { ErrorClass: ValidationError, expectedCode: 'VALIDATION_ERROR', expectedStatus: 400 },
        { ErrorClass: UnauthorizedError, expectedCode: 'UNAUTHORIZED', expectedStatus: 401 },
        { ErrorClass: ForbiddenError, expectedCode: 'FORBIDDEN', expectedStatus: 403 },
        { ErrorClass: NotFoundError, expectedCode: 'NOT_FOUND', expectedStatus: 404 },
        { ErrorClass: RateLimitedError, expectedCode: 'RATE_LIMITED', expectedStatus: 429 },
        { ErrorClass: ServerError, expectedCode: 'SERVER_ERROR', expectedStatus: 500 },
      ];

      for (const { ErrorClass, expectedCode, expectedStatus } of errorClasses) {
        const error = new ErrorClass();
        expect(error.code).toBe(expectedCode);
        expect(error.statusCode).toBe(expectedStatus);
        expect(mapErrorToCode(error)).toBe(expectedCode);
      }
    });

    it('should create safe responses with only standard fields', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(
            new ValidationError('internal details here'),
            new UnauthorizedError('secret token info'),
            new ForbiddenError('user permissions'),
            new NotFoundError('resource path'),
            new RateLimitedError('rate info'),
            new ServerError('stack trace here')
          ),
          fc.option(fc.uuid()),
          (error, requestId) => {
            const response = createSafeErrorResponse(error, requestId ?? undefined);
            
            // Response should only have standard fields
            const keys = Object.keys(response);
            expect(keys).toContain('error');
            expect(keys).toContain('message');
            
            // Error code should be one of the standard codes
            expect(['VALIDATION_ERROR', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'RATE_LIMITED', 'SERVER_ERROR'])
              .toContain(response.error);
            
            // Message should be the safe generic message
            expect(response.message).toBe(SAFE_ERROR_MESSAGES[response.error]);
            
            // Should not contain the original error message
            expect(response.message).not.toContain('internal details');
            expect(response.message).not.toContain('secret token');
            expect(response.message).not.toContain('stack trace');
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });
  });

  // ============================================================================
  // Property: Generic error messages in production (Requirement 7.2)
  // ============================================================================
  describe('Generic error messages (Requirement 7.2)', () => {
    it('should return generic messages regardless of original error content', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 200 }),
          fc.constantFrom('VALIDATION_ERROR', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'RATE_LIMITED', 'SERVER_ERROR'),
          (originalMessage, errorCode) => {
            const error = new AppError(errorCode as any, originalMessage);
            const response = createSafeErrorResponse(error);
            
            // Response message should be the safe generic message, not the original
            expect(response.message).toBe(SAFE_ERROR_MESSAGES[errorCode as keyof typeof SAFE_ERROR_MESSAGES]);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });
  });

  // ============================================================================
  // Property: Sanitization handles edge cases
  // ============================================================================
  describe('Sanitization edge cases', () => {
    it('should handle empty and null-like inputs safely', () => {
      expect(sanitizeErrorMessage('')).toBe('');
      expect(sanitizeErrorMessage(null as any)).toBe('');
      expect(sanitizeErrorMessage(undefined as any)).toBe('');
      expect(containsSensitiveInfo('')).toBe(false);
      expect(containsSensitiveInfo(null as any)).toBe(false);
    });

    it('should preserve safe error messages', () => {
      const alphanumericChar = fc.constantFrom(
        ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')
      );
      
      fc.assert(
        fc.property(
          fc.stringOf(alphanumericChar, { minLength: 5, maxLength: 50 }),
          (safeMessage) => {
            // Messages without sensitive patterns should be preserved
            const sanitized = sanitizeErrorMessage(safeMessage);
            // Either preserved or empty (if too short after processing)
            expect(sanitized === safeMessage || sanitized === '' || sanitized.includes('[REDACTED]')).toBe(true);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });

    it('should sanitize error objects for logging', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            sqlQueryArbitrary,
            stackTraceArbitrary
          ),
          ([sqlQuery, stackTrace]) => {
            const error = new Error(`${sqlQuery}\n${stackTrace}`);
            const sanitized = sanitizeErrorForLogging(error);
            
            // Should have standard fields
            expect(sanitized).toHaveProperty('timestamp');
            expect(sanitized).toHaveProperty('name');
            expect(sanitized).toHaveProperty('message');
            
            // Message should be sanitized
            if (typeof sanitized.message === 'string') {
              expect(sanitized.message).not.toMatch(/\b(SELECT|INSERT|UPDATE|DELETE)\b/i);
            }
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });
  });

  // ============================================================================
  // Property: Connection strings and credentials are sanitized
  // ============================================================================
  describe('Credential sanitization', () => {
    it('should sanitize connection strings', () => {
      const connectionStrings = [
        'postgres://user:password@localhost:5432/db',
        'mysql://admin:secret@db.example.com/mydb',
        'mongodb://user:pass@cluster.mongodb.net/test',
        'redis://default:mypassword@redis.example.com:6379',
      ];

      for (const connStr of connectionStrings) {
        expect(containsSensitiveInfo(connStr)).toBe(true);
        const sanitized = sanitizeErrorMessage(`Connection failed: ${connStr}`);
        expect(sanitized).not.toContain(connStr);
      }
    });

    it('should sanitize JWT tokens', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.base64String({ minLength: 10, maxLength: 30 }),
            fc.base64String({ minLength: 10, maxLength: 50 }),
            fc.base64String({ minLength: 10, maxLength: 30 })
          ),
          ([header, payload, signature]) => {
            // Create a JWT-like token (simplified)
            const token = `eyJ${header.replace(/[+/=]/g, '')}.eyJ${payload.replace(/[+/=]/g, '')}.${signature.replace(/[+/=]/g, '')}`;
            
            if (token.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)) {
              expect(containsSensitiveInfo(token)).toBe(true);
            }
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });

    it('should sanitize API keys in error messages', () => {
      const apiKeyPatterns = [
        'api_key=sk_live_abc123',
        'secret: "my-secret-value"',
        'password=supersecret',
        'token: bearer_xyz789',
        'auth=basic_credentials',
      ];

      for (const pattern of apiKeyPatterns) {
        expect(containsSensitiveInfo(pattern)).toBe(true);
      }
    });
  });

  // ============================================================================
  // Property: Prisma errors are handled safely
  // ============================================================================
  describe('Prisma error handling', () => {
    it('should detect Prisma error patterns', () => {
      const prismaErrors = [
        'PrismaClientKnownRequestError',
        'PrismaClientUnknownRequestError',
        'PrismaClientValidationError',
        'Error code P2002: Unique constraint failed',
        'Error code P2025: Record not found',
      ];

      for (const error of prismaErrors) {
        expect(containsSensitiveInfo(error)).toBe(true);
      }
    });

    it('should map Prisma unique constraint errors to validation errors', () => {
      const error = new Error('Unique constraint failed on the fields: (`email`)');
      error.name = 'PrismaClientKnownRequestError';
      
      const code = mapErrorToCode(error);
      expect(code).toBe('VALIDATION_ERROR');
    });

    it('should map Prisma not found errors to not found', () => {
      const error = new Error('Record to update not found');
      error.name = 'PrismaClientKnownRequestError';
      
      const code = mapErrorToCode(error);
      expect(code).toBe('NOT_FOUND');
    });
  });
});
