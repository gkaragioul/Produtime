/**
 * Entitlements & Feature Definitions
 * Shared between client and admin panel
 */

export interface LicenseFeatures {
  adminPanel?: boolean;
  managedMode?: boolean;
  exports?: boolean;
  advancedReports?: boolean;
  customBranding?: boolean;
  apiAccess?: boolean;
  [key: string]: boolean | undefined;
}

export interface ActivationCertPayload {
  certVersion: number;
  licenseId: string;
  plan: string;
  seats: number;
  machineHash: string;
  issuedAt: string;
  expiresAt: string | null;
  features: LicenseFeatures;
  serverTime?: string;
  policyProfileId?: string | null;
}

export interface ActivationCert {
  certPayload: ActivationCertPayload;
  certSignature: string;
}

export interface TimeDriftInfo {
  lastServerTime: string;
  lastServerLocalTime: number;
}

/**
 * Feature requirements by plan
 */
export const PLAN_FEATURES: Record<string, LicenseFeatures> = {
  trial: {
    adminPanel: false,
    managedMode: false,
    exports: true,
    advancedReports: false,
    customBranding: false,
    apiAccess: false,
  },
  basic: {
    adminPanel: false,
    managedMode: false,
    exports: true,
    advancedReports: false,
    customBranding: false,
    apiAccess: false,
  },
  pro: {
    adminPanel: true,
    managedMode: true,
    exports: true,
    advancedReports: true,
    customBranding: false,
    apiAccess: false,
  },
  enterprise: {
    adminPanel: true,
    managedMode: true,
    exports: true,
    advancedReports: true,
    customBranding: true,
    apiAccess: true,
  },
};

/**
 * Tamper severity levels
 */
export enum TamperSeverity {
  NONE = 'none',
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

export interface TamperResult {
  severity: TamperSeverity;
  flags: TamperFlag[];
  isTampered: boolean;
}

export interface TamperFlag {
  type: 'cpu' | 'motherboard' | 'mac' | 'productId' | 'drive';
  oldValue: string;
  newValue: string;
  detectedAt: string;
}

/**
 * Check if a feature is allowed
 */
export function isFeatureAllowed(features: LicenseFeatures | undefined, featureName: string): boolean {
  if (!features) return false;
  return features[featureName] === true;
}

/**
 * Get default features for a plan
 */
export function getFeaturesForPlan(plan: string): LicenseFeatures {
  return PLAN_FEATURES[plan] || PLAN_FEATURES.basic;
}

/**
 * Merge features (for backward compatibility with older certs)
 */
export function mergeFeatures(
  certFeatures: LicenseFeatures | undefined,
  planFeatures: LicenseFeatures
): LicenseFeatures {
  if (!certFeatures) return planFeatures;
  return { ...planFeatures, ...certFeatures };
}
