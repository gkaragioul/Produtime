/**
 * Privacy Service
 * Handles privacy controls for heartbeat data and title sharing policies.
 * 
 * Requirements:
 * - 9.1: Only transmit aggregated metrics by default (no raw window titles)
 * - 9.2: When title sharing is disabled, never transmit or store window titles
 * - 9.4: Require explicit policy configuration to enable title sharing
 * 
 * COMPLIANCE: This is NOT spyware.
 * - Title sharing is disabled by default
 * - Explicit opt-in required for title sharing
 * - All data is privacy-respecting
 */

import { EnhancedHeartbeatPayload, TopAppEntry } from './dashboard-types';

// ============================================================================
// Types
// ============================================================================

export interface TenantPrivacySettings {
  titleSharingEnabled: boolean;
}

export const DEFAULT_PRIVACY_SETTINGS: TenantPrivacySettings = {
  titleSharingEnabled: false, // Requirement 9.1, 9.4: Disabled by default
};

// ============================================================================
// Privacy Service Class
// ============================================================================

export class PrivacyService {
  /**
   * Strip titles from heartbeat payload if title sharing is disabled
   * Requirements: 9.1, 9.2, 9.4
   * 
   * @param heartbeat - The incoming heartbeat payload
   * @param titleSharingEnabled - Whether title sharing is enabled for the tenant
   * @returns A sanitized heartbeat payload with titles stripped if necessary
   */
  static stripTitlesIfDisabled(
    heartbeat: EnhancedHeartbeatPayload,
    titleSharingEnabled: boolean
  ): EnhancedHeartbeatPayload {
    // Requirement 9.4: If title sharing is explicitly enabled, return as-is
    if (titleSharingEnabled) {
      return heartbeat;
    }

    // Requirement 9.1, 9.2: Strip all title-related data when disabled
    return {
      ...heartbeat,
      // Override titleSharingEffective to false regardless of what client sent
      titleSharingEffective: false,
      // Strip any title data from top apps (keep app names, remove any title fields)
      topAppsToday: PrivacyService.sanitizeTopApps(heartbeat.topAppsToday),
    };
  }

  /**
   * Sanitize top apps list to remove any title-related data
   * Keeps only: app name, seconds, and category
   */
  static sanitizeTopApps(topApps: TopAppEntry[]): TopAppEntry[] {
    if (!topApps || !Array.isArray(topApps)) {
      return [];
    }

    return topApps.map(app => ({
      app: app.app,
      seconds: app.seconds,
      category: app.category,
      // Explicitly exclude any other fields that might contain titles
    }));
  }

  /**
   * Parse tenant settings JSON to extract privacy settings
   * Returns default settings if parsing fails or settings are missing
   */
  static parseTenantPrivacySettings(settingsJson: string | null): TenantPrivacySettings {
    if (!settingsJson) {
      return DEFAULT_PRIVACY_SETTINGS;
    }

    try {
      const settings = JSON.parse(settingsJson);
      return {
        // Requirement 9.4: Default to false if not explicitly set to true
        titleSharingEnabled: settings.titleSharingEnabled === true,
      };
    } catch {
      return DEFAULT_PRIVACY_SETTINGS;
    }
  }

  /**
   * Check if title sharing is enabled for a tenant
   * Requirement 9.4: Requires explicit policy configuration
   */
  static isTitleSharingEnabled(settingsJson: string | null): boolean {
    const settings = PrivacyService.parseTenantPrivacySettings(settingsJson);
    return settings.titleSharingEnabled;
  }

  /**
   * Validate that a heartbeat respects privacy settings
   * Returns true if the heartbeat is compliant with the privacy policy
   */
  static validateHeartbeatPrivacy(
    heartbeat: EnhancedHeartbeatPayload,
    titleSharingEnabled: boolean
  ): { valid: boolean; violations: string[] } {
    const violations: string[] = [];

    // If title sharing is disabled, check for violations
    if (!titleSharingEnabled) {
      // Check if heartbeat claims title sharing is effective when it shouldn't be
      if (heartbeat.titleSharingEffective) {
        violations.push('titleSharingEffective should be false when title sharing is disabled');
      }
    }

    return {
      valid: violations.length === 0,
      violations,
    };
  }
}

// ============================================================================
// Exports
// ============================================================================

export const PRIVACY_CONSTANTS = {
  DEFAULT_TITLE_SHARING_ENABLED: false,
};
