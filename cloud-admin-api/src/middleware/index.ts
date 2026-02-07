/**
 * Middleware exports for cloud-admin-api
 */

export {
  // Schemas
  loginSchema,
  refreshTokenSchema,
  pairRequestSchema,
  generatePairCodeSchema,
  tenantCreateSchema,
  tenantUpdateSchema,
  deviceUpdateSchema,
  searchQuerySchema,
  
  // Types
  type LoginRequest,
  type RefreshTokenRequest,
  type PairRequest,
  type GeneratePairCodeRequest,
  type TenantCreateRequest,
  type TenantUpdateRequest,
  type DeviceUpdateRequest,
  type SearchQuery,
  type ValidationErrorResponse,
  
  // Middleware factories
  validateBody,
  validateQuery,
  validateParams,
  
  // Constants
  CHAR_LIMITS,
  CONTROL_CHAR_REGEX,
  
  // Utilities
  containsControlChars,
} from './validation';

export {
  // Error types
  type ErrorCode,
  type SafeErrorResponse,
  
  // Error classes
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  ServerError,
  
  // Constants
  ERROR_CODE_TO_STATUS,
  SAFE_ERROR_MESSAGES,
  
  // Sanitization utilities
  containsSensitiveInfo,
  sanitizeErrorMessage,
  sanitizeErrorForLogging,
  
  // Error mapping
  mapErrorToCode,
  getStatusCodeFromError,
  createSafeErrorResponse,
  
  // Handler
  globalErrorHandler,
  registerErrorHandler,
} from './error-handler';

export {
  // Types
  type RateLimitConfig,
  type RateLimitContext,
  
  // Key generators
  ipKeyGenerator,
  userKeyGenerator,
  
  // Configurations
  rateLimitConfigs,
  
  // Error response builder
  rateLimitErrorResponse,
  
  // Plugin registration
  registerGlobalRateLimit,
  createRateLimitOptions,
  
  // In-memory rate limiter class
  InMemoryRateLimiter,
  
  // Pre-configured limiters
  rateLimiters,
  
  // PreHandler factories
  createRateLimitPreHandler,
  rateLimitPreHandlers,
  loginRateLimitPreHandler,
} from './rate-limit';

export {
  // Types
  type RedisConfig,
  type RateLimitResult,
  
  // Configuration
  getRedisConfig,
  
  // Redis rate limiter class
  RedisRateLimiter,
  
  // Factory functions
  createRedisRateLimiters,
  createRedisRateLimitPreHandler,
  createRedisLoginRateLimitPreHandler,
  
  // Singleton management
  getRedisRateLimiters,
  closeRedisRateLimiters,
} from './redis-rate-limit';
