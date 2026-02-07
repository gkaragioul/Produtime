/**
 * Tenant Service
 * Handles tenant creation, management, and credential generation.
 * 
 * Requirements:
 * - 1.2: Generate unique Tenant_ID (UUID)
 * - 10.1: Generate unique API credentials
 * - 10.2: Create initial admin user for tenant
 * - 10.4: Generate unique WebSocket endpoint URL
 */

import { randomBytes, randomUUID } from 'crypto';
import { AuthService } from './auth-service';
import { config } from '../config';

// ============================================================================
// Types
// ============================================================================

export interface TenantResult {
  tenantId: string;
  name: string;
  wsEndpoint: string;
  apiKey: string;
  adminUser: {
    id: string;
    email: string;
    temporaryPassword: string;
  };
}

export interface Tenant {
  id: string;
  name: string;
  wsEndpoint: string;
  apiKey: string;
  createdAt: Date;
  updatedAt: Date;
  settings: TenantSettings | null;
}

export interface TenantSettings {
  titleSharingEnabled?: boolean;
  maxDevices?: number;
  timezone?: string;
}

export interface ApiCredentials {
  apiKey: string;
  wsEndpoint: string;
}

// ============================================================================
// Database Interface (to be injected)
// ============================================================================

export interface TenantDatabase {
  createTenant(tenant: {
    id: string;
    name: string;
    wsEndpoint: string;
    apiKey: string;
    settings?: string;
  }): Promise<Tenant>;
  
  findTenantById(tenantId: string): Promise<Tenant | null>;
  findTenantByApiKey(apiKey: string): Promise<Tenant | null>;
  findTenantByWsEndpoint(wsEndpoint: string): Promise<Tenant | null>;
  
  updateTenant(tenantId: string, updates: Partial<{
    name: string;
    settings: string;
  }>): Promise<Tenant>;
  
  createAdminUser(admin: {
    id: string;
    tenantId: string;
    email: string;
    passwordHash: string;
  }): Promise<{ id: string; email: string }>;
  
  findAdminByEmail(tenantId: string, email: string): Promise<{ id: string; email: string } | null>;
  
  countTenants(): Promise<number>;
  getAllTenantIds(): Promise<string[]>;
  getAllApiKeys(): Promise<string[]>;
  getAllWsEndpoints(): Promise<string[]>;
}

// ============================================================================
// Constants
// ============================================================================

const API_KEY_LENGTH = 32; // 32 bytes = 64 hex chars
const TEMP_PASSWORD_LENGTH = 16; // 16 bytes = 32 hex chars
const WS_ENDPOINT_PREFIX = config.nodeEnv === 'production' 
  ? 'wss://api.produtime.cloud/ws/tenant/'
  : 'ws://localhost:3000/ws/tenant/';

// ============================================================================
// Tenant Service Class
// ============================================================================

export class TenantService {
  constructor(private db: TenantDatabase) {}

  /**
   * Create a new tenant with admin user
   * Requirements: 1.2, 10.1, 10.2, 10.4
   */
  async createTenant(name: string, adminEmail: string): Promise<TenantResult> {
    // Requirement 1.2: Generate unique tenant ID (UUID)
    const tenantId = randomUUID();
    
    // Requirement 10.1: Generate unique API key
    const apiKey = TenantService.generateApiKey();
    
    // Requirement 10.4: Generate unique WebSocket endpoint URL
    const wsEndpoint = TenantService.generateWsEndpoint(tenantId);
    
    // Create tenant in database
    const tenant = await this.db.createTenant({
      id: tenantId,
      name,
      wsEndpoint,
      apiKey,
      settings: JSON.stringify({ titleSharingEnabled: false }),
    });
    
    // Requirement 10.2: Create initial admin user with temporary password
    const temporaryPassword = TenantService.generateTemporaryPassword();
    const passwordHash = await AuthService.hashPassword(temporaryPassword);
    
    const adminUser = await this.db.createAdminUser({
      id: randomUUID(),
      tenantId,
      email: adminEmail,
      passwordHash,
    });
    
    return {
      tenantId: tenant.id,
      name: tenant.name,
      wsEndpoint: tenant.wsEndpoint,
      apiKey: tenant.apiKey,
      adminUser: {
        id: adminUser.id,
        email: adminUser.email,
        temporaryPassword,
      },
    };
  }

