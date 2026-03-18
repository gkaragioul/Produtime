/**
 * Performance Service for Admin Console
 * Computes performance metrics, risk scores, and insights
 * 
 * COMPLIANCE: This is NOT spyware.
 * - Only processes aggregated stats
 * - No raw window titles or surveillance features
 * - All data is privacy-respecting
 */

import { AdminDatabase } from './db';
import {
  PolicyExpectations,
  DEFAULT_POLICY_EXPECTATIONS,
  PerformanceMetrics,
  DeltaMetrics,
  DeviceListItemEnhanced,
  AttentionGroup,
  AttentionResponse,
  AttentionTopOffender,
  AttentionType,
  DashboardStory,
  DashboardMode,
  DashboardModeInfo,
  ExpectedWindow,
  RankingsResponse,
  RankingEntry,
  TrendsResponse,
  TrendPoint,
  DeviceStatusType,
  TopAppEntry,
  computeExpectedSecondsSoFar,
  computeExpectedTotalSeconds,
  computeStartDelay,
  computeRiskScore,
  isBusinessHours,
  isPastMidday,
  getTodayYmd,
  getDateNDaysAgo,
  secondsToShort,
  parseTimeToMinutes,
  getCurrentMinutes,
  determineDashboardMode,
} from '../shared/dashboard-types';

export class PerformanceService {
  private db: AdminDatabase;

  constructor(db: AdminDatabase) {
    this.db = db;
  }

  /**
   * Get policy expectations for a device (or defaults)
   */
  private getPolicyExpectations(policyId: string | null): PolicyExpectations {
    if (!policyId) {
      return DEFAULT_POLICY_EXPECTATIONS;
    }
    
    const policy = this.db.getPolicy(policyId);
    if (!policy) {
      return DEFAULT_POLICY_EXPECTATIONS;
    }
    
    try {
      const policyData = JSON.parse(policy.policy_json);
      return {
        workStart: policyData.workStart || DEFAULT_POLICY_EXPECTATIONS.workStart,
        workEnd: policyData.workEnd || DEFAULT_POLICY_EXPECTATIONS.workEnd,
        lateGraceMinutes: policyData.lateGraceMinutes ?? DEFAULT_POLICY_EXPECTATIONS.lateGraceMinutes,
        expectedActiveMinutesPerDay: policyData.expectedActiveMinutesPerDay ?? null,
        maxIdleMinutesPerDay: policyData.maxIdleMinutesPerDay ?? DEFAULT_POLICY_EXPECTATIONS.maxIdleMinutesPerDay,
        maxUntrackedMinutesPerDay: policyData.maxUntrackedMinutesPerDay ?? DEFAULT_POLICY_EXPECTATIONS.maxUntrackedMinutesPerDay,
        minActiveMinutesByMidday: policyData.minActiveMinutesByMidday ?? DEFAULT_POLICY_EXPECTATIONS.minActiveMinutesByMidday,
      };
    } catch {
      return DEFAULT_POLICY_EXPECTATIONS;
    }
  }

  /**
   * Compute 7-day averages for a device
   */
  private compute7DayAverages(deviceId: string): { avgActive: number; avgIdle: number; avgUntracked: number } {
    const todayYmd = getTodayYmd();
    const startDate = getDateNDaysAgo(7); // Last 7 days excluding today
    const metrics = this.db.getDeviceDailyMetricsRange(deviceId, startDate, getDateNDaysAgo(1));
    
    if (metrics.length === 0) {
      return { avgActive: 0, avgIdle: 0, avgUntracked: 0 };
    }
    
    let totalActive = 0, totalIdle = 0, totalUntracked = 0;
    for (const m of metrics) {
      totalActive += m.active_seconds || 0;
      totalIdle += m.idle_seconds || 0;
      totalUntracked += m.untracked_seconds || 0;
    }
    
    return {
      avgActive: totalActive / metrics.length,
      avgIdle: totalIdle / metrics.length,
      avgUntracked: totalUntracked / metrics.length,
    };
  }

  /**
   * Compute delta metrics for a device
   */
  private computeDeltas(
    todayActive: number,
    todayIdle: number,
    todayUntracked: number,
    avg7d: { avgActive: number; avgIdle: number; avgUntracked: number }
  ): DeltaMetrics {
    const safeDiv = (a: number, b: number) => b > 0 ? (a - b) / b : 0;
    
    return {
      avgActiveSeconds7d: avg7d.avgActive,
      avgIdleSeconds7d: avg7d.avgIdle,
      avgUntrackedSeconds7d: avg7d.avgUntracked,
      deltaActivePct: safeDiv(todayActive, avg7d.avgActive),
      deltaIdlePct: safeDiv(todayIdle, avg7d.avgIdle),
      deltaUntrackedPct: safeDiv(todayUntracked, avg7d.avgUntracked),
    };
  }

