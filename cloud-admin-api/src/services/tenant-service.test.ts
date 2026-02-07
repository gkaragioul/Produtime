/**
 * Tenant Service Tests
 * Property-based tests and unit tests for tenant service.
 * 
 * Feature: cloud-admin-console
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { 
  TenantService, 
  TenantDatabase, 
  Tenant, 
  TENANT_CONSTANTS 
} from './tenant-service';

// ============================================================================
// Mock Database Factory
// ============================================================================

const createMockDb = (): TenantDatabase & { 
  tenants: Map<string, Tenant>;
  admins: Map<string, { id: string; tenantId: string; email: string }>;
} => {
  const tenants = new Map<string, Tenant>();
  const admins = new Map<string, { id: string; tenantId: string; email: string }>();
  
  return {
    tenants,
    admins,
    
    createTenant: async (tenant) => {
      const newTenant: Tenant = {
        id: tenant.id,
        name: tenant.name,
        wsEndpoint: tenant.wsEndpoint,
        apiKey: tenant.apiKey,
        createdAt: new Date(),
        updatedAt: new Date(),
        settings: tenant.settings ? JSON.parse(tenant.settings) : null,
      };
      tenants.set(tenant.id, newTenant);
      return newTenant;
    },
    
    findTenantById: async (tenantId) => tenants.get(tenantId) || null,
    
    findTenantByApiKey: async (apiKey) => {
      for (const tenant of tenants.values()) {
        if (tenant.apiKey === apiKey) return tenant;
      }
      return null;
    },
    
    findTenantByWsEndpoint: async (wsEndpoint) => {
      for (const tenant of tenants.values()) {
        if (tenant.wsEndpoint === wsEndpoint) return tenant;
      }
      return null;
    },
    
    updateTenant: async (tenantId, updates) => {
      const tenant = tenants.get(tenantId);
      if (!tenant) throw new Error('Tenant not found');
      const updated: Tenant = { 
        ...tenant, 
        name: updates.name ?? tenant.name,
        settings: updates.settings ? JSON.parse(updates.settings) : tenant.settings,
        updatedAt: new Date() 
      };
      tenants.set(tenantId, updated);
      return updated;
    },
    
    createAdminUser: async (admin) => {
      admins.set(admin.id, { id: admin.id, tenantId: admin.tenantId, email: admin.email });
      return { id: admin.id, email: admin.email };
    },
    
    findAdminByEmail: async (tenantId, email) => {
      for (const admin of admins.values()) {
        if (admin.tenantId === tenantId && admin.email === email) {
          return { id: admin.id, email: admin.email };
        }
      }
      return null;
    },
    
    countTenants: async () => tenants.size,
    
    getAllTenantIds: async () => Array.from(tenants.keys()),
    
    getAllApiKeys: async () => Array.from(tenants.values()).map(t => t.apiKey),
    
    getAllWsEndpoints: async () => Array.from(tenants.values()).map(t => t.wsEndpoint),
  };
};

// ============================================================================
// Property 2: Tenant ID Uniqueness
// *For any* set of created tenants, all Tenant_IDs SHALL be unique (no duplicates).
// **Validates: Requirements 1.2**
// ============================================================================

describe('Property 2: Tenant ID Uniqueness', () => {
  /**
   * Feature: cloud-admin-console, Property 2: Tenant ID Uniqueness
   * For any number of tenant creations, all generated tenant IDs must be unique.
   */
  it('should generate unique tenant IDs for any number of tenant creations', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate a list of tenant creation requests (1-5 tenants to reduce bcrypt overhead)
        fc.array(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 100 }),
            email: fc.emailAddress(),
          }),
          { minLength: 1, maxLength: 5 }
        ),
        async (tenantRequests) => {
          const mockDb = createMockDb();
          const tenantService = new TenantService(mockDb);
          
          const createdTenantIds: string[] = [];
          
          // Create all tenants
          for (const request of tenantRequests) {
            const result = await tenantService.createTenant(request.name, request.email);
            createdTenantIds.push(result.tenantId);
          }
          
          // Verify all tenant IDs are unique
          const uniqueIds = new Set(createdTenantIds);
          expect(uniqueIds.size).toBe(createdTenantIds.length);
          
          // Verify all IDs are valid UUIDs
          for (const id of createdTenantIds) {
            expect(TenantService.isValidTenantId(id)).toBe(true);
          }
        }
      ),
      // Reduced runs due to bcrypt being intentionally slow
      { numRuns: 10 }
    );
  }, 120000);

  it('should generate valid UUID format for tenant IDs', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.emailAddress(),
        async (name, email) => {
          const mockDb = createMockDb();
          const tenantService = new TenantService(mockDb);
          
          const result = await tenantService.createTenant(name, email);
          
          // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
          const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          expect(result.tenantId).toMatch(uuidPattern);
        }
      ),
      // Reduced runs due to bcrypt being intentionally slow
      { numRuns: 10 }
    );
  }, 120000);
});

