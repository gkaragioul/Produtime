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
// PERFORMANCE MODEL HELPERS
// ============================================================================

/**
 * Parse HH:mm time string to minutes since midnight
 */
export function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Get current time as minutes since midnight
 */
export function getCurrentMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

/**
 * Compute expected seconds so far based on work window
 */
export function computeExpectedSecondsSoFar(
  expectations: PolicyExpectations,
  now: Date = new Date()
): number {
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const workStartMinutes = parseTimeToMinutes(expectations.workStart);
  const workEndMinutes = parseTimeToMinutes(expectations.workEnd);
  
  // Before work start
  if (currentMinutes < workStartMinutes) {
    return 0;
  }
  
  // After work end
  if (currentMinutes >= workEndMinutes) {
    return (workEndMinutes - workStartMinutes) * 60;
  }
  
  // During work hours
  return (currentMinutes - workStartMinutes) * 60;
}

/**
 * Compute expected total seconds for the day
 */
export function computeExpectedTotalSeconds(expectations: PolicyExpectations): number {
  if (expectations.expectedActiveMinutesPerDay) {
    return expectations.expectedActiveMinutesPerDay * 60;
  }
  const workStartMinutes = parseTimeToMinutes(expectations.workStart);
  const workEndMinutes = parseTimeToMinutes(expectations.workEnd);
  return (workEndMinutes - workStartMinutes) * 60;
}

/**
 * Compute start delay in seconds
 */
export function computeStartDelay(
  firstActivityTs: number | null,
  expectations: PolicyExpectations,
  date: Date = new Date()
): number {
  if (!firstActivityTs) {
    // No activity yet - compute delay from now if past grace period
    const currentMinutes = date.getHours() * 60 + date.getMinutes();
    const workStartMinutes = parseTimeToMinutes(expectations.workStart);
    const graceEndMinutes = workStartMinutes + expectations.lateGraceMinutes;
    
    if (currentMinutes > graceEndMinutes) {
      return (currentMinutes - graceEndMinutes) * 60;
    }
    return 0;
  }
  
  const activityDate = new Date(firstActivityTs);
  const activityMinutes = activityDate.getHours() * 60 + activityDate.getMinutes();
  const workStartMinutes = parseTimeToMinutes(expectations.workStart);
  const graceEndMinutes = workStartMinutes + expectations.lateGraceMinutes;
  
  if (activityMinutes > graceEndMinutes) {
    return (activityMinutes - graceEndMinutes) * 60;
  }
  return 0;
}

/**
 * Compute risk score (0-100) and label
 */
export function computeRiskScore(inputs: {
  isOffline: boolean;
  isTrackingOff: boolean;
  untrackedSeconds: number;
  maxUntrackedSeconds: number;
  idleSeconds: number;
  maxIdleSeconds: number;
  startDelaySeconds: number;
  activeSeconds: number;
  minActiveByMidday: number;
  isPastMidday: boolean;
  isBusinessHours: boolean;
}): RiskAssessment {
  let score = 0;
  const reasons: string[] = [];
  
  // Offline during work hours: +60
  if (inputs.isBusinessHours && inputs.isOffline) {
    score += 60;
    reasons.push('Offline during work hours');
  }
  
  // Tracking off during work hours: +50
  if (inputs.isBusinessHours && inputs.isTrackingOff) {
    score += 50;
    reasons.push('Tracking is not running');
  }
  
  // High untracked: +1 per extra minute up to 30
  const untrackedOverage = inputs.untrackedSeconds - inputs.maxUntrackedSeconds;
  if (untrackedOverage > 0) {
    const points = Math.min(30, Math.floor(untrackedOverage / 60));
    score += points;
    reasons.push(`High untracked time (+${Math.round(untrackedOverage / 60)}m over limit)`);
  }
  
  // High idle: +1 per 2 extra minutes up to 20
  const idleOverage = inputs.idleSeconds - inputs.maxIdleSeconds;
  if (idleOverage > 0) {
    const points = Math.min(20, Math.floor(idleOverage / 120));
    score += points;
    reasons.push(`High idle time (+${Math.round(idleOverage / 60)}m over limit)`);
  }
  
  // Late start: +1 per minute up to 15
  if (inputs.startDelaySeconds > 0) {
    const lateMinutes = Math.floor(inputs.startDelaySeconds / 60);
    const points = Math.min(15, lateMinutes);
    score += points;
    reasons.push(`Late start (${lateMinutes}m late)`);
  }
  
  // Low progress by midday: +25
  if (inputs.isPastMidday && inputs.activeSeconds < inputs.minActiveByMidday * 60) {
    score += 25;
    reasons.push('Low progress by midday');
  }
  
  // Clamp to 0-100
  score = Math.max(0, Math.min(100, score));
  
  // Determine label
  let label: RiskLabel;
  if (score < 25) {
    label = 'on_track';
  } else if (score < 60) {
    label = 'at_risk';
  } else {
    label = 'critical';
  }
  
  return { score, label, reasons };
}

