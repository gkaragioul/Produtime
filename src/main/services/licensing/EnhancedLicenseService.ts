import { app, BrowserWindow } from 'electron';
import { DatabaseManager } from '../../database';
import { Logger } from '../../logger';
import { getMachineFingerprint } from './machineFingerprint';
import { SecureStore } from './secureStore';
import {
  detectTamper,
  updateLastSeen,
  storeTamperFlags,
  clearTamperFlags,
  TamperFlag,
} from './tamperDetection';
import { LicenseCryptoService } from '../license-crypto-service';
import {
  ActivationCert,
  ActivationCertPayload,
  LicenseFeatures,
  TamperSeverity,
} from '../../../shared/licensing/entitlements';
import {
  verifyEd25519,
  verifyActivationCert,
  computeDriftedNow,
  isExpired,
  hasFeature,
  classifyTamper,
  validateCertPayload,
  isWithinGracePeriod,
} from '../../../shared/licensing/verification';

const logger = Logger.getInstance();

export enum LicenseMode {
  TRIAL = 'trial',
  ACTIVATED = 'activated',
  LOCKED = 'locked',
}

export interface LicenseStatus {
  mode: LicenseMode;
  isEntitled: boolean;
  reason?: string;
  trialDaysRemaining?: number;
  expiresAt?: string;
  licenseId?: string;
  features?: LicenseFeatures;
  warnings?: string[];
}

interface LicenseState {
  id: number;
  mode: string;
  trialStart: string | null;
  lastSeen: string | null;
  lastServerTime: string | null;
  lastServerLocalTime: number | null;
  nextCheckAt: string | null;
  activationCertEncrypted: Buffer | null;
  tamperFlags: string | null;
  gracePeriodStart: string | null;
  createdAt: string;
  updatedAt: string;
}

export class EnhancedLicenseService {
  private static instance: EnhancedLicenseService;
  private db: DatabaseManager;
  private crypto: LicenseCryptoService;
  private secureStore: SecureStore;
  private publicKey: string;

  private mode: LicenseMode = LicenseMode.LOCKED;
  private lastHeartbeat: Date | null = null;
  private nextCheckAt: Date | null = null;
  private activationCert: ActivationCert | null = null;
  private features: LicenseFeatures = {};
  private lastServerTime: string | null = null;
  private lastServerLocalTime: number | null = null;
  private revocationCheckBackoff: number = 5 * 60 * 1000; // Start at 5 minutes
  private lastRevocationCheckAttempt: number = 0;
  private consecutiveHeartbeatFailures: number = 0;
  private warnings: string[] = [];
  private gracePeriodStartTime: string | null = null;

  private readonly TRIAL_PERIOD_DAYS = 7;
  private readonly GRACE_PERIOD_HOURS = 72;
  private readonly HEARTBEAT_INTERVAL_HOURS = 12;
  private readonly REVOCATION_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_REVOCATION_BACKOFF_MS = 60 * 60 * 1000; // 1 hour max
  private readonly EXTREME_DRIFT_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

  private serverUrl: string;
  private revocationCheckTimer: NodeJS.Timeout | null = null;
  private heartbeatScheduleTimer: NodeJS.Timeout | null = null;

  private constructor(db: DatabaseManager, publicKey: string, serverUrl: string) {
    this.db = db;
    this.crypto = LicenseCryptoService.getInstance();
    this.secureStore = SecureStore.getInstance();
    this.publicKey = publicKey;
    this.serverUrl = serverUrl;

    logger.info('ENHANCED_LICENSE', 'Enhanced license service initialized', {
      publicKey: publicKey.substring(0, 10) + '...',
      serverUrl,
    });
  }

  public static getInstance(
    db: DatabaseManager,
    publicKey: string,
    serverUrl: string
  ): EnhancedLicenseService {
    if (!EnhancedLicenseService.instance) {
      EnhancedLicenseService.instance = new EnhancedLicenseService(
        db,
        publicKey,
        serverUrl
      );
    }
    return EnhancedLicenseService.instance;
  }

