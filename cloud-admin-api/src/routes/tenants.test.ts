/**
 * Tenant Routes Tests
 * Property-based tests and unit tests for tenant routes.
 * 
 * Feature: cloud-admin-console
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import Fastify, { FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';
import { tenantRoutes } from './tenants';
import { TenantService, TenantDatabase, Tenant, TenantResult } from '../services/tenant-service';

// ============================================================================
// Test Setup
// ============================================================================

const OPERATOR_API_KEY = 'test-operator-key-12345';

/**
 * Create a mock tenant database for testing
 */
function createMockTenantDb(overrides: Partial<TenantDatabase> = {}): TenantDatabase {
  return {
    createTenant: async (tenant) => ({
      id: tenant.id,
      name: tenant.name,
      wsEndpoint: tenant.wsEndpoint,
      apiKey: tenant.apiKey,
      createdAt: new Date(),
      updatedAt: new Date(),
      settings: tenant.settings ? JSON.parse(tenant.settings) : null,
    }),
    findTenantById: async () => null,
    findTenantByApiKey: async () => null,
    findTenantByWsEndpoint: async () => null,
    updateTenant: async (tenantId, updates) => ({
      id: tenantId,
      name: updates.name || 'Test Tenant',
      wsEndpoint: 'ws://localhost:3000/ws/tenant/' + tenantId,
      apiKey: 'mock-api-key',
      createdAt: new Date(),
      updatedAt: new Date(),
      settings: updates.settings ? JSON.parse(updates.settings) : null,
    }),
    createAdminUser: async (admin) => ({
      id: admin.id,
      email: admin.email,
    }),
    findAdminByEmail: async () => null,
    countTenants: async () => 0,
    getAllTenantIds: async () => [],
    getAllApiKeys: async () => [],
    getAllWsEndpoints: async () => [],
    ...overrides,
  };
}

/**
 * Create a test Fastify instance with tenant routes
 */
async function createTestApp(
  tenantService: TenantService,
  operatorApiKey?: string
): Promise<FastifyInstance> {
  const app = Fastify();
  
  await app.register(jwt, {
    secret: 'test-secret',
  });
  
  await app.register(tenantRoutes, { 
    tenantService, 
    operatorApiKey,
    prefix: '/api/v1/tenants' 
  });
  
  return app;
}

// ============================================================================
// Property 3: Tenant Context Validation
// *For any* API request without a valid tenant context (missing or invalid tenant ID in JWT),
// the System SHALL reject the request with 401 or 403.
// **Validates: Requirements 1.4**
// ============================================================================

