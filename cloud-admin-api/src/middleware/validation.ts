import { z } from 'zod';
import { FastifyRequest, FastifyReply } from 'fastify';

// Control character rejection regex - rejects ASCII control chars except common whitespace
const CONTROL_CHAR_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

/**
 * Custom string refinement that rejects control characters
 */
const safeString = (maxLength: number) =>
  z
    .string()
    .max(maxLength)
    .refine((val) => !CONTROL_CHAR_REGEX.test(val), {
      message: 'String contains invalid control characters',
    })
    .transform((val) => val.trim());

/**
 * Character limits as per requirements:
 * - names/titles: max 100
 * - notes: max 500
 * - descriptions: max 2000
 * - search: max 200
 */
export const CHAR_LIMITS = {
  NAME: 100,
  TITLE: 100,
  NOTE: 500,
  DESCRIPTION: 2000,
  SEARCH: 200,
  EMAIL: 100,
  PASSWORD: 100,
  PAIR_CODE: 6,
  DEVICE_ID: 100,
  PUB_KEY: 500,
  VERSION: 50,
  OS_INFO: 200,
  CAPTCHA_TOKEN: 2000,
} as const;

// ============================================================================
// Authentication Schemas
// ============================================================================

/**
 * Login request schema
 * Requirements: 2.1 - email and password credentials required
 */
export const loginSchema = z
  .object({
    email: z.string().email().max(CHAR_LIMITS.EMAIL).transform((val) => val.trim().toLowerCase()),
    password: z.string().min(8).max(CHAR_LIMITS.PASSWORD),
    captchaToken: safeString(CHAR_LIMITS.CAPTCHA_TOKEN).optional(),
  })
  .strict();

export type LoginRequest = z.infer<typeof loginSchema>;

/**
 * Refresh token request schema
 */
export const refreshTokenSchema = z
  .object({
    refreshToken: z.string().min(1).max(500),
  })
  .strict();

export type RefreshTokenRequest = z.infer<typeof refreshTokenSchema>;

// ============================================================================
// Pairing Schemas
// ============================================================================

/**
 * Pair request schema - for client apps submitting pairing requests
 * Requirements: 3.1, 3.3 - 6-digit code, device info
 */
export const pairRequestSchema = z
  .object({
    pairCode: z
      .string()
      .length(CHAR_LIMITS.PAIR_CODE)
      .regex(/^\d{6}$/, 'Pair code must be exactly 6 digits'),
    deviceId: safeString(CHAR_LIMITS.DEVICE_ID),
    deviceName: safeString(CHAR_LIMITS.NAME),
    devicePubKey: safeString(CHAR_LIMITS.PUB_KEY),
    appVersion: safeString(CHAR_LIMITS.VERSION),
    osInfo: safeString(CHAR_LIMITS.OS_INFO),
    captchaToken: safeString(CHAR_LIMITS.CAPTCHA_TOKEN).optional(),
  })
  .strict();

export type PairRequest = z.infer<typeof pairRequestSchema>;

/**
 * Pair code generation request (admin generates code)
 */
export const generatePairCodeSchema = z
  .object({
    note: safeString(CHAR_LIMITS.NOTE).optional(),
  })
  .strict();

export type GeneratePairCodeRequest = z.infer<typeof generatePairCodeSchema>;

// ============================================================================
// Tenant Schemas
// ============================================================================

/**
 * Tenant creation schema - for operators creating new tenants
 * Requirements: 10.1, 10.2 - create tenant with admin user
 */
export const tenantCreateSchema = z
  .object({
    name: z
      .string()
      .min(1, 'Tenant name is required')
      .max(CHAR_LIMITS.NAME)
      .refine((val) => !CONTROL_CHAR_REGEX.test(val), {
        message: 'String contains invalid control characters',
      })
      .transform((val) => val.trim()),
    adminEmail: z.string().email().max(CHAR_LIMITS.EMAIL).transform((val) => val.trim().toLowerCase()),
    description: safeString(CHAR_LIMITS.DESCRIPTION).optional(),
  })
  .strict();

export type TenantCreateRequest = z.infer<typeof tenantCreateSchema>;

/**
 * Tenant update schema
 */
export const tenantUpdateSchema = z
  .object({
    name: safeString(CHAR_LIMITS.NAME).optional(),
    description: safeString(CHAR_LIMITS.DESCRIPTION).optional(),
  })
  .strict();

export type TenantUpdateRequest = z.infer<typeof tenantUpdateSchema>;

// ============================================================================
// Device Schemas
// ============================================================================

/**
 * Device update schema
 */
export const deviceUpdateSchema = z
  .object({
    deviceName: safeString(CHAR_LIMITS.NAME).optional(),
    policyId: z.string().uuid().optional().nullable(),
  })
  .strict();

export type DeviceUpdateRequest = z.infer<typeof deviceUpdateSchema>;

// ============================================================================
// Search/Query Schemas
// ============================================================================

/**
 * Search query schema
 */
export const searchQuerySchema = z
  .object({
    q: safeString(CHAR_LIMITS.SEARCH).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export type SearchQuery = z.infer<typeof searchQuerySchema>;

// ============================================================================
// Validation Middleware Factory
// ============================================================================

/**
 * Standard validation error response format
 * Requirements: 6.6 - safe error message format
 */
export interface ValidationErrorResponse {
  error: 'VALIDATION_ERROR';
  message: string;
}

/**
 * Creates a Fastify preHandler that validates request body against a Zod schema.
 * - Strips unknown fields (via .strict() on schemas)
 * - Returns safe error messages without internal details
 * - Requirements: 6.4, 6.6
 */
export function validateBody<T>(schema: z.ZodSchema<T>) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const result = schema.safeParse(request.body);

    if (!result.success) {
      const response: ValidationErrorResponse = {
        error: 'VALIDATION_ERROR',
        message: 'Invalid input',
      };
      return reply.status(400).send(response);
    }

    // Replace body with parsed/transformed data
    (request as any).body = result.data;
  };
}

/**
 * Creates a Fastify preHandler that validates query parameters against a Zod schema.
 */
export function validateQuery<T>(schema: z.ZodSchema<T>) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const result = schema.safeParse(request.query);

    if (!result.success) {
      const response: ValidationErrorResponse = {
        error: 'VALIDATION_ERROR',
        message: 'Invalid input',
      };
      return reply.status(400).send(response);
    }

    // Replace query with parsed/transformed data
    (request as any).query = result.data;
  };
}

/**
 * Creates a Fastify preHandler that validates route parameters against a Zod schema.
 */
export function validateParams<T>(schema: z.ZodSchema<T>) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const result = schema.safeParse(request.params);

    if (!result.success) {
      const response: ValidationErrorResponse = {
        error: 'VALIDATION_ERROR',
        message: 'Invalid input',
      };
      return reply.status(400).send(response);
    }

    // Replace params with parsed/transformed data
    (request as any).params = result.data;
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if a string contains control characters
 */
export function containsControlChars(str: string): boolean {
  return CONTROL_CHAR_REGEX.test(str);
}

/**
 * Export the control character regex for testing
 */
export { CONTROL_CHAR_REGEX };
