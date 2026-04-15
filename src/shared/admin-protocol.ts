/**
 * Admin Console Protocol Types
 * Shared between ProduTime user app (agent) and Admin Console
 * 
 * COMPLIANCE: This is NOT spyware. All monitoring is explicit and user-visible.
 * - Pairing requires explicit user approval
 * - "Managed by Admin Console" indicator is always visible when paired
 * - Only aggregated stats are shared by default (no window titles unless explicitly enabled)
 */

// ============================================================================
// MESSAGE TYPES
// ============================================================================

export type AdminMessageType =
  | 'HEARTBEAT'
  | 'STATS_SUMMARY'
  | 'PAIR_REQUEST'
  | 'PAIR_APPROVED'
  | 'PAIR_DENIED'
  | 'IDENTIFY'
  | 'POLICY_PUSH'
  | 'EXPORT_REQUEST'
  | 'EXPORT_RESULT'
  | 'STATS_SNAPSHOT_REQUEST'
  | 'STATS_SNAPSHOT_RESULT'
  | 'LOCK'
  | 'UNLOCK'
  | 'UNPAIR'
  | 'SALES_REQUEST'
  | 'SALES_RESPONSE'
  | 'ERROR'
  | 'ACK';

// Base message structure - all messages include these fields
export interface BaseMessage {
  type: AdminMessageType;
  ts: number;           // Unix timestamp (ms)
  nonce: string;        // Unique nonce for replay protection
  deviceId: string;     // Device identifier
  signature: string;    // Ed25519 signature of {type, ts, nonce, deviceId, payload}
}

// ============================================================================
// PAIRING MESSAGES
// ============================================================================

export interface PairRequestPayload {
  deviceName: string;
  devicePubKey: string;     // Base64-encoded Ed25519 public key
  appVersion: string;
  osInfo: string;
  pairCode: string;         // 6-digit code entered by user
}

export interface PairApprovedPayload {
  adminName: string;
  adminPubKey: string;      // Base64-encoded Ed25519 public key
  sessionToken: string;     // Short-lived session token
  initialPolicy?: PolicyData;
  // Cloud pairing fields (Requirement 3.7, 11.1)
  wsEndpoint?: string;      // Cloud WebSocket endpoint URL
  tenantId?: string;        // Tenant ID for multi-tenant support
  tenantName?: string;      // Company/organization name for display
}

export interface PairDeniedPayload {
  reason: string;
}

// ============================================================================
// HEARTBEAT & STATS
// ============================================================================

export interface HeartbeatPayload {
  appVersion: string;
  trackingStatus: 'active' | 'paused' | 'stopped';
  policyVersion: string;    // Hash of current policy for sync detection
  uptime: number;           // Seconds since app start
  lastActivityAt: number;   // Unix timestamp of last activity
}

export interface StatsSummaryPayload {
  period: 'last15m' | 'today' | 'custom';
  periodStart: number;      // Unix timestamp
  periodEnd: number;        // Unix timestamp
  totalActiveSeconds: number;
  totalIdleSeconds: number;
  topApps: AppSummary[];    // Top 5 apps by time
  // Window titles only included if policy allows AND privacy mode permits
  includeTitles: boolean;
}

export interface AppSummary {
  appName: string;
  totalSeconds: number;
  percentage: number;
  // Only included if includeTitles is true
  sampleTitles?: string[];
}

// ============================================================================
// POLICY
// ============================================================================

export interface PolicyData {
  version: string;          // Policy version hash
  updatedAt: number;        // Unix timestamp
  
  // Work schedule
  workScheduleStart: string;  // HH:MM
  workScheduleEnd: string;    // HH:MM
  workScheduleWeekly?: Record<string, DaySchedule>;
  
  // Tracking settings
  idleThreshold: number;      // Seconds
  breakDuration?: number;     // Minutes — lunch/break allowance
  
  // Privacy settings
  privacyModeEnabled: boolean;
  privacyApps: string[];
  titleSharingEnabled: boolean;  // Default: false
  
  // Export settings
  autoExportEnabled: boolean;
  autoExportTime: string;       // HH:MM
  exportFolder?: string;
  