// ============================================================================
// Property 24: Tenant Credential Uniqueness
// *For any* set of created tenants, all API keys and WebSocket endpoints SHALL be unique.
// **Validates: Requirements 10.1, 10.4**
// ============================================================================

describe('Property 24: Tenant Credential Uniqueness', () => {
  /**
   * Feature: cloud-admin-console, Property 24: Tenant Credential Uniqueness
   * For any number of tenant creations, all API keys must be unique.
   */
  it('should generate unique API keys for any number of tenant creations', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 100 }),
            email: fc.emailAddress(),
          }),
          { minLength: 1, maxLength: 5 }
        ),
        async (tenantRequests) => {
          const mockDb = createMockDb();
          const tenantService = new TenantService(mockDb);
          
          const apiKeys: string[] = [];
          
          for (const request of tenantRequests) {
            const result = await tenantService.createTenant(request.name, request.email);
            apiKeys.push(result.apiKey);
          }
          
          // Verify all API keys are unique
          const uniqueKeys = new Set(apiKeys);
          expect(uniqueKeys.size).toBe(apiKeys.length);
          
          // Verify all API keys have valid format (64 hex chars)
          for (const key of apiKeys) {
            expect(TenantService.isValidApiKeyFormat(key)).toBe(true);
          }
        }
      ),
      // Reduced runs due to bcrypt being intentionally slow
      { numRuns: 10 }
    );
  }, 120000);

  /**
   * Feature: cloud-admin-console, Property 24: Tenant Credential Uniqueness
   * For any number of tenant creations, all WebSocket endpoints must be unique.
   */
  it('should generate unique WebSocket endpoints for any number of tenant creations', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 100 }),
            email: fc.emailAddress(),
          }),
          { minLength: 1, maxLength: 5 }
        ),
        async (tenantRequests) => {
          const mockDb = createMockDb();
          const tenantService = new TenantService(mockDb);
          
          const wsEndpoints: string[] = [];
          
          for (const request of tenantRequests) {
            const result = await tenantService.createTenant(request.name, request.email);
            wsEndpoints.push(result.wsEndpoint);
          }
          
          // Verify all WebSocket endpoints are unique
          const uniqueEndpoints = new Set(wsEndpoints);
          expect(uniqueEndpoints.size).toBe(wsEndpoints.length);
          
          // Verify all endpoints have valid format
          for (const endpoint of wsEndpoints) {
            expect(TenantService.isValidWsEndpointFormat(endpoint)).toBe(true);
          }
        }
      ),
      // Reduced runs due to bcrypt being intentionally slow
      { numRuns: 10 }
    );
  }, 120000);

  it('should generate API keys with correct length', () => {
    // API key should be 64 hex characters (32 bytes)
    const apiKey = TenantService.generateApiKey();
    expect(apiKey.length).toBe(64);
    expect(/^[a-f0-9]{64}$/i.test(apiKey)).toBe(true);
  });

  it('should generate WebSocket endpoints containing tenant ID', async () => {
    const mockDb = createMockDb();
    const tenantService = new TenantService(mockDb);
    
    const result = await tenantService.createTenant('Test Company', 'admin@test.com');
    
    // WebSocket endpoint should contain the tenant ID
    expect(result.wsEndpoint).toContain(result.tenantId);
    expect(result.wsEndpoint.startsWith('ws://') || result.wsEndpoint.startsWith('wss://')).toBe(true);
  });
});

// ============================================================================
// Property 25: Tenant Admin Creation
// *For any* newly created tenant, exactly one admin user SHALL exist with the specified email.
// **Validates: Requirements 10.2**
// ============================================================================