describe('Property 3: Tenant Context Validation', () => {
  /**
   * Feature: cloud-admin-console, Property 3: Tenant Context Validation
   * For any request to GET /tenants/:tenantId without authorization, 
   * the system should reject with 403.
   */
  it('should reject requests without any authorization with 403', async () => {
    const mockDb = createMockTenantDb({
      findTenantById: async (id) => ({
        id,
        name: 'Test Tenant',
        wsEndpoint: `ws://localhost:3000/ws/tenant/${id}`,
        apiKey: 'test-api-key',
        createdAt: new Date(),
        updatedAt: new Date(),
        settings: null,
      }),
    });
    const tenantService = new TenantService(mockDb);
    const app = await createTestApp(tenantService, OPERATOR_API_KEY);

    await fc.assert(
      fc.asyncProperty(
        // Generate random valid UUIDs for tenant IDs
        fc.uuid(),
        async (tenantId) => {
          const response = await app.inject({
            method: 'GET',
            url: `/api/v1/tenants/${tenantId}`,
            // No authorization header
          });

          expect(response.statusCode).toBe(403);
          const body = JSON.parse(response.body);
          expect(body.error).toBe('FORBIDDEN');
        }
      ),
      { numRuns: 100 }
    );

    await app.close();
  });

  /**
   * Feature: cloud-admin-console, Property 3: Tenant Context Validation
   * For any request with JWT token for a different tenant,
   * the system should reject with 403.
   */
  it('should reject requests with JWT for different tenant with 403', async () => {
    const mockDb = createMockTenantDb({
      findTenantById: async (id) => ({
        id,
        name: 'Test Tenant',
        wsEndpoint: `ws://localhost:3000/ws/tenant/${id}`,
        apiKey: 'test-api-key',
        createdAt: new Date(),
        updatedAt: new Date(),
        settings: null,
      }),
    });
    const tenantService = new TenantService(mockDb);
    const app = await createTestApp(tenantService, OPERATOR_API_KEY);

    await fc.assert(
      fc.asyncProperty(
        // Generate two different UUIDs
        fc.uuid(),
        fc.uuid(),
        async (requestedTenantId, userTenantId) => {
          // Skip if they happen to be the same
          fc.pre(requestedTenantId !== userTenantId);

          // Create JWT for a different tenant
          const token = app.jwt.sign({
            userId: 'user-123',
            tenantId: userTenantId,
            email: 'test@example.com',
          });

          const response = await app.inject({
            method: 'GET',
            url: `/api/v1/tenants/${requestedTenantId}`,
            headers: {
              authorization: `Bearer ${token}`,
            },
          });

          expect(response.statusCode).toBe(403);
          const body = JSON.parse(response.body);
          expect(body.error).toBe('FORBIDDEN');
        }
      ),
      { numRuns: 100 }
    );

    await app.close();
  });

  /**
   * Feature: cloud-admin-console, Property 3: Tenant Context Validation
   * For any request with invalid JWT token,
   * the system should reject with 403.
   */
  it('should reject requests with invalid JWT token with 403', async () => {
    const mockDb = createMockTenantDb({
      findTenantById: async (id) => ({
        id,
        name: 'Test Tenant',
        wsEndpoint: `ws://localhost:3000/ws/tenant/${id}`,
        apiKey: 'test-api-key',
        createdAt: new Date(),
        updatedAt: new Date(),
        settings: null,
      }),
    });
    const tenantService = new TenantService(mockDb);
    const app = await createTestApp(tenantService, OPERATOR_API_KEY);

    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        // Generate random invalid tokens
        fc.string({ minLength: 10, maxLength: 200 }),
        async (tenantId, invalidToken) => {
          const response = await app.inject({
            method: 'GET',
            url: `/api/v1/tenants/${tenantId}`,
            headers: {
              authorization: `Bearer ${invalidToken}`,
            },
          });

          expect(response.statusCode).toBe(403);
          const body = JSON.parse(response.body);
          expect(body.error).toBe('FORBIDDEN');
        }
      ),
      { numRuns: 100 }
    );

    await app.close();
  });

  /**
   * Feature: cloud-admin-console, Property 3: Tenant Context Validation
   * For any request with valid JWT for the same tenant,
   * the system should allow access (200 or 404).
   */
  it('should allow requests with valid JWT for same tenant', async () => {
    const mockDb = createMockTenantDb({
      findTenantById: async (id) => ({
        id,
        name: 'Test Tenant',
        wsEndpoint: `ws://localhost:3000/ws/tenant/${id}`,
        apiKey: 'test-api-key',
        createdAt: new Date(),
        updatedAt: new Date(),
        settings: null,
      }),
    });
    const tenantService = new TenantService(mockDb);
    const app = await createTestApp(tenantService, OPERATOR_API_KEY);

    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (tenantId) => {
          // Create JWT for the same tenant
          const token = app.jwt.sign({
            userId: 'user-123',
            tenantId: tenantId,
            email: 'test@example.com',
          });

          const response = await app.inject({
            method: 'GET',
            url: `/api/v1/tenants/${tenantId}`,
            headers: {
              authorization: `Bearer ${token}`,
            },
          });

          // Should be 200 (found) - not 403 (forbidden)
          expect(response.statusCode).toBe(200);
        }
      ),
      { numRuns: 100 }
    );

    await app.close();
  });

  /**
   * Feature: cloud-admin-console, Property 3: Tenant Context Validation
   * For any request with valid operator API key,
   * the system should allow access regardless of tenant.
   */
  it('should allow operator access to any tenant', async () => {
    const mockDb = createMockTenantDb({
      findTenantById: async (id) => ({
        id,
        name: 'Test Tenant',
        wsEndpoint: `ws://localhost:3000/ws/tenant/${id}`,
        apiKey: 'test-api-key',
        createdAt: new Date(),
        updatedAt: new Date(),
        settings: null,
      }),
    });
    const tenantService = new TenantService(mockDb);
    const app = await createTestApp(tenantService, OPERATOR_API_KEY);

    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (tenantId) => {
          const response = await app.inject({
            method: 'GET',
            url: `/api/v1/tenants/${tenantId}`,
            headers: {
              'x-operator-key': OPERATOR_API_KEY,
            },
          });

          // Should be 200 (found) - not 403 (forbidden)
          expect(response.statusCode).toBe(200);
        }
      ),
      { numRuns: 100 }
    );

    await app.close();
  });
});