  /**
   * Compute performance metrics for a device
   */
  public computePerformanceMetrics(
    deviceId: string,
    status: DeviceStatusType,
    trackingRunning: boolean,
    todayMetrics: {
      activeSeconds: number;
      idleSeconds: number;
      untrackedSeconds: number;
      firstActivityTs: number | null;
    },
    policyId: string | null
  ): PerformanceMetrics {
    const expectations = this.getPolicyExpectations(policyId);
    const now = new Date();
    
    const expectedSecondsSoFar = computeExpectedSecondsSoFar(expectations, now);
    const expectedTotalSeconds = computeExpectedTotalSeconds(expectations);
    const startDelaySeconds = computeStartDelay(todayMetrics.firstActivityTs, expectations, now);
    
    // Progress percentage
    const progressPct = expectedSecondsSoFar > 0 
      ? todayMetrics.activeSeconds / expectedSecondsSoFar 
      : 0;
    
    // Percentages
    const untrackedPct = expectedSecondsSoFar > 0 
      ? todayMetrics.untrackedSeconds / expectedSecondsSoFar 
      : 0;
    const idlePct = expectedSecondsSoFar > 0 
      ? todayMetrics.idleSeconds / expectedSecondsSoFar 
      : 0;
    
    // Risk assessment
    const risk = computeRiskScore({
      isOffline: status === 'offline',
      isTrackingOff: !trackingRunning,
      untrackedSeconds: todayMetrics.untrackedSeconds,
      maxUntrackedSeconds: expectations.maxUntrackedMinutesPerDay * 60,
      idleSeconds: todayMetrics.idleSeconds,
      maxIdleSeconds: expectations.maxIdleMinutesPerDay * 60,
      startDelaySeconds,
      activeSeconds: todayMetrics.activeSeconds,
      minActiveByMidday: expectations.minActiveMinutesByMidday,
      isPastMidday: isPastMidday(),
      isBusinessHours: isBusinessHours(expectations),
    });
    
    return {
      expectedSecondsSoFar,
      expectedTotalSeconds,
      progressPct,
      startDelaySeconds,
      untrackedPct,
      idlePct,
      risk,
    };
  }

  /**
   * Get enhanced device list with performance metrics
   */
  public getDevicesListEnhanced(): DeviceListItemEnhanced[] {
    const devices = this.db.getAllDevices();
    const todayYmd = getTodayYmd();
    const now = Date.now();
    const result: DeviceListItemEnhanced[] = [];

    for (const device of devices) {
      const status = this.db.getDeviceStatus(device.device_id);
      const metrics = this.db.getDeviceDailyMetrics(device.device_id, todayYmd);
      const policy = device.policy_id ? this.db.getPolicy(device.policy_id) : null;

      // Determine device status
      let deviceStatus: DeviceStatusType = 'offline';
      let lastSeenTs = device.last_seen;
      let trackingRunning = true;
      
      if (status) {
        deviceStatus = status.status as DeviceStatusType;
        lastSeenTs = status.last_seen_ts;
        trackingRunning = Boolean(status.tracking_running);
      } else {
        const timeSinceLastSeen = now - device.last_seen;
        if (device.status === 'online' && timeSinceLastSeen < 120000) {
          deviceStatus = 'online';
        } else if (timeSinceLastSeen < 120000) {
          deviceStatus = 'online';
        }
      }

      // Policy compliance
      let policyCompliant = true;
      if (policy && status?.policy_hash) {
        const expectedHash = this.computePolicyHash(policy.policy_json);
        policyCompliant = status.policy_hash === expectedHash;
      }

      // Parse top apps
      let topAppsToday: TopAppEntry[] = [];
      if (metrics?.top_apps_json) {
        try {
          topAppsToday = JSON.parse(metrics.top_apps_json);
        } catch {}
      }

      // Today's metrics
      const todayMetrics = {
        productiveSeconds: metrics?.productive_seconds || 0,
        unproductiveSeconds: metrics?.unproductive_seconds || 0,
        idleSeconds: metrics?.idle_seconds || 0,
        untrackedSeconds: metrics?.untracked_seconds || 0,
        activeSeconds: metrics?.active_seconds || 0,
        firstActivityTs: metrics?.first_activity_ts || null,
        lastActivityTs: metrics?.last_activity_ts || null,
      };

      // Compute performance metrics
      const performance = this.computePerformanceMetrics(
        device.device_id,
        deviceStatus,
        trackingRunning,
        todayMetrics,
        device.policy_id || null
      );

      // Compute 7-day averages and deltas
      const avg7d = this.compute7DayAverages(device.device_id);
      const deltas = this.computeDeltas(
        todayMetrics.activeSeconds,
        todayMetrics.idleSeconds,
        todayMetrics.untrackedSeconds,
        avg7d
      );

      const expectations = this.getPolicyExpectations(device.policy_id || null);

      result.push({
        deviceId: device.device_id,
        deviceName: device.device_name,
        status: deviceStatus,
        lastSeenTs,
        appVersion: status?.app_version || device.app_version || '',
        today: todayMetrics,
        topAppsToday,
        policy: {
          id: device.policy_id || null,
          name: policy?.name || null,
          compliant: policyCompliant,
        },
        expected: {
          expectedSoFarSeconds: performance.expectedSecondsSoFar,
          expectedTotalSeconds: performance.expectedTotalSeconds,
        },
        performance,
        deltas,
      });
    }

    // Sort by risk score descending (worst first)
    result.sort((a, b) => b.performance.risk.score - a.performance.risk.score);

    return result;
  }

