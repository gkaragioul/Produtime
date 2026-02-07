/**
 * Pairing Routes Tests
 * Unit tests for pairing routes.
 * 
 * Feature: cloud-admin-console
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';
import { pairingRoutes } from './pairing';
import { 
  PairingService, 
  PairingError, 
  PairingDatabase,
  StoredPairCode,
  StoredPairRequest,
  StoredDevice,
  TenantInfo
} from '../services/pairing-service';

// ============================================================================
// Test Setup
// ============================================================================

/**
 * Create a mock pairing database for testing
 */
function createMockDb(overrides: Partial<PairingDatabase> = {}): PairingDatabase {
  return {
    createPairCode: async (pairCode) => ({
      id: pairCode.id,
      tenantId: pairCode.tenantId,
      code: pairCode.code,
      expiresAt: pairCode.expiresAt,
      usedAt: null,
      createdAt: new Date(),
    }),
    findPairCode: async () => null,
    findPairCodeByCode: async () => null,
    markPairCodeUsed: async () => {},
    createPairRequest: async (request) => ({
      id: request.id,
      tenantId: request.tenantId,
      deviceId: request.deviceId,
      deviceName: request.deviceName,
      devicePubKey: request.devicePubKey,
      appVersion: request.appVersion,
      osInfo: request.osInfo,
      ip: request.ip,
      status: 'pending' as const,
      createdAt: new Date(),
      expiresAt: request.expiresAt,
      resolvedAt: null,
      resolvedBy: null,
    }),
    findPairRequestById: async () => null,
    findPendingRequests: async () => [],
    updatePairRequestStatus: async (requestId, status, resolvedBy) => ({
      id: requestId,
      tenantId: 'tenant-123',
      deviceId: 'device-123',
      deviceName: 'Test Device',
      devicePubKey: 'test-pub-key',
      appVersion: '1.0.0',
      osInfo: 'Test OS',
      ip: '127.0.0.1',
      status,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      resolvedAt: new Date(),
      resolvedBy,
    }),
    createDevice: async (device) => ({
      id: device.id,
      tenantId: device.tenantId,
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      devicePubKey: device.devicePubKey,
      pairedAt: new Date(),
      status: 'offline',
      appVersion: device.appVersion,
      ip: device.ip,
      revoked: false,
    }),
    findDeviceByDeviceId: async () => null,
    findTenantById: async () => null,
    ...overrides,
  };
}

/**
 * Create a test Fastify instance with pairing routes
 */
async function createTestApp(pairingService: PairingService): Promise<FastifyInstance> {
  const app = Fastify();
  
  await app.register(jwt, {
    secret: 'test-secret',
  });
  
  await app.register(pairingRoutes, { pairingService, prefix: '/api/v1/pairing' });
  
  return app;
}

// ============================================================================
// POST /api/v1/pairing/generate-code Tests
// ============================================================================

