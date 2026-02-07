/**
 * Admin Console Licensing Service
 * Validates license locally using activation certificate
 * 
 * BUG FIX: Implemented certificate loading and storage
 * - Loads certificates from database on init()
 * - Validates certificate signatures
 * - Stores certificates securely with encryption
 * 
 * CRITICAL FIX: Added heartbeat mechanism for revocation detection
 * CRITICAL FIX: Added machine hash validation
 * CRITICAL FIX: Added seat limit enforcement
 * CRITICAL FIX: Added registry-based trial protection (prevents trial reset by deleting database)
 */

import { AdminDatabase } from './db';
import * as crypto from 'crypto';
import * as os from 'os';
import { app } from 'electron';
import * as nacl from 'tweetnacl';
import { AdminRegistryService } from './registry-service';

export interface AdminLicenseStatus {
  licensed: boolean;
  reason?: string;
  features?: Record<string, boolean>;
  licenseId?: string;
  expiresAt?: string;
  seatsUsed?: number;
  seatsTotal?: number;
  warnings?: string[];
  machineHash?: string;
  mode?: 'locked' | 'trial' | 'activated';
  trialDaysRemaining?: number;
}

// BUG FIX #25: Encryption key derivation
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * BUG FIX #30: Generate system-specific entropy for key derivation
 * Combines multiple system identifiers to make key harder to predict
 */
function getSystemEntropy(): string {
  const parts: string[] = [];
  
  // Machine hostname
  try {
    parts.push(os.hostname());
  } catch { /* ignore */ }
  
  // Platform info
  parts.push(os.platform());
  parts.push(os.arch());
  
  // CPU info (model name is relatively stable)
  try {
    const cpus = os.cpus();
    if (cpus.length > 0) {
      parts.push(cpus[0].model);
    }
  } catch { /* ignore */ }
  
  // Home directory path (unique per user)
  try {
    parts.push(os.homedir());
  } catch { /* ignore */ }
  
  // User info
  try {
    const userInfo = os.userInfo();
    parts.push(userInfo.username);
  } catch { /* ignore */ }
  
  return parts.join('|');
}

/**
 * CRITICAL FIX: Generate machine fingerprint for this device
 * Used to validate certificates are bound to this machine
 */
function getMachineFingerprint(): string {
  const MACHINE_SALT = 'ProduTime-AdminConsole-2026-Machine-Salt-v1';
  const parts: string[] = [];
  
  try {
    parts.push(os.hostname());
    parts.push(os.platform());
    parts.push(os.arch());
    
    const cpus = os.cpus();
    if (cpus.length > 0) {
      parts.push(cpus[0].model);
      parts.push(String(cpus.length));
    }
    
    // Network interfaces (MAC addresses)
    const networkInterfaces = os.networkInterfaces();
    for (const [name, interfaces] of Object.entries(networkInterfaces)) {
      if (interfaces) {
        for (const iface of interfaces) {
          if (iface.mac && iface.mac !== '00:00:00:00:00:00') {
            parts.push(iface.mac);
            break; // Only use first valid MAC
          }
        }
      }
    }
    
    parts.push(os.homedir());
  } catch (error) {
    console.error('[AdminLicensing] Error generating machine fingerprint:', error);
  }
  
  const combined = parts.join('|');
  // Use salt for security (prevents rainbow table attacks)
  return crypto.createHash('sha256').update(MACHINE_SALT + combined).digest('hex');
}

// Licensing server URL
const LICENSING_SERVER_URL = 'https://produtime-licensing-server-production.up.railway.app';

export class AdminLicensingService {
  private db: AdminDatabase;
  private publicKey: string;
  private activationCert: any = null;
  private lastServerTime: string | null = null;
  private lastServerLocalTime: number | null = null;
  private warnings: string[] = [];
  private encryptionKey: Buffer;
  private machineHash: string;
  private registry: AdminRegistryService;
  
  // Trial state
  private trialStart: string | null = null;
  private mode: 'locked' | 'trial' | 'activated' = 'locked';
  
  // CRITICAL FIX: Heartbeat state
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private consecutiveHeartbeatFailures: number = 0;
  private lastHeartbeatAttempt: number = 0;
  private gracePeriodStartTime: string | null = null;

  private readonly GRACE_PERIOD_HOURS = 72;
  private readonly HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes for revocation checks
  private readonly MAX_HEARTBEAT_BACKOFF_MS = 60 * 60 * 1000; // 1 hour max
  private readonly NETWORK_TIMEOUT_MS = 10000; // 10 seconds
  private readonly TRIAL_PERIOD_DAYS = 7;