  // Report retention
  reportRetentionDays: number;
  
  // Employee info (can be set by admin)
  employeeName?: string;

  // Slack user id (set by admin; read-only on client)
  slackUserId?: string;

  // App categorization (synced from admin console)
  appCategories?: Record<string, 'productive' | 'neutral' | 'distracting'>;
}

export interface DaySchedule {
  start: string;    // HH:MM
  end: string;      // HH:MM
  nonWorking?: boolean;
}

export interface PolicyPushPayload {
  policy: PolicyData;
  force: boolean;   // If true, overwrite even if local version is newer
}

// ============================================================================
// EXPORT & SNAPSHOT
// ============================================================================

export interface ExportRequestPayload {
  reportType: 'daily' | 'weekly' | 'monthly' | 'custom';
  startDate: string;    // ISO date
  endDate: string;      // ISO date
  deliveryMode: 'upload' | 'local';  // Upload to admin or save locally
}

export interface ExportResultPayload {
  success: boolean;
  reportId?: string;
  filePath?: string;    // Local path if deliveryMode was 'local'
  fileHash?: string;    // SHA256 of file
  fileSize?: number;
  error?: string;
}

export interface StatsSnapshotRequestPayload {
  period: 'today' | 'week' | 'month' | 'custom';
  startDate?: string;
  endDate?: string;
}

export interface StatsSnapshotResultPayload {
  period: string;
  totalActiveSeconds: number;
  totalIdleSeconds: number;
  topApps: AppSummary[];
  dailyBreakdown?: DailyStats[];
}

export interface DailyStats {
  date: string;
  activeSeconds: number;
  idleSeconds: number;
  topApp: string;
}

// ============================================================================
// LOCK/UNLOCK
// ============================================================================

export interface LockPayload {
  reason: string;
  message: string;      // Message to display to user
  allowUnlockCode?: string;  // Optional code user can enter to unlock
}

export interface UnlockPayload {
  message?: string;
}

// ============================================================================
// ERROR
// ============================================================================

export interface ErrorPayload {
  code: string;
  message: string;
  details?: any;
}

// ============================================================================
// TYPED MESSAGE UNIONS
// ============================================================================

export interface HeartbeatMessage extends BaseMessage {
  type: 'HEARTBEAT';
  payload: HeartbeatPayload;
}

export interface StatsSummaryMessage extends BaseMessage {
  type: 'STATS_SUMMARY';
  payload: StatsSummaryPayload;
}

export interface PairRequestMessage extends BaseMessage {
  type: 'PAIR_REQUEST';
  payload: PairRequestPayload;
}

export interface PairApprovedMessage extends BaseMessage {
  type: 'PAIR_APPROVED';
  payload: PairApprovedPayload;
}

export interface PairDeniedMessage extends BaseMessage {
  type: 'PAIR_DENIED';
  payload: PairDeniedPayload;
}

export interface PolicyPushMessage extends BaseMessage {
  type: 'POLICY_PUSH';
  payload: PolicyPushPayload;
}

export interface ExportRequestMessage extends BaseMessage {
  type: 'EXPORT_REQUEST';
  payload: ExportRequestPayload;
}

export interface ExportResultMessage extends BaseMessage {
  type: 'EXPORT_RESULT';
  payload: ExportResultPayload;
}

export interface StatsSnapshotRequestMessage extends BaseMessage {
  type: 'STATS_SNAPSHOT_REQUEST';
  payload: StatsSnapshotRequestPayload;
}

export interface StatsSnapshotResultMessage extends BaseMessage {
  type: 'STATS_SNAPSHOT_RESULT';
  payload: StatsSnapshotResultPayload;
}

export interface LockMessage extends BaseMessage {
  type: 'LOCK';
  payload: LockPayload;
}

export interface UnlockMessage extends BaseMessage {
  type: 'UNLOCK';
  payload: UnlockPayload;
}

export interface UnpairMessage extends BaseMessage {
  type: 'UNPAIR';
  payload: { reason: string };
}