/**
 * Get risk label display properties
 */
export function getRiskLabelDisplay(label: RiskLabel): { text: string; color: string; bgColor: string } {
  switch (label) {
    case 'on_track':
      return { text: 'On Track', color: '#2e7d32', bgColor: '#e8f5e9' };
    case 'at_risk':
      return { text: 'At Risk', color: '#e65100', bgColor: '#fff3e0' };
    case 'critical':
      return { text: 'Critical', color: '#c62828', bgColor: '#ffebee' };
  }
}

/**
 * Get health label display properties
 */
export function getHealthLabelDisplay(label: HealthLabel): { text: string; color: string } {
  switch (label) {
    case 'healthy':
      return { text: 'Healthy', color: '#4CAF50' };
    case 'watch':
      return { text: 'Watch', color: '#FF9800' };
    case 'at_risk':
      return { text: 'At Risk', color: '#f44336' };
  }
}

/**
 * Format delta percentage with arrow
 */
export function formatDeltaPct(deltaPct: number): { text: string; color: string; arrow: string } {
  const pct = Math.round(deltaPct * 100);
  if (pct > 0) {
    return { text: `+${pct}%`, color: '#4CAF50', arrow: '↑' };
  } else if (pct < 0) {
    return { text: `${pct}%`, color: '#f44336', arrow: '↓' };
  }
  return { text: '0%', color: '#666', arrow: '→' };
}

/**
 * Check if current time is within business hours
 */
export function isBusinessHours(expectations: PolicyExpectations = DEFAULT_POLICY_EXPECTATIONS): boolean {
  const currentMinutes = getCurrentMinutes();
  const workStartMinutes = parseTimeToMinutes(expectations.workStart);
  const workEndMinutes = parseTimeToMinutes(expectations.workEnd);
  return currentMinutes >= workStartMinutes && currentMinutes < workEndMinutes;
}

/**
 * Check if current time is past midday (12:00)
 */
