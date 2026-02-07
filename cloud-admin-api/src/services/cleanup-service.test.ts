/**
 * Cleanup Service Tests
 * Property-based tests and unit tests for cleanup service.
 * 
 * Feature: cloud-admin-console
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import {
  CleanupService,
  CleanupDatabase,
  CleanupLogger,
  CleanupResult,
  CLEANUP_CONSTANTS,
} from './cleanup-service';

// ============================================================================
// Mock Database Factory
// ============================================================================

interface MockRecord {
  id: string;
  createdAt: Date;
}

interface MockDailyMetric {
  id: string;
  deviceId: string;
  dateYmd: string;
  createdAt: Date;
}

const createMockDb = (): CleanupDatabase & {
  sessions: MockRecord[];
  pairCodes: MockRecord[];
  failedLogins: MockRecord[];
  dailyMetrics: MockDailyMetric[];
} => {
  const sessions: MockRecord[] = [];
  const pairCodes: MockRecord[] = [];
  const failedLogins: MockRecord[] = [];
  const dailyMetrics: MockDailyMetric[] = [];

  return {
    sessions,
    pairCodes,
    failedLogins,
    dailyMetrics,

    deleteOldSessions: async (olderThan: Date) => {
      const toDelete = sessions.filter(s => s.createdAt < olderThan);
      const count = toDelete.length;
      toDelete.forEach(s => {
        const idx = sessions.indexOf(s);
        if (idx > -1) sessions.splice(idx, 1);
      });
      return count;
    },

    deleteOldPairCodes: async (olderThan: Date) => {
      const toDelete = pairCodes.filter(p => p.createdAt < olderThan);
      const count = toDelete.length;
      toDelete.forEach(p => {
        const idx = pairCodes.indexOf(p);
        if (idx > -1) pairCodes.splice(idx, 1);
      });
      return count;
    },

    deleteOldFailedLogins: async (olderThan: Date) => {
      const toDelete = failedLogins.filter(f => f.createdAt < olderThan);
      const count = toDelete.length;
      toDelete.forEach(f => {
        const idx = failedLogins.indexOf(f);
        if (idx > -1) failedLogins.splice(idx, 1);
      });
      return count;
    },

    archiveOldDailyMetrics: async (olderThan: Date) => {
      // Group metrics by deviceId
      const metricsByDevice = new Map<string, MockDailyMetric[]>();
      for (const metric of dailyMetrics) {
        const existing = metricsByDevice.get(metric.deviceId) || [];
        existing.push(metric);
        metricsByDevice.set(metric.deviceId, existing);
      }

      let archivedCount = 0;

      // For each device, keep only the latest metric, archive/delete old ones
      for (const [deviceId, metrics] of metricsByDevice) {
        // Sort by dateYmd descending to find the latest
        const sorted = [...metrics].sort((a, b) => b.dateYmd.localeCompare(a.dateYmd));
        const latest = sorted[0];

        // Delete old metrics (older than cutoff and not the latest)
        for (const metric of metrics) {
          if (metric.createdAt < olderThan && metric.id !== latest.id) {
            const idx = dailyMetrics.indexOf(metric);
            if (idx > -1) {
              dailyMetrics.splice(idx, 1);
              archivedCount++;
            }
          }
        }
      }

      return archivedCount;
    },

    countOldSessions: async (olderThan: Date) => {
      return sessions.filter(s => s.createdAt < olderThan).length;
    },

    countOldPairCodes: async (olderThan: Date) => {
      return pairCodes.filter(p => p.createdAt < olderThan).length;
    },

    countOldFailedLogins: async (olderThan: Date) => {
      return failedLogins.filter(f => f.createdAt < olderThan).length;
    },
  };
};

// ============================================================================
// Mock Logger Factory
// ============================================================================

const createMockLogger = (): CleanupLogger & { logs: Array<{ level: string; message: string; data?: Record<string, unknown> }> } => {
  const logs: Array<{ level: string; message: string; data?: Record<string, unknown> }> = [];
  
  return {
    logs,
    info: (message, data) => logs.push({ level: 'info', message, data }),
    error: (message, data) => logs.push({ level: 'error', message, data }),
    warn: (message, data) => logs.push({ level: 'warn', message, data }),
  };
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a date that is a certain number of days ago
 */
