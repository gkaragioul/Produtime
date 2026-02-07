/**
 * Privacy Service Tests
 * Property-based tests for privacy controls and title sharing policies.
 * 
 * Feature: cloud-admin-console
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  PrivacyService,
  DEFAULT_PRIVACY_SETTINGS,
  TenantPrivacySettings,
} from './privacy-service';
import { EnhancedHeartbeatPayload, TopAppEntry } from './dashboard-types';

// ============================================================================
// Arbitrary Generators
// ============================================================================

/**
 * Generate a random TopAppEntry
 */
const topAppEntryArb = fc.record({
  app: fc.string({ minLength: 1, maxLength: 100 }),
  seconds: fc.integer({ min: 0, max: 86400 }),
  category: fc.constantFrom('productive', 'unproductive', 'neutral', undefined),
});

/**
 * Generate a random DailyMetricsSummary
 */
const dailyMetricsSummaryArb = fc.record({
  productiveSeconds: fc.integer({ min: 0, max: 86400 }),
  unproductiveSeconds: fc.integer({ min: 0, max: 86400 }),
  idleSeconds: fc.integer({ min: 0, max: 86400 }),
  untrackedSeconds: fc.integer({ min: 0, max: 86400 }),
  activeSeconds: fc.integer({ min: 0, max: 86400 }),
  firstActivityTs: fc.oneof(fc.constant(null), fc.integer({ min: 1700000000000, max: 1800000000000 })),
  lastActivityTs: fc.oneof(fc.constant(null), fc.integer({ min: 1700000000000, max: 1800000000000 })),
});

/**
 * Generate a random PeriodMetricsSummary
 */
const periodMetricsSummaryArb = fc.record({
  productiveSeconds: fc.integer({ min: 0, max: 900 }),
  unproductiveSeconds: fc.integer({ min: 0, max: 900 }),
  idleSeconds: fc.integer({ min: 0, max: 900 }),
  untrackedSeconds: fc.integer({ min: 0, max: 900 }),
  activeSeconds: fc.integer({ min: 0, max: 900 }),
});

/**
 * Generate a random EnhancedHeartbeatPayload
 */
const heartbeatPayloadArb = fc.record({
  deviceId: fc.string({ minLength: 1, maxLength: 50 }),
  deviceName: fc.string({ minLength: 1, maxLength: 100 }),
  ip: fc.ipV4(),
  appVersion: fc.string({ minLength: 1, maxLength: 20 }),
  trackingRunning: fc.boolean(),
  effectivePolicyHash: fc.hexaString({ minLength: 32, maxLength: 64 }),
  privacyModeEffective: fc.boolean(),
  titleSharingEffective: fc.boolean(),
  today: dailyMetricsSummaryArb,
  last15m: periodMetricsSummaryArb,
  topAppsToday: fc.array(topAppEntryArb, { minLength: 0, maxLength: 10 }),
});

// ============================================================================
// Property 23: Privacy - No Titles by Default
// *For any* heartbeat payload when title sharing is disabled, the payload
// SHALL not contain window title data.
// **Validates: Requirements 9.1, 9.2, 9.4**
// ============================================================================

