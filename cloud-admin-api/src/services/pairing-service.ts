/**
 * Pairing Service
 * Handles device pairing flow: code generation, request submission, approval/denial.
 * 
 * Requirements:
 * - 3.1: Generate 6-digit pair code valid for 5 minutes
 * - 3.2: Pair code associated with tenant
 * - 3.3: Create pending pairing request with valid code
 * - 3.4: Rate limit pairing requests
 * - 3.5: CAPTCHA verification when enabled
 * - 3.6: Exchange cryptographic keys on approval
 * - 3.7: Return WebSocket endpoint URL on approval
 * - 3.9: Uniform error for invalid/expired codes
 */

import { randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { config } from '../config';

// ============================================================================
// Types
// ============================================================================

export interface PairCodeResult {
  code: string;
  expiresAt: number;
  tenantId: string;
}

export interface PairRequest {
  pairCode: string;
  deviceId: string;
  deviceName: string;
  devicePubKey: string;
  appVersion: string;
  osInfo: string;
  ip: string;
  captchaToken?: string;
}

export interface PairRequestResult {
  requestId: string;
  status: 'pending';
  expiresAt: number;
}

export interface ApprovalResult {
  success: boolean;
  wsEndpoint: string;
  adminPubKey: string;
  sessionToken: string;
}

export interface PendingPairRequest {
  id: string;
  deviceId: string;
  deviceName: string;
  appVersion: string;
  osInfo: string;
  ip: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface StoredPairCode {
  id: string;
  tenantId: string;
  code: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export interface StoredPairRequest {
  id: string;
  tenantId: string;
  deviceId: string;
  deviceName: string;
  devicePubKey: string;
  appVersion: string;
  osInfo: string;
  ip: string;
  status: 'pending' | 'approved' | 'denied';
  createdAt: Date;
  expiresAt: Date;
  resolvedAt: Date | null;
  resolvedBy: string | null;
}

export interface StoredDevice {
  id: string;
  tenantId: string;
  deviceId: string;
  deviceName: string;
  devicePubKey: string;
  pairedAt: Date;
  status: string;
  appVersion: string | null;
  ip: string | null;
  revoked: boolean;
}

export interface TenantInfo {
  id: string;
  wsEndpoint: string;
  adminPubKey?: string;
}

// ============================================================================
// Database Interface (to be injected)
// ============================================================================

export interface PairingDatabase {
  // Pair codes
  createPairCode(pairCode: {
    id: string;
    tenantId: string;
    code: string;
    expiresAt: Date;
  }): Promise<StoredPairCode>;
  
  findPairCode(tenantId: string, code: string): Promise<StoredPairCode | null>;
  findPairCodeByCode(code: string): Promise<StoredPairCode | null>;
  markPairCodeUsed(id: string): Promise<void>;
  
  // Pair requests
  createPairRequest(request: {
    id: string;
    tenantId: string;
    deviceId: string;
    deviceName: string;
    devicePubKey: string;
    appVersion: string;
    osInfo: string;
    ip: string;
    expiresAt: Date;
  }): Promise<StoredPairRequest>;
  
  findPairRequestById(requestId: string): Promise<StoredPairRequest | null>;
  findPendingRequests(tenantId: string): Promise<StoredPairRequest[]>;
  updatePairRequestStatus(
    requestId: string, 
    status: 'approved' | 'denied', 
    resolvedBy: string
  ): Promise<StoredPairRequest>;
  
  // Devices
  createDevice(device: {
    id: string;
    tenantId: string;
    deviceId: string;
    deviceName: string;
    devicePubKey: string;
    appVersion: string;
    ip: string;
  }): Promise<StoredDevice>;
  
  findDeviceByDeviceId(tenantId: string, deviceId: string): Promise<StoredDevice | null>;
  
  // Tenant
  findTenantById(tenantId: string): Promise<TenantInfo | null>;
}

// ============================================================================
// CAPTCHA Interface
// ============================================================================

export interface CaptchaVerifier {
  verify(token: string): Promise<boolean>;
}

// ============================================================================
// Constants
// ============================================================================

const PAIR_CODE_LENGTH = config.pairCodeLength;
const PAIR_CODE_EXPIRY_MS = config.pairCodeExpiry;
const PAIR_REQUEST_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

// ============================================================================
// Pairing Service Class
// ============================================================================

export class PairingService {
  constructor(
    private db: PairingDatabase,
    private captchaVerifier?: CaptchaVerifier
  ) {}

  /**
   * Generate a new pair code for a tenant
   * Requirements: 3.1, 3.2
   * 
   * @param tenantId - The tenant ID to associate the code with
   * @returns PairCodeResult with code, expiry, and tenant ID
   */
  async generatePairCode(tenantId: string): Promise<PairCodeResult> {
    // Requirement 3.1: Generate 6-digit code
    const code = PairingService.generateCode();
    
    // Requirement 3.1: Set 5-minute expiry
    const expiresAt = new Date(Date.now() + PAIR_CODE_EXPIRY_MS);
    
    // Requirement 3.2: Associate with tenant
    await this.db.createPairCode({
      id: randomUUID(),
      tenantId,
      code,
      expiresAt,
    });
    
    return {
      code,
      expiresAt: expiresAt.getTime(),
      tenantId,
    };
  }

  /**
   * Submit a pairing request with a pair code
   * Requirements: 3.3, 3.5, 3.9
   * 
   * @param request - The pairing request details
   * @returns PairRequestResult with request ID and status
   */
  async submitPairRequest(request: PairRequest): Promise<PairRequestResult> {
    // Requirement 3.5: CAPTCHA verification when enabled
    if (config.captchaEnabled) {
      if (!request.captchaToken) {
        throw new PairingError('CAPTCHA_REQUIRED', 'CAPTCHA verification required');
      }
      if (this.captchaVerifier) {
        const captchaValid = await this.captchaVerifier.verify(request.captchaToken);
        if (!captchaValid) {
          throw new PairingError('CAPTCHA_INVALID', 'CAPTCHA verification failed');
        }
      }
    }

    // Requirement 3.9: Use constant-time comparison and uniform error
    const pairCode = await this.db.findPairCodeByCode(request.pairCode);
    
    // Validate pair code with uniform error response
    const isValid = await this.validatePairCodeSecure(pairCode, request.pairCode);
    
    if (!isValid) {
      // Requirement 3.9: Return identical error for invalid/expired codes
      throw new PairingError('INVALID_PAIR_CODE', 'Invalid or expired pair code');
    }

    // Mark pair code as used
    await this.db.markPairCodeUsed(pairCode!.id);

    // Requirement 3.3: Create pending pairing request
    const expiresAt = new Date(Date.now() + PAIR_REQUEST_EXPIRY_MS);
    const requestId = randomUUID();
    
    await this.db.createPairRequest({
      id: requestId,
      tenantId: pairCode!.tenantId,
      deviceId: request.deviceId,
      deviceName: request.deviceName,
      devicePubKey: request.devicePubKey,
      appVersion: request.appVersion,
      osInfo: request.osInfo,
      ip: request.ip,
      expiresAt,
    });

    return {
      requestId,
      status: 'pending',
      expiresAt: expiresAt.getTime(),
    };
  }

  /**
   * Approve a pairing request
   * Requirements: 3.6, 3.7
   * 
   * @param requestId - The pairing request ID
   * @param adminUserId - The admin user approving the request
   * @returns ApprovalResult with WebSocket endpoint and keys
   */
  async approvePairing(requestId: string, adminUserId: string): Promise<ApprovalResult> {
    const pairRequest = await this.db.findPairRequestById(requestId);
    
    if (!pairRequest) {
      throw new PairingError('REQUEST_NOT_FOUND', 'Pairing request not found');
    }

    if (pairRequest.status !== 'pending') {
      throw new PairingError('REQUEST_ALREADY_RESOLVED', 'Pairing request already resolved');
    }

    if (pairRequest.expiresAt < new Date()) {
      throw new PairingError('REQUEST_EXPIRED', 'Pairing request has expired');
    }

    // Get tenant info for WebSocket endpoint
    const tenant = await this.db.findTenantById(pairRequest.tenantId);
    if (!tenant) {
      throw new PairingError('TENANT_NOT_FOUND', 'Tenant not found');
    }

    // Requirement 3.6: Exchange cryptographic keys
    // Generate admin public key for this pairing (in production, this would be the tenant's key)
    const adminPubKey = PairingService.generateAdminPubKey();
    const sessionToken = PairingService.generateSessionToken();

    // Create device record
    await this.db.createDevice({
      id: randomUUID(),
      tenantId: pairRequest.tenantId,
      deviceId: pairRequest.deviceId,
      deviceName: pairRequest.deviceName,
      devicePubKey: pairRequest.devicePubKey,
      appVersion: pairRequest.appVersion,
      ip: pairRequest.ip,
    });

    // Update request status
    await this.db.updatePairRequestStatus(requestId, 'approved', adminUserId);

    // Requirement 3.7: Return WebSocket endpoint URL
    return {
      success: true,
      wsEndpoint: tenant.wsEndpoint,
      adminPubKey,
      sessionToken,
    };
  }

  /**
   * Deny a pairing request
   * 
   * @param requestId - The pairing request ID
   * @param adminUserId - The admin user denying the request
   */
  async denyPairing(requestId: string, adminUserId: string): Promise<void> {
    const pairRequest = await this.db.findPairRequestById(requestId);
    
    if (!pairRequest) {
      throw new PairingError('REQUEST_NOT_FOUND', 'Pairing request not found');
    }

    if (pairRequest.status !== 'pending') {
      throw new PairingError('REQUEST_ALREADY_RESOLVED', 'Pairing request already resolved');
    }

    await this.db.updatePairRequestStatus(requestId, 'denied', adminUserId);
  }

  /**
   * Get pending pairing requests for a tenant
   * 
   * @param tenantId - The tenant ID
   * @returns Array of pending pairing requests
   */
  async getPendingRequests(tenantId: string): Promise<PendingPairRequest[]> {
    const requests = await this.db.findPendingRequests(tenantId);
    
    return requests
      .filter(r => r.expiresAt > new Date())
      .map(r => ({
        id: r.id,
        deviceId: r.deviceId,
        deviceName: r.deviceName,
        appVersion: r.appVersion,
        osInfo: r.osInfo,
        ip: r.ip,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
      }));
  }

  /**
   * Validate a pair code for a specific tenant
   * 
   * @param code - The pair code to validate
   * @param tenantId - The tenant ID
   * @returns boolean indicating if the code is valid
   */
  async validatePairCode(code: string, tenantId: string): Promise<boolean> {
    const pairCode = await this.db.findPairCode(tenantId, code);
    return this.isPairCodeValid(pairCode);
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Validate pair code with constant-time comparison
   * Requirement 3.9: Prevent timing attacks
   */
  private async validatePairCodeSecure(
    storedCode: StoredPairCode | null, 
    providedCode: string
  ): Promise<boolean> {
    if (!storedCode) {
      // Perform dummy comparison to maintain constant timing
      const dummyCode = '000000';
      PairingService.constantTimeCompare(dummyCode, providedCode);
      return false;
    }

    // Check expiry
    if (storedCode.expiresAt < new Date()) {
      return false;
    }

    // Check if already used
    if (storedCode.usedAt !== null) {
      return false;
    }

    // Constant-time comparison
    return PairingService.constantTimeCompare(storedCode.code, providedCode);
  }

  /**
   * Check if a pair code is valid (not expired, not used)
   */
  private isPairCodeValid(pairCode: StoredPairCode | null): boolean {
    if (!pairCode) return false;
    if (pairCode.expiresAt < new Date()) return false;
    if (pairCode.usedAt !== null) return false;
    return true;
  }

  // ============================================================================
  // Static Methods
  // ============================================================================

  /**
   * Generate a 6-digit pair code
   * Requirement 3.1
   */
  static generateCode(): string {
    // Generate cryptographically secure random number
    const bytes = randomBytes(4);
    const num = bytes.readUInt32BE(0);
    // Modulo to get 6 digits, pad with leading zeros
    const code = (num % 1000000).toString().padStart(PAIR_CODE_LENGTH, '0');
    return code;
  }

  /**
   * Generate admin public key (placeholder - in production use Ed25519)
   */
  static generateAdminPubKey(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Generate session token for device authentication
   */
  static generateSessionToken(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Constant-time string comparison to prevent timing attacks
   * Requirement 3.9
   */
  static constantTimeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      // Still do comparison to maintain constant time
      const dummy = Buffer.alloc(a.length, 'x');
      timingSafeEqual(dummy, Buffer.from(a));
      return false;
    }
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }

  /**
   * Validate pair code format (6 digits)
   */
  static isValidPairCodeFormat(code: string): boolean {
    return /^\d{6}$/.test(code);
  }

  /**
   * Get pair code expiry duration in milliseconds
   */
  static getPairCodeExpiryMs(): number {
    return PAIR_CODE_EXPIRY_MS;
  }
}

// ============================================================================
// Pairing Error Class
// ============================================================================

export type PairingErrorCode =
  | 'INVALID_PAIR_CODE'
  | 'PAIR_CODE_EXPIRED'
  | 'REQUEST_NOT_FOUND'
  | 'REQUEST_ALREADY_RESOLVED'
  | 'REQUEST_EXPIRED'
  | 'TENANT_NOT_FOUND'
  | 'DEVICE_ALREADY_PAIRED'
  | 'CAPTCHA_REQUIRED'
  | 'CAPTCHA_INVALID';

export class PairingError extends Error {
  constructor(
    public code: PairingErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'PairingError';
  }
}

// ============================================================================
// Exports for testing
// ============================================================================

export const PAIRING_CONSTANTS = {
  PAIR_CODE_LENGTH,
  PAIR_CODE_EXPIRY_MS,
  PAIR_REQUEST_EXPIRY_MS,
};
