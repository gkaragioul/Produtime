/**
 * Dashboard Service for Admin Console
 * Handles heartbeat ingestion, metrics aggregation, and exceptions engine
 * 
 * COMPLIANCE: This is NOT spyware.
 * - Only processes aggregated stats from agents
 * - No raw window titles stored unless explicitly enabled
 * - All data is privacy-respecting
 */

import { AdminDatabase } from './db';
import { PerformanceService } from './performance-service';
import {
  EnhancedHeartbeatPayload,
  DeviceStatusType,
  ExceptionType,
  ExceptionSeverity,
  DashboardSummaryResponse,
  DashboardSummaryEnhanced,
  DeviceListItem,
  DeviceListItemEnhanced,
  DeviceDetailResponse,
  ExceptionSummary,
  TeamTotals,
  DailyTrend,
  TopAppEntry,
  AttentionResponse,
  DashboardStory,
  RankingsResponse,
  TrendsResponse,
  computeDeviceStatus,
  getTodayYmd,
  getDateNDaysAgo,
  DEFAULT_EXCEPTION_THRESHOLDS,
} from '../shared/dashboard-types';

export class DashboardService {
  private db: AdminDatabase;
  private performanceService: PerformanceService;
  private exceptionsEngineInterval: NodeJS.Timeout | null = null;

  constructor(db: AdminDatabase) {
    this.db = db;
    this.performanceService = new PerformanceService(db);
  }

  /**
   * Start the exceptions engine (runs every minute)
   */
  public startExceptionsEngine(): void {
    // Run immediately
    this.runExceptionsEngine();
    
    // Then run every minute
    this.exceptionsEngineInterval = setInterval(() => {
      this.runExceptionsEngine();
    }, 60000);
    
    console.log('[DashboardService] Exceptions engine started');
  }

  /**
   * Stop the exceptions engine
   */
  public stopExceptionsEngine(): void {
    if (this.exceptionsEngineInterval) {
      clearInterval(this.exceptionsEngineInterval);
      this.exceptionsEngineInterval = null;
    }
  }

  /**
   * Ingest a heartbeat from an agent
   */
  public ingestHeartbeat(heartbeat: EnhancedHeartbeatPayload): void {
    const now = Date.now();
    const todayYmd = getTodayYmd();

    // Compute device status
    const status = computeDeviceStatus(
      now,
      heartbeat.last15m.activeSeconds,
      heartbeat.last15m.idleSeconds
    );

    // Upsert device status
    this.db.upsertDeviceStatus({
      device_id: heartbeat.deviceId,
      status,
      last_seen_ts: now,
      ip: heartbeat.ip,
      app_version: heartbeat.appVersion,
      policy_id: null, // Will be set from devices table
      policy_hash: heartbeat.effectivePolicyHash,
      privacy_mode_effective: heartbeat.privacyModeEffective,
      title_sharing_effective: heartbeat.titleSharingEffective,
      tracking_running: heartbeat.trackingRunning,
    });

    // Upsert daily metrics
    this.db.upsertDeviceDailyMetrics({
      device_id: heartbeat.deviceId,
      date_ymd: todayYmd,
      productive_seconds: heartbeat.today.productiveSeconds,
      unproductive_seconds: heartbeat.today.unproductiveSeconds,
      idle_seconds: heartbeat.today.idleSeconds,
      untracked_seconds: heartbeat.today.untrackedSeconds,
      active_seconds: heartbeat.today.activeSeconds,
      first_activity_ts: heartbeat.today.firstActivityTs,
      last_activity_ts: heartbeat.today.lastActivityTs,
      top_apps_json: JSON.stringify(heartbeat.topAppsToday),
    });

    // Update legacy device stats for backward compatibility
    this.db.updateDeviceStats(
      heartbeat.deviceId,
      heartbeat.today.activeSeconds,
      heartbeat.today.idleSeconds
    );

    // Log heartbeat for debugging
    this.db.insertHeartbeatLog(heartbeat.deviceId, JSON.stringify(heartbeat));

    console.log(`[DashboardService] Ingested heartbeat from ${heartbeat.deviceId}: status=${status}, active=${heartbeat.today.activeSeconds}s`);
  }

