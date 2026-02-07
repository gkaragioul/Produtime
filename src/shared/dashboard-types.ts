/**
 * Dashboard Types for Admin Console
 * Shared types for manager-grade dashboard with KPIs, exceptions, and drilldowns
 * 
 * COMPLIANCE: This is NOT spyware.
 * - Only aggregated stats are shared (no raw window titles by default)
 * - Title sharing must be explicitly enabled by policy
 * - All data is privacy-respecting
 */

// ============================================================================
// ENHANCED HEARTBEAT PAYLOAD (Agent → Admin)
// ============================================================================

export interface EnhancedHeartbeatPayload {
  // Device identification
  deviceId: string;
  deviceName: string;
  ip: string;
  appVersion: string;
  
  // Tracking state
  trackingRunning: boolean;
  
  // Policy compliance
  effectivePolicyHash: string;
  privacyModeEffective: boolean;
  titleSharingEffective: boolean;  // Default: false
  
  // Today's metrics (aggregated, privacy-respecting)
  today: DailyMetricsSummary;
  
  // Last 15 minutes metrics (for real-time status)
  last15m: PeriodMetricsSummary;
  
  // Top apps today (limit 10, no titles)
  topAppsToday: TopAppEntry[];
}

export interface DailyMetricsSummary {
  productiveSeconds: number;      // 0 until app categorization exists
  unproductiveSeconds: number;    // 0 until app categorization exists
  idleSeconds: number;
  untrackedSeconds: number;
  activeSeconds: number;
  firstActivityTs: number | null;
  lastActivityTs: number | null;
}

export interface PeriodMetricsSummary {
  productiveSeconds: number;
  unproductiveSeconds: number;
  idleSeconds: number;
  untrackedSeconds: number;
  activeSeconds: number;
}

export interface TopAppEntry {
  app: string;
  seconds: number;
  category?: 'productive' | 'unproductive' | 'neutral';  // Optional until categorization exists
}

// ============================================================================
// DEVICE STATUS (Admin DB)
// ============================================================================

export type DeviceStatusType = 'online' | 'idle' | 'offline';

export interface DeviceStatusRecord {
  device_id: string;
  status: DeviceStatusType;
  last_seen_ts: number;
  ip: string;
  app_version: string;
  policy_id: string | null;
  policy_hash: string | null;
  privacy_mode_effective: boolean;
  title_sharing_effective: boolean;
  tracking_running: boolean;
  updated_at: number;
}

// ============================================================================
// DEVICE DAILY METRICS (Admin DB)
// ============================================================================

export interface DeviceDailyMetricsRecord {
  device_id: string;
  date_ymd: string;  // YYYY-MM-DD
  productive_seconds: number;
  unproductive_seconds: number;
  idle_seconds: number;
  untracked_seconds: number;
  active_seconds: number;
  first_activity_ts: number | null;
  last_activity_ts: number | null;
  top_apps_json: string;  // JSON array of TopAppEntry[]
  created_at: number;
  updated_at: number;
}

// ============================================================================
// EXCEPTIONS (Admin DB)
// ============================================================================

export type ExceptionType = 
  | 'late_start'
  | 'offline'
  | 'high_idle'
  | 'high_untracked'
  | 'policy_drift'
  | 'tracking_off';

export type ExceptionSeverity = 'info' | 'warn' | 'crit';

export interface ExceptionRecord {
  id?: number;
  ts: number;
  type: ExceptionType;
  severity: ExceptionSeverity;
  device_id: string;
  date_ymd: string;
  details_json: string;
  resolved: boolean;
}

export interface ExceptionDetails {
  message: string;
  threshold?: number;
  actual?: number;
  expectedTime?: string;
  actualTime?: string;
  expectedPolicyHash?: string;
  actualPolicyHash?: string;
}

// ============================================================================
// DASHBOARD API RESPONSES
// ============================================================================

export interface DashboardSummaryResponse {
  range: 'today' | '7d';
  totals: TeamTotals;
  trends7d: DailyTrend[];
  topApps: TopAppEntry[];
  exceptions: ExceptionSummary[];
}

export interface TeamTotals {
  devicesTotal: number;
  online: number;
  idle: number;
  offline: number;
  productiveSeconds: number;
  unproductiveSeconds: number;
  idleSeconds: number;
  untrackedSeconds: number;
  activeSeconds: number;
}

