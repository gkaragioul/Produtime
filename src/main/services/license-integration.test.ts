/**
 * Integration Tests for License System
 * 
 * Tests the complete licensing flow including:
 * - First-run activation
 * - Manual activation
 * - Hardware change detection
 * - License expiry
 * - Seat limit enforcement
 * - Grace periods
 */

import { LicenseService } from './license-service';
import { LicenseCryptoService } from './license-crypto-service';
import { DeviceIdService } from './device-id-service';
import { DatabaseManager } from '../database';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

describe('License System Integration Tests', () => {
  let db: DatabaseManager;
  let licenseService: LicenseService;
  let cryptoService: LicenseCryptoService;
  let deviceIdService: DeviceIdService;
  let publicKey: string;
  let privateKey: string;
  let testDbPath: string;

  beforeAll(() => {
    // Generate test keypair
    const { publicKey: pubKey, privateKey: privKey } = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'der' },
      privateKeyEncoding: { type: 'pkcs8', format: 'der' }
    });
    publicKey = pubKey.toString('base64');
    privateKey = privKey.toString('base64');
  });

  beforeEach(() => {
    // Create test database
    testDbPath = path.join(__dirname, `test-license-${Date.now()}.db`);
    db = new DatabaseManager(testDbPath);
    
    // Initialize services
    licenseService = LicenseService.getInstance(db, publicKey);
    cryptoService = LicenseCryptoService.getInstance();
    deviceIdService = DeviceIdService.getInstance();
  });

  afterEach(() => {
    // Clean up
    db.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('First-Run Activation', () => {
    it('should successfully activate a valid license', async () => {
      const deviceId = deviceIdService.getDeviceId();
      const licenseKey = generateTestLicense({
        plan: 'pro',
        seats: 5,
        expiryDate: null // Perpetual
      });

      // Mock server response
      const mockActivationCode = generateActivationCode(licenseKey, deviceId);

      // Activate
      const result = await licenseService.activateLicense(licenseKey, deviceId, mockActivationCode);

      expect(result.success).toBe(true);
      expect(result.plan).toBe('pro');
      expect(result.expiryDate).toBeNull();

      // Verify activation is stored
      const status = licenseService.getActivationStatus();
      expect(status.isActivated).toBe(true);
      expect(status.plan).toBe('pro');
    });

    it('should reject invalid license key', async () => {
      const deviceId = deviceIdService.getDeviceId();
      const invalidKey = 'invalid.license.key';

      await expect(
        licenseService.activateLicense(invalidKey, deviceId, 'fake-code')
      ).rejects.toThrow('Invalid license key');
    });

    it('should reject expired license', async () => {
      const deviceId = deviceIdService.getDeviceId();
      const expiredLicense = generateTestLicense({
        plan: 'pro',
        seats: 5,
        expiryDate: '2020-01-01' // Expired
      });

      const mockActivationCode = generateActivationCode(expiredLicense, deviceId);

      await expect(
        licenseService.activateLicense(expiredLicense, deviceId, mockActivationCode)
      ).rejects.toThrow('License has expired');
    });
  });

  describe('Manual Activation', () => {
    it('should activate with manual activation code', async () => {
      const deviceId = deviceIdService.getDeviceId();
      const licenseKey = generateTestLicense({
        plan: 'enterprise',
        seats: 10,
        expiryDate: '2026-12-31'
      });

      const activationCode = generateActivationCode(licenseKey, deviceId);

      const result = await licenseService.manualActivate(licenseKey, activationCode);

      expect(result.success).toBe(true);
      expect(result.plan).toBe('enterprise');

      const status = licenseService.getActivationStatus();
      expect(status.isActivated).toBe(true);
    });

    it('should reject mismatched activation code', async () => {
      const deviceId = deviceIdService.getDeviceId();
      const licenseKey = generateTestLicense({
        plan: 'pro',
        seats: 5,
        expiryDate: null
      });

      // Generate code for different device
      const wrongActivationCode = generateActivationCode(licenseKey, 'DIFFERENT-DEVICE-ID');

      await expect(
        licenseService.manualActivate(licenseKey, wrongActivationCode)
      ).rejects.toThrow('Invalid activation code');
    });
  });

  describe('Hardware Change Detection', () => {
    it('should detect hardware change and require reactivation', async () => {
      const originalDeviceId = deviceIdService.getDeviceId();
      const licenseKey = generateTestLicense({
        plan: 'pro',
        seats: 5,
        expiryDate: null
      });

      // Initial activation
      const activationCode = generateActivationCode(licenseKey, originalDeviceId);
      await licenseService.activateLicense(licenseKey, originalDeviceId, activationCode);

      // Simulate hardware change by manually updating device ID in database
      const newDeviceId = 'NEW-HARDWARE-DEVICE-ID';
      db.updateLicenseActivation(originalDeviceId, { deviceId: newDeviceId });

      // Validate should detect mismatch
      const status = licenseService.validateActivation();

      expect(status.requiresReactivation).toBe(true);
      expect(status.message).toContain('hardware change');
    });

    it('should allow reactivation after hardware change within grace period', async () => {
      const originalDeviceId = deviceIdService.getDeviceId();
      const licenseKey = generateTestLicense({
        plan: 'pro',
        seats: 5,
        expiryDate: null
      });

      // Initial activation
      const activationCode1 = generateActivationCode(licenseKey, originalDeviceId);
      await licenseService.activateLicense(licenseKey, originalDeviceId, activationCode1);

      // Deactivate
      licenseService.deactivateLicense();

      // Reactivate on new device
      const newDeviceId = 'NEW-DEVICE-ID';
      const activationCode2 = generateActivationCode(licenseKey, newDeviceId);
      const result = await licenseService.activateLicense(licenseKey, newDeviceId, activationCode2);

      expect(result.success).toBe(true);
    });
  });

  describe('License Expiry', () => {
    it('should allow activation of license expiring in future', async () => {
      const deviceId = deviceIdService.getDeviceId();
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);
      
      const licenseKey = generateTestLicense({
        plan: 'pro',
        seats: 5,
        expiryDate: futureDate.toISOString().split('T')[0]
      });

      const activationCode = generateActivationCode(licenseKey, deviceId);
      const result = await licenseService.activateLicense(licenseKey, deviceId, activationCode);

      expect(result.success).toBe(true);
    });

    it('should enter grace period when license expires', async () => {
      const deviceId = deviceIdService.getDeviceId();
      
      // Create license that expires tomorrow
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const licenseKey = generateTestLicense({
        plan: 'pro',
        seats: 5,
        expiryDate: tomorrow.toISOString().split('T')[0]
      });

      const activationCode = generateActivationCode(licenseKey, deviceId);
      await licenseService.activateLicense(licenseKey, deviceId, activationCode);

      // Manually set expiry to yesterday to simulate expiration
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      db.updateLicenseActivation(deviceId, { 
        expiryDate: yesterday.toISOString() 
      });

      const status = licenseService.validateActivation();

      expect(status.isActivated).toBe(true); // Still activated during grace period
      expect(status.gracePeriodEndsAt).toBeDefined();
      expect(status.message).toContain('grace period');
    });
  });

  describe('Deactivation', () => {
    it('should successfully deactivate license', async () => {
      const deviceId = deviceIdService.getDeviceId();
      const licenseKey = generateTestLicense({
        plan: 'pro',
        seats: 5,
        expiryDate: null
      });

      const activationCode = generateActivationCode(licenseKey, deviceId);
      await licenseService.activateLicense(licenseKey, deviceId, activationCode);

      // Verify activated
      let status = licenseService.getActivationStatus();
      expect(status.isActivated).toBe(true);

      // Deactivate
      licenseService.deactivateLicense();

      // Verify deactivated
      status = licenseService.getActivationStatus();
      expect(status.isActivated).toBe(false);
    });
  });

  // Helper functions
  function generateTestLicense(options: {
    plan: 'basic' | 'pro' | 'enterprise';
    seats: number;
    expiryDate: string | null;
  }): string {
    const payload = {
      ver: 1,
      lic: `TEST-${Date.now()}`,
      prod: 'PT',
      plan: options.plan,
      seats: options.seats,
      exp: options.expiryDate ? Math.floor(new Date(options.expiryDate).getTime() / 1000) : null,
      iat: Math.floor(Date.now() / 1000)
    };

    const payloadJson = JSON.stringify(payload);
    const payloadBuffer = Buffer.from(payloadJson, 'utf-8');
    const payloadBase64 = payloadBuffer.toString('base64url');

    const privateKeyBuffer = Buffer.from(privateKey, 'base64');
    const privateKeyObject = crypto.createPrivateKey({
      key: privateKeyBuffer,
      format: 'der',
      type: 'pkcs8'
    });

    const signature = crypto.sign(null, payloadBuffer, privateKeyObject);
    const signatureBase64 = signature.toString('base64url');

    return `${payloadBase64}.${signatureBase64}`;
  }

  function generateActivationCode(licenseKey: string, deviceId: string): string {
    const payload = {
      licenseKey,
      deviceId,
      activatedAt: new Date().toISOString()
    };

    const payloadJson = JSON.stringify(payload);
    const payloadBuffer = Buffer.from(payloadJson, 'utf-8');

    const privateKeyBuffer = Buffer.from(privateKey, 'base64');
    const privateKeyObject = crypto.createPrivateKey({
      key: privateKeyBuffer,
      format: 'der',
      type: 'pkcs8'
    });

    const signature = crypto.sign(null, payloadBuffer, privateKeyObject);
    return signature.toString('base64url');
  }
});