// ============================================================================
// POST /api/v1/tenants Tests
// ============================================================================

describe('POST /api/v1/tenants', () => {
  it('should return 201 with tenant details on successful creation', async () => {
    const mockDb = createMockTenantDb();
    const tenantService = new TenantService(mockDb);
    const app = await createTestApp(tenantService, OPERATOR_API_KEY);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tenants',
      headers: {
        'x-operator-key': OPERATOR_API_KEY,
      },
      payload: {
        name: 'Test Company',
        adminEmail: 'admin@testcompany.com',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.tenantId).toBeDefined();
    expect(body.name).toBe('Test Company');
    expect(body.wsEndpoint).toBeDefined();
    expect(body.apiKey).toBeDefined();
    expect(body.adminUser).toBeDefined();
    expect(body.adminUser.email).toBe('admin@testcompany.com');
    expect(body.adminUser.temporaryPassword).toBeDefined();

    await app.close();
  });

  it('should return 403 without operator API key', async () => {
    const mockDb = createMockTenantDb();
    const tenantService = new TenantService(mockDb);
    const app = await createTestApp(tenantService, OPERATOR_API_KEY);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tenants',
      payload: {
        name: 'Test Company',
        adminEmail: 'admin@testcompany.com',
      },
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('FORBIDDEN');

    await app.close();
  });

  it('should return 403 with invalid operator API key', async () => {
    const mockDb = createMockTenantDb();
    const tenantService = new TenantService(mockDb);
    const app = await createTestApp(tenantService, OPERATOR_API_KEY);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tenants',
      headers: {
        'x-operator-key': 'wrong-key',
      },
      payload: {
        name: 'Test Company',
        adminEmail: 'admin@testcompany.com',
      },
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('FORBIDDEN');

    await app.close();
  });

  it('should return 400 for missing name', async () => {
    const mockDb = createMockTenantDb();
    const tenantService = new TenantService(mockDb);
    const app = await createTestApp(tenantService, OPERATOR_API_KEY);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tenants',
      headers: {
        'x-operator-key': OPERATOR_API_KEY,
      },
      payload: {
        adminEmail: 'admin@testcompany.com',
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('VALIDATION_ERROR');

    await app.close();
  });

  it('should return 400 for missing adminEmail', async () => {
    const mockDb = createMockTenantDb();
    const tenantService = new TenantService(mockDb);
    const app = await createTestApp(tenantService, OPERATOR_API_KEY);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tenants',
      headers: {
        'x-operator-key': OPERATOR_API_KEY,
      },
      payload: {
        name: 'Test Company',
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('VALIDATION_ERROR');

    await app.close();
  });

  it('should return 400 for invalid email format', async () => {
    const mockDb = createMockTenantDb();
    const tenantService = new TenantService(mockDb);
    const app = await createTestApp(tenantService, OPERATOR_API_KEY);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tenants',
      headers: {
        'x-operator-key': OPERATOR_API_KEY,
      },
      payload: {
        name: 'Test Company',
        adminEmail: 'not-an-email',
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('VALIDATION_ERROR');

    await app.close();
  });

  it('should return 403 when no operator key is configured', async () => {
    const mockDb = createMockTenantDb();
    const tenantService = new TenantService(mockDb);
    // No operator key configured
    const app = await createTestApp(tenantService, undefined);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tenants',
      headers: {
        'x-operator-key': 'any-key',
      },
      payload: {
        name: 'Test Company',
        adminEmail: 'admin@testcompany.com',
      },
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('FORBIDDEN');

    await app.close();
  });
});

// ============================================================================
// GET /api/v1/tenants/:tenantId Tests
// ============================================================================

describe('GET /api/v1/tenants/:tenantId', () => {
  it('should return 200 with tenant details for operator', async () => {
    const tenantId = '550e8400-e29b-41d4-a716-446655440000';
    const mockDb = createMockTenantDb({
      findTenantById: async (id) => ({
        id,
        name: 'Test Tenant',
        wsEndpoint: `ws://localhost:3000/ws/tenant/${id}`,
        apiKey: 'secret-api-key',
        createdAt: new Date(),
        updatedAt: new Date(),
        settings: { titleSharingEnabled: false },
      }),
    });
    const tenantService = new TenantService(mockDb);
    const app = await createTestApp(tenantService, OPERATOR_API_KEY);

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${tenantId}`,
      headers: {
        'x-operator-key': OPERATOR_API_KEY,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.id).toBe(tenantId);
    expect(body.name).toBe('Test Tenant');
    expect(body.wsEndpoint).toBeDefined();
    // Operator should see API key
    expect(body.apiKey).toBe('secret-api-key');

    await app.close();
  });

  it('should return 200 without API key for tenant admin', async () => {
    const tenantId = '550e8400-e29b-41d4-a716-446655440000';
    const mockDb = createMockTenantDb({
      findTenantById: async (id) => ({
        id,
        name: 'Test Tenant',
        wsEndpoint: `ws://localhost:3000/ws/tenant/${id}`,
        apiKey: 'secret-api-key',
        createdAt: new Date(),
        updatedAt: new Date(),
        settings: { titleSharingEnabled: false },
      }),
    });
    const tenantService = new TenantService(mockDb);
    const app = await createTestApp(tenantService, OPERATOR_API_KEY);

    // Create JWT for the same tenant
    const token = app.jwt.sign({
      userId: 'user-123',
      tenantId: tenantId,
      email: 'admin@test.com',
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${tenantId}`,
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.id).toBe(tenantId);
    expect(body.name).toBe('Test Tenant');
    // Tenant admin should NOT see API key
    expect(body.apiKey).toBeUndefined();

    await app.close();
  });

  it('should return 404 for non-existent tenant', async () => {
    const mockDb = createMockTenantDb({
      findTenantById: async () => null,
    });
    const tenantService = new TenantService(mockDb);
    const app = await createTestApp(tenantService, OPERATOR_API_KEY);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants/550e8400-e29b-41d4-a716-446655440000',
      headers: {
        'x-operator-key': OPERATOR_API_KEY,
      },
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('NOT_FOUND');

    await app.close();
  });

  it('should return 400 for invalid tenant ID format', async () => {
    const mockDb = createMockTenantDb();
    const tenantService = new TenantService(mockDb);
    const app = await createTestApp(tenantService, OPERATOR_API_KEY);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants/not-a-uuid',
      headers: {
        'x-operator-key': OPERATOR_API_KEY,
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('VALIDATION_ERROR');

    await app.close();
  });

  it('should return 403 without authorization', async () => {
    const mockDb = createMockTenantDb();
    const tenantService = new TenantService(mockDb);
    const app = await createTestApp(tenantService, OPERATOR_API_KEY);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants/550e8400-e29b-41d4-a716-446655440000',
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('FORBIDDEN');

    await app.close();
  });

  it('should return 403 for tenant admin accessing different tenant', async () => {
    const mockDb = createMockTenantDb({
      findTenantById: async (id) => ({
        id,
        name: 'Test Tenant',
        wsEndpoint: `ws://localhost:3000/ws/tenant/${id}`,
        apiKey: 'secret-api-key',
        createdAt: new Date(),
        updatedAt: new Date(),
        settings: null,
      }),
    });
    const tenantService = new TenantService(mockDb);
    const app = await createTestApp(tenantService, OPERATOR_API_KEY);

    // Create JWT for a different tenant
    const token = app.jwt.sign({
      userId: 'user-123',
      tenantId: '660e8400-e29b-41d4-a716-446655440000', // Different tenant
      email: 'admin@test.com',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants/550e8400-e29b-41d4-a716-446655440000',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('FORBIDDEN');

    await app.close();
  });
});
