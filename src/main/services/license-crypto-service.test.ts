import { LicenseCryptoService } from './license-crypto-service';
import { LicensePayload } from '../../shared/types';

describe('LicenseCryptoService', () => {
  let service: LicenseCryptoService;
  let publicKey: string;
  let privateKey: string;

  beforeEach(() => {
    service = LicenseCryptoService.getInstance();
    // Generate a test key pair
    const keyPair = service.generateKeyPair();
    publicKey = keyPair.publicKey;
    privateKey = keyPair.privateKey;
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = LicenseCryptoService.getInstance();
      const instance2 = LicenseCryptoService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('generateKeyPair', () => {
    it('should generate a valid Ed25519 key pair', () => {
      const keyPair = service.generateKeyPair();

      expect(keyPair.publicKey).toBeTruthy();
      expect(keyPair.privateKey).toBeTruthy();
      expect(typeof keyPair.publicKey).toBe('string');
      expect(typeof keyPair.privateKey).toBe('string');
    });

    it('should generate different key pairs each time', () => {
      const keyPair1 = service.generateKeyPair();
      const keyPair2 = service.generateKeyPair();

      expect(keyPair1.publicKey).not.toBe(keyPair2.publicKey);
      expect(keyPair1.privateKey).not.toBe(keyPair2.privateKey);
    });

    it('should generate base64-encoded keys', () => {
      const keyPair = service.generateKeyPair();

      // Base64 regex
      const base64Regex = /^[A-Za-z0-9+/]+=*$/;
      expect(keyPair.publicKey).toMatch(base64Regex);
      expect(keyPair.privateKey).toMatch(base64Regex);
    });
  });

  describe('signLicense', () => {
    it('should sign a license payload', () => {
      const payload: LicensePayload = {
        version: 1,
        licenseId: 'TEST-001',
        productCode: 'PT',
        plan: 'pro',
        seats: 3,
        expiryDate: '2026-12-31',
        issuedAt: '2025-01-01',
      };

      const signedLicense = service.signLicense(payload, privateKey);

      expect(signedLicense.payload).toBeTruthy();
      expect(signedLicense.signature).toBeTruthy();
      expect(typeof signedLicense.payload).toBe('string');
      expect(typeof signedLicense.signature).toBe('string');
    });

    it('should produce different signatures for different payloads', () => {
      const payload1: LicensePayload = {
        version: 1,
        licenseId: 'TEST-001',
        productCode: 'PT',
        plan: 'pro',
        seats: 3,
        expiryDate: null,
        issuedAt: '2025-01-01',
      };

      const payload2: LicensePayload = {
        version: 1,
        licenseId: 'TEST-002',
        productCode: 'PT',
        plan: 'basic',
        seats: 1,
        expiryDate: null,
        issuedAt: '2025-01-01',
      };

      const signed1 = service.signLicense(payload1, privateKey);
      const signed2 = service.signLicense(payload2, privateKey);

      expect(signed1.signature).not.toBe(signed2.signature);
      expect(signed1.payload).not.toBe(signed2.payload);
    });

    it('should throw error for invalid private key', () => {
      const payload: LicensePayload = {
        version: 1,
        licenseId: 'TEST-001',
        productCode: 'PT',
        plan: 'pro',
        seats: 3,
        expiryDate: null,
        issuedAt: '2025-01-01',
      };

      expect(() => {
        service.signLicense(payload, 'invalid-key');
      }).toThrow();
    });
  });

  describe('verifyLicense', () => {
    it('should verify a valid signed license', () => {
      const payload: LicensePayload = {
        version: 1,
        licenseId: 'TEST-001',
        productCode: 'PT',
        plan: 'pro',
        seats: 3,
        expiryDate: '2026-12-31',
        issuedAt: '2025-01-01',
      };

      const signedLicense = service.signLicense(payload, privateKey);
      const isValid = service.verifyLicense(signedLicense, publicKey);

      expect(isValid).toBe(true);
    });

    it('should reject a license with tampered payload', () => {
      const payload: LicensePayload = {
        version: 1,
        licenseId: 'TEST-001',
        productCode: 'PT',
        plan: 'basic',
        seats: 1,
        expiryDate: null,
        issuedAt: '2025-01-01',
      };

      const signedLicense = service.signLicense(payload, privateKey);

      // Tamper with the payload
      const tamperedPayload = Buffer.from(signedLicense.payload, 'base64').toString();
      const modified = tamperedPayload.replace('"basic"', '"pro"');
      signedLicense.payload = Buffer.from(modified).toString('base64');

      const isValid = service.verifyLicense(signedLicense, publicKey);

      expect(isValid).toBe(false);
    });

    it('should reject a license with invalid signature', () => {
      const payload: LicensePayload = {
        version: 1,
        licenseId: 'TEST-001',
        productCode: 'PT',
        plan: 'pro',
        seats: 3,
        expiryDate: null,
        issuedAt: '2025-01-01',
      };

      const signedLicense = service.signLicense(payload, privateKey);
      signedLicense.signature = 'invalid-signature-base64==';

      const isValid = service.verifyLicense(signedLicense, publicKey);

      expect(isValid).toBe(false);
    });

    it('should reject a license signed with different key', () => {
      const payload: LicensePayload = {
        version: 1,
        licenseId: 'TEST-001',
        productCode: 'PT',
        plan: 'pro',
        seats: 3,
        expiryDate: null,
        issuedAt: '2025-01-01',
      };

      const otherKeyPair = service.generateKeyPair();
      const signedLicense = service.signLicense(payload, otherKeyPair.privateKey);

      // Try to verify with original public key
      const isValid = service.verifyLicense(signedLicense, publicKey);

      expect(isValid).toBe(false);
    });
  });

  describe('parseLicensePayload', () => {
    it('should parse a valid license payload', () => {
      const payload: LicensePayload = {
        version: 1,
        licenseId: 'TEST-001',
        productCode: 'PT',
        plan: 'pro',
        seats: 3,
        expiryDate: '2026-12-31',
        issuedAt: '2025-01-01',
      };

      const signedLicense = service.signLicense(payload, privateKey);
      const parsed = service.parseLicensePayload(signedLicense);

      expect(parsed).toEqual(payload);
    });

    it('should throw error for invalid base64 payload', () => {
      const invalidLicense = {
        payload: 'not-valid-base64!!!',
        signature: 'some-signature',
      };

      expect(() => {
        service.parseLicensePayload(invalidLicense);
      }).toThrow();
    });

    it('should throw error for invalid JSON payload', () => {
      const invalidLicense = {
        payload: Buffer.from('not valid json').toString('base64'),
        signature: 'some-signature',
      };

      expect(() => {
        service.parseLicensePayload(invalidLicense);
      }).toThrow();
    });
  });

  describe('formatLicenseKey', () => {
    it('should format a signed license as a license key string', () => {
      const payload: LicensePayload = {
        version: 1,
        licenseId: 'TEST-001',
        productCode: 'PT',
        plan: 'pro',
        seats: 3,
        expiryDate: null,
        issuedAt: '2025-01-01',
      };

      const signedLicense = service.signLicense(payload, privateKey);
      const licenseKey = service.formatLicenseKey(signedLicense);

      expect(licenseKey).toContain('.');
      expect(typeof licenseKey).toBe('string');

      const parts = licenseKey.split('.');
      expect(parts).toHaveLength(2);
      expect(parts[0]).toBe(signedLicense.payload);
      expect(parts[1]).toBe(signedLicense.signature);
    });
  });

  describe('parseLicenseKey', () => {
    it('should parse a valid license key string', () => {
      const payload: LicensePayload = {
        version: 1,
        licenseId: 'TEST-001',
        productCode: 'PT',
        plan: 'pro',
        seats: 3,
        expiryDate: null,
        issuedAt: '2025-01-01',
      };

      const signedLicense = service.signLicense(payload, privateKey);
      const licenseKey = service.formatLicenseKey(signedLicense);
      const parsed = service.parseLicenseKey(licenseKey);

      expect(parsed.payload).toBe(signedLicense.payload);
      expect(parsed.signature).toBe(signedLicense.signature);
    });

    it('should throw error for invalid license key format', () => {
      expect(() => {
        service.parseLicenseKey('invalid-key-no-dot');
      }).toThrow();

      expect(() => {
        service.parseLicenseKey('too.many.dots.here');
      }).toThrow();

      expect(() => {
        service.parseLicenseKey('');
      }).toThrow();
    });
  });
});