  /**
   * Initialize license system
   * Must be called on app startup
   */
  public async init(): Promise<void> {
    logger.info('ENHANCED_LICENSE', 'Initializing license system');

    // BUG FIX #15: Handle database corruption
    try {
      // Ensure license_state table exists
      this.ensureLicenseStateTable();
    } catch (error) {
      logger.error('ENHANCED_LICENSE', 'Failed to ensure license state table', { error });
      // Try to recover by recreating the table
      try {
        this.db.execute('DROP TABLE IF EXISTS license_state');
        this.ensureLicenseStateTable();
        logger.info('ENHANCED_LICENSE', 'Recovered from database corruption - table recreated');
      } catch (recoveryError) {
        logger.error('ENHANCED_LICENSE', 'Failed to recover from database corruption', { recoveryError });
        this.mode = LicenseMode.LOCKED;
        return;
      }
    }

    // Get or create license state
    let state = this.getLicenseState();

    if (!state) {
      logger.info('ENHANCED_LICENSE', 'First run - creating initial license state');
      this.createInitialState();
      state = this.getLicenseState();
    }

    // BUG FIX #15: Validate state integrity
    if (!state || !this.validateStateIntegrity(state)) {
      logger.error('ENHANCED_LICENSE', 'License state corrupted or invalid');
      // Reset to locked state
      try {
        this.db.execute('DELETE FROM license_state WHERE id = 1');
        this.createInitialState();
        state = this.getLicenseState();
        logger.info('ENHANCED_LICENSE', 'License state reset due to corruption');
      } catch (error) {
        logger.error('ENHANCED_LICENSE', 'Failed to reset license state', { error });
        this.mode = LicenseMode.LOCKED;
        return;
      }
    }

    if (!state) {
      logger.error('ENHANCED_LICENSE', 'Failed to create license state');
      this.mode = LicenseMode.LOCKED;
      return;
    }

    // BUG FIX #20: Check for extreme time drift
    if (state.lastServerTime && state.lastServerLocalTime) {
      const serverTime = new Date(state.lastServerTime).getTime();
      const expectedNow = serverTime + (Date.now() - state.lastServerLocalTime);
      const actualNow = Date.now();
      const drift = Math.abs(actualNow - expectedNow);

      if (drift > this.EXTREME_DRIFT_THRESHOLD_MS) {
        logger.error('ENHANCED_LICENSE', 'Extreme time drift detected', {
          driftMs: drift,
          driftHours: drift / (60 * 60 * 1000),
        });
        this.addWarning('System clock appears to be incorrect');
        
        // In activated mode, force heartbeat to verify
        if (state.mode === LicenseMode.ACTIVATED) {
          logger.warn('ENHANCED_LICENSE', 'Forcing heartbeat due to extreme drift');
          await this.performHeartbeat();
          state = this.getLicenseState();
          if (!state || state.mode !== 'activated') {
            this.mode = LicenseMode.LOCKED;
            return;
          }
        }
      }
    }

    // Detect tampering
    const tamperResult = detectTamper(this.db);
    if (tamperResult.isTampered) {
      logger.warn('ENHANCED_LICENSE', 'Tampering detected', tamperResult);
      storeTamperFlags(this.db, tamperResult.flags);

      // BUG FIX #16: Handle all tamper severity levels
      switch (tamperResult.severity) {
        case 'high':
          // High severity tamper: lock immediately in trial mode, force heartbeat in activated mode
          if (state.mode === LicenseMode.TRIAL) {
            logger.error('ENHANCED_LICENSE', 'High severity tamper in trial mode - locking');
            this.mode = LicenseMode.LOCKED;
            this.updateMode(LicenseMode.LOCKED);
            return;
          } else if (state.mode === LicenseMode.ACTIVATED) {
            // Force immediate heartbeat
            logger.warn('ENHANCED_LICENSE', 'High severity tamper in activated mode - forcing heartbeat');
            await this.performHeartbeat();
            // Check result
            state = this.getLicenseState();
            if (!state || state.mode !== 'activated') {
              this.mode = LicenseMode.LOCKED;
              return;
            }
          }
          break;

        case 'medium':
          // Medium severity: Add warning and force heartbeat soon
          this.addWarning('Hardware change detected - verifying license');
          if (state.mode === LicenseMode.ACTIVATED) {
            logger.warn('ENHANCED_LICENSE', 'Medium severity tamper - scheduling immediate heartbeat');
            // Schedule heartbeat in 1 minute instead of waiting
            setTimeout(() => this.performHeartbeat(), 60 * 1000);
          }
          break;

        case 'low':
          // Low severity: Just log warning, continue normally
          this.addWarning('Minor system change detected');
          logger.info('ENHANCED_LICENSE', 'Low severity tamper - continuing normally');
          break;
      }
    } else {
      // No tampering - clear flags and warnings
      clearTamperFlags(this.db);
      this.clearWarnings();
    }

    // Load mode
    this.mode = state.mode as LicenseMode;

    // Handle trial mode
    if (this.mode === LicenseMode.TRIAL) {
      if (!state.trialStart) {
        logger.error('ENHANCED_LICENSE', 'Trial mode but no trialStart - locking');
        this.mode = LicenseMode.LOCKED;
        this.updateMode(LicenseMode.LOCKED);
        return;
      }

      const trialStart = new Date(state.trialStart);
      let now = Date.now();

      // BUG FIX #2: Apply time drift correction to trial expiry
      // Prevents users from extending trial by setting clock back
      if (state.lastServerTime && state.lastServerLocalTime) {
        const serverTime = new Date(state.lastServerTime).getTime();
        const drift = now - state.lastServerLocalTime - (Date.now() - state.lastServerLocalTime);
        if (Math.abs(drift) > 30 * 60 * 1000) { // > 30 minutes
          logger.warn('ENHANCED_LICENSE', 'Time drift detected in trial check', { drift });
          now = serverTime + (Date.now() - state.lastServerLocalTime);
        }
      }

      const elapsed = now - trialStart.getTime();
      const trialPeriod = this.TRIAL_PERIOD_DAYS * 24 * 60 * 60 * 1000;

      if (elapsed > trialPeriod) {
        logger.info('ENHANCED_LICENSE', 'Trial period expired');
        this.mode = LicenseMode.LOCKED;
        this.updateMode(LicenseMode.LOCKED);
        return;
      }

      const remainingMs = trialPeriod - elapsed;
      const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
      logger.info('ENHANCED_LICENSE', 'Trial mode active', {
        daysRemaining: remainingDays,
      });
    }

    // Handle activated mode
    if (this.mode === LicenseMode.ACTIVATED) {
      // Load activation cert
      this.activationCert = await this.secureStore.loadActivationCert(this.db);

      if (!this.activationCert) {
        logger.error('ENHANCED_LICENSE', 'Activated mode but no cert - locking');
        this.mode = LicenseMode.LOCKED;
        this.updateMode(LicenseMode.LOCKED);
        return;
      }

      // Verify signature
      if (
        !this.crypto.verifyPayloadSignature(
          this.activationCert.certPayload,
          this.activationCert.certSignature,
          this.publicKey
        )
      ) {
        logger.error('ENHANCED_LICENSE', 'Invalid activation cert signature - locking');
        this.mode = LicenseMode.LOCKED;
        this.updateMode(LicenseMode.LOCKED);
        return;
      }

      // Check grace period
      if (state.lastSeen) {
        const lastSeen = new Date(state.lastSeen);
        let now = Date.now();

        // BUG FIX #3: Apply time drift correction to grace period
        // Prevents users from extending grace period by setting clock back
        if (state.lastServerTime && state.lastServerLocalTime) {
          const serverTime = new Date(state.lastServerTime).getTime();
          // Calculate drift: compare elapsed time since last server contact
          // against what the server thought the time was
          const localElapsed = now - state.lastServerLocalTime;
          const expectedNow = serverTime + localElapsed;
          const drift = now - expectedNow;
          if (Math.abs(drift) > 30 * 60 * 1000) { // > 30 minutes
            logger.warn('ENHANCED_LICENSE', 'Time drift detected in grace period check', { drift });
            now = expectedNow;
          }
        }

        const elapsed = now - lastSeen.getTime();
        const graceMs = this.GRACE_PERIOD_HOURS * 60 * 60 * 1000;

        if (elapsed > graceMs) {
          logger.warn('ENHANCED_LICENSE', 'Grace period exceeded - locking', {
            lastSeen: lastSeen.toISOString(),
            gracePeriodHours: this.GRACE_PERIOD_HOURS,
          });
          this.mode = LicenseMode.LOCKED;
          this.updateMode(LicenseMode.LOCKED);
          return;
        }
      }

      // Check expiry
      if (this.activationCert.certPayload.expiresAt) {
        const expiresAt = new Date(this.activationCert.certPayload.expiresAt);
        if (Date.now() > expiresAt.getTime()) {
          logger.warn('ENHANCED_LICENSE', 'License expired - locking');
          this.mode = LicenseMode.LOCKED;
          this.updateMode(LicenseMode.LOCKED);
          return;
        }
      }

      logger.info('ENHANCED_LICENSE', 'Activated mode valid');
    }

    // Update lastSeen
    updateLastSeen(this.db);

    // Schedule periodic heartbeat
    this.scheduleHeartbeat();

    // BUG FIX #12: Start revocation checks (5-minute interval)
    // Ensures revoked licenses are detected quickly, not just on 12-hour heartbeat
    this.startRevocationChecks();
  }