export interface SalesRequestPayload {
  requestId: string;
  range: 'day' | 'week' | 'month';
}

export interface SalesResponsePayload {
  requestId: string;
  counters?: {
    wins: number;
    losses: number;
    winRate: number;
    totalAmount: number;
    currency?: string | null;
  };
  recent?: Array<{
    client: string | null;
    destination: string | null;
    outcome: 'won' | 'lost';
    amount: number | null;
    currency: string | null;
    resolvedAt: string;
    permalink: string | null;
  }>;
  unconfigured?: boolean;
  unavailable?: boolean;
  error?: string;
}

export interface SalesRequestMessage extends BaseMessage {
  type: 'SALES_REQUEST';
  payload: SalesRequestPayload;
}

export interface SalesResponseMessage extends BaseMessage {
  type: 'SALES_RESPONSE';
  payload: SalesResponsePayload;
}

export interface ErrorMessage extends BaseMessage {
  type: 'ERROR';
  payload: ErrorPayload;
}

export interface AckMessage extends BaseMessage {
  type: 'ACK';
  payload: { ackNonce: string };
}

export type AdminProtocolMessage =
  | HeartbeatMessage
  | StatsSummaryMessage
  | PairRequestMessage
  | PairApprovedMessage
  | PairDeniedMessage
  | PolicyPushMessage
  | ExportRequestMessage
  | ExportResultMessage
  | StatsSnapshotRequestMessage
  | StatsSnapshotResultMessage
  | LockMessage
  | UnlockMessage
  | UnpairMessage
  | SalesRequestMessage
  | SalesResponseMessage
  | ErrorMessage
  | AckMessage;

// ============================================================================
// AGENT STATE
// ============================================================================

export interface AgentPairingState {
  paired: boolean;
  adminHost: string | null;
  adminName: string | null;
  adminPubKey: string | null;
  devicePubKey: string | null;
  devicePrivKeyEncrypted: string | null;
  pairedAt: number | null;
  lastConnectedAt: number | null;
  sessionToken: string | null;
  // Cloud pairing fields (Requirement 11.1)
  cloudWsEndpoint: string | null;
  tenantId: string | null;
  tenantName: string | null;
}

export interface EffectivePolicy {
  key: string;
  value: string;
  updatedAt: number;
  source: 'admin' | 'local';
}

// ============================================================================
// ADMIN CONSOLE STATE
// ============================================================================

export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  devicePubKey: string;
  pairedAt: number;
  lastSeen: number;
  status: 'online' | 'offline' | 'unknown';
  appVersion: string;
  ip: string;
  policyId?: string;
  trackingStatus?: 'active' | 'paused' | 'stopped';
  todayStats?: {
    activeSeconds: number;
    idleSeconds: number;
  };
}

export interface AdminPolicy {
  policyId: string;
  name: string;
  policyJson: string;
  updatedAt: number;
  deviceCount?: number;
}

export interface PendingPairRequest {
  requestId: string;
  deviceId: string;
  deviceName: string;
  devicePubKey: string;
  appVersion: string;
  osInfo: string;
  ip: string;
  requestedAt: number;
}

export interface AuditLogEntry {
  id: number;
  action: string;
  deviceId?: string;
  details: string;
  timestamp: number;
  adminUser: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

export const ADMIN_CONSOLE_DEFAULT_PORT = 17888;
export const HEARTBEAT_INTERVAL_MS = 10000;  // 10 seconds
export const STATS_SUMMARY_INTERVAL_MS = 60000;  // 1 minute
export const NONCE_EXPIRY_MS = 300000;  // 5 minutes
export const SESSION_TOKEN_EXPIRY_MS = 86400000;  // 24 hours
// Cloud connection constants (Requirement 11.3)
export const CLOUD_RECONNECT_BASE_DELAY_MS = 1000;  // 1 second base delay
export const CLOUD_RECONNECT_MAX_DELAY_MS = 60000;  // 60 seconds max delay

// Hardcoded cloud admin endpoint for managed deployments
export const CLOUD_ADMIN_WSS_URL = 'wss://wot-produtime-production.up.railway.app';
