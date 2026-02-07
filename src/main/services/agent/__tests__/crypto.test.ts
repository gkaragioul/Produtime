/**
 * Agent Crypto Service Tests
 * Tests for Ed25519 signing, verification, and replay protection
 */

import { AgentCryptoService } from '../crypto';

describe('AgentCryptoService', () => {
  let crypto: AgentCryptoService;

  beforeEach(() => {
    crypto = AgentCryptoService.getInstance();
    crypto.clearNonceStore();
  });

  describe('Key Generation', () => {
    it('should generate valid Ed25519 key pair', () => {
      const keyPair = crypto.generateKeyPair();
      
      expect(keyPair.publicKey).toBeDefined();
      expect(keyPair.privateKey).toBeDefined();
      expect(typeof keyPair.publicKey).toBe('string');
      expect(typeof keyPair.privateKey).toBe('string');
      
      // Ed25519 public key is 32 bytes = 44 base64 chars (with padding)
      expect(keyPair.publicKey.length).toBeGreaterThanOrEqual(43);
      // Ed25519 private key is 64 bytes = 88 base64 chars (with padding)
      expect(keyPair.privateKey.length).toBeGreaterThanOrEqual(86);
    });

    it('should generate unique key pairs', () => {
      const keyPair1 = crypto.generateKeyPair();
      const keyPair2 = crypto.generateKeyPair();
      
      expect(keyPair1.publicKey).not.toBe(keyPair2.publicKey);
      expect(keyPair1.privateKey).not.toBe(keyPair2.privateKey);
    });
  });

  describe('Signing and Verification', () => {
    it('should sign and verify a message', () => {
      const keyPair = crypto.generateKeyPair();
      const type = 'HEARTBEAT' as const;
      const ts = Date.now();
      const nonce = crypto.generateNonce();
      const deviceId = 'test-device-123';
      const payload = { appVersion: '1.0.0', trackingStatus: 'active' };

      const signature = crypto.signMessage(type, ts, nonce, deviceId, payload, keyPair.privateKey);
      
      expect(signature).toBeDefined();
      expect(typeof signature).toBe('string');

      const isValid = crypto.verifySignature(type, ts, nonce, deviceId, payload, signature, keyPair.publicKey);
      expect(isValid).toBe(true);
    });

    it('should reject tampered message', () => {
      const keyPair = crypto.generateKeyPair();
      const type = 'HEARTBEAT' as const;
      const ts = Date.now();
      const nonce = crypto.generateNonce();
      const deviceId = 'test-device-123';
      const payload = { appVersion: '1.0.0', trackingStatus: 'active' };

      const signature = crypto.signMessage(type, ts, nonce, deviceId, payload, keyPair.privateKey);

      // Tamper with payload
      const tamperedPayload = { appVersion: '2.0.0', trackingStatus: 'active' };
      const isValid = crypto.verifySignature(type, ts, nonce, deviceId, tamperedPayload, signature, keyPair.publicKey);
      
      expect(isValid).toBe(false);
    });

    it('should reject wrong public key', () => {
      const keyPair1 = crypto.generateKeyPair();
      const keyPair2 = crypto.generateKeyPair();
      const type = 'HEARTBEAT' as const;
      const ts = Date.now();
      const nonce = crypto.generateNonce();
      const deviceId = 'test-device-123';
      const payload = { test: 'data' };

      const signature = crypto.signMessage(type, ts, nonce, deviceId, payload, keyPair1.privateKey);
      const isValid = crypto.verifySignature(type, ts, nonce, deviceId, payload, signature, keyPair2.publicKey);
      
      expect(isValid).toBe(false);
    });
  });

  describe('Nonce Generation', () => {
    it('should generate unique nonces', () => {
      const nonces = new Set<string>();
      for (let i = 0; i < 100; i++) {
        nonces.add(crypto.generateNonce());
      }
      expect(nonces.size).toBe(100);
    });

    it('should generate 32-character hex nonces', () => {
      const nonce = crypto.generateNonce();
      expect(nonce.length).toBe(32);
      expect(/^[0-9a-f]+$/.test(nonce)).toBe(true);
    });
  });

  describe('Pair Code Generation', () => {
    it('should generate 6-digit pair codes', () => {
      const code = crypto.generatePairCode();
      expect(code.length).toBe(6);
      expect(/^\d{6}$/.test(code)).toBe(true);
    });
  });

  describe('Policy Hashing', () => {
    it('should generate consistent hashes for same policy', () => {
      const policy = { workScheduleStart: '09:00', idleThreshold: 300 };
      const hash1 = crypto.hashPolicy(policy);
      const hash2 = crypto.hashPolicy(policy);
      
      expect(hash1).toBe(hash2);
    });

    it('should generate different hashes for different policies', () => {
      const policy1 = { workScheduleStart: '09:00' };
      const policy2 = { workScheduleStart: '10:00' };
      
      const hash1 = crypto.hashPolicy(policy1);
      const hash2 = crypto.hashPolicy(policy2);
      
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Password Encryption', () => {
    it('should encrypt and decrypt data', () => {
      const data = 'secret-private-key-data';
      const password = 'test-password-123';

      const encrypted = crypto.encryptWithPassword(data, password);
      expect(encrypted).not.toBe(data);
      expect(encrypted).toContain(':'); // Format: salt:iv:authTag:encrypted

      const decrypted = crypto.decryptWithPassword(encrypted, password);
      expect(decrypted).toBe(data);
    });

    it('should fail decryption with wrong password', () => {
      const data = 'secret-data';
      const encrypted = crypto.encryptWithPassword(data, 'correct-password');

      expect(() => {
        crypto.decryptWithPassword(encrypted, 'wrong-password');
      }).toThrow();
    });
  });

  describe('Signed Message Creation', () => {
    it('should create properly structured signed message', () => {
      const keyPair = crypto.generateKeyPair();
      const message = crypto.createSignedMessage(
        'HEARTBEAT',
        'device-123',
        { appVersion: '1.0.0' },
        keyPair.privateKey
      );

      expect(message.type).toBe('HEARTBEAT');
      expect(message.deviceId).toBe('device-123');
      expect(message.payload).toEqual({ appVersion: '1.0.0' });
      expect(message.ts).toBeDefined();
      expect(message.nonce).toBeDefined();
      expect(message.signature).toBeDefined();
    });
  });
});
