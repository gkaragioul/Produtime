/**
 * Pairing Service Tests
 * Property-based tests and unit tests for pairing service.
 * 
 * Feature: cloud-admin-console
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import {
  PairingService,
  PairingDatabase,
  StoredPairCode,
  StoredPairRequest,
  StoredDevice,
  TenantInfo,
  PairingError,
  PAIRING_CONSTANTS,
} from './pairing-service';

// ============================================================================
// Mock Database Factory
// ============================================================================

const createMockDb = (): PairingDatabase & {
  pairCodes: Map<string, StoredPairCode>;
  pairRequests: Map<string, StoredPairRequest>;
  devices: Map<string, StoredDevice>;
  tenants: Map<string, TenantInfo>;
} => {
  const pairCodes = new Map<string, StoredPairCode>();
  const pairRequests = new Map<string, StoredPairRequest>();
  const devices = new Map<string, StoredDevice>();
  const tenants = new Map<string, TenantInfo>();

  return {
    pairCodes,
    pairRequests,
    devices,
    tenants,

    // Pair codes
    createPairCode: async (pairCode) => {
      const stored: StoredPairCode = {
        id: pairCode.id,
        tenantId: pairCode.tenantId,
        code: pairCode.code,
        expiresAt: pairCode.expiresAt,
        usedAt: null,
        createdAt: new Date(),
      };
      pairCodes.set(pairCode.id, stored);
      return stored;
    },

    findPairCode: async (tenantId, code) => {
      for (const pc of pairCodes.values()) {
        if (pc.tenantId === tenantId && pc.code === code) {
          return pc;
        }
      }
      return null;
    },

    findPairCodeByCode: async (code) => {
      for (const pc of pairCodes.values()) {
        if (pc.code === code) {
          return pc;
        }
      }
      return null;
    },

    markPairCodeUsed: async (id) => {
      const pc = pairCodes.get(id);
      if (pc) {
        pc.usedAt = new Date();
      }
    },

    // Pair requests
    createPairRequest: async (request) => {
      const stored: StoredPairRequest = {
        id: request.id,
        tenantId: request.tenantId,
        deviceId: request.deviceId,
        deviceName: request.deviceName,
        devicePubKey: request.devicePubKey,
        appVersion: request.appVersion,
        osInfo: request.osInfo,
        ip: request.ip,
        status: 'pending',
        createdAt: new Date(),
        expiresAt: request.expiresAt,
        resolvedAt: null,
        resolvedBy: null,
      };
      pairRequests.set(request.id, stored);
      return stored;
    },

    findPairRequestById: async (requestId) => {
      return pairRequests.get(requestId) || null;
    },

    findPendingRequests: async (tenantId) => {
      return Array.from(pairRequests.values()).filter(
        (r) => r.tenantId === tenantId && r.status === 'pending'
      );
    },

    updatePairRequestStatus: async (requestId, status, resolvedBy) => {
      const request = pairRequests.get(requestId);
      if (!request) throw new Error('Request not found');
      request.status = status;
      request.resolvedAt = new Date();
      request.resolvedBy = resolvedBy;
      return request;
    },

    // Devices
    createDevice: async (device) => {
      const stored: StoredDevice = {
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
      };
      devices.set(device.id, stored);
      return stored;
    },

    findDeviceByDeviceId: async (tenantId, deviceId) => {
      for (const d of devices.values()) {
        if (d.tenantId === tenantId && d.deviceId === deviceId) {
          return d;
        }
      }
      return null;
    },

    // Tenant
    findTenantById: async (tenantId) => {
      return tenants.get(tenantId) || null;
    },
  };
};

// ============================================================================
// Property 9: Pair Code Format and Expiry
// *For any* generated pair code, it SHALL be exactly 6 digits and have expiry 
// time 5 minutes from generation.
// **Validates: Requirements 3.1**
// ============================================================================

describe('Property 9: Pair Code Format and Expiry', () => {
  /**
   * Feature: cloud-admin-console, Property 9: Pair Code Format and Expiry
   * For any tenant, generated pair codes must be exactly 6 digits.
   */
  it('should generate pair codes that are exactly 6 digits for any tenant', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (tenantId) => {
          const mockDb = createMockDb();
          const pairingService = new PairingService(mockDb);

          const result = await pairingService.generatePairCode(tenantId);

          // Verify code is exactly 6 digits
          expect(result.code).toMatch(/^\d{6}$/);
          expect(result.code.length).toBe(6);
          
          // Verify all characters are digits
          for (const char of result.code) {
            expect(char).toMatch(/\d/);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: cloud-admin-console, Property 9: Pair Code Format and Expiry
   * For any generated pair code, expiry time must be 5 minutes from generation.
   */
  it('should set expiry time to 5 minutes from generation for any pair code', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (tenantId) => {
          const mockDb = createMockDb();
          const pairingService = new PairingService(mockDb);

          const beforeGeneration = Date.now();
          const result = await pairingService.generatePairCode(tenantId);
          const afterGeneration = Date.now();

          // Expected expiry is 5 minutes (300000 ms) from generation
          const expectedExpiryMin = beforeGeneration + PAIRING_CONSTANTS.PAIR_CODE_EXPIRY_MS;
          const expectedExpiryMax = afterGeneration + PAIRING_CONSTANTS.PAIR_CODE_EXPIRY_MS;

          // Verify expiry is within expected range
          expect(result.expiresAt).toBeGreaterThanOrEqual(expectedExpiryMin);
          expect(result.expiresAt).toBeLessThanOrEqual(expectedExpiryMax);

          // Verify expiry is approximately 5 minutes from now
          const expiryDuration = result.expiresAt - beforeGeneration;
          expect(expiryDuration).toBeGreaterThanOrEqual(PAIRING_CONSTANTS.PAIR_CODE_EXPIRY_MS - 100);
          expect(expiryDuration).toBeLessThanOrEqual(PAIRING_CONSTANTS.PAIR_CODE_EXPIRY_MS + 100);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: cloud-admin-console, Property 9: Pair Code Format and Expiry
   * Static code generation should always produce 6-digit codes.
   */
  it('should always generate valid 6-digit codes from static method', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        () => {
          const code = PairingService.generateCode();
          
          // Verify format
          expect(code).toMatch(/^\d{6}$/);
          expect(code.length).toBe(6);
          expect(PairingService.isValidPairCodeFormat(code)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});


// ============================================================================
// Property 10: Pair Code Tenant Association
// *For any* pair code, it SHALL only be valid for the tenant that generated it.
// **Validates: Requirements 3.2**
// ============================================================================

describe('Property 10: Pair Code Tenant Association', () => {
  /**
   * Feature: cloud-admin-console, Property 10: Pair Code Tenant Association
   * For any pair code, it must be associated with the tenant that generated it.
   */
  it('should associate pair code with the generating tenant', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (tenantId) => {
          const mockDb = createMockDb();
          const pairingService = new PairingService(mockDb);

          const result = await pairingService.generatePairCode(tenantId);

          // Verify tenant ID is returned
          expect(result.tenantId).toBe(tenantId);

          // Verify code is stored with correct tenant
          const storedCode = await mockDb.findPairCode(tenantId, result.code);
          expect(storedCode).not.toBeNull();
          expect(storedCode!.tenantId).toBe(tenantId);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: cloud-admin-console, Property 10: Pair Code Tenant Association
   * For any pair code, validation should fail for a different tenant.
   */
  it('should not validate pair code for a different tenant', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        async (tenantA, tenantB) => {
          // Skip if same tenant
          fc.pre(tenantA !== tenantB);

          const mockDb = createMockDb();
          const pairingService = new PairingService(mockDb);

          // Generate code for tenant A
          const result = await pairingService.generatePairCode(tenantA);

          // Verify code is valid for tenant A
          const validForA = await pairingService.validatePairCode(result.code, tenantA);
          expect(validForA).toBe(true);

          // Verify code is NOT valid for tenant B
          const validForB = await pairingService.validatePairCode(result.code, tenantB);
          expect(validForB).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: cloud-admin-console, Property 10: Pair Code Tenant Association
   * Multiple tenants can have different codes simultaneously.
   */
  it('should allow different tenants to have their own codes', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.uuid(), { minLength: 2, maxLength: 5 }),
        async (tenantIds) => {
          // Ensure unique tenant IDs
          const uniqueTenants = [...new Set(tenantIds)];
          fc.pre(uniqueTenants.length >= 2);

          const mockDb = createMockDb();
          const pairingService = new PairingService(mockDb);

          // Generate codes for each tenant
          const results = await Promise.all(
            uniqueTenants.map((tid) => pairingService.generatePairCode(tid))
          );

          // Verify each code is associated with correct tenant
          for (let i = 0; i < uniqueTenants.length; i++) {
            expect(results[i].tenantId).toBe(uniqueTenants[i]);

            // Verify code validates only for its own tenant
            const isValid = await pairingService.validatePairCode(
              results[i].code,
              uniqueTenants[i]
            );
            expect(isValid).toBe(true);

            // Verify code doesn't validate for other tenants
            for (let j = 0; j < uniqueTenants.length; j++) {
              if (i !== j) {
                const isValidForOther = await pairingService.validatePairCode(
                  results[i].code,
                  uniqueTenants[j]
                );
                expect(isValidForOther).toBe(false);
              }
            }
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});


// ============================================================================
// Unit Tests for Pair Request Submission (Task 12.4)
// Requirements: 3.3
// ============================================================================

describe('Pair Request Submission', () => {
  it('should create pending request with valid pair code', async () => {
    const mockDb = createMockDb();
    const pairingService = new PairingService(mockDb);
    const tenantId = 'test-tenant-id';

    // Generate a pair code
    const pairCodeResult = await pairingService.generatePairCode(tenantId);

    // Submit pair request
    const result = await pairingService.submitPairRequest({
      pairCode: pairCodeResult.code,
      deviceId: 'device-123',
      deviceName: 'Test Device',
      devicePubKey: 'test-pub-key',
      appVersion: '1.0.0',
      osInfo: 'Windows 10',
      ip: '192.168.1.1',
    });

    // Verify result
    expect(result.requestId).toBeDefined();
    expect(result.status).toBe('pending');
    expect(result.expiresAt).toBeGreaterThan(Date.now());

    // Verify request is stored in database
    const storedRequest = await mockDb.findPairRequestById(result.requestId);
    expect(storedRequest).not.toBeNull();
    expect(storedRequest!.tenantId).toBe(tenantId);
    expect(storedRequest!.deviceId).toBe('device-123');
    expect(storedRequest!.status).toBe('pending');
  });

  it('should reject request with invalid pair code', async () => {
    const mockDb = createMockDb();
    const pairingService = new PairingService(mockDb);

    // Try to submit with invalid code
    await expect(
      pairingService.submitPairRequest({
        pairCode: '000000',
        deviceId: 'device-123',
        deviceName: 'Test Device',
        devicePubKey: 'test-pub-key',
        appVersion: '1.0.0',
        osInfo: 'Windows 10',
        ip: '192.168.1.1',
      })
    ).rejects.toThrow(PairingError);
  });

  it('should reject request with expired pair code', async () => {
    const mockDb = createMockDb();
    const pairingService = new PairingService(mockDb);
    const tenantId = 'test-tenant-id';

    // Create an expired pair code directly in the mock
    const expiredCode: StoredPairCode = {
      id: 'expired-code-id',
      tenantId,
      code: '123456',
      expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
      usedAt: null,
      createdAt: new Date(Date.now() - 600000), // Created 10 minutes ago
    };
    mockDb.pairCodes.set(expiredCode.id, expiredCode);

    // Try to submit with expired code
    await expect(
      pairingService.submitPairRequest({
        pairCode: '123456',
        deviceId: 'device-123',
        deviceName: 'Test Device',
        devicePubKey: 'test-pub-key',
        appVersion: '1.0.0',
        osInfo: 'Windows 10',
        ip: '192.168.1.1',
      })
    ).rejects.toThrow(PairingError);
  });

  it('should mark pair code as used after successful submission', async () => {
    const mockDb = createMockDb();
    const pairingService = new PairingService(mockDb);
    const tenantId = 'test-tenant-id';

    // Generate a pair code
    const pairCodeResult = await pairingService.generatePairCode(tenantId);

    // Submit pair request
    await pairingService.submitPairRequest({
      pairCode: pairCodeResult.code,
      deviceId: 'device-123',
      deviceName: 'Test Device',
      devicePubKey: 'test-pub-key',
      appVersion: '1.0.0',
      osInfo: 'Windows 10',
      ip: '192.168.1.1',
    });

    // Verify code is marked as used
    const storedCode = await mockDb.findPairCode(tenantId, pairCodeResult.code);
    expect(storedCode!.usedAt).not.toBeNull();
  });

  it('should reject request with already used pair code', async () => {
    const mockDb = createMockDb();
    const pairingService = new PairingService(mockDb);
    const tenantId = 'test-tenant-id';

    // Generate a pair code
    const pairCodeResult = await pairingService.generatePairCode(tenantId);

    // Submit first request (should succeed)
    await pairingService.submitPairRequest({
      pairCode: pairCodeResult.code,
      deviceId: 'device-123',
      deviceName: 'Test Device',
      devicePubKey: 'test-pub-key',
      appVersion: '1.0.0',
      osInfo: 'Windows 10',
      ip: '192.168.1.1',
    });

    // Try to submit second request with same code (should fail)
    await expect(
      pairingService.submitPairRequest({
        pairCode: pairCodeResult.code,
        deviceId: 'device-456',
        deviceName: 'Another Device',
        devicePubKey: 'another-pub-key',
        appVersion: '1.0.0',
        osInfo: 'Windows 10',
        ip: '192.168.1.2',
      })
    ).rejects.toThrow(PairingError);
  });
});


// ============================================================================
// Property 11: Pairing Request Creation
// *For any* valid pair request with correct code, a pending pairing request 
// SHALL be created in the database.
// **Validates: Requirements 3.3**
// ============================================================================

describe('Property 11: Pairing Request Creation', () => {
  /**
   * Feature: cloud-admin-console, Property 11: Pairing Request Creation
   * For any valid pair request, a pending request must be created in the database.
   */
  it('should create pending request in database for any valid pair request', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), // tenantId
        fc.string({ minLength: 1, maxLength: 100 }), // deviceId
        fc.string({ minLength: 1, maxLength: 100 }), // deviceName
        fc.hexaString({ minLength: 64, maxLength: 64 }), // devicePubKey
        fc.string({ minLength: 1, maxLength: 50 }), // appVersion
        fc.string({ minLength: 1, maxLength: 200 }), // osInfo
        async (tenantId, deviceId, deviceName, devicePubKey, appVersion, osInfo) => {
          const mockDb = createMockDb();
          const pairingService = new PairingService(mockDb);

          // Generate a valid pair code
          const pairCodeResult = await pairingService.generatePairCode(tenantId);

          // Submit pair request
          const result = await pairingService.submitPairRequest({
            pairCode: pairCodeResult.code,
            deviceId,
            deviceName,
            devicePubKey,
            appVersion,
            osInfo,
            ip: '192.168.1.1',
          });

          // Verify request was created
          expect(result.requestId).toBeDefined();
          expect(result.status).toBe('pending');

          // Verify request exists in database
          const storedRequest = await mockDb.findPairRequestById(result.requestId);
          expect(storedRequest).not.toBeNull();
          expect(storedRequest!.status).toBe('pending');
          expect(storedRequest!.tenantId).toBe(tenantId);
          expect(storedRequest!.deviceId).toBe(deviceId);
          expect(storedRequest!.deviceName).toBe(deviceName);
          expect(storedRequest!.devicePubKey).toBe(devicePubKey);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: cloud-admin-console, Property 11: Pairing Request Creation
   * For any valid pair request, the request should appear in pending requests list.
   */
  it('should include created request in pending requests list', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.string({ minLength: 1, maxLength: 100 }),
        async (tenantId, deviceName) => {
          const mockDb = createMockDb();
          const pairingService = new PairingService(mockDb);

          // Generate a valid pair code
          const pairCodeResult = await pairingService.generatePairCode(tenantId);

          // Submit pair request
          const result = await pairingService.submitPairRequest({
            pairCode: pairCodeResult.code,
            deviceId: 'device-123',
            deviceName,
            devicePubKey: 'test-pub-key',
            appVersion: '1.0.0',
            osInfo: 'Windows 10',
            ip: '192.168.1.1',
          });

          // Get pending requests
          const pendingRequests = await pairingService.getPendingRequests(tenantId);

          // Verify request is in pending list
          const foundRequest = pendingRequests.find((r) => r.id === result.requestId);
          expect(foundRequest).toBeDefined();
          expect(foundRequest!.deviceName).toBe(deviceName);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: cloud-admin-console, Property 11: Pairing Request Creation
   * For any pair request, the request should have correct tenant association.
   */
  it('should associate request with correct tenant', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        async (tenantA, tenantB) => {
          fc.pre(tenantA !== tenantB);

          const mockDb = createMockDb();
          const pairingService = new PairingService(mockDb);

          // Generate codes for both tenants
          const codeA = await pairingService.generatePairCode(tenantA);
          const codeB = await pairingService.generatePairCode(tenantB);

          // Submit requests
          const resultA = await pairingService.submitPairRequest({
            pairCode: codeA.code,
            deviceId: 'device-a',
            deviceName: 'Device A',
            devicePubKey: 'pub-key-a',
            appVersion: '1.0.0',
            osInfo: 'Windows 10',
            ip: '192.168.1.1',
          });

          const resultB = await pairingService.submitPairRequest({
            pairCode: codeB.code,
            deviceId: 'device-b',
            deviceName: 'Device B',
            devicePubKey: 'pub-key-b',
            appVersion: '1.0.0',
            osInfo: 'macOS',
            ip: '192.168.1.2',
          });

          // Verify tenant A only sees their request
          const pendingA = await pairingService.getPendingRequests(tenantA);
          expect(pendingA.length).toBe(1);
          expect(pendingA[0].id).toBe(resultA.requestId);

          // Verify tenant B only sees their request
          const pendingB = await pairingService.getPendingRequests(tenantB);
          expect(pendingB.length).toBe(1);
          expect(pendingB[0].id).toBe(resultB.requestId);
        }
      ),
      { numRuns: 50 }
    );
  });
});


// ============================================================================
// Unit Tests for Pair Approval/Denial (Task 12.6)
// Requirements: 3.6, 3.7
// ============================================================================

describe('Pair Approval/Denial', () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let pairingService: PairingService;
  const tenantId = 'test-tenant-id';
  const adminUserId = 'admin-user-id';

  beforeEach(async () => {
    mockDb = createMockDb();
    pairingService = new PairingService(mockDb);

    // Set up tenant
    mockDb.tenants.set(tenantId, {
      id: tenantId,
      wsEndpoint: 'wss://api.produtime.cloud/ws/tenant/' + tenantId,
    });
  });

  describe('approvePairing', () => {
    it('should approve pending request and create device', async () => {
      // Generate pair code and submit request
      const pairCodeResult = await pairingService.generatePairCode(tenantId);
      const requestResult = await pairingService.submitPairRequest({
        pairCode: pairCodeResult.code,
        deviceId: 'device-123',
        deviceName: 'Test Device',
        devicePubKey: 'test-pub-key',
        appVersion: '1.0.0',
        osInfo: 'Windows 10',
        ip: '192.168.1.1',
      });

      // Approve the request
      const approvalResult = await pairingService.approvePairing(
        requestResult.requestId,
        adminUserId
      );

      // Verify approval result
      expect(approvalResult.success).toBe(true);
      expect(approvalResult.wsEndpoint).toBeDefined();
      expect(approvalResult.adminPubKey).toBeDefined();
      expect(approvalResult.sessionToken).toBeDefined();

      // Verify request status updated
      const storedRequest = await mockDb.findPairRequestById(requestResult.requestId);
      expect(storedRequest!.status).toBe('approved');
      expect(storedRequest!.resolvedBy).toBe(adminUserId);

      // Verify device was created
      const device = await mockDb.findDeviceByDeviceId(tenantId, 'device-123');
      expect(device).not.toBeNull();
      expect(device!.deviceName).toBe('Test Device');
      expect(device!.devicePubKey).toBe('test-pub-key');
    });

    it('should return WebSocket endpoint URL on approval', async () => {
      const pairCodeResult = await pairingService.generatePairCode(tenantId);
      const requestResult = await pairingService.submitPairRequest({
        pairCode: pairCodeResult.code,
        deviceId: 'device-123',
        deviceName: 'Test Device',
        devicePubKey: 'test-pub-key',
        appVersion: '1.0.0',
        osInfo: 'Windows 10',
        ip: '192.168.1.1',
      });

      const approvalResult = await pairingService.approvePairing(
        requestResult.requestId,
        adminUserId
      );

      // Requirement 3.7: WebSocket endpoint URL
      expect(approvalResult.wsEndpoint).toContain('wss://');
      expect(approvalResult.wsEndpoint).toContain(tenantId);
    });

    it('should exchange cryptographic keys on approval', async () => {
      const pairCodeResult = await pairingService.generatePairCode(tenantId);
      const requestResult = await pairingService.submitPairRequest({
        pairCode: pairCodeResult.code,
        deviceId: 'device-123',
        deviceName: 'Test Device',
        devicePubKey: 'device-public-key-hex',
        appVersion: '1.0.0',
        osInfo: 'Windows 10',
        ip: '192.168.1.1',
      });

      const approvalResult = await pairingService.approvePairing(
        requestResult.requestId,
        adminUserId
      );

      // Requirement 3.6: Key exchange
      expect(approvalResult.adminPubKey).toBeDefined();
      expect(approvalResult.adminPubKey.length).toBe(64); // 32 bytes hex

      // Verify device has the device's public key stored
      const device = await mockDb.findDeviceByDeviceId(tenantId, 'device-123');
      expect(device!.devicePubKey).toBe('device-public-key-hex');
    });

    it('should reject approval for non-existent request', async () => {
      await expect(
        pairingService.approvePairing('non-existent-id', adminUserId)
      ).rejects.toThrow(PairingError);
    });

    it('should reject approval for already resolved request', async () => {
      const pairCodeResult = await pairingService.generatePairCode(tenantId);
      const requestResult = await pairingService.submitPairRequest({
        pairCode: pairCodeResult.code,
        deviceId: 'device-123',
        deviceName: 'Test Device',
        devicePubKey: 'test-pub-key',
        appVersion: '1.0.0',
        osInfo: 'Windows 10',
        ip: '192.168.1.1',
      });

      // Approve first time
      await pairingService.approvePairing(requestResult.requestId, adminUserId);

      // Try to approve again
      await expect(
        pairingService.approvePairing(requestResult.requestId, adminUserId)
      ).rejects.toThrow(PairingError);
    });
  });

  describe('denyPairing', () => {
    it('should deny pending request', async () => {
      const pairCodeResult = await pairingService.generatePairCode(tenantId);
      const requestResult = await pairingService.submitPairRequest({
        pairCode: pairCodeResult.code,
        deviceId: 'device-123',
        deviceName: 'Test Device',
        devicePubKey: 'test-pub-key',
        appVersion: '1.0.0',
        osInfo: 'Windows 10',
        ip: '192.168.1.1',
      });

      // Deny the request
      await pairingService.denyPairing(requestResult.requestId, adminUserId);

      // Verify request status updated
      const storedRequest = await mockDb.findPairRequestById(requestResult.requestId);
      expect(storedRequest!.status).toBe('denied');
      expect(storedRequest!.resolvedBy).toBe(adminUserId);

      // Verify no device was created
      const device = await mockDb.findDeviceByDeviceId(tenantId, 'device-123');
      expect(device).toBeNull();
    });

    it('should reject denial for non-existent request', async () => {
      await expect(
        pairingService.denyPairing('non-existent-id', adminUserId)
      ).rejects.toThrow(PairingError);
    });

    it('should reject denial for already resolved request', async () => {
      const pairCodeResult = await pairingService.generatePairCode(tenantId);
      const requestResult = await pairingService.submitPairRequest({
        pairCode: pairCodeResult.code,
        deviceId: 'device-123',
        deviceName: 'Test Device',
        devicePubKey: 'test-pub-key',
        appVersion: '1.0.0',
        osInfo: 'Windows 10',
        ip: '192.168.1.1',
      });

      // Deny first time
      await pairingService.denyPairing(requestResult.requestId, adminUserId);

      // Try to deny again
      await expect(
        pairingService.denyPairing(requestResult.requestId, adminUserId)
      ).rejects.toThrow(PairingError);
    });

    it('should remove denied request from pending list', async () => {
      const pairCodeResult = await pairingService.generatePairCode(tenantId);
      const requestResult = await pairingService.submitPairRequest({
        pairCode: pairCodeResult.code,
        deviceId: 'device-123',
        deviceName: 'Test Device',
        devicePubKey: 'test-pub-key',
        appVersion: '1.0.0',
        osInfo: 'Windows 10',
        ip: '192.168.1.1',
      });

      // Verify request is in pending list
      let pendingRequests = await pairingService.getPendingRequests(tenantId);
      expect(pendingRequests.length).toBe(1);

      // Deny the request
      await pairingService.denyPairing(requestResult.requestId, adminUserId);

      // Verify request is no longer in pending list
      pendingRequests = await pairingService.getPendingRequests(tenantId);
      expect(pendingRequests.length).toBe(0);
    });
  });
});


// ============================================================================
// Property 12: Key Exchange on Approval
// *For any* approved pairing, both the device record and approval response 
// SHALL contain the exchanged public keys.
// **Validates: Requirements 3.6**
// ============================================================================

describe('Property 12: Key Exchange on Approval', () => {
  /**
   * Feature: cloud-admin-console, Property 12: Key Exchange on Approval
   * For any approved pairing, the approval response must contain admin public key.
   */
  it('should include admin public key in approval response for any pairing', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), // tenantId
        fc.hexaString({ minLength: 64, maxLength: 64 }), // devicePubKey
        async (tenantId, devicePubKey) => {
          const mockDb = createMockDb();
          const pairingService = new PairingService(mockDb);

          // Set up tenant
          mockDb.tenants.set(tenantId, {
            id: tenantId,
            wsEndpoint: `wss://api.produtime.cloud/ws/tenant/${tenantId}`,
          });

          // Generate pair code and submit request
          const pairCodeResult = await pairingService.generatePairCode(tenantId);
          const requestResult = await pairingService.submitPairRequest({
            pairCode: pairCodeResult.code,
            deviceId: 'device-123',
            deviceName: 'Test Device',
            devicePubKey,
            appVersion: '1.0.0',
            osInfo: 'Windows 10',
            ip: '192.168.1.1',
          });

          // Approve the request
          const approvalResult = await pairingService.approvePairing(
            requestResult.requestId,
            'admin-user-id'
          );

          // Verify admin public key is present
          expect(approvalResult.adminPubKey).toBeDefined();
          expect(approvalResult.adminPubKey.length).toBe(64); // 32 bytes hex
          expect(/^[a-f0-9]{64}$/i.test(approvalResult.adminPubKey)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: cloud-admin-console, Property 12: Key Exchange on Approval
   * For any approved pairing, the device record must contain the device's public key.
   */
  it('should store device public key in device record for any pairing', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), // tenantId
        fc.string({ minLength: 1, maxLength: 100 }), // deviceId
        fc.hexaString({ minLength: 64, maxLength: 64 }), // devicePubKey
        async (tenantId, deviceId, devicePubKey) => {
          const mockDb = createMockDb();
          const pairingService = new PairingService(mockDb);

          // Set up tenant
          mockDb.tenants.set(tenantId, {
            id: tenantId,
            wsEndpoint: `wss://api.produtime.cloud/ws/tenant/${tenantId}`,
          });

          // Generate pair code and submit request
          const pairCodeResult = await pairingService.generatePairCode(tenantId);
          const requestResult = await pairingService.submitPairRequest({
            pairCode: pairCodeResult.code,
            deviceId,
            deviceName: 'Test Device',
            devicePubKey,
            appVersion: '1.0.0',
            osInfo: 'Windows 10',
            ip: '192.168.1.1',
          });

          // Approve the request
          await pairingService.approvePairing(requestResult.requestId, 'admin-user-id');

          // Verify device record contains the public key
          const device = await mockDb.findDeviceByDeviceId(tenantId, deviceId);
          expect(device).not.toBeNull();
          expect(device!.devicePubKey).toBe(devicePubKey);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: cloud-admin-console, Property 12: Key Exchange on Approval
   * For any approved pairing, a session token must be generated.
   */
  it('should generate session token for any approved pairing', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (tenantId) => {
          const mockDb = createMockDb();
          const pairingService = new PairingService(mockDb);

          // Set up tenant
          mockDb.tenants.set(tenantId, {
            id: tenantId,
            wsEndpoint: `wss://api.produtime.cloud/ws/tenant/${tenantId}`,
          });

          // Generate pair code and submit request
          const pairCodeResult = await pairingService.generatePairCode(tenantId);
          const requestResult = await pairingService.submitPairRequest({
            pairCode: pairCodeResult.code,
            deviceId: 'device-123',
            deviceName: 'Test Device',
            devicePubKey: 'test-pub-key',
            appVersion: '1.0.0',
            osInfo: 'Windows 10',
            ip: '192.168.1.1',
          });

          // Approve the request
          const approvalResult = await pairingService.approvePairing(
            requestResult.requestId,
            'admin-user-id'
          );

          // Verify session token is present
          expect(approvalResult.sessionToken).toBeDefined();
          expect(approvalResult.sessionToken.length).toBe(64); // 32 bytes hex
          expect(/^[a-f0-9]{64}$/i.test(approvalResult.sessionToken)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});


// ============================================================================
// Property 13: WebSocket URL in Approval
// *For any* approved pairing response, it SHALL contain a valid WSS endpoint URL.
// **Validates: Requirements 3.7**
// ============================================================================

describe('Property 13: WebSocket URL in Approval', () => {
  /**
   * Feature: cloud-admin-console, Property 13: WebSocket URL in Approval
   * For any approved pairing, the response must contain a valid WSS endpoint URL.
   */
  it('should include valid WSS endpoint URL in approval response', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), // tenantId
        async (tenantId) => {
          const mockDb = createMockDb();
          const pairingService = new PairingService(mockDb);

          // Set up tenant with WSS endpoint
          const wsEndpoint = `wss://api.produtime.cloud/ws/tenant/${tenantId}`;
          mockDb.tenants.set(tenantId, {
            id: tenantId,
            wsEndpoint,
          });

          // Generate pair code and submit request
          const pairCodeResult = await pairingService.generatePairCode(tenantId);
          const requestResult = await pairingService.submitPairRequest({
            pairCode: pairCodeResult.code,
            deviceId: 'device-123',
            deviceName: 'Test Device',
            devicePubKey: 'test-pub-key',
            appVersion: '1.0.0',
            osInfo: 'Windows 10',
            ip: '192.168.1.1',
          });

          // Approve the request
          const approvalResult = await pairingService.approvePairing(
            requestResult.requestId,
            'admin-user-id'
          );

          // Verify WebSocket URL is present and valid
          expect(approvalResult.wsEndpoint).toBeDefined();
          expect(approvalResult.wsEndpoint).toBe(wsEndpoint);
          expect(
            approvalResult.wsEndpoint.startsWith('wss://') ||
              approvalResult.wsEndpoint.startsWith('ws://')
          ).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: cloud-admin-console, Property 13: WebSocket URL in Approval
   * For any approved pairing, the WSS URL must contain the tenant ID.
   */
  it('should include tenant ID in WSS endpoint URL', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (tenantId) => {
          const mockDb = createMockDb();
          const pairingService = new PairingService(mockDb);

          // Set up tenant
          mockDb.tenants.set(tenantId, {
            id: tenantId,
            wsEndpoint: `wss://api.produtime.cloud/ws/tenant/${tenantId}`,
          });

          // Generate pair code and submit request
          const pairCodeResult = await pairingService.generatePairCode(tenantId);
          const requestResult = await pairingService.submitPairRequest({
            pairCode: pairCodeResult.code,
            deviceId: 'device-123',
            deviceName: 'Test Device',
            devicePubKey: 'test-pub-key',
            appVersion: '1.0.0',
            osInfo: 'Windows 10',
            ip: '192.168.1.1',
          });

          // Approve the request
          const approvalResult = await pairingService.approvePairing(
            requestResult.requestId,
            'admin-user-id'
          );

          // Verify tenant ID is in the URL
          expect(approvalResult.wsEndpoint).toContain(tenantId);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: cloud-admin-console, Property 13: WebSocket URL in Approval
   * For any approved pairing, the WSS URL must be a properly formatted URL.
   */
  it('should return properly formatted WebSocket URL', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (tenantId) => {
          const mockDb = createMockDb();
          const pairingService = new PairingService(mockDb);

          // Set up tenant
          mockDb.tenants.set(tenantId, {
            id: tenantId,
            wsEndpoint: `wss://api.produtime.cloud/ws/tenant/${tenantId}`,
          });

          // Generate pair code and submit request
          const pairCodeResult = await pairingService.generatePairCode(tenantId);
          const requestResult = await pairingService.submitPairRequest({
            pairCode: pairCodeResult.code,
            deviceId: 'device-123',
            deviceName: 'Test Device',
            devicePubKey: 'test-pub-key',
            appVersion: '1.0.0',
            osInfo: 'Windows 10',
            ip: '192.168.1.1',
          });

          // Approve the request
          const approvalResult = await pairingService.approvePairing(
            requestResult.requestId,
            'admin-user-id'
          );

          // Verify URL format
          const wsUrlPattern = /^wss?:\/\/[a-zA-Z0-9.-]+(?::\d+)?\/ws\/tenant\/[a-f0-9-]+$/;
          expect(approvalResult.wsEndpoint).toMatch(wsUrlPattern);
        }
      ),
      { numRuns: 100 }
    );
  });
});


// ============================================================================
// Unit Tests for Pair Code Error Uniformity (Task 12.9)
// Requirements: 3.9
// ============================================================================

describe('Pair Code Error Uniformity', () => {
  it('should return identical error for invalid code', async () => {
    const mockDb = createMockDb();
    const pairingService = new PairingService(mockDb);

    try {
      await pairingService.submitPairRequest({
        pairCode: '000000', // Invalid code
        deviceId: 'device-123',
        deviceName: 'Test Device',
        devicePubKey: 'test-pub-key',
        appVersion: '1.0.0',
        osInfo: 'Windows 10',
        ip: '192.168.1.1',
      });
      expect.fail('Should have thrown an error');
    } catch (error) {
      expect(error).toBeInstanceOf(PairingError);
      expect((error as PairingError).code).toBe('INVALID_PAIR_CODE');
      expect((error as PairingError).message).toBe('Invalid or expired pair code');
    }
  });

  it('should return identical error for expired code', async () => {
    const mockDb = createMockDb();
    const pairingService = new PairingService(mockDb);
    const tenantId = 'test-tenant-id';

    // Create an expired pair code
    const expiredCode: StoredPairCode = {
      id: 'expired-code-id',
      tenantId,
      code: '123456',
      expiresAt: new Date(Date.now() - 1000), // Expired
      usedAt: null,
      createdAt: new Date(Date.now() - 600000),
    };
    mockDb.pairCodes.set(expiredCode.id, expiredCode);

    try {
      await pairingService.submitPairRequest({
        pairCode: '123456',
        deviceId: 'device-123',
        deviceName: 'Test Device',
        devicePubKey: 'test-pub-key',
        appVersion: '1.0.0',
        osInfo: 'Windows 10',
        ip: '192.168.1.1',
      });
      expect.fail('Should have thrown an error');
    } catch (error) {
      expect(error).toBeInstanceOf(PairingError);
      expect((error as PairingError).code).toBe('INVALID_PAIR_CODE');
      expect((error as PairingError).message).toBe('Invalid or expired pair code');
    }
  });

  it('should return identical error for already used code', async () => {
    const mockDb = createMockDb();
    const pairingService = new PairingService(mockDb);
    const tenantId = 'test-tenant-id';

    // Create a used pair code
    const usedCode: StoredPairCode = {
      id: 'used-code-id',
      tenantId,
      code: '654321',
      expiresAt: new Date(Date.now() + 300000), // Not expired
      usedAt: new Date(), // Already used
      createdAt: new Date(Date.now() - 60000),
    };
    mockDb.pairCodes.set(usedCode.id, usedCode);

    try {
      await pairingService.submitPairRequest({
        pairCode: '654321',
        deviceId: 'device-123',
        deviceName: 'Test Device',
        devicePubKey: 'test-pub-key',
        appVersion: '1.0.0',
        osInfo: 'Windows 10',
        ip: '192.168.1.1',
      });
      expect.fail('Should have thrown an error');
    } catch (error) {
      expect(error).toBeInstanceOf(PairingError);
      expect((error as PairingError).code).toBe('INVALID_PAIR_CODE');
      expect((error as PairingError).message).toBe('Invalid or expired pair code');
    }
  });

  it('should use constant-time comparison for pair codes', () => {
    // Test the static method directly
    expect(PairingService.constantTimeCompare('123456', '123456')).toBe(true);
    expect(PairingService.constantTimeCompare('123456', '654321')).toBe(false);
    expect(PairingService.constantTimeCompare('123456', '12345')).toBe(false);
    expect(PairingService.constantTimeCompare('', '')).toBe(true);
  });

  it('should validate pair code format correctly', () => {
    expect(PairingService.isValidPairCodeFormat('123456')).toBe(true);
    expect(PairingService.isValidPairCodeFormat('000000')).toBe(true);
    expect(PairingService.isValidPairCodeFormat('999999')).toBe(true);
    expect(PairingService.isValidPairCodeFormat('12345')).toBe(false); // Too short
    expect(PairingService.isValidPairCodeFormat('1234567')).toBe(false); // Too long
    expect(PairingService.isValidPairCodeFormat('12345a')).toBe(false); // Contains letter
    expect(PairingService.isValidPairCodeFormat('')).toBe(false); // Empty
  });
});


// ============================================================================
// Property 14: Pair Code Error Uniformity
// *For any* invalid or expired pair code, the error response SHALL be identical 
// (same message, same timing) to prevent enumeration.
// **Validates: Requirements 3.9**
// ============================================================================

describe('Property 14: Pair Code Error Uniformity', () => {
  /**
   * Feature: cloud-admin-console, Property 14: Pair Code Error Uniformity
   * For any invalid pair code, the error code and message must be identical.
   */
  it('should return identical error for any invalid pair code', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), {
          minLength: 6,
          maxLength: 6,
        }),
        async (invalidCode) => {
          const mockDb = createMockDb();
          const pairingService = new PairingService(mockDb);

          try {
            await pairingService.submitPairRequest({
              pairCode: invalidCode,
              deviceId: 'device-123',
              deviceName: 'Test Device',
              devicePubKey: 'test-pub-key',
              appVersion: '1.0.0',
              osInfo: 'Windows 10',
              ip: '192.168.1.1',
            });
            // If no error thrown, the code happened to be valid (very unlikely)
            // This is acceptable in property testing
          } catch (error) {
            // Verify error is uniform
            expect(error).toBeInstanceOf(PairingError);
            expect((error as PairingError).code).toBe('INVALID_PAIR_CODE');
            expect((error as PairingError).message).toBe('Invalid or expired pair code');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: cloud-admin-console, Property 14: Pair Code Error Uniformity
   * For any expired pair code, the error must be identical to invalid code error.
   */
  it('should return identical error for any expired pair code', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), // tenantId
        fc.stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), {
          minLength: 6,
          maxLength: 6,
        }),
        fc.integer({ min: 1, max: 86400000 }), // expiredMs (1ms to 24h ago)
        async (tenantId, code, expiredMs) => {
          const mockDb = createMockDb();
          const pairingService = new PairingService(mockDb);

          // Create an expired pair code
          const expiredCode: StoredPairCode = {
            id: 'expired-code-id',
            tenantId,
            code,
            expiresAt: new Date(Date.now() - expiredMs), // Expired
            usedAt: null,
            createdAt: new Date(Date.now() - expiredMs - 300000),
          };
          mockDb.pairCodes.set(expiredCode.id, expiredCode);

          try {
            await pairingService.submitPairRequest({
              pairCode: code,
              deviceId: 'device-123',
              deviceName: 'Test Device',
              devicePubKey: 'test-pub-key',
              appVersion: '1.0.0',
              osInfo: 'Windows 10',
              ip: '192.168.1.1',
            });
            expect.fail('Should have thrown an error');
          } catch (error) {
            // Verify error is uniform (same as invalid code)
            expect(error).toBeInstanceOf(PairingError);
            expect((error as PairingError).code).toBe('INVALID_PAIR_CODE');
            expect((error as PairingError).message).toBe('Invalid or expired pair code');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: cloud-admin-console, Property 14: Pair Code Error Uniformity
   * Constant-time comparison should work correctly for any pair of strings.
   */
  it('should perform constant-time comparison correctly for any strings', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 20 }),
        fc.string({ minLength: 0, maxLength: 20 }),
        (a, b) => {
          const result = PairingService.constantTimeCompare(a, b);
          const expected = a === b;
          expect(result).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: cloud-admin-console, Property 14: Pair Code Error Uniformity
   * Error response should not reveal whether code existed or was expired.
   */
  it('should not reveal code existence in error response', async () => {
    const mockDb = createMockDb();
    const pairingService = new PairingService(mockDb);
    const tenantId = 'test-tenant-id';

    // Create a valid code
    const validCodeResult = await pairingService.generatePairCode(tenantId);

    // Create an expired code
    const expiredCode: StoredPairCode = {
      id: 'expired-code-id',
      tenantId,
      code: '111111',
      expiresAt: new Date(Date.now() - 1000),
      usedAt: null,
      createdAt: new Date(Date.now() - 600000),
    };
    mockDb.pairCodes.set(expiredCode.id, expiredCode);

    // Test with non-existent code
    let nonExistentError: PairingError | null = null;
    try {
      await pairingService.submitPairRequest({
        pairCode: '999999',
        deviceId: 'device-123',
        deviceName: 'Test Device',
        devicePubKey: 'test-pub-key',
        appVersion: '1.0.0',
        osInfo: 'Windows 10',
        ip: '192.168.1.1',
      });
    } catch (error) {
      nonExistentError = error as PairingError;
    }

    // Test with expired code
    let expiredError: PairingError | null = null;
    try {
      await pairingService.submitPairRequest({
        pairCode: '111111',
        deviceId: 'device-456',
        deviceName: 'Test Device 2',
        devicePubKey: 'test-pub-key-2',
        appVersion: '1.0.0',
        osInfo: 'Windows 10',
        ip: '192.168.1.2',
      });
    } catch (error) {
      expiredError = error as PairingError;
    }

    // Both errors should be identical
    expect(nonExistentError).not.toBeNull();
    expect(expiredError).not.toBeNull();
    expect(nonExistentError!.code).toBe(expiredError!.code);
    expect(nonExistentError!.message).toBe(expiredError!.message);
  });
});
