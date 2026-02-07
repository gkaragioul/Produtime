/**
 * Dashboard Service for Cloud Admin Console
 * Computes performance metrics, risk scores, attention groups, and dashboard story.
 * 
 * Requirements:
 * - 5.4: Support dashboard modes: NO_DEVICES, NO_DATA_YET, PRE_SHIFT, IN_SHIFT_NO_ACTIVITY, NORMAL
 * - 5.5: Compute health scores, attention groups, and manager sentences server-side
 * - 1.1, 5.3: Tenant data isolation - all queries filtered by tenant_id
 * 
 * COMPLIANCE: This is NOT spyware.
 * - Only processes aggregated stats
 * - No raw window titles or surveillance features
 * - All data is privacy-respecting
 */

import { PrismaClient, Device, DailyMetrics } from '@prisma/client';
import {
  PolicyExpectations,
  DEFAULT_POLICY_EXPECTATIONS,
  PerformanceMetrics,
  DeltaMetrics,
  DeviceListItemEnhanced,
  AttentionGroup,
  AttentionResponse,
  AttentionType,
  AttentionSeverity,
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
  DailyMetricsSummary,
  EnhancedHeartbeatPayload,
  computeExpectedSecondsSoFar,
  computeExpectedTotalSeconds,
  computeStartDelay,
  computeRiskScore,
  computeDeviceStatus,
  isBusinessHours,
  isPastMidday,
  getTodayYmd,
  getDateNDaysAgo,
  parseTimeToMinutes,
  getCurrentMinutes,
  determineDashboardMode,
} from './dashboard-types';
import { WebSocketManager, DashboardEvent } from './ws-manager';
import { PrivacyService } from './privacy-service';


// ============================================================================
// Dashboard Service Class
// ============================================================================

export class DashboardService {
  private prisma: PrismaClient;
  private wsManager?: WebSocketManager;

  constructor(prisma: PrismaClient, wsManager?: WebSocketManager) {
    this.prisma = prisma;
    this.wsManager = wsManager;
  }

  /**
   * Set the WebSocket manager for broadcasting events
   */
  setWebSocketManager(wsManager: WebSocketManager): void {
    this.wsManager = wsManager;
  }

  // ============================================================================
  // Heartbeat Ingestion (Requirement 5.5, 9.1, 9.2, 9.4)
  // ============================================================================

