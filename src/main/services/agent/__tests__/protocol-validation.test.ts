/**
 * Protocol Validation Tests
 * Tests for runtime validation of admin protocol messages
 */

import {
  validateBaseMessage,
  validateHeartbeatPayload,
  validatePairRequestPayload,
  validatePairApprovedPayload,
  validateProtocolMessage,
} from '../../../../shared/validation/protocol-schemas';

describe('Protocol Validation', () => {
  describe('validateBaseMessage', () => {
    it('should accept valid base message', () => {
      const message = {
        type: 'HEARTBEAT',
        ts: Date.now(),
        nonce: 'abc123',
        deviceId: 'device-1',
        signature: 'sig123',
        payload: {},
      };

      const result = validateBaseMessage(message);
      expect(result.success).toBe(true);
    });

    it('should reject invalid message type', () => {
      const message = {
        type: 'INVALID_TYPE',
        ts: Date.now(),
        nonce: 'abc123',
        deviceId: 'device-1',
        signature: 'sig123',
      };

      const result = validateBaseMessage(message);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid message type');
    });

    it('should reject missing deviceId', () => {
      const message = {
        type: 'HEARTBEAT',
        ts: Date.now(),
        nonce: 'abc123',
        signature: 'sig123',
      };

      const result = validateBaseMessage(message);
      expect(result.success).toBe(false);
      expect(result.error).toContain('deviceId');
    });

    it('should reject non-object message', () => {
      const result = validateBaseMessage('not an object');
      expect(result.success).toBe(false);
      expect(result.error).toContain('must be an object');
    });

    it('should reject null message', () => {
      const result = validateBaseMessage(null);
      expect(result.success).toBe(false);
    });
  });

  describe('validateHeartbeatPayload', () => {
    it('should accept valid heartbeat payload', () => {
      const payload = {
        appVersion: '1.0.0',
        trackingStatus: 'active',
        policyVersion: 'v1',
        uptime: 3600,
        lastActivityAt: Date.now(),
      };

      const result = validateHeartbeatPayload(payload);
      expect(result.success).toBe(true);
    });

    it('should reject invalid tracking status', () => {
      const payload = {
        appVersion: '1.0.0',
        trackingStatus: 'invalid',
        policyVersion: 'v1',
        uptime: 3600,
        lastActivityAt: Date.now(),
      };

      const result = validateHeartbeatPayload(payload);
      expect(result.success).toBe(false);
      expect(result.error).toContain('trackingStatus');
    });

    it('should reject negative uptime', () => {
      const payload = {
        appVersion: '1.0.0',
        trackingStatus: 'active',
        policyVersion: 'v1',
        uptime: -100,
        lastActivityAt: Date.now(),
      };

      const result = validateHeartbeatPayload(payload);
      expect(result.success).toBe(false);
      expect(result.error).toContain('uptime');
    });
  });

  describe('validatePairRequestPayload', () => {
    it('should accept valid pair request', () => {
      const payload = {
        deviceName: 'My Device',
        devicePubKey: 'base64key==',
        appVersion: '1.0.0',
        osInfo: 'Windows 10',
        pairCode: '123456',
      };

      const result = validatePairRequestPayload(payload);
      expect(result.success).toBe(true);
    });

    it('should reject invalid pair code format', () => {
      const payload = {
        deviceName: 'My Device',
        devicePubKey: 'base64key==',
        appVersion: '1.0.0',
        osInfo: 'Windows 10',
        pairCode: '12345', // Only 5 digits
      };

      const result = validatePairRequestPayload(payload);
      expect(result.success).toBe(false);
      expect(result.error).toContain('pairCode');
    });

    it('should reject non-numeric pair code', () => {
      const payload = {
        deviceName: 'My Device',
        devicePubKey: 'base64key==',
        appVersion: '1.0.0',
        osInfo: 'Windows 10',
        pairCode: 'abcdef',
      };

      const result = validatePairRequestPayload(payload);
      expect(result.success).toBe(false);
      expect(result.error).toContain('pairCode');
    });
  });

  describe('validatePairApprovedPayload', () => {
    it('should accept valid pair approved payload', () => {
      const payload = {
        adminName: 'Admin Console',
        adminPubKey: 'base64key==',
        sessionToken: 'token123',
      };

      const result = validatePairApprovedPayload(payload);
      expect(result.success).toBe(true);
    });

    it('should accept payload with optional cloud fields', () => {
      const payload = {
        adminName: 'Cloud Admin',
        adminPubKey: 'base64key==',
        sessionToken: 'token123',
        wsEndpoint: 'wss://api.example.com/ws',
        tenantId: 'tenant-123',
        tenantName: 'Acme Corp',
      };

      const result = validatePairApprovedPayload(payload);
      expect(result.success).toBe(true);
    });

    it('should reject invalid wsEndpoint type', () => {
      const payload = {
        adminName: 'Cloud Admin',
        adminPubKey: 'base64key==',
        sessionToken: 'token123',
        wsEndpoint: 12345, // Should be string
      };

      const result = validatePairApprovedPayload(payload);
      expect(result.success).toBe(false);
      expect(result.error).toContain('wsEndpoint');
    });
  });

  describe('validateProtocolMessage', () => {
    it('should validate complete HEARTBEAT message', () => {
      const message = {
        type: 'HEARTBEAT',
        ts: Date.now(),
        nonce: 'abc123',
        deviceId: 'device-1',
        signature: 'sig123',
        payload: {
          appVersion: '1.0.0',
          trackingStatus: 'active',
          policyVersion: 'v1',
          uptime: 3600,
          lastActivityAt: Date.now(),
        },
      };

      const result = validateProtocolMessage(message);
      expect(result.success).toBe(true);
    });

    it('should validate complete PAIR_REQUEST message', () => {
      const message = {
        type: 'PAIR_REQUEST',
        ts: Date.now(),
        nonce: 'abc123',
        deviceId: 'device-1',
        signature: 'sig123',
        payload: {
          deviceName: 'My Device',
          devicePubKey: 'base64key==',
          appVersion: '1.0.0',
          osInfo: 'Windows 10',
          pairCode: '123456',
        },
      };

      const result = validateProtocolMessage(message);
      expect(result.success).toBe(true);
    });

    it('should reject message with invalid payload', () => {
      const message = {
        type: 'HEARTBEAT',
        ts: Date.now(),
        nonce: 'abc123',
        deviceId: 'device-1',
        signature: 'sig123',
        payload: {
          appVersion: '1.0.0',
          trackingStatus: 'invalid_status', // Invalid
          policyVersion: 'v1',
          uptime: 3600,
          lastActivityAt: Date.now(),
        },
      };

      const result = validateProtocolMessage(message);
      expect(result.success).toBe(false);
    });
  });
});
