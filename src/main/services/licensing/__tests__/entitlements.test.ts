/**
 * Entitlements & Features Tests
 */

import {
  isFeatureAllowed,
  getFeaturesForPlan,
  mergeFeatures,
  PLAN_FEATURES,
} from '../../../shared/licensing/entitlements';

describe('Entitlements', () => {
  describe('isFeatureAllowed', () => {
    it('should return true for allowed features', () => {
      const features = { adminPanel: true, exports: true };
      expect(isFeatureAllowed(features, 'adminPanel')).toBe(true);
      expect(isFeatureAllowed(features, 'exports')).toBe(true);
    });

    it('should return false for disallowed features', () => {
      const features = { adminPanel: false, exports: true };
      expect(isFeatureAllowed(features, 'adminPanel')).toBe(false);
    });

    it('should return false for undefined features', () => {
      const features = { exports: true };
      expect(isFeatureAllowed(features, 'adminPanel')).toBe(false);
    });

    it('should return false for undefined feature object', () => {
      expect(isFeatureAllowed(undefined, 'adminPanel')).toBe(false);
    });
  });

  describe('getFeaturesForPlan', () => {
    it('should return trial features', () => {
      const features = getFeaturesForPlan('trial');
      expect(features.adminPanel).toBe(false);
      expect(features.managedMode).toBe(false);
      expect(features.exports).toBe(true);
    });

    it('should return pro features', () => {
      const features = getFeaturesForPlan('pro');
      expect(features.adminPanel).toBe(true);
      expect(features.managedMode).toBe(true);
      expect(features.exports).toBe(true);
      expect(features.advancedReports).toBe(true);
    });

    it('should return enterprise features', () => {
      const features = getFeaturesForPlan('enterprise');
      expect(features.adminPanel).toBe(true);
      expect(features.managedMode).toBe(true);
      expect(features.exports).toBe(true);
      expect(features.customBranding).toBe(true);
      expect(features.apiAccess).toBe(true);
    });

    it('should return basic features for unknown plan', () => {
      const features = getFeaturesForPlan('unknown');
      expect(features).toEqual(PLAN_FEATURES.basic);
    });
  });

  describe('mergeFeatures', () => {
    it('should merge cert features with plan features', () => {
      const planFeatures = { adminPanel: true, exports: true };
      const certFeatures = { adminPanel: false };
      const merged = mergeFeatures(certFeatures, planFeatures);

      expect(merged.adminPanel).toBe(false); // Cert overrides
      expect(merged.exports).toBe(true); // Plan default
    });

    it('should return plan features if cert features undefined', () => {
      const planFeatures = { adminPanel: true, exports: true };
      const merged = mergeFeatures(undefined, planFeatures);

      expect(merged).toEqual(planFeatures);
    });
  });
});
