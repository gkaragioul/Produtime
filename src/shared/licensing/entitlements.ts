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
 * Feature requirements by plan — Freeware: all features enabled for all plans
 */
const ALL_FEATURES: LicenseFeatures = {
  adminPanel: true,
  managedMode: true,
  exports: true,
  advancedReports: true,
  customBranding: true,
  apiAccess: true,
};

export const PLAN_FEATURES: Record<string, LicenseFeatures> = {
  trial: { ...ALL_FEATURES },
  basic: { ...ALL_FEATURES },
  pro: { ...ALL_FEATURES },
  enterprise: { ...ALL_FEATURES },
  freeware: { ...ALL_FEATURES },
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
 * Check if a feature is allowed — Freeware: always true
 */
export function isFeatureAllowed(_features: LicenseFeatures | undefined, _featureName: string): boolean {
  return true;
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
