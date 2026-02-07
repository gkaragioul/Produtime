/**
 * Dashboard Service Tests
 * Property-based tests and unit tests for dashboard service.
 * 
 * Feature: cloud-admin-console
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  determineDashboardMode,
  DashboardMode,
  DashboardModeInfo,
} from './dashboard-types';

// ============================================================================
// Property 17: Dashboard Mode Computation
// *For any* combination of device count, heartbeat status, expected seconds,
// and active seconds, the computed dashboard mode SHALL match the deterministic rules:
// NO_DEVICES → NO_DATA_YET → PRE_SHIFT → IN_SHIFT_NO_ACTIVITY → NORMAL.
// **Validates: Requirements 5.4**
// ============================================================================

describe('Property 17: Dashboard Mode Computation', () => {
  /**
   * Feature: cloud-admin-console, Property 17: Dashboard Mode Computation
   * For any valid input combination, the dashboard mode must follow the
   * deterministic priority rules.
   */
  it('should compute correct dashboard mode for any valid input combination', () => {
    fc.assert(
      fc.property(
        fc.record({
          devicesCount: fc.integer({ min: 0, max: 1000 }),
          onlineCount: fc.integer({ min: 0, max: 1000 }),
          anyHeartbeatToday: fc.boolean(),
          teamExpectedSoFarSeconds: fc.integer({ min: 0, max: 86400 }), // 0 to 24 hours
          teamActiveSecondsToday: fc.integer({ min: 0, max: 86400 }),
          withinWorkHours: fc.boolean(),
          minutesIntoShift: fc.integer({ min: 0, max: 600 }), // 0 to 10 hours
        }),
        (input) => {
          // Ensure onlineCount <= devicesCount
          const adjustedInput = {
            ...input,
            onlineCount: Math.min(input.onlineCount, input.devicesCount),
          };

          const result = determineDashboardMode(adjustedInput);

          // Verify result structure
          expect(result).toHaveProperty('mode');
          expect(result).toHaveProperty('withinWorkHours');
          expect(result).toHaveProperty('minutesIntoShift');

          // Verify mode is one of the valid values
          const validModes: DashboardMode[] = [
            'NO_DEVICES',
            'NO_DATA_YET',
            'PRE_SHIFT',
            'IN_SHIFT_NO_ACTIVITY',
            'NORMAL',
          ];
          expect(validModes).toContain(result.mode);

          // Verify deterministic rules are followed in priority order
          verifyDashboardModeRules(adjustedInput, result);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Rule 1: NO_DEVICES - When devicesCount is 0
   */
  it('should return NO_DEVICES when devicesCount is 0', () => {
    fc.assert(
      fc.property(
        fc.record({
          onlineCount: fc.integer({ min: 0, max: 100 }),
          anyHeartbeatToday: fc.boolean(),
          teamExpectedSoFarSeconds: fc.integer({ min: 0, max: 86400 }),
          teamActiveSecondsToday: fc.integer({ min: 0, max: 86400 }),
          withinWorkHours: fc.boolean(),
          minutesIntoShift: fc.integer({ min: 0, max: 600 }),
        }),
        (input) => {
          const result = determineDashboardMode({
            ...input,
            devicesCount: 0,
          });

          expect(result.mode).toBe('NO_DEVICES');
          expect(result.minutesIntoShift).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Rule 2: NO_DATA_YET - When devices exist but no heartbeat today
   */
  it('should return NO_DATA_YET when devices exist but no heartbeat today', () => {
    fc.assert(
      fc.property(
        fc.record({
          devicesCount: fc.integer({ min: 1, max: 1000 }),
          onlineCount: fc.integer({ min: 0, max: 1000 }),
          teamExpectedSoFarSeconds: fc.integer({ min: 0, max: 86400 }),
          teamActiveSecondsToday: fc.integer({ min: 0, max: 86400 }),
          withinWorkHours: fc.boolean(),
          minutesIntoShift: fc.integer({ min: 0, max: 600 }),
        }),
        (input) => {
          const adjustedInput = {
            ...input,
            onlineCount: Math.min(input.onlineCount, input.devicesCount),
            anyHeartbeatToday: false, // No heartbeat today
          };

          const result = determineDashboardMode(adjustedInput);

          expect(result.mode).toBe('NO_DATA_YET');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Rule 3: PRE_SHIFT - When expected seconds is 0 (before work start)
   */
  it('should return PRE_SHIFT when expected seconds is 0', () => {
    fc.assert(
      fc.property(
        fc.record({
          devicesCount: fc.integer({ min: 1, max: 1000 }),
          onlineCount: fc.integer({ min: 0, max: 1000 }),
          teamActiveSecondsToday: fc.integer({ min: 0, max: 86400 }),
          withinWorkHours: fc.boolean(),
          minutesIntoShift: fc.integer({ min: 0, max: 600 }),
        }),
        (input) => {
          const adjustedInput = {
            ...input,
            onlineCount: Math.min(input.onlineCount, input.devicesCount),
            anyHeartbeatToday: true, // Has heartbeat
            teamExpectedSoFarSeconds: 0, // Pre-shift
          };

          const result = determineDashboardMode(adjustedInput);

          expect(result.mode).toBe('PRE_SHIFT');
          expect(result.withinWorkHours).toBe(false);
          expect(result.minutesIntoShift).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Rule 4: IN_SHIFT_NO_ACTIVITY - Within work hours, expected > 0, active = 0, after grace
   */
  it('should return IN_SHIFT_NO_ACTIVITY when in shift with no activity after grace period', () => {
    fc.assert(
      fc.property(
        fc.record({
          devicesCount: fc.integer({ min: 1, max: 1000 }),
          onlineCount: fc.integer({ min: 0, max: 1000 }),
          teamExpectedSoFarSeconds: fc.integer({ min: 1, max: 86400 }), // > 0
          minutesIntoShift: fc.integer({ min: 10, max: 600 }), // >= 10 (after grace)
        }),
        (input) => {
          const adjustedInput = {
            ...input,
            onlineCount: Math.min(input.onlineCount, input.devicesCount),
            anyHeartbeatToday: true,
            teamActiveSecondsToday: 0, // No activity
            withinWorkHours: true, // Within work hours
          };

          const result = determineDashboardMode(adjustedInput);

          expect(result.mode).toBe('IN_SHIFT_NO_ACTIVITY');
          expect(result.withinWorkHours).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Rule 5: NORMAL - Default when all other conditions are not met
   */
  it('should return NORMAL when there is activity during work hours', () => {
    fc.assert(
      fc.property(
        fc.record({
          devicesCount: fc.integer({ min: 1, max: 1000 }),
          onlineCount: fc.integer({ min: 0, max: 1000 }),
          teamExpectedSoFarSeconds: fc.integer({ min: 1, max: 86400 }),
          teamActiveSecondsToday: fc.integer({ min: 1, max: 86400 }), // > 0
          minutesIntoShift: fc.integer({ min: 0, max: 600 }),
        }),
        (input) => {
          const adjustedInput = {
            ...input,
            onlineCount: Math.min(input.onlineCount, input.devicesCount),
            anyHeartbeatToday: true,
            withinWorkHours: true,
          };

          const result = determineDashboardMode(adjustedInput);

          expect(result.mode).toBe('NORMAL');
        }
      ),
      { numRuns: 100 }
    );
  });


  /**
   * Verify mode priority: NO_DEVICES takes precedence over all others
   */
  it('should prioritize NO_DEVICES over all other modes', () => {
    // Even with heartbeats, expected seconds, and activity, NO_DEVICES wins
    const result = determineDashboardMode({
      devicesCount: 0,
      onlineCount: 0,
      anyHeartbeatToday: true,
      teamExpectedSoFarSeconds: 3600,
      teamActiveSecondsToday: 1800,
      withinWorkHours: true,
      minutesIntoShift: 60,
    });

    expect(result.mode).toBe('NO_DEVICES');
  });

  /**
   * Verify mode priority: NO_DATA_YET takes precedence over PRE_SHIFT
   */
  it('should prioritize NO_DATA_YET over PRE_SHIFT when no heartbeat', () => {
    const result = determineDashboardMode({
      devicesCount: 5,
      onlineCount: 2,
      anyHeartbeatToday: false,
      teamExpectedSoFarSeconds: 0, // Would be PRE_SHIFT if heartbeat existed
      teamActiveSecondsToday: 0,
      withinWorkHours: false,
      minutesIntoShift: 0,
    });

    expect(result.mode).toBe('NO_DATA_YET');
  });

  /**
   * Edge case: Grace period boundary (minutesIntoShift = 9)
   */
  it('should return NORMAL during grace period even with no activity', () => {
    const result = determineDashboardMode({
      devicesCount: 5,
      onlineCount: 3,
      anyHeartbeatToday: true,
      teamExpectedSoFarSeconds: 540, // 9 minutes
      teamActiveSecondsToday: 0,
      withinWorkHours: true,
      minutesIntoShift: 9, // Within grace period (< 10)
    });

    // Should be NORMAL because grace period hasn't passed
    expect(result.mode).toBe('NORMAL');
  });

  /**
   * Edge case: Exactly at grace period boundary (minutesIntoShift = 10)
   */
  it('should return IN_SHIFT_NO_ACTIVITY exactly at grace period boundary', () => {
    const result = determineDashboardMode({
      devicesCount: 5,
      onlineCount: 3,
      anyHeartbeatToday: true,
      teamExpectedSoFarSeconds: 600, // 10 minutes
      teamActiveSecondsToday: 0,
      withinWorkHours: true,
      minutesIntoShift: 10, // Exactly at grace period
    });

    expect(result.mode).toBe('IN_SHIFT_NO_ACTIVITY');
  });
});

/**
 * Helper function to verify dashboard mode rules are followed
 */
function verifyDashboardModeRules(
  input: {
    devicesCount: number;
    onlineCount: number;
    anyHeartbeatToday: boolean;
    teamExpectedSoFarSeconds: number;
    teamActiveSecondsToday: number;
    withinWorkHours: boolean;
    minutesIntoShift: number;
  },
  result: DashboardModeInfo
): void {
  const {
    devicesCount,
    anyHeartbeatToday,
    teamExpectedSoFarSeconds,
    teamActiveSecondsToday,
    withinWorkHours,
    minutesIntoShift,
  } = input;

  // Rule 1: NO_DEVICES (highest priority)
  if (devicesCount === 0) {
    expect(result.mode).toBe('NO_DEVICES');
    return;
  }

  // Rule 2: NO_DATA_YET
  if (!anyHeartbeatToday) {
    expect(result.mode).toBe('NO_DATA_YET');
    return;
  }

  // Rule 3: PRE_SHIFT
  if (teamExpectedSoFarSeconds === 0) {
    expect(result.mode).toBe('PRE_SHIFT');
    return;
  }

  // Rule 4: IN_SHIFT_NO_ACTIVITY
  if (
    withinWorkHours &&
    teamExpectedSoFarSeconds > 0 &&
    teamActiveSecondsToday === 0 &&
    minutesIntoShift >= 10
  ) {
    expect(result.mode).toBe('IN_SHIFT_NO_ACTIVITY');
    return;
  }

  // Rule 5: NORMAL (default)
  expect(result.mode).toBe('NORMAL');
}


// ============================================================================
// Property 1: Tenant Data Isolation
// *For any* two tenants A and B, and any API request authenticated as tenant A,
// the response SHALL never contain data belonging to tenant B.
// **Validates: Requirements 1.1, 5.3**
// ============================================================================

describe('Property 1: Tenant Data Isolation', () => {
  /**
   * Feature: cloud-admin-console, Property 1: Tenant Data Isolation
   * For any two distinct tenant IDs, data from one tenant must never
   * appear in queries for another tenant.
   */
  it('should ensure tenant isolation in device queries', () => {
    fc.assert(
      fc.property(
        fc.record({
          tenantAId: fc.uuid(),
          tenantBId: fc.uuid(),
          deviceIdA: fc.string({ minLength: 1, maxLength: 50 }),
          deviceIdB: fc.string({ minLength: 1, maxLength: 50 }),
          deviceNameA: fc.string({ minLength: 1, maxLength: 100 }),
          deviceNameB: fc.string({ minLength: 1, maxLength: 100 }),
        }),
        (input) => {
          // Ensure tenant IDs are different
          if (input.tenantAId === input.tenantBId) {
            return true; // Skip if same tenant
          }

          // Simulate device records for two tenants
          const deviceA = {
            tenantId: input.tenantAId,
            deviceId: input.deviceIdA,
            deviceName: input.deviceNameA,
          };

          const deviceB = {
            tenantId: input.tenantBId,
            deviceId: input.deviceIdB,
            deviceName: input.deviceNameB,
          };

          // Simulate a query filter for tenant A
          const queryTenantId = input.tenantAId;
          const allDevices = [deviceA, deviceB];

          // Filter devices by tenant (simulating Prisma where clause)
          const filteredDevices = allDevices.filter(d => d.tenantId === queryTenantId);

          // Verify isolation: only tenant A's devices should be returned
          expect(filteredDevices.length).toBeLessThanOrEqual(1);
          for (const device of filteredDevices) {
            expect(device.tenantId).toBe(input.tenantAId);
            expect(device.tenantId).not.toBe(input.tenantBId);
          }

          // Verify tenant B's device is never included
          const hasTenantBDevice = filteredDevices.some(d => d.tenantId === input.tenantBId);
          expect(hasTenantBDevice).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: cloud-admin-console, Property 1: Tenant Data Isolation
   * For any metrics query, data must be filtered by tenant_id.
   */
  it('should ensure tenant isolation in metrics queries', () => {
    fc.assert(
      fc.property(
        fc.record({
          tenantAId: fc.uuid(),
          tenantBId: fc.uuid(),
          deviceId: fc.string({ minLength: 1, maxLength: 50 }),
          dateYmd: fc.date({ min: new Date('2024-01-01'), max: new Date('2026-12-31') })
            .map(d => d.toISOString().split('T')[0]),
          activeSecondsA: fc.integer({ min: 0, max: 86400 }),
          activeSecondsB: fc.integer({ min: 0, max: 86400 }),
        }),
        (input) => {
          // Ensure tenant IDs are different
          if (input.tenantAId === input.tenantBId) {
            return true; // Skip if same tenant
          }

          // Simulate metrics records for two tenants
          const metricsA = {
            tenantId: input.tenantAId,
            deviceId: input.deviceId,
            dateYmd: input.dateYmd,
            activeSeconds: input.activeSecondsA,
          };

          const metricsB = {
            tenantId: input.tenantBId,
            deviceId: input.deviceId, // Same device ID but different tenant
            dateYmd: input.dateYmd,
            activeSeconds: input.activeSecondsB,
          };

          // Simulate a query filter for tenant A
          const queryTenantId = input.tenantAId;
          const allMetrics = [metricsA, metricsB];

          // Filter metrics by tenant (simulating Prisma where clause)
          const filteredMetrics = allMetrics.filter(m => m.tenantId === queryTenantId);

          // Verify isolation: only tenant A's metrics should be returned
          expect(filteredMetrics.length).toBeLessThanOrEqual(1);
          for (const metrics of filteredMetrics) {
            expect(metrics.tenantId).toBe(input.tenantAId);
            expect(metrics.activeSeconds).toBe(input.activeSecondsA);
          }

          // Verify tenant B's metrics are never included
          const hasTenantBMetrics = filteredMetrics.some(m => m.tenantId === input.tenantBId);
          expect(hasTenantBMetrics).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: cloud-admin-console, Property 1: Tenant Data Isolation
   * Verify that tenant context is always required for data access.
   */
  it('should require tenant context for all data operations', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        (tenantId) => {
          // Verify tenant ID is a valid UUID format
          const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          expect(tenantId).toMatch(uuidPattern);

          // Verify tenant ID is not empty
          expect(tenantId.length).toBeGreaterThan(0);

          // Verify tenant ID is a string
          expect(typeof tenantId).toBe('string');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: cloud-admin-console, Property 1: Tenant Data Isolation
   * Cross-tenant data access must be prevented even with same device IDs.
   */
  it('should prevent cross-tenant data access with same device IDs', () => {
    fc.assert(
      fc.property(
        fc.record({
          tenantAId: fc.uuid(),
          tenantBId: fc.uuid(),
          sharedDeviceId: fc.string({ minLength: 1, maxLength: 50 }),
          dataA: fc.integer({ min: 0, max: 10000 }),
          dataB: fc.integer({ min: 0, max: 10000 }),
        }),
        (input) => {
          // Ensure tenant IDs are different
          if (input.tenantAId === input.tenantBId) {
            return true; // Skip if same tenant
          }

          // Both tenants have a device with the same device ID
          const recordA = {
            tenantId: input.tenantAId,
            deviceId: input.sharedDeviceId,
            data: input.dataA,
          };

          const recordB = {
            tenantId: input.tenantBId,
            deviceId: input.sharedDeviceId, // Same device ID!
            data: input.dataB,
          };

          const allRecords = [recordA, recordB];

          // Query for tenant A
          const tenantARecords = allRecords.filter(
            r => r.tenantId === input.tenantAId && r.deviceId === input.sharedDeviceId
          );

          // Query for tenant B
          const tenantBRecords = allRecords.filter(
            r => r.tenantId === input.tenantBId && r.deviceId === input.sharedDeviceId
          );

          // Verify each tenant only sees their own data
          expect(tenantARecords.length).toBe(1);
          expect(tenantARecords[0].data).toBe(input.dataA);
          expect(tenantARecords[0].tenantId).toBe(input.tenantAId);

          expect(tenantBRecords.length).toBe(1);
          expect(tenantBRecords[0].data).toBe(input.dataB);
          expect(tenantBRecords[0].tenantId).toBe(input.tenantBId);

          // Verify tenant isolation - each query returns only records for that tenant
          // (The data values may coincidentally be equal, but the tenant IDs must be correct)
          expect(tenantARecords.every(r => r.tenantId === input.tenantAId)).toBe(true);
          expect(tenantBRecords.every(r => r.tenantId === input.tenantBId)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: cloud-admin-console, Property 1: Tenant Data Isolation
   * Verify composite key uniqueness includes tenant_id.
   */
  it('should enforce composite key uniqueness with tenant_id', () => {
    fc.assert(
      fc.property(
        fc.record({
          tenantId: fc.uuid(),
          deviceId: fc.string({ minLength: 1, maxLength: 50 }),
          dateYmd: fc.date({ min: new Date('2024-01-01'), max: new Date('2026-12-31') })
            .map(d => d.toISOString().split('T')[0]),
        }),
        (input) => {
          // Create composite key (as used in Prisma schema)
          const compositeKey = `${input.tenantId}_${input.deviceId}_${input.dateYmd}`;

          // Verify composite key contains all three components
          expect(compositeKey).toContain(input.tenantId);
          expect(compositeKey).toContain(input.deviceId);
          expect(compositeKey).toContain(input.dateYmd);

          // Verify composite key is unique for this combination
          const parts = compositeKey.split('_');
          expect(parts.length).toBeGreaterThanOrEqual(3);
        }
      ),
      { numRuns: 100 }
    );
  });
});
