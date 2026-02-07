/**
 * Rate Limiting Middleware
 * 
 * Implements rate limiting for different endpoint types:
 * - Login: 5/min per IP, 20/hour per IP (Requirements 2.6)
 * - Pairing: 10/min per IP (Requirements 3.4)
 * - API: 60/min per authenticated user (Requirements 5.6)
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import rateLimit, { RateLimitPluginOptions } from '@fastify/rate-limit';
import { config } from '../config';

/**
 * Rate limit configuration types
 */
export interface RateLimitConfig {
  max: number;
  timeWindow: string | number;
  keyGenerator?: (request: FastifyRequest) => string;
  errorResponseBuilder?: (request: FastifyRequest, context: RateLimitContext) => object;
}

export interface RateLimitContext {
  max: number;
  after: string;
  ttl: number;
}

/**
 * Default error response builder for rate limit errors
 * Returns safe error response without leaking internal details
 */
export function rateLimitErrorResponse(
  request: FastifyRequest,
  context: RateLimitContext
): object {
  return {
    error: 'RATE_LIMITED',
    message: 'Too many requests, please try again later',
    retryAfter: context.after,
  };
}

/**
 * Key generator for IP-based rate limiting
 */
export function ipKeyGenerator(request: FastifyRequest): string {
  // Use X-Forwarded-For header if behind a proxy, otherwise use IP
  const forwarded = request.headers['x-forwarded-for'];
  if (forwarded) {
    const ip = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
    return ip.trim();
  }
  return request.ip;
}

/**
 * Key generator for user-based rate limiting (authenticated requests)
 */
export function userKeyGenerator(request: FastifyRequest): string {
  // Try to get user ID from JWT payload
  const user = (request as any).user;
  if (user?.userId) {
    return `user:${user.userId}`;
  }
  // Fall back to IP if not authenticated
  return `ip:${ipKeyGenerator(request)}`;
}

/**
 * Rate limit configurations for different endpoint types
 */
export const rateLimitConfigs = {
  /**
   * Login rate limit: 5 requests per minute per IP
   * Requirements: 2.6
   */
  login: {
    max: 5,
    timeWindow: '1 minute',
    keyGenerator: ipKeyGenerator,
    errorResponseBuilder: rateLimitErrorResponse,
  } as RateLimitConfig,

  /**
   * Login hourly rate limit: 20 requests per hour per IP
   * Requirements: 2.6
   */
  loginHourly: {
    max: 20,
    timeWindow: '1 hour',
    keyGenerator: ipKeyGenerator,
    errorResponseBuilder: rateLimitErrorResponse,
  } as RateLimitConfig,

  /**
   * Pairing rate limit: 10 requests per minute per IP
   * Requirements: 3.4
   */
  pairing: {
    max: 10,
    timeWindow: '1 minute',
    keyGenerator: ipKeyGenerator,
    errorResponseBuilder: rateLimitErrorResponse,
  } as RateLimitConfig,

  /**
   * API rate limit: 60 requests per minute per authenticated user
   * Requirements: 5.6
   */
  api: {
    max: 60,
    timeWindow: '1 minute',
    keyGenerator: userKeyGenerator,
    errorResponseBuilder: rateLimitErrorResponse,
  } as RateLimitConfig,

  /**
   * Global default rate limit
   */
  global: {
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: ipKeyGenerator,
    errorResponseBuilder: rateLimitErrorResponse,
  } as RateLimitConfig,
};

/**
 * Register global rate limiting plugin
 * This provides a baseline rate limit for all routes
 */
export async function registerGlobalRateLimit(server: FastifyInstance): Promise<void> {
  await server.register(rateLimit, {
    max: rateLimitConfigs.global.max,
    timeWindow: rateLimitConfigs.global.timeWindow,
    keyGenerator: rateLimitConfigs.global.keyGenerator,
    errorResponseBuilder: rateLimitConfigs.global.errorResponseBuilder,
  });
}

/**
 * Create route-specific rate limit options
 * Use this when registering routes that need custom rate limits
 */
export function createRateLimitOptions(
  configKey: keyof typeof rateLimitConfigs
): RateLimitPluginOptions {
  const cfg = rateLimitConfigs[configKey];
  return {
    max: cfg.max,
    timeWindow: cfg.timeWindow,
    keyGenerator: cfg.keyGenerator,
    errorResponseBuilder: cfg.errorResponseBuilder,
  };
}

/**
 * Rate limit preHandler for login routes
 * Applies both per-minute and per-hour limits
 */