  /**
   * Compute dashboard mode and expected window
   */
  private computeDashboardModeInfo(devices: DeviceListItemEnhanced[]): { modeInfo: DashboardModeInfo; expected: ExpectedWindow } {
    const now = new Date();
    const currentMinutes = getCurrentMinutes();
    const expectations = DEFAULT_POLICY_EXPECTATIONS;
    const workStartMinutes = parseTimeToMinutes(expectations.workStart);
    const workEndMinutes = parseTimeToMinutes(expectations.workEnd);
    
    const withinWorkHours = currentMinutes >= workStartMinutes && currentMinutes < workEndMinutes;
    const minutesIntoShift = withinWorkHours ? currentMinutes - workStartMinutes : 0;
    
    // Check if any device has received a heartbeat today
    const todayYmd = getTodayYmd();
    let anyHeartbeatToday = false;
    for (const device of devices) {
      const metrics = this.db.getDeviceDailyMetrics(device.deviceId, todayYmd);
      if (metrics && (metrics.active_seconds > 0 || metrics.idle_seconds > 0 || metrics.last_activity_ts)) {
        anyHeartbeatToday = true;
        break;
      }
      // Also check if device was seen today
      if (device.lastSeenTs > 0) {
        const lastSeenDate = new Date(device.lastSeenTs).toISOString().split('T')[0];
        if (lastSeenDate === todayYmd) {
          anyHeartbeatToday = true;
          break;
        }
      }
    }
    
    // Compute team totals
    let teamExpectedSoFar = 0;
    let teamActiveSeconds = 0;
    for (const device of devices) {
      teamExpectedSoFar += device.expected.expectedSoFarSeconds;
      teamActiveSeconds += device.today.activeSeconds;
    }
    
    const modeInfo = determineDashboardMode({
      devicesCount: devices.length,
      onlineCount: devices.filter(d => d.status === 'online').length,
      anyHeartbeatToday,
      teamExpectedSoFarSeconds: teamExpectedSoFar,
      teamActiveSecondsToday: teamActiveSeconds,
      withinWorkHours,
      minutesIntoShift,
    });
    
    const expected: ExpectedWindow = {
      workStart: expectations.workStart,
      workEnd: expectations.workEnd,
      expectedTotalSeconds: computeExpectedTotalSeconds(expectations),
      expectedSoFarSeconds: computeExpectedSecondsSoFar(expectations, now),
      mixedPolicies: (() => {
        const allDevices = this.db.getAllDevices();
        const distinctPolicyIds = new Set(
          allDevices.map(d => d.policy_id).filter((id): id is string => id != null)
        );
        return distinctPolicyIds.size >= 2;
      })()
    };
    
    return { modeInfo, expected };
  }

