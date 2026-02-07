/**
 * Dashboard Types for Cloud Admin Web
 * Ported from admin-console/src/shared/dashboard-types.ts
 */

// ============================================================================
// DEVICE STATUS
// ============================================================================

export type DeviceStatusType = 'online' | 'idle' | 'offline';

// ============================================================================
// DAILY METRICS
// ============================================================================

export interface DailyMetricsSummary {
  productiveSeconds: number;
  unproductiveSeconds: number;
  idleSeconds: number;
  untrackedSeconds: number;
  activeSeconds: number;
  firstActivityTs: number | null;
  lastActivityTs: number | null;
}

export interface TopAppEntry {
  app: string;
  seconds: number;
  category?: 'productive' | 'unproductive' | 'neutral';
}

// ============================================================================
// RISK MODEL
// ============================================================================

export type RiskLabel = 'on_track' | 'at_risk' | 'critical';

export interface RiskAssessment {
  score: number;
  label: RiskLabel;
  reasons: string[];
}

export interface PerformanceMetrics {
  expectedSecondsSoFar: number;
  expectedTotalSeconds: number;
  progressPct: number;
  startDelaySeconds: number;
  untrackedPct: number;
  idlePct: number;
  risk: RiskAssessment;
}

export interface DeltaMetrics {
  avgActiveSeconds7d: number;
  avgIdleSeconds7d: number;
  avgUntrackedSeconds7d: number;
  deltaActivePct: number;
  deltaIdlePct: number;
  deltaUntrackedPct: number;
}

// ============================================================================
// DEVICE LIST
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

export interface DeviceListItemEnhanced extends DeviceListItem {
  expected: {
    expectedSoFarSeconds: number;
    expectedTotalSeconds: number;
  };
  performance: PerformanceMetrics;
  deltas: DeltaMetrics;
}

// ============================================================================
// ATTENTION GROUPS
// ============================================================================

export type AttentionType =
  | 'offline'
  | 'tracking_off'
  | 'policy_drift'
  | 'late_start'
  | 'high_untracked'
  | 'high_idle'
  | 'low_progress';

export type ExceptionSeverity = 'info' | 'warn' | 'crit';

export interface AttentionTopOffender {
  deviceId: string;
  deviceName: string;
  valueLabel: string;
  valueNumber: number;
}

export interface AttentionGroup {
  type: AttentionType;
  label: string;
  severity: ExceptionSeverity;
  count: number;
  deviceIds: string[];
  preview: Array<{ deviceId: string; deviceName: string; value: string }>;
  top: AttentionTopOffender[];
}

export interface AttentionResponse {
  groups: AttentionGroup[];
  totalCount: number;
}

// ============================================================================
// DASHBOARD MODE
// ============================================================================

export type DashboardMode =
  | 'NO_DEVICES'
  | 'NO_DATA_YET'
  | 'PRE_SHIFT'
  | 'IN_SHIFT_NO_ACTIVITY'
  | 'NORMAL';

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
  healthScore: number | null;
  healthLabel: HealthLabel | null;
  managerSentence: string;
  bullets: string[];
  progress: {
    expectedSecondsSoFarTeam: number;
    activeSecondsTeam: number;
    progressPctTeam: number | null;
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
// TRENDS
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
// TEAM TOTALS
// ============================================================================

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

// ============================================================================
// DASHBOARD SUMMARY
// ============================================================================

export interface DashboardSummaryEnhanced {
  range: 'today' | '7d';
  totals: TeamTotals;
  story: DashboardStory;
  attention: AttentionResponse;
  rankings: RankingsResponse;
  topApps: TopAppEntry[];
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

export function secondsToShort(seconds: number): string {
  if (seconds < 3600) {
    return `${Math.round(seconds / 60)}m`;
  }
  return `${(seconds / 3600).toFixed(1)}h`;
}

export function tsToLocalTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

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

export function getAttentionEmptyMessage(mode: DashboardMode): { message: string; cta?: { label: string; action: string } } {
  switch (mode) {
    case 'NO_DEVICES':
      return { message: 'No devices paired.', cta: { label: 'Go to Pairing', action: 'pairing' } };
    case 'NO_DATA_YET':
      return { message: 'Waiting for first heartbeat today.', cta: { label: 'View Devices', action: 'devices' } };
    case 'PRE_SHIFT':
      return { message: 'No issues (pre-shift).' };
    case 'IN_SHIFT_NO_ACTIVITY':
      return { message: 'Low progress detected.' };
    case 'NORMAL':
      return { message: 'No issues detected. ✓' };
  }
}

export function formatDeltaPct(deltaPct: number): { text: string; color: string; arrow: string } {
  const pct = Math.round(deltaPct * 100);
  if (pct > 0) {
    return { text: `+${pct}%`, color: '#4CAF50', arrow: '↑' };
  } else if (pct < 0) {
    return { text: `${pct}%`, color: '#f44336', arrow: '↓' };
  }
  return { text: '0%', color: '#666', arrow: '→' };
}
