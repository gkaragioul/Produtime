import { DatabaseManager } from '../database';
import { LicenseCryptoService } from './license-crypto-service';
import { DeviceIdService } from './device-id-service';
import { Logger } from '../logger';
import { RegistryService } from './registry-service';
import {
  ActivationResponse,
  ActivationStatus,
  LicensePayload,
} from '../../shared/types';

// Default public License Manager base URL (used when no stored URL or to recover)
// NOTE: Should be configured via environment variable or database settings in production
// Using HTTPS domain for security. Update this URL for your license server.
const DEFAULT_PUBLIC_LM_BASE = process.env.LICENSE_MANAGER_URL || 'https://license.produtime.com';

/**
 * Service for managing license activation and validation
 */
export class LicenseService {
  private static instance: LicenseService;
  private db: DatabaseManager;
  private crypto: LicenseCryptoService;
  private deviceId: DeviceIdService;
  private publicKey: string;
  private logger: Logger;
  private registry: RegistryService;

  // Grace period: 3 days offline before blocking
  private readonly GRACE_PERIOD_DAYS = 3;

  // Validation interval: check every 24 hours
  private readonly VALIDATION_INTERVAL_HOURS = 24;

  // Trial period: 7 days (production)
  private readonly TRIAL_PERIOD_MINUTES = 7 * 24 * 60; // 10080 minutes

  // Server URL getters (support dynamic override via DB settings or env)
  private getActivationServerUrl(): string {
    const fromDb = this.db.getSetting('activation_server_url');
    if (fromDb) return fromDb;
    if (process.env.ACTIVATION_SERVER_URL)
      return process.env.ACTIVATION_SERVER_URL;
    return DEFAULT_PUBLIC_LM_BASE.replace(/\/$/, '') + '/activate';
  }

  private getValidationServerUrl(): string {
    const fromDb = this.db.getSetting('validation_server_url');
    if (fromDb) return fromDb;
    if (process.env.VALIDATION_SERVER_URL)
      return process.env.VALIDATION_SERVER_URL;
    const act = this.getActivationServerUrl();
    return act.replace('/activate', '/validate');
  }

  private constructor(db: DatabaseManager, publicKey: string) {
    this.db = db;
    this.crypto = LicenseCryptoService.getInstance();
    this.deviceId = DeviceIdService.getInstance();
    this.publicKey = publicKey;
    this.logger = Logger.getInstance();
    this.registry = RegistryService.getInstance();
    this.logger.info('LICENSE', 'License service initialized', {
      publicKey: publicKey.substring(0, 10) + '...',
    });
  }

  public static getInstance(
    db: DatabaseManager,
    publicKey: string
  ): LicenseService {
    if (!LicenseService.instance) {
      LicenseService.instance = new LicenseService(db, publicKey);
    }
    return LicenseService.instance;
  }

  /**
   * Get the current device ID
   */
  public getDeviceId(): string {
    return this.deviceId.getDeviceId();
  }

  /**
   * Activate a license key online
   * @param licenseKey License key string
   * @param deviceId Device identifier
   * @returns Activation response
   */
  public async activateLicense(
    licenseKey: string,
    deviceId: string
  ): Promise<ActivationResponse> {
    try {
      this.logger.info('LICENSE', 'Starting online license activation', {
        licenseKeyPreview: licenseKey.substring(0, 20) + '...',
        deviceId,
        serverUrl: this.getActivationServerUrl(),
      });

      // Parse and verify license key
      const signedLicense = this.crypto.parseLicenseKey(licenseKey);

      // Verify signature
      if (!this.crypto.verifyLicense(signedLicense, this.publicKey)) {
        return {
          success: false,
          error:
            'Invalid license signature. This license key is not authentic.',
        };
      }

      // Parse payload
      const payload: LicensePayload =
        this.crypto.parseLicensePayload(signedLicense);

      // Determine expiry (support both ISO 'expiryDate' and unix seconds 'exp')
      let expiryIso: string | null = null;
      if (payload.expiryDate) {
        expiryIso = payload.expiryDate;
      } else if ((payload as any).exp != null) {
        const expSec = Number((payload as any).exp);
        if (!Number.isNaN(expSec)) {
          expiryIso = new Date(expSec * 1000).toISOString();
        }
      }
      if (expiryIso) {
        const expiryDate = new Date(expiryIso);
        if (expiryDate < new Date()) {
          return {
            success: false,
            error: `License expired on ${expiryDate.toLocaleDateString()}`,
          };
        }
      }

      // If license payload embeds activation URL, persist it for future use
      const raw: any = payload as any;
      const embeddedUrl =
        raw.activationUrl ||
        raw.act ||
        raw.serverUrl ||
        raw.srv ||
        (typeof raw.server === 'string' ? raw.server : null);
      if (embeddedUrl && typeof embeddedUrl === 'string') {
        const actUrl = embeddedUrl.trim();
        this.db.setSetting('activation_server_url', actUrl);
        const valUrl = actUrl.includes('/activate')
          ? actUrl.replace('/activate', '/validate')
          : actUrl.replace(/\/$/, '') + '/validate';
        this.db.setSetting('validation_server_url', valUrl);
        this.logger.info(
          'LICENSE',
          'Using activation/validation URLs from license payload',
          {
            activationUrl: actUrl,
            validationUrl: valUrl,
          }
        );
      }

      const activationUrl = this.getActivationServerUrl();

      // Contact activation server
      try {
        const response = await fetch(activationUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            licenseKey,
            deviceId,
            deviceName: require('os').hostname(),
          }),
          signal: AbortSignal.timeout(10000), // 10 second timeout
        });

