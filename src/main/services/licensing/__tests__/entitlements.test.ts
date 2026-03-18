/**
 * Entitlements & Features Tests — Freeware Edition
 * All features are permanently unlocked.
 */

import {
  isFeatureAllowed,
  getFeaturesForPlan,
  mergeFeatures,
  PLAN_FEATURES,
} from '../../../../shared/licensing/entitlements';

describe('Entitlements (Freeware)', () => {
  describe('isFeatureAllowed', () => {
    it('should always return true in freeware mode', () => {
      expect(isFeatureAllowed({ adminPanel: true }, 'adminPanel')).toBe(true);
      expect(isFeatureAllowed({ adminPanel: false }, 'adminPanel')).toBe(true);
      expect(isFeatureAllowed(undefined, 'adminPanel')).toBe(true);
      expect(isFeatureAllowed({}, 'exports')).toBe(true);
    });
  });

  describe('getFeaturesForPlan', () => {
    it('should return all features enabled for every plan', () => {
      for (const plan of ['trial', 'basic', 'pro', 'enterprise', 'freeware']) {
        const features = getFeaturesForPlan(plan);
        expect(features.adminPanel).toBe(true);
        expect(features.managedMode).toBe(true);
        expect(features.exports).toBe(true);
        expect(features.advancedReports).toBe(true);
        expect(features.customBranding).toBe(true);
        expect(features.apiAccess).toBe(true);
      }
    });

    it('should return basic (all-enabled) features for unknown plan', () => {
      const features = getFeaturesForPlan('unknown');
      expect(features).toEqual(PLAN_FEATURES.basic);
    });
  });

  describe('mergeFeatures', () => {
    it('should merge cert features with plan features', () => {
      const planFeatures = { adminPanel: true, exports: true };
      const certFeatures = { adminPanel: false };
      const merged = mergeFeatures(certFeatures, planFeatures);

      // Cert overrides plan, but isFeatureAllowed still returns true
      expect(merged.adminPanel).toBe(false);
      expect(merged.exports).toBe(true);
    });

    it('should return plan features if cert features undefined', () => {
      const planFeatures = { adminPanel: true, exports: true };
      const merged = mergeFeatures(undefined, planFeatures);
      expect(merged).toEqual(planFeatures);
    });
  });
});
