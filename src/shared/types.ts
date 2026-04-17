// Shared types for IPC communication and data structures

export interface ElectronAPI {
  // System info
  getVersion: () => string;
  getPlatform: () => string;

  // Activity Logs API
  getActivityLogs: (
    request: GetActivityLogsRequest
  ) => Promise<IPCResponse<ActivityLog[]>>;
  getActivityLogsByDate: (
    request: GetActivityLogsByDateRequest
  ) => Promise<IPCResponse<ActivityLog[]>>;
  insertActivityLog: (
    request: InsertActivityLogRequest
  ) => Promise<IPCResponse<number>>;

  // Settings API
  getSetting: (
    request: GetSettingRequest
  ) => Promise<IPCResponse<string | null>>;
  setSetting: (request: SetSettingRequest) => Promise<IPCResponse<void>>;
  getAllSettings: () => Promise<IPCResponse<Setting[]>>;
  // Read-only schedule accessor
  getWorkScheduleForDay: (
    request: WorkScheduleForDayRequest
  ) => Promise<IPCResponse<WorkScheduleForDay>>;

  // Analytics API
  getAnalytics: (
    request: GetAnalyticsRequest
  ) => Promise<IPCResponse<Analytics[]>>;
  insertAnalytics: (
    request: InsertAnalyticsRequest
  ) => Promise<IPCResponse<number>>;

  // Database Management API
  clearAllData: () => Promise<IPCResponse<void>>;
  getDbHealth: () => Promise<IPCResponse<boolean>>;

  // Auto-updater API
  checkForUpdates: () => Promise<IPCResponse<void>>;
  downloadUpdate: () => Promise<IPCResponse<void>>;
  installUpdate: () => Promise<IPCResponse<void>>;
  getUpdateStatus: () => Promise<IPCResponse<UpdateState>>;
  onUpdateStatusChanged: (callback: (status: UpdateState) => void) => () => void;

  // Activity events (main -> renderer)
  onActivityChanged: (callback: (activity: any) => void) => () => void;

  // Activity control
  startTracking: () => Promise<IPCResponse<void>>;
  stopTracking: () => Promise<IPCResponse<void>>;

  getActivityDailySummary: (request: { startDate: string; endDate: string }) => Promise<IPCResponse<{ active: number; idle: number }>>;

  // PDF Reports API
  generateReport: (
    request: GenerateReportRequest
  ) => Promise<IPCResponse<GenerateReportResponse>>;
  getReportData: (options: ReportOptions) => Promise<IPCResponse<ReportData>>;
  saveReport: (
    reportId: string,
    filePath: string
  ) => Promise<IPCResponse<void>>;
  openReport: (filePath: string) => Promise<IPCResponse<void>>;

  // System Tray API
  showTrayNotification: (
    notification: TrayNotification
  ) => Promise<IPCResponse<void>>;
  updateTrayState: (state: Partial<TrayState>) => Promise<IPCResponse<void>>;
  getTrayState: () => Promise<IPCResponse<TrayState>>;
  toggleWindowVisibility: () => Promise<IPCResponse<void>>;
  quitApplication: () => Promise<IPCResponse<void>>;

  // Event listeners for system tray
  onTrayNotificationClicked: (
    callback: (notificationId: string) => void
  ) => () => void;
  onTrayActionTriggered: (callback: (actionId: string) => void) => () => void;

  // Admin Authentication API
  adminLogin: (
    request: AdminLoginRequest
  ) => Promise<IPCResponse<AdminLoginResponse>>;
  getAdminLockoutState: () => Promise<IPCResponse<AdminLockoutState>>;
  resetAdminLockout: (request?: {
    password?: string;
  }) => Promise<IPCResponse<void>>;

  // Email Configuration API
  getEmailConfig: () => Promise<IPCResponse<any>>;
  saveEmailConfig: (config: any) => Promise<IPCResponse<any>>;
  testEmail: () => Promise<IPCResponse<any>>;

  // Enhanced Settings Management API
  bulkUpdateSettings: (
    settings: Record<string, string>
  ) => Promise<IPCResponse<void>>;

  // Optional activity getters
  getCurrentActivity: () => Promise<any>;
  getTrackingStats: () => Promise<any>;

  // Settings helpers
  selectExportFolder: () => Promise<IPCResponse<string | null>>;

  // Auto-export testing
  testAutoExport: () => Promise<IPCResponse<GenerateReportResponse>>;