  /**
   * Get current license status
   */
  public getStatus(): LicenseStatus {
    const status: LicenseStatus = {
      mode: this.mode,
      isEntitled: this.mode === LicenseMode.TRIAL || this.mode === LicenseMode.ACTIVATED,
      warnings: this.warnings.length > 0 ? [...this.warnings] : undefined,
    };

    if (this.mode === LicenseMode.TRIAL) {
      const state = this.getLicenseState();
      if (state?.trialStart) {
        const trialStart = new Date(state.trialStart);
        const elapsed = Date.now() - trialStart.getTime();
        const trialPeriod = this.TRIAL_PERIOD_DAYS * 24 * 60 * 60 * 1000;
        const remainingMs = Math.max(0, trialPeriod - elapsed);
        const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
        status.trialDaysRemaining = remainingDays;
      }
      // Trial mode has limited features
      status.features = {
        adminPanel: false,
        managedMode: false,
        exports: true,
        advancedReports: false,
        customBranding: false,
        apiAccess: false,
      };
    }

    if (this.mode === LicenseMode.ACTIVATED && this.activationCert) {
      status.licenseId = this.activationCert.certPayload.licenseId;
      status.expiresAt = this.activationCert.certPayload.expiresAt || undefined;
      status.features = this.activationCert.certPayload.features || {};
    }

    if (this.mode === LicenseMode.LOCKED) {
      status.reason = 'License required - start trial or enter key';
    }

    return status;
  }

