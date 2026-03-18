export interface ElectronAPI {
    getVersion: () => string;
    getPlatform: () => string;
    getActivityLogs: (request: GetActivityLogsRequest) => Promise<IPCResponse<ActivityLog[]>>;
    getActivityLogsByDate: (request: GetActivityLogsByDateRequest) => Promise<IPCResponse<ActivityLog[]>>;
    insertActivityLog: (request: InsertActivityLogRequest) => Promise<IPCResponse<number>>;
    getSetting: (request: GetSettingRequest) => Promise<IPCResponse<string | null>>;
    setSetting: (request: SetSettingRequest) => Promise<IPCResponse<void>>;
    getAllSettings: () => Promise<IPCResponse<Setting[]>>;
    getWorkScheduleForDay: (request: WorkScheduleForDayRequest) => Promise<IPCResponse<WorkScheduleForDay>>;
    getAnalytics: (request: GetAnalyticsRequest) => Promise<IPCResponse<Analytics[]>>;
    insertAnalytics: (request: InsertAnalyticsRequest) => Promise<IPCResponse<number>>;
    clearAllData: () => Promise<IPCResponse<void>>;
    getDbHealth: () => Promise<IPCResponse<boolean>>;
    checkForUpdates: () => Promise<IPCResponse<void>>;
    downloadUpdate: () => Promise<IPCResponse<void>>;
    installUpdate: () => Promise<IPCResponse<void>>;
    getUpdateStatus: () => Promise<IPCResponse<UpdateState>>;
    getLastUpdateCheckTime: () => Promise<IPCResponse<string | null>>;
    openUpdateLogs: () => Promise<IPCResponse<void>>;
    onUpdateStatusChanged: (callback: (status: UpdateState) => void) => () => void;
    onActivityChanged: (callback: (activity: any) => void) => () => void;
    startTracking: () => Promise<IPCResponse<void>>;
    stopTracking: () => Promise<IPCResponse<void>>;
    generateReport: (request: GenerateReportRequest) => Promise<IPCResponse<GenerateReportResponse>>;
    getReportData: (options: ReportOptions) => Promise<IPCResponse<ReportData>>;
    saveReport: (reportId: string, filePath: string) => Promise<IPCResponse<void>>;
    openReport: (filePath: string) => Promise<IPCResponse<void>>;
    showTrayNotification: (notification: TrayNotification) => Promise<IPCResponse<void>>;
    updateTrayState: (state: Partial<TrayState>) => Promise<IPCResponse<void>>;
    getTrayState: () => Promise<IPCResponse<TrayState>>;
    toggleWindowVisibility: () => Promise<IPCResponse<void>>;
    quitApplication: () => Promise<IPCResponse<void>>;
    onTrayNotificationClicked: (callback: (notificationId: string) => void) => () => void;
    onTrayActionTriggered: (callback: (actionId: string) => void) => () => void;
    adminLogin: (request: AdminLoginRequest) => Promise<IPCResponse<AdminLoginResponse>>;
    getAdminLockoutState: () => Promise<IPCResponse<AdminLockoutState>>;
    resetAdminLockout: () => Promise<IPCResponse<void>>;
    getEmailConfig: () => Promise<IPCResponse<any>>;
    saveEmailConfig: (config: any) => Promise<IPCResponse<any>>;
    testEmail: () => Promise<IPCResponse<any>>;
    bulkUpdateSettings: (settings: Record<string, string>) => Promise<IPCResponse<void>>;
    getCurrentActivity: () => Promise<any>;
    getTrackingStats: () => Promise<any>;
    selectExportFolder: () => Promise<IPCResponse<string | null>>;
    testAutoExport: () => Promise<IPCResponse<GenerateReportResponse>>;
    getDeviceId: () => Promise<IPCResponse<string>>;
    activateLicense: (request: ActivateLicenseRequest) => Promise<IPCResponse<ActivationResponse>>;
    validateActivation: () => Promise<IPCResponse<ActivationStatus>>;
    startTrial: () => Promise<IPCResponse<ActivationResponse>>;
    onLicenseLockout: (callback: (status: ActivationStatus) => void) => () => void;
    onOpenActivation: (callback: () => void) => () => void;
}
// Enhanced API interface for v1.8 licensing
export interface EnhancedAPI {
    getLicenseStatus: () => Promise<IPCResponse<any>>;
    startTrial: () => Promise<IPCResponse<{ success: boolean; error?: string }>>;
    activateLicense: (licenseKey: string) => Promise<IPCResponse<{ success: boolean; error?: string }>>;
}

