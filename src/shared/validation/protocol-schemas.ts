/**
 * Zod Validation Schemas for Admin Protocol Messages
 * Runtime validation at communication boundaries
 * 
 * NOTE: This file uses a lightweight validation approach that doesn't require
 * the Zod library in the main app. For full Zod support, add "zod" to dependencies.
 */

// ============================================================================
// LIGHTWEIGHT VALIDATION (No external dependencies)
// ============================================================================

export interface ValidationResult {
  success: boolean;
  error?: string;
  data?: any;
}

/**
 * Validate that a value is a non-empty string
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Validate that a value is a number
 */
function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value);
}

/**
 * Validate that a value is a positive number
 */
function isPositiveNumber(value: unknown): value is number {
  return isNumber(value) && value >= 0;
}

/**
 * Validate that a value is one of the allowed values
 */
function isOneOf<T>(value: unknown, allowed: readonly T[]): value is T {
  return allowed.includes(value as T);
}

/**
 * Validate that a value is an object with required keys
 */
function hasRequiredKeys(value: unknown, keys: string[]): boolean {
  if (typeof value !== 'object' || value === null) return false;
  return keys.every(key => key in value);
}

// ============================================================================
// MESSAGE TYPE VALIDATORS
// ============================================================================

const VALID_MESSAGE_TYPES = [
  'HEARTBEAT', 'STATS_SUMMARY', 'PAIR_REQUEST', 'PAIR_APPROVED', 'PAIR_DENIED',
  'IDENTIFY', 'POLICY_PUSH', 'EXPORT_REQUEST', 'EXPORT_RESULT',
  'STATS_SNAPSHOT_REQUEST', 'STATS_SNAPSHOT_RESULT', 'LOCK', 'UNLOCK',
  'UNPAIR', 'ERROR', 'ACK'
] as const;

/**
 * Validate base message structure
 */
export function validateBaseMessage(message: unknown): ValidationResult {
  if (typeof message !== 'object' || message === null) {
    return { success: false, error: 'Message must be an object' };
  }

  const msg = message as Record<string, unknown>;

  if (!isOneOf(msg.type, VALID_MESSAGE_TYPES)) {
    return { success: false, error: `Invalid message type: ${msg.type}` };
  }

  if (!isPositiveNumber(msg.ts)) {
    return { success: false, error: 'Invalid timestamp' };
  }

  if (!isNonEmptyString(msg.nonce)) {
    return { success: false, error: 'Invalid nonce' };
  }

  if (!isNonEmptyString(msg.deviceId)) {
    return { success: false, error: 'Invalid deviceId' };
  }

  if (!isNonEmptyString(msg.signature)) {
    return { success: false, error: 'Invalid signature' };
  }

  return { success: true, data: msg };
}

/**
 * Validate HEARTBEAT payload
 */
export function validateHeartbeatPayload(payload: unknown): ValidationResult {
  if (typeof payload !== 'object' || payload === null) {
    return { success: false, error: 'Heartbeat payload must be an object' };
  }

  const p = payload as Record<string, unknown>;

  if (!isNonEmptyString(p.appVersion)) {
    return { success: false, error: 'Invalid appVersion' };
  }

  if (!isOneOf(p.trackingStatus, ['active', 'paused', 'stopped'])) {
    return { success: false, error: 'Invalid trackingStatus' };
  }

  if (typeof p.policyVersion !== 'string') {
    return { success: false, error: 'Invalid policyVersion' };
  }

  if (!isPositiveNumber(p.uptime)) {
    return { success: false, error: 'Invalid uptime' };
  }

  if (!isPositiveNumber(p.lastActivityAt)) {
    return { success: false, error: 'Invalid lastActivityAt' };
  }

  return { success: true, data: p };
}

/**
 * Validate PAIR_REQUEST payload
 */
export function validatePairRequestPayload(payload: unknown): ValidationResult {
  if (typeof payload !== 'object' || payload === null) {
    return { success: false, error: 'PairRequest payload must be an object' };
  }

  const p = payload as Record<string, unknown>;

  if (!isNonEmptyString(p.deviceName)) {
    return { success: false, error: 'Invalid deviceName' };
  }

  if (!isNonEmptyString(p.devicePubKey)) {
    return { success: false, error: 'Invalid devicePubKey' };
  }

  if (!isNonEmptyString(p.appVersion)) {
    return { success: false, error: 'Invalid appVersion' };
  }

  if (!isNonEmptyString(p.osInfo)) {
    return { success: false, error: 'Invalid osInfo' };
  }

  if (!isNonEmptyString(p.pairCode) || !/^\d{6}$/.test(p.pairCode)) {
    return { success: false, error: 'Invalid pairCode (must be 6 digits)' };
  }

  return { success: true, data: p };
}

/**
 * Validate PAIR_APPROVED payload
 */
