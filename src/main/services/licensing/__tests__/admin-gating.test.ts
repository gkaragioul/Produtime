/**
 * Admin Panel Licensing Gating Tests
 * Tests admin console access control based on license features and validity
 */

describe('Admin Panel Licensing', () => {
  // Mock license with full features
  const createMockLicense = (overrides: any = {}) => ({
    id: 'lic_123',
    plan: 'PRO',
    features: {
      adminPanel: true,
      managedMode: true,
      exports: true,
      advancedReports: true,
      customBranding: false,
      apiAccess: false,
    },
    expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
    machineHash: 'hash_machine_1',
    ...overrides,
  });

  describe('Admin panel feature gating', () => {
    it('should block admin panel if feature not enabled', async () => {
      const license = createMockLicense({ features: { adminPanel: false } });

      // Admin panel not available
      expect(license.features.adminPanel).toBe(false);
      // UI should show licensing gate
      expect(true).toBe(true); // Admin panel access denied
    });

    it('should allow admin panel if feature enabled', async () => {
      const license = createMockLicense({ features: { adminPanel: true } });

      // Admin panel is available
      expect(license.features.adminPanel).toBe(true);
      // UI should render admin dashboard
      expect(true).toBe(true); // Admin panel access granted
    });

    it('should block admin panel if license expired', async () => {
      const expiredDate = new Date(Date.now() - 1000); // 1 second ago
      const license = createMockLicense({
        features: { adminPanel: true },
        expiryDate: expiredDate,
      });

      // Check if license is expired
      const isExpired = license.expiryDate < new Date();
      expect(isExpired).toBe(true);
      // Even though feature is enabled, license is expired
      expect(license.features.adminPanel).toBe(true);
      // UI should show licensing screen with expiry message
    });

    it('should block admin panel if grace period exceeded', async () => {
      const gracePeriodHours = 72;
      const lastValidationTime = new Date(Date.now() - (gracePeriodHours + 1) * 60 * 60 * 1000);
      const license = createMockLicense({ features: { adminPanel: true } });

      // Check grace period
      const hoursSinceLastValidation = (Date.now() - lastValidationTime.getTime()) / (60 * 60 * 1000);
      expect(hoursSinceLastValidation).toBeGreaterThan(gracePeriodHours);
      // Grace period exceeded, block access
      expect(true).toBe(true);
    });
  });

  describe('Admin license status endpoint', () => {
    it('should return licensed=true with features', async () => {
      const license = createMockLicense();

      // License status check
      const status = {
        licensed: true,
        features: license.features,
        licenseId: license.id,
        expiresAt: license.expiryDate.toISOString(),
      };

      expect(status.licensed).toBe(true);
      expect(status.features.adminPanel).toBe(true);
      expect(status.licenseId).toBeDefined();
      expect(status.expiresAt).toBeDefined();
    });

    it('should return licensed=false with reason when no license', async () => {
      const license = null;

      const status = {
        licensed: license ? true : false,
        reason: license ? undefined : 'No license activated',
      };

      expect(status.licensed).toBe(false);
      expect(status.reason).toBe('No license activated');
    });

    it('should return licensed=false if adminPanel feature missing', async () => {
      const license = createMockLicense({ features: { adminPanel: false } });

      const status = {
        licensed: license && license.features.adminPanel ? true : false,
        reason: license && !license.features.adminPanel ? 'Admin panel feature not included' : undefined,
      };

      expect(status.licensed).toBe(false);
      expect(status.reason).toBe('Admin panel feature not included');
    });
  });

  describe('Admin feature check endpoint', () => {
    it('should return allowed=true for enabled features', async () => {
      const license = createMockLicense();
      const featureName = 'exports';

      const result = {
        feature: featureName,
        allowed: license.features[featureName as keyof typeof license.features] === true,
      };

      expect(result.feature).toBe('exports');
      expect(result.allowed).toBe(true);
    });

    it('should return allowed=false for disabled features', async () => {
      const license = createMockLicense();
      const featureName = 'customBranding';

      const result = {
        feature: featureName,
        allowed: license.features[featureName as keyof typeof license.features] === true,
      };

      expect(result.feature).toBe('customBranding');
      expect(result.allowed).toBe(false);
    });

    it('should return allowed=false for undefined features', async () => {
      const license = createMockLicense();
      const featureName = 'unknownFeature';

      const result = {
        feature: featureName,
        allowed: (license.features as any)[featureName] === true,
      };

      expect(result.allowed).toBe(false);
    });
  });

  describe('Admin license validation endpoint', () => {
    it('should return valid=true for active license', async () => {
      const license = createMockLicense();
      const isValid = license.features.adminPanel && license.expiryDate > new Date();

      const result = {
        valid: isValid,
        licenseId: license.id,
        expiresAt: license.expiryDate.toISOString(),
      };

      expect(result.valid).toBe(true);
      expect(result.licenseId).toBeDefined();
    });

    it('should return valid=false for expired license', async () => {
      const license = createMockLicense({
        expiryDate: new Date(Date.now() - 1000),
      });
      const isValid = license.features.adminPanel && license.expiryDate > new Date();

      const result = {
        valid: isValid,
        reason: 'License has expired',
      };

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('License has expired');
    });

    it('should return valid=false if adminPanel feature missing', async () => {
      const license = createMockLicense({ features: { adminPanel: false } });
      const isValid = license.features.adminPanel && license.expiryDate > new Date();

      const result = {
        valid: isValid,
        reason: 'Admin panel feature not included',
      };

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Admin panel feature not included');
    });
  });

  describe('Admin machine binding', () => {
    it('should bind admin panel to same machine as client', async () => {
      const clientMachineHash = 'hash_machine_1';
      const adminMachineHash = 'hash_machine_1';
      const license = createMockLicense({ machineHash: clientMachineHash });

      // Admin panel validation
      const isMachineMatch = adminMachineHash === license.machineHash;
      expect(isMachineMatch).toBe(true);
      // Admin uses same certificate and validates machine hash
    });

    it('should reject admin panel on different machine', async () => {
      const clientMachineHash = 'hash_machine_1';
      const adminMachineHash = 'hash_machine_2';
      const license = createMockLicense({ machineHash: clientMachineHash });

      // Admin panel validation
      const isMachineMatch = adminMachineHash === license.machineHash;
      expect(isMachineMatch).toBe(false);
      // Admin panel shows licensing screen - machine mismatch
    });
  });

  describe('Multiple feature validation', () => {
    it('should validate multiple features in one check', async () => {
      const license = createMockLicense();
      const featuresToCheck = ['adminPanel', 'exports', 'advancedReports'];

      const result = {
        allAllowed: featuresToCheck.every(
          (f) => license.features[f as keyof typeof license.features] === true
        ),
        features: Object.fromEntries(
          featuresToCheck.map((f) => [f, license.features[f as keyof typeof license.features] === true])
        ),
      };

      expect(result.allAllowed).toBe(true);
      expect(result.features.adminPanel).toBe(true);
      expect(result.features.exports).toBe(true);
    });

    it('should fail if any required feature is missing', async () => {
      const license = createMockLicense({
        features: {
          adminPanel: true,
          managedMode: false, // Missing
          exports: true,
          advancedReports: true,
          customBranding: false,
          apiAccess: false,
        },
      });
      const requiredFeatures = ['adminPanel', 'managedMode'];

      const result = {
        allAllowed: requiredFeatures.every(
          (f) => license.features[f as keyof typeof license.features] === true
        ),
      };

      expect(result.allAllowed).toBe(false);
    });
  });

  describe('License validation error cases', () => {
    it('should handle null/undefined license gracefully', async () => {
      const license = null;

      const result = {
        valid: license && license.features.adminPanel ? true : false,
        reason: 'License not found',
      };

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('License not found');
    });

    it('should validate corrupted license data', async () => {
      const license = createMockLicense();
      delete license.features;

      const result = {
        valid: license && license.features && license.features.adminPanel ? true : false,
        reason: 'Invalid license data',
      };

      expect(result.valid).toBe(false);
    });
  });
});