export interface DailyTrend {
  date: string;  // YYYY-MM-DD
  productiveSeconds: number;
  idleSeconds: number;
  untrackedSeconds: number;
  activeSeconds: number;
}

export interface ExceptionSummary {
  id: number;
  type: ExceptionType;
  severity: ExceptionSeverity;
  deviceId: string;
  deviceName: string;
  details: ExceptionDetails;
  ts: number;
  resolved: boolean;
}

// ============================================================================
// DEVICES API RESPONSES
// ============================================================================

export interface DeviceListItem {
  deviceId: string;
  deviceName: string;
  status: DeviceStatusType;
  lastSeenTs: number;
  appVersion: string;
  today: DailyMetricsSummary;
  topAppsToday: TopAppEntry[];
  policy: {
    id: string | null;
    name: string | null;
    compliant: boolean;
  };
}

export interface DeviceDetailResponse {
  device: {
    deviceId: string;
    deviceName: string;
    status: DeviceStatusType;
    lastSeenTs: number;
    appVersion: string;
    ip: string;
    pairedAt: number;
    policyId: string | null;
    policyName: string | null;
    policyCompliant: boolean;
  };
  todayMetrics: DailyMetricsSummary;
  dailyMetrics7d: Array<{
    date: string;
    metrics: DailyMetricsSummary;
  }>;
  topApps7d: TopAppEntry[];
  exceptions: ExceptionSummary[];
}

// ============================================================================
// COMMAND TYPES
// ============================================================================

export interface DeviceCommand {
  commandId: string;
  deviceId: string;
  type: 'requestSnapshot' | 'requestPdfExport' | 'pushPolicy' | 'softLock' | 'softUnlock';
  payload: any;
  status: 'pending' | 'sent' | 'acknowledged' | 'failed';
  createdAt: number;
  updatedAt: number;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Format seconds to HH:MM string
 */
export function secondsToHhMm(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

/**
 * Format seconds to short format (e.g., "2.5h" or "45m")
 */
export function secondsToShort(seconds: number): string {
  if (seconds < 3600) {
    return `${Math.round(seconds / 60)}m`;
  }
  return `${(seconds / 3600).toFixed(1)}h`;
}

/**
 * Format timestamp to local time string
 */
export function tsToLocalString(ts: number): string {
  return new Date(ts).toLocaleString();
}

/**
 * Format timestamp to local time only (HH:MM)
 */
export function tsToLocalTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Get today's date in YYYY-MM-DD format
 */
export function getTodayYmd(): string {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

/**
 * Get date N days ago in YYYY-MM-DD format
 */
export function getDateNDaysAgo(n: number): string {
  const date = new Date();
  date.setDate(date.getDate() - n);
  return date.toISOString().split('T')[0];
}

/**
 * Compute policy hash for comparison
 */
export function computePolicyHash(policyJson: string): string {
  // Simple hash for policy comparison
  let hash = 0;
  for (let i = 0; i < policyJson.length; i++) {
    const char = policyJson.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(16);
}

// ============================================================================
// EXCEPTION THRESHOLDS (configurable)
// ============================================================================

export const DEFAULT_EXCEPTION_THRESHOLDS = {
  lateStartGraceMinutes: 15,
  highIdleThresholdSeconds: 3600,      // 1 hour
  highUntrackedThresholdSeconds: 1800, // 30 minutes
  offlineThresholdSeconds: 120,        // 2 minutes
};

// ============================================================================
// STATUS COMPUTATION
// ============================================================================

export function computeDeviceStatus(
  lastSeenTs: number,
  last15mActiveSeconds: number,
  last15mIdleSeconds: number
): DeviceStatusType {
  const now = Date.now();
  const timeSinceLastSeen = now - lastSeenTs;
  
  // Offline if last seen > 2 minutes ago
  if (timeSinceLastSeen > 120000) {
    return 'offline';
  }
  
  // Idle if online but mostly idle in last 15 minutes
  const totalLast15m = last15mActiveSeconds + last15mIdleSeconds;
  if (totalLast15m > 0 && last15mIdleSeconds / totalLast15m > 0.8) {
    return 'idle';
  }
  
  return 'online';
}
