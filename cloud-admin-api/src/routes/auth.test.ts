/**
 * Auth Routes Tests
 * Property-based tests and unit tests for authentication routes.
 * 
 * Feature: cloud-admin-console
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import Fastify, { FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';
import { authRoutes } from './auth';
import { AuthService, AuthError, AuthDatabase, JwtSigner } from '../services/auth-service';

// ============================================================================
// Test Setup
// ============================================================================

/**
 * Create a mock database for testing
 */
function createMockDb(overrides: Partial<AuthDatabase> = {}): AuthDatabase {
  return {
    findAdminByEmail: async () => null,
    findAdminById: async () => null,
    updateAdminLoginSuccess: async () => {},
    updateAdminFailedAttempt: async () => {},
    createSession: async (session: any) => ({ id: 'session-id', ...session }),
    findSessionByRefreshToken: async () => null,
    deleteSession: async () => {},
    deleteSessionsByUserId: async () => {},
    recordFailedLogin: async () => {},
    countRecentFailedLogins: async () => 0,
    ...overrides,
  };
}

/**
 * Create a mock JWT signer for testing
 */
function createMockJwt(): JwtSigner {
  return {
    sign: (payload: object, options?: { expiresIn: string | number }) => 'mock-access-token',
    verify: (token: string) => ({
      userId: 'user-id',
      tenantId: 'tenant-id',
      email: 'test@example.com',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 900,
    }),
  };
}

/**
 * Create a test Fastify instance with auth routes
 */
async function createTestApp(authService: AuthService): Promise<FastifyInstance> {
  const app = Fastify();
  
  await app.register(jwt, {
    secret: 'test-secret',
  });
  
  await app.register(authRoutes, { authService, prefix: '/api/v1/auth' });
  
  return app;
}

// ============================================================================
// Property 4: Login Credential Requirement
// *For any* login request missing email or password, the System SHALL reject with 400 validation error.
// **Validates: Requirements 2.1**
// ============================================================================

