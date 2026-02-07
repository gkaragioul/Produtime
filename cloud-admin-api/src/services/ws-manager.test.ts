/**
 * WebSocket Manager Tests
 * 
 * Property-based tests for WebSocket connection management.
 * 
 * Feature: cloud-admin-console
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import * as nacl from 'tweetnacl';
import { WebSocketManager, WebSocketDatabase, DeviceRecord, SignedMessage, WS_CONSTANTS } from './ws-manager';

// ============================================================================
// Mock WebSocket
// ============================================================================

class MockWebSocket {
  readyState = 1; // OPEN
  closeCode?: number;
  closeReason?: string;
  sentMessages: string[] = [];
  onMessageHandler?: (data: Buffer) => void;
  onCloseHandler?: () => void;
  onErrorHandler?: () => void;

  close(code?: number, reason?: string) {
    this.closeCode = code;
    this.closeReason = reason;
    this.readyState = 3; // CLOSED
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  on(event: string, handler: any) {
    if (event === 'message') {
      this.onMessageHandler = handler;
    } else if (event === 'close') {
      this.onCloseHandler = handler;
    } else if (event === 'error') {
      this.onErrorHandler = handler;
    }
  }

  // Simulate receiving a message
  simulateMessage(data: string) {
    if (this.onMessageHandler) {
      this.onMessageHandler(Buffer.from(data));
    }
  }

  // Simulate close
  simulateClose() {
    if (this.onCloseHandler) {
      this.onCloseHandler();
    }
  }
}

// ============================================================================
// Test Helpers
// ============================================================================

function createMockDatabase(devices: Map<string, DeviceRecord> = new Map()): WebSocketDatabase {
  return {
    findDeviceByDeviceId: async (tenantId: string, deviceId: string) => {
      const key = `${tenantId}:${deviceId}`;
      return devices.get(key) || null;
    },
    updateDeviceStatus: vi.fn(),
    findTenantById: async (tenantId: string) => {
      return { id: tenantId, wsEndpoint: `wss://example.com/ws/${tenantId}` };
    },
  };
}

function createDeviceRecord(tenantId: string, deviceId: string, options: Partial<DeviceRecord> = {}): DeviceRecord {
  const keyPair = nacl.sign.keyPair();
  return {
    id: `device-${Date.now()}`,
    tenantId,
    deviceId,
    deviceName: 'Test Device',
    devicePubKey: Buffer.from(keyPair.publicKey).toString('base64'),
    pairedAt: new Date(),
    status: 'offline',
    appVersion: '1.0.0',
    ip: '127.0.0.1',
    revoked: false,
    ...options,
  };
}

function generateKeyPair(): { publicKey: string; privateKey: string } {
  const keyPair = nacl.sign.keyPair();
  return {
    publicKey: Buffer.from(keyPair.publicKey).toString('base64'),
    privateKey: Buffer.from(keyPair.secretKey).toString('base64'),
  };
}

function createSignedMessage(
  type: string,
  deviceId: string,
  payload: any,
  privateKeyBase64: string
): SignedMessage {
  const ts = Date.now();
  const nonce = Math.random().toString(36).substring(2, 15);
  
  const signable = JSON.stringify({ type, ts, nonce, deviceId, payload });
  const messageBytes = new Uint8Array(Buffer.from(signable, 'utf-8'));
  const privateKey = new Uint8Array(Buffer.from(privateKeyBase64, 'base64'));
  
  const signature = nacl.sign.detached(messageBytes, privateKey);
  
  return {
    type,
    ts,
    nonce,
    deviceId,
    signature: Buffer.from(signature).toString('base64'),
    payload,
  };
}

// ============================================================================
// Arbitraries
// ============================================================================

const tenantIdArb = fc.uuid();
const deviceIdArb = fc.uuid();
const deviceNameArb = fc.string({ minLength: 1, maxLength: 100 });

// ============================================================================
// Property Tests
// ============================================================================

describe('WebSocketManager', () => {
  /**
   * Property 16: Unpaired Device Rejection
   * 
   * *For any* WebSocket connection attempt from a device ID not in the paired devices list,
   * the connection SHALL be rejected.
   * 
   * **Validates: Requirements 4.3**
   */
  describe('Property 16: Unpaired Device Rejection', () => {
    it('should reject connections from unpaired devices', async () => {
      await fc.assert(
        fc.asyncProperty(
          tenantIdArb,
          deviceIdArb,
          async (tenantId, deviceId) => {
            // Create manager with empty device database (no paired devices)
            const db = createMockDatabase(new Map());
            const manager = new WebSocketManager(db);
            
            const ws = new MockWebSocket();
            
            // Attempt to connect with unpaired device
            const result = await manager.handleClientConnection(
              ws as any,
              tenantId,
              deviceId
            );
            
            // Connection should be rejected
            expect(result.success).toBe(false);
            expect(result.error).toBe('DEVICE_NOT_PAIRED');
            expect(ws.closeCode).toBe(1008);
            expect(ws.closeReason).toBe('Device not paired');
            
            // Device should not be in connected list
            expect(manager.isDeviceConnected(tenantId, deviceId)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject connections from revoked devices', async () => {
      await fc.assert(
        fc.asyncProperty(
          tenantIdArb,
          deviceIdArb,
          async (tenantId, deviceId) => {
            // Create a revoked device
            const device = createDeviceRecord(tenantId, deviceId, { revoked: true });
            const devices = new Map([[`${tenantId}:${deviceId}`, device]]);
            const db = createMockDatabase(devices);
            const manager = new WebSocketManager(db);
            
            const ws = new MockWebSocket();
            
            // Attempt to connect with revoked device
            const result = await manager.handleClientConnection(
              ws as any,
              tenantId,
              deviceId
            );
            
            // Connection should be rejected
            expect(result.success).toBe(false);
            expect(result.error).toBe('DEVICE_REVOKED');
            expect(ws.closeCode).toBe(1008);
            expect(ws.closeReason).toBe('Device revoked');
            
            // Device should not be in connected list
            expect(manager.isDeviceConnected(tenantId, deviceId)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should accept connections from paired, non-revoked devices', async () => {
      await fc.assert(
        fc.asyncProperty(
          tenantIdArb,
          deviceIdArb,
          async (tenantId, deviceId) => {
            // Create a valid paired device
            const device = createDeviceRecord(tenantId, deviceId, { revoked: false });
            const devices = new Map([[`${tenantId}:${deviceId}`, device]]);
            const db = createMockDatabase(devices);
            const manager = new WebSocketManager(db);
            
            const ws = new MockWebSocket();
            
            // Attempt to connect with valid device
            const result = await manager.handleClientConnection(
              ws as any,
              tenantId,
              deviceId
            );
            
            // Connection should be accepted
            expect(result.success).toBe(true);
            expect(result.error).toBeUndefined();
            
            // Device should be in connected list
            expect(manager.isDeviceConnected(tenantId, deviceId)).toBe(true);
            
            // Cleanup
            manager.stop();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 15: Signature Verification
   * 
   * *For any* WebSocket message from a client, if the Ed25519 signature is invalid,
   * the message SHALL be rejected and connection terminated.
   * 
   * **Validates: Requirements 4.2, 4.4, 4.5**
   */
  describe('Property 15: Signature Verification', () => {
    it('should accept messages with valid signatures', async () => {
      await fc.assert(
        fc.asyncProperty(
          tenantIdArb,
          deviceIdArb,
          fc.string({ minLength: 1, maxLength: 50 }),
          async (tenantId, deviceId, messageType) => {
            // Generate key pair
            const keyPair = generateKeyPair();
            
            // Create device with matching public key
            const device = createDeviceRecord(tenantId, deviceId, {
              devicePubKey: keyPair.publicKey,
              revoked: false,
            });
            const devices = new Map([[`${tenantId}:${deviceId}`, device]]);
            const db = createMockDatabase(devices);
            const manager = new WebSocketManager(db);
            
            const ws = new MockWebSocket();
            
            // Connect device
            await manager.handleClientConnection(ws as any, tenantId, deviceId);
            
            // Create valid signed message
            const message = createSignedMessage(
              messageType,
              deviceId,
              { test: 'data' },
              keyPair.privateKey
            );
            
            // Handle message
            const result = await manager.handleClientMessage(deviceId, message);
            
            // Message should be accepted
            expect(result).toBe(true);
            
            // Connection should still be open
            expect(manager.isDeviceConnected(tenantId, deviceId)).toBe(true);
            
            // Cleanup
            manager.stop();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject messages with invalid signatures and terminate connection', async () => {
      await fc.assert(
        fc.asyncProperty(
          tenantIdArb,
          deviceIdArb,
          fc.string({ minLength: 1, maxLength: 50 }),
          async (tenantId, deviceId, messageType) => {
            // Generate two different key pairs
            const deviceKeyPair = generateKeyPair();
            const wrongKeyPair = generateKeyPair();
            
            // Create device with one public key
            const device = createDeviceRecord(tenantId, deviceId, {
              devicePubKey: deviceKeyPair.publicKey,
              revoked: false,
            });
            const devices = new Map([[`${tenantId}:${deviceId}`, device]]);
            const db = createMockDatabase(devices);
            const manager = new WebSocketManager(db);
            
            const ws = new MockWebSocket();
            
            // Connect device
            await manager.handleClientConnection(ws as any, tenantId, deviceId);
            
            // Create message signed with WRONG key
            const message = createSignedMessage(
              messageType,
              deviceId,
              { test: 'data' },
              wrongKeyPair.privateKey
            );
            
            // Handle message
            const result = await manager.handleClientMessage(deviceId, message);
            
            // Message should be rejected
            expect(result).toBe(false);
            
            // Connection should be terminated
            expect(ws.closeCode).toBe(1008);
            expect(ws.closeReason).toBe('Signature verification failed');
            
            // Cleanup
            manager.stop();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject messages with tampered content', async () => {
      await fc.assert(
        fc.asyncProperty(
          tenantIdArb,
          deviceIdArb,
          fc.string({ minLength: 1, maxLength: 50 }),
          async (tenantId, deviceId, messageType) => {
            // Generate key pair
            const keyPair = generateKeyPair();
            
            // Create device with matching public key
            const device = createDeviceRecord(tenantId, deviceId, {
              devicePubKey: keyPair.publicKey,
              revoked: false,
            });
            const devices = new Map([[`${tenantId}:${deviceId}`, device]]);
            const db = createMockDatabase(devices);
            const manager = new WebSocketManager(db);
            
            const ws = new MockWebSocket();
            
            // Connect device
            await manager.handleClientConnection(ws as any, tenantId, deviceId);
            
            // Create valid signed message
            const message = createSignedMessage(
              messageType,
              deviceId,
              { test: 'data' },
              keyPair.privateKey
            );
            
            // Tamper with the message content
            message.payload = { test: 'tampered' };
            
            // Handle message
            const result = await manager.handleClientMessage(deviceId, message);
            
            // Message should be rejected
            expect(result).toBe(false);
            
            // Connection should be terminated
            expect(ws.closeCode).toBe(1008);
            
            // Cleanup
            manager.stop();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // ============================================================================
  // Unit Tests
  // ============================================================================

  describe('Connection Rate Limiting', () => {
    it('should reject connections when tenant limit is exceeded', async () => {
      const tenantId = 'test-tenant';
      const devices = new Map<string, DeviceRecord>();
      
      // Create MAX_CONNECTIONS_PER_TENANT + 1 devices
      for (let i = 0; i <= WS_CONSTANTS.MAX_CONNECTIONS_PER_TENANT; i++) {
        const deviceId = `device-${i}`;
        const device = createDeviceRecord(tenantId, deviceId, { revoked: false });
        devices.set(`${tenantId}:${deviceId}`, device);
      }
      
      const db = createMockDatabase(devices);
      const manager = new WebSocketManager(db);
      
      // Connect MAX_CONNECTIONS_PER_TENANT devices
      for (let i = 0; i < WS_CONSTANTS.MAX_CONNECTIONS_PER_TENANT; i++) {
        const ws = new MockWebSocket();
        const result = await manager.handleClientConnection(
          ws as any,
          tenantId,
          `device-${i}`
        );
        expect(result.success).toBe(true);
      }
      
      // Try to connect one more
      const ws = new MockWebSocket();
      const result = await manager.handleClientConnection(
        ws as any,
        tenantId,
        `device-${WS_CONSTANTS.MAX_CONNECTIONS_PER_TENANT}`
      );
      
      // Should be rejected
      expect(result.success).toBe(false);
      expect(result.error).toBe('CONNECTION_LIMIT_EXCEEDED');
      expect(ws.closeCode).toBe(1008);
      
      // Cleanup
      manager.stop();
    });
  });

  describe('Admin Connections', () => {
    it('should accept admin connections for valid tenants', async () => {
      const tenantId = 'test-tenant';
      const userId = 'admin-user';
      
      const db = createMockDatabase(new Map());
      const manager = new WebSocketManager(db);
      
      const ws = new MockWebSocket();
      
      const result = await manager.handleAdminConnection(
        ws as any,
        tenantId,
        userId
      );
      
      expect(result.success).toBe(true);
      
      // Should have sent initial state
      expect(ws.sentMessages.length).toBe(1);
      const initialState = JSON.parse(ws.sentMessages[0]);
      expect(initialState.type).toBe('initial_state');
      
      // Cleanup
      manager.stop();
    });

    it('should broadcast events to admin connections', async () => {
      const tenantId = 'test-tenant';
      const userId1 = 'admin-1';
      const userId2 = 'admin-2';
      
      const db = createMockDatabase(new Map());
      const manager = new WebSocketManager(db);
      
      const ws1 = new MockWebSocket();
      const ws2 = new MockWebSocket();
      
      await manager.handleAdminConnection(ws1 as any, tenantId, userId1);
      await manager.handleAdminConnection(ws2 as any, tenantId, userId2);
      
      // Clear initial state messages
      ws1.sentMessages = [];
      ws2.sentMessages = [];
      
      // Broadcast event
      manager.broadcastToAdmins(tenantId, {
        type: 'device_status',
        data: { deviceId: 'test', status: 'online' },
        timestamp: Date.now(),
      });
      
      // Both admins should receive the event
      expect(ws1.sentMessages.length).toBe(1);
      expect(ws2.sentMessages.length).toBe(1);
      
      const event1 = JSON.parse(ws1.sentMessages[0]);
      expect(event1.type).toBe('device_status');
      
      // Cleanup
      manager.stop();
    });
  });

  describe('Stale Connection Cleanup', () => {
    it('should disconnect idle connections', async () => {
      const tenantId = 'test-tenant';
      const deviceId = 'test-device';
      
      const keyPair = generateKeyPair();
      const device = createDeviceRecord(tenantId, deviceId, {
        devicePubKey: keyPair.publicKey,
        revoked: false,
      });
      const devices = new Map([[`${tenantId}:${deviceId}`, device]]);
      const db = createMockDatabase(devices);
      const manager = new WebSocketManager(db);
      
      const ws = new MockWebSocket();
      
      // Connect device
      await manager.handleClientConnection(ws as any, tenantId, deviceId);
      expect(manager.isDeviceConnected(tenantId, deviceId)).toBe(true);
      
      // Manually set lastMessageAt to be stale
      const connections = manager.getAllClientConnections();
      const tenantConnections = connections.get(tenantId);
      const connection = tenantConnections?.get(deviceId);
      if (connection) {
        connection.lastMessageAt = Date.now() - WS_CONSTANTS.STALE_CONNECTION_TIMEOUT_MS - 1000;
      }
      
      // Run cleanup
      await manager.cleanupStaleConnections();
      
      // Connection should be closed
      expect(ws.closeCode).toBe(1000);
      expect(manager.isDeviceConnected(tenantId, deviceId)).toBe(false);
      
      // Cleanup
      manager.stop();
    });
  });
});
