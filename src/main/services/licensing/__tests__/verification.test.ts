/**
 * Verification Library Tests
 */

import {
  verifyEd25519,
  verifyActivationCert,
  computeDriftedNow,
  isExpired,
  hasFeature,
  classifyTamper,
  sha256,
  validateCertPayload,
  isWithinGracePeriod,
  timeUntilExpiry,
  formatTimeRemaining,
} from '../../../shared/licensing/verification';
import { TamperSeverity, TamperFlag } from '../../../shared/licensing/entitlements';
import * as nacl from 'tweetnacl';
import * as naclUtil from 'tweetnacl-util';

describe('Verification Library', () => {
  let publicKey: string;
  let privateKey: string;

  beforeAll(() => {
    const keypair = nacl.sign.keyPair();
    publicKey = naclUtil.encodeBase64(keypair.publicKey);
    privateKey = naclUtil.encodeBase64(keypair.secretKey);
  });

  describe('computeDriftedNow', () => {
    it('should return current time if no drift info', () => {
      const now = computeDriftedNow(null, null);
      expect(now).toBeInstanceOf(Date);
      expect(Math.abs(now.getTime() - Date.now())).toBeLessThan(100);
    });

    it('should account for time drift', () => {
      const serverTime = new Date('2026-01-15T10:00:00Z').toISOString();
      const serverLocalTime = Date.now() - 5000; // 5 seconds ago

      const drifted = computeDriftedNow(serverTime, serverLocalTime);
      const expected = new Date(serverTime).getTime() + 5000;

      expect(Math.abs(drifted.getTime() - expected)).toBeLessThan(100);
    });
  });

  describe('isExpired', () => {
    it('should return false for future expiry', () => {
      const future = new Date();
      future.setDate(future.getDate() + 1);
      const now = new Date();

      expect(isExpired(future.toISOString(), now)).toBe(false);
    });

    it('should return true for past expiry', () => {
      const past = new Date();
      past.setDate(past.getDate() - 1);
      const now = new Date();

      expect(isExpired(past.toISOString(), now)).toBe(true);
    });

    it('should return false for null expiry', () => {
      const now = new Date();
      expect(isExpired(null, now)).toBe(false);
    });
  });

  describe('hasFeature', () => {
    it('should return true for enabled features', () => {
      const features = { adminPanel: true, exports: true };
      expect(hasFeature(features, 'adminPanel')).toBe(true);
    });

    it('should return false for disabled features', () => {
      const features = { adminPanel: false, exports: true };
      expect(hasFeature(features, 'adminPanel')).toBe(false);
    });

    it('should return false for undefined features', () => {
      expect(hasFeature(undefined, 'adminPanel')).toBe(false);
    });
  });

  describe('classifyTamper', () => {
    it('should return NONE for no tampering', () => {
      const severity = classifyTamper('abc123', 'abc123', []);
      expect(severity).toBe(TamperSeverity.NONE);
    });

    it('should return LOW for single MAC change', () => {
      const flags: TamperFlag[] = [
        {
          type: 'mac',
          oldValue: 'aa:bb:cc:dd:ee:ff',
          newValue: 'aa:bb:cc:dd:ee:00',
          detectedAt: new Date().toISOString(),
        },
      ];
      const severity = classifyTamper('abc123', 'def456', flags);
      expect(severity).toBe(TamperSeverity.LOW);
    });

    it('should return MEDIUM for two component changes', () => {
      const flags: TamperFlag[] = [
        {
          type: 'cpu',
          oldValue: 'Intel Core i7',
          newValue: 'Intel Core i9',
          detectedAt: new Date().toISOString(),
        },
        {
          type: 'drive',
          oldValue: 'SN123',
          newValue: 'SN456',
          detectedAt: new Date().toISOString(),
        },
      ];
      const severity = classifyTamper('abc123', 'def456', flags);
      expect(severity).toBe(TamperSeverity.MEDIUM);
    });

    it('should return HIGH for three+ component changes', () => {
      const flags: TamperFlag[] = [
        {
          type: 'cpu',
          oldValue: 'Intel Core i7',
          newValue: 'AMD Ryzen 9',
          detectedAt: new Date().toISOString(),
        },
        {
          type: 'motherboard',
          oldValue: 'MB123',
          newValue: 'MB456',
          detectedAt: new Date().toISOString(),
        },
        {
          type: 'drive',
          oldValue: 'SN123',
          newValue: 'SN456',
          detectedAt: new Date().toISOString(),
        },
      ];
      const severity = classifyTamper('abc123', 'def456', flags);
      expect(severity).toBe(TamperSeverity.HIGH);
    });
  });

  describe('sha256', () => {
    it('should hash strings consistently', () => {
      const hash1 = sha256('test');
      const hash2 = sha256('test');
      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different inputs', () => {
      const hash1 = sha256('test1');
      const hash2 = sha256('test2');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('validateCertPayload', () => {
    it('should validate correct payload', () => {
      const payload = {
        certVersion: 1,
        licenseId: 'LIC-001',
        plan: 'pro',
        seats: 5,
        machineHash: 'abc123',
        issuedAt: new Date().toISOString(),
        features: { adminPanel: true },
      };

      const result = validateCertPayload(payload);
      expect(result.valid).toBe(true);
    });

    it('should reject missing certVersion', () => {
      const payload = {
        licenseId: 'LIC-001',
        plan: 'pro',
        seats: 5,
        machineHash: 'abc123',
        issuedAt: new Date().toISOString(),
        features: {},
      };

      const result = validateCertPayload(payload);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('certVersion');
    });

    it('should reject invalid seats', () => {
      const payload = {
        certVersion: 1,
        licenseId: 'LIC-001',
        plan: 'pro',
        seats: 0,
        machineHash: 'abc123',
        issuedAt: new Date().toISOString(),
        features: {},
      };

      const result = validateCertPayload(payload);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('seats');
    });
  });

  describe('isWithinGracePeriod', () => {
    it('should return true for recent timestamp', () => {
      const now = new Date();
      const recent = new Date(now.getTime() - 1000); // 1 second ago
      const gracePeriodMs = 72 * 60 * 60 * 1000; // 72 hours

      expect(isWithinGracePeriod(recent.toISOString(), gracePeriodMs)).toBe(true);
    });

    it('should return false for old timestamp', () => {
      const now = new Date();
      const old = new Date(now.getTime() - 100 * 60 * 60 * 1000); // 100 hours ago
      const gracePeriodMs = 72 * 60 * 60 * 1000; // 72 hours

      expect(isWithinGracePeriod(old.toISOString(), gracePeriodMs)).toBe(false);
    });

    it('should return false for null timestamp', () => {
      const gracePeriodMs = 72 * 60 * 60 * 1000;
      expect(isWithinGracePeriod(null, gracePeriodMs)).toBe(false);
    });
  });

  describe('timeUntilExpiry', () => {
    it('should return remaining time for future expiry', () => {
      const future = new Date();
      future.setHours(future.getHours() + 1);
      const now = new Date();

      const remaining = timeUntilExpiry(future.toISOString(), now);
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThan(60 * 60 * 1000 + 1000); // ~1 hour
    });

    it('should return 0 for past expiry', () => {
      const past = new Date();
      past.setHours(past.getHours() - 1);
      const now = new Date();

      const remaining = timeUntilExpiry(past.toISOString(), now);
      expect(remaining).toBe(0);
    });

    it('should return null for no expiry', () => {
      const now = new Date();
      const remaining = timeUntilExpiry(null, now);
      expect(remaining).toBeNull();
    });
  });

  describe('formatTimeRemaining', () => {
    it('should format days and hours', () => {
      const ms = 2 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000; // 2d 3h
      expect(formatTimeRemaining(ms)).toBe('2d 3h');
    });

    it('should format hours and minutes', () => {
      const ms = 5 * 60 * 60 * 1000 + 30 * 60 * 1000; // 5h 30m
      expect(formatTimeRemaining(ms)).toBe('5h 30m');
    });

    it('should format minutes only', () => {
      const ms = 45 * 60 * 1000; // 45m
      expect(formatTimeRemaining(ms)).toBe('45m');
    });
  });
});