        if (!response.ok) {
          const errorData = await response.json();
          return {
            success: false,
            error:
              errorData.error ||
              `Server error: ${response.status} ${response.statusText}`,
          };
        }

        const data = await response.json();

        if (!data.success) {
          return {
            success: false,
            error: data.error || 'Activation failed',
          };
        }

        // Save activation to database
        const now = new Date().toISOString();
        this.db.saveLicenseActivation({
          license_key: licenseKey,
          device_id: deviceId,
          activation_code: data.activationCode || '',
          plan: payload.plan,
          expiry_date: expiryIso || null,
          activated_at: now,
          last_validated_at: now,
        });

        return {
          success: true,
          activationCode: data.activationCode || '',
          message: 'License activated successfully',
        };
      } catch (error) {
        // Network error - allow offline activation with valid license
        this.logger.warn(
          'LICENSE',
          'Server activation failed, allowing offline activation',
          {
            error: error instanceof Error ? error.message : 'Unknown error',
          }
        );

        // Save activation to database anyway (offline activation)
        const now = new Date().toISOString();
        this.db.saveLicenseActivation({
          license_key: licenseKey,
          device_id: deviceId,
          activation_code: 'OFFLINE_' + Date.now(),
          plan: payload.plan,
          expiry_date: expiryIso || null,
          activated_at: now,
          last_validated_at: now,
        });

        return {
          success: true,
          activationCode: 'OFFLINE_' + Date.now(),
          message:
            'License activated in offline mode. Your license will be validated when internet connection is restored.',
          offline: true,
        };
      }
    } catch (error) {
      return {
        success: false,
        error: `Activation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Manually activate with an activation code (offline activation)
   * @param licenseKey License key string
   * @param deviceId Device identifier
   * @param activationCode Activation code from vendor
   * @returns Activation response
   */
  public manualActivate(
    licenseKey: string,
    deviceId: string,
    activationCode: string
  ): ActivationResponse {
    try {
      // Parse and verify license key
      const signedLicense = this.crypto.parseLicenseKey(licenseKey);

      // Verify signature
      if (!this.crypto.verifyLicense(signedLicense, this.publicKey)) {
        return {
          success: false,
          error: 'Invalid license signature',
        };
      }

      // Parse payload
      const payload: LicensePayload =
        this.crypto.parseLicensePayload(signedLicense);

      // Determine expiry (support both ISO 'expiryDate' and unix seconds 'exp')
      let expiryIso: string | null = null;
      if (payload.expiryDate) {
        expiryIso = payload.expiryDate;
      } else if ((payload as any).exp != null) {
        const expSec = Number((payload as any).exp);
        if (!Number.isNaN(expSec)) {
          expiryIso = new Date(expSec * 1000).toISOString();
        }
      }
      if (expiryIso) {
        const expiryDate = new Date(expiryIso);
        if (expiryDate < new Date()) {
          return {
            success: false,
            error: `License expired on ${expiryDate.toLocaleDateString()}`,
          };
        }
      }

      // Verify activation code
      const licenseId = (payload as any).licenseId || (payload as any).lic;

      const isValidActivation = this.crypto.verifyActivationCode(
        activationCode,
        licenseId,
        deviceId,
        this.publicKey
      );

      if (!isValidActivation) {
        return {
          success: false,
          error: 'Invalid activation code',
        };
      }

      // Save activation to database
      const now = new Date().toISOString();
      this.db.saveLicenseActivation({
        license_key: licenseKey,
        device_id: deviceId,
        activation_code: activationCode,
        plan: payload.plan,

        expiry_date: expiryIso || null,
        activated_at: now,
        last_validated_at: now,
      });

      return {
        success: true,
        activationCode,
        message: 'License activated successfully (offline)',
      };
    } catch (error) {
      return {
        success: false,
        error: `Manual activation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Validate current activation status with server
   * Checks if activation is still valid on the server
   * Uses configurable server URL and includes detailed logging
   */
  public async validateActivationWithServer(): Promise<ActivationStatus> {
    const currentDeviceId = this.deviceId.getDeviceId();
    const activation = this.db.getLicenseActivation(currentDeviceId);

    if (!activation) {
      this.logger.info('LICENSE', 'No activation found for server validation', {
        deviceId: currentDeviceId,
      });
      return {
        isActivated: false,
        message: 'No license activation found. Please activate your license.',
      };
    }

    try {
      this.logger.info('LICENSE', 'Starting server validation', {
        licenseKeyPreview: activation.license_key.substring(0, 20) + '...',
        deviceId: currentDeviceId,
        serverUrl: this.getValidationServerUrl(),
      });

      // Contact server to validate
      const response = await fetch(this.getValidationServerUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          licenseKey: activation.license_key,
          deviceId: currentDeviceId,
        }),
        signal: AbortSignal.timeout(5000), // 5 second timeout
      });

      if (!response.ok) {
        // Treat 410 (revoked) and 404 (license or activation missing) as lock conditions
        if (response.status === 410 || response.status === 404) {
          const reason =
            response.status === 410
              ? 'License has been revoked on server'
              : 'License not found on server (deleted or no active activation)';
          this.logger.warn('LICENSE', reason, {
            status: response.status,
            deviceId: currentDeviceId,
            serverUrl: this.getValidationServerUrl(),
          });
          // Delete local activation
          this.db.deleteLicenseActivation(currentDeviceId);
          return {
            isActivated: false,
            message: 'Your license has been revoked. Please contact support.',
          };
        }

        this.logger.warn('LICENSE', 'Server validation failed', {
          status: response.status,
          statusText: response.statusText,
          deviceId: currentDeviceId,
          serverUrl: this.getValidationServerUrl(),
        });
        // If server is unreachable or returned another error, use local validation
        return this.validateActivation();
      }

      const data = await response.json();

      if (!data.success) {
        // Activation was revoked on server
        this.logger.warn('LICENSE', 'Activation revoked on server', {
          error: data.error,
          deviceId: currentDeviceId,
          serverUrl: this.getValidationServerUrl(),
        });
        // Delete local activation
        this.db.deleteLicenseActivation(currentDeviceId);
        return {
          isActivated: false,
          message:
            'Your license activation has been revoked. Please contact support.',
        };
      }

      // Update last validated time
      this.db.updateLicenseValidation(currentDeviceId);
      this.logger.info('LICENSE', 'Server validation successful', {
        deviceId: currentDeviceId,
        licenseKeyPreview: activation.license_key.substring(0, 20) + '...',
      });
      return this.validateActivation();
    } catch (error) {
      this.logger.warn('LICENSE', 'Server validation error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        deviceId: currentDeviceId,
        serverUrl: this.getValidationServerUrl(),
      });

      // Fallback: switch to default public License Manager and retry once
      try {
        const defaultBase = DEFAULT_PUBLIC_LM_BASE.replace(/\/$/, '');
        const defaultVal = defaultBase + '/validate';
        const defaultAct = defaultBase + '/activate';
        const currentUrl = this.getValidationServerUrl();
        const isStale = /trycloudflare\.com|localhost|127\.0\.0\.1/i.test(
          currentUrl
        );
        if (isStale || !currentUrl.startsWith(defaultBase)) {
          this.db.bulkUpdateSettings({
            activation_server_url: defaultAct,
            validation_server_url: defaultVal,
          });
          this.logger.info(
            'LICENSE',
            'Retrying server validation with default public URL',
            { defaultBase }
          );
          const resp2 = await fetch(defaultVal, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              licenseKey: activation.license_key,
              deviceId: currentDeviceId,
            }),
            signal: AbortSignal.timeout(4000),
          });
          if (resp2.ok) {
            const data2 = await resp2.json();
            if (data2 && data2.success) {
              this.db.updateLicenseValidation(currentDeviceId);
              this.logger.info(
                'LICENSE',
                'Server validation successful (after fallback)'
              );
              return this.validateActivation();
            }
          }
        }
      } catch (e2) {
        this.logger.warn(
          'LICENSE',
          'Default public URL validation retry failed',
          {
            error: e2 instanceof Error ? e2.message : String(e2),
          }
        );
      }

      // If server is unreachable, use local validation (gracefully continue)
      return this.validateActivation();
    }
  }

  /**
   * Validate current activation status
   * Checks for hardware changes, expiry, and grace period
   */
  public validateActivation(): ActivationStatus {
    const currentDeviceId = this.deviceId.getDeviceId();
    this.logger.info('LICENSE', 'Validating activation', {
      deviceId: currentDeviceId,
    });

    const activation = this.db.getLicenseActivation(currentDeviceId);

    if (!activation) {
      this.logger.warn('LICENSE', 'No activation found for device', {
        deviceId: currentDeviceId,
      });
      return {
        isActivated: false,
        message: 'No license activation found. Please activate your license.',
      };
    }

    this.logger.info('LICENSE', 'Activation found', {
      licenseKey: activation.license_key.substring(0, 20) + '...',
      plan: activation.plan,
      expiryDate: activation.expiry_date,
      activatedAt: activation.activated_at,
    });

    // Check if this is a trial activation
    const isTrialMode = activation.plan === 'trial';

    // Check for hardware change
    const hasHardwareChanged = this.deviceId.hasDeviceChanged(
      activation.device_id
    );

    if (hasHardwareChanged) {
      // Calculate grace period
      const lastValidated = new Date(activation.last_validated_at);
      const gracePeriodEnd = new Date(lastValidated);
      gracePeriodEnd.setDate(gracePeriodEnd.getDate() + this.GRACE_PERIOD_DAYS);

      return {
        isActivated: true,
        licenseKey: activation.license_key,
        deviceId: activation.device_id,
        plan: activation.plan as 'basic' | 'pro' | 'enterprise',
        expiryDate: activation.expiry_date,
        activatedAt: activation.activated_at,
        requiresReactivation: true,
        gracePeriodEndsAt: gracePeriodEnd.toISOString(),
        message:
          'Hardware change detected. Please reactivate your license within the grace period.',
      };
    }

    // Check expiry
    if (activation.expiry_date) {
      const expiryDate = new Date(activation.expiry_date);
      const now = new Date();

      if (expiryDate < now) {
        if (isTrialMode) {
          return {
            isActivated: false,
            isTrialMode: false,
            message: `Trial period expired on ${expiryDate.toLocaleDateString()}. Please activate with a license key.`,
          };
        }
        return {
          isActivated: false,
          message: `License expired on ${expiryDate.toLocaleDateString()}`,
        };
      }

      // Calculate days remaining for trial
      if (isTrialMode) {
        const daysRemaining = Math.ceil(
          (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        );
        this.logger.info('LICENSE', 'Trial mode active', {
          daysRemaining,
          expiresAt: expiryDate.toISOString(),
        });
      }
    }

    // Update last validated timestamp
    this.db.updateLicenseValidation(currentDeviceId);

    // Calculate trial days remaining if in trial mode
    let trialDaysRemaining: number | undefined;
    if (isTrialMode && activation.expiry_date) {
      const expiryDate = new Date(activation.expiry_date);
      const now = new Date();
      trialDaysRemaining = Math.ceil(
        (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );
    }

    return {
      isActivated: true,
      licenseKey: activation.license_key,
      deviceId: activation.device_id,
      plan: activation.plan as 'basic' | 'pro' | 'enterprise',
      expiryDate: activation.expiry_date,
      activatedAt: activation.activated_at,
      requiresReactivation: false,
      isTrialMode,
      trialEndsAt: isTrialMode ? activation.expiry_date : undefined,
      trialDaysRemaining,
      message: isTrialMode
        ? `Trial mode active - ${trialDaysRemaining} days remaining`
        : 'License is active',
    };
  }

  /**
   * Validate activation with the server (online check)
   * Checks if the license has been revoked
   */
  public async validateActivationOnline(): Promise<ActivationStatus> {
    const currentDeviceId = this.deviceId.getDeviceId();
    const activation = this.db.getLicenseActivation(currentDeviceId);

    if (!activation) {
      return this.validateActivation();
    }

    try {
      this.logger.info('LICENSE', 'Validating activation with server', {
        licenseKey: activation.license_key.substring(0, 20) + '...',
        deviceId: currentDeviceId,
      });

      const response = await fetch(this.getValidationServerUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          licenseKey: activation.license_key,
          deviceId: currentDeviceId,
        }),
      });

      if (!response.ok) {
        // If server returns error, it means license is revoked or invalid
        if (response.status === 404) {
          this.logger.warn('LICENSE', 'License revoked on server');
          // Delete local activation
          this.db.deleteLicenseActivation(currentDeviceId);
          return {
            isActivated: false,
            message: 'Your license has been revoked. Please contact support.',
          };
        }
        // For other errors, fall back to local validation
        return this.validateActivation();
      }

      // License is still valid on server
      return this.validateActivation();
    } catch (error) {
      this.logger.warn(
        'LICENSE',
        'Server validation failed, using local validation',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
      // Fall back to local validation if server is unreachable
      return this.validateActivation();
    }
  }

  /**
   * Deactivate the current license
   */
  public deactivateLicense(): void {
    const currentDeviceId = this.deviceId.getDeviceId();
    this.db.deleteLicenseActivation(currentDeviceId);
  }

  /**
   * Get activation status (alias for validateActivation)
   */
  public getActivationStatus(): ActivationStatus {
    return this.validateActivation();
  }

  /**
   * Start a 7-day trial period
   * Uses Windows Registry to prevent trial reset by deleting database
   */
  public async startTrial(): Promise<ActivationResponse> {
    const currentDeviceId = this.deviceId.getDeviceId();

    this.logger.info('LICENSE', 'Starting 7-day trial', {
      deviceId: currentDeviceId,
    });

    // Check if trial has been used before (in registry - cannot be deleted)
    const hasUsedTrial = await this.registry.hasTrialBeenUsed();
    if (hasUsedTrial) {
      this.logger.warn(
        'LICENSE',
        'Trial already used on this device (registry check)'
      );
      return {
        success: false,
        error: 'Trial has already been used on this device',
      };
    }

    // Check if trial already exists in database
    const existing = this.db.getLicenseActivation(currentDeviceId);
    if (existing) {
      this.logger.warn('LICENSE', 'Trial already exists or license activated');
      return {
        success: false,
        error: 'A license or trial is already active on this device',
      };
    }

    // Calculate trial expiry based on a 7-day period from the current system time
    const now = new Date();
    const expiryDate = new Date(
      now.getTime() + this.TRIAL_PERIOD_MINUTES * 60 * 1000
    );

    // Store trial data in Windows Registry (cannot be deleted easily)
    await this.registry.setTrialData({
      deviceId: currentDeviceId,
      startedAt: now.toISOString(),
      expiresAt: expiryDate.toISOString(),
    });

    // Create trial activation in database
    const trialActivation = {
      license_key: 'TRIAL-LICENSE',
      device_id: currentDeviceId,
      activation_code: 'TRIAL-ACTIVATION',
      plan: 'trial',
      expiry_date: expiryDate.toISOString(),
      activated_at: now.toISOString(),
      last_validated_at: now.toISOString(),
    };

    this.db.saveLicenseActivation(trialActivation);

    this.logger.info(
      'LICENSE',
      'Trial started successfully (stored in registry)',
      {
        expiresAt: expiryDate.toISOString(),
        minutesRemaining: this.TRIAL_PERIOD_MINUTES,
      }
    );

    return {
      success: true,
      message: `7-day trial activated! Trial expires at ${expiryDate.toLocaleString()}`,
      expiryDate: expiryDate.toISOString(),
    };
  }
}
