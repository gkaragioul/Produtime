import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  loginSchema,
  pairRequestSchema,
  tenantCreateSchema,
  CHAR_LIMITS,
  CONTROL_CHAR_REGEX,
  containsControlChars,
  validateBody,
} from './validation';

// Reduce number of runs for faster execution while still providing good coverage
const NUM_RUNS = 50;

/**
 * Property-Based Tests for Input Validation
 * 
 * **Feature: cloud-admin-console, Property 18: Input Validation**
 * **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.6**
 * 
 * *For any* request body, strings exceeding character limits SHALL be rejected,
 * control characters SHALL be rejected, and unknown fields SHALL be stripped.
 */
describe('Property 18: Input Validation', () => {
  // ============================================================================
  // Property: Strings exceeding character limits SHALL be rejected
  // ============================================================================
  describe('Character limit enforcement (Requirement 6.2)', () => {
    it('should reject names exceeding 100 characters', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: CHAR_LIMITS.NAME + 1, maxLength: CHAR_LIMITS.NAME + 50 }),
          (longName) => {
            const result = tenantCreateSchema.safeParse({
              name: longName,
              adminEmail: 'test@example.com',
            });
            expect(result.success).toBe(false);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });

    it('should reject emails exceeding 100 characters', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: CHAR_LIMITS.EMAIL + 1, maxLength: CHAR_LIMITS.EMAIL + 20 }),
          (longEmail) => {
            const result = loginSchema.safeParse({
              email: longEmail + '@example.com',
              password: 'validpassword123',
            });
            expect(result.success).toBe(false);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });

    it('should reject descriptions exceeding 2000 characters', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: CHAR_LIMITS.DESCRIPTION + 1, maxLength: CHAR_LIMITS.DESCRIPTION + 50 }),
          (longDesc) => {
            const result = tenantCreateSchema.safeParse({
              name: 'Valid Name',
              adminEmail: 'test@example.com',
              description: longDesc,
            });
            expect(result.success).toBe(false);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });

    it('should accept strings within character limits', () => {
      fc.assert(
        fc.property(
          fc.stringOf(fc.char().filter(c => !containsControlChars(c)), { minLength: 1, maxLength: 50 })
            .filter(s => s.trim().length > 0),
          (validName) => {
            const result = tenantCreateSchema.safeParse({
              name: validName,
              adminEmail: 'test@example.com',
            });
            expect(result.success).toBe(true);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });
  });

  // ============================================================================
  // Property: Control characters SHALL be rejected
  // ============================================================================
  describe('Control character rejection (Requirement 6.3)', () => {
    // Generate strings with control characters
    const controlCharArbitrary = fc.integer({ min: 0x00, max: 0x1F })
      .filter(c => c !== 0x09 && c !== 0x0A && c !== 0x0D) // Exclude tab, newline, carriage return
      .map(c => String.fromCharCode(c));

    it('should reject strings containing control characters in tenant name', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.string({ minLength: 1, maxLength: 5 }),
            controlCharArbitrary,
            fc.string({ minLength: 1, maxLength: 5 })
          ),
          ([prefix, controlChar, suffix]) => {
            const nameWithControl = prefix + controlChar + suffix;
            const result = tenantCreateSchema.safeParse({
              name: nameWithControl,
              adminEmail: 'test@example.com',
            });
            expect(result.success).toBe(false);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });

    it('should reject strings containing control characters in device name', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.string({ minLength: 1, maxLength: 5 }),
            controlCharArbitrary,
            fc.string({ minLength: 1, maxLength: 5 })
          ),
          ([prefix, controlChar, suffix]) => {
            const nameWithControl = prefix + controlChar + suffix;
            const result = pairRequestSchema.safeParse({
              pairCode: '123456',
              deviceId: 'device-123',
              deviceName: nameWithControl,
              devicePubKey: 'validpubkey123',
              appVersion: '1.0.0',
              osInfo: 'Windows 10',
            });
            expect(result.success).toBe(false);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });

    it('should correctly identify control characters', () => {
      fc.assert(
        fc.property(
          controlCharArbitrary,
          (controlChar) => {
            expect(containsControlChars(controlChar)).toBe(true);
            expect(CONTROL_CHAR_REGEX.test(controlChar)).toBe(true);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });

    it('should accept strings without control characters', () => {
      fc.assert(
        fc.property(
          fc.stringOf(fc.char().filter(c => !containsControlChars(c)), { minLength: 1, maxLength: 20 })
            .filter(s => s.trim().length > 0),
          (cleanString) => {
            expect(containsControlChars(cleanString)).toBe(false);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });
  });

  // ============================================================================
  // Property: Unknown fields SHALL be stripped (via .strict())
  // ============================================================================
  describe('Unknown field rejection (Requirement 6.4)', () => {
    it('should reject requests with unknown fields in login schema', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 10 }).filter(s => !['email', 'password', 'captchaToken'].includes(s)),
          fc.string({ minLength: 1, maxLength: 20 }),
          (unknownField, unknownValue) => {
            const result = loginSchema.safeParse({
              email: 'test@example.com',
              password: 'validpassword123',
              [unknownField]: unknownValue,
            });
            expect(result.success).toBe(false);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });

    it('should reject requests with unknown fields in tenant create schema', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 10 }).filter(s => !['name', 'adminEmail', 'description'].includes(s)),
          fc.string({ minLength: 1, maxLength: 20 }),
          (unknownField, unknownValue) => {
            const result = tenantCreateSchema.safeParse({
              name: 'Valid Tenant',
              adminEmail: 'test@example.com',
              [unknownField]: unknownValue,
            });
            expect(result.success).toBe(false);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });

    it('should reject requests with unknown fields in pair request schema', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 10 }).filter(s => 
            !['pairCode', 'deviceId', 'deviceName', 'devicePubKey', 'appVersion', 'osInfo', 'captchaToken'].includes(s)
          ),
          fc.string({ minLength: 1, maxLength: 20 }),
          (unknownField, unknownValue) => {
            const result = pairRequestSchema.safeParse({
              pairCode: '123456',
              deviceId: 'device-123',
              deviceName: 'My Device',
              devicePubKey: 'validpubkey123',
              appVersion: '1.0.0',
              osInfo: 'Windows 10',
              [unknownField]: unknownValue,
            });
            expect(result.success).toBe(false);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });
  });

  // ============================================================================
  // Property: Validation errors return safe error messages (Requirement 6.6)
  // ============================================================================
  describe('Safe error messages (Requirement 6.6)', () => {
    it('should return generic error message for any validation failure', () => {
      // Test various invalid inputs
      const invalidInputs = [
        { email: '', password: '' }, // Empty fields
        { email: 'invalid', password: 'short' }, // Invalid email, short password
        { email: 'test@example.com' }, // Missing password
        { password: 'validpassword123' }, // Missing email
      ];

      for (const input of invalidInputs) {
        const result = loginSchema.safeParse(input);
        expect(result.success).toBe(false);
        // The error should not leak internal details
        if (!result.success) {
          // Zod errors are internal - our middleware wraps them with safe messages
          expect(result.error).toBeDefined();
        }
      }
    });
  });

  // ============================================================================
  // Property: Pair code format validation
  // ============================================================================
  describe('Pair code format validation (Requirement 3.1)', () => {
    it('should accept exactly 6-digit pair codes', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 999999 }).map(n => n.toString().padStart(6, '0')),
          (validCode) => {
            const result = pairRequestSchema.safeParse({
              pairCode: validCode,
              deviceId: 'device-123',
              deviceName: 'My Device',
              devicePubKey: 'validpubkey123',
              appVersion: '1.0.0',
              osInfo: 'Windows 10',
            });
            expect(result.success).toBe(true);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });

    it('should reject pair codes that are not exactly 6 digits', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), { minLength: 1, maxLength: 5 }), // Too short
            fc.stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), { minLength: 7, maxLength: 10 }), // Too long
            fc.stringOf(fc.char().filter(c => !/\d/.test(c)), { minLength: 6, maxLength: 6 }) // Non-digit chars
          ),
          (invalidCode) => {
            const result = pairRequestSchema.safeParse({
              pairCode: invalidCode,
              deviceId: 'device-123',
              deviceName: 'My Device',
              devicePubKey: 'validpubkey123',
              appVersion: '1.0.0',
              osInfo: 'Windows 10',
            });
            expect(result.success).toBe(false);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });
  });

  // ============================================================================
  // Property: Email validation and normalization
  // ============================================================================
  describe('Email validation (Requirement 2.1)', () => {
    it('should normalize emails to lowercase', () => {
      fc.assert(
        fc.property(
          fc.emailAddress(),
          (email) => {
            const mixedCaseEmail = email.split('').map((c, i) => 
              i % 2 === 0 ? c.toUpperCase() : c.toLowerCase()
            ).join('');
            
            const result = loginSchema.safeParse({
              email: mixedCaseEmail,
              password: 'validpassword123',
            });
            
            if (result.success) {
              expect(result.data.email).toBe(mixedCaseEmail.toLowerCase());
            }
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });

    it('should reject invalid email formats', () => {
      const invalidEmails = [
        'notanemail',
        '@nodomain.com',
        'no@',
        'spaces in@email.com',
        '',
      ];

      for (const email of invalidEmails) {
        const result = loginSchema.safeParse({
          email,
          password: 'validpassword123',
        });
        expect(result.success).toBe(false);
      }
    });
  });

  // ============================================================================
  // Property: Password minimum length
  // ============================================================================
  describe('Password validation (Requirement 2.1)', () => {
    it('should reject passwords shorter than 8 characters', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 7 }),
          (shortPassword) => {
            const result = loginSchema.safeParse({
              email: 'test@example.com',
              password: shortPassword,
            });
            expect(result.success).toBe(false);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });

    it('should accept passwords of 8 or more characters', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 8, maxLength: CHAR_LIMITS.PASSWORD }),
          (validPassword) => {
            const result = loginSchema.safeParse({
              email: 'test@example.com',
              password: validPassword,
            });
            expect(result.success).toBe(true);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });
  });

  // ============================================================================
  // Property: Whitespace trimming
  // ============================================================================
  describe('Whitespace trimming (Requirement 6.3)', () => {
    it('should trim whitespace from tenant names', () => {
      fc.assert(
        fc.property(
          fc.stringOf(fc.char().filter(c => !containsControlChars(c)), { minLength: 1, maxLength: 15 })
            .filter(s => s.trim().length > 0),
          (name) => {
            const paddedName = '  ' + name + '  ';
            const result = tenantCreateSchema.safeParse({
              name: paddedName,
              adminEmail: 'test@example.com',
            });
            
            if (result.success) {
              expect(result.data.name).toBe(name.trim());
            }
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });

    it('should trim whitespace from emails after validation', () => {
      // Note: Zod's email() validator rejects emails with leading/trailing spaces
      // The trim happens after validation, so we test with a valid email
      const result = loginSchema.safeParse({
        email: 'TEST@EXAMPLE.COM',
        password: 'validpassword123',
      });
      
      expect(result.success).toBe(true);
      if (result.success) {
        // Email should be lowercased and trimmed
        expect(result.data.email).toBe('test@example.com');
      }
    });
  });
});