  // License Activation API
  getDeviceId: () => Promise<IPCResponse<string>>;
  activateLicense: (
    request: ActivateLicenseRequest
  ) => Promise<IPCResponse<ActivationResponse>>;
  validateActivation: () => Promise<IPCResponse<ActivationStatus>>;
  startTrial: () => Promise<IPCResponse<ActivationResponse>>;

  // License lockout push (main -> renderer)
  onLicenseLockout: (
    callback: (status: ActivationStatus) => void
  ) => () => void;

  // Open activation modal (main -> renderer)
  onOpenActivation: (callback: () => void) => () => void;

  // Privacy Settings API
  getPrivacySettings: () => Promise<IPCResponse<PrivacySettings>>;
  setPrivacyMode: (enabled: boolean) => Promise<IPCResponse<void>>;

  // Agent (Admin Console) API
  agentGetState: () => Promise<IPCResponse<any>>;
  agentGetPairingState: () => Promise<IPCResponse<any>>;
  agentStartCloudPairing: (cloudApiUrl: string, pairCode: string) => Promise<IPCResponse<{ success: boolean; error?: string }>>;
  agentUnpair: () => Promise<IPCResponse<void>>;
  agentGetEffectivePolicy: () => Promise<IPCResponse<any>>;
  agentIsManaged: () => Promise<IPCResponse<boolean>>;

  // Agent event listeners
  onAgentStateChanged?: (callback: (state: any) => void) => () => void;
  onAgentLocked?: (callback: (data: { reason: string; message: string }) => void) => () => void;
  onAgentUnlocked?: (callback: () => void) => () => void;
  onAgentPolicyUpdated?: (callback: (policy: any) => void) => () => void;

  // Open pairing modal (main -> renderer)
  onOpenPairing?: (callback: () => void) => () => void;
}

// Enhanced API interface for v1.8 licensing
export interface EnhancedAPI {
  getLicenseStatus: () => Promise<IPCResponse<any>>;
  startTrial: () => Promise<IPCResponse<{ success: boolean; error?: string }>>;
  activateLicense: (licenseKey: string) => Promise<IPCResponse<{ success: boolean; error?: string }>>;
}

// Extend the Window interface to include our API
declare global {
  interface Window {
    electronAPI: ElectronAPI;
    api: EnhancedAPI;
  }
}

// IPC Message types
export interface IPCMessage {
  type: string;
  payload?: any;
}

export interface IPCResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

// IPC Channel definitions
export enum IPCChannels {
  // Activity Logs
  GET_ACTIVITY_LOGS = 'activity:getLogs',
  GET_ACTIVITY_LOGS_BY_DATE = 'activity:getLogsByDate',
  INSERT_ACTIVITY_LOG = 'activity:insertLog',

  // Settings
  GET_SETTING = 'settings:get',
  SET_SETTING = 'settings:set',
  GET_ALL_SETTINGS = 'settings:getAll',
  // Read-only schedule accessor
  SETTINGS_GET_WORK_SCHEDULE_FOR_DAY = 'settings:getWorkScheduleForDay',

  // Analytics
  GET_ANALYTICS = 'analytics:get',
  INSERT_ANALYTICS = 'analytics:insert',

  // Database Management
  CLEAR_ALL_DATA = 'database:clearAll',
  GET_DB_HEALTH = 'database:health',

  // Auto-updater
  CHECK_FOR_UPDATES = 'updater:checkForUpdates',
  DOWNLOAD_UPDATE = 'updater:downloadUpdate',
  INSTALL_UPDATE = 'updater:installUpdate',
  GET_UPDATE_STATUS = 'updater:getStatus',
  OPEN_UPDATE_RELEASES_PAGE = 'updater:openReleasesPage',

  // Auto-updater events (main -> renderer)
  UPDATE_STATUS_CHANGED = 'updater:statusChanged',

  // Activity control
  ACTIVITY_START = 'activity:start',
  ACTIVITY_STOP = 'activity:stop',
  ACTIVITY_PAUSE = 'activity:pause',
  ACTIVITY_RESUME = 'activity:resume',

  // PDF Reports
  GENERATE_REPORT = 'reports:generate',
  GET_REPORT_DATA = 'reports:getData',
  SAVE_REPORT = 'reports:save',
  OPEN_REPORT = 'reports:open',

  // System Tray
  SHOW_TRAY_NOTIFICATION = 'tray:showNotification',
  UPDATE_TRAY_STATE = 'tray:updateState',
  GET_TRAY_STATE = 'tray:getState',
  TOGGLE_WINDOW_VISIBILITY = 'tray:toggleWindow',
  QUIT_APPLICATION = 'tray:quitApp',

