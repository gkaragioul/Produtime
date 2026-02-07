import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

// ============================================================================
// Error Codes and Types
// ============================================================================

/**
 * Standard error codes as per Requirements 7.5
 */
export type ErrorCode =
  | 'VALIDATION_ERROR'    // 400
  | 'UNAUTHORIZED'        // 401
  | 'FORBIDDEN'           // 403
  | 'NOT_FOUND'           // 404
  | 'RATE_LIMITED'        // 429
  | 'SERVER_ERROR';       // 500

/**
 * Standard error response format
 * Requirements: 7.2, 7.3, 7.5
 */
export interface SafeErrorResponse {
  error: ErrorCode;
  message: string;
  requestId?: string;
}

/**
 * HTTP status code mapping for error codes
 */
export const ERROR_CODE_TO_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  SERVER_ERROR: 500,
};

/**
 * Safe generic messages for each error code
 * Requirements: 7.2 - generic error messages in production
 */
export const SAFE_ERROR_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: 'Invalid input',
  UNAUTHORIZED: 'Unauthorized',
  FORBIDDEN: 'Forbidden',
  NOT_FOUND: 'Not found',
  RATE_LIMITED: 'Too many requests',
  SERVER_ERROR: 'Internal server error',
};

// ============================================================================
// Custom Application Errors
// ============================================================================

/**
 * Base application error class
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(code: ErrorCode, message?: string) {
    super(message || SAFE_ERROR_MESSAGES[code]);
    this.code = code;
    this.statusCode = ERROR_CODE_TO_STATUS[code];
    this.isOperational = true;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export class ValidationError extends AppError {
  constructor(message?: string) {
    super('VALIDATION_ERROR', message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message?: string) {
    super('UNAUTHORIZED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message?: string) {
    super('FORBIDDEN', message);
  }
}

export class NotFoundError extends AppError {
  constructor(message?: string) {
    super('NOT_FOUND', message);
  }
}

export class RateLimitedError extends AppError {
  constructor(message?: string) {
    super('RATE_LIMITED', message);
  }
}

export class ServerError extends AppError {
  constructor(message?: string) {
    super('SERVER_ERROR', message);
  }
}

// ============================================================================
// Sensitive Data Patterns
// ============================================================================

/**
 * Patterns that indicate sensitive information that should be sanitized
 * Requirements: 7.3 - never include stack traces, SQL queries, table names, or filesystem paths
 */
const SENSITIVE_PATTERNS = {
  // SQL-related patterns
  SQL_KEYWORDS: /\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|FROM|WHERE|JOIN|TABLE|DATABASE|SCHEMA|INDEX)\b/gi,
  SQL_SYNTAX: /(--|;|'|"|\*|=|<|>|\bOR\b|\bAND\b|\bUNION\b)/gi,
  
  // Database table/column patterns
  TABLE_NAMES: /\b(users?|admins?|tenants?|devices?|sessions?|tokens?|passwords?|credentials?|pair_?codes?|audit_?logs?|daily_?metrics?)\b/gi,
  
  // File system paths
  WINDOWS_PATH: /[A-Za-z]:\\[^\s:*?"<>|]+/g,
  UNIX_PATH: /\/(?:home|usr|var|etc|tmp|opt|root|mnt|srv|proc|sys|dev|run|boot|lib|bin|sbin)[^\s]*/gi,
  NODE_MODULES: /node_modules[\/\\][^\s]*/g,
  
  // Stack trace patterns
  STACK_TRACE: /at\s+[\w.<>]+\s+\([^)]+\)/g,
  STACK_TRACE_LINE: /^\s*at\s+.+$/gm,
  ERROR_STACK: /Error:.*\n(\s+at\s+.+\n)+/g,
  
  // Internal implementation details
  FUNCTION_NAMES: /\b(function|async|await|Promise|callback|handler|middleware|service|controller|repository)\b/gi,
  INTERNAL_ERRORS: /\b(ENOENT|EACCES|EPERM|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|PRISMA|PrismaClient)\b/gi,
  
  // Connection strings and credentials
  CONNECTION_STRING: /(postgres|mysql|mongodb|redis):\/\/[^\s]+/gi,
  JWT_TOKEN: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  API_KEY: /\b(api[_-]?key|secret|password|token|auth)[=:]\s*['"]?[^\s'"]+['"]?/gi,
  
  // IP addresses and ports (internal)
  INTERNAL_IP: /\b(127\.0\.0\.1|localhost|0\.0\.0\.0|::1)\b:\d+/g,
  
  // Prisma-specific errors
  PRISMA_ERROR: /Prisma[A-Za-z]*Error/g,
  PRISMA_DETAILS: /\bP\d{4}\b/g, // Prisma error codes like P2002
};

// ============================================================================
// Sanitization Functions
// ============================================================================

/**
 * Check if a string contains sensitive information
 * Requirements: 7.3
 */
export function containsSensitiveInfo(str: string): boolean {
  if (!str || typeof str !== 'string') {
    return false;
  }

  for (const pattern of Object.values(SENSITIVE_PATTERNS)) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    if (pattern.test(str)) {
      return true;
    }
  }

  return false;
}

/**
 * Sanitize an error message by removing sensitive information
 * Requirements: 7.3, 7.4
 */