export function createLoginRateLimitHandler(server: FastifyInstance) {
  // In-memory store for hourly tracking (simple implementation)
  // For production multi-node, use Redis (see task 5.2)
  const hourlyStore = new Map<string, { count: number; resetAt: number }>();

  return async function loginRateLimitHandler(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const key = ipKeyGenerator(request);
    const now = Date.now();
    const hourMs = 60 * 60 * 1000;

    // Check hourly limit
    let hourlyData = hourlyStore.get(key);
    if (!hourlyData || hourlyData.resetAt < now) {
      hourlyData = { count: 0, resetAt: now + hourMs };
      hourlyStore.set(key, hourlyData);
    }

    hourlyData.count++;

    if (hourlyData.count > rateLimitConfigs.loginHourly.max) {
      const retryAfter = Math.ceil((hourlyData.resetAt - now) / 1000);
      reply.header('Retry-After', retryAfter.toString());
      reply.status(429).send({
        error: 'RATE_LIMITED',
        message: 'Too many login attempts, please try again later',
        retryAfter: `${retryAfter} seconds`,
      });
      return;
    }

    // Clean up old entries periodically
    if (hourlyStore.size > 10000) {
      for (const [k, v] of hourlyStore.entries()) {
        if (v.resetAt < now) {
          hourlyStore.delete(k);
        }
      }
    }
  };
}

/**
 * In-memory rate limiter for simple use cases
 * For production multi-node deployments, use Redis-backed limiter (task 5.2)
 */
export class InMemoryRateLimiter {
  private store = new Map<string, { count: number; resetAt: number }>();
  private readonly max: number;
  private readonly windowMs: number;

  constructor(max: number, windowMs: number) {
    this.max = max;
    this.windowMs = windowMs;
  }

  /**
   * Check if request should be allowed
   * Returns true if allowed, false if rate limited
   */
  isAllowed(key: string): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    let data = this.store.get(key);

    if (!data || data.resetAt < now) {
      data = { count: 0, resetAt: now + this.windowMs };
      this.store.set(key, data);
    }

    data.count++;

    const allowed = data.count <= this.max;
    const remaining = Math.max(0, this.max - data.count);

    return { allowed, remaining, resetAt: data.resetAt };
  }

  /**
   * Reset rate limit for a key
   */
  reset(key: string): void {
    this.store.delete(key);
  }

  /**
   * Clean up expired entries
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, data] of this.store.entries()) {
      if (data.resetAt < now) {
        this.store.delete(key);
      }
    }
  }

  /**
   * Get current store size (for monitoring)
   */
  get size(): number {
    return this.store.size;
  }
}

/**
 * Pre-configured rate limiters for different endpoint types
 */
export const rateLimiters = {
  login: new InMemoryRateLimiter(5, 60 * 1000), // 5/min
  loginHourly: new InMemoryRateLimiter(20, 60 * 60 * 1000), // 20/hour
  pairing: new InMemoryRateLimiter(10, 60 * 1000), // 10/min
  api: new InMemoryRateLimiter(60, 60 * 1000), // 60/min
};

/**
 * Create a rate limit preHandler using InMemoryRateLimiter
 */
export function createRateLimitPreHandler(
  limiter: InMemoryRateLimiter,
  keyGenerator: (request: FastifyRequest) => string = ipKeyGenerator
) {
  return async function rateLimitPreHandler(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const key = keyGenerator(request);
    const result = limiter.isAllowed(key);

    // Set rate limit headers
    reply.header('X-RateLimit-Remaining', result.remaining.toString());
    reply.header('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000).toString());

    if (!result.allowed) {
      const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
      reply.header('Retry-After', retryAfter.toString());
      reply.status(429).send({
        error: 'RATE_LIMITED',
        message: 'Too many requests, please try again later',
        retryAfter: `${retryAfter} seconds`,
      });
    }
  };
}

/**
 * Pre-configured preHandlers for different endpoint types
 */
export const rateLimitPreHandlers = {
  login: createRateLimitPreHandler(rateLimiters.login, ipKeyGenerator),
  loginHourly: createRateLimitPreHandler(rateLimiters.loginHourly, ipKeyGenerator),
  pairing: createRateLimitPreHandler(rateLimiters.pairing, ipKeyGenerator),
  api: createRateLimitPreHandler(rateLimiters.api, userKeyGenerator),
};

/**
 * Combined login rate limit handler (checks both per-minute and per-hour)
 */
export async function loginRateLimitPreHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const key = ipKeyGenerator(request);

  // Check per-minute limit first
  const minuteResult = rateLimiters.login.isAllowed(key);
  if (!minuteResult.allowed) {
    const retryAfter = Math.ceil((minuteResult.resetAt - Date.now()) / 1000);
    reply.header('Retry-After', retryAfter.toString());
    reply.header('X-RateLimit-Remaining', '0');
    reply.status(429).send({
      error: 'RATE_LIMITED',
      message: 'Too many login attempts, please try again later',
      retryAfter: `${retryAfter} seconds`,
    });
    return;
  }

  // Check per-hour limit
  const hourResult = rateLimiters.loginHourly.isAllowed(key);
  if (!hourResult.allowed) {
    const retryAfter = Math.ceil((hourResult.resetAt - Date.now()) / 1000);
    reply.header('Retry-After', retryAfter.toString());
    reply.header('X-RateLimit-Remaining', '0');
    reply.status(429).send({
      error: 'RATE_LIMITED',
      message: 'Too many login attempts, please try again later',
      retryAfter: `${retryAfter} seconds`,
    });
    return;
  }

  // Set headers for the more restrictive limit
  reply.header('X-RateLimit-Remaining', Math.min(minuteResult.remaining, hourResult.remaining).toString());
}