describe('Property 4: Login Credential Requirement', () => {
  /**
   * Feature: cloud-admin-console, Property 4: Login Credential Requirement
   * For any login request missing email, the system should reject with 400.
   */
  it('should reject login requests missing email with 400', async () => {
    const mockDb = createMockDb();
    const mockJwt = createMockJwt();
    const authService = new AuthService(mockDb, mockJwt);
    const app = await createTestApp(authService);

    await fc.assert(
      fc.asyncProperty(
        // Generate random passwords (valid format)
        fc.string({ minLength: 8, maxLength: 100 }),
        async (password) => {
          // Request without email
          const response = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/login',
            payload: { password },
          });

          expect(response.statusCode).toBe(400);
          const body = JSON.parse(response.body);
          expect(body.error).toBe('VALIDATION_ERROR');
          expect(body.message).toBe('Invalid input');
        }
      ),
      { numRuns: 100 }
    );

    await app.close();
  });

  /**
   * Feature: cloud-admin-console, Property 4: Login Credential Requirement
   * For any login request missing password, the system should reject with 400.
   */
  it('should reject login requests missing password with 400', async () => {
    const mockDb = createMockDb();
    const mockJwt = createMockJwt();
    const authService = new AuthService(mockDb, mockJwt);
    const app = await createTestApp(authService);

    await fc.assert(
      fc.asyncProperty(
        // Generate random valid emails
        fc.emailAddress(),
        async (email) => {
          // Request without password
          const response = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/login',
            payload: { email },
          });

          expect(response.statusCode).toBe(400);
          const body = JSON.parse(response.body);
          expect(body.error).toBe('VALIDATION_ERROR');
          expect(body.message).toBe('Invalid input');
        }
      ),
      { numRuns: 100 }
    );

    await app.close();
  });

  /**
   * Feature: cloud-admin-console, Property 4: Login Credential Requirement
   * For any login request with empty body, the system should reject with 400.
   */
  it('should reject login requests with empty body with 400', async () => {
    const mockDb = createMockDb();
    const mockJwt = createMockJwt();
    const authService = new AuthService(mockDb, mockJwt);
    const app = await createTestApp(authService);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('VALIDATION_ERROR');
    expect(body.message).toBe('Invalid input');

    await app.close();
  });

  /**
   * Feature: cloud-admin-console, Property 4: Login Credential Requirement
   * For any login request with invalid email format, the system should reject with 400.
   */
  it('should reject login requests with invalid email format with 400', async () => {
    const mockDb = createMockDb();
    const mockJwt = createMockJwt();
    const authService = new AuthService(mockDb, mockJwt);
    const app = await createTestApp(authService);

    await fc.assert(
      fc.asyncProperty(
        // Generate strings that are NOT valid emails
        fc.string({ minLength: 1, maxLength: 100 }).filter(s => !s.includes('@') || !s.includes('.')),
        fc.string({ minLength: 8, maxLength: 100 }),
        async (invalidEmail, password) => {
          const response = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/login',
            payload: { email: invalidEmail, password },
          });

          expect(response.statusCode).toBe(400);
          const body = JSON.parse(response.body);
          expect(body.error).toBe('VALIDATION_ERROR');
          expect(body.message).toBe('Invalid input');
        }
      ),
      { numRuns: 100 }
    );

    await app.close();
  });

  /**
   * Feature: cloud-admin-console, Property 4: Login Credential Requirement
   * For any login request with password too short (< 8 chars), the system should reject with 400.
   */
  it('should reject login requests with password too short with 400', async () => {
    const mockDb = createMockDb();
    const mockJwt = createMockJwt();
    const authService = new AuthService(mockDb, mockJwt);
    const app = await createTestApp(authService);

    await fc.assert(
      fc.asyncProperty(
        fc.emailAddress(),
        // Generate passwords that are too short (1-7 chars)
        fc.string({ minLength: 1, maxLength: 7 }),
        async (email, shortPassword) => {
          const response = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/login',
            payload: { email, password: shortPassword },
          });

          expect(response.statusCode).toBe(400);
          const body = JSON.parse(response.body);
          expect(body.error).toBe('VALIDATION_ERROR');
          expect(body.message).toBe('Invalid input');
        }
      ),
      { numRuns: 100 }
    );

    await app.close();
  });

  /**
   * Feature: cloud-admin-console, Property 4: Login Credential Requirement
   * For any login request with both valid email and password format, the system should NOT reject with 400.
   * (It may reject with 401 for invalid credentials, but not 400 for validation)
   */
  it('should not reject valid format credentials with 400', async () => {
    const mockDb = createMockDb();
    const mockJwt = createMockJwt();
    const authService = new AuthService(mockDb, mockJwt);
    const app = await createTestApp(authService);

    // Generate realistic emails that pass Zod validation
    const validEmailArb = fc.tuple(
      fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'), { minLength: 1, maxLength: 20 }),
      fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'), { minLength: 1, maxLength: 10 }),
      fc.constantFrom('com', 'org', 'net', 'io', 'co')
    ).map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

    // Generate alphanumeric passwords with some special chars
    const validPasswordArb = fc.stringOf(
      fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*'),
      { minLength: 8, maxLength: 50 }
    );

    await fc.assert(
      fc.asyncProperty(
        validEmailArb,
        validPasswordArb,
        async (email, password) => {
          const response = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/login',
            payload: { email, password },
          });

          // Should NOT be 400 (validation error)
          // Will be 401 (unauthorized) because user doesn't exist in mock
          expect(response.statusCode).not.toBe(400);
        }
      ),
      { numRuns: 100 }
    );

    await app.close();
  }, 60000); // 60 second timeout due to bcrypt operations
});

// ============================================================================
// Login Endpoint Tests
// ============================================================================

describe('POST /api/v1/auth/login', () => {
  it('should return 200 with tokens on successful login', async () => {
    const preHashedPassword = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.VTtYWWQQQQQQQQ';
    
    const mockDb = createMockDb({
      findAdminByEmail: async (email: string) => ({
        id: 'user-123',
        tenantId: 'tenant-456',
        email,
        passwordHash: preHashedPassword,
        lockedUntil: null,
        failedAttempts: 0,
        tenant: { id: 'tenant-456', name: 'Test Company' },
      }),
    });
    
    // Create a real-ish mock that simulates bcrypt verification
    const mockJwt = createMockJwt();
    const authService = new AuthService(mockDb, mockJwt);
    
    // Override the login to simulate success
    vi.spyOn(authService, 'login').mockResolvedValue({
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
      expiresIn: 900,
      user: {
        id: 'user-123',
        email: 'test@example.com',
        tenantId: 'tenant-456',
        tenantName: 'Test Company',
      },
    });
    
    const app = await createTestApp(authService);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'test@example.com',
        password: 'validpassword123',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.accessToken).toBe('mock-access-token');
    expect(body.refreshToken).toBe('mock-refresh-token');
    expect(body.expiresIn).toBe(900);
    expect(body.user.email).toBe('test@example.com');

    await app.close();
  });

  it('should return 401 for invalid credentials', async () => {
    const mockDb = createMockDb();
    const mockJwt = createMockJwt();
    const authService = new AuthService(mockDb, mockJwt);
    const app = await createTestApp(authService);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'nonexistent@example.com',
        password: 'wrongpassword',
      },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('UNAUTHORIZED');
    expect(body.message).toBe('Invalid email or password');

    await app.close();
  });

  it('should return 403 for locked account', async () => {
    const mockDb = createMockDb({
      findAdminByEmail: async () => ({
        id: 'user-123',
        tenantId: 'tenant-456',
        email: 'locked@example.com',
        passwordHash: 'hash',
        lockedUntil: new Date(Date.now() + 30 * 60 * 1000), // Locked for 30 more minutes
        failedAttempts: 5,
        tenant: { id: 'tenant-456', name: 'Test Company' },
      }),
    });
    
    const mockJwt = createMockJwt();
    const authService = new AuthService(mockDb, mockJwt);
    const app = await createTestApp(authService);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'locked@example.com',
        password: 'anypassword',
      },
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('FORBIDDEN');
    expect(body.message).toContain('locked');

    await app.close();
  });
});