  /**
   * Ingest a heartbeat from an agent
   * Updates device status and metrics, stores daily metrics, broadcasts to admin subscribers
   * 
   * Requirements:
   * - 5.5: Compute health scores, attention groups, and manager sentences server-side
   * - 9.1: Only transmit aggregated metrics by default (no raw window titles)
   * - 9.2: When title sharing is disabled, never transmit or store window titles
   * - 9.4: Require explicit policy configuration to enable title sharing
   */
  async ingestHeartbeat(tenantId: string, heartbeat: EnhancedHeartbeatPayload): Promise<void> {
    const now = Date.now();
    const todayYmd = getTodayYmd();

    // Requirement 9.1, 9.2, 9.4: Check tenant's title sharing policy and strip titles if disabled
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    
    const titleSharingEnabled = PrivacyService.isTitleSharingEnabled(tenant?.settings ?? null);
    const sanitizedHeartbeat = PrivacyService.stripTitlesIfDisabled(heartbeat, titleSharingEnabled);

    // Compute device status
    const status = computeDeviceStatus(
      now,
      sanitizedHeartbeat.last15m.activeSeconds,
      sanitizedHeartbeat.last15m.idleSeconds
    );

    // Update device status
    await this.prisma.device.updateMany({
      where: {
        tenantId,
        deviceId: sanitizedHeartbeat.deviceId,
      },
      data: {
        status,
        lastSeenAt: new Date(),
        ip: sanitizedHeartbeat.ip,
        appVersion: sanitizedHeartbeat.appVersion,
      },
    });

    // Upsert daily metrics
    await this.prisma.dailyMetrics.upsert({
      where: {
        tenantId_deviceId_dateYmd: {
          tenantId,
          deviceId: sanitizedHeartbeat.deviceId,
          dateYmd: todayYmd,
        },
      },
      create: {
        tenantId,
        deviceId: sanitizedHeartbeat.deviceId,
        dateYmd: todayYmd,
        activeSeconds: sanitizedHeartbeat.today.activeSeconds,
        idleSeconds: sanitizedHeartbeat.today.idleSeconds,
        untrackedSeconds: sanitizedHeartbeat.today.untrackedSeconds,
        firstActivityTs: sanitizedHeartbeat.today.firstActivityTs ? BigInt(sanitizedHeartbeat.today.firstActivityTs) : null,
        lastActivityTs: sanitizedHeartbeat.today.lastActivityTs ? BigInt(sanitizedHeartbeat.today.lastActivityTs) : null,
        topAppsJson: JSON.stringify(sanitizedHeartbeat.topAppsToday),
      },
      update: {
        activeSeconds: sanitizedHeartbeat.today.activeSeconds,
        idleSeconds: sanitizedHeartbeat.today.idleSeconds,
        untrackedSeconds: sanitizedHeartbeat.today.untrackedSeconds,
        firstActivityTs: sanitizedHeartbeat.today.firstActivityTs ? BigInt(sanitizedHeartbeat.today.firstActivityTs) : null,
        lastActivityTs: sanitizedHeartbeat.today.lastActivityTs ? BigInt(sanitizedHeartbeat.today.lastActivityTs) : null,
        topAppsJson: JSON.stringify(sanitizedHeartbeat.topAppsToday),
      },
    });

    // Broadcast to admin subscribers
    if (this.wsManager) {
      this.wsManager.broadcastToAdmins(tenantId, {
        type: 'metrics_update',
        data: {
          deviceId: sanitizedHeartbeat.deviceId,
          status,
          today: sanitizedHeartbeat.today,
          last15m: sanitizedHeartbeat.last15m,
        },
        timestamp: now,
      });
    }
  }


  // ============================================================================
  // Device List with Performance Metrics
  // ============================================================================

  /**
   * Get enhanced device list with performance metrics for a tenant
   * Requirement 1.1, 5.3: All queries filtered by tenant_id
   */
  async getDevicesListEnhanced(tenantId: string): Promise<DeviceListItemEnhanced[]> {
    const todayYmd = getTodayYmd();
    const now = Date.now();

    // Get all devices for tenant
    const devices = await this.prisma.device.findMany({
      where: { tenantId, revoked: false },
    });

    // Get today's metrics for all devices
    const metricsMap = new Map<string, DailyMetrics>();
    const metrics = await this.prisma.dailyMetrics.findMany({
      where: { tenantId, dateYmd: todayYmd },
    });
    for (const m of metrics) {
      metricsMap.set(m.deviceId, m);
    }

    const result: DeviceListItemEnhanced[] = [];

    for (const device of devices) {
      const deviceMetrics = metricsMap.get(device.deviceId);
      
      // Determine device status
      let deviceStatus: DeviceStatusType = 'offline';
      let lastSeenTs = device.lastSeenAt?.getTime() || 0;
      
      if (device.lastSeenAt) {
        const timeSinceLastSeen = now - device.lastSeenAt.getTime();
        if (timeSinceLastSeen < 120000) {
          deviceStatus = device.status as DeviceStatusType || 'online';
        }
      }

      // Parse top apps
      let topAppsToday: TopAppEntry[] = [];
      if (deviceMetrics?.topAppsJson) {
        try {
          topAppsToday = JSON.parse(deviceMetrics.topAppsJson);
        } catch {}
      }

      // Today's metrics
      const todayMetrics: DailyMetricsSummary = {
        productiveSeconds: 0,
        unproductiveSeconds: 0,
        idleSeconds: deviceMetrics?.idleSeconds || 0,
        untrackedSeconds: deviceMetrics?.untrackedSeconds || 0,
        activeSeconds: deviceMetrics?.activeSeconds || 0,
        firstActivityTs: deviceMetrics?.firstActivityTs ? Number(deviceMetrics.firstActivityTs) : null,
        lastActivityTs: deviceMetrics?.lastActivityTs ? Number(deviceMetrics.lastActivityTs) : null,
      };

      // Compute performance metrics
      const performance = this.computePerformanceMetrics(
        device.deviceId,
        deviceStatus,
        true, // trackingRunning - assume true unless we have status info
        todayMetrics,
        device.policyId
      );

      // Compute 7-day averages and deltas
      const avg7d = await this.compute7DayAverages(tenantId, device.deviceId);
      const deltas = this.computeDeltas(
        todayMetrics.activeSeconds,
        todayMetrics.idleSeconds,
        todayMetrics.untrackedSeconds,
        avg7d
      );

      result.push({
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        status: deviceStatus,
        lastSeenTs,
        appVersion: device.appVersion || '',
        today: todayMetrics,
        topAppsToday,
        policy: {
          id: device.policyId || null,
          name: null, // Policy name would come from a policies table
          compliant: true, // Assume compliant unless we have policy drift info
        },
        expected: {
          expectedSoFarSeconds: performance.expectedSecondsSoFar,
          expectedTotalSeconds: performance.expectedTotalSeconds,
        },
        performance,
        deltas,
        trackingRunning: true,
      });
    }

    // Sort by risk score descending (worst first)
    result.sort((a, b) => b.performance.risk.score - a.performance.risk.score);

    return result;
  }