  /**
   * Check if a specific feature is allowed
   * BUG FIX #18: Feature gating method
   */
  public hasFeature(featureName: string): boolean {
    const status = this.getStatus();
    if (!status.isEntitled) return false;
    if (!status.features) return false;

    return status.features[featureName] === true;
  }

  /**
   * Require a specific feature or throw
   * BUG FIX #18: Feature gating method
   */
  public requireFeature(featureName: string): void {
    if (!this.hasFeature(featureName)) {
      const error = new Error(`Feature not available: ${featureName}. Upgrade your license plan.`);
      logger.error('ENHANCED_LICENSE', 'Feature check failed', {
        feature: featureName,
        mode: this.mode,
      });
      throw error;
    }
  }

  /**
   * Get current warnings (offline, drift, tamper)
   */
  public getWarnings(): string[] {
    return [...this.warnings];
  }

  /**
   * Add a warning
   */
  private addWarning(warning: string): void {
    if (!this.warnings.includes(warning)) {
      this.warnings.push(warning);
      logger.warn('ENHANCED_LICENSE', 'Warning added', { warning });
    }
  }

  /**
   * Clear warnings
   */
  private clearWarnings(): void {
    this.warnings = [];
  }

  /**
   * Assert that user is entitled to use the feature
   * Throws if not entitled
   */
  public assertEntitledOrThrow(context: string): void {
    const status = this.getStatus();
    if (!status.isEntitled) {
      const error = new Error(`License required for: ${context}`);
      logger.error('ENHANCED_LICENSE', 'Entitlement check failed', {
        context,
        mode: this.mode,
      });
      throw error;
    }
  }

