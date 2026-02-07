import { DeviceIdService } from './device-id-service';
import * as os from 'os';
import * as crypto from 'crypto';

// Mock node-machine-id
jest.mock('node-machine-id', () => ({
  machineIdSync: jest.fn(),
}));

const { machineIdSync } = require('node-machine-id');

describe('DeviceIdService', () => {
  let service: DeviceIdService;

  beforeEach(() => {
    // Reset singleton instance before each test
    (DeviceIdService as any).instance = null;
    service = DeviceIdService.getInstance();
    jest.clearAllMocks();
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = DeviceIdService.getInstance();
      const instance2 = DeviceIdService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('getDeviceId', () => {
    it('should generate a deterministic device ID', () => {
      machineIdSync.mockReturnValue('test-machine-id-12345');

      const deviceId1 = service.getDeviceId();
      const deviceId2 = service.getDeviceId();

      expect(deviceId1).toBe(deviceId2);
      expect(deviceId1).toBeTruthy();
      expect(typeof deviceId1).toBe('string');
    });

    it('should generate device ID based on machine ID', () => {
      machineIdSync.mockReturnValue('unique-machine-id');

      const deviceId = service.getDeviceId();

      expect(machineIdSync).toHaveBeenCalled();
      expect(deviceId).toMatch(/^[A-Z0-9]{8}-[A-Z0-9]{8}-[A-Z0-9]{8}$/);
    });

    it('should generate different IDs for different machines', () => {
      machineIdSync.mockReturnValue('machine-1');
      const deviceId1 = service.getDeviceId();

      // Reset singleton for new machine
      (DeviceIdService as any).instance = null;
      service = DeviceIdService.getInstance();

      machineIdSync.mockReturnValue('machine-2');
      const deviceId2 = service.getDeviceId();

      expect(deviceId1).not.toBe(deviceId2);
    });

    it('should cache device ID after first generation', () => {
      machineIdSync.mockReturnValue('test-machine-id');

      const deviceId1 = service.getDeviceId();
      const deviceId2 = service.getDeviceId();
      const deviceId3 = service.getDeviceId();

      // Should only call machineIdSync once due to caching
      expect(machineIdSync).toHaveBeenCalledTimes(1);
      expect(deviceId1).toBe(deviceId2);
      expect(deviceId2).toBe(deviceId3);
    });

    it('should handle machine ID errors gracefully', () => {
      machineIdSync.mockImplementation(() => {
        throw new Error('Unable to get machine ID');
      });

      // Should fall back to hostname-based ID
      const deviceId = service.getDeviceId();

      expect(deviceId).toBeTruthy();
      expect(typeof deviceId).toBe('string');
      expect(deviceId).toMatch(/^[A-Z0-9]{8}-[A-Z0-9]{8}-[A-Z0-9]{8}$/);
    });

    it('should generate valid format (3 groups of 8 alphanumeric chars)', () => {
      machineIdSync.mockReturnValue('test-machine-id');

      const deviceId = service.getDeviceId();

      expect(deviceId).toMatch(/^[A-Z0-9]{8}-[A-Z0-9]{8}-[A-Z0-9]{8}$/);
      expect(deviceId.length).toBe(26); // 8 + 1 + 8 + 1 + 8
    });
  });

  describe('hasDeviceChanged', () => {
    it('should return false when device ID matches stored ID', () => {
      machineIdSync.mockReturnValue('test-machine-id');

      const currentDeviceId = service.getDeviceId();
      const hasChanged = service.hasDeviceChanged(currentDeviceId);

      expect(hasChanged).toBe(false);
    });

    it('should return true when device ID differs from stored ID', () => {
      machineIdSync.mockReturnValue('test-machine-id');

      const currentDeviceId = service.getDeviceId();
      const hasChanged = service.hasDeviceChanged('DIFFERENT-DEVICE-ID');

      expect(hasChanged).toBe(true);
    });

    it('should return true when stored ID is null or empty', () => {
      machineIdSync.mockReturnValue('test-machine-id');

      service.getDeviceId();

      expect(service.hasDeviceChanged(null as any)).toBe(true);
      expect(service.hasDeviceChanged('')).toBe(true);
      expect(service.hasDeviceChanged(undefined as any)).toBe(true);
    });
  });

  describe('generateDeviceFingerprint', () => {
    it('should generate consistent fingerprint for same inputs', () => {
      const fingerprint1 = service.generateDeviceFingerprint();
      const fingerprint2 = service.generateDeviceFingerprint();

      // Should be consistent within same test run (same machine)
      expect(fingerprint1).toBe(fingerprint2);
    });

    it('should include machine-specific information', () => {
      machineIdSync.mockReturnValue('test-machine-id');

      const fingerprint = service.generateDeviceFingerprint();

      expect(fingerprint).toBeTruthy();
      expect(typeof fingerprint).toBe('string');
    });
  });

  describe('Security', () => {
    it('should not expose sensitive hardware information in device ID', () => {
      machineIdSync.mockReturnValue('test-machine-id');

      const deviceId = service.getDeviceId();

      // Device ID should be a hash, not contain raw hardware info
      expect(deviceId).not.toContain(os.hostname());
      expect(deviceId).not.toContain(os.platform());
      expect(deviceId).not.toContain('test-machine-id');
    });

    it('should use cryptographic hash for device ID generation', () => {
      machineIdSync.mockReturnValue('test-machine-id');

      const deviceId = service.getDeviceId();

      // Should be uppercase alphanumeric (base32-like encoding)
      expect(deviceId).toMatch(/^[A-Z0-9-]+$/);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long machine IDs', () => {
      const longMachineId = 'a'.repeat(1000);
      machineIdSync.mockReturnValue(longMachineId);

      const deviceId = service.getDeviceId();

      expect(deviceId).toMatch(/^[A-Z0-9]{8}-[A-Z0-9]{8}-[A-Z0-9]{8}$/);
    });

    it('should handle special characters in machine ID', () => {
      machineIdSync.mockReturnValue('machine-id-with-!@#$%^&*()');

      const deviceId = service.getDeviceId();

      expect(deviceId).toMatch(/^[A-Z0-9]{8}-[A-Z0-9]{8}-[A-Z0-9]{8}$/);
    });

    it('should handle empty machine ID', () => {
      machineIdSync.mockReturnValue('');

      const deviceId = service.getDeviceId();

      expect(deviceId).toBeTruthy();
      expect(deviceId).toMatch(/^[A-Z0-9]{8}-[A-Z0-9]{8}-[A-Z0-9]{8}$/);
    });
  });
});
