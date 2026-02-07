/**
 * Property-Based Tests for Privacy Mode Sanitization
 * 
 * **Feature: privacy-mode, Property 2: Window Title Sanitization Logic**
 * **Validates: Requirements 3.1, 3.2, 3.3**
 */

import fc from 'fast-check';
import { ActivityTracker } from '../activity-tracker';
import { DEFAULT_PRIVACY_APPS } from '../privacy-constants';

// Mock electron modules
jest.mock('electron', () => ({
  BrowserWindow: jest.fn(),
  powerMonitor: {
    getSystemIdleTime: jest.fn().mockReturnValue(0),
  },
}));

// Mock active-win
jest.mock('active-win', () => jest.fn().mockResolvedValue(null));

// Helper to create mock database
function createMockDb(
  privacyEnabled: boolean,
  privacyApps: string[] | null = null,
  invalidJson = false
): any {
  return {
    getSetting: jest.fn().mockImplementation((key: string) => {
      if (key === 'privacy_mode_enabled') return privacyEnabled ? 'true' : 'false';
      if (key === 'privacy_apps') {
        if (invalidJson) return 'invalid-json{[';
        if (privacyApps === null) return null;
        return JSON.stringify(privacyApps);
      }
      return null;
    }),
    insertActivityLog: jest.fn(),
  };
}

describe('ActivityTracker Privacy Sanitization - Property Tests', () => {
  describe('Property 2: Window Title Sanitization Logic', () => {
    const windowTitleArb = fc.string({ minLength: 0, maxLength: 200 });

    test('should sanitize title when privacy enabled AND app matches privacy app', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...DEFAULT_PRIVACY_APPS),
          windowTitleArb,
          (privacyAppName, windowTitle) => {
            const mockDb = createMockDb(true, DEFAULT_PRIVACY_APPS);
            const tracker = new ActivityTracker(mockDb);
            const result = tracker.sanitizeWindowTitle(privacyAppName, windowTitle);

            expect(result.windowTitle).toBe(privacyAppName);
            expect(result.wasSanitized).toBe(true);
            expect(result.appName).toBe(privacyAppName);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('should NOT sanitize title when privacy mode is disabled', () => {
      const appNameArb = fc.string({ minLength: 1, maxLength: 50 });
      fc.assert(
        fc.property(
          appNameArb,
          windowTitleArb,
          (appName, windowTitle) => {
            const mockDb = createMockDb(false, DEFAULT_PRIVACY_APPS);
            const tracker = new ActivityTracker(mockDb);
            const result = tracker.sanitizeWindowTitle(appName, windowTitle);

            expect(result.windowTitle).toBe(windowTitle);
            expect(result.wasSanitized).toBe(false);
            expect(result.appName).toBe(appName);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('should NOT sanitize title when app does NOT match any privacy app', () => {
      const nonPrivacyAppArb = fc.string({ minLength: 1, maxLength: 50 }).filter(name => {
        const lowerName = name.toLowerCase();
        return !DEFAULT_PRIVACY_APPS.some(app => lowerName.includes(app.toLowerCase()));
      });

      fc.assert(
        fc.property(
          nonPrivacyAppArb,
          windowTitleArb,
          (appName, windowTitle) => {
            const mockDb = createMockDb(true, DEFAULT_PRIVACY_APPS);
            const tracker = new ActivityTracker(mockDb);
            const result = tracker.sanitizeWindowTitle(appName, windowTitle);

            expect(result.windowTitle).toBe(windowTitle);
            expect(result.wasSanitized).toBe(false);
            expect(result.appName).toBe(appName);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('should handle case-insensitive app matching', () => {
      const caseVariationArb = fc.constantFrom(...DEFAULT_PRIVACY_APPS).chain(app => 
        fc.constantFrom(
          app.toLowerCase(),
          app.toUpperCase(),
          app.charAt(0).toUpperCase() + app.slice(1).toLowerCase()
        )
      );

      fc.assert(
        fc.property(
          caseVariationArb,
          windowTitleArb,
          (appNameVariation, windowTitle) => {
            const mockDb = createMockDb(true, DEFAULT_PRIVACY_APPS);
            const tracker = new ActivityTracker(mockDb);
            const result = tracker.sanitizeWindowTitle(appNameVariation, windowTitle);

            expect(result.windowTitle).toBe(appNameVariation);
            expect(result.wasSanitized).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('should use DEFAULT_PRIVACY_APPS when privacy_apps setting is invalid JSON', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...DEFAULT_PRIVACY_APPS),
          windowTitleArb,
          (privacyAppName, windowTitle) => {
            const mockDb = createMockDb(true, null, true);
            const tracker = new ActivityTracker(mockDb);
            const result = tracker.sanitizeWindowTitle(privacyAppName, windowTitle);

            expect(result.windowTitle).toBe(privacyAppName);
            expect(result.wasSanitized).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('should use DEFAULT_PRIVACY_APPS when privacy_apps setting is missing', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...DEFAULT_PRIVACY_APPS),
          windowTitleArb,
          (privacyAppName, windowTitle) => {
            const mockDb = createMockDb(true, null);
            const tracker = new ActivityTracker(mockDb);
            const result = tracker.sanitizeWindowTitle(privacyAppName, windowTitle);

            expect(result.windowTitle).toBe(privacyAppName);
            expect(result.wasSanitized).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('should work with custom privacy apps list', () => {
      const customApps = ['CustomApp1', 'CustomApp2', 'MyMessenger'];
      
      fc.assert(
        fc.property(
          fc.constantFrom(...customApps),
          windowTitleArb,
          (customAppName, windowTitle) => {
            const mockDb = createMockDb(true, customApps);
            const tracker = new ActivityTracker(mockDb);
            const result = tracker.sanitizeWindowTitle(customAppName, windowTitle);

            expect(result.windowTitle).toBe(customAppName);
            expect(result.wasSanitized).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