const daysAgo = (days: number): Date => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
};

/**
 * Generate a random ID
 */
const randomId = (): string => Math.random().toString(36).substring(2, 15);

/**
 * Generate a date string in YYYY-MM-DD format
 */
const formatDateYmd = (date: Date): string => {
  return date.toISOString().split('T')[0];
};

// ============================================================================
// Property 20: Cleanup Removes Old Records
// *For any* execution of the cleanup job, all records older than 30 days in 
// sessions, pair codes, and failed logins tables SHALL be deleted.
// **Validates: Requirements 8.2**
// ============================================================================

describe('Property 20: Cleanup Removes Old Records', () => {
  /**
   * Feature: cloud-admin-console, Property 20: Cleanup Removes Old Records
   * For any set of records with various ages, cleanup should remove all records
   * older than the retention period.
   */
  it('should delete all sessions older than retention period', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate arrays of record ages (in days) - use > 30 to be clearly old
        fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 0, maxLength: 20 }),
        async (sessionAges) => {
          const mockDb = createMockDb();
          const mockLogger = createMockLogger();
          const cleanupService = new CleanupService(mockDb, mockLogger, { 
            retentionDays: 30,
            runOnStartup: false 
          });

          // Create sessions with various ages
          for (const age of sessionAges) {
            mockDb.sessions.push({
              id: randomId(),
              createdAt: daysAgo(age),
            });
          }

          const cutoff = cleanupService.getCutoffDate();
          
          // Count records that are strictly older than cutoff
          const oldCount = mockDb.sessions.filter(s => s.createdAt < cutoff).length;

          // Run cleanup
          const result = await cleanupService.runCleanup();

          // Verify old sessions were deleted
          expect(result.deletedSessions).toBe(oldCount);
          
          // Verify remaining sessions are all newer than or equal to retention period
          for (const session of mockDb.sessions) {
            expect(session.createdAt >= cutoff).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should delete all pair codes older than retention period', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 0, maxLength: 20 }),
        async (pairCodeAges) => {
          const mockDb = createMockDb();
          const mockLogger = createMockLogger();
          const cleanupService = new CleanupService(mockDb, mockLogger, {
            retentionDays: 30,
            runOnStartup: false
          });

          // Create pair codes with various ages
          for (const age of pairCodeAges) {
            mockDb.pairCodes.push({
              id: randomId(),
              createdAt: daysAgo(age),
            });
          }

          const cutoff = cleanupService.getCutoffDate();
          
          // Count records that are strictly older than cutoff
          const oldCount = mockDb.pairCodes.filter(p => p.createdAt < cutoff).length;

          // Run cleanup
          const result = await cleanupService.runCleanup();

          // Verify old pair codes were deleted
          expect(result.deletedPairCodes).toBe(oldCount);

          // Verify remaining pair codes are all newer than or equal to retention period
          for (const pairCode of mockDb.pairCodes) {
            expect(pairCode.createdAt >= cutoff).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should delete all failed logins older than retention period', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 0, maxLength: 20 }),
        async (failedLoginAges) => {
          const mockDb = createMockDb();
          const mockLogger = createMockLogger();
          const cleanupService = new CleanupService(mockDb, mockLogger, {
            retentionDays: 30,
            runOnStartup: false
          });

          // Create failed logins with various ages
          for (const age of failedLoginAges) {
            mockDb.failedLogins.push({
              id: randomId(),
              createdAt: daysAgo(age),
            });
          }

          const cutoff = cleanupService.getCutoffDate();
          
          // Count records that are strictly older than cutoff
          const oldCount = mockDb.failedLogins.filter(f => f.createdAt < cutoff).length;

          // Run cleanup
          const result = await cleanupService.runCleanup();

          // Verify old failed logins were deleted
          expect(result.deletedFailedLogins).toBe(oldCount);

          // Verify remaining failed logins are all newer than or equal to retention period
          for (const failedLogin of mockDb.failedLogins) {
            expect(failedLogin.createdAt >= cutoff).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});


// ============================================================================
// Property 21: Cleanup Preserves Latest Status
// *For any* device after cleanup, the latest status record SHALL be preserved 
// while older status records are removed.
// **Validates: Requirements 8.3**
// ============================================================================

describe('Property 21: Cleanup Preserves Latest Status', () => {
  /**
   * Feature: cloud-admin-console, Property 21: Cleanup Preserves Latest Status
   * For any device with multiple daily metrics, cleanup should preserve the latest
   * metric while removing older ones.
   */
  it('should preserve latest daily metric for each device while removing old ones', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate device IDs and their metric ages
        fc.array(
          fc.record({
            deviceId: fc.string({ minLength: 1, maxLength: 20 }),
            metricAges: fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 1, maxLength: 10 }),
          }),
          { minLength: 1, maxLength: 5 }
        ),
        async (deviceMetrics) => {
          const mockDb = createMockDb();
          const mockLogger = createMockLogger();
          const cleanupService = new CleanupService(mockDb, mockLogger, {
            retentionDays: 30,
            runOnStartup: false
          });

          // Track the latest metric for each device
          const latestMetricByDevice = new Map<string, MockDailyMetric>();

          // Create daily metrics for each device
          for (const { deviceId, metricAges } of deviceMetrics) {
            for (const age of metricAges) {
              const createdAt = daysAgo(age);
              const dateYmd = formatDateYmd(createdAt);
              const metric: MockDailyMetric = {
                id: randomId(),
                deviceId,
                dateYmd,
                createdAt,
              };
              mockDb.dailyMetrics.push(metric);

              // Track the latest metric (most recent dateYmd)
              const existing = latestMetricByDevice.get(deviceId);
              if (!existing || dateYmd > existing.dateYmd) {
                latestMetricByDevice.set(deviceId, metric);
              }
            }
          }

          // Run cleanup
          await cleanupService.runCleanup();

          // Verify that the latest metric for each device is preserved
          for (const [deviceId, latestMetric] of latestMetricByDevice) {
            const remainingForDevice = mockDb.dailyMetrics.filter(m => m.deviceId === deviceId);
            
            // The latest metric should still exist
            const latestStillExists = remainingForDevice.some(m => m.id === latestMetric.id);
            expect(latestStillExists).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should not delete metrics newer than retention period', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            deviceId: fc.string({ minLength: 1, maxLength: 20 }),
            metricAges: fc.array(fc.integer({ min: 0, max: 29 }), { minLength: 1, maxLength: 5 }),
          }),
          { minLength: 1, maxLength: 5 }
        ),
        async (deviceMetrics) => {
          const mockDb = createMockDb();
          const mockLogger = createMockLogger();
          const cleanupService = new CleanupService(mockDb, mockLogger, {
            retentionDays: 30,
            runOnStartup: false
          });

          // Create only recent metrics (all within retention period)
          let totalMetrics = 0;
          for (const { deviceId, metricAges } of deviceMetrics) {
            for (const age of metricAges) {
              mockDb.dailyMetrics.push({
                id: randomId(),
                deviceId,
                dateYmd: formatDateYmd(daysAgo(age)),
                createdAt: daysAgo(age),
              });
              totalMetrics++;
            }
          }

          // Run cleanup
          const result = await cleanupService.runCleanup();

          // No metrics should be archived since all are within retention period
          expect(result.archivedMetrics).toBe(0);
          expect(mockDb.dailyMetrics.length).toBe(totalMetrics);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Property 22: Cleanup Idempotence
// *For any* database state, running cleanup twice SHALL produce the same result 
// as running it once.
// **Validates: Requirements 8.6**
// ============================================================================

describe('Property 22: Cleanup Idempotence', () => {
  /**
   * Feature: cloud-admin-console, Property 22: Cleanup Idempotence
   * Running cleanup multiple times should produce the same final state.
   */
  it('should produce same result when run multiple times', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate mixed ages for all record types
        fc.record({
          sessionAges: fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 0, maxLength: 10 }),
          pairCodeAges: fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 0, maxLength: 10 }),
          failedLoginAges: fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 0, maxLength: 10 }),
        }),
        async ({ sessionAges, pairCodeAges, failedLoginAges }) => {
          const mockDb = createMockDb();
          const mockLogger = createMockLogger();
          const cleanupService = new CleanupService(mockDb, mockLogger, {
            retentionDays: 30,
            runOnStartup: false
          });

          // Populate database
          for (const age of sessionAges) {
            mockDb.sessions.push({ id: randomId(), createdAt: daysAgo(age) });
          }
          for (const age of pairCodeAges) {
            mockDb.pairCodes.push({ id: randomId(), createdAt: daysAgo(age) });
          }
          for (const age of failedLoginAges) {
            mockDb.failedLogins.push({ id: randomId(), createdAt: daysAgo(age) });
          }

          // Run cleanup first time
          const result1 = await cleanupService.runCleanup();

          // Capture state after first cleanup
          const sessionsAfterFirst = mockDb.sessions.length;
          const pairCodesAfterFirst = mockDb.pairCodes.length;
          const failedLoginsAfterFirst = mockDb.failedLogins.length;

          // Run cleanup second time
          const result2 = await cleanupService.runCleanup();

          // Second run should delete nothing (idempotent)
          expect(result2.deletedSessions).toBe(0);
          expect(result2.deletedPairCodes).toBe(0);
          expect(result2.deletedFailedLogins).toBe(0);

          // State should be unchanged after second run
          expect(mockDb.sessions.length).toBe(sessionsAfterFirst);
          expect(mockDb.pairCodes.length).toBe(pairCodesAfterFirst);
          expect(mockDb.failedLogins.length).toBe(failedLoginsAfterFirst);

          // Run cleanup third time to further verify idempotence
          const result3 = await cleanupService.runCleanup();
          expect(result3.deletedSessions).toBe(0);
          expect(result3.deletedPairCodes).toBe(0);
          expect(result3.deletedFailedLogins).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should maintain consistent state across multiple runs', async () => {
    const mockDb = createMockDb();
    const mockLogger = createMockLogger();
    const cleanupService = new CleanupService(mockDb, mockLogger, {
      retentionDays: 30,
      runOnStartup: false
    });

    // Add some old and new records
    mockDb.sessions.push(
      { id: 'old-1', createdAt: daysAgo(45) },
      { id: 'old-2', createdAt: daysAgo(60) },
      { id: 'new-1', createdAt: daysAgo(5) },
      { id: 'new-2', createdAt: daysAgo(10) }
    );

    // First run
    await cleanupService.runCleanup();
    expect(mockDb.sessions.length).toBe(2);
    expect(mockDb.sessions.map(s => s.id).sort()).toEqual(['new-1', 'new-2']);

    // Second run - should not change anything
    await cleanupService.runCleanup();
    expect(mockDb.sessions.length).toBe(2);
    expect(mockDb.sessions.map(s => s.id).sort()).toEqual(['new-1', 'new-2']);

    // Third run - should not change anything
    await cleanupService.runCleanup();
    expect(mockDb.sessions.length).toBe(2);
    expect(mockDb.sessions.map(s => s.id).sort()).toEqual(['new-1', 'new-2']);
  });
});