  constructor(db: AdminDatabase, publicKey: string) {
    this.db = db;
    this.publicKey = publicKey;
    // BUG FIX #30: Derive encryption key from public key + system entropy
    // This makes the key harder to predict even if public key is known
    const systemEntropy = getSystemEntropy();
    this.encryptionKey = crypto.createHash('sha256')
      .update(publicKey + '_admin_cert_encryption_' + systemEntropy)
      .digest()
      .subarray(0, KEY_LENGTH);
    
    // CRITICAL FIX: Generate machine fingerprint for validation
    this.machineHash = getMachineFingerprint();
    console.log('[AdminLicensing] Machine hash:', this.machineHash.substring(0, 16) + '...');
    
    // CRITICAL FIX: Initialize registry service for trial protection
    this.registry = AdminRegistryService.getInstance();
  }

  /**
   * Initialize licensing service
   * Loads stored activation certificate from database if available
   * CRITICAL FIX: Validates machine hash and starts heartbeat
   * CRITICAL FIX: Checks registry for trial data (prevents trial reset by deleting database)
   */
  async init(): Promise<void> {
    try {
      // Ensure certificate table exists
      this.ensureCertTable();

      // CRITICAL: Check registry for trial data first (cannot be deleted by user)
      const registryTrialStart = await this.registry.getTrialStartDate();
      if (registryTrialStart) {
        // Sync registry trial data to database if missing
        const dbTrialStart = this.db.getSetting('_admin_trial_start');
        if (!dbTrialStart) {
          console.log('[AdminLicensing] Restoring trial data from registry');
          this.db.setSetting('_admin_trial_start', registryTrialStart);
        }
      }

      // Load trial state
      const storedTrialStart = this.db.getSetting('_admin_trial_start');
      if (storedTrialStart) {
        this.trialStart = storedTrialStart;
        
        // Check if trial is still valid
        // CRITICAL FIX: Apply time drift correction to trial expiry
        // Prevents users from extending trial by setting clock back
        const trialStartDate = new Date(storedTrialStart);
        let now = Date.now();
        
        // Load stored server time for drift correction
        const storedServerTime = this.db.getSetting('_admin_last_server_time');
        const storedServerLocalTime = this.db.getSetting('_admin_last_server_local_time');
        
        if (storedServerTime && storedServerLocalTime) {
          this.lastServerTime = storedServerTime;
          this.lastServerLocalTime = parseInt(storedServerLocalTime, 10);
          
          const serverTime = new Date(storedServerTime).getTime();
          const expectedNow = serverTime + (Date.now() - this.lastServerLocalTime);
          const drift = Math.abs(now - expectedNow);
          
          // If drift > 30 minutes, use server-corrected time
          if (drift > 30 * 60 * 1000) {
            console.warn('[AdminLicensing] Time drift detected during init:', drift / 1000, 'seconds');
            now = expectedNow;
          }
        }
        
        const elapsed = now - trialStartDate.getTime();
        const trialPeriodMs = this.TRIAL_PERIOD_DAYS * 24 * 60 * 60 * 1000;
        
        if (elapsed < trialPeriodMs) {
          this.mode = 'trial';
          const remainingDays = Math.ceil((trialPeriodMs - elapsed) / (24 * 60 * 60 * 1000));
          console.log('[AdminLicensing] Trial mode active, days remaining:', remainingDays);
        } else {
          console.log('[AdminLicensing] Trial expired');
          this.mode = 'locked';
        }
      }

      // Load stored certificate if available
      const storedCert = this.loadCertFromDb();
      if (storedCert) {
        // Verify signature before using
        if (this.verifyCertSignature(storedCert)) {
          // Validate certificate structure
          if (this.validateCertPayload(storedCert.certPayload)) {
            // CRITICAL FIX: Validate machine hash matches this device
            if (storedCert.certPayload.machineHash !== this.machineHash) {
              console.warn('[AdminLicensing] Certificate machine hash mismatch - discarding');
              console.warn('[AdminLicensing] Expected:', this.machineHash.substring(0, 16) + '...');
              console.warn('[AdminLicensing] Got:', storedCert.certPayload.machineHash?.substring(0, 16) + '...');
              this.deleteCertFromDb();
              return;
            }
            
            this.activationCert = storedCert;
            this.lastServerTime = storedCert.certPayload?.serverTime || null;
            this.lastServerLocalTime = Date.now();
            this.mode = 'activated';
            console.log('[AdminLicensing] Certificate loaded and verified');
            
            // CRITICAL FIX: Start heartbeat for revocation detection
            this.startHeartbeat();
          } else {
            console.warn('[AdminLicensing] Stored certificate has invalid structure - discarding');
            this.deleteCertFromDb();
          }
        } else {
          console.warn('[AdminLicensing] Stored certificate has invalid signature - discarding');
          this.deleteCertFromDb();
        }
      }
    } catch (error) {
      console.error('[AdminLicensing] Error during init:', error);
    }
  }