  /**
   * Get attention groups (categorized exceptions) with top offenders - MODE AWARE
   */
  public getAttentionGroups(modeInfo?: DashboardModeInfo): AttentionResponse {
    const devices = this.getDevicesListEnhanced();
    const now = Date.now();
    
    // If no mode info provided, compute it
    if (!modeInfo) {
      const computed = this.computeDashboardModeInfo(devices);
      modeInfo = computed.modeInfo;
    }
    
    // For NO_DEVICES or NO_DATA_YET, return empty
    if (modeInfo.mode === 'NO_DEVICES') {
      return { groups: [], totalCount: 0 };
    }
    
    // Group definitions with severity
    const groupDefs: Array<{ type: AttentionType; label: string; baseSeverity: 'crit' | 'warn' | 'info' }> = [
      { type: 'offline', label: 'Offline During Hours', baseSeverity: 'crit' },
      { type: 'tracking_off', label: 'Tracking Off', baseSeverity: 'crit' },
      { type: 'policy_drift', label: 'Policy Drift', baseSeverity: 'warn' },
      { type: 'late_start', label: 'Late Start', baseSeverity: 'warn' },
      { type: 'high_untracked', label: 'High Untracked', baseSeverity: 'warn' },
      { type: 'high_idle', label: 'High Idle', baseSeverity: 'warn' },
      { type: 'low_progress', label: 'Low Progress', baseSeverity: 'warn' },
    ];
    
    // Initialize groups
    const groups: Map<AttentionType, AttentionGroup> = new Map();
    for (const def of groupDefs) {
      groups.set(def.type, {
        type: def.type,
        label: def.label,
        severity: def.baseSeverity,
        count: 0,
        deviceIds: [],
        preview: [],
        top: [],
      });
    }
    
    // For IN_SHIFT_NO_ACTIVITY, add all devices to LOW_PROGRESS
    if (modeInfo.mode === 'IN_SHIFT_NO_ACTIVITY') {
      const group = groups.get('low_progress')!;
      for (const device of devices) {
        if (device.status !== 'offline') {
          const deficitSeconds = device.expected.expectedSoFarSeconds;
          this.addToGroup(group, device, deficitSeconds, '0% progress');
        }
      }
    }
    
    // Process each device for other attention types
    for (const device of devices) {
      const expectations = this.getPolicyExpectations(device.policy.id);
      const withinWorkHours = isBusinessHours(expectations);
      const status = this.db.getDeviceStatus(device.deviceId);
      const trackingRunning = status?.tracking_running ?? true;
      
      // Skip attention checks for PRE_SHIFT mode (except policy drift)
      if (modeInfo.mode === 'PRE_SHIFT') {
        // Only check policy drift in pre-shift
        if (!device.policy.compliant && device.policy.id) {
          const group = groups.get('policy_drift')!;
          this.addToGroup(group, device, 1, 'policy mismatch');
        }
        continue;
      }
      
      // OFFLINE_DURING_HOURS: offline and within work hours
      if (withinWorkHours && device.status === 'offline') {
        const group = groups.get('offline')!;
        const secondsSinceLastSeen = Math.floor((now - device.lastSeenTs) / 1000);
        this.addToGroup(group, device, secondsSinceLastSeen, this.formatDuration(secondsSinceLastSeen) + ' ago');
      }
      
      // TRACKING_OFF: tracking not running during work hours
      if (withinWorkHours && !trackingRunning && device.status !== 'offline') {
        const group = groups.get('tracking_off')!;
        this.addToGroup(group, device, 1, 'during work hours');
      }
      
      // POLICY_DRIFT: policy not compliant
      if (!device.policy.compliant && device.policy.id) {
        const group = groups.get('policy_drift')!;
        this.addToGroup(group, device, 1, 'policy mismatch');
      }
      
      // LATE_START: started late or no activity after grace period
      if (device.performance.startDelaySeconds > 0 && modeInfo.mode !== 'IN_SHIFT_NO_ACTIVITY') {
        const group = groups.get('late_start')!;
        const delayMin = Math.floor(device.performance.startDelaySeconds / 60);
        this.addToGroup(group, device, device.performance.startDelaySeconds, `${delayMin}m late`);
      }
      
      // HIGH_UNTRACKED: untracked exceeds max
      const maxUntrackedSeconds = expectations.maxUntrackedMinutesPerDay * 60;
      if (device.today.untrackedSeconds > maxUntrackedSeconds) {
        const group = groups.get('high_untracked')!;
        const overageMin = Math.floor((device.today.untrackedSeconds - maxUntrackedSeconds) / 60);
        // Escalate to crit if > 2x max
        if (device.today.untrackedSeconds > maxUntrackedSeconds * 2) {
          group.severity = 'crit';
        }
        this.addToGroup(group, device, device.today.untrackedSeconds, `${overageMin}m over limit`);
      }
      
      // HIGH_IDLE: idle exceeds max
      const maxIdleSeconds = expectations.maxIdleMinutesPerDay * 60;
      if (device.today.idleSeconds > maxIdleSeconds) {
        const group = groups.get('high_idle')!;
        const overageMin = Math.floor((device.today.idleSeconds - maxIdleSeconds) / 60);
        this.addToGroup(group, device, device.today.idleSeconds, `${overageMin}m over limit`);
      }
      
      // LOW_PROGRESS: below expected by midday (skip if already handled by IN_SHIFT_NO_ACTIVITY)
      if (modeInfo.mode === 'NORMAL' && isPastMidday() && device.performance.progressPct < 0.5 && device.status !== 'offline') {
        const group = groups.get('low_progress')!;
        const deficitSeconds = device.expected.expectedSoFarSeconds - device.today.activeSeconds;
        const deficitMin = Math.floor(deficitSeconds / 60);
        this.addToGroup(group, device, deficitSeconds, `${Math.round(device.performance.progressPct * 100)}% (${deficitMin}m behind)`);
      }
    }
    
    // Filter non-empty groups, sort top offenders, and sort groups
    const severityOrder = { crit: 0, warn: 1, info: 2 };
    const nonEmptyGroups = Array.from(groups.values())
      .filter(g => g.count > 0)
      .map(g => {
        // Sort top offenders by valueNumber desc and limit to 3
        g.top.sort((a, b) => b.valueNumber - a.valueNumber);
        g.top = g.top.slice(0, 3);
        return g;
      })
      .sort((a, b) => {
        // Sort by severity first, then by count, then by top offender value
        const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
        if (sevDiff !== 0) return sevDiff;
        const countDiff = b.count - a.count;
        if (countDiff !== 0) return countDiff;
        const aTopVal = a.top[0]?.valueNumber || 0;
        const bTopVal = b.top[0]?.valueNumber || 0;
        return bTopVal - aTopVal;
      });
    
    return {
      groups: nonEmptyGroups,
      totalCount: nonEmptyGroups.reduce((sum, g) => sum + g.count, 0),
    };
  }

