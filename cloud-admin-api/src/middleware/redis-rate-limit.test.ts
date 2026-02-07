/**
 * Redis Rate Limiter Tests
 * 
 * Tests for Redis-backed rate limiting functionality.
 * Note: These tests use the fallback in-memory limiter since Redis
 * is not available in the test environment.
 * 
 * Requirements: 2.6 (login rate limiting)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyRequest } from 'fastify';
import {
  RedisRateLimiter,
  getRedisConfig,
  createRedisRateLimiters,
} from './redis-rate-limit';

describe('Redis Rate Limiter', () => {
  describe('getRedisConfig', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should return null when no Redis config is set', () => {
      delete process.env.REDIS_URL;
      delete process.env.REDIS_HOST;
      
      const config = getRedisConfig();
      expect(config).toBeNull();
    });

    it('should parse REDIS_URL', () => {
      process.env.REDIS_URL = 'redis://localhost:6379/0';
      
      const config = getRedisConfig();
      expect(config).not.toBeNull();
      expect(config?.host).toBe('localhost');
      expect(config?.port).toBe(6379);
      expect(config?.db).toBe(0);
    });

    it('should parse REDIS_URL with password', () => {
      process.env.REDIS_URL = 'redis://:mypassword@localhost:6379/1';
      
      const config = getRedisConfig();
      expect(config).not.toBeNull();
      expect(config?.host).toBe('localhost');
      expect(config?.port).toBe(6379);
      expect(config?.password).toBe('mypassword');
      expect(config?.db).toBe(1);
    });

    it('should parse REDIS_URL with TLS', () => {
      process.env.REDIS_URL = 'rediss://localhost:6379/0';
      
      const config = getRedisConfig();
      expect(config).not.toBeNull();
      expect(config?.tls).toBe(true);
    });

    it('should use individual environment variables', () => {
      delete process.env.REDIS_URL;
      process.env.REDIS_HOST = 'redis.example.com';
      process.env.REDIS_PORT = '6380';
      process.env.REDIS_PASSWORD = 'secret';
      process.env.REDIS_DB = '2';
      process.env.REDIS_TLS = 'true';
      
      const config = getRedisConfig();
      expect(config).not.toBeNull();
      expect(config?.host).toBe('redis.example.com');
      expect(config?.port).toBe(6380);
      expect(config?.password).toBe('secret');
      expect(config?.db).toBe(2);
      expect(config?.tls).toBe(true);
    });
  });

  describe('RedisRateLimiter (fallback mode)', () => {
    let limiter: RedisRateLimiter;

    beforeEach(() => {
      // Create limiter without Redis config (uses fallback)
      limiter = new RedisRateLimiter(5, 60000);
    });

    afterEach(async () => {
      await limiter.close();
    });

    it('should not be connected to Redis', () => {
      expect(limiter.isRedisAvailable()).toBe(false);
    });

    it('should allow requests within limit using fallback', async () => {
      const key = 'test-ip';
      
      for (let i = 0; i < 5; i++) {
        const result = await limiter.isAllowed(key);
        expect(result.allowed).toBe(true);
        expect(result.total).toBe(5);
      }
    });

    it('should block requests exceeding limit using fallback', async () => {
      const key = 'test-ip';
      
      // Use up all allowed requests
      for (let i = 0; i < 5; i++) {
        await limiter.isAllowed(key);
      }

      // Next request should be blocked
      const result = await limiter.isAllowed(key);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should track different keys independently', async () => {
      const key1 = 'ip-1';
      const key2 = 'ip-2';

      // Use up all requests for key1
      for (let i = 0; i < 5; i++) {
        await limiter.isAllowed(key1);
      }

      // key2 should still be allowed
      const result = await limiter.isAllowed(key2);
      expect(result.allowed).toBe(true);
    });

    it('should reset rate limit for a key', async () => {
      const key = 'test-ip';
      
      // Use some requests
      await limiter.isAllowed(key);
      await limiter.isAllowed(key);

      // Reset
      await limiter.reset(key);

      // Should have full quota again
      const result = await limiter.isAllowed(key);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
    });
  });

  describe('createRedisRateLimiters', () => {
    it('should create all rate limiters', () => {
      const limiters = createRedisRateLimiters();
      
      expect(limiters.login).toBeInstanceOf(RedisRateLimiter);
      expect(limiters.loginHourly).toBeInstanceOf(RedisRateLimiter);
      expect(limiters.pairing).toBeInstanceOf(RedisRateLimiter);
      expect(limiters.api).toBeInstanceOf(RedisRateLimiter);
    });

    it('should create limiters with correct limits', async () => {
      const limiters = createRedisRateLimiters();
      
      // Test login limiter (5/min)
      const key = 'test-ip';
      for (let i = 0; i < 5; i++) {
        const result = await limiters.login.isAllowed(key);
        expect(result.allowed).toBe(true);
      }
      const blocked = await limiters.login.isAllowed(key);
      expect(blocked.allowed).toBe(false);

      // Cleanup
      await Promise.all([
        limiters.login.close(),
        limiters.loginHourly.close(),
        limiters.pairing.close(),
        limiters.api.close(),
      ]);
    });
  });
});
