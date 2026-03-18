/**
 * EnhancedLicenseService - Freeware Edition
 *
 * All features permanently unlocked. No server calls, no trials, no heartbeats.
 * This replaces the commercial licensing system for the free local-only build.
 */

import { DatabaseManager } from '../../database';
import { Logger } from '../../logger';
import {
  LicenseFeatures,
} from '../../../shared/licensing/entitlements';

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

/**
 * Freeware license service — always activated, all features enabled.
 */
export class EnhancedLicenseService {
  private static instance: EnhancedLicenseService;

  private readonly ALL_FEATURES: LicenseFeatures = {
    adminPanel: true,
    managedMode: true,
    exports: true,
    advancedReports: true,
    customBranding: true,
    apiAccess: true,
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private constructor(_db: DatabaseManager, _publicKey: string, _serverUrl: string) {
    logger.info('ENHANCED_LICENSE', 'Freeware edition — all features unlocked');
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

  /** No-op — nothing to initialize in freeware mode */
  public async init(): Promise<void> {
    logger.info('ENHANCED_LICENSE', 'Freeware mode — skipping license initialization');
  }

  /** Always returns activated with all features */
  public getStatus(): LicenseStatus {
    return {
      mode: LicenseMode.ACTIVATED,
      isEntitled: true,
      licenseId: 'FREEWARE',
      features: { ...this.ALL_FEATURES },
    };
  }

  /** Always returns true — all features available */
  public hasFeature(_featureName: string): boolean {
    return true;
  }

  /** Never throws — all features available */
  public requireFeature(_featureName: string): void {
    // No-op: freeware has all features
  }

  /** No warnings in freeware mode */
  public getWarnings(): string[] {
    return [];
  }

  /** Never throws — always entitled */
  public assertEntitledOrThrow(_context: string): void {
    // No-op: always entitled
  }

  /** No-op — trials not needed in freeware */
  public async startTrial(): Promise<{ success: boolean; error?: string }> {
    return { success: true };
  }

  /** No-op — activation not needed in freeware */
  public async activateWithKey(
    _licenseKey: string
  ): Promise<{ success: boolean; error?: string }> {
    return { success: true };
  }

  /** No-op — no heartbeats in freeware */
  public async heartbeatIfDue(): Promise<void> {}

  /** No-op */
  public async forceHeartbeat(): Promise<void> {}

  /** No-op */
  public startRevocationChecks(): void {}

  /** No-op */
  public stopRevocationChecks(): void {}
}