  /**
   * Run the exceptions engine
   */
  private runExceptionsEngine(): void {
    const todayYmd = getTodayYmd();
    const now = Date.now();
    const currentHour = new Date().getHours();
    
    // Only check during business hours (8 AM - 6 PM)
    const isBusinessHours = currentHour >= 8 && currentHour < 18;
    
    // Get all devices
    const devices = this.db.getAllDevices();
    const deviceStatuses = this.db.getAllDeviceStatuses();
    
    for (const device of devices) {
      const status = deviceStatuses.find(s => s.device_id === device.device_id);
      const metrics = this.db.getDeviceDailyMetrics(device.device_id, todayYmd);
      
      // Check for offline during business hours
      if (isBusinessHours && status) {
        const timeSinceLastSeen = now - status.last_seen_ts;
        if (timeSinceLastSeen > DEFAULT_EXCEPTION_THRESHOLDS.offlineThresholdSeconds * 1000) {
          this.createException({
            type: 'offline',
            severity: 'warn',
            device_id: device.device_id,
            date_ymd: todayYmd,
            details: {
              message: `Device offline for ${Math.round(timeSinceLastSeen / 60000)} minutes`,
              threshold: DEFAULT_EXCEPTION_THRESHOLDS.offlineThresholdSeconds,
              actual: Math.round(timeSinceLastSeen / 1000),
            },
          });
        }
      }

      // Check for tracking off during business hours
      if (isBusinessHours && status && !status.tracking_running) {
        this.createException({
          type: 'tracking_off',
          severity: 'warn',
          device_id: device.device_id,
          date_ymd: todayYmd,
          details: {
            message: 'Activity tracking is not running',
          },
        });
      }

      // Check for high idle time
      if (metrics && metrics.idle_seconds > DEFAULT_EXCEPTION_THRESHOLDS.highIdleThresholdSeconds) {
        this.createException({
          type: 'high_idle',
          severity: 'info',
          device_id: device.device_id,
          date_ymd: todayYmd,
          details: {
            message: `High idle time: ${Math.round(metrics.idle_seconds / 60)} minutes`,
            threshold: DEFAULT_EXCEPTION_THRESHOLDS.highIdleThresholdSeconds,
            actual: metrics.idle_seconds,
          },
        });
      }

      // Check for high untracked time
      if (metrics && metrics.untracked_seconds > DEFAULT_EXCEPTION_THRESHOLDS.highUntrackedThresholdSeconds) {
        this.createException({
          type: 'high_untracked',
          severity: 'warn',
          device_id: device.device_id,
          date_ymd: todayYmd,
          details: {
            message: `High untracked time: ${Math.round(metrics.untracked_seconds / 60)} minutes`,
            threshold: DEFAULT_EXCEPTION_THRESHOLDS.highUntrackedThresholdSeconds,
            actual: metrics.untracked_seconds,
          },
        });
      }

      // Check for policy drift
      if (status && device.policy_id) {
        const policy = this.db.getPolicy(device.policy_id);
        if (policy) {
          const expectedHash = this.computePolicyHash(policy.policy_json);
          if (status.policy_hash && status.policy_hash !== expectedHash) {
            this.createException({
              type: 'policy_drift',
              severity: 'crit',
              device_id: device.device_id,
              date_ymd: todayYmd,
              details: {
                message: 'Device policy does not match assigned policy',
                expectedPolicyHash: expectedHash,
                actualPolicyHash: status.policy_hash,
              },
            });
          }
        }
      }

      // Check for late start (only after the device's scheduled start hour)
      if (isBusinessHours && metrics) {
        const workStartTime = this.getWorkScheduleStartForDevice(device.device_id);
        const [startHour, startMinute] = workStartTime.split(':').map(Number);
        const graceMinutes = DEFAULT_EXCEPTION_THRESHOLDS.lateStartGraceMinutes;

        // Only check once the current hour is past the scheduled start
        if (currentHour >= startHour) {
          const expectedStart = new Date();
          expectedStart.setHours(startHour, startMinute + graceMinutes, 0, 0);

          if (!metrics.first_activity_ts) {
            this.createException({
              type: 'late_start',
              severity: 'info',
              device_id: device.device_id,
              date_ymd: todayYmd,
              details: {
                message: 'No activity recorded today',
                expectedTime: workStartTime,
              },
            });
          } else {
            const firstActivityDate = new Date(metrics.first_activity_ts);

            if (metrics.first_activity_ts > expectedStart.getTime()) {
              const lateMinutes = Math.round((metrics.first_activity_ts - expectedStart.getTime()) / 60000);
              this.createException({
                type: 'late_start',
                severity: 'info',
                device_id: device.device_id,
                date_ymd: todayYmd,
                details: {
                  message: `Started ${lateMinutes} minutes late`,
                  expectedTime: workStartTime,
                  actualTime: firstActivityDate.toLocaleTimeString(),
                },
              });
            }
          }
        }
      }
    }
  }