describe('Property 25: Tenant Admin Creation', () => {
  /**
   * Feature: cloud-admin-console, Property 25: Tenant Admin Creation
   * For any tenant creation, exactly one admin user must be created with the specified email.
   */
  it('should create exactly one admin user for any new tenant', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.emailAddress(),
        async (name, email) => {
          const mockDb = createMockDb();
          const tenantService = new TenantService(mockDb);
          
          const result = await tenantService.createTenant(name, email);
          
          // Verify admin user was created
          expect(result.adminUser).toBeDefined();
          expect(result.adminUser.email).toBe(email);
          expect(result.adminUser.id).toBeDefined();
          expect(result.adminUser.temporaryPassword).toBeDefined();
          
          // Verify admin exists in database
          const adminInDb = await mockDb.findAdminByEmail(result.tenantId, email);
          expect(adminInDb).not.toBeNull();
          expect(adminInDb!.email).toBe(email);
          
          // Verify only one admin exists for this tenant
          const adminsForTenant = Array.from(mockDb.admins.values())
            .filter(a => a.tenantId === result.tenantId);
          expect(adminsForTenant.length).toBe(1);
        }
      ),
      // Reduced runs due to bcrypt being intentionally slow
      { numRuns: 10 }
    );
  }, 120000);

  it('should generate temporary password with sufficient entropy', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.emailAddress(),
        async (name, email) => {
          const mockDb = createMockDb();
          const tenantService = new TenantService(mockDb);
          
          const result = await tenantService.createTenant(name, email);
          
          // Temporary password should be 32 hex characters (16 bytes = 128 bits of entropy)
          expect(result.adminUser.temporaryPassword.length).toBe(32);
          expect(/^[a-f0-9]{32}$/i.test(result.adminUser.temporaryPassword)).toBe(true);
        }
      ),
      // Reduced runs due to bcrypt being intentionally slow
      { numRuns: 10 }
    );
  }, 120000);

  it('should create admin with unique ID', async () => {
    const mockDb = createMockDb();
    const tenantService = new TenantService(mockDb);
    
    // Create multiple tenants
    const results = await Promise.all([
      tenantService.createTenant('Company A', 'admin@a.com'),
      tenantService.createTenant('Company B', 'admin@b.com'),
      tenantService.createTenant('Company C', 'admin@c.com'),
    ]);
    
    // All admin IDs should be unique
    const adminIds = results.map(r => r.adminUser.id);
    const uniqueIds = new Set(adminIds);
    expect(uniqueIds.size).toBe(adminIds.length);
  });
});

// ============================================================================
// Unit Tests for Tenant Service
// ============================================================================

describe('TenantService Unit Tests', () => {
  describe('createTenant', () => {
    it('should create tenant with all required fields', async () => {
      const mockDb = createMockDb();
      const tenantService = new TenantService(mockDb);
      
      const result = await tenantService.createTenant('Test Company', 'admin@test.com');
      
      expect(result.tenantId).toBeDefined();
      expect(result.name).toBe('Test Company');
      expect(result.wsEndpoint).toBeDefined();
      expect(result.apiKey).toBeDefined();
      expect(result.adminUser.email).toBe('admin@test.com');
      expect(result.adminUser.temporaryPassword).toBeDefined();
    });

    it('should store tenant in database', async () => {
      const mockDb = createMockDb();
      const tenantService = new TenantService(mockDb);
      
      const result = await tenantService.createTenant('Test Company', 'admin@test.com');
      
      const storedTenant = await mockDb.findTenantById(result.tenantId);
      expect(storedTenant).not.toBeNull();
      expect(storedTenant!.name).toBe('Test Company');
    });
  });

  describe('getTenant', () => {
    it('should return tenant by ID', async () => {
      const mockDb = createMockDb();
      const tenantService = new TenantService(mockDb);
      
      const created = await tenantService.createTenant('Test Company', 'admin@test.com');
      const retrieved = await tenantService.getTenant(created.tenantId);
      
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.tenantId);
      expect(retrieved!.name).toBe('Test Company');
    });

    it('should return null for non-existent tenant', async () => {
      const mockDb = createMockDb();
      const tenantService = new TenantService(mockDb);
      
      const result = await tenantService.getTenant('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('getTenantByApiKey', () => {
    it('should return tenant by API key', async () => {
      const mockDb = createMockDb();
      const tenantService = new TenantService(mockDb);
      
      const created = await tenantService.createTenant('Test Company', 'admin@test.com');
      const retrieved = await tenantService.getTenantByApiKey(created.apiKey);
      
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.tenantId);
    });
  });

  describe('static methods', () => {
    it('generateApiKey should produce valid format', () => {
      const apiKey = TenantService.generateApiKey();
      expect(TenantService.isValidApiKeyFormat(apiKey)).toBe(true);
    });

    it('generateWsEndpoint should produce valid format', () => {
      const tenantId = '12345678-1234-1234-1234-123456789012';
      const wsEndpoint = TenantService.generateWsEndpoint(tenantId);
      expect(TenantService.isValidWsEndpointFormat(wsEndpoint)).toBe(true);
    });

    it('generateTemporaryPassword should produce 32 hex chars', () => {
      const password = TenantService.generateTemporaryPassword();
      expect(password.length).toBe(32);
      expect(/^[a-f0-9]{32}$/i.test(password)).toBe(true);
    });

    it('isValidTenantId should validate UUID format', () => {
      expect(TenantService.isValidTenantId('12345678-1234-1234-1234-123456789012')).toBe(true);
      expect(TenantService.isValidTenantId('not-a-uuid')).toBe(false);
      expect(TenantService.isValidTenantId('')).toBe(false);
    });
  });

  describe('constants', () => {
    it('should have correct API key length', () => {
      expect(TENANT_CONSTANTS.API_KEY_LENGTH).toBe(32);
    });

    it('should have correct temporary password length', () => {
      expect(TENANT_CONSTANTS.TEMP_PASSWORD_LENGTH).toBe(16);
    });
  });
});
