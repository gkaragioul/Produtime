/**
 * Admin Console Protocol Types
 * Shared between ProduTime user app (agent) and Admin Console
 *
 * COMPLIANCE: This is NOT spyware. All monitoring is explicit and user-visible.
 * - Pairing requires explicit user approval
 * - "Managed by Admin Console" indicator is always visible when paired
 * - Only aggregated stats are shared by default (no window titles unless explicitly enabled)
 */
export type AdminMessageType = 'HEARTBEAT' | 'STATS_SUMMARY' | 'PAIR_REQUEST' | 'PAIR_APPROVED' | 'PAIR_DENIED' | 'POLICY_PUSH' | 'EXPORT_REQUEST' | 'EXPORT_RESULT' | 'STATS_SNAPSHOT_REQUEST' | 'STATS_SNAPSHOT_RESULT' | 'LOCK' | 'UNLOCK' | 'UNPAIR' | 'ERROR' | 'ACK';
export interface BaseMessage {
    type: AdminMessageType;
    ts: number;
    nonce: string;
    deviceId: string;
    signature: string;
}
export interface PairRequestPayload {
    deviceName: string;
    devicePubKey: string;
    appVersion: string;
    osInfo: string;
    pairCode: string;
}
export interface PairApprovedPayload {
    adminName: string;
    adminPubKey: string;
    sessionToken: string;
    initialPolicy?: PolicyData;
}
export interface PairDeniedPayload {
    reason: string;
}
export interface HeartbeatPayload {
    appVersion: string;
    trackingStatus: 'active' | 'paused' | 'stopped';
    policyVersion: string;
    uptime: number;
    lastActivityAt: number;
}
export interface StatsSummaryPayload {
    period: 'last15m' | 'today' | 'custom';
    periodStart: number;
    periodEnd: number;
    totalActiveSeconds: number;
    totalIdleSeconds: number;
    topApps: AppSummary[];
    includeTitles: boolean;
}
export interface AppSummary {
    appName: string;
    totalSeconds: number;
    percentage: number;
    sampleTitles?: string[];
}
export interface PolicyData {
    version: string;
    updatedAt: number;
    workScheduleStart: string;
    workScheduleEnd: string;
    workScheduleWeekly?: Record<string, DaySchedule>;
    idleThreshold: number;
    privacyModeEnabled: boolean;
    privacyApps: string[];
    titleSharingEnabled: boolean;
    autoExportEnabled: boolean;
    autoExportTime: string;
    exportFolder?: string;
    reportRetentionDays: number;
    employeeName?: string;
}
export interface DaySchedule {
    start: string;
    end: string;
    nonWorking?: boolean;
}
export interface PolicyPushPayload {
    policy: PolicyData;
    force: boolean;
}
export interface ExportRequestPayload {
    reportType: 'daily' | 'weekly' | 'monthly' | 'custom';
    startDate: string;
    endDate: string;
    deliveryMode: 'upload' | 'local';
}
export interface ExportResultPayload {
    success: boolean;
    reportId?: string;
    filePath?: string;
    fileHash?: string;
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
export interface LockPayload {
    reason: string;
    message: string;
    allowUnlockCode?: string;
}
export interface UnlockPayload {
    message?: string;
}
export interface ErrorPayload {
    code: string;
    message: string;
    details?: any;
}
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
    payload: {
        reason: string;
    };
}
export interface ErrorMessage extends BaseMessage {
    type: 'ERROR';
    payload: ErrorPayload;
}
export interface AckMessage extends BaseMessage {
    type: 'ACK';
    payload: {
        ackNonce: string;
    };
}
export type AdminProtocolMessage = HeartbeatMessage | StatsSummaryMessage | PairRequestMessage | PairApprovedMessage | PairDeniedMessage | PolicyPushMessage | ExportRequestMessage | ExportResultMessage | StatsSnapshotRequestMessage | StatsSnapshotResultMessage | LockMessage | UnlockMessage | UnpairMessage | ErrorMessage | AckMessage;
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
}
export interface EffectivePolicy {
    key: string;
    value: string;
    updatedAt: number;
    source: 'admin' | 'local';
}
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
export declare const ADMIN_CONSOLE_DEFAULT_PORT = 17888;
export declare const HEARTBEAT_INTERVAL_MS = 10000;
export declare const STATS_SUMMARY_INTERVAL_MS = 60000;
export declare const NONCE_EXPIRY_MS = 300000;
export declare const SESSION_TOKEN_EXPIRY_MS = 86400000;
export declare const RECONNECT_DELAY_MS = 5000;
export declare const MAX_RECONNECT_ATTEMPTS = 10;
export declare const MDNS_SERVICE_TYPE = "_produtime-admin._tcp";
export declare const MDNS_SERVICE_NAME = "ProduTime Admin Console";
//# sourceMappingURL=admin-protocol.d.ts.map