export function sanitizeErrorMessage(message: string): string {
  if (!message || typeof message !== 'string') {
    return '';
  }

  let sanitized = message;

  // Remove all sensitive patterns
  for (const pattern of Object.values(SENSITIVE_PATTERNS)) {
    pattern.lastIndex = 0;
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }

  // Remove multiple consecutive [REDACTED] markers
  sanitized = sanitized.replace(/(\[REDACTED\]\s*)+/g, '[REDACTED] ');

  // Trim and clean up
  sanitized = sanitized.trim();

  // If the message is mostly redacted or empty, return generic message
  if (!sanitized || sanitized === '[REDACTED]' || sanitized.length < 3) {
    return '';
  }

  return sanitized;
}

/**
 * Sanitize an entire error object for logging
 * Requirements: 7.4 - log detailed errors server-side only with sanitized content
 */
export function sanitizeErrorForLogging(error: Error | FastifyError | unknown): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
  };

  if (error instanceof Error) {
    sanitized.name = error.name;
    sanitized.message = sanitizeErrorMessage(error.message);
    
    // Don't include stack in production logs
    if (process.env.NODE_ENV !== 'production' && error.stack) {
      sanitized.stack = sanitizeErrorMessage(error.stack);
    }

    // Include error code if it's an AppError
    if (error instanceof AppError) {
      sanitized.code = error.code;
      sanitized.statusCode = error.statusCode;
    }
  } else if (typeof error === 'string') {
    sanitized.message = sanitizeErrorMessage(error);
  } else {
    sanitized.message = 'Unknown error';
  }

  return sanitized;
}

// ============================================================================
// Error Type Detection
// ============================================================================

/**
 * Map various error types to our standard error codes
 * Requirements: 7.1, 7.5
 */
export function mapErrorToCode(error: Error | FastifyError | unknown): ErrorCode {
  // Handle our custom AppError
  if (error instanceof AppError) {
    return error.code;
  }

  // Handle Fastify errors
  if (error && typeof error === 'object' && 'statusCode' in error) {
    const statusCode = (error as { statusCode: number }).statusCode;
    
    switch (statusCode) {
      case 400:
        return 'VALIDATION_ERROR';
      case 401:
        return 'UNAUTHORIZED';
      case 403:
        return 'FORBIDDEN';
      case 404:
        return 'NOT_FOUND';
      case 429:
        return 'RATE_LIMITED';
      default:
        return 'SERVER_ERROR';
    }
  }

  // Handle Zod validation errors
  if (error instanceof Error && error.name === 'ZodError') {
    return 'VALIDATION_ERROR';
  }

  // Handle JWT errors
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (
      message.includes('jwt') ||
      message.includes('token') ||
      message.includes('unauthorized') ||
      message.includes('authentication')
    ) {
      return 'UNAUTHORIZED';
    }
  }

  // Handle Prisma errors
  if (error instanceof Error && error.name.includes('Prisma')) {
    // Prisma unique constraint violation
    if (error.message.includes('Unique constraint')) {
      return 'VALIDATION_ERROR';
    }
    // Prisma not found
    if (error.message.includes('not found') || error.message.includes('does not exist')) {
      return 'NOT_FOUND';
    }
  }

  // Default to server error
  return 'SERVER_ERROR';
}

/**
 * Get HTTP status code from error
 */
export function getStatusCodeFromError(error: Error | FastifyError | unknown): number {
  // Handle our custom AppError
  if (error instanceof AppError) {
    return error.statusCode;
  }

  // Handle Fastify errors with statusCode
  if (error && typeof error === 'object' && 'statusCode' in error) {
    return (error as { statusCode: number }).statusCode;
  }

  // Map to code and get status
  const code = mapErrorToCode(error);
  return ERROR_CODE_TO_STATUS[code];
}

// ============================================================================
// Global Error Handler
// ============================================================================

/**
 * Create a safe error response
 * Requirements: 7.2, 7.3, 7.5
 */
export function createSafeErrorResponse(
  error: Error | FastifyError | unknown,
  requestId?: string
): SafeErrorResponse {
  const code = mapErrorToCode(error);
  
  const response: SafeErrorResponse = {
    error: code,
    message: SAFE_ERROR_MESSAGES[code],
  };

  if (requestId) {
    response.requestId = requestId;
  }

  return response;
}

/**
 * Global error handler for Fastify
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5
 * 
 * - Maps error types to safe HTTP codes
 * - Sanitizes error messages (removes SQL, paths, stack traces)
 * - Logs detailed errors server-side only
 */
export function globalErrorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  // Generate or use existing request ID
  const requestId = request.id || `req-${Date.now()}`;

  // Log detailed error server-side only (sanitized)
  const sanitizedError = sanitizeErrorForLogging(error);
  request.log.error({
    ...sanitizedError,
    requestId,
    method: request.method,
    url: request.url,
    // Don't log body or headers as they may contain sensitive data
  });

  // Get status code and create safe response
  const statusCode = getStatusCodeFromError(error);
  const safeResponse = createSafeErrorResponse(error, requestId);

  // Add Retry-After header for rate limit errors
  if (statusCode === 429) {
    reply.header('Retry-After', '60');
  }

  // Send safe response
  reply.status(statusCode).send(safeResponse);
}

/**
 * Register the global error handler with a Fastify instance
 */
export function registerErrorHandler(server: { setErrorHandler: (handler: typeof globalErrorHandler) => void }): void {
  server.setErrorHandler(globalErrorHandler);
}
