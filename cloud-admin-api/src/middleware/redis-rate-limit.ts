/**
 * Redis-Backed Rate Limiter
 * 
 * Implements a token bucket algorithm using Redis for distributed rate limiting
 * across multiple nodes. This is optional and falls back to in-memory limiting
 * when Redis is not available.
 * 
 * Requirements: 2.6 (login rate limiting)
 */

import Redis from 'ioredis';
import { FastifyRequest, FastifyReply } from 'fastify';
import { ipKeyGenerator, userKeyGenerator, InMemoryRateLimiter } from './rate-limit';

/**
 * Redis connection configuration
 */
export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  keyPrefix?: string;
  tls?: boolean;
  connectTimeout?: number;
  maxRetriesPerRequest?: number;
}

/**
 * Rate limit result from Redis
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  total: number;
}

/**
 * Get Redis configuration from environment
 */
export function getRedisConfig(): RedisConfig | null {
  const redisUrl = process.env.REDIS_URL;
  
  if (redisUrl) {
    // Parse Redis URL (redis://[:password@]host[:port][/db])
    try {
      const url = new URL(redisUrl);
      return {
        host: url.hostname,
        port: parseInt(url.port || '6379', 10),
        password: url.password || undefined,
        db: url.pathname ? parseInt(url.pathname.slice(1), 10) : 0,
        keyPrefix: 'ratelimit:',
        tls: url.protocol === 'rediss:',
        connectTimeout: 5000,
        maxRetriesPerRequest: 3,
      };
    } catch {
      return null;
    }
  }

  // Check individual environment variables
  const host = process.env.REDIS_HOST;
  if (!host) {
    return null;
  }

  return {
    host,
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0', 10),
    keyPrefix: 'ratelimit:',
    tls: process.env.REDIS_TLS === 'true',
    connectTimeout: 5000,
    maxRetriesPerRequest: 3,
  };
}

/**
 * Redis-backed rate limiter using token bucket algorithm
 */
export class RedisRateLimiter {
  private redis: Redis | null = null;
  private readonly keyPrefix: string;
  private readonly fallbackLimiter: InMemoryRateLimiter;
  private connected = false;

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    config?: RedisConfig
  ) {
    this.keyPrefix = config?.keyPrefix || 'ratelimit:';
    this.fallbackLimiter = new InMemoryRateLimiter(max, windowMs);

    if (config) {
      this.initRedis(config);
    }
  }

  /**
   * Initialize Redis connection
   */
  private initRedis(config: RedisConfig): void {
    try {
      this.redis = new Redis({
        host: config.host,
        port: config.port,
        password: config.password,
        db: config.db,
        connectTimeout: config.connectTimeout,
        maxRetriesPerRequest: config.maxRetriesPerRequest,
        tls: config.tls ? {} : undefined,
        lazyConnect: true,
        retryStrategy: (times) => {
          if (times > 3) {
            // Stop retrying after 3 attempts
            return null;
          }
          return Math.min(times * 100, 3000);
        },
      });

      this.redis.on('connect', () => {
        this.connected = true;
      });

      this.redis.on('error', (err) => {
        console.error('Redis rate limiter error:', err.message);
        this.connected = false;
      });

      this.redis.on('close', () => {
        this.connected = false;
      });

      // Attempt to connect
      this.redis.connect().catch(() => {
        this.connected = false;
      });
    } catch (err) {
      console.error('Failed to initialize Redis rate limiter:', err);
      this.redis = null;
    }
  }

  /**
   * Check if Redis is available
   */
  isRedisAvailable(): boolean {
    return this.connected && this.redis !== null;
  }

  /**
   * Check if request should be allowed using token bucket algorithm
   * Falls back to in-memory limiter if Redis is unavailable
   */
  async isAllowed(key: string): Promise<RateLimitResult> {
    if (!this.isRedisAvailable()) {
      // Fall back to in-memory limiter
      const result = this.fallbackLimiter.isAllowed(key);
      return {
        allowed: result.allowed,
        remaining: result.remaining,
        resetAt: result.resetAt,
        total: this.max,
      };
    }

    const fullKey = `${this.keyPrefix}${key}`;
    const now = Date.now();
    const windowStart = now - this.windowMs;

    try {
      // Use Redis transaction for atomic operations
      // Token bucket: count requests in current window
      const pipeline = this.redis!.pipeline();
      
      // Remove old entries outside the window
      pipeline.zremrangebyscore(fullKey, 0, windowStart);
      
      // Count current entries
      pipeline.zcard(fullKey);
      
      // Add current request with timestamp as score
      pipeline.zadd(fullKey, now, `${now}:${Math.random()}`);
      
      // Set expiry on the key
      pipeline.pexpire(fullKey, this.windowMs);

      const results = await pipeline.exec();
      
      if (!results) {
        throw new Error('Pipeline execution failed');
      }

      // Get count from zcard result (index 1)
      const count = (results[1][1] as number) || 0;
      const allowed = count < this.max;
      const remaining = Math.max(0, this.max - count - 1);
      const resetAt = now + this.windowMs;

      // If not allowed, remove the request we just added
      if (!allowed) {
        await this.redis!.zremrangebyscore(fullKey, now, now + 1);
      }

      return {
        allowed,
        remaining: allowed ? remaining : 0,
        resetAt,
        total: this.max,
      };
    } catch (err) {
      console.error('Redis rate limit check failed:', err);
      // Fall back to in-memory limiter
      const result = this.fallbackLimiter.isAllowed(key);
      return {
        allowed: result.allowed,
        remaining: result.remaining,
        resetAt: result.resetAt,
        total: this.max,
      };
    }
  }

  /**
   * Reset rate limit for a key
   */
  async reset(key: string): Promise<void> {
    const fullKey = `${this.keyPrefix}${key}`;
    
    if (this.isRedisAvailable()) {
      try {
        await this.redis!.del(fullKey);
      } catch (err) {
        console.error('Redis rate limit reset failed:', err);
      }
    }
    
    this.fallbackLimiter.reset(key);
  }

  /**
   * Get current count for a key (for monitoring)
   */
  async getCount(key: string): Promise<number> {
    if (!this.isRedisAvailable()) {
      return 0;
    }

    const fullKey = `${this.keyPrefix}${key}`;
    const now = Date.now();
    const windowStart = now - this.windowMs;

    try {
      await this.redis!.zremrangebyscore(fullKey, 0, windowStart);
      return await this.redis!.zcard(fullKey);
    } catch {
      return 0;
    }
  }

  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
      this.connected = false;
    }
  }
}