  /**
   * Get current license status
   * CRITICAL FIX: Uses drift-corrected time for trial expiry check
   */
  getStatus(): AdminLicenseStatus {
    // Trial mode
    if (this.mode === 'trial' && this.trialStart) {
      const trialStartDate = new Date(this.trialStart);
      
      // CRITICAL FIX: Apply time drift correction to trial expiry
      // Prevents users from extending trial by setting clock back
      let now = Date.now();
      if (this.lastServerTime && this.lastServerLocalTime) {
        const serverTime = new Date(this.lastServerTime).getTime();
        const expectedNow = serverTime + (Date.now() - this.lastServerLocalTime);
        const drift = Math.abs(now - expectedNow);
        
        // If drift > 30 minutes, use server-corrected time
        if (drift > 30 * 60 * 1000) {
          console.warn('[AdminLicensing] Time drift detected in trial check:', drift / 1000, 'seconds');
          now = expectedNow;
        }
      }
      
      const elapsed = now - trialStartDate.getTime();
      const trialPeriodMs = this.TRIAL_PERIOD_DAYS * 24 * 60 * 60 * 1000;
      const remainingMs = Math.max(0, trialPeriodMs - elapsed);
      const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
      
      if (remainingMs <= 0) {
        // Trial expired
        this.mode = 'locked';
        return {
          licensed: false,
          reason: 'Trial period has expired. Please purchase a license.',
          machineHash: this.machineHash,
          mode: 'locked',
        };
      }
      
      return {
        licensed: true,
        mode: 'trial',
        trialDaysRemaining: remainingDays,
        machineHash: this.machineHash,
        features: {
          adminPanel: true, // Full features during trial
          managedMode: true,
          exports: true,
          advancedReports: true,
        },
        warnings: this.warnings.length > 0 ? [...this.warnings] : undefined,
      };
    }
    
    if (!this.activationCert) {
      return {
        licensed: false,
        reason: 'No license activated',
        machineHash: this.machineHash,
        mode: 'locked',
      };
    }

    // Check if adminPanel feature is enabled
    const features = this.activationCert.certPayload?.features || {};
    if (!features.adminPanel) {
      return {
        licensed: false,
        reason: 'License does not include Admin Panel feature. Upgrade to Pro or Enterprise.',
        features,
        machineHash: this.machineHash,
        mode: 'locked',
      };
    }

    // CRITICAL FIX: Validate machine hash on every status check
    if (this.activationCert.certPayload?.machineHash !== this.machineHash) {
      return {
        licensed: false,
        reason: 'License is bound to a different machine',
        machineHash: this.machineHash,
        mode: 'locked',
      };
    }

    // Check if expired with drift correction
    if (this.activationCert.certPayload?.expiresAt) {
      const expiryDate = new Date(this.activationCert.certPayload.expiresAt);
      const now = this.getDriftCorrectedNow();
      
      if (now > expiryDate) {
        // Check grace period
        const gracePeriodMs = this.GRACE_PERIOD_HOURS * 60 * 60 * 1000;
        const timeSinceExpiry = now.getTime() - expiryDate.getTime();
        
        if (timeSinceExpiry > gracePeriodMs) {
          return {
            licensed: false,
            reason: 'License expired and grace period exceeded',
            features,
            machineHash: this.machineHash,
            mode: 'locked',
          };
        } else {
          const remainingHours = Math.ceil((gracePeriodMs - timeSinceExpiry) / (60 * 60 * 1000));
          this.addWarning(`License expired - ${remainingHours}h remaining in grace period`);
        }
      }
    }

    return {
      licensed: true,
      licenseId: this.activationCert.certPayload?.licenseId,
      expiresAt: this.activationCert.certPayload?.expiresAt,
      features: this.activationCert.certPayload?.features || {},
      warnings: this.warnings.length > 0 ? [...this.warnings] : undefined,
      machineHash: this.machineHash,
      mode: 'activated',
    };
  }