  // Settings helpers
  SELECT_EXPORT_FOLDER = 'settings:selectExportFolder',

  // Auto-export testing
  TEST_AUTO_EXPORT = 'autoexport:test',

  // System Tray events (main -> renderer)
  TRAY_NOTIFICATION_CLICKED = 'tray:notificationClicked',
  TRAY_ACTION_TRIGGERED = 'tray:actionTriggered',

  // Admin Authentication
  ADMIN_LOGIN = 'admin:login',
  ADMIN_GET_LOCKOUT_STATE = 'admin:getLockoutState',
  ADMIN_RESET_LOCKOUT = 'admin:resetLockout',

  // Enhanced Settings Management
  BULK_UPDATE_SETTINGS = 'settings:bulkUpdate',

  // License Activation
  GET_DEVICE_ID = 'license:getDeviceId',
  ACTIVATE_LICENSE = 'license:activate',
  VALIDATE_ACTIVATION = 'license:validate',
  START_TRIAL = 'license:startTrial',
}

// IPC Request/Response types
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
  dateISO: string; // reference date; local weekday is used
}

export interface WorkScheduleForDay {
  start: string; // HH:MM
  end: string; // HH:MM
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

// Auto-updater types
export interface UpdateInfo {
  version: string;
  releaseDate: string;
  releaseNotes?: string;
  downloadUrl?: string; // May be a GitHub asset URL (API or browser URL)
  assetName?: string; // Name of the asset file (e.g., ProduTime.1.6.7.exe)
  sha256?: string; // SHA256 checksum for download verification
  fileSize?: number; // Expected file size in bytes
}

export interface UpdateProgress {
  bytesPerSecond: number;
  percent: number;
  transferred: number;
  total: number;
}

export enum UpdateStatus {
  CHECKING = 'checking-for-update',
  AVAILABLE = 'update-available',
  NOT_AVAILABLE = 'update-not-available',
  DOWNLOADING = 'download-progress',
  DOWNLOADED = 'update-downloaded',
  ERROR = 'error',
}

export interface UpdateState {
  status: UpdateStatus;
  info?: UpdateInfo;
  progress?: UpdateProgress;
  error?: string;
}

// PDF Report types
export enum ReportType {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
  CUSTOM = 'custom',
}

export enum ReportFormat {
  PDF = 'pdf',
  HTML = 'html',
}

export interface ReportDateRange {
  startDate: string; // ISO date string
  endDate: string; // ISO date string
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
    dailyHours: { date: string; hours: number }[];
    hourlyDistribution: { hour: number; sessions: number }[];
    activityBreakdown: { activity: string; hours: number }[];
  };
}

export interface ApplicationCategory {
  name: string;
  applications: string[];
  totalTime: number;
  percentage: number;
  color: string;
}

export interface HourlyActivity {
  hour: number;
  totalTime: number;
  activeTime: number;
  idleTime: number;
  sessionCount: number;
  topApplications: { name: string; time: number }[];
}

export interface ProductivityMetrics {
  productivityScore: number;
  focusScore: number;
  distractionTime: number;
  mostProductiveHour: number;
  leastProductiveHour: number;
  averageSessionLength: number;
  contextSwitches: number;
}

export interface SessionDetail {
  startTime: string;
  endTime: string;
  duration: number;
  applications: { name: string; time: number; percentage: number }[];
  breaks: { start: string; end: string; duration: number }[];
  productivity: number;
}

export interface ComprehensiveReportData extends ReportData {
  applicationCategories: ApplicationCategory[];
  hourlyTimeline: HourlyActivity[];
  productivityMetrics: ProductivityMetrics;
  sessionDetails: SessionDetail[];
  workSchedule: {
    start: string;
    end: string;
    scheduledHours: number;
    actualHours: number;
    efficiency: number;
  };
  topApplications: {
    name: string;
    time: number;
    percentage: number;
    category: string;
  }[];
  timeDistribution: {
    workTime: number;
    breakTime: number;
    overtimeHours: number;
    undertimeHours: number;
  };
  isTruncated?: boolean;
  truncatedAtLimit?: number;
  enhancedAnalytics?: {
    userInfo: {
      employeeName: string;
      computerName: string;
      ipAddress: string;
      reportGeneratedAt: string;
    };
    scheduleAnalysis: {
      scheduledHours: number;
      actualActiveHours: number;
      actualIdleHours: number;
      productivePercentage: number;
      overtimeHours: number;
      undertimeHours: number;
      nonWorkingDays: string[];
    };
    applicationBreakdown: Array<{
      appName: string;
      totalSeconds: number;
      percentage: number;
      category?: string;
    }>;
    hourlyBreakdown: Array<{
      hour: number;
      scheduledMinutes: number;
      activeMinutes: number;
      idleMinutes: number;
      topApps: Array<{ name: string; minutes: number }>;
    }>;
  };
}