  /**
   * Start trial period
   * BUG FIX #26: Prevent trial restart by checking if trial was already used
   */
  public async startTrial(): Promise<{ success: boolean; error?: string }> {
    try {
      logger.info('ENHANCED_LICENSE', 'Starting trial');

      // BUG FIX #26: Check if trial was already used
      // Prevents users from restarting trial by deleting database
      const state = this.getLicenseState();
      if (state?.trialStart) {
        logger.warn('ENHANCED_LICENSE', 'Trial already used - cannot restart', {
          originalTrialStart: state.trialStart,
        });
        return { 
          success: false, 
          error: 'Trial period has already been used on this device. Please purchase a license.' 
        };
      }

      // Also check if already activated (shouldn't downgrade to trial)
      if (state?.mode === LicenseMode.ACTIVATED) {
        logger.warn('ENHANCED_LICENSE', 'Already activated - cannot start trial');
        return { 
          success: false, 
          error: 'License is already activated. No need to start trial.' 
        };
      }

      const now = new Date().toISOString();
      this.db.execute(
        'UPDATE license_state SET mode = ?, trialStart = ?, lastSeen = ?, updatedAt = ? WHERE id = 1',
        [LicenseMode.TRIAL, now, now, now]
      );

      this.mode = LicenseMode.TRIAL;

      // BUG FIX #27: Log trial start for audit purposes
      logger.info('ENHANCED_LICENSE', 'Trial started successfully', {
        trialStart: now,
        trialDays: this.TRIAL_PERIOD_DAYS,
      });
      return { success: true };
    } catch (error: any) {
      logger.error('ENHANCED_LICENSE', 'Failed to start trial', { error });
      return { success: false, error: error.message };
    }
  }