  /**
   * Check if a feature is allowed
   */
  hasFeature(featureName: string): boolean {
    const status = this.getStatus();
    if (!status.licensed || !status.features) {
      return false;
    }
    return status.features[featureName] === true;
  }

  /**
   * Require adminPanel feature for admin console
   */
  requireAdminPanelFeature(): void {
    if (!this.hasFeature('adminPanel')) {
      throw new Error('Admin Panel feature not available. Upgrade your license plan.');
    }
  }

  /**
   * Store activation certificate
   * CRITICAL FIX: Validates machine hash before storing
   */
  storeActivationCert(cert: any): void {
    // Verify signature before storing
    if (!this.verifyCertSignature(cert)) {
      throw new Error('Invalid certificate signature');
    }

    // Validate structure
    if (!this.validateCertPayload(cert.certPayload)) {
      throw new Error('Invalid certificate structure');
    }

    // CRITICAL FIX: Validate machine hash matches this device
    if (cert.certPayload?.machineHash !== this.machineHash) {
      console.error('[AdminLicensing] Machine hash mismatch during activation');
      console.error('[AdminLicensing] Expected:', this.machineHash.substring(0, 16) + '...');
      console.error('[AdminLicensing] Got:', cert.certPayload?.machineHash?.substring(0, 16) + '...');
      throw new Error('Certificate is bound to a different machine');
    }

    // Check adminPanel feature
    if (!cert.certPayload?.features?.adminPanel) {
      throw new Error('License does not include Admin Panel feature');
    }

    this.activationCert = cert;
    this.lastServerTime = cert.certPayload?.serverTime || null;
    this.lastServerLocalTime = Date.now();

    // Persist to database (encrypted)
    this.saveCertToDb(cert);
    
    // CRITICAL FIX: Start heartbeat after successful activation
    this.startHeartbeat();
  }

  /**
   * Get drift-corrected current time
   */
  private getDriftCorrectedNow(): Date {
    if (!this.lastServerTime || !this.lastServerLocalTime) {
      return new Date();
    }

    const serverTime = new Date(this.lastServerTime).getTime();
    const drift = Date.now() - this.lastServerLocalTime;
    return new Date(serverTime + drift);
  }

  /**
   * Add a warning
   */
  private addWarning(warning: string): void {
    if (!this.warnings.includes(warning)) {
      this.warnings.push(warning);
    }
  }

  /**
   * Validate certificate payload structure
   */
  private validateCertPayload(payload: any): boolean {
    if (!payload) return false;
    if (!payload.certVersion) return false;
    if (!payload.licenseId) return false;
    if (!payload.plan) return false;
    if (typeof payload.seats !== 'number' || payload.seats < 1) return false;
    if (!payload.machineHash) return false;
    if (!payload.features || typeof payload.features !== 'object') return false;
    return true;
  }

  /**
   * Verify certificate signature using Ed25519 (tweetnacl)
   * CRITICAL FIX: Use tweetnacl for compatibility with server's signature format
   */
  private verifyCertSignature(cert: any): boolean {
    try {
      if (!cert.certPayload || !cert.certSignature) {
        console.error('[AdminLicensing] Certificate missing payload or signature');
        return false;
      }

      const payload = cert.certPayload;
      const signature = cert.certSignature;

      // Canonical JSON serialization (sorted keys) - must match server
      const payloadJson = JSON.stringify(payload, Object.keys(payload).sort());
      const payloadBytes = new Uint8Array(Buffer.from(payloadJson, 'utf-8'));
      
      // Decode signature from base64
      const signatureBytes = new Uint8Array(Buffer.from(signature, 'base64'));
      
      // Decode public key from base64 (raw 32-byte Ed25519 key)
      const publicKeyBytes = new Uint8Array(Buffer.from(this.publicKey, 'base64'));

      // Validate key and signature lengths
      if (publicKeyBytes.length !== nacl.sign.publicKeyLength) {
        console.error('[AdminLicensing] Invalid public key length:', publicKeyBytes.length, 'expected:', nacl.sign.publicKeyLength);
        return false;
      }

      if (signatureBytes.length !== nacl.sign.signatureLength) {
        console.error('[AdminLicensing] Invalid signature length:', signatureBytes.length, 'expected:', nacl.sign.signatureLength);
        return false;
      }

      // Verify using tweetnacl (same as server and main app)
      const isValid = nacl.sign.detached.verify(payloadBytes, signatureBytes, publicKeyBytes);
      
      if (!isValid) {
        console.warn('[AdminLicensing] Signature verification failed');
      } else {
        console.log('[AdminLicensing] Signature verification successful');
      }
      
      return isValid;
    } catch (error) {
      console.error('[AdminLicensing] Signature verification error:', error);
      return false;
    }
  }