describe('Property 23: Privacy - No Titles by Default', () => {
  /**
   * Feature: cloud-admin-console, Property 23: Privacy - No Titles by Default
   * For any heartbeat payload, when title sharing is disabled (default),
   * the sanitized payload must have titleSharingEffective set to false.
   */
  it('should set titleSharingEffective to false when title sharing is disabled', () => {
    fc.assert(
      fc.property(
        heartbeatPayloadArb,
        (heartbeat) => {
          // Title sharing disabled (default)
          const titleSharingEnabled = false;
          
          const sanitized = PrivacyService.stripTitlesIfDisabled(
            heartbeat as EnhancedHeartbeatPayload,
            titleSharingEnabled
          );

          // Requirement 9.1, 9.2: titleSharingEffective must be false
          expect(sanitized.titleSharingEffective).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: cloud-admin-console, Property 23: Privacy - No Titles by Default
   * For any heartbeat payload, when title sharing is disabled,
   * the topAppsToday array must only contain app, seconds, and category fields.
   */
  it('should sanitize topAppsToday to only contain allowed fields when title sharing is disabled', () => {
    fc.assert(
      fc.property(
        heartbeatPayloadArb,
        (heartbeat) => {
          const titleSharingEnabled = false;
          
          const sanitized = PrivacyService.stripTitlesIfDisabled(
            heartbeat as EnhancedHeartbeatPayload,
            titleSharingEnabled
          );

          // Verify each top app entry only has allowed fields
          for (const app of sanitized.topAppsToday) {
            const keys = Object.keys(app);
            const allowedKeys = ['app', 'seconds', 'category'];
            
            for (const key of keys) {
              expect(allowedKeys).toContain(key);
            }
            
            // Verify required fields are present
            expect(app).toHaveProperty('app');
            expect(app).toHaveProperty('seconds');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: cloud-admin-console, Property 23: Privacy - No Titles by Default
   * For any heartbeat payload, when title sharing is enabled,
   * the payload should be returned unchanged.
   */
  it('should preserve heartbeat data when title sharing is enabled', () => {
    fc.assert(
      fc.property(
        heartbeatPayloadArb,
        (heartbeat) => {
          const titleSharingEnabled = true;
          
          const sanitized = PrivacyService.stripTitlesIfDisabled(
            heartbeat as EnhancedHeartbeatPayload,
            titleSharingEnabled
          );

          // When title sharing is enabled, data should be preserved
          expect(sanitized.deviceId).toBe(heartbeat.deviceId);
          expect(sanitized.deviceName).toBe(heartbeat.deviceName);
          expect(sanitized.titleSharingEffective).toBe(heartbeat.titleSharingEffective);
          expect(sanitized.topAppsToday).toEqual(heartbeat.topAppsToday);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: cloud-admin-console, Property 23: Privacy - No Titles by Default
   * For any heartbeat payload, core metrics must be preserved regardless of title sharing setting.
   */
  it('should preserve core metrics regardless of title sharing setting', () => {
    fc.assert(
      fc.property(
        heartbeatPayloadArb,
        fc.boolean(),
        (heartbeat, titleSharingEnabled) => {
          const sanitized = PrivacyService.stripTitlesIfDisabled(
            heartbeat as EnhancedHeartbeatPayload,
            titleSharingEnabled
          );

          // Core metrics must always be preserved
          expect(sanitized.deviceId).toBe(heartbeat.deviceId);
          expect(sanitized.deviceName).toBe(heartbeat.deviceName);
          expect(sanitized.ip).toBe(heartbeat.ip);
          expect(sanitized.appVersion).toBe(heartbeat.appVersion);
          expect(sanitized.trackingRunning).toBe(heartbeat.trackingRunning);
          expect(sanitized.today).toEqual(heartbeat.today);
          expect(sanitized.last15m).toEqual(heartbeat.last15m);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: cloud-admin-console, Property 23: Privacy - No Titles by Default
   * Default privacy settings must have title sharing disabled.
   */
  it('should have title sharing disabled by default', () => {
    expect(DEFAULT_PRIVACY_SETTINGS.titleSharingEnabled).toBe(false);
  });

  /**
   * Feature: cloud-admin-console, Property 23: Privacy - No Titles by Default
   * For any settings JSON, parsing must default to title sharing disabled if not explicitly enabled.
   */
  it('should default to title sharing disabled when parsing settings', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(null),
          fc.constant(''),
          fc.constant('{}'),
          fc.constant('{"titleSharingEnabled": false}'),
          fc.constant('{"otherSetting": true}'),
          fc.constant('invalid json'),
        ),
        (settingsJson) => {
          const result = PrivacyService.isTitleSharingEnabled(settingsJson);
          
          // All these cases should result in title sharing being disabled
          expect(result).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: cloud-admin-console, Property 23: Privacy - No Titles by Default
   * Title sharing should only be enabled when explicitly set to true.
   */
  it('should only enable title sharing when explicitly set to true', () => {
    // Only this specific case should enable title sharing
    const enabledSettings = '{"titleSharingEnabled": true}';
    expect(PrivacyService.isTitleSharingEnabled(enabledSettings)).toBe(true);

    // All other cases should be disabled
    expect(PrivacyService.isTitleSharingEnabled(null)).toBe(false);
    expect(PrivacyService.isTitleSharingEnabled('')).toBe(false);
    expect(PrivacyService.isTitleSharingEnabled('{}')).toBe(false);
    expect(PrivacyService.isTitleSharingEnabled('{"titleSharingEnabled": false}')).toBe(false);
    expect(PrivacyService.isTitleSharingEnabled('{"titleSharingEnabled": "true"}')).toBe(false); // String, not boolean
    expect(PrivacyService.isTitleSharingEnabled('{"titleSharingEnabled": 1}')).toBe(false); // Number, not boolean
  });

  /**
   * Feature: cloud-admin-console, Property 23: Privacy - No Titles by Default
   * For any array of top apps, sanitization must preserve app count and seconds.
   */
  it('should preserve app count and seconds during sanitization', () => {
    fc.assert(
      fc.property(
        fc.array(topAppEntryArb, { minLength: 0, maxLength: 20 }),
        (topApps) => {
          const sanitized = PrivacyService.sanitizeTopApps(topApps as TopAppEntry[]);

          // Count must be preserved
          expect(sanitized.length).toBe(topApps.length);

          // Each app's name and seconds must be preserved
          for (let i = 0; i < topApps.length; i++) {
            expect(sanitized[i].app).toBe(topApps[i].app);
            expect(sanitized[i].seconds).toBe(topApps[i].seconds);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: cloud-admin-console, Property 23: Privacy - No Titles by Default
   * Sanitization must handle edge cases gracefully.
   */
  it('should handle edge cases in sanitization', () => {
    // Empty array
    expect(PrivacyService.sanitizeTopApps([])).toEqual([]);

    // Null/undefined (should return empty array)
    expect(PrivacyService.sanitizeTopApps(null as any)).toEqual([]);
    expect(PrivacyService.sanitizeTopApps(undefined as any)).toEqual([]);
  });
});

// ============================================================================
// Unit Tests for Privacy Service
// ============================================================================

describe('PrivacyService Unit Tests', () => {
  describe('parseTenantPrivacySettings', () => {
    it('should return default settings for null input', () => {
      const result = PrivacyService.parseTenantPrivacySettings(null);
      expect(result).toEqual(DEFAULT_PRIVACY_SETTINGS);
    });

    it('should return default settings for invalid JSON', () => {
      const result = PrivacyService.parseTenantPrivacySettings('not valid json');
      expect(result).toEqual(DEFAULT_PRIVACY_SETTINGS);
    });

    it('should parse valid settings JSON', () => {
      const result = PrivacyService.parseTenantPrivacySettings('{"titleSharingEnabled": true}');
      expect(result.titleSharingEnabled).toBe(true);
    });

    it('should default titleSharingEnabled to false if not present', () => {
      const result = PrivacyService.parseTenantPrivacySettings('{"otherSetting": "value"}');
      expect(result.titleSharingEnabled).toBe(false);
    });
  });

  describe('validateHeartbeatPrivacy', () => {
    it('should return valid for compliant heartbeat when title sharing disabled', () => {
      const heartbeat: EnhancedHeartbeatPayload = {
        deviceId: 'test-device',
        deviceName: 'Test Device',
        ip: '192.168.1.1',
        appVersion: '1.0.0',
        trackingRunning: true,
        effectivePolicyHash: 'abc123',
        privacyModeEffective: false,
        titleSharingEffective: false, // Compliant
        today: {
          productiveSeconds: 0,
          unproductiveSeconds: 0,
          idleSeconds: 0,
          untrackedSeconds: 0,
          activeSeconds: 0,
          firstActivityTs: null,
          lastActivityTs: null,
        },
        last15m: {
          productiveSeconds: 0,
          unproductiveSeconds: 0,
          idleSeconds: 0,
          untrackedSeconds: 0,
          activeSeconds: 0,
        },
        topAppsToday: [],
      };

      const result = PrivacyService.validateHeartbeatPrivacy(heartbeat, false);
      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('should return violation when titleSharingEffective is true but disabled', () => {
      const heartbeat: EnhancedHeartbeatPayload = {
        deviceId: 'test-device',
        deviceName: 'Test Device',
        ip: '192.168.1.1',
        appVersion: '1.0.0',
        trackingRunning: true,
        effectivePolicyHash: 'abc123',
        privacyModeEffective: false,
        titleSharingEffective: true, // Violation!
        today: {
          productiveSeconds: 0,
          unproductiveSeconds: 0,
          idleSeconds: 0,
          untrackedSeconds: 0,
          activeSeconds: 0,
          firstActivityTs: null,
          lastActivityTs: null,
        },
        last15m: {
          productiveSeconds: 0,
          unproductiveSeconds: 0,
          idleSeconds: 0,
          untrackedSeconds: 0,
          activeSeconds: 0,
        },
        topAppsToday: [],
      };

      const result = PrivacyService.validateHeartbeatPrivacy(heartbeat, false);
      expect(result.valid).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    });
  });
});
