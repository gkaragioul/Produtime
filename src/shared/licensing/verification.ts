/**
 * Shared Verification Library
 * Used by client, admin panel, and renderer
 */

import * as nacl from 'tweetnacl';
import * as naclUtil from 'tweetnacl-util';
import * as crypto from 'crypto';
import {
  ActivationCert,
  ActivationCertPayload,
  LicenseFeatures,
  TamperSeverity,
  TamperResult,
  TamperFlag,
  isFeatureAllowed,
} from './entitlements';

/**
 * Verify Ed25519 signature
 */
export function verifyEd25519(
  payload: any,
  signatureBase64: string,
  publicKeyBase64: string
): boolean {
  try {
    const publicKey = naclUtil.decodeBase64(publicKeyBase64);
    const signature = naclUtil.decodeBase64(signatureBase64);
    const canonical = canonicalJSON(payload);
    const message = naclUtil.decodeUTF8(canonical);
    return nacl.sign.detached.verify(message, signature, publicKey);
  } catch (error) {
    return false;
  }
}

/**
 * Canonical JSON serialization for signing
 */
export function canonicalJSON(obj: any): string {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

/**
 * Verify activation certificate
 */
export function verifyActivationCert(
  cert: ActivationCert,
  publicKeyBase64: string,
  expectedMachineHash: string
): { valid: boolean; reason?: string } {
  // Verify signature
  if (!verifyEd25519(cert.certPayload, cert.certSignature, publicKeyBase64)) {
    return { valid: false, reason: 'Invalid certificate signature' };
  }

  // Verify machine hash matches
  if (cert.certPayload.machineHash !== expectedMachineHash) {
    return { valid: false, reason: 'Certificate machine hash does not match' };
  }

  return { valid: true };
}

/**
 * Compute drift-corrected now
 * Accounts for local clock skew using server time
 */
export function computeDriftedNow(
  lastServerTime: string | null,
  lastServerLocalTime: number | null
): Date {
  if (!lastServerTime || !lastServerLocalTime) {
    return new Date();
  }

  const serverTime = new Date(lastServerTime).getTime();
  const drift = Date.now() - lastServerLocalTime;
  const driftedNow = serverTime + drift;

  return new Date(driftedNow);
}

/**
 * Check if license is expired using drift-corrected time
 */
export function isExpired(expiresAt: string | null | undefined, nowDrifted: Date): boolean {
  if (!expiresAt) return false;
  return nowDrifted.getTime() > new Date(expiresAt).getTime();
}

/**
 * Check if feature is allowed
 */
export function hasFeature(features: LicenseFeatures | undefined, featureName: string): boolean {
  return isFeatureAllowed(features, featureName);
}

/**
 * Classify tamper severity
 */
export function classifyTamper(
  oldFingerprint: string | null,
  newFingerprint: string,
  flags: TamperFlag[]
): TamperSeverity {
  if (!oldFingerprint || oldFingerprint === newFingerprint) {
    return TamperSeverity.NONE;
  }

  if (flags.length === 0) {
    return TamperSeverity.NONE;
  }

  if (flags.length === 1) {
    const flag = flags[0];
    // MAC address or product ID change alone is low severity
    if (flag.type === 'mac' || flag.type === 'productId') {
      return TamperSeverity.LOW;
    }
    // Single hardware component change is medium
    return TamperSeverity.MEDIUM;
  }

  if (flags.length === 2) {
    return TamperSeverity.MEDIUM;
  }

  // 3+ components changed = high severity (likely VM clone or major hardware swap)
  return TamperSeverity.HIGH;
}

/**
 * Hash a value with SHA256
 */
export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Validate certificate payload structure
 */
export function validateCertPayload(payload: any): { valid: boolean; reason?: string } {
  if (!payload.certVersion) {
    return { valid: false, reason: 'Missing certVersion' };
  }

  if (!payload.licenseId) {
    return { valid: false, reason: 'Missing licenseId' };
  }

  if (!payload.plan) {
    return { valid: false, reason: 'Missing plan' };
  }

  if (typeof payload.seats !== 'number' || payload.seats < 1) {
    return { valid: false, reason: 'Invalid seats' };
  }

  if (!payload.machineHash) {
    return { valid: false, reason: 'Missing machineHash' };
  }

  if (!payload.issuedAt) {
    return { valid: false, reason: 'Missing issuedAt' };
  }

  if (!payload.features || typeof payload.features !== 'object') {
    return { valid: false, reason: 'Missing or invalid features' };
  }

  return { valid: true };
}

/**
 * Validate grace period
 */
export function isWithinGracePeriod(
  lastSeenTime: string | null,
  gracePeriodMs: number
): boolean {
  if (!lastSeenTime) return false;

  const lastSeen = new Date(lastSeenTime).getTime();
  const elapsed = Date.now() - lastSeen;

  return elapsed <= gracePeriodMs;
}

/**
 * Calculate time until expiry
 */
export function timeUntilExpiry(expiresAt: string | null, nowDrifted: Date): number | null {
  if (!expiresAt) return null;

  const expiryTime = new Date(expiresAt).getTime();
  const nowTime = nowDrifted.getTime();
  const remaining = expiryTime - nowTime;

  return remaining > 0 ? remaining : 0;
}

/**
 * Format time remaining as human-readable string
 */
export function formatTimeRemaining(ms: number): string {
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}