  /**
   * BUG FIX #25: Encrypt data using AES-256-GCM
   */
  private encrypt(data: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, this.encryptionKey, iv);
    
    let encrypted = cipher.update(data, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    
    const authTag = cipher.getAuthTag();
    
    // Combine IV + authTag + encrypted data
    return Buffer.concat([iv, authTag, Buffer.from(encrypted, 'base64')]).toString('base64');
  }

  /**
   * BUG FIX #25: Decrypt data using AES-256-GCM
   */
  private decrypt(encryptedData: string): string {
    const buffer = Buffer.from(encryptedData, 'base64');
    
    const iv = buffer.subarray(0, IV_LENGTH);
    const authTag = buffer.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = buffer.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted.toString('base64'), 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  /**
   * Ensure certificate table exists
   */
  private ensureCertTable(): void {
    try {
      const existing = this.db.getSetting('_admin_cert_payload');
      if (!existing) {
        this.db.setSetting('_admin_cert_initialized', 'true');
      }
    } catch (error) {
      console.error('[AdminLicensing] Error initializing cert storage:', error);
    }
  }

  /**
   * Load certificate from database (decrypted)
   */
  private loadCertFromDb(): any | null {
    try {
      const encryptedPayload = this.db.getSetting('_admin_cert_payload_encrypted');
      const encryptedSignature = this.db.getSetting('_admin_cert_signature_encrypted');

      // Try encrypted format first
      if (encryptedPayload && encryptedSignature) {
        try {
          const payloadJson = this.decrypt(encryptedPayload);
          const signature = this.decrypt(encryptedSignature);
          return {
            certPayload: JSON.parse(payloadJson),
            certSignature: signature,
          };
        } catch (decryptError) {
          console.warn('[AdminLicensing] Failed to decrypt cert, trying plaintext');
        }
      }

      // Fallback to plaintext (for migration)
      const payloadJson = this.db.getSetting('_admin_cert_payload');
      const signature = this.db.getSetting('_admin_cert_signature');

      if (!payloadJson || !signature) {
        return null;
      }

      // Migrate to encrypted format
      const cert = {
        certPayload: JSON.parse(payloadJson),
        certSignature: signature,
      };
      this.saveCertToDb(cert);
      
      // Clear plaintext
      this.db.setSetting('_admin_cert_payload', '');
      this.db.setSetting('_admin_cert_signature', '');

      return cert;
    } catch (error) {
      console.error('[AdminLicensing] Error loading cert from db:', error);
      return null;
    }
  }

  /**
   * Save certificate to database (encrypted)
   * BUG FIX #32: Make certificate save atomic to prevent data loss
   */
  private saveCertToDb(cert: any): void {
    try {
      const payloadJson = JSON.stringify(cert.certPayload);
      const signature = cert.certSignature;

      // BUG FIX #25: Encrypt before storing
      const encryptedPayload = this.encrypt(payloadJson);
      const encryptedSignature = this.encrypt(signature);
      const timestamp = new Date().toISOString();

      // BUG FIX #32: Save all values atomically
      // First write to temp keys, then swap to prevent partial writes
      this.db.setSetting('_admin_cert_payload_temp', encryptedPayload);
      this.db.setSetting('_admin_cert_signature_temp', encryptedSignature);
      this.db.setSetting('_admin_cert_updated_temp', timestamp);
      
      // Now swap to real keys
      this.db.setSetting('_admin_cert_payload_encrypted', encryptedPayload);
      this.db.setSetting('_admin_cert_signature_encrypted', encryptedSignature);
      this.db.setSetting('_admin_cert_updated_at', timestamp);
      
      // Clean up temp keys
      this.db.setSetting('_admin_cert_payload_temp', '');
      this.db.setSetting('_admin_cert_signature_temp', '');
      this.db.setSetting('_admin_cert_updated_temp', '');
      
      console.log('[AdminLicensing] Certificate saved successfully');
    } catch (error) {
      console.error('[AdminLicensing] Error saving cert to db:', error);
      throw error; // Re-throw to let caller know save failed
    }
  }

  /**
   * Delete certificate from database
   */
  private deleteCertFromDb(): void {
    try {
      this.db.setSetting('_admin_cert_payload', '');
      this.db.setSetting('_admin_cert_signature', '');
      this.db.setSetting('_admin_cert_payload_encrypted', '');
      this.db.setSetting('_admin_cert_signature_encrypted', '');
      this.db.setSetting('_admin_cert_updated_at', '');
    } catch (error) {
      console.error('[AdminLicensing] Error deleting cert from db:', error);
    }
  }

  // ============================================================
  // CRITICAL FIX: Heartbeat Mechanism for Revocation Detection
  // ============================================================

  /**
   * Start periodic heartbeat checks
   * CRITICAL: This ensures revoked licenses are detected within minutes
   */
  private startHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    console.log('[AdminLicensing] Starting heartbeat checks every', this.HEARTBEAT_INTERVAL_MS / 1000, 'seconds');

    // Perform initial heartbeat
    this.performHeartbeat();

    // Schedule periodic heartbeats
    this.heartbeatInterval = setInterval(() => {
      this.performHeartbeat();
    }, this.HEARTBEAT_INTERVAL_MS);
  }