  /**
   * Create an exception (idempotent by type, device_id, date_ymd)
   */
  private createException(exception: {
    type: ExceptionType;
    severity: ExceptionSeverity;
    device_id: string;
    date_ymd: string;
    details: any;
  }): void {
    this.db.insertException({
      ts: Date.now(),
      type: exception.type,
      severity: exception.severity,
      device_id: exception.device_id,
      date_ymd: exception.date_ymd,
      details_json: JSON.stringify(exception.details),
    });
  }

  /**
   * Get work schedule start time for a device from its assigned policy.
   * Falls back to '09:00' if no policy is assigned or workScheduleStart is not set.
   */
  private getWorkScheduleStartForDevice(deviceId: string): string {
    const DEFAULT_START = '09:00';

    // Look up the device's assigned policy via the device_policy table
    const device = this.db.getDevice(deviceId);
    if (!device?.policy_id) {
      return DEFAULT_START;
    }

    const policy = this.db.getPolicy(device.policy_id);
    if (!policy) {
      return DEFAULT_START;
    }

    try {
      const parsed = JSON.parse(policy.policy_json);
      if (parsed.workScheduleStart && typeof parsed.workScheduleStart === 'string') {
        return parsed.workScheduleStart;
      }
    } catch {
      // Ignore parse errors
    }

    return DEFAULT_START;
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

  // ============================================================
  // Dashboard API Methods
  // ============================================================

  /**
   * Get dashboard summary
   */
  public getDashboardSummary(range: 'today' | '7d'): DashboardSummaryResponse {
    const todayYmd = getTodayYmd();
    const startDate = range === '7d' ? getDateNDaysAgo(6) : todayYmd;
    const now = Date.now();
    
    // Get all devices and compute status counts
    // Use device_status table if available, otherwise fall back to devices table
    const devices = this.db.getAllDevices();
    const deviceStatuses = this.db.getAllDeviceStatuses();
    const statusMap = new Map(deviceStatuses.map(s => [s.device_id, s]));
    
    let onlineCount = 0;
    let idleCount = 0;
    let offlineCount = 0;
    
    for (const device of devices) {
      const status = statusMap.get(device.device_id);
      if (status) {
        // Use device_status table
        if (status.status === 'online') onlineCount++;
        else if (status.status === 'idle') idleCount++;
        else offlineCount++;
      } else {
        // Fall back to legacy devices table
        const timeSinceLastSeen = now - device.last_seen;
        if (device.status === 'online' && timeSinceLastSeen < 120000) {
          onlineCount++;
        } else if (timeSinceLastSeen < 120000) {
          onlineCount++;
        } else {
          offlineCount++;
        }
      }
    }
    
    const totalDevices = devices.length;
    
    // Get team totals
    let totals: TeamTotals;
    if (range === 'today') {
      const dayTotals = this.db.getTeamTotalsForDate(todayYmd);
      totals = {
        devicesTotal: totalDevices,
        online: onlineCount,
        idle: idleCount,
        offline: offlineCount,
        productiveSeconds: dayTotals.productive_seconds,
        unproductiveSeconds: dayTotals.unproductive_seconds,
        idleSeconds: dayTotals.idle_seconds,
        untrackedSeconds: dayTotals.untracked_seconds,
        activeSeconds: dayTotals.active_seconds,
      };
    } else {
      // Sum 7 days
      const dailyMetrics = this.db.getTeamDailyMetricsRange(startDate, todayYmd);
      let sumProductive = 0, sumUnproductive = 0, sumIdle = 0, sumUntracked = 0, sumActive = 0;
      for (const day of dailyMetrics) {
        sumProductive += day.productive_seconds || 0;
        sumUnproductive += day.unproductive_seconds || 0;
        sumIdle += day.idle_seconds || 0;
        sumUntracked += day.untracked_seconds || 0;
        sumActive += day.active_seconds || 0;
      }
      totals = {
        devicesTotal: totalDevices,
        online: onlineCount,
        idle: idleCount,
        offline: offlineCount,
        productiveSeconds: sumProductive,
        unproductiveSeconds: sumUnproductive,
        idleSeconds: sumIdle,
        untrackedSeconds: sumUntracked,
        activeSeconds: sumActive,
      };
    }

    // Get 7-day trends
    const trends7d: DailyTrend[] = [];
    const trendData = this.db.getTeamDailyMetricsRange(getDateNDaysAgo(6), todayYmd);
    for (const day of trendData) {
      trends7d.push({
        date: day.date_ymd,
        productiveSeconds: day.productive_seconds || 0,
        idleSeconds: day.idle_seconds || 0,
        untrackedSeconds: day.untracked_seconds || 0,
        activeSeconds: day.active_seconds || 0,
      });
    }

    // Get top apps
    const topApps = this.db.getTopAppsForDate(todayYmd, 10);

    // Get exceptions
    const rawExceptions = this.db.getUnresolvedExceptions(10);
    const exceptions: ExceptionSummary[] = rawExceptions.map(e => ({
      id: e.id,
      type: e.type as ExceptionType,
      severity: e.severity as ExceptionSeverity,
      deviceId: e.device_id,
      deviceName: e.device_name || 'Unknown',
      details: JSON.parse(e.details_json || '{}'),
      ts: e.ts,
      resolved: Boolean(e.resolved),
    }));

    return {
      range,
      totals,
      trends7d,
      topApps,
      exceptions,
    };
  }

  /**
   * Get devices list with metrics
   */
  public getDevicesList(): DeviceListItem[] {
    const devices = this.db.getAllDevices();
    const todayYmd = getTodayYmd();
    const result: DeviceListItem[] = [];
    const now = Date.now();

    for (const device of devices) {
      const status = this.db.getDeviceStatus(device.device_id);
      const metrics = this.db.getDeviceDailyMetrics(device.device_id, todayYmd);
      const policy = device.policy_id ? this.db.getPolicy(device.policy_id) : null;

      // Determine device status - use device_status table if available,
      // otherwise fall back to legacy devices table status
      let deviceStatus: DeviceStatusType = 'offline';
      let lastSeenTs = device.last_seen;
      
      if (status) {
        // Use device_status table (populated by enhanced heartbeats)
        deviceStatus = status.status as DeviceStatusType;
        lastSeenTs = status.last_seen_ts;
      } else {
        // Fall back to legacy devices table
        // Check if device was seen recently (within 2 minutes)
        const timeSinceLastSeen = now - device.last_seen;
        if (device.status === 'online' && timeSinceLastSeen < 120000) {
          deviceStatus = 'online';
        } else if (timeSinceLastSeen < 120000) {
          deviceStatus = 'online';
        } else {
          deviceStatus = 'offline';
        }
      }

      // Determine policy compliance
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
        } catch {
          // Ignore parse errors
        }
      }

      result.push({
        deviceId: device.device_id,
        deviceName: device.device_name,
        status: deviceStatus,
        lastSeenTs,
        appVersion: status?.app_version || device.app_version || '',
        today: {
          productiveSeconds: metrics?.productive_seconds || 0,
          unproductiveSeconds: metrics?.unproductive_seconds || 0,
          idleSeconds: metrics?.idle_seconds || 0,
          untrackedSeconds: metrics?.untracked_seconds || 0,
          activeSeconds: metrics?.active_seconds || 0,
          firstActivityTs: metrics?.first_activity_ts || null,
          lastActivityTs: metrics?.last_activity_ts || null,
        },
        topAppsToday,
        policy: {
          id: device.policy_id || null,
          name: policy?.name || null,
          compliant: policyCompliant,
        },
      });
    }