/**
 * Create Redis-backed rate limiters for different endpoint types
 */
export function createRedisRateLimiters(config?: RedisConfig) {
  const redisConfig = config || getRedisConfig();

  return {
    login: new RedisRateLimiter(5, 60 * 1000, redisConfig || undefined),
    loginHourly: new RedisRateLimiter(20, 60 * 60 * 1000, redisConfig || undefined),
    pairing: new RedisRateLimiter(10, 60 * 1000, redisConfig || undefined),
    api: new RedisRateLimiter(60, 60 * 1000, redisConfig || undefined),
  };
}

/**
 * Create a rate limit preHandler using RedisRateLimiter
 */
export function createRedisRateLimitPreHandler(
  limiter: RedisRateLimiter,
  keyGenerator: (request: FastifyRequest) => string = ipKeyGenerator
) {
  return async function redisRateLimitPreHandler(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const key = keyGenerator(request);
    const result = await limiter.isAllowed(key);

    // Set rate limit headers
    reply.header('X-RateLimit-Limit', result.total.toString());
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
 * Combined login rate limit handler for Redis (checks both per-minute and per-hour)
 */
export function createRedisLoginRateLimitPreHandler(
  loginLimiter: RedisRateLimiter,
  loginHourlyLimiter: RedisRateLimiter
) {
  return async function redisLoginRateLimitPreHandler(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const key = ipKeyGenerator(request);

    // Check per-minute limit first
    const minuteResult = await loginLimiter.isAllowed(key);
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
    const hourResult = await loginHourlyLimiter.isAllowed(key);
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
  };
}

/**
 * Singleton instance for application-wide use
 */
let redisLimiters: ReturnType<typeof createRedisRateLimiters> | null = null;

/**
 * Get or create Redis rate limiters
 */
export function getRedisRateLimiters() {
  if (!redisLimiters) {
    redisLimiters = createRedisRateLimiters();
  }
  return redisLimiters;
}

/**
 * Close all Redis connections (for graceful shutdown)
 */
export async function closeRedisRateLimiters(): Promise<void> {
  if (redisLimiters) {
    await Promise.all([
      redisLimiters.login.close(),
      redisLimiters.loginHourly.close(),
      redisLimiters.pairing.close(),
      redisLimiters.api.close(),
    ]);
    redisLimiters = null;
  }
}
