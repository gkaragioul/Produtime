/**
 * Rate Limiting Middleware Tests
 * 
 * Tests for rate limiting functionality:
 * - Login: 5/min per IP, 20/hour per IP (Requirements 2.6)
 * - Pairing: 10/min per IP (Requirements 3.4)
 * - API: 60/min per authenticated user (Requirements 5.6)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FastifyRequest } from 'fastify';
import {
  InMemoryRateLimiter,
  ipKeyGenerator,
  userKeyGenerator,
  rateLimitConfigs,
  rateLimiters,
  rateLimitErrorResponse,
} from './rate-limit';

describe('Rate Limiting Middleware', () => {
  describe('InMemoryRateLimiter', () => {
    let limiter: InMemoryRateLimiter;

    beforeEach(() => {
      limiter = new InMemoryRateLimiter(5, 60000); // 5 requests per minute
    });

    it('should allow requests within limit', () => {
      const key = 'test-ip';
      
      for (let i = 0; i < 5; i++) {
        const result = limiter.isAllowed(key);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(4 - i);
      }
    });

    it('should block requests exceeding limit', () => {
      const key = 'test-ip';
      
      // Use up all allowed requests
      for (let i = 0; i < 5; i++) {
        limiter.isAllowed(key);
      }

      // Next request should be blocked
      const result = limiter.isAllowed(key);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should track different keys independently', () => {
      const key1 = 'ip-1';
      const key2 = 'ip-2';

      // Use up all requests for key1
      for (let i = 0; i < 5; i++) {
        limiter.isAllowed(key1);
      }

      // key2 should still be allowed
      const result = limiter.isAllowed(key2);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
    });

    it('should reset after window expires', () => {
      const key = 'test-ip';
      
      // Use up all requests
      for (let i = 0; i < 5; i++) {
        limiter.isAllowed(key);
      }

      // Should be blocked
      expect(limiter.isAllowed(key).allowed).toBe(false);

      // Create new limiter with very short window for testing
      const shortLimiter = new InMemoryRateLimiter(5, 10); // 10ms window
      
      // Use up requests
      for (let i = 0; i < 5; i++) {
        shortLimiter.isAllowed(key);
      }

      // Wait for window to expire
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const result = shortLimiter.isAllowed(key);
          expect(result.allowed).toBe(true);
          resolve();
        }, 20);
      });
    });

    it('should reset specific key', () => {
      const key = 'test-ip';
      
      // Use some requests
      limiter.isAllowed(key);
      limiter.isAllowed(key);

      // Reset
      limiter.reset(key);

      // Should have full quota again
      const result = limiter.isAllowed(key);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
    });

    it('should cleanup expired entries', () => {
      const shortLimiter = new InMemoryRateLimiter(5, 10); // 10ms window
      
      // Add some entries
      shortLimiter.isAllowed('key1');
      shortLimiter.isAllowed('key2');
      
      expect(shortLimiter.size).toBe(2);

      // Wait for expiry and cleanup
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          shortLimiter.cleanup();
          expect(shortLimiter.size).toBe(0);
          resolve();
        }, 20);
      });
    });
  });

  describe('ipKeyGenerator', () => {
    it('should extract IP from request', () => {
      const request = {
        ip: '192.168.1.1',
        headers: {},
      } as unknown as FastifyRequest;

      expect(ipKeyGenerator(request)).toBe('192.168.1.1');
    });

    it('should use X-Forwarded-For header when present', () => {
      const request = {
        ip: '127.0.0.1',
        headers: {
          'x-forwarded-for': '203.0.113.195, 70.41.3.18, 150.172.238.178',
        },
      } as unknown as FastifyRequest;

      expect(ipKeyGenerator(request)).toBe('203.0.113.195');
    });

    it('should handle array X-Forwarded-For header', () => {
      const request = {
        ip: '127.0.0.1',
        headers: {
          'x-forwarded-for': ['203.0.113.195', '70.41.3.18'],
        },
      } as unknown as FastifyRequest;

      expect(ipKeyGenerator(request)).toBe('203.0.113.195');
    });
  });

  describe('userKeyGenerator', () => {
    it('should use user ID when authenticated', () => {
      const request = {
        ip: '192.168.1.1',
        headers: {},
        user: { userId: 'user-123' },
      } as unknown as FastifyRequest;

      expect(userKeyGenerator(request)).toBe('user:user-123');
    });

    it('should fall back to IP when not authenticated', () => {
      const request = {
        ip: '192.168.1.1',
        headers: {},
      } as unknown as FastifyRequest;

      expect(userKeyGenerator(request)).toBe('ip:192.168.1.1');
    });
  });

  describe('rateLimitConfigs', () => {
    it('should have correct login rate limit config', () => {
      expect(rateLimitConfigs.login.max).toBe(5);
      expect(rateLimitConfigs.login.timeWindow).toBe('1 minute');
    });

    it('should have correct login hourly rate limit config', () => {
      expect(rateLimitConfigs.loginHourly.max).toBe(20);
      expect(rateLimitConfigs.loginHourly.timeWindow).toBe('1 hour');
    });

    it('should have correct pairing rate limit config', () => {
      expect(rateLimitConfigs.pairing.max).toBe(10);
      expect(rateLimitConfigs.pairing.timeWindow).toBe('1 minute');
    });

    it('should have correct API rate limit config', () => {
      expect(rateLimitConfigs.api.max).toBe(60);
      expect(rateLimitConfigs.api.timeWindow).toBe('1 minute');
    });
  });

  describe('rateLimiters', () => {
    beforeEach(() => {
      // Reset all limiters before each test
      rateLimiters.login = new InMemoryRateLimiter(5, 60 * 1000);
      rateLimiters.loginHourly = new InMemoryRateLimiter(20, 60 * 60 * 1000);
      rateLimiters.pairing = new InMemoryRateLimiter(10, 60 * 1000);
      rateLimiters.api = new InMemoryRateLimiter(60, 60 * 1000);
    });

    it('should have login limiter with 5/min limit', () => {
      const key = 'test-ip';
      
      // Should allow 5 requests
      for (let i = 0; i < 5; i++) {
        expect(rateLimiters.login.isAllowed(key).allowed).toBe(true);
      }
      
      // 6th should be blocked
      expect(rateLimiters.login.isAllowed(key).allowed).toBe(false);
    });

    it('should have loginHourly limiter with 20/hour limit', () => {
      const key = 'test-ip';
      
      // Should allow 20 requests
      for (let i = 0; i < 20; i++) {
        expect(rateLimiters.loginHourly.isAllowed(key).allowed).toBe(true);
      }
      
      // 21st should be blocked
      expect(rateLimiters.loginHourly.isAllowed(key).allowed).toBe(false);
    });

    it('should have pairing limiter with 10/min limit', () => {
      const key = 'test-ip';
      
      // Should allow 10 requests
      for (let i = 0; i < 10; i++) {
        expect(rateLimiters.pairing.isAllowed(key).allowed).toBe(true);
      }
      
      // 11th should be blocked
      expect(rateLimiters.pairing.isAllowed(key).allowed).toBe(false);
    });

    it('should have api limiter with 60/min limit', () => {
      const key = 'user:test-user';
      
      // Should allow 60 requests
      for (let i = 0; i < 60; i++) {
        expect(rateLimiters.api.isAllowed(key).allowed).toBe(true);
      }
      
      // 61st should be blocked
      expect(rateLimiters.api.isAllowed(key).allowed).toBe(false);
    });
  });

  describe('rateLimitErrorResponse', () => {
    it('should return safe error response', () => {
      const request = {} as FastifyRequest;
      const context = {
        max: 5,
        after: '60 seconds',
        ttl: 60000,
      };

      const response = rateLimitErrorResponse(request, context);

      expect(response).toEqual({
        error: 'RATE_LIMITED',
        message: 'Too many requests, please try again later',
        retryAfter: '60 seconds',
      });
    });

    it('should not leak internal details', () => {
      const request = {
        ip: '192.168.1.1',
        headers: { authorization: 'Bearer secret-token' },
      } as unknown as FastifyRequest;
      const context = {
        max: 5,
        after: '30 seconds',
        ttl: 30000,
      };

      const response = rateLimitErrorResponse(request, context) as Record<string, unknown>;

      // Should not contain sensitive info
      expect(JSON.stringify(response)).not.toContain('192.168.1.1');
      expect(JSON.stringify(response)).not.toContain('secret-token');
      expect(JSON.stringify(response)).not.toContain('Bearer');
    });
  });
});