describe('POST /api/v1/pairing/generate-code', () => {
  it('should return 201 with pair code on successful generation', async () => {
    const mockDb = createMockDb();
    const pairingService = new PairingService(mockDb);
    const app = await createTestApp(pairingService);

    // Sign a valid admin token
    const validToken = app.jwt.sign({ 
      userId: 'admin-123', 
      tenantId: 'tenant-456', 
      email: 'admin@example.com' 
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/pairing/generate-code',
      headers: {
        authorization: `Bearer ${validToken}`,
      },
      payload: {},
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.code).toBeDefined();
    expect(body.code).toMatch(/^\d{6}$/);
    expect(body.expiresAt).toBeDefined();
    expect(body.tenantId).toBe('tenant-456');

    await app.close();
  });

  it('should return 401 without authentication', async () => {
    const mockDb = createMockDb();
    const pairingService = new PairingService(mockDb);
    const app = await createTestApp(pairingService);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/pairing/generate-code',
      payload: {},
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('UNAUTHORIZED');

    await app.close();
  });

  it('should return 401 with invalid token', async () => {
    const mockDb = createMockDb();
    const pairingService = new PairingService(mockDb);
    const app = await createTestApp(pairingService);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/pairing/generate-code',
      headers: {
        authorization: 'Bearer invalid-token',
      },
      payload: {},
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('UNAUTHORIZED');

    await app.close();
  });
});

// ============================================================================
// POST /api/v1/pairing/request Tests
// ============================================================================

describe('POST /api/v1/pairing/request', () => {
  it('should return 201 with request ID on valid pair code', async () => {
    const mockDb = createMockDb({
      findPairCodeByCode: async (code: string) => ({
        id: 'code-123',
        tenantId: 'tenant-456',
        code,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        usedAt: null,
        createdAt: new Date(),
      }),
    });
    const pairingService = new PairingService(mockDb);
    const app = await createTestApp(pairingService);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/pairing/request',
      payload: {
        pairCode: '123456',
        deviceId: 'device-abc',
        deviceName: 'Test Device',
        devicePubKey: 'test-public-key-hex',
        appVersion: '1.0.0',
        osInfo: 'Windows 10',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.requestId).toBeDefined();
    expect(body.status).toBe('pending');
    expect(body.expiresAt).toBeDefined();

    await app.close();
  });

  it('should return 400 for invalid pair code', async () => {
    const mockDb = createMockDb();
    const pairingService = new PairingService(mockDb);
    const app = await createTestApp(pairingService);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/pairing/request',
      payload: {
        pairCode: '999999',
        deviceId: 'device-abc',
        deviceName: 'Test Device',
        devicePubKey: 'test-public-key-hex',
        appVersion: '1.0.0',
        osInfo: 'Windows 10',
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('VALIDATION_ERROR');
    expect(body.message).toBe('Invalid or expired pair code');

    await app.close();
  });

  it('should return 400 for expired pair code', async () => {
    const mockDb = createMockDb({
      findPairCodeByCode: async (code: string) => ({
        id: 'code-123',
        tenantId: 'tenant-456',
        code,
        expiresAt: new Date(Date.now() - 1000), // Expired
        usedAt: null,
        createdAt: new Date(),
      }),
    });
    const pairingService = new PairingService(mockDb);
    const app = await createTestApp(pairingService);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/pairing/request',
      payload: {
        pairCode: '123456',
        deviceId: 'device-abc',
        deviceName: 'Test Device',
        devicePubKey: 'test-public-key-hex',
        appVersion: '1.0.0',
        osInfo: 'Windows 10',
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('VALIDATION_ERROR');
    expect(body.message).toBe('Invalid or expired pair code');

    await app.close();
  });

  it('should return 400 for invalid pair code format', async () => {
    const mockDb = createMockDb();
    const pairingService = new PairingService(mockDb);
    const app = await createTestApp(pairingService);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/pairing/request',
      payload: {
        pairCode: 'abc', // Invalid format
        deviceId: 'device-abc',
        deviceName: 'Test Device',
        devicePubKey: 'test-public-key-hex',
        appVersion: '1.0.0',
        osInfo: 'Windows 10',
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('VALIDATION_ERROR');

    await app.close();
  });

  it('should return 400 for missing required fields', async () => {
    const mockDb = createMockDb();
    const pairingService = new PairingService(mockDb);
    const app = await createTestApp(pairingService);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/pairing/request',
      payload: {
        pairCode: '123456',
        // Missing other required fields
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('VALIDATION_ERROR');

    await app.close();
  });
});

// ============================================================================
// POST /api/v1/pairing/approve/:requestId Tests
// ============================================================================

describe('POST /api/v1/pairing/approve/:requestId', () => {
  it('should return 200 with approval result on success', async () => {
    const mockDb = createMockDb({
      findPairRequestById: async (requestId: string) => ({
        id: requestId,
        tenantId: 'tenant-456',
        deviceId: 'device-abc',
        deviceName: 'Test Device',
        devicePubKey: 'test-pub-key',
        appVersion: '1.0.0',
        osInfo: 'Windows 10',
        ip: '127.0.0.1',
        status: 'pending' as const,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        resolvedAt: null,
        resolvedBy: null,
      }),
      findTenantById: async (tenantId: string) => ({
        id: tenantId,
        wsEndpoint: 'wss://api.example.com/ws/tenant/' + tenantId,
      }),
    });
    const pairingService = new PairingService(mockDb);
    const app = await createTestApp(pairingService);

    const validToken = app.jwt.sign({ 
      userId: 'admin-123', 
      tenantId: 'tenant-456', 
      email: 'admin@example.com' 
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/pairing/approve/550e8400-e29b-41d4-a716-446655440000',
      headers: {
        authorization: `Bearer ${validToken}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.wsEndpoint).toBeDefined();
    expect(body.adminPubKey).toBeDefined();
    expect(body.sessionToken).toBeDefined();

    await app.close();
  });

  it('should return 401 without authentication', async () => {
    const mockDb = createMockDb();
    const pairingService = new PairingService(mockDb);
    const app = await createTestApp(pairingService);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/pairing/approve/550e8400-e29b-41d4-a716-446655440000',
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('UNAUTHORIZED');

    await app.close();
  });

  it('should return 404 for non-existent request', async () => {
    const mockDb = createMockDb();
    const pairingService = new PairingService(mockDb);
    const app = await createTestApp(pairingService);

    const validToken = app.jwt.sign({ 
      userId: 'admin-123', 
      tenantId: 'tenant-456', 
      email: 'admin@example.com' 
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/pairing/approve/550e8400-e29b-41d4-a716-446655440000',
      headers: {
        authorization: `Bearer ${validToken}`,
      },
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('NOT_FOUND');

    await app.close();
  });

  it('should return 400 for invalid request ID format', async () => {
    const mockDb = createMockDb();
    const pairingService = new PairingService(mockDb);
    const app = await createTestApp(pairingService);

    const validToken = app.jwt.sign({ 
      userId: 'admin-123', 
      tenantId: 'tenant-456', 
      email: 'admin@example.com' 
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/pairing/approve/invalid-uuid',
      headers: {
        authorization: `Bearer ${validToken}`,
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('VALIDATION_ERROR');

    await app.close();
  });
});

// ============================================================================
// POST /api/v1/pairing/deny/:requestId Tests
// ============================================================================

describe('POST /api/v1/pairing/deny/:requestId', () => {
  it('should return 200 on successful denial', async () => {
    const mockDb = createMockDb({
      findPairRequestById: async (requestId: string) => ({
        id: requestId,
        tenantId: 'tenant-456',
        deviceId: 'device-abc',
        deviceName: 'Test Device',
        devicePubKey: 'test-pub-key',
        appVersion: '1.0.0',
        osInfo: 'Windows 10',
        ip: '127.0.0.1',
        status: 'pending' as const,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        resolvedAt: null,
        resolvedBy: null,
      }),
    });
    const pairingService = new PairingService(mockDb);
    const app = await createTestApp(pairingService);

    const validToken = app.jwt.sign({ 
      userId: 'admin-123', 
      tenantId: 'tenant-456', 
      email: 'admin@example.com' 
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/pairing/deny/550e8400-e29b-41d4-a716-446655440000',
      headers: {
        authorization: `Bearer ${validToken}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.message).toBe('Pairing request denied');

    await app.close();
  });

  it('should return 401 without authentication', async () => {
    const mockDb = createMockDb();
    const pairingService = new PairingService(mockDb);
    const app = await createTestApp(pairingService);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/pairing/deny/550e8400-e29b-41d4-a716-446655440000',
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('UNAUTHORIZED');

    await app.close();
  });

  it('should return 404 for non-existent request', async () => {
    const mockDb = createMockDb();
    const pairingService = new PairingService(mockDb);
    const app = await createTestApp(pairingService);

    const validToken = app.jwt.sign({ 
      userId: 'admin-123', 
      tenantId: 'tenant-456', 
      email: 'admin@example.com' 
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/pairing/deny/550e8400-e29b-41d4-a716-446655440000',
      headers: {
        authorization: `Bearer ${validToken}`,
      },
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('NOT_FOUND');

    await app.close();
  });
});

// ============================================================================
// GET /api/v1/pairing/pending Tests
// ============================================================================

describe('GET /api/v1/pairing/pending', () => {
  it('should return 200 with pending requests', async () => {
    const mockDb = createMockDb({
      findPendingRequests: async (tenantId: string) => [
        {
          id: 'request-1',
          tenantId,
          deviceId: 'device-1',
          deviceName: 'Device 1',
          devicePubKey: 'pub-key-1',
          appVersion: '1.0.0',
          osInfo: 'Windows 10',
          ip: '192.168.1.1',
          status: 'pending' as const,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          resolvedAt: null,
          resolvedBy: null,
        },
        {
          id: 'request-2',
          tenantId,
          deviceId: 'device-2',
          deviceName: 'Device 2',
          devicePubKey: 'pub-key-2',
          appVersion: '1.0.1',
          osInfo: 'macOS',
          ip: '192.168.1.2',
          status: 'pending' as const,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          resolvedAt: null,
          resolvedBy: null,
        },
      ],
    });
    const pairingService = new PairingService(mockDb);
    const app = await createTestApp(pairingService);

    const validToken = app.jwt.sign({ 
      userId: 'admin-123', 
      tenantId: 'tenant-456', 
      email: 'admin@example.com' 
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/pairing/pending',
      headers: {
        authorization: `Bearer ${validToken}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.requests).toBeDefined();
    expect(body.requests.length).toBe(2);
    expect(body.count).toBe(2);

    await app.close();
  });

  it('should return 200 with empty array when no pending requests', async () => {
    const mockDb = createMockDb();
    const pairingService = new PairingService(mockDb);
    const app = await createTestApp(pairingService);

    const validToken = app.jwt.sign({ 
      userId: 'admin-123', 
      tenantId: 'tenant-456', 
      email: 'admin@example.com' 
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/pairing/pending',
      headers: {
        authorization: `Bearer ${validToken}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.requests).toEqual([]);
    expect(body.count).toBe(0);

    await app.close();
  });

  it('should return 401 without authentication', async () => {
    const mockDb = createMockDb();
    const pairingService = new PairingService(mockDb);
    const app = await createTestApp(pairingService);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/pairing/pending',
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('UNAUTHORIZED');

    await app.close();
  });
});