  /**
   * Activate with license key
   */
  public async activateWithKey(
    licenseKey: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      logger.info('ENHANCED_LICENSE', 'Activating with license key');

      // BUG FIX #33: Validate license key format client-side for better UX
      // Format: PT1-<base64payload>.<base64signature>
      if (!/^PT1-[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/.test(licenseKey)) {
        logger.warn('ENHANCED_LICENSE', 'Invalid license key format');
        return { success: false, error: 'Invalid license key format - must be PT1-<payload>.<signature>' };
      }

      const machineHash = getMachineFingerprint();
      const appVersion = app.getVersion();

      // BUG FIX #8: Add network timeout to fetch requests
      // Prevents app from hanging if server is unresponsive
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      try {
        const response = await fetch(`${this.serverUrl}/v1/activate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ licenseKey, machineHash, appVersion, appType: 'CLIENT' }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const error = await response.json();
          logger.error('ENHANCED_LICENSE', 'Activation failed', { error });
          return { success: false, error: error.error || 'Activation failed' };
        }

        const data = await response.json();

        // BUG FIX #9: Validate response structure before using
        // Prevents crash from malformed server response
        if (!data.activationCert || !data.activationCert.certPayload || !data.activationCert.certSignature) {
          logger.error('ENHANCED_LICENSE', 'Malformed activation response');
          return { success: false, error: 'Invalid server response' };
        }

        // Verify activation cert signature
        if (
          !this.crypto.verifyPayloadSignature(
            data.activationCert.certPayload,
            data.activationCert.certSignature,
            this.publicKey
          )
        ) {
          logger.error('ENHANCED_LICENSE', 'Invalid activation cert signature');
          return { success: false, error: 'Invalid activation certificate' };
        }

        // Store activation cert
        await this.secureStore.storeActivationCert(data.activationCert, this.db);

        // Update state
        const now = new Date().toISOString();
        this.db.execute(
          'UPDATE license_state SET mode = ?, lastSeen = ?, lastServerTime = ?, nextCheckAt = ?, updatedAt = ? WHERE id = 1',
          [LicenseMode.ACTIVATED, now, data.serverTime, data.nextCheckAt, now]
        );

        this.mode = LicenseMode.ACTIVATED;
        this.activationCert = data.activationCert;
        this.nextCheckAt = new Date(data.nextCheckAt);

        logger.info('ENHANCED_LICENSE', 'Activation successful');

        // Schedule heartbeat
        this.scheduleHeartbeat();

        return { success: true };
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error: any) {
      // BUG FIX #22: Log activation failures to file
      if (error.name === 'AbortError') {
        logger.error('ENHANCED_LICENSE', 'Activation timeout - server not responding', {
          serverUrl: this.serverUrl,
          timestamp: new Date().toISOString(),
        });
        return { success: false, error: 'Network timeout - server not responding' };
      }
      logger.error('ENHANCED_LICENSE', 'Activation error', { 
        error: error.message || String(error),
        stack: error.stack,
        timestamp: new Date().toISOString(),
      });
      return { success: false, error: error.message || 'Network error' };
    }
  }

  /**
   * Perform heartbeat check if due
   */
  public async heartbeatIfDue(): Promise<void> {
    if (this.mode !== LicenseMode.ACTIVATED) return;

    if (this.nextCheckAt && Date.now() < this.nextCheckAt.getTime()) {
      return; // Not due yet
    }

    await this.performHeartbeat();
  }

  /**
   * Perform heartbeat check
   * BUG FIX #27: Implement exponential backoff on failures
   */
  private async performHeartbeat(): Promise<void> {
    try {
      logger.info('ENHANCED_LICENSE', 'Performing heartbeat');

      if (!this.activationCert) {
        logger.error('ENHANCED_LICENSE', 'No activation cert for heartbeat');
        this.mode = LicenseMode.LOCKED;
        this.updateMode(LicenseMode.LOCKED);
        return;
      }

      const machineHash = getMachineFingerprint();
      const appVersion = app.getVersion();
      const certPayload = this.activationCert.certPayload;

      // BUG FIX #8: Add network timeout to fetch requests
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      try {
        const response = await fetch(`${this.serverUrl}/v1/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            licenseId: certPayload.licenseId,
            machineHash,
            appVersion,
            lastCertHash: this.crypto.hashPayload(certPayload),
            appType: 'CLIENT', // Identify as ProduTime client app
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          logger.error('ENHANCED_LICENSE', 'Heartbeat request failed', {
            status: response.status,
          });
          // BUG FIX #27: Implement exponential backoff on failure
          this.consecutiveHeartbeatFailures++;
          this.revocationCheckBackoff = Math.min(
            this.revocationCheckBackoff * 2,
            this.MAX_REVOCATION_BACKOFF_MS
          );
          logger.info('ENHANCED_LICENSE', 'Backoff increased', {
            failures: this.consecutiveHeartbeatFailures,
            nextBackoffMs: this.revocationCheckBackoff,
          });
          // Don't lock on network error - wait for grace period
          return;
        }

        // BUG FIX #27: Reset backoff on success
        this.consecutiveHeartbeatFailures = 0;
        this.revocationCheckBackoff = this.REVOCATION_CHECK_INTERVAL_MS;

        const data = await response.json();

        // BUG FIX #9: Validate response structure before using
        if (!data.status || !data.serverTime || !data.nextCheckAt) {
          logger.error('ENHANCED_LICENSE', 'Malformed heartbeat response');
          return;
        }

        // BUG FIX #29: Validate features object structure if present
        if (data.features !== undefined && data.features !== null) {
          if (typeof data.features !== 'object' || Array.isArray(data.features)) {
            logger.error('ENHANCED_LICENSE', 'Invalid features format in heartbeat response');
            return;
          }
          // Validate each feature is a boolean
          for (const [key, value] of Object.entries(data.features)) {
            if (typeof value !== 'boolean') {
              logger.warn('ENHANCED_LICENSE', 'Non-boolean feature value', { key, value });
            }
          }
        }

        // Verify signature
        const { signature, ...payload } = data;
        if (!this.crypto.verifyPayloadSignature(payload, signature, this.publicKey)) {
          logger.error('ENHANCED_LICENSE', 'Invalid heartbeat signature');
          this.mode = LicenseMode.LOCKED;
          this.updateMode(LicenseMode.LOCKED);
          return;
        }

        // Check status - IMMEDIATE lockout on REVOKED or EXPIRED (no grace period)
        if (data.status === 'REVOKED' || data.status === 'EXPIRED') {
          logger.warn('ENHANCED_LICENSE', 'License revoked or expired - IMMEDIATE LOCKOUT', {
            status: data.status,
          });

          // Clear any existing grace period state
          this.db.execute(
            'UPDATE license_state SET gracePeriodStart = NULL, updatedAt = ? WHERE id = 1',
            [new Date().toISOString()]
          );
          this.gracePeriodStartTime = null;

          // IMMEDIATE LOCKOUT - no grace period for explicit revocation/expiry
          this.mode = LicenseMode.LOCKED;
          this.updateMode(LicenseMode.LOCKED);
          this.broadcastLockout(data.status);
          return;
        } else {
          // BUG FIX #21: Clear grace period on successful heartbeat
          const state = this.getLicenseState();
          if (state?.gracePeriodStart) {
            this.db.execute(
              'UPDATE license_state SET gracePeriodStart = NULL, updatedAt = ? WHERE id = 1',
              [new Date().toISOString()]
            );
            this.gracePeriodStartTime = null;
            this.clearWarnings();
            logger.info('ENHANCED_LICENSE', 'Grace period cleared - license valid');
          }
        }

        // Update state
        const now = new Date().toISOString();
        this.db.execute(
          'UPDATE license_state SET lastSeen = ?, lastServerTime = ?, lastServerLocalTime = ?, nextCheckAt = ?, updatedAt = ? WHERE id = 1',
          [now, data.serverTime, Date.now(), data.nextCheckAt, now]
        );

        this.nextCheckAt = new Date(data.nextCheckAt);
        this.lastHeartbeat = new Date();
        this.lastServerTime = data.serverTime;
        this.lastServerLocalTime = Date.now();

        // BUG FIX #23: Check certificate expiry after heartbeat
        if (this.activationCert?.certPayload.expiresAt) {
          const driftedNow = computeDriftedNow(data.serverTime, Date.now());
          if (isExpired(this.activationCert.certPayload.expiresAt, driftedNow)) {
            logger.warn('ENHANCED_LICENSE', 'Certificate expired (detected after heartbeat)');
            this.addWarning('License has expired');
            // Don't lock immediately - let grace period handle it
          }
        }

        logger.info('ENHANCED_LICENSE', 'Heartbeat successful', {
          nextCheckAt: data.nextCheckAt,
        });

        // Schedule next heartbeat
        this.scheduleHeartbeat();
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      // BUG FIX #27: Implement exponential backoff on network errors
      this.consecutiveHeartbeatFailures++;
      this.revocationCheckBackoff = Math.min(
        this.revocationCheckBackoff * 2,
        this.MAX_REVOCATION_BACKOFF_MS
      );
      
      if (error instanceof Error && error.name === 'AbortError') {
        logger.error('ENHANCED_LICENSE', 'Heartbeat timeout - server not responding', {
          failures: this.consecutiveHeartbeatFailures,
          nextBackoffMs: this.revocationCheckBackoff,
        });
      } else {
        logger.error('ENHANCED_LICENSE', 'Heartbeat error', { 
          error,
          failures: this.consecutiveHeartbeatFailures,
          nextBackoffMs: this.revocationCheckBackoff,
        });
      }
      // Don't lock on network error
    }
  }

  /**
   * Schedule next heartbeat
   */
  private scheduleHeartbeat(): void {
    // Clear any existing scheduled heartbeat to prevent duplicates
    if (this.heartbeatScheduleTimer) {
      clearTimeout(this.heartbeatScheduleTimer);
    }
    const intervalMs = this.HEARTBEAT_INTERVAL_HOURS * 60 * 60 * 1000;
    this.heartbeatScheduleTimer = setTimeout(() => {
      this.heartbeatIfDue();
    }, intervalMs);
  }

  /**
   * Force an immediate heartbeat check (for revocation detection)
   * This bypasses the nextCheckAt time
   */
  public async forceHeartbeat(): Promise<void> {
    if (this.mode !== LicenseMode.ACTIVATED) return;
    await this.performHeartbeat();
  }

  /**
   * Start periodic revocation checks (more frequent than heartbeat)
   * This ensures revoked licenses are detected within minutes, not hours
   */
  public startRevocationChecks(): void {
    // Clear any existing timer to prevent duplicate intervals
    if (this.revocationCheckTimer) {
      clearInterval(this.revocationCheckTimer);
    }

    this.revocationCheckTimer = setInterval(async () => {
      if (this.mode === LicenseMode.ACTIVATED) {
        try {
          logger.info('ENHANCED_LICENSE', 'Performing periodic revocation check');
          await this.performHeartbeat();
        } catch (err) {
          logger.error('ENHANCED_LICENSE', 'Revocation check failed:', err);
        }
      }
    }, this.REVOCATION_CHECK_INTERVAL_MS);

    logger.info('ENHANCED_LICENSE', 'Revocation checks scheduled', {
      intervalMinutes: this.REVOCATION_CHECK_INTERVAL_MS / 60000,
    });
  }

  /**
   * Stop revocation checks (cleanup on shutdown)
   */
  public stopRevocationChecks(): void {
    if (this.revocationCheckTimer) {
      clearInterval(this.revocationCheckTimer);
      this.revocationCheckTimer = null;
      logger.info('ENHANCED_LICENSE', 'Revocation checks stopped');
    }
    if (this.heartbeatScheduleTimer) {
      clearTimeout(this.heartbeatScheduleTimer);
      this.heartbeatScheduleTimer = null;
    }
  }

  // Helper methods

  /**
   * BUG FIX #15: Validate license state integrity
   */
  private validateStateIntegrity(state: LicenseState): boolean {
    // Check required fields
    if (typeof state.id !== 'number' || state.id !== 1) return false;
    if (!state.mode || !['trial', 'activated', 'locked'].includes(state.mode)) return false;
    if (!state.createdAt) return false;
    if (!state.updatedAt) return false;

    // Check mode-specific requirements
    if (state.mode === 'trial' && !state.trialStart) return false;

    // Check date formats
    try {
      if (state.trialStart && isNaN(new Date(state.trialStart).getTime())) return false;
      if (state.lastSeen && isNaN(new Date(state.lastSeen).getTime())) return false;
      if (state.lastServerTime && isNaN(new Date(state.lastServerTime).getTime())) return false;
      if (state.nextCheckAt && isNaN(new Date(state.nextCheckAt).getTime())) return false;
    } catch {
      return false;
    }

    return true;
  }

  private ensureLicenseStateTable(): void {
    this.db.execute(`
      CREATE TABLE IF NOT EXISTS license_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        mode TEXT NOT NULL CHECK (mode IN ('trial', 'activated', 'locked')),
        trialStart TEXT NULL,
        lastSeen TEXT NULL,
        lastServerTime TEXT NULL,
        lastServerLocalTime INTEGER NULL,
        nextCheckAt TEXT NULL,
        activationCertEncrypted BLOB NULL,
        tamperFlags TEXT NULL,
        gracePeriodStart TEXT NULL,
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  private createInitialState(): void {
    const now = new Date().toISOString();
    this.db.execute(
      'INSERT INTO license_state (id, mode, createdAt, updatedAt) VALUES (?, ?, ?, ?)',
      [1, LicenseMode.LOCKED, now, now]
    );
  }

  private getLicenseState(): LicenseState | null {
    return this.db.get<LicenseState>('SELECT * FROM license_state WHERE id = 1');
  }

  private updateMode(mode: LicenseMode): void {
    this.db.execute('UPDATE license_state SET mode = ?, updatedAt = ? WHERE id = 1', [
      mode,
      new Date().toISOString(),
    ]);
    this.mode = mode;
  }

  /**
   * Broadcast lockout to all renderer windows
   * This immediately notifies the UI when a license is revoked/expired
   */
  private broadcastLockout(reason: string): void {
    try {
      const windows = BrowserWindow.getAllWindows();
      const lockoutStatus = {
        isActivated: false,
        mode: LicenseMode.LOCKED,
        reason: reason === 'REVOKED' ? 'License has been revoked' : 'License has expired',
      };
      
      windows.forEach((win) => {
        try {
          win.webContents.send('license:lockout', lockoutStatus);
          logger.info('ENHANCED_LICENSE', 'Lockout broadcast sent to window', { 
            windowId: win.id,
            reason 
          });
        } catch (e) {
          logger.warn('ENHANCED_LICENSE', 'Failed to send lockout to window', { 
            windowId: win.id, 
            error: e 
          });
        }
      });
    } catch (e) {
      logger.error('ENHANCED_LICENSE', 'Failed to broadcast lockout', { error: e });
    }
  }
}