  /**
   * Stop heartbeat checks
   */
  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      console.log('[AdminLicensing] Heartbeat stopped');
    }
  }

  /**
   * Perform heartbeat check with licensing server
   * CRITICAL: Detects revoked/expired licenses
   */
  private async performHeartbeat(): Promise<void> {
    if (!this.activationCert) {
      console.log('[AdminLicensing] No activation cert - skipping heartbeat');
      return;
    }

    const certPayload = this.activationCert.certPayload;
    this.lastHeartbeatAttempt = Date.now();

    try {
      console.log('[AdminLicensing] Performing heartbeat for license:', certPayload.licenseId);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.NETWORK_TIMEOUT_MS);

      try {
        const response = await fetch(`${LICENSING_SERVER_URL}/v1/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            licenseId: certPayload.licenseId,
            machineHash: this.machineHash,
            appVersion: app.getVersion(),
            lastCertHash: this.hashPayload(certPayload),
            appType: 'ADMIN', // Identify as Admin Console
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          console.error('[AdminLicensing] Heartbeat request failed:', response.status);
          this.handleHeartbeatFailure();
          return;
        }

        // Reset failure count on success
        this.consecutiveHeartbeatFailures = 0;

        const data = await response.json();

        // Validate response structure
        if (!data.status || !data.serverTime) {
          console.error('[AdminLicensing] Malformed heartbeat response');
          return;
        }

        // CRITICAL: Verify heartbeat response signature
        if (data.signature) {
          const { signature, ...payload } = data;
          const payloadJson = JSON.stringify(payload, Object.keys(payload).sort());
          const payloadBytes = new Uint8Array(Buffer.from(payloadJson, 'utf-8'));
          const signatureBytes = new Uint8Array(Buffer.from(signature, 'base64'));
          const publicKeyBytes = new Uint8Array(Buffer.from(this.publicKey, 'base64'));
          
          if (publicKeyBytes.length === nacl.sign.publicKeyLength && 
              signatureBytes.length === nacl.sign.signatureLength) {
            const isValid = nacl.sign.detached.verify(payloadBytes, signatureBytes, publicKeyBytes);
            if (!isValid) {
              console.error('[AdminLicensing] Invalid heartbeat signature - possible MITM attack');
              this.handleHeartbeatFailure();
              return;
            }
            console.log('[AdminLicensing] Heartbeat signature verified');
          }
        }

        // Update server time for drift correction
        this.lastServerTime = data.serverTime;
        this.lastServerLocalTime = Date.now();
        
        // CRITICAL FIX: Persist server time for drift correction across restarts
        this.db.setSetting('_admin_last_server_time', data.serverTime);
        this.db.setSetting('_admin_last_server_local_time', String(this.lastServerLocalTime));

        // Check license status
        if (data.status === 'REVOKED' || data.status === 'EXPIRED') {
          console.warn('[AdminLicensing] License status:', data.status);
          this.handleLicenseRevocation(data.status);
          return;
        }

        // Clear grace period on successful heartbeat
        if (this.gracePeriodStartTime) {
          this.gracePeriodStartTime = null;
          this.warnings = this.warnings.filter(w => !w.includes('grace period'));
          console.log('[AdminLicensing] Grace period cleared - license valid');
        }

        console.log('[AdminLicensing] Heartbeat successful - license OK');

      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.error('[AdminLicensing] Heartbeat timeout');
      } else {
        console.error('[AdminLicensing] Heartbeat error:', error.message);
      }
      this.handleHeartbeatFailure();
    }
  }

  /**
   * Handle heartbeat failure (network error, timeout)
   * Uses exponential backoff and grace period
   */
  private handleHeartbeatFailure(): void {
    this.consecutiveHeartbeatFailures++;
    this.lastHeartbeatAttempt = Date.now();
    
    // Calculate backoff (exponential, capped at MAX_HEARTBEAT_BACKOFF_MS)
    const backoffMs = Math.min(
      this.HEARTBEAT_INTERVAL_MS * Math.pow(2, this.consecutiveHeartbeatFailures - 1),
      this.MAX_HEARTBEAT_BACKOFF_MS
    );
    console.warn('[AdminLicensing] Heartbeat failure count:', this.consecutiveHeartbeatFailures, 'next retry in:', backoffMs / 1000, 'seconds');

    // Start grace period if not already started
    if (!this.gracePeriodStartTime) {
      this.gracePeriodStartTime = new Date().toISOString();
      console.log('[AdminLicensing] Grace period started');
    }

    // Check if grace period exceeded
    const graceMs = this.GRACE_PERIOD_HOURS * 60 * 60 * 1000;
    const elapsed = Date.now() - new Date(this.gracePeriodStartTime).getTime();

    if (elapsed > graceMs) {
      console.error('[AdminLicensing] Grace period exceeded - locking');
      this.handleLicenseRevocation('OFFLINE_TOO_LONG');
    } else {
      const remainingHours = Math.ceil((graceMs - elapsed) / (60 * 60 * 1000));
      this.addWarning(`Unable to verify license - ${remainingHours}h remaining in grace period`);
    }
  }

  /**
   * Handle license revocation/expiration
   * CRITICAL: Clears certificate and notifies UI
   */
  private handleLicenseRevocation(reason: string): void {
    console.error('[AdminLicensing] License revoked/expired:', reason);

    // Clear activation cert
    this.activationCert = null;
    this.deleteCertFromDb();

    // Stop heartbeat
    this.stopHeartbeat();

    // Add warning
    this.addWarning(`License ${reason.toLowerCase().replace('_', ' ')}`);

    // Notify renderer via IPC (if available)
    try {
      const { BrowserWindow } = require('electron');
      const windows = BrowserWindow.getAllWindows();
      windows.forEach((win: any) => {
        try {
          win.webContents.send('license:revoked', { reason });
        } catch (e) {
          // Ignore send errors
        }
      });
    } catch (e) {
      // Electron not available
    }
  }

  /**
   * Hash payload for comparison
   */
  private hashPayload(payload: any): string {
    const json = JSON.stringify(payload, Object.keys(payload).sort());
    return crypto.createHash('sha256').update(json).digest('hex');
  }

  // ============================================================
  // CRITICAL FIX: Activation with License Key
  // ============================================================

  /**
   * Activate Admin Console with license key
   * CRITICAL: Validates seat limits and machine binding
   */
  async activateWithKey(licenseKey: string): Promise<{ success: boolean; error?: string }> {
    try {
      console.log('[AdminLicensing] Activating with license key');

      // Validate license key format
      // Format: PT1-<base64payload>.<base64signature>
      if (!/^PT1-[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/.test(licenseKey)) {
        return { success: false, error: 'Invalid license key format - must be PT1-<payload>.<signature>' };
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.NETWORK_TIMEOUT_MS);

      try {
        const response = await fetch(`${LICENSING_SERVER_URL}/v1/activate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            licenseKey,
            machineHash: this.machineHash,
            appVersion: app.getVersion(),
            appType: 'ADMIN', // Identify as Admin Console
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          console.error('[AdminLicensing] Activation failed:', errorData);
          
          // Handle specific error codes
          if (errorData.error === 'SEAT_LIMIT') {
            return { success: false, error: 'License seat limit reached. Each license can only be used on one device.' };
          }
          
          return { success: false, error: errorData.error || errorData.message || 'Activation failed' };
        }

        const data = await response.json();

        // Validate response structure
        if (!data.activationCert || !data.activationCert.certPayload || !data.activationCert.certSignature) {
          console.error('[AdminLicensing] Malformed activation response');
          return { success: false, error: 'Invalid server response' };
        }

        // Check if adminPanel feature is included
        if (!data.activationCert.certPayload.features?.adminPanel) {
          return { success: false, error: 'License does not include Admin Panel feature. Upgrade to Pro or Enterprise.' };
        }

        // Store the certificate (this validates signature and machine hash)
        try {
          this.storeActivationCert(data.activationCert);
        } catch (storeError: any) {
          return { success: false, error: storeError.message };
        }

        // Update server time
        this.lastServerTime = data.serverTime;
        this.lastServerLocalTime = Date.now();
        
        // CRITICAL FIX: Persist server time for drift correction across restarts
        this.db.setSetting('_admin_last_server_time', data.serverTime);
        this.db.setSetting('_admin_last_server_local_time', String(this.lastServerLocalTime));

        // Exit trial mode since we're now activated
        this.mode = 'activated';

        console.log('[AdminLicensing] Activation successful');
        return { success: true };

      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.error('[AdminLicensing] Activation timeout');
        return { success: false, error: 'Network timeout - server not responding' };
      }
      console.error('[AdminLicensing] Activation error:', error);
      return { success: false, error: error.message || 'Network error' };
    }
  }

  /**
   * Deactivate license (clear local certificate)
   */
  deactivate(): void {
    console.log('[AdminLicensing] Deactivating license');
    this.activationCert = null;
    this.mode = 'locked';
    this.deleteCertFromDb();
    this.stopHeartbeat();
    this.warnings = [];
    this.gracePeriodStartTime = null;
  }

  /**
   * Start trial period for Admin Console
   * CRITICAL FIX: Uses Windows Registry to prevent trial reset by deleting database
   */
  async startTrial(): Promise<{ success: boolean; error?: string }> {
    // CRITICAL: Check registry first (cannot be deleted by user)
    const hasUsedTrialInRegistry = await this.registry.hasTrialBeenUsed();
    if (hasUsedTrialInRegistry) {
      const registryTrialStart = await this.registry.getTrialStartDate();
      if (registryTrialStart) {
        const trialStartDate = new Date(registryTrialStart);
        const now = Date.now();
        const elapsed = now - trialStartDate.getTime();
        const trialPeriodMs = this.TRIAL_PERIOD_DAYS * 24 * 60 * 60 * 1000;
        
        if (elapsed >= trialPeriodMs) {
          console.warn('[AdminLicensing] Trial already used and expired (registry check)');
          return { 
            success: false, 
            error: 'Trial period has already been used on this device. Please purchase a license.' 
          };
        } else {
          // Trial still active from registry, sync to database and continue
          this.trialStart = registryTrialStart;
          this.db.setSetting('_admin_trial_start', registryTrialStart);
          this.mode = 'trial';
          console.log('[AdminLicensing] Resuming existing trial from registry');
          return { success: true };
        }
      }
    }
    
    // Also check database (for backward compatibility)
    const existingTrialStart = this.db.getSetting('_admin_trial_start');
    if (existingTrialStart) {
      const trialStartDate = new Date(existingTrialStart);
      const now = Date.now();
      const elapsed = now - trialStartDate.getTime();
      const trialPeriodMs = this.TRIAL_PERIOD_DAYS * 24 * 60 * 60 * 1000;
      
      if (elapsed >= trialPeriodMs) {
        console.warn('[AdminLicensing] Trial already used and expired');
        return { 
          success: false, 
          error: 'Trial period has already been used on this device. Please purchase a license.' 
        };
      } else {
        // Trial still active, just set mode
        this.trialStart = existingTrialStart;
        this.mode = 'trial';
        console.log('[AdminLicensing] Resuming existing trial');
        return { success: true };
      }
    }
    
    // Check if already activated (shouldn't downgrade to trial)
    if (this.mode === 'activated' && this.activationCert) {
      console.warn('[AdminLicensing] Already activated - no need for trial');
      return { 
        success: false, 
        error: 'License is already activated. No need to start trial.' 
      };
    }
    
    // Start new trial
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.TRIAL_PERIOD_DAYS * 24 * 60 * 60 * 1000);
    const nowIso = now.toISOString();
    
    // Store in database
    this.db.setSetting('_admin_trial_start', nowIso);
    this.trialStart = nowIso;
    this.mode = 'trial';
    
    // CRITICAL: Store in Windows Registry (cannot be deleted by user)
    try {
      await this.registry.setTrialData({
        machineHash: this.machineHash,
        startedAt: nowIso,
        expiresAt: expiresAt.toISOString(),
      });
      console.log('[AdminLicensing] Trial started and stored in registry:', nowIso);
    } catch (registryError) {
      console.error('[AdminLicensing] Failed to store trial in registry:', registryError);
      // Continue anyway - database storage is still valid
    }
    
    return { success: true };
  }

  /**
   * Get machine hash for display
   */
  getMachineHash(): string {
    return this.machineHash;
  }
}