export interface SessionSnapshot {
  sessionStartISO: string; // ISO timestamp for session start (from dashboard)
  sessionDurationSeconds: number;
  activeSeconds: number;
  idleSeconds: number;
  recentActivities: ActivityLog[]; // include ongoing synthetic first entry if desired
}

export interface GenerateReportRequest {
  options: ReportOptions;
  // Optional snapshot to drive a simplified, single-page session report that must
  // match the dashboard exactly. When provided, the main process will not query
  // the database for analytics/charts and will render a minimal one-page PDF from
  // this snapshot only.
  sessionSnapshot?: SessionSnapshot;
}

export interface GenerateReportResponse {
  reportId: string;
  filePath: string;
  fileName: string;
  fileSize: number;
}

// System Tray types
export enum TrayNotificationType {
  INFO = 'info',
  SUCCESS = 'success',
  WARNING = 'warning',
  ERROR = 'error',
}

export interface TrayNotification {
  title: string;
  body: string;
  type: TrayNotificationType;
  duration?: number; // in milliseconds, 0 for persistent
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

// Database Schema Types
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

// Database Migration Types
export interface Migration {
  version: number;
  description: string;
  up: string;
  down?: string;
}

// License Activation Types (unified shape to support both legacy and new keys)
export interface LicensePayload {
  // New payload fields (License Manager)
  ver?: number; // numeric version
  lic?: string; // license id
  prod?: string; // product code (e.g., 'PT')
  act?: string; // activation URL
  exp?: number | null; // expiry timestamp (seconds)
  iat?: number; // issued-at timestamp (seconds)

  // Legacy/alternate fields (older clients or tools)
  version?: number;
  licenseId?: string;
  productCode?: string;
  activationUrl?: string;
  expiryDate?: string | null; // ISO date
  issuedAt?: string; // ISO date

  // Common fields
  plan: 'basic' | 'pro' | 'enterprise' | 'trial';
  seats?: number;
  metadata?: Record<string, any>;
  serverUrl?: string; // alternate hints
  srv?: string;
  server?: any;
  // Beacon hints for server URL recovery (Dropbox share link)
  beacon?: string;
  bcn?: string;
  beaconUrl?: string;
}

export interface SignedLicense {
  payload: string; // base64 or base64url encoded JSON payload
  signature: string; // base64 or base64url encoded Ed25519 signature
}

// Back-compat type alias used in some modules/tests
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
  licenseKey: string; // Full license key string (payload.signature)
  deviceId: string;
}

export interface ManualActivationRequest {
  licenseKey: string; // Full license key string (payload.signature)
  activationCode: string; // Manually provided activation code
}

export interface ActivationResponse {
  success: boolean;
  activationCode?: string; // Returned on successful activation
  expiryDate?: string; // Expiry date for trial or license
  message?: string;
  error?: string;
  offline?: boolean; // True if activated in offline mode
}

export interface ActivationStatus {
  isActivated: boolean;
  licenseKey?: string;
  deviceId?: string;
  plan?: 'basic' | 'pro' | 'enterprise';
  expiryDate?: string | null;
  activatedAt?: string;
  requiresReactivation?: boolean; // True if hardware changed
  gracePeriodEndsAt?: string | null; // If in grace period
  isTrialMode?: boolean; // True if in trial mode
  trialEndsAt?: string | null; // When trial expires
  trialDaysRemaining?: number; // Days remaining in trial
  message?: string;
}

export interface LicenseActivation {
  id?: number;
  license_key: string; // Stored encrypted
  device_id: string;
  activation_code: string; // Stored encrypted
  plan: string;
  expiry_date: string | null;
  activated_at: string;
  last_validated_at: string;
  created_at?: string;
  updated_at?: string;
}

// Privacy Mode Types
export interface PrivacySettings {
  privacyModeEnabled: boolean;
  privacyApps: string[];
}

export interface SanitizationResult {
  appName: string;
  windowTitle: string;
  wasSanitized: boolean;
}