  /**
   * Helper to add device to attention group
   */
  private addToGroup(
    group: AttentionGroup,
    device: DeviceListItemEnhanced,
    valueNumber: number,
    valueLabel: string
  ): void {
    if (!group.deviceIds.includes(device.deviceId)) {
      group.count++;
      group.deviceIds.push(device.deviceId);
      group.preview.push({
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        value: valueLabel,
      });
      group.top.push({
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        valueLabel,
        valueNumber,
      });
    }
  }

  /**
   * Format duration in seconds to human-readable string
   */
  private formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  }

  /**
   * Generate dashboard story (Today's narrative) - MODE AWARE with health score caps
   */
  public getDashboardStory(): DashboardStory {
    const devices = this.getDevicesListEnhanced();
    const { modeInfo, expected } = this.computeDashboardModeInfo(devices);
    const attention = this.getAttentionGroups(modeInfo);
    
    // Count by risk label and status
    let criticalCount = 0, atRiskCount = 0, onTrackCount = 0;
    let onlineCount = 0, idleCount = 0, offlineCount = 0;
    let totalRiskScore = 0;
    let maxRiskScore = 0;
    let totalActiveSeconds = 0;
    let totalExpectedSoFar = 0;
    let devicesInScope = 0;
    
    for (const device of devices) {
      const expectations = this.getPolicyExpectations(device.policy.id);
      const withinWorkHours = isBusinessHours(expectations);
      
      // Count status
      switch (device.status) {
        case 'online': onlineCount++; break;
        case 'idle': idleCount++; break;
        case 'offline': offlineCount++; break;
      }
      
      // Only count risk for devices within work hours or online
      if (withinWorkHours || device.status !== 'offline') {
        totalRiskScore += device.performance.risk.score;
        maxRiskScore = Math.max(maxRiskScore, device.performance.risk.score);
        devicesInScope++;
      }
      
      totalActiveSeconds += device.today.activeSeconds;
      totalExpectedSoFar += device.expected.expectedSoFarSeconds;
      
      switch (device.performance.risk.label) {
        case 'critical': criticalCount++; break;
        case 'at_risk': atRiskCount++; break;
        case 'on_track': onTrackCount++; break;
      }
    }
    
    // Check for 7-day history
    const todayYmd = getTodayYmd();
    const startDate = getDateNDaysAgo(7);
    const teamHistory = this.db.getTeamDailyMetricsRange(startDate, getDateNDaysAgo(1));
    const hasHistory7d = teamHistory.length > 0;
    
    // Check for top apps today
    let hasTopAppsToday = false;
    for (const device of devices) {
      if (device.topAppsToday && device.topAppsToday.length > 0) {
        hasTopAppsToday = true;
        break;
      }
    }
    
    // MODE-SPECIFIC HANDLING
    const mode = modeInfo.mode;
    
    // NO_DEVICES mode
    if (mode === 'NO_DEVICES') {
      return {
        mode,
        healthScore: null,
        healthLabel: null,
        managerSentence: 'No devices paired yet.',
        bullets: ['Pair a device to begin tracking.'],
        progress: {
          expectedSecondsSoFarTeam: 0,
          activeSecondsTeam: 0,
          progressPctTeam: null,
        },
        expected,
        highlights: { criticalCount: 0, atRiskCount: 0, onTrackCount: 0, online: 0, idle: 0, offline: 0 },
        hasHistory7d: false,
        hasTopAppsToday: false,
      };
    }
    
    // NO_DATA_YET mode
    if (mode === 'NO_DATA_YET') {
      return {
        mode,
        healthScore: null,
        healthLabel: null,
        managerSentence: 'Waiting for first device data (no heartbeats yet today).',
        bullets: [
          `${devices.length} device${devices.length !== 1 ? 's' : ''} paired.`,
          `${onlineCount} online, ${idleCount} idle, ${offlineCount} offline.`,
          'Data will appear once devices start reporting.',
        ],
        progress: {
          expectedSecondsSoFarTeam: totalExpectedSoFar,
          activeSecondsTeam: 0,
          progressPctTeam: null,
        },
        expected,
        highlights: { criticalCount: 0, atRiskCount: 0, onTrackCount: 0, online: onlineCount, idle: idleCount, offline: offlineCount },
        hasHistory7d,
        hasTopAppsToday: false,
      };
    }
    
    // PRE_SHIFT mode
    if (mode === 'PRE_SHIFT') {
      return {
        mode,
        healthScore: 100,
        healthLabel: 'healthy',
        managerSentence: `Pre-shift: work window starts at ${expected.workStart}.`,
        bullets: [
          `${onlineCount} device${onlineCount !== 1 ? 's' : ''} online, ${idleCount} idle, ${offlineCount} offline.`,
          `Work window: ${expected.workStart}–${expected.workEnd}.`,
        ],
        progress: {
          expectedSecondsSoFarTeam: 0,
          activeSecondsTeam: totalActiveSeconds,
          progressPctTeam: null,
        },
        expected,
        highlights: { criticalCount: 0, atRiskCount: 0, onTrackCount: devices.length, online: onlineCount, idle: idleCount, offline: offlineCount },
        hasHistory7d,
        hasTopAppsToday,
      };
    }
    
    // IN_SHIFT_NO_ACTIVITY mode
    if (mode === 'IN_SHIFT_NO_ACTIVITY') {
      return {
        mode,
        healthScore: 70,  // Capped at 85 max, but lower due to no activity
        healthLabel: 'watch',
        managerSentence: 'Behind schedule: no active time recorded yet.',
        bullets: [
          `${onlineCount} device${onlineCount !== 1 ? 's' : ''} online, ${idleCount} idle, ${offlineCount} offline.`,
          'Team progress: 0% of expected work completed.',
          'If tracking just started, this may update within a minute.',
        ],
        progress: {
          expectedSecondsSoFarTeam: totalExpectedSoFar,
          activeSecondsTeam: 0,
          progressPctTeam: 0,
        },
        expected,
        highlights: { criticalCount: 0, atRiskCount: devices.length, onTrackCount: 0, online: onlineCount, idle: idleCount, offline: offlineCount },
        hasHistory7d,
        hasTopAppsToday: false,
      };
    }
    
    // NORMAL mode - full health score computation
    const avgRiskScore = devicesInScope > 0 ? totalRiskScore / devicesInScope : 0;
    let healthScore = Math.round(100 - (avgRiskScore * 0.55 + maxRiskScore * 0.45));
    
    // Apply attention penalties
    for (const group of attention.groups) {
      if (group.severity === 'crit') {
        healthScore -= 10 + (group.count * 3);
      } else if (group.severity === 'warn') {
        healthScore -= 5 + (group.count * 2);
      }
    }
    
    // Clamp to 0-100
    healthScore = Math.max(0, Math.min(100, healthScore));
    
    // CRITICAL: Apply consistency caps
    const hasCritGroup = attention.groups.some(g => g.severity === 'crit');
    const hasWarnGroup = attention.groups.some(g => g.severity === 'warn');
    const hasCritDevice = criticalCount > 0;
    
    if (hasCritGroup || hasCritDevice) {
      healthScore = Math.min(healthScore, 85);
    } else if (hasWarnGroup) {
      healthScore = Math.min(healthScore, 95);
    }
    
    // If ANY attention items exist, cannot be 100
    if (attention.totalCount > 0) {
      healthScore = Math.min(healthScore, 95);
    }
    
    // Health label
    let healthLabel: 'healthy' | 'watch' | 'at_risk';
    if (healthScore >= 85) {
      healthLabel = 'healthy';
    } else if (healthScore >= 60) {
      healthLabel = 'watch';
    } else {
      healthLabel = 'at_risk';
    }
    
    // Progress
    const progressPctTeam = totalExpectedSoFar > 0 
      ? totalActiveSeconds / totalExpectedSoFar 
      : 0;
    
    // Generate manager sentence
    const managerSentence = this.generateManagerSentence(
      attention,
      progressPctTeam,
      criticalCount,
      atRiskCount,
      devices,
      modeInfo
    );
    
    // Generate bullets
    const bullets: string[] = [];
    
    // Status summary
    bullets.push(`${onlineCount} device${onlineCount !== 1 ? 's' : ''} online, ${idleCount} idle, ${offlineCount} offline.`);
    
    // Progress
    bullets.push(`Team progress: ${Math.round(progressPctTeam * 100)}% of expected work completed.`);
    
    // Critical devices
    if (criticalCount > 0) {
      const criticalDevices = devices.filter(d => d.performance.risk.label === 'critical');
      const names = criticalDevices.slice(0, 2).map(d => d.deviceName).join(', ');
      bullets.push(`${criticalCount} Critical: ${names}${criticalCount > 2 ? '...' : ''}`);
    }
    
    // At risk count
    if (atRiskCount > 0 && criticalCount === 0) {
      bullets.push(`${atRiskCount} device${atRiskCount !== 1 ? 's' : ''} at risk — may need attention.`);
    }
    
    // Untracked delta
    const avgUntrackedDelta = devices.length > 0
      ? devices.reduce((sum, d) => sum + d.deltas.deltaUntrackedPct, 0) / devices.length
      : 0;
    if (Math.abs(avgUntrackedDelta) > 0.1) {
      const direction = avgUntrackedDelta > 0 ? 'HIGH' : 'LOW';
      const sign = avgUntrackedDelta > 0 ? '+' : '';
      bullets.push(`Untracked is ${direction} (${sign}${Math.round(avgUntrackedDelta * 100)}% vs 7-day avg).`);
    }
    
    return {
      mode,
      healthScore,
      healthLabel,
      managerSentence,
      bullets: bullets.slice(0, 5),
      progress: {
        expectedSecondsSoFarTeam: totalExpectedSoFar,
        activeSecondsTeam: totalActiveSeconds,
        progressPctTeam,
      },
      expected,
      highlights: {
        criticalCount,
        atRiskCount,
        onTrackCount,
        online: onlineCount,
        idle: idleCount,
        offline: offlineCount,
      },
      hasHistory7d,
      hasTopAppsToday,
    };
  }

  /**
   * Generate manager sentence - single strong conclusion line (MODE AWARE)
   */
  private generateManagerSentence(
    attention: AttentionResponse,
    progressPctTeam: number,
    criticalCount: number,
    atRiskCount: number,
    devices: DeviceListItemEnhanced[],
    modeInfo: DashboardModeInfo
  ): string {
    // Rule 1: If any crit group, pick top crit group and top offender
    const critGroups = attention.groups.filter(g => g.severity === 'crit');
    if (critGroups.length > 0) {
      const topCritGroup = critGroups[0];
      const topOffender = topCritGroup.top[0];
      if (topOffender) {
        return `At risk: ${topCritGroup.label} — ${topOffender.deviceName} (${topOffender.valueLabel}).`;
      }
      return `At risk: ${topCritGroup.label} affecting ${topCritGroup.count} device${topCritGroup.count !== 1 ? 's' : ''}.`;
    }
    
    // Rule 2: If progress < 60% and within work hours
    if (modeInfo.withinWorkHours && progressPctTeam < 0.6) {
      return `Behind schedule: team progress is ${Math.round(progressPctTeam * 100)}% for this time of day.`;
    }
    
    // Rule 3: If warn groups exist
    const warnGroups = attention.groups.filter(g => g.severity === 'warn');
    if (warnGroups.length > 0) {
      const topWarnGroup = warnGroups[0];
      return `Watch: ${topWarnGroup.label} affecting ${topWarnGroup.count} device${topWarnGroup.count !== 1 ? 's' : ''}.`;
    }
    
    // Rule 4: Healthy
    if (devices.length === 0) {
      return 'No devices paired yet.';
    }
    
    return 'Healthy: no tracking or attendance issues detected.';
  }

  /**
   * Get rankings
   */
  public getRankings(): RankingsResponse {
    const devices = this.getDevicesListEnhanced();
    
    // Most Active (top 3)
    const mostActive: RankingEntry[] = [...devices]
      .sort((a, b) => b.today.activeSeconds - a.today.activeSeconds)
      .slice(0, 3)
      .map(d => ({
        deviceId: d.deviceId,
        deviceName: d.deviceName,
        value: d.today.activeSeconds,
        deltaPct: d.deltas.deltaActivePct,
      }));
    
    // Most Untracked (top 3)
    const mostUntracked: RankingEntry[] = [...devices]
      .sort((a, b) => b.today.untrackedSeconds - a.today.untrackedSeconds)
      .slice(0, 3)
      .filter(d => d.today.untrackedSeconds > 0)
      .map(d => ({
        deviceId: d.deviceId,
        deviceName: d.deviceName,
        value: d.today.untrackedSeconds,
        deltaPct: d.deltas.deltaUntrackedPct,
      }));
    
    // Biggest Improvement (active delta best)
    const biggestImprovement: RankingEntry[] = [...devices]
      .filter(d => d.deltas.avgActiveSeconds7d > 0)
      .sort((a, b) => b.deltas.deltaActivePct - a.deltas.deltaActivePct)
      .slice(0, 3)
      .filter(d => d.deltas.deltaActivePct > 0)
      .map(d => ({
        deviceId: d.deviceId,
        deviceName: d.deviceName,
        value: d.today.activeSeconds,
        deltaPct: d.deltas.deltaActivePct,
      }));
    
    // Biggest Regression (untracked delta worst)
    const biggestRegression: RankingEntry[] = [...devices]
      .filter(d => d.deltas.avgUntrackedSeconds7d > 0)
      .sort((a, b) => b.deltas.deltaUntrackedPct - a.deltas.deltaUntrackedPct)
      .slice(0, 3)
      .filter(d => d.deltas.deltaUntrackedPct > 0.1)
      .map(d => ({
        deviceId: d.deviceId,
        deviceName: d.deviceName,
        value: d.today.untrackedSeconds,
        deltaPct: d.deltas.deltaUntrackedPct,
      }));
    
    return {
      mostActive,
      mostUntracked,
      biggestImprovement,
      biggestRegression,
    };
  }

  /**
   * Get trends data
   */
  public getTrends(scope: 'team' | 'device', deviceId?: string, days: number = 7): TrendsResponse {
    const todayYmd = getTodayYmd();
    const startDate = getDateNDaysAgo(days - 1);
    
    let points: TrendPoint[] = [];
    
    if (scope === 'team') {
      const data = this.db.getTeamDailyMetricsRange(startDate, todayYmd);
      points = data.map(d => ({
        date: d.date_ymd,
        activeSeconds: d.active_seconds || 0,
        idleSeconds: d.idle_seconds || 0,
        untrackedSeconds: d.untracked_seconds || 0,
      }));
    } else if (deviceId) {
      const data = this.db.getDeviceDailyMetricsRange(deviceId, startDate, todayYmd);
      points = data.map(d => ({
        date: d.date_ymd,
        activeSeconds: d.active_seconds || 0,
        idleSeconds: d.idle_seconds || 0,
        untrackedSeconds: d.untracked_seconds || 0,
      }));
    }
    
    // Compute deltas (this week vs last week)
    const midpoint = Math.floor(points.length / 2);
    const firstHalf = points.slice(0, midpoint);
    const secondHalf = points.slice(midpoint);
    
    const sumFirst = firstHalf.reduce((acc, p) => ({
      active: acc.active + p.activeSeconds,
      idle: acc.idle + p.idleSeconds,
      untracked: acc.untracked + p.untrackedSeconds,
    }), { active: 0, idle: 0, untracked: 0 });
    
    const sumSecond = secondHalf.reduce((acc, p) => ({
      active: acc.active + p.activeSeconds,
      idle: acc.idle + p.idleSeconds,
      untracked: acc.untracked + p.untrackedSeconds,
    }), { active: 0, idle: 0, untracked: 0 });
    
    const safeDiv = (a: number, b: number) => b > 0 ? (a - b) / b : 0;
    
    return {
      points,
      deltas: {
        activePct: safeDiv(sumSecond.active, sumFirst.active),
        idlePct: safeDiv(sumSecond.idle, sumFirst.idle),
        untrackedPct: safeDiv(sumSecond.untracked, sumFirst.untracked),
      },
    };
  }

  /**
   * Compute policy hash
   */
  private computePolicyHash(policyJson: string): string {
    let hash = 0;
    for (let i = 0; i < policyJson.length; i++) {
      const char = policyJson.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }
}