export function isPastMidday(): boolean {
  return new Date().getHours() >= 12;
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
// POLICY EXPECTATIONS (for performance model)
// ============================================================================

export interface PolicyExpectations {
  workStart: string;           // HH:mm format, default "09:00"
  workEnd: string;             // HH:mm format, default "18:00"
  lateGraceMinutes: number;    // default 15
  expectedActiveMinutesPerDay: number | null;  // null = derived from work window
  maxIdleMinutesPerDay: number;      // default 60
  maxUntrackedMinutesPerDay: number; // default 30
  minActiveMinutesByMidday: number;  // default 120 (for early warning)
}

export const DEFAULT_POLICY_EXPECTATIONS: PolicyExpectations = {
  workStart: '09:00',
  workEnd: '18:00',
  lateGraceMinutes: 15,
  expectedActiveMinutesPerDay: null,  // Will be derived: 9 hours = 540 minutes
  maxIdleMinutesPerDay: 60,
  maxUntrackedMinutesPerDay: 30,
  minActiveMinutesByMidday: 120,
};

// ============================================================================
// RISK MODEL
// ============================================================================

export type RiskLabel = 'on_track' | 'at_risk' | 'critical';

export interface RiskAssessment {
  score: number;           // 0-100
  label: RiskLabel;
  reasons: string[];       // Human-readable reasons
}

export interface PerformanceMetrics {
  // Expected values
  expectedSecondsSoFar: number;
  expectedTotalSeconds: number;
  
  // Progress
  progressPct: number;     // activeSecondsToday / expectedSecondsSoFar
  
  // Start time analysis
  startDelaySeconds: number;  // 0 if on time, positive if late
  
  // Percentages
  untrackedPct: number;
  idlePct: number;
  
  // Risk assessment
  risk: RiskAssessment;
}

export interface DeltaMetrics {
  avgActiveSeconds7d: number;
  avgIdleSeconds7d: number;
  avgUntrackedSeconds7d: number;
  deltaActivePct: number;      // (today - avg) / avg
  deltaIdlePct: number;
  deltaUntrackedPct: number;
}

// ============================================================================
// ENHANCED DEVICE LIST ITEM (with performance)
// ============================================================================

export interface DeviceListItemEnhanced extends DeviceListItem {
  expected: {
    expectedSoFarSeconds: number;
    expectedTotalSeconds: number;
  };
  performance: PerformanceMetrics;
  deltas: DeltaMetrics;
}

// ============================================================================
// ATTENTION GROUPS (categorized exceptions)
// ============================================================================

export type AttentionType = 
  | 'offline'
  | 'tracking_off'
  | 'policy_drift'
  | 'late_start'
  | 'high_untracked'
  | 'high_idle'
  | 'low_progress';

export interface AttentionTopOffender {
  deviceId: string;
  deviceName: string;
  valueLabel: string;   // Human-readable (e.g., "14m ago", "45m over")
  valueNumber: number;  // Raw number for sorting (e.g., seconds)
}

export interface AttentionGroup {
  type: AttentionType;
  label: string;
  severity: ExceptionSeverity;
  count: number;
  deviceIds: string[];
  preview: Array<{ deviceId: string; deviceName: string; value: string }>;
  top: AttentionTopOffender[];  // Top 1-3 offenders sorted by severity
}

export interface AttentionResponse {
  groups: AttentionGroup[];
  totalCount: number;
}

// ============================================================================
// DASHBOARD MODE (Trustworthiness)
// ============================================================================

export type DashboardMode = 
  | 'NO_DEVICES'           // No devices paired
  | 'NO_DATA_YET'          // Devices exist but no heartbeats/metrics today
  | 'PRE_SHIFT'            // Before expected work start (expectedSoFar=0)
  | 'IN_SHIFT_NO_ACTIVITY' // Within work hours but active=0 (after grace)
  | 'NORMAL';              // Normal operation with activity

export interface DashboardModeInfo {
  mode: DashboardMode;
  withinWorkHours: boolean;
  minutesIntoShift: number;  // 0 if pre-shift or outside hours
}

/**
 * Determine dashboard mode based on current state
 */
export function determineDashboardMode(input: {
  devicesCount: number;
  onlineCount: number;
  anyHeartbeatToday: boolean;
  teamExpectedSoFarSeconds: number;
  teamActiveSecondsToday: number;
  withinWorkHours: boolean;
  minutesIntoShift: number;
}): DashboardModeInfo {
  const { devicesCount, anyHeartbeatToday, teamExpectedSoFarSeconds, teamActiveSecondsToday, withinWorkHours, minutesIntoShift } = input;
  
  // Rule 1: No devices
  if (devicesCount === 0) {
    return { mode: 'NO_DEVICES', withinWorkHours, minutesIntoShift: 0 };
  }
  
  // Rule 2: No heartbeat today
  if (!anyHeartbeatToday) {
    return { mode: 'NO_DATA_YET', withinWorkHours, minutesIntoShift };
  }
  
  // Rule 3: Pre-shift (before work start)
  if (teamExpectedSoFarSeconds === 0) {
    return { mode: 'PRE_SHIFT', withinWorkHours: false, minutesIntoShift: 0 };
  }
  
  // Rule 4: In-shift with no activity (after 10 min grace)
  if (withinWorkHours && teamExpectedSoFarSeconds > 0 && teamActiveSecondsToday === 0 && minutesIntoShift >= 10) {
    return { mode: 'IN_SHIFT_NO_ACTIVITY', withinWorkHours, minutesIntoShift };
  }
  
  // Rule 5: Normal
  return { mode: 'NORMAL', withinWorkHours, minutesIntoShift };
}

/**
 * Get mode-aware health label display
 */
export function getModeHealthLabelDisplay(mode: DashboardMode, healthLabel: HealthLabel | null): { text: string; color: string } {
  switch (mode) {
    case 'NO_DEVICES':
      return { text: 'No Devices', color: '#9e9e9e' };
    case 'NO_DATA_YET':
      return { text: 'Waiting', color: '#9e9e9e' };
    case 'PRE_SHIFT':
      return { text: 'Pre-shift', color: '#2196F3' };
    case 'IN_SHIFT_NO_ACTIVITY':
      return { text: 'Watch', color: '#FF9800' };
    case 'NORMAL':
      return healthLabel ? getHealthLabelDisplay(healthLabel) : { text: 'Unknown', color: '#9e9e9e' };
  }
}

/**
 * Get empty state message for attention panel based on mode
 */
export function getAttentionEmptyMessage(mode: DashboardMode): { message: string; cta?: { label: string; action: string } } {
  switch (mode) {
    case 'NO_DEVICES':
      return { message: 'No devices paired.', cta: { label: 'Go to Pairing', action: 'pairing' } };
    case 'NO_DATA_YET':
      return { message: 'Waiting for first heartbeat today.', cta: { label: 'View Devices', action: 'devices' } };
    case 'PRE_SHIFT':
      return { message: 'No issues (pre-shift).' };
    case 'IN_SHIFT_NO_ACTIVITY':
      return { message: 'Low progress detected.' }; // Should never be empty in this mode
    case 'NORMAL':
      return { message: 'No issues detected. ✓' };
  }
}

// ============================================================================
// DASHBOARD STORY (Today's narrative)
// ============================================================================

export type HealthLabel = 'healthy' | 'watch' | 'at_risk';

export interface ExpectedWindow {
  workStart: string;
  workEnd: string;
  expectedTotalSeconds: number;
  expectedSoFarSeconds: number;
  mixedPolicies: boolean;
}

export interface DashboardStory {
  mode: DashboardMode;
  healthScore: number | null;  // null for NO_DEVICES, NO_DATA_YET
  healthLabel: HealthLabel | null;
  managerSentence: string;   // Single strong conclusion line
  bullets: string[];         // 3-5 insight bullets
  progress: {
    expectedSecondsSoFarTeam: number;
    activeSecondsTeam: number;
    progressPctTeam: number | null;  // null if pre-shift
  };
  expected: ExpectedWindow;
  highlights: {
    criticalCount: number;
    atRiskCount: number;
    onTrackCount: number;
    online: number;
    idle: number;
    offline: number;
  };
  hasHistory7d: boolean;
  hasTopAppsToday: boolean;
}

// ============================================================================
// RANKINGS
// ============================================================================

export interface RankingEntry {
  deviceId: string;
  deviceName: string;
  value: number;
  deltaPct: number | null;
}

export interface RankingsResponse {
  mostActive: RankingEntry[];
  mostUntracked: RankingEntry[];
  biggestImprovement: RankingEntry[];
  biggestRegression: RankingEntry[];
}

// ============================================================================
// TRENDS (enhanced)
// ============================================================================

export interface TrendPoint {
  date: string;
  activeSeconds: number;
  idleSeconds: number;
  untrackedSeconds: number;
}

export interface TrendsResponse {
  points: TrendPoint[];
  deltas: {
    activePct: number;
    idlePct: number;
    untrackedPct: number;
  };
}

// ============================================================================
// ENHANCED DASHBOARD SUMMARY
// ============================================================================

export interface DashboardSummaryEnhanced extends DashboardSummaryResponse {
  story: DashboardStory;
  attention: AttentionResponse;
  rankings: RankingsResponse;
}

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