export function validatePairApprovedPayload(payload: unknown): ValidationResult {
  if (typeof payload !== 'object' || payload === null) {
    return { success: false, error: 'PairApproved payload must be an object' };
  }

  const p = payload as Record<string, unknown>;

  if (!isNonEmptyString(p.adminName)) {
    return { success: false, error: 'Invalid adminName' };
  }

  if (!isNonEmptyString(p.adminPubKey)) {
    return { success: false, error: 'Invalid adminPubKey' };
  }

  if (!isNonEmptyString(p.sessionToken)) {
    return { success: false, error: 'Invalid sessionToken' };
  }

  // Optional cloud fields
  if (p.wsEndpoint !== undefined && typeof p.wsEndpoint !== 'string') {
    return { success: false, error: 'Invalid wsEndpoint' };
  }

  if (p.tenantId !== undefined && typeof p.tenantId !== 'string') {
    return { success: false, error: 'Invalid tenantId' };
  }

  if (p.tenantName !== undefined && typeof p.tenantName !== 'string') {
    return { success: false, error: 'Invalid tenantName' };
  }

  return { success: true, data: p };
}

/**
 * Validate POLICY_PUSH payload
 */
export function validatePolicyPushPayload(payload: unknown): ValidationResult {
  if (typeof payload !== 'object' || payload === null) {
    return { success: false, error: 'PolicyPush payload must be an object' };
  }

  const p = payload as Record<string, unknown>;

  if (typeof p.policy !== 'object' || p.policy === null) {
    return { success: false, error: 'Invalid policy object' };
  }

  if (typeof p.force !== 'boolean') {
    return { success: false, error: 'Invalid force flag' };
  }

  return { success: true, data: p };
}

/**
 * Validate enhanced heartbeat payload (dashboard metrics)
 */
export function validateEnhancedHeartbeatPayload(payload: unknown): ValidationResult {
  if (typeof payload !== 'object' || payload === null) {
    return { success: false, error: 'Enhanced heartbeat payload must be an object' };
  }

  const p = payload as Record<string, unknown>;

  if (!isNonEmptyString(p.deviceId)) {
    return { success: false, error: 'Invalid deviceId' };
  }

  if (!isNonEmptyString(p.deviceName)) {
    return { success: false, error: 'Invalid deviceName' };
  }

  if (typeof p.trackingRunning !== 'boolean') {
    return { success: false, error: 'Invalid trackingRunning' };
  }

  // Validate today metrics
  if (typeof p.today !== 'object' || p.today === null) {
    return { success: false, error: 'Invalid today metrics' };
  }

  const today = p.today as Record<string, unknown>;
  const requiredMetrics = ['activeSeconds', 'idleSeconds', 'untrackedSeconds'];
  for (const metric of requiredMetrics) {
    if (!isPositiveNumber(today[metric])) {
      return { success: false, error: `Invalid today.${metric}` };
    }
  }

  return { success: true, data: p };
}

// ============================================================================
// MAIN VALIDATION FUNCTION
// ============================================================================

/**
 * Validate an incoming protocol message
 * Returns validation result with parsed data or error
 */
export function validateProtocolMessage(message: unknown): ValidationResult {
  // First validate base structure
  const baseResult = validateBaseMessage(message);
  if (!baseResult.success) {
    return baseResult;
  }

  const msg = baseResult.data as Record<string, unknown>;
  const payload = msg.payload;

  // Validate payload based on message type
  switch (msg.type) {
    case 'HEARTBEAT':
      return validateHeartbeatPayload(payload);
    
    case 'PAIR_REQUEST':
      return validatePairRequestPayload(payload);
    
    case 'PAIR_APPROVED':
      return validatePairApprovedPayload(payload);
    
    case 'POLICY_PUSH':
      return validatePolicyPushPayload(payload);
    
    case 'IDENTIFY':
    case 'STATS_SUMMARY':
    case 'PAIR_DENIED':
    case 'EXPORT_REQUEST':
    case 'EXPORT_RESULT':
    case 'STATS_SNAPSHOT_REQUEST':
    case 'STATS_SNAPSHOT_RESULT':
    case 'LOCK':
    case 'UNLOCK':
    case 'UNPAIR':
    case 'ERROR':
    case 'ACK':
      // Basic validation - payload must be an object
      if (typeof payload !== 'object' || payload === null) {
        return { success: false, error: `Invalid payload for ${msg.type}` };
      }
      return { success: true, data: msg };
    
    default:
      return { success: false, error: `Unknown message type: ${msg.type}` };
  }
}

/**
 * Create a validation wrapper for message handlers
 * Logs validation errors and returns null for invalid messages
 */
export function withValidation<T>(
  validator: (data: unknown) => ValidationResult,
  handler: (data: T) => void,
  logger?: (message: string) => void
): (data: unknown) => void {
  return (data: unknown) => {
    const result = validator(data);
    if (!result.success) {
      const log = logger || console.warn;
      log(`[VALIDATION] ${result.error}`);
      return;
    }
    handler(result.data as T);
  };
}
