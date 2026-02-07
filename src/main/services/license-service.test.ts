import { LicenseService } from './license-service';
import { DatabaseManager } from '../database';
import { LicensePayload } from '../../shared/types';

// Create mock instances before mocking modules
const mockCryptoInstance = {
  parseLicenseKey: jest.fn(),
  verifyLicense: jest.fn(),
  parseLicensePayload: jest.fn(),
  verifyActivationCode: jest.fn(),
};

const mockDeviceIdInstance = {
  getDeviceId: jest.fn().mockReturnValue('TEST1234-ABCD5678-EFGH9012'),
  hasDeviceChanged: jest.fn().mockReturnValue(false),
};

// Mock the modules
jest.mock('../database');

jest.mock('./license-crypto-service', () => {
  return {
    LicenseCryptoService: {
      getInstance: jest.fn(() => mockCryptoInstance),
    },
  };
});

jest.mock('./device-id-service', () => {
  return {
    DeviceIdService: {
      getInstance: jest.fn(() => mockDeviceIdInstance),
    },
  };
});

describe('LicenseService', () => {
  let service: LicenseService;
  let mockDb: any;
  let testPublicKey: string;

  beforeEach(() => {
    // Reset singleton
    (LicenseService as any).instance = null;

    // Create mock database
    mockDb = {
      saveLicenseActivation: jest.fn(),
      getLicenseActivation: jest.fn(),
      updateLicenseValidation: jest.fn(),
      deleteLicenseActivation: jest.fn(),
    };

    // Generate a test key pair using real crypto
    const RealLicenseCryptoService = jest.requireActual(
      './license-crypto-service'
    ).LicenseCryptoService;
    const realCrypto = new RealLicenseCryptoService();
    const keyPair = realCrypto.generateKeyPair();
    testPublicKey = keyPair.publicKey;

    // Create service instance
    service = LicenseService.getInstance(mockDb, testPublicKey);

    // Clear all mocks
    jest.clearAllMocks();
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = LicenseService.getInstance(mockDb, testPublicKey);
      const instance2 = LicenseService.getInstance(mockDb, testPublicKey);
      expect(instance1).toBe(instance2);
    });
  });

  describe('getDeviceId', () => {
    it('should return device ID from DeviceIdService', () => {
      const deviceId = service.getDeviceId();
      expect(deviceId).toBe('TEST1234-ABCD5678-EFGH9012');
      expect(mockDeviceIdInstance.getDeviceId).toHaveBeenCalled();
    });
  });

  describe('activateLicense', () => {
    it('should activate a valid license key', async () => {
      const licenseKey = 'test.license.key';
      const deviceId = 'TEST1234-ABCD5678-EFGH9012';

      const mockPayload: LicensePayload = {
        version: 1,
        licenseId: 'LIC-001',
        productCode: 'PT',
        plan: 'pro',
        seats: 3,
        expiryDate: '2026-12-31',
        issuedAt: '2025-01-01',
      };

      mockCryptoInstance.parseLicenseKey.mockReturnValue({
        payload: 'payload',
        signature: 'signature',
      });
      mockCryptoInstance.verifyLicense.mockReturnValue(true);
      mockCryptoInstance.parseLicensePayload.mockReturnValue(mockPayload);

      // Mock successful server activation
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          activationCode: 'activation-code-123',
        }),
      });

      mockDb.saveLicenseActivation.mockReturnValue(1);

      const result = await service.activateLicense(licenseKey, deviceId);

      expect(result.success).toBe(true);
      expect(result.activationCode).toBe('activation-code-123');
      expect(mockCryptoInstance.parseLicenseKey).toHaveBeenCalledWith(
        licenseKey
      );
      expect(mockCryptoInstance.verifyLicense).toHaveBeenCalled();
      expect(mockDb.saveLicenseActivation).toHaveBeenCalled();
    });

    it('should reject invalid license signature', async () => {
      const licenseKey = 'invalid.license.key';
      const deviceId = 'TEST1234-ABCD5678-EFGH9012';

      mockCryptoInstance.parseLicenseKey.mockReturnValue({
        payload: 'payload',
        signature: 'signature',
      });
      mockCryptoInstance.verifyLicense.mockReturnValue(false);

      const result = await service.activateLicense(licenseKey, deviceId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid license signature');
      expect(mockDb.saveLicenseActivation).not.toHaveBeenCalled();
    });

    it('should reject expired license', async () => {
      const licenseKey = 'expired.license.key';
      const deviceId = 'TEST1234-ABCD5678-EFGH9012';

      const mockPayload: LicensePayload = {
        version: 1,
        licenseId: 'LIC-001',
        productCode: 'PT',
        plan: 'pro',
        seats: 3,
        expiryDate: '2020-01-01', // Expired
        issuedAt: '2019-01-01',
      };

      mockCryptoInstance.parseLicenseKey.mockReturnValue({
        payload: 'payload',
        signature: 'signature',
      });
      mockCryptoInstance.verifyLicense.mockReturnValue(true);
      mockCryptoInstance.parseLicensePayload.mockReturnValue(mockPayload);

      const result = await service.activateLicense(licenseKey, deviceId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('expired');
    });

    it('should handle server activation failure', async () => {
      const licenseKey = 'test.license.key';
      const deviceId = 'TEST1234-ABCD5678-EFGH9012';

      const mockPayload: LicensePayload = {
        version: 1,
        licenseId: 'LIC-001',
        productCode: 'PT',
        plan: 'pro',
        seats: 3,
        expiryDate: null,
        issuedAt: '2025-01-01',
      };

      mockCrypto.parseLicenseKey.mockReturnValue({
        payload: 'payload',
        signature: 'signature',
      });
      mockCrypto.verifyLicense.mockReturnValue(true);
      mockCrypto.parseLicensePayload.mockReturnValue(mockPayload);

      // Mock server rejection (seat limit reached)
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({
          success: false,
          error: 'Seat limit reached',
        }),
      });

      const result = await service.activateLicense(licenseKey, deviceId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Seat limit reached');
    });

    it('should handle network errors gracefully', async () => {
      const licenseKey = 'test.license.key';
      const deviceId = 'TEST1234-ABCD5678-EFGH9012';

      const mockPayload: LicensePayload = {
        version: 1,
        licenseId: 'LIC-001',
        productCode: 'PT',
        plan: 'pro',
        seats: 3,
        expiryDate: null,
        issuedAt: '2025-01-01',
      };

      mockCrypto.parseLicenseKey.mockReturnValue({
        payload: 'payload',
        signature: 'signature',
      });
      mockCrypto.verifyLicense.mockReturnValue(true);
      mockCrypto.parseLicensePayload.mockReturnValue(mockPayload);

      // Mock network error
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      const result = await service.activateLicense(licenseKey, deviceId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
    });
  });

  describe('validateActivation', () => {
    it('should validate active license', () => {
      const deviceId = 'TEST1234-ABCD5678-EFGH9012';

      mockDb.getLicenseActivation.mockReturnValue({
        id: 1,
        license_key: 'test.key',
        device_id: deviceId,
        activation_code: 'code',
        plan: 'pro',
        expiry_date: '2026-12-31',
        activated_at: '2025-01-01T00:00:00Z',
        last_validated_at: new Date().toISOString(),
      });

      const result = service.validateActivation();

      expect(result.isActivated).toBe(true);
      expect(result.plan).toBe('pro');
      expect(result.requiresReactivation).toBe(false);
    });

    it('should detect hardware change and require reactivation', () => {
      const oldDeviceId = 'OLD12345-ABCD5678-EFGH9012';
      const newDeviceId = 'NEW12345-ABCD5678-EFGH9012';

      mockDeviceId.getDeviceId.mockReturnValue(newDeviceId);
      mockDeviceId.hasDeviceChanged.mockReturnValue(true);

      mockDb.getLicenseActivation.mockReturnValue({
        id: 1,
        license_key: 'test.key',
        device_id: oldDeviceId,
        activation_code: 'code',
        plan: 'pro',
        expiry_date: null,
        activated_at: '2025-01-01T00:00:00Z',
        last_validated_at: new Date().toISOString(),
      });

      const result = service.validateActivation();

      expect(result.isActivated).toBe(true);
      expect(result.requiresReactivation).toBe(true);
      expect(result.message).toContain('Hardware change detected');
    });

    it('should return not activated when no license exists', () => {
      mockDb.getLicenseActivation.mockReturnValue(null);

      const result = service.validateActivation();

      expect(result.isActivated).toBe(false);
      expect(result.message).toContain('No license activation found');
    });
  });

  describe('deactivateLicense', () => {
    it('should deactivate license', () => {
      const deviceId = 'TEST1234-ABCD5678-EFGH9012';

      mockDb.deleteLicenseActivation.mockImplementation(() => {});

      service.deactivateLicense();

      expect(mockDb.deleteLicenseActivation).toHaveBeenCalledWith(deviceId);
    });
  });
});