declare global {
    interface Window {
        electronAPI: ElectronAPI;
        api: EnhancedAPI;
    }
}
export interface IPCMessage {
    type: string;
    payload?: any;
}
export interface IPCResponse<T = any> {
    success: boolean;
    data?: T;
    error?: string;
}
export declare enum IPCChannels {
    GET_ACTIVITY_LOGS = "activity:getLogs",
    GET_ACTIVITY_LOGS_BY_DATE = "activity:getLogsByDate",
    INSERT_ACTIVITY_LOG = "activity:insertLog",
    GET_SETTING = "settings:get",
    SET_SETTING = "settings:set",
    GET_ALL_SETTINGS = "settings:getAll",
    SETTINGS_GET_WORK_SCHEDULE_FOR_DAY = "settings:getWorkScheduleForDay",
    GET_ANALYTICS = "analytics:get",
    INSERT_ANALYTICS = "analytics:insert",
    CLEAR_ALL_DATA = "database:clearAll",
    GET_DB_HEALTH = "database:health",
    CHECK_FOR_UPDATES = "updater:checkForUpdates",
    DOWNLOAD_UPDATE = "updater:downloadUpdate",
    INSTALL_UPDATE = "updater:installUpdate",
    GET_UPDATE_STATUS = "updater:getStatus",
    GET_LAST_UPDATE_CHECK_TIME = "updater:getLastCheckTime",
    OPEN_UPDATE_LOGS = "updater:openLogs",
    UPDATE_STATUS_CHANGED = "updater:statusChanged",
    ACTIVITY_START = "activity:start",
    ACTIVITY_STOP = "activity:stop",
    ACTIVITY_PAUSE = "activity:pause",
    ACTIVITY_RESUME = "activity:resume",
    GENERATE_REPORT = "reports:generate",
    GET_REPORT_DATA = "reports:getData",
    SAVE_REPORT = "reports:save",
    OPEN_REPORT = "reports:open",
    SHOW_TRAY_NOTIFICATION = "tray:showNotification",
    UPDATE_TRAY_STATE = "tray:updateState",
    GET_TRAY_STATE = "tray:getState",
    TOGGLE_WINDOW_VISIBILITY = "tray:toggleWindow",
    QUIT_APPLICATION = "tray:quitApp",
    SELECT_EXPORT_FOLDER = "settings:selectExportFolder",
    TEST_AUTO_EXPORT = "autoexport:test",
    TRAY_NOTIFICATION_CLICKED = "tray:notificationClicked",
    TRAY_ACTION_TRIGGERED = "tray:actionTriggered",
    ADMIN_LOGIN = "admin:login",
    ADMIN_GET_LOCKOUT_STATE = "admin:getLockoutState",
    ADMIN_RESET_LOCKOUT = "admin:resetLockout",
    BULK_UPDATE_SETTINGS = "settings:bulkUpdate",
    GET_DEVICE_ID = "license:getDeviceId",
    ACTIVATE_LICENSE = "license:activate",
    VALIDATE_ACTIVATION = "license:validate",
    START_TRIAL = "license:startTrial"
}
export interface GetActivityLogsRequest {
    limit?: number;
    offset?: number;
}
export interface GetActivityLogsByDateRequest {
    startDate: string;
    endDate: string;
}
export interface InsertActivityLogRequest {
    timestamp: string;
    app_name: string;
    window_title: string;
    duration: number;
}
export interface GetSettingRequest {
    key: string;
}
export interface SetSettingRequest {
    key: string;
    value: string;
}
export interface WorkScheduleForDayRequest {
    dateISO: string;
}
export interface WorkScheduleForDay {
    start: string;
    end: string;
    nonWorking: boolean;
    overnight: boolean;
    source: 'weekly' | 'flat' | 'default';
}
export interface GetAnalyticsRequest {
    metricName?: string;
}
export interface InsertAnalyticsRequest {
    metric_name: string;
    metric_value: number;
}
export interface AdminLoginRequest {
    password: string;
    ipAddress?: string;
}
export interface AdminLoginResponse {
    success: boolean;
    isLockedOut: boolean;
    lockoutExpiresAt?: string;
    failedAttempts: number;
    maxAttempts: number;
}
export interface UpdateInfo {
    version: string;
    releaseDate: string;
    releaseNotes?: string;
    downloadUrl?: string;
    assetName?: string;
}
export interface UpdateProgress {
    bytesPerSecond: number;
    percent: number;
    transferred: number;
    total: number;
}
export declare enum UpdateStatus {
    CHECKING = "checking-for-update",
    AVAILABLE = "update-available",
    NOT_AVAILABLE = "update-not-available",
    DOWNLOADING = "download-progress",
    DOWNLOADED = "update-downloaded",
    ERROR = "error"
}
export interface UpdateState {
    status: UpdateStatus;
    info?: UpdateInfo;
    progress?: UpdateProgress;
    error?: string;
}
export declare enum ReportType {
    DAILY = "daily",
    WEEKLY = "weekly",
    MONTHLY = "monthly",
    CUSTOM = "custom"
}
export declare enum ReportFormat {
    PDF = "pdf",
    HTML = "html"
}
export interface ReportDateRange {
    startDate: string;
    endDate: string;
}
export interface ReportOptions {
    type: ReportType;
    format: ReportFormat;
    dateRange: ReportDateRange;
    includeCharts: boolean;
    includeSummary: boolean;
    includeDetails: boolean;
    title?: string;
    useEnhancedAnalytics?: boolean;
}
export interface ReportData {
    title: string;
    dateRange: ReportDateRange;
    summary: {
        totalHours: number;
        totalSessions: number;
        averageSessionLength: number;
        mostActiveDay: string;
        mostActiveHour: number;
    };
    activityLogs: ActivityLog[];
    analytics: Analytics[];
    chartData?: {
        dailyHours: {
            date: string;
            hours: number;
        }[];
        hourlyDistribution: {
            hour: number;
            sessions: number;
        }[];
        activityBreakdown: {
            activity: string;
            hours: number;
        }[];
    };
}
export interface SessionSnapshot {
    sessionStartISO: string;
    sessionDurationSeconds: number;
    activeSeconds: number;
    idleSeconds: number;
    recentActivities: ActivityLog[];
}
export interface GenerateReportRequest {
    options: ReportOptions;
    sessionSnapshot?: SessionSnapshot;
}
export interface GenerateReportResponse {
    reportId: string;
    filePath: string;
    fileName: string;
    fileSize: number;
}
export declare enum TrayNotificationType {
    INFO = "info",
    SUCCESS = "success",
    WARNING = "warning",
    ERROR = "error"
}
export interface TrayNotification {
    title: string;
    body: string;
    type: TrayNotificationType;
    duration?: number;
    actions?: TrayNotificationAction[];
}
export interface TrayNotificationAction {
    id: string;
    label: string;
    type: 'button' | 'reply';
}
export interface TrayMenuAction {
    id: string;
    label: string;
    enabled: boolean;
    checked?: boolean;
    submenu?: TrayMenuAction[];
}
export interface TrayState {
    isVisible: boolean;
    isTrackingActive: boolean;
    lastActivity?: string;
    unreadNotifications: number;
}
export interface ActivityLog {
    id?: number;
    timestamp: string;
    app_name: string;
    window_title: string;
    duration: number;
}
export interface Setting {
    key: string;
    value: string;
}
export interface Analytics {
    id?: number;
    metric_name: string;
    metric_value: number;
    recorded_at: string;
}
export interface AdminLoginAttempt {
    id?: number;
    ip_address: string | null;
    attempted_at: string;
    success: boolean;
}
export interface AdminLockoutState {
    id: number;
    is_locked: boolean;
    locked_until: string | null;
    failed_attempts_count: number;
    last_attempt_at: string | null;
    created_at: string;
    updated_at: string;
}
export interface Migration {
    version: number;
    description: string;
    up: string;
    down?: string;
}
export interface LicensePayload {
    ver?: number;
    lic?: string;
    prod?: string;
    act?: string;
    exp?: number | null;
    iat?: number;
    version?: number;
    licenseId?: string;
    productCode?: string;
    activationUrl?: string;
    expiryDate?: string | null;
    issuedAt?: string;
    plan: 'basic' | 'pro' | 'enterprise' | 'trial';
    seats?: number;
    metadata?: Record<string, any>;
    serverUrl?: string;
    srv?: string;
    server?: any;
    beacon?: string;
    bcn?: string;
    beaconUrl?: string;
}
export interface SignedLicense {
    payload: string;
    signature: string;
}
export interface LicenseKey {
    licenseId: string;
    productCode: string;
    plan: 'basic' | 'pro' | 'enterprise' | 'trial';
    seats?: number;
    expiryDate?: string | null;
    issuedAt?: string;
    metadata?: Record<string, any>;
}
export interface ActivateLicenseRequest {
    licenseKey: string;
    deviceId: string;
}
export interface ManualActivationRequest {
    licenseKey: string;
    activationCode: string;
}
export interface ActivationResponse {
    success: boolean;
    activationCode?: string;
    expiryDate?: string;
    message?: string;
    error?: string;
    offline?: boolean;
}
export interface ActivationStatus {
    isActivated: boolean;
    licenseKey?: string;
    deviceId?: string;
    plan?: 'basic' | 'pro' | 'enterprise';
    expiryDate?: string | null;
    activatedAt?: string;
    requiresReactivation?: boolean;
    gracePeriodEndsAt?: string | null;
    isTrialMode?: boolean;
    trialEndsAt?: string | null;
    trialDaysRemaining?: number;
    message?: string;
}
export interface LicenseActivation {
    id?: number;
    license_key: string;
    device_id: string;
    activation_code: string;
    plan: string;
    expiry_date: string | null;
    activated_at: string;
    last_validated_at: string;
    created_at?: string;
    updated_at?: string;
}
//# sourceMappingURL=types.d.ts.map