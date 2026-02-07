/**
 * Agent Service Integration Tests
 * Tests for communication between Main App and Admin Console
 */

import {
  validateProtocolMessage,
  validateBaseMessage,
  validateHeartbeatPayload,
  validatePairApprovedPayload,
} from '../../../../shared/validation/protocol-schemas';

// Mock crypto for testing
const mockCrypto = {
  randomUUID: () => 'test-uuid-' + Math.random().toString(36).substr(2, 9),
  randomBytes: (size: number) => Buffer.alloc(size).fill(1),
};

describe('Agent Integration Tests', () => {
  describe('Message Contract Validation', () => {
    it('should validate heartbeat message with enhanced payload', () => {
      const message = {
        type: 'HEARTBEAT',
        ts: Date.now(),
        nonce: mockCrypto.randomUUID(),
        deviceId: 'device-123',
        signature: 'base64signature==',
        payload: {
          appVersion: '1.8.8',
          trackingStatus: 'active',
          policyVersion: 'v1.0',
          uptime: 3600,
          lastActivityAt: Date.now(),
          enhanced: {
            deviceId: 'device-123',
            deviceName: 'Test Device',
            ip: '192.168.1.100',
            appVersion: '1.8.8',
            trackingRunning: true,
            effectivePolicyHash: 'abc123',
            privacyModeEffective: false,
            titleSharingEffective: false,
            today: {
              productiveSeconds: 0,
              unproductiveSeconds: 0,
              idleSeconds: 300,
              untrackedSeconds: 0,
              activeSeconds: 3600,
              firstActivityTs: Date.now() - 3600000,
              lastActivityTs: Date.now(),
            },
            last15m: {
              productiveSeconds: 0,
              unproductiveSeconds: 0,
              idleSeconds: 60,
              untrackedSeconds: 0,
              activeSeconds: 840,
            },
            topAppsToday: [
              { app: 'VS Code', seconds: 1800, category: 'productive' },
              { app: 'Chrome', seconds: 1200, category: 'neutral' },
            ],
          },
        },
      };

      const baseResult = validateBaseMessage(message);
      expect(baseResult.success).toBe(true);

      const payloadResult = validateHeartbeatPayload(message.payload);
      expect(payloadResult.success).toBe(true);
    });

    it('should validate pair approved message with cloud fields', () => {
      const payload = {
        adminName: 'Cloud Admin Console',
        adminPubKey: 'base64publickey==',
        sessionToken: 'session-token-123',
        wsEndpoint: 'wss://api.produtime.cloud/ws',
        tenantId: 'tenant-abc123',
        tenantName: 'Acme Corporation',
        initialPolicy: {
          version: 'v1.0',
          updatedAt: Date.now(),
          workScheduleStart: '09:00',
          workScheduleEnd: '18:00',
          idleThreshold: 300,
          privacyModeEnabled: false,
          privacyApps: [],
          titleSharingEnabled: false,
          autoExportEnabled: false,
          autoExportTime: '18:00',
          reportRetentionDays: 30,
        },
      };

      const result = validatePairApprovedPayload(payload);
      expect(result.success).toBe(true);
    });

    it('should reject pair approved message with invalid cloud endpoint', () => {
      const payload = {
        adminName: 'Cloud Admin Console',
        adminPubKey: 'base64publickey==',
        sessionToken: 'session-token-123',
        wsEndpoint: 12345, // Invalid - should be string
        tenantId: 'tenant-abc123',
      };

      const result = validatePairApprovedPayload(payload);
      expect(result.success).toBe(false);
      expect(result.error).toContain('wsEndpoint');
    });
  });

  describe('Protocol Message Types', () => {
    const validMessageTypes = [
      'HEARTBEAT',
      'STATS_SUMMARY',
      'PAIR_REQUEST',
      'PAIR_APPROVED',
      'PAIR_DENIED',
      'IDENTIFY',
      'POLICY_PUSH',
      'EXPORT_REQUEST',
      'EXPORT_RESULT',
      'STATS_SNAPSHOT_REQUEST',
      'STATS_SNAPSHOT_RESULT',
      'LOCK',
      'UNLOCK',
      'UNPAIR',
      'ERROR',
      'ACK',
    ];

    validMessageTypes.forEach((type) => {
      it(`should accept message type: ${type}`, () => {
        const message = {
          type,
          ts: Date.now(),
          nonce: mockCrypto.randomUUID(),
          deviceId: 'device-123',
          signature: 'base64signature==',
          payload: {},
        };

        const result = validateBaseMessage(message);
        expect(result.success).toBe(true);
      });
    });

    it('should reject unknown message type', () => {
      const message = {
        type: 'UNKNOWN_TYPE',
        ts: Date.now(),
        nonce: mockCrypto.randomUUID(),
        deviceId: 'device-123',
        signature: 'base64signature==',
        payload: {},
      };

      const result = validateBaseMessage(message);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid message type');
    });
  });

  describe('Timestamp Validation', () => {
    it('should accept current timestamp', () => {
      const message = {
        type: 'HEARTBEAT',
        ts: Date.now(),
        nonce: 'test-nonce',
        deviceId: 'device-123',
        signature: 'sig',
        payload: {},
      };

      const result = validateBaseMessage(message);
      expect(result.success).toBe(true);
    });

    it('should reject negative timestamp', () => {
      const message = {
        type: 'HEARTBEAT',
        ts: -1,
        nonce: 'test-nonce',
        deviceId: 'device-123',
        signature: 'sig',
        payload: {},
      };

      const result = validateBaseMessage(message);
      expect(result.success).toBe(false);
      expect(result.error).toContain('timestamp');
    });

    it('should reject non-numeric timestamp', () => {
      const message = {
        type: 'HEARTBEAT',
        ts: 'not-a-number',
        nonce: 'test-nonce',
        deviceId: 'device-123',
        signature: 'sig',
        payload: {},
      };

      const result = validateBaseMessage(message);
      expect(result.success).toBe(false);
      expect(result.error).toContain('timestamp');
    });
  });

  describe('Device ID Validation', () => {
    it('should accept valid device ID', () => {
      const message = {
        type: 'HEARTBEAT',
        ts: Date.now(),
        nonce: 'test-nonce',
        deviceId: 'device-abc-123-xyz',
        signature: 'sig',
        payload: {},
      };

      const result = validateBaseMessage(message);
      expect(result.success).toBe(true);
    });

    it('should reject empty device ID', () => {
      const message = {
        type: 'HEARTBEAT',
        ts: Date.now(),
        nonce: 'test-nonce',
        deviceId: '',
        signature: 'sig',
        payload: {},
      };

      const result = validateBaseMessage(message);
      expect(result.success).toBe(false);
      expect(result.error).toContain('deviceId');
    });

    it('should reject missing device ID', () => {
      const message = {
        type: 'HEARTBEAT',
        ts: Date.now(),
        nonce: 'test-nonce',
        signature: 'sig',
        payload: {},
      };

      const result = validateBaseMessage(message);
      expect(result.success).toBe(false);
      expect(result.error).toContain('deviceId');
    });
  });

  describe('Nonce Validation', () => {
    it('should accept valid nonce', () => {
      const message = {
        type: 'HEARTBEAT',
        ts: Date.now(),
        nonce: 'unique-nonce-12345',
        deviceId: 'device-123',
        signature: 'sig',
        payload: {},
      };

      const result = validateBaseMessage(message);
      expect(result.success).toBe(true);
    });

    it('should reject empty nonce', () => {
      const message = {
        type: 'HEARTBEAT',
        ts: Date.now(),
        nonce: '',
        deviceId: 'device-123',
        signature: 'sig',
        payload: {},
      };

      const result = validateBaseMessage(message);
      expect(result.success).toBe(false);
      expect(result.error).toContain('nonce');
    });
  });

  describe('Signature Validation', () => {
    it('should accept valid signature', () => {
      const message = {
        type: 'HEARTBEAT',
        ts: Date.now(),
        nonce: 'test-nonce',
        deviceId: 'device-123',
        signature: 'base64encodedSignature==',
        payload: {},
      };

      const result = validateBaseMessage(message);
      expect(result.success).toBe(true);
    });

    it('should reject empty signature', () => {
      const message = {
        type: 'HEARTBEAT',
        ts: Date.now(),
        nonce: 'test-nonce',
        deviceId: 'device-123',
        signature: '',
        payload: {},
      };

      const result = validateBaseMessage(message);
      expect(result.success).toBe(false);
      expect(result.error).toContain('signature');
    });
  });

  describe('Contract Mismatch Detection', () => {
    it('should detect missing required fields in heartbeat', () => {
      const incompletePayload = {
        appVersion: '1.0.0',
        // Missing: trackingStatus, policyVersion, uptime, lastActivityAt
      };

      const result = validateHeartbeatPayload(incompletePayload);
      expect(result.success).toBe(false);
    });

    it('should detect invalid enum values', () => {
      const payload = {
        appVersion: '1.0.0',
        trackingStatus: 'running', // Invalid - should be active/paused/stopped
        policyVersion: 'v1',
        uptime: 3600,
        lastActivityAt: Date.now(),
      };

      const result = validateHeartbeatPayload(payload);
      expect(result.success).toBe(false);
      expect(result.error).toContain('trackingStatus');
    });

    it('should detect type mismatches', () => {
      const payload = {
        appVersion: '1.0.0',
        trackingStatus: 'active',
        policyVersion: 123, // Invalid - should be string
        uptime: 3600,
        lastActivityAt: Date.now(),
      };

      const result = validateHeartbeatPayload(payload);
      expect(result.success).toBe(false);
      expect(result.error).toContain('policyVersion');
    });
  });
});