  // ============================================================================
  // Performance Metrics Computation
  // ============================================================================

  /**
   * Compute performance metrics for a device
   */
  private computePerformanceMetrics(
    deviceId: string,
    status: DeviceStatusType,
    trackingRunning: boolean,
    todayMetrics: DailyMetricsSummary,
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
   * Get policy expectations (defaults for now)
   */
  private getPolicyExpectations(policyId: string | null): PolicyExpectations {
    // For now, return defaults. In future, could load from policies table
    return DEFAULT_POLICY_EXPECTATIONS;
  }

  /**
   * Compute 7-day averages for a device
   */
  private async compute7DayAverages(tenantId: string, deviceId: string): Promise<{ avgActive: number; avgIdle: number; avgUntracked: number }> {
    const startDate = getDateNDaysAgo(7);
    const endDate = getDateNDaysAgo(1);
    
    const metrics = await this.prisma.dailyMetrics.findMany({
      where: {
        tenantId,
        deviceId,
        dateYmd: {
          gte: startDate,
          lte: endDate,
        },
      },
    });
    
    if (metrics.length === 0) {
      return { avgActive: 0, avgIdle: 0, avgUntracked: 0 };
    }
    
    let totalActive = 0, totalIdle = 0, totalUntracked = 0;
    for (const m of metrics) {
      totalActive += m.activeSeconds || 0;
      totalIdle += m.idleSeconds || 0;
      totalUntracked += m.untrackedSeconds || 0;
    }
    
    return {
      avgActive: totalActive / metrics.length,
      avgIdle: totalIdle / metrics.length,
      avgUntracked: totalUntracked / metrics.length,
    };
  }

  /**
   * Compute delta metrics
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


  // ============================================================================
  // Dashboard Mode Computation (Requirement 5.4)
  // ============================================================================

  /**
   * Compute dashboard mode and expected window
   */
  private async computeDashboardModeInfo(
    tenantId: string,
    devices: DeviceListItemEnhanced[]
  ): Promise<{ modeInfo: DashboardModeInfo; expected: ExpectedWindow }> {
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
      if (device.today.activeSeconds > 0 || device.today.idleSeconds > 0 || device.today.lastActivityTs) {
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
      mixedPolicies: false,
    };
    
    return { modeInfo, expected };
  }


  // ============================================================================
  // Attention Groups (Requirement 5.5)
  // ============================================================================

  /**
   * Get attention groups (categorized exceptions) with top offenders
   */
  async getAttentionGroups(tenantId: string, modeInfo?: DashboardModeInfo): Promise<AttentionResponse> {
    const devices = await this.getDevicesListEnhanced(tenantId);
    const now = Date.now();
    
    // If no mode info provided, compute it
    if (!modeInfo) {
      const computed = await this.computeDashboardModeInfo(tenantId, devices);
      modeInfo = computed.modeInfo;
    }
    
    // For NO_DEVICES, return empty
    if (modeInfo.mode === 'NO_DEVICES') {
      return { groups: [], totalCount: 0 };
    }
    
    // Group definitions with severity
    const groupDefs: Array<{ type: AttentionType; label: string; baseSeverity: AttentionSeverity }> = [
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
    
    // Process each device for attention types
    for (const device of devices) {
      const expectations = this.getPolicyExpectations(device.policy.id);
      const withinWorkHours = isBusinessHours(expectations);
      
      // Skip attention checks for PRE_SHIFT mode (except policy drift)
      if (modeInfo.mode === 'PRE_SHIFT') {
        if (!device.policy.compliant && device.policy.id) {
          const group = groups.get('policy_drift')!;
          this.addToGroup(group, device, 1, 'policy mismatch');
        }
        continue;
      }
      
      // OFFLINE_DURING_HOURS
      if (withinWorkHours && device.status === 'offline') {
        const group = groups.get('offline')!;
        const secondsSinceLastSeen = Math.floor((now - device.lastSeenTs) / 1000);
        this.addToGroup(group, device, secondsSinceLastSeen, this.formatDuration(secondsSinceLastSeen) + ' ago');
      }
      
      // TRACKING_OFF
      if (withinWorkHours && !device.trackingRunning && device.status !== 'offline') {
        const group = groups.get('tracking_off')!;
        this.addToGroup(group, device, 1, 'during work hours');
      }
      
      // POLICY_DRIFT
      if (!device.policy.compliant && device.policy.id) {
        const group = groups.get('policy_drift')!;
        this.addToGroup(group, device, 1, 'policy mismatch');
      }
      
      // LATE_START
      if (device.performance.startDelaySeconds > 0 && modeInfo.mode !== 'IN_SHIFT_NO_ACTIVITY') {
        const group = groups.get('late_start')!;
        const delayMin = Math.floor(device.performance.startDelaySeconds / 60);
        this.addToGroup(group, device, device.performance.startDelaySeconds, `${delayMin}m late`);
      }
      
      // HIGH_UNTRACKED
      const maxUntrackedSeconds = expectations.maxUntrackedMinutesPerDay * 60;
      if (device.today.untrackedSeconds > maxUntrackedSeconds) {
        const group = groups.get('high_untracked')!;
        const overageMin = Math.floor((device.today.untrackedSeconds - maxUntrackedSeconds) / 60);
        if (device.today.untrackedSeconds > maxUntrackedSeconds * 2) {
          group.severity = 'crit';
        }
        this.addToGroup(group, device, device.today.untrackedSeconds, `${overageMin}m over limit`);
      }
      
      // HIGH_IDLE
      const maxIdleSeconds = expectations.maxIdleMinutesPerDay * 60;
      if (device.today.idleSeconds > maxIdleSeconds) {
        const group = groups.get('high_idle')!;
        const overageMin = Math.floor((device.today.idleSeconds - maxIdleSeconds) / 60);
        this.addToGroup(group, device, device.today.idleSeconds, `${overageMin}m over limit`);
      }
      
      // LOW_PROGRESS
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
        g.top.sort((a, b) => b.valueNumber - a.valueNumber);
        g.top = g.top.slice(0, 3);
        return g;
      })
      .sort((a, b) => {
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


  // ============================================================================
  // Dashboard Story (Requirement 5.5)
  // ============================================================================

  /**
   * Generate dashboard story (Today's narrative) - MODE AWARE with health score caps
   */
  async getDashboardStory(tenantId: string): Promise<DashboardStory> {
    const devices = await this.getDevicesListEnhanced(tenantId);
    const { modeInfo, expected } = await this.computeDashboardModeInfo(tenantId, devices);
    const attention = await this.getAttentionGroups(tenantId, modeInfo);
    
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
    const startDate = getDateNDaysAgo(7);
    const endDate = getDateNDaysAgo(1);
    const teamHistory = await this.prisma.dailyMetrics.findMany({
      where: {
        tenantId,
        dateYmd: { gte: startDate, lte: endDate },
      },
      take: 1,
    });
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
        healthScore: 70,
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
    
    // Apply consistency caps
    const hasCritGroup = attention.groups.some(g => g.severity === 'crit');
    const hasWarnGroup = attention.groups.some(g => g.severity === 'warn');
    const hasCritDevice = criticalCount > 0;
    
    if (hasCritGroup || hasCritDevice) {
      healthScore = Math.min(healthScore, 85);
    } else if (hasWarnGroup) {
      healthScore = Math.min(healthScore, 95);
    }
    
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
    bullets.push(`${onlineCount} device${onlineCount !== 1 ? 's' : ''} online, ${idleCount} idle, ${offlineCount} offline.`);
    bullets.push(`Team progress: ${Math.round(progressPctTeam * 100)}% of expected work completed.`);
    
    if (criticalCount > 0) {
      const criticalDevices = devices.filter(d => d.performance.risk.label === 'critical');
      const names = criticalDevices.slice(0, 2).map(d => d.deviceName).join(', ');
      bullets.push(`${criticalCount} Critical: ${names}${criticalCount > 2 ? '...' : ''}`);
    }
    
    if (atRiskCount > 0 && criticalCount === 0) {
      bullets.push(`${atRiskCount} device${atRiskCount !== 1 ? 's' : ''} at risk — may need attention.`);
    }
    
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
   * Generate manager sentence - single strong conclusion line
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

  // ============================================================================
  // Rankings (Requirement 5.5)
  // ============================================================================

  /**
   * Get rankings
   */
  async getRankings(tenantId: string): Promise<RankingsResponse> {
    const devices = await this.getDevicesListEnhanced(tenantId);
    
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

  // ============================================================================
  // Trends (Requirement 5.5)
  // ============================================================================

  /**
   * Get trends data
   */
  async getTrends(tenantId: string, scope: 'team' | 'device', deviceId?: string, days: number = 7): Promise<TrendsResponse> {
    const todayYmd = getTodayYmd();
    const startDate = getDateNDaysAgo(days - 1);
    
    let points: TrendPoint[] = [];
    
    if (scope === 'team') {
      // Aggregate all devices by date
      const data = await this.prisma.dailyMetrics.groupBy({
        by: ['dateYmd'],
        where: {
          tenantId,
          dateYmd: { gte: startDate, lte: todayYmd },
        },
        _sum: {
          activeSeconds: true,
          idleSeconds: true,
          untrackedSeconds: true,
        },
        orderBy: { dateYmd: 'asc' },
      });
      
      points = data.map(d => ({
        date: d.dateYmd,
        activeSeconds: d._sum.activeSeconds || 0,
        idleSeconds: d._sum.idleSeconds || 0,
        untrackedSeconds: d._sum.untrackedSeconds || 0,
      }));
    } else if (deviceId) {
      const data = await this.prisma.dailyMetrics.findMany({
        where: {
          tenantId,
          deviceId,
          dateYmd: { gte: startDate, lte: todayYmd },
        },
        orderBy: { dateYmd: 'asc' },
      });
      
      points = data.map(d => ({
        date: d.dateYmd,
        activeSeconds: d.activeSeconds || 0,
        idleSeconds: d.idleSeconds || 0,
        untrackedSeconds: d.untrackedSeconds || 0,
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
}

// ============================================================================
// Exports
// ============================================================================

export * from './dashboard-types';
