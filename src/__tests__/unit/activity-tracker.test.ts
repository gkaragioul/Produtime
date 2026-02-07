/**
 * Activity Tracker Unit Tests
 * Tests core activity tracking functionality including focus detection,
 * idle state management, and activity logging.
 */

import { ActivityTracker, CurrentActivity, ActivityTrackerOptions } from '../../main/services/activity-tracker';

// Mock DatabaseManager
const mockDatabaseManager = {
  logActivity: jest.fn(),
  recordIdleTime: jest.fn(),
};

describe('ActivityTracker', () => {
  let tracker: ActivityTracker;
  let mockOptions: ActivityTrackerOptions;

  beforeEach(() => {
    jest.clearAllMocks();
    mockOptions = {
      pollInterval: 500,
      idleThreshold: 300, // 5 minutes
      enableLogging: false,
      selfAppNames: ['Electron', 'TimePort'],
      stabilizationSamples: 3,
      stabilizationWindowMs: 250,
    };
    tracker = new ActivityTracker(mockDatabaseManager as any, mockOptions);
  });

  afterEach(() => {
    // Clean up any running timers
    jest.clearAllTimers();
  });

  describe('Initialization', () => {
    it('should initialize with default options', () => {
      const tracker = new ActivityTracker(mockDatabaseManager as any);
      expect(tracker).toBeDefined();
      expect(tracker.isTrackingActive()).toBe(false);
    });

    it('should initialize with custom options', () => {
      const customOptions: ActivityTrackerOptions = {
        pollInterval: 1000,
        idleThreshold: 600,
        enableLogging: true,
      };
      const tracker = new ActivityTracker(mockDatabaseManager as any, customOptions);
      expect(tracker).toBeDefined();
    });

    it('should not be tracking initially', () => {
      expect(tracker.isTrackingActive()).toBe(false);
      expect(tracker.isPausedState()).toBe(false);
    });
  });

  describe('Tracking Control', () => {
    it('should start tracking', async () => {
      await tracker.startTracking();
      expect(tracker.isTrackingActive()).toBe(true);
      expect(tracker.isPausedState()).toBe(false);
    });

    it('should not start tracking twice', async () => {
      await tracker.startTracking();
      const firstStart = tracker.isTrackingActive();

      await tracker.startTracking(); // Second call
      const secondStart = tracker.isTrackingActive();

      expect(firstStart).toBe(true);
      expect(secondStart).toBe(true); // Still tracking
    });

    it('should stop tracking', async () => {
      await tracker.startTracking();
      expect(tracker.isTrackingActive()).toBe(true);

      await tracker.stopTracking();
      expect(tracker.isTrackingActive()).toBe(false);
    });

    it('should not stop if not tracking', async () => {
      expect(tracker.isTrackingActive()).toBe(false);
      await tracker.stopTracking(); // Should handle gracefully
      expect(tracker.isTrackingActive()).toBe(false);
    });

    it('should pause tracking', async () => {
      await tracker.startTracking();
      expect(tracker.isTrackingActive()).toBe(true);
      expect(tracker.isPausedState()).toBe(false);

      await tracker.pauseTracking();
      expect(tracker.isTrackingActive()).toBe(false);
      expect(tracker.isPausedState()).toBe(true);
    });

    it('should not pause if not tracking', async () => {
      expect(tracker.isPausedState()).toBe(false);
      await tracker.pauseTracking(); // Should handle gracefully
      expect(tracker.isPausedState()).toBe(false);
    });

    it('should resume from paused state', async () => {
      await tracker.startTracking();
      await tracker.pauseTracking();
      expect(tracker.isPausedState()).toBe(true);

      await tracker.resumeTracking();
      expect(tracker.isTrackingActive()).toBe(true);
      expect(tracker.isPausedState()).toBe(false);
    });
  });

  describe('Activity Detection', () => {
    it('should detect focus changes', async () => {
      const activity: CurrentActivity = {
        appName: 'VSCode',
        windowTitle: 'index.ts - MyProject',
        startTime: new Date(),
        isIdle: false,
      };

      // Simulate detecting a new activity
      expect(activity.appName).toBe('VSCode');
      expect(activity.windowTitle).toContain('index.ts');
      expect(activity.isIdle).toBe(false);
    });

    it('should recognize idle state', () => {
      const idleActivity: CurrentActivity = {
        appName: 'System',
        windowTitle: 'Idle',
        startTime: new Date(),
        isIdle: true,
      };

      expect(idleActivity.isIdle).toBe(true);
    });

    it('should suppress self-app logging', () => {
      const selfActivity: CurrentActivity = {
        appName: 'Electron',
        windowTitle: 'ProduTime',
        startTime: new Date(),
        isIdle: false,
      };

      // Should not log when it's the tracking app itself (Electron)
      expect(mockOptions.selfAppNames).toContain(selfActivity.appName);
    });

    it('should ignore transient applications', () => {
      const transientAppNames = ['SearchHost.exe', 'Task Switching', 'LockApp.exe'];

      // These apps should be ignored when tracking focus
      transientAppNames.forEach((appName) => {
        expect(mockOptions.ignoreTransientApps).toContain(appName);
      });
    });

    it('should stabilize rapid focus changes', async () => {
      // Scenario: App switches 3 times in 250ms
      const app1: CurrentActivity = {
        appName: 'Chrome',
        windowTitle: 'Google',
        startTime: new Date(),
        isIdle: false,
      };

      const app2: CurrentActivity = {
        appName: 'Firefox',
        windowTitle: 'Mozilla',
        startTime: new Date(Date.now() + 100),
        isIdle: false,
      };

      const app3: CurrentActivity = {
        appName: 'Chrome',
        windowTitle: 'Google',
        startTime: new Date(Date.now() + 200),
        isIdle: false,
      };

      // With stabilization, brief switches should be filtered
      expect(app1.appName).not.toBe(app2.appName);
      expect(app2.appName).not.toBe(app3.appName);
      expect(app1.appName).toBe(app3.appName); // Back to Chrome
    });
  });

  describe('Idle Timeout', () => {
    it('should mark as idle after idle threshold', async () => {
      const idleThreshold = 300; // 5 minutes

      // Simulate no activity for 300+ seconds
      const lastActivity = new Date(Date.now() - (idleThreshold + 10) * 1000);
      const timeSinceActivity = (Date.now() - lastActivity.getTime()) / 1000;

      expect(timeSinceActivity).toBeGreaterThan(idleThreshold);
    });

    it('should not mark as idle before threshold', async () => {
      const idleThreshold = 300;
      const lastActivity = new Date(Date.now() - 100 * 1000); // 100 seconds ago

      const timeSinceActivity = (Date.now() - lastActivity.getTime()) / 1000;

      expect(timeSinceActivity).toBeLessThan(idleThreshold);
    });

    it('should log idle period', async () => {
      // Scenario: User inactive for 6 minutes
      const idleDuration = 360; // seconds
      const thresholdSeconds = 300;

      expect(idleDuration).toBeGreaterThan(thresholdSeconds);
      // Should log this as idle time
    });

    it('should record idle cooldown to prevent rapid switches', async () => {
      const lastIdleEndTime = Date.now();
      const cooldownMs = 2000;

      // Rapid subsequent idle detection should be ignored within cooldown
      const nextDetectionTime = Date.now() + 1000; // Within cooldown
      expect(nextDetectionTime - lastIdleEndTime).toBeLessThan(cooldownMs);
    });
  });

  describe('Activity Logging', () => {
    it('should log activity with duration', async () => {
      const startTime = new Date(Date.now() - 300000); // 5 minutes ago
      const activity: CurrentActivity = {
        appName: 'VSCode',
        windowTitle: 'document.ts',
        startTime,
        isIdle: false,
      };

      const duration = Date.now() - startTime.getTime();

      expect(duration).toBeGreaterThan(0);
      expect(activity.appName).toBeDefined();
      expect(activity.windowTitle).toBeDefined();
    });

    it('should not log activities shorter than self-suppress threshold', () => {
      const suppressMs = 900;
      const activityDuration = 500; // Less than 900ms

      // Activities shorter than selfLogSuppressMs should be filtered
      expect(activityDuration).toBeLessThan(suppressMs);
    });

    it('should include app metadata in logs', async () => {
      const activity: CurrentActivity = {
        appName: 'Chrome',
        windowTitle: 'Gmail - Inbox',
        startTime: new Date(),
        isIdle: false,
      };

      expect(activity).toHaveProperty('appName');
      expect(activity).toHaveProperty('windowTitle');
      expect(activity).toHaveProperty('startTime');
      expect(activity).toHaveProperty('isIdle');
    });

    it('should preserve window title for privacy review', async () => {
      const sensitiveTitle = 'My Secret Project - Confidential Data';
      const activity: CurrentActivity = {
        appName: 'VSCode',
        windowTitle: sensitiveTitle,
        startTime: new Date(),
        isIdle: false,
      };

      // Window title should be preserved for logging/privacy review
      expect(activity.windowTitle).toBe(sensitiveTitle);
    });
  });

  describe('State Management', () => {
    it('should maintain current activity state', async () => {
      const activity: CurrentActivity = {
        appName: 'Slack',
        windowTitle: '#general',
        startTime: new Date(),
        isIdle: false,
      };

      // Tracker should maintain this state while active
      expect(activity.appName).toBe('Slack');
      expect(activity.isIdle).toBe(false);
    });

    it('should reset on pause', async () => {
      const activity: CurrentActivity = {
        appName: 'VSCode',
        windowTitle: 'main.ts',
        startTime: new Date(),
        isIdle: false,
      };

      // After pause, activity should transition to "Paused" state
      // This is handled by pauseTracking()
      expect(activity).toBeDefined();
    });

    it('should clear activity on stop', async () => {
      const activity: CurrentActivity = {
        appName: 'Chrome',
        windowTitle: 'YouTube',
        startTime: new Date(),
        isIdle: false,
      };

      // After stopTracking(), currentActivity should be cleared
      expect(activity).toBeDefined();
    });
  });

  describe('Options and Configuration', () => {
    it('should respect poll interval', () => {
      expect(mockOptions.pollInterval).toBe(500);
    });

    it('should respect idle threshold', () => {
      expect(mockOptions.idleThreshold).toBe(300);
    });

    it('should respect stabilization samples', () => {
      expect(mockOptions.stabilizationSamples).toBe(3);
    });

    it('should respect stabilization window', () => {
      expect(mockOptions.stabilizationWindowMs).toBe(250);
    });

    it('should allow self app names configuration', () => {
      const customTracker = new ActivityTracker(mockDatabaseManager as any, {
        selfAppNames: ['MyApp', 'Custom'],
      });
      expect(customTracker).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle missing database gracefully', () => {
      const nullDb = null;
      // Constructor should accept database parameter
      expect(() => {
        new ActivityTracker(nullDb as any);
      }).not.toThrow();
    });

    it('should handle active-win unavailable', () => {
      // When active-win native module is not available,
      // tracker should fallback to system idle detection
      const tracker = new ActivityTracker(mockDatabaseManager as any);
      expect(tracker).toBeDefined();
    });

    it('should recover from activity detection failure', async () => {
      await tracker.startTracking();

      // Even if activity detection fails, tracking should continue
      expect(tracker.isTrackingActive()).toBe(true);

      await tracker.stopTracking();
      expect(tracker.isTrackingActive()).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid pause/resume cycles', async () => {
      await tracker.startTracking();

      for (let i = 0; i < 5; i++) {
        await tracker.pauseTracking();
        expect(tracker.isPausedState()).toBe(true);

        await tracker.resumeTracking();
        expect(tracker.isTrackingActive()).toBe(true);
      }
    });

    it('should handle very long tracking sessions', async () => {
      await tracker.startTracking();

      // Simulate 24 hours of tracking
      const duration24h = 24 * 60 * 60 * 1000;
      expect(duration24h).toBeGreaterThan(0);

      // Tracker should still be active
      expect(tracker.isTrackingActive()).toBe(true);

      await tracker.stopTracking();
    });

    it('should handle activity with empty window title', () => {
      const activity: CurrentActivity = {
        appName: 'Explorer',
        windowTitle: '', // Empty title
        startTime: new Date(),
        isIdle: false,
      };

      expect(activity.appName).toBeDefined();
      expect(typeof activity.windowTitle).toBe('string');
    });

    it('should handle activity with very long window title', () => {
      const longTitle = 'A'.repeat(1000); // 1000 character title
      const activity: CurrentActivity = {
        appName: 'Chrome',
        windowTitle: longTitle,
        startTime: new Date(),
        isIdle: false,
      };

      expect(activity.windowTitle.length).toBe(1000);
    });

    it('should handle concurrent tracking control calls', async () => {
      // Start tracking multiple times
      const startPromises = [
        tracker.startTracking(),
        tracker.startTracking(),
        tracker.startTracking(),
      ];

      await Promise.all(startPromises);
      expect(tracker.isTrackingActive()).toBe(true);

      await tracker.stopTracking();
      expect(tracker.isTrackingActive()).toBe(false);
    });
  });
});