// ============================================================================
// Refresh Endpoint Tests
// ============================================================================

describe('POST /api/v1/auth/refresh', () => {
  it('should return 200 with new tokens on valid refresh token', async () => {
    const mockDb = createMockDb({
      findSessionByRefreshToken: async () => ({
        id: 'session-123',
        userId: 'user-123',
        tenantId: 'tenant-456',
        refreshToken: 'valid-refresh-token',
        expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      }),
      findAdminById: async () => ({
        id: 'user-123',
        tenantId: 'tenant-456',
        email: 'test@example.com',
        passwordHash: 'hash',
        lockedUntil: null,
        failedAttempts: 0,
        tenant: { id: 'tenant-456', name: 'Test Company' },
      }),
    });
    
    const mockJwt = createMockJwt();
    const authService = new AuthService(mockDb, mockJwt);
    const app = await createTestApp(authService);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: {
        refreshToken: 'valid-refresh-token',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.accessToken).toBeDefined();
    expect(body.refreshToken).toBeDefined();
    expect(body.expiresIn).toBeDefined();

    await app.close();
  });

  it('should return 401 for invalid refresh token', async () => {
    const mockDb = createMockDb();
    const mockJwt = createMockJwt();
    const authService = new AuthService(mockDb, mockJwt);
    const app = await createTestApp(authService);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: {
        refreshToken: 'invalid-refresh-token',
      },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('UNAUTHORIZED');

    await app.close();
  });

  it('should return 401 for expired refresh token', async () => {
    const mockDb = createMockDb({
      findSessionByRefreshToken: async () => ({
        id: 'session-123',
        userId: 'user-123',
        tenantId: 'tenant-456',
        refreshToken: 'expired-refresh-token',
        expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
      }),
    });
    
    const mockJwt = createMockJwt();
    const authService = new AuthService(mockDb, mockJwt);
    const app = await createTestApp(authService);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: {
        refreshToken: 'expired-refresh-token',
      },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('UNAUTHORIZED');

    await app.close();
  });

  it('should return 400 for missing refresh token', async () => {
    const mockDb = createMockDb();
    const mockJwt = createMockJwt();
    const authService = new AuthService(mockDb, mockJwt);
    const app = await createTestApp(authService);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('VALIDATION_ERROR');

    await app.close();
  });
});

// ============================================================================
// Logout Endpoint Tests
// ============================================================================

describe('POST /api/v1/auth/logout', () => {
  it('should return 200 on successful logout', async () => {
    let sessionsDeleted = false;
    
    const mockDb = createMockDb({
      deleteSessionsByUserId: async () => {
        sessionsDeleted = true;
      },
    });
    
    const mockJwt = createMockJwt();
    const authService = new AuthService(mockDb, mockJwt);
    
    // Create app with JWT plugin
    const app = Fastify();
    await app.register(jwt, {
      secret: 'test-secret',
    });
    await app.register(authRoutes, { authService, prefix: '/api/v1/auth' });

    // Sign a valid token using the app's JWT
    const validToken = app.jwt.sign({ userId: 'user-id', tenantId: 'tenant-id', email: 'test@example.com' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: {
        authorization: `Bearer ${validToken}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.message).toBe('Logged out successfully');
    expect(sessionsDeleted).toBe(true);

    await app.close();
  });

  it('should return 401 without authorization header', async () => {
    const mockDb = createMockDb();
    const mockJwt = createMockJwt();
    const authService = new AuthService(mockDb, mockJwt);
    const app = await createTestApp(authService);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('UNAUTHORIZED');

    await app.close();
  });

  it('should return 401 with invalid token', async () => {
    const mockDb = createMockDb();
    const mockJwt = createMockJwt();
    const authService = new AuthService(mockDb, mockJwt);
    
    const app = Fastify();
    await app.register(jwt, {
      secret: 'test-secret',
    });
    await app.register(authRoutes, { authService, prefix: '/api/v1/auth' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: {
        authorization: 'Bearer invalid-token',
      },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('UNAUTHORIZED');

    await app.close();
  });
});