  /**
   * Get tenant by ID
   */
  async getTenant(tenantId: string): Promise<Tenant | null> {
    return this.db.findTenantById(tenantId);
  }

  /**
   * Get tenant by API key
   */
  async getTenantByApiKey(apiKey: string): Promise<Tenant | null> {
    return this.db.findTenantByApiKey(apiKey);
  }

  /**
   * Update tenant settings
   */
  async updateTenant(
    tenantId: string, 
    updates: Partial<{ name: string; settings: TenantSettings }>
  ): Promise<Tenant> {
    const dbUpdates: Partial<{ name: string; settings: string }> = {};
    
    if (updates.name) {
      dbUpdates.name = updates.name;
    }
    
    if (updates.settings) {
      dbUpdates.settings = JSON.stringify(updates.settings);
    }
    
    return this.db.updateTenant(tenantId, dbUpdates);
  }

  /**
   * Generate new API credentials for a tenant
   * Requirement 10.1
   */
  async regenerateApiCredentials(tenantId: string): Promise<ApiCredentials> {
    const apiKey = TenantService.generateApiKey();
    const wsEndpoint = TenantService.generateWsEndpoint(tenantId);
    
    await this.db.updateTenant(tenantId, {});
    
    return { apiKey, wsEndpoint };
  }

  /**
   * Get WebSocket endpoint for a tenant
   * Requirement 10.4
   */
  getWsEndpoint(tenantId: string): string {
    return TenantService.generateWsEndpoint(tenantId);
  }

  // ============================================================================
  // Static Methods for Generation
  // ============================================================================

  /**
   * Generate a unique API key
   * Requirement 10.1
   */
  static generateApiKey(): string {
    return randomBytes(API_KEY_LENGTH).toString('hex');
  }

  /**
   * Generate a WebSocket endpoint URL for a tenant
   * Requirement 10.4
   */
  static generateWsEndpoint(tenantId: string): string {
    return `${WS_ENDPOINT_PREFIX}${tenantId}`;
  }

  /**
   * Generate a temporary password for new admin users
   * Requirement 10.2
   */
  static generateTemporaryPassword(): string {
    return randomBytes(TEMP_PASSWORD_LENGTH).toString('hex');
  }

  /**
   * Validate API key format
   */
  static isValidApiKeyFormat(apiKey: string): boolean {
    // API key should be 64 hex characters (32 bytes)
    return /^[a-f0-9]{64}$/i.test(apiKey);
  }

  /**
   * Validate WebSocket endpoint format
   */
  static isValidWsEndpointFormat(wsEndpoint: string): boolean {
    // Should start with ws:// or wss:// and contain a UUID
    const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    return (wsEndpoint.startsWith('ws://') || wsEndpoint.startsWith('wss://')) 
      && uuidPattern.test(wsEndpoint);
  }

  /**
   * Validate tenant ID format (UUID)
   */
  static isValidTenantId(tenantId: string): boolean {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidPattern.test(tenantId);
  }
}

// ============================================================================
// Tenant Error Class
// ============================================================================

export type TenantErrorCode =
  | 'TENANT_NOT_FOUND'
  | 'TENANT_EXISTS'
  | 'ADMIN_EXISTS'
  | 'INVALID_TENANT_ID'
  | 'CREATION_FAILED';

export class TenantError extends Error {
  constructor(
    public code: TenantErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'TenantError';
  }
}

// ============================================================================
// Exports for testing
// ============================================================================

export const TENANT_CONSTANTS = {
  API_KEY_LENGTH,
  TEMP_PASSWORD_LENGTH,
  WS_ENDPOINT_PREFIX,
};