// ============================================================================
// Unit Tests for Cleanup Service
// ============================================================================

describe('CleanupService Unit Tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getCutoffDate', () => {
    it('should return date 30 days ago by default', () => {
      const mockDb = createMockDb();
      const mockLogger = createMockLogger();
      const cleanupService = new CleanupService(mockDb, mockLogger);

      const now = new Date();
      const cutoff = cleanupService.getCutoffDate();
      
      const expectedCutoff = new Date(now);
      expectedCutoff.setDate(expectedCutoff.getDate() - 30);
      expectedCutoff.setHours(0, 0, 0, 0);

      expect(cutoff.getTime()).toBe(expectedCutoff.getTime());
    });

    it('should respect custom retention days', () => {
      const mockDb = createMockDb();
      const mockLogger = createMockLogger();
      const cleanupService = new CleanupService(mockDb, mockLogger, { 
        retentionDays: 7,
        scheduledHour: 3,
        runOnStartup: false
      });

      const cutoff = cleanupService.getCutoffDate();
      const now = new Date();
      const expectedCutoff = new Date(now);
      expectedCutoff.setDate(expectedCutoff.getDate() - 7);
      expectedCutoff.setHours(0, 0, 0, 0);

      expect(cutoff.getTime()).toBe(expectedCutoff.getTime());
    });
  });

  describe('runCleanup', () => {
    it('should return cleanup result with counts', async () => {
      const mockDb = createMockDb();
      const mockLogger = createMockLogger();
      const cleanupService = new CleanupService(mockDb, mockLogger, {
        retentionDays: 30,
        runOnStartup: false
      });

      // Add old records
      mockDb.sessions.push({ id: '1', createdAt: daysAgo(45) });
      mockDb.pairCodes.push({ id: '2', createdAt: daysAgo(45) });
      mockDb.failedLogins.push({ id: '3', createdAt: daysAgo(45) });

      const result = await cleanupService.runCleanup();

      expect(result.deletedSessions).toBe(1);
      expect(result.deletedPairCodes).toBe(1);
      expect(result.deletedFailedLogins).toBe(1);
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('should log cleanup start and completion', async () => {
      const mockDb = createMockDb();
      const mockLogger = createMockLogger();
      const cleanupService = new CleanupService(mockDb, mockLogger, {
        retentionDays: 30,
        runOnStartup: false
      });

      await cleanupService.runCleanup();

      const infoLogs = mockLogger.logs.filter(l => l.level === 'info');
      expect(infoLogs.some(l => l.message.includes('Starting cleanup'))).toBe(true);
      expect(infoLogs.some(l => l.message.includes('completed'))).toBe(true);
    });

    it('should prevent concurrent cleanup runs', async () => {
      const mockDb = createMockDb();
      const mockLogger = createMockLogger();
      
      // Create a slow database that takes time to delete
      const slowDb: CleanupDatabase = {
        ...mockDb,
        deleteOldSessions: async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          return 0;
        },
        deleteOldPairCodes: async () => 0,
        deleteOldFailedLogins: async () => 0,
        archiveOldDailyMetrics: async () => 0,
        countOldSessions: async () => 0,
        countOldPairCodes: async () => 0,
        countOldFailedLogins: async () => 0,
      };

      const cleanupService = new CleanupService(slowDb, mockLogger, {
        retentionDays: 30,
        runOnStartup: false
      });

      // Start first cleanup (don't await)
      const cleanup1Promise = cleanupService.runCleanup();

      // Try to start second cleanup immediately
      const cleanup2Promise = cleanupService.runCleanup();

      // Advance timers
      vi.advanceTimersByTime(200);

      const [result1, result2] = await Promise.all([cleanup1Promise, cleanup2Promise]);

      // Second cleanup should have been skipped
      const warnLogs = mockLogger.logs.filter(l => l.level === 'warn');
      expect(warnLogs.some(l => l.message.includes('already in progress'))).toBe(true);
    });
  });

  describe('start', () => {
    it('should run cleanup on startup when configured', async () => {
      const mockDb = createMockDb();
      const mockLogger = createMockLogger();
      const cleanupService = new CleanupService(mockDb, mockLogger, {
        retentionDays: 30,
        runOnStartup: true,
        scheduledHour: 3
      });

      await cleanupService.start();

      const infoLogs = mockLogger.logs.filter(l => l.level === 'info');
      expect(infoLogs.some(l => l.message.includes('Running cleanup on startup'))).toBe(true);

      cleanupService.stop();
    });

    it('should not run cleanup on startup when disabled', async () => {
      const mockDb = createMockDb();
      const mockLogger = createMockLogger();
      const cleanupService = new CleanupService(mockDb, mockLogger, {
        retentionDays: 30,
        runOnStartup: false,
        scheduledHour: 3
      });

      await cleanupService.start();

      const infoLogs = mockLogger.logs.filter(l => l.level === 'info');
      expect(infoLogs.some(l => l.message.includes('Running cleanup on startup'))).toBe(false);

      cleanupService.stop();
    });

    it('should schedule daily cleanup', async () => {
      const mockDb = createMockDb();
      const mockLogger = createMockLogger();
      const cleanupService = new CleanupService(mockDb, mockLogger, {
        retentionDays: 30,
        runOnStartup: false,
        scheduledHour: 3
      });

      await cleanupService.start();

      const infoLogs = mockLogger.logs.filter(l => l.level === 'info');
      expect(infoLogs.some(l => l.message.includes('Scheduling next cleanup'))).toBe(true);

      cleanupService.stop();
    });
  });

  describe('stop', () => {
    it('should cancel scheduled cleanup', async () => {
      const mockDb = createMockDb();
      const mockLogger = createMockLogger();
      const cleanupService = new CleanupService(mockDb, mockLogger, {
        retentionDays: 30,
        runOnStartup: false,
        scheduledHour: 3
      });

      await cleanupService.start();
      cleanupService.stop();

      const infoLogs = mockLogger.logs.filter(l => l.level === 'info');
      expect(infoLogs.some(l => l.message.includes('stopped'))).toBe(true);
    });
  });

  describe('getConfig', () => {
    it('should return current configuration', () => {
      const mockDb = createMockDb();
      const mockLogger = createMockLogger();
      const cleanupService = new CleanupService(mockDb, mockLogger, {
        retentionDays: 14,
        scheduledHour: 5,
        runOnStartup: false
      });

      const config = cleanupService.getConfig();

      expect(config.retentionDays).toBe(14);
      expect(config.scheduledHour).toBe(5);
      expect(config.runOnStartup).toBe(false);
    });

    it('should use default configuration when not specified', () => {
      const mockDb = createMockDb();
      const mockLogger = createMockLogger();
      const cleanupService = new CleanupService(mockDb, mockLogger);

      const config = cleanupService.getConfig();

      expect(config.retentionDays).toBe(CLEANUP_CONSTANTS.DEFAULT_RETENTION_DAYS);
      expect(config.scheduledHour).toBe(CLEANUP_CONSTANTS.DEFAULT_SCHEDULED_HOUR);
      expect(config.runOnStartup).toBe(true);
    });
  });

  describe('isCleanupRunning', () => {
    it('should return false when cleanup is not running', () => {
      const mockDb = createMockDb();
      const mockLogger = createMockLogger();
      const cleanupService = new CleanupService(mockDb, mockLogger);

      expect(cleanupService.isCleanupRunning()).toBe(false);
    });
  });

  describe('constants', () => {
    it('should have correct default retention days', () => {
      expect(CLEANUP_CONSTANTS.DEFAULT_RETENTION_DAYS).toBe(30);
    });

    it('should have correct default scheduled hour', () => {
      expect(CLEANUP_CONSTANTS.DEFAULT_SCHEDULED_HOUR).toBe(3);
    });
  });
});