    return result;
  }

  /**
   * Get device detail
   */
  public getDeviceDetail(deviceId: string, range: 'today' | '7d'): DeviceDetailResponse | null {
    const device = this.db.getDevice(deviceId);
    if (!device) return null;

    const todayYmd = getTodayYmd();
    const startDate = range === '7d' ? getDateNDaysAgo(6) : todayYmd;
    const now = Date.now();
    
    const status = this.db.getDeviceStatus(deviceId);
    const todayMetrics = this.db.getDeviceDailyMetrics(deviceId, todayYmd);
    const dailyMetrics = this.db.getDeviceDailyMetricsRange(deviceId, startDate, todayYmd);
    const policy = device.policy_id ? this.db.getPolicy(device.policy_id) : null;
    const exceptions = this.db.getExceptionsByDevice(deviceId, 20);

    // Determine device status - use device_status table if available,
    // otherwise fall back to legacy devices table status
    let deviceStatus: DeviceStatusType = 'offline';
    let lastSeenTs = device.last_seen;
    
    if (status) {
      deviceStatus = status.status as DeviceStatusType;
      lastSeenTs = status.last_seen_ts;
    } else {
      const timeSinceLastSeen = now - device.last_seen;
      if (device.status === 'online' && timeSinceLastSeen < 120000) {
        deviceStatus = 'online';
      } else if (timeSinceLastSeen < 120000) {
        deviceStatus = 'online';
      } else {
        deviceStatus = 'offline';
      }
    }

    // Determine policy compliance
    let policyCompliant = true;
    if (policy && status?.policy_hash) {
      const expectedHash = this.computePolicyHash(policy.policy_json);
      policyCompliant = status.policy_hash === expectedHash;
    }

    // Aggregate top apps for 7 days
    const appTotals = new Map<string, number>();
    for (const day of dailyMetrics) {
      try {
        const apps = JSON.parse(day.top_apps_json || '[]') as TopAppEntry[];
        for (const app of apps) {
          appTotals.set(app.app, (appTotals.get(app.app) || 0) + app.seconds);
        }
      } catch {
        // Ignore parse errors
      }
    }
    const topApps7d = Array.from(appTotals.entries())
      .map(([app, seconds]) => ({ app, seconds }))
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 10);

    return {
      device: {
        deviceId: device.device_id,
        deviceName: device.device_name,
        status: deviceStatus,
        lastSeenTs,
        appVersion: status?.app_version || device.app_version || '',
        ip: status?.ip || device.ip || '',
        pairedAt: device.paired_at,
        policyId: device.policy_id || null,
        policyName: policy?.name || null,
        policyCompliant,
      },
      todayMetrics: {
        productiveSeconds: todayMetrics?.productive_seconds || 0,
        unproductiveSeconds: todayMetrics?.unproductive_seconds || 0,
        idleSeconds: todayMetrics?.idle_seconds || 0,
        untrackedSeconds: todayMetrics?.untracked_seconds || 0,
        activeSeconds: todayMetrics?.active_seconds || 0,
        firstActivityTs: todayMetrics?.first_activity_ts || null,
        lastActivityTs: todayMetrics?.last_activity_ts || null,
      },
      dailyMetrics7d: dailyMetrics.map(m => ({
        date: m.date_ymd,
        metrics: {
          productiveSeconds: m.productive_seconds || 0,
          unproductiveSeconds: m.unproductive_seconds || 0,
          idleSeconds: m.idle_seconds || 0,
          untrackedSeconds: m.untracked_seconds || 0,
          activeSeconds: m.active_seconds || 0,
          firstActivityTs: m.first_activity_ts || null,
          lastActivityTs: m.last_activity_ts || null,
        },
      })),
      topApps7d,
      exceptions: exceptions.map(e => ({
        id: e.id,
        type: e.type as ExceptionType,
        severity: e.severity as ExceptionSeverity,
        deviceId: e.device_id,
        deviceName: device.device_name,
        details: JSON.parse(e.details_json || '{}'),
        ts: e.ts,
        resolved: Boolean(e.resolved),
      })),
    };
  }

  /**
   * Resolve an exception
   */
  public resolveException(id: number): void {
    this.db.resolveException(id);
  }

  /**
   * Get exception counts by type
   */
  public getExceptionCounts(): Record<string, number> {
    return this.db.getExceptionCounts();
  }

  // ============================================================
  // Enhanced Dashboard API Methods (Performance Model)
  // ============================================================

  /**
   * Get enhanced dashboard summary with story, attention, and rankings
   */
  public getDashboardSummaryEnhanced(range: 'today' | '7d'): DashboardSummaryEnhanced {
    const baseSummary = this.getDashboardSummary(range);
    const story = this.performanceService.getDashboardStory();
    const attention = this.performanceService.getAttentionGroups();
    const rankings = this.performanceService.getRankings();

    return {
      ...baseSummary,
      story,
      attention,
      rankings,
    };
  }

  /**
   * Get enhanced devices list with performance metrics
   */
  public getDevicesListEnhanced(): DeviceListItemEnhanced[] {
    return this.performanceService.getDevicesListEnhanced();
  }

  /**
   * Get attention groups
   */
  public getAttentionGroups(): AttentionResponse {
    return this.performanceService.getAttentionGroups();
  }

  /**
   * Get dashboard story
   */
  public getDashboardStory(): DashboardStory {
    return this.performanceService.getDashboardStory();
  }

  /**
   * Get rankings
   */
  public getRankings(): RankingsResponse {
    return this.performanceService.getRankings();
  }

  /**
   * Get trends
   */
  public getTrends(scope: 'team' | 'device', deviceId?: string, days: number = 7): TrendsResponse {
    return this.performanceService.getTrends(scope, deviceId, days);
  }
}
