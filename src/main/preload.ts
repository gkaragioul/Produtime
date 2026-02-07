import { contextBridge, ipcRenderer } from 'electron';

// Import types only (erased at compile time)
import type {
  IPCResponse,
  GetActivityLogsRequest,
  GetActivityLogsByDateRequest,
  InsertActivityLogRequest,
  GetSettingRequest,
  SetSettingRequest,
  GetAnalyticsRequest,
  InsertAnalyticsRequest,
  ActivityLog,
  Setting,
  Analytics,
  UpdateState,
  GenerateReportRequest,
  GenerateReportResponse,
  ReportOptions,
  ReportData,
  TrayNotification,
  TrayState,
  AdminLoginRequest,
  AdminLoginResponse,
  AdminLockoutState,
  WorkScheduleForDayRequest,
  WorkScheduleForDay,
  ActivateLicenseRequest,
  ActivationResponse,
  ActivationStatus,
  PrivacySettings,
} from '../shared/types';

// Inline IPC channel constants to avoid runtime module resolution in preload context
// This prevents failures like "module not found: ../shared/types.js" when Electron
// sandbox wraps the preload script.
const IPCChannels = {
  // Activity Logs
  GET_ACTIVITY_LOGS: 'activity:getLogs',
  GET_ACTIVITY_LOGS_BY_DATE: 'activity:getLogsByDate',
  INSERT_ACTIVITY_LOG: 'activity:insertLog',

  // Settings
  GET_SETTING: 'settings:get',
  SET_SETTING: 'settings:set',
  GET_ALL_SETTINGS: 'settings:getAll',
  SETTINGS_GET_WORK_SCHEDULE_FOR_DAY: 'settings:getWorkScheduleForDay',

  // Analytics
  GET_ANALYTICS: 'analytics:get',
  INSERT_ANALYTICS: 'analytics:insert',

  // Database Management
  CLEAR_ALL_DATA: 'database:clearAll',
  GET_DB_HEALTH: 'database:health',

  // Auto-updater
  CHECK_FOR_UPDATES: 'updater:checkForUpdates',
  DOWNLOAD_UPDATE: 'updater:downloadUpdate',
  INSTALL_UPDATE: 'updater:installUpdate',
  GET_UPDATE_STATUS: 'updater:getStatus',
  GET_LAST_UPDATE_CHECK_TIME: 'updater:getLastCheckTime',
  OPEN_UPDATE_LOGS: 'updater:openLogs',

  // Auto-updater events (main -> renderer)
  UPDATE_STATUS_CHANGED: 'updater:statusChanged',

  // PDF Reports
  GENERATE_REPORT: 'reports:generate',
  GET_REPORT_DATA: 'reports:getData',
  SAVE_REPORT: 'reports:save',
  OPEN_REPORT: 'reports:open',

  // System Tray
  SHOW_TRAY_NOTIFICATION: 'tray:showNotification',
  UPDATE_TRAY_STATE: 'tray:updateState',
  GET_TRAY_STATE: 'tray:getState',
  TOGGLE_WINDOW_VISIBILITY: 'tray:toggleWindow',
  QUIT_APPLICATION: 'tray:quitApp',

  // Activity control
  ACTIVITY_START: 'activity:start',
  ACTIVITY_STOP: 'activity:stop',
  ACTIVITY_PAUSE: 'activity:pause',
  ACTIVITY_RESUME: 'activity:resume',

  // Settings helpers
  SELECT_EXPORT_FOLDER: 'settings:selectExportFolder',

  // Auto-export testing
  TEST_AUTO_EXPORT: 'autoexport:test',

  // System Tray events (main -> renderer)
  TRAY_NOTIFICATION_CLICKED: 'tray:notificationClicked',
  TRAY_ACTION_TRIGGERED: 'tray:actionTriggered',

  // Admin Authentication
  ADMIN_LOGIN: 'admin:login',
  ADMIN_GET_LOCKOUT_STATE: 'admin:getLockoutState',
  ADMIN_RESET_LOCKOUT: 'admin:resetLockout',

  // Enhanced Settings Management
  BULK_UPDATE_SETTINGS: 'settings:bulkUpdate',

  // License Management
  GET_DEVICE_ID: 'license:getDeviceId',
  ACTIVATE_LICENSE: 'license:activate',
  VALIDATE_ACTIVATION: 'license:validate',
  START_TRIAL: 'license:startTrial',

  // System info
  GET_APP_VERSION: 'system:getAppVersion',
} as const;

// Debug: Log that preload script is running
console.log('🔧 Preload script executing...');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // System info
  getVersion: async () => {
    const response = await ipcRenderer.invoke('app:getVersion');
    return response.success ? response.data : '1.6.5';
  },
  getPlatform: () => process.platform,

  // Activity Logs API
  getActivityLogs: (
    request: GetActivityLogsRequest
  ): Promise<IPCResponse<ActivityLog[]>> =>
    ipcRenderer.invoke(IPCChannels.GET_ACTIVITY_LOGS, request),

  getActivityLogsByDate: (
    request: GetActivityLogsByDateRequest
  ): Promise<IPCResponse<ActivityLog[]>> =>
    ipcRenderer.invoke(IPCChannels.GET_ACTIVITY_LOGS_BY_DATE, request),

  insertActivityLog: (
    request: InsertActivityLogRequest
  ): Promise<IPCResponse<number>> =>
    ipcRenderer.invoke(IPCChannels.INSERT_ACTIVITY_LOG, request),

  // Activity control
  startTracking: (): Promise<IPCResponse<void>> =>
    ipcRenderer.invoke(IPCChannels.ACTIVITY_START),
  stopTracking: (): Promise<IPCResponse<void>> =>
    ipcRenderer.invoke(IPCChannels.ACTIVITY_STOP),
  pauseTracking: (): Promise<IPCResponse<void>> =>
    ipcRenderer.invoke(IPCChannels.ACTIVITY_PAUSE),
  resumeTracking: (): Promise<IPCResponse<void>> =>
    ipcRenderer.invoke(IPCChannels.ACTIVITY_RESUME),

  // Settings API
  getSetting: (
    request: GetSettingRequest
  ): Promise<IPCResponse<string | null>> =>
    ipcRenderer.invoke(IPCChannels.GET_SETTING, request),

  setSetting: (request: SetSettingRequest): Promise<IPCResponse<void>> =>
    ipcRenderer.invoke(IPCChannels.SET_SETTING, request),

  getAllSettings: (): Promise<IPCResponse<Setting[]>> =>
    ipcRenderer.invoke(IPCChannels.GET_ALL_SETTINGS),

  getWorkScheduleForDay: (
    request: WorkScheduleForDayRequest
  ): Promise<IPCResponse<WorkScheduleForDay>> =>
    ipcRenderer.invoke(IPCChannels.SETTINGS_GET_WORK_SCHEDULE_FOR_DAY, request),

  // Analytics API
  getAnalytics: (
    request: GetAnalyticsRequest
  ): Promise<IPCResponse<Analytics[]>> =>
    ipcRenderer.invoke(IPCChannels.GET_ANALYTICS, request),

  insertAnalytics: (
    request: InsertAnalyticsRequest
  ): Promise<IPCResponse<number>> =>
    ipcRenderer.invoke(IPCChannels.INSERT_ANALYTICS, request),

  // Database Management API
  clearAllData: (): Promise<IPCResponse<void>> =>
    ipcRenderer.invoke(IPCChannels.CLEAR_ALL_DATA),

  getDbHealth: (): Promise<IPCResponse<boolean>> =>
    ipcRenderer.invoke(IPCChannels.GET_DB_HEALTH),

  // Auto-updater API
  checkForUpdates: (): Promise<IPCResponse<void>> =>
    ipcRenderer.invoke(IPCChannels.CHECK_FOR_UPDATES),

  downloadUpdate: (): Promise<IPCResponse<void>> =>
    ipcRenderer.invoke(IPCChannels.DOWNLOAD_UPDATE),

  installUpdate: (): Promise<IPCResponse<void>> =>
    ipcRenderer.invoke(IPCChannels.INSTALL_UPDATE),

  getUpdateStatus: (): Promise<IPCResponse<UpdateState>> =>
    ipcRenderer.invoke(IPCChannels.GET_UPDATE_STATUS),

  getLastUpdateCheckTime: (): Promise<IPCResponse<string | null>> =>
    ipcRenderer.invoke(IPCChannels.GET_LAST_UPDATE_CHECK_TIME),

  openUpdateLogs: (): Promise<IPCResponse<void>> =>
    ipcRenderer.invoke(IPCChannels.OPEN_UPDATE_LOGS),

  // Event listeners for auto-updater
  onUpdateStatusChanged: (callback: (status: UpdateState) => void) => {
    const listener = (_event: any, status: UpdateState) => callback(status);
    ipcRenderer.on(IPCChannels.UPDATE_STATUS_CHANGED, listener);

    // Return cleanup function
    return () => {
      ipcRenderer.removeListener(IPCChannels.UPDATE_STATUS_CHANGED, listener);
    };
  },

  // Activity events (main -> renderer)
  onActivityChanged: (callback: (activity: any) => void) => {
    const listener = (_event: any, activity: any) => callback(activity);
    ipcRenderer.on('activity:changed', listener);
    return () => ipcRenderer.removeListener('activity:changed', listener);
  },

  // PDF Reports API
  generateReport: (
    request: GenerateReportRequest
  ): Promise<IPCResponse<GenerateReportResponse>> =>
    ipcRenderer.invoke(IPCChannels.GENERATE_REPORT, request),

  getReportData: (options: ReportOptions): Promise<IPCResponse<ReportData>> =>
    ipcRenderer.invoke(IPCChannels.GET_REPORT_DATA, options),

  saveReport: (
    reportId: string,
    filePath: string
  ): Promise<IPCResponse<void>> =>
    ipcRenderer.invoke(IPCChannels.SAVE_REPORT, reportId, filePath),

  openReport: (filePath: string): Promise<IPCResponse<void>> =>
    ipcRenderer.invoke(IPCChannels.OPEN_REPORT, filePath),

  // System Tray API
  showTrayNotification: (
    notification: TrayNotification
  ): Promise<IPCResponse<void>> =>
    ipcRenderer.invoke(IPCChannels.SHOW_TRAY_NOTIFICATION, notification),

  updateTrayState: (state: Partial<TrayState>): Promise<IPCResponse<void>> =>
    ipcRenderer.invoke(IPCChannels.UPDATE_TRAY_STATE, state),

  getTrayState: (): Promise<IPCResponse<TrayState>> =>
    ipcRenderer.invoke(IPCChannels.GET_TRAY_STATE),

  toggleWindowVisibility: (): Promise<IPCResponse<void>> =>
    ipcRenderer.invoke(IPCChannels.TOGGLE_WINDOW_VISIBILITY),

  quitApplication: (): Promise<IPCResponse<void>> =>
    ipcRenderer.invoke(IPCChannels.QUIT_APPLICATION),

  // Event listeners for system tray
  onTrayNotificationClicked: (callback: (notificationId: string) => void) => {
    const listener = (_event: any, notificationId: string) =>
      callback(notificationId);
    ipcRenderer.on(IPCChannels.TRAY_NOTIFICATION_CLICKED, listener);

    // Return cleanup function
    return () => {
      ipcRenderer.removeListener(
        IPCChannels.TRAY_NOTIFICATION_CLICKED,
        listener
      );
    };
  },

  onTrayActionTriggered: (callback: (actionId: string) => void) => {
    const listener = (_event: any, actionId: string) => callback(actionId);
    ipcRenderer.on(IPCChannels.TRAY_ACTION_TRIGGERED, listener);

    // Return cleanup function
    return () => {
      ipcRenderer.removeListener(IPCChannels.TRAY_ACTION_TRIGGERED, listener);
    };
  },

  // Admin Authentication API
  adminLogin: (
    request: AdminLoginRequest
  ): Promise<IPCResponse<AdminLoginResponse>> =>
    ipcRenderer.invoke(IPCChannels.ADMIN_LOGIN, request),

  getAdminLockoutState: (): Promise<IPCResponse<AdminLockoutState>> =>
    ipcRenderer.invoke(IPCChannels.ADMIN_GET_LOCKOUT_STATE),

  resetAdminLockout: (): Promise<IPCResponse<void>> =>
    ipcRenderer.invoke(IPCChannels.ADMIN_RESET_LOCKOUT),

  // Enhanced Settings Management API
  bulkUpdateSettings: (
    settings: Record<string, string>
  ): Promise<IPCResponse<void>> =>
    ipcRenderer.invoke(IPCChannels.BULK_UPDATE_SETTINGS, settings),

  // Settings helpers
  selectExportFolder: (): Promise<IPCResponse<string | null>> =>
    ipcRenderer.invoke(IPCChannels.SELECT_EXPORT_FOLDER),

  // Auto-export testing
  testAutoExport: (): Promise<IPCResponse<GenerateReportResponse>> =>
    ipcRenderer.invoke(IPCChannels.TEST_AUTO_EXPORT),

  // One-off getters for activity (optional)
  getCurrentActivity: (): Promise<any> =>
    ipcRenderer.invoke('activity:getCurrent'),

  getTrackingStats: (): Promise<any> => ipcRenderer.invoke('activity:getStats'),
  getActivityDiagnostics: (): Promise<any> =>
    ipcRenderer.invoke('activity:getDiagnostics'),

  // Startup configuration API
  hasStartupShortcut: (): Promise<IPCResponse<boolean>> =>
    ipcRenderer.invoke('startup:hasShortcut'),

  configureStartup: (enable: boolean): Promise<IPCResponse<boolean>> =>
    ipcRenderer.invoke('startup:configure', { enable }),

  openStartupFolder: (): Promise<IPCResponse<void>> =>
    ipcRenderer.invoke('startup:openFolder'),

  // License Management API (Legacy - for backward compatibility)
  getDeviceId: (): Promise<IPCResponse<string>> =>
    ipcRenderer.invoke(IPCChannels.GET_DEVICE_ID),

  activateLicenseLegacy: (
    request: ActivateLicenseRequest
  ): Promise<IPCResponse<ActivationResponse>> =>
    ipcRenderer.invoke(IPCChannels.ACTIVATE_LICENSE, request),

  validateActivation: (): Promise<IPCResponse<ActivationStatus>> =>
    ipcRenderer.invoke(IPCChannels.VALIDATE_ACTIVATION),

  startTrialLegacy: (): Promise<IPCResponse<ActivationResponse>> =>
    ipcRenderer.invoke(IPCChannels.START_TRIAL),

  // License lockout push event from main
  onLicenseLockout: (handler: (status: ActivationStatus) => void) => {
    ipcRenderer.removeAllListeners('license:lockout');
    const listener = (_event: any, status: ActivationStatus) => {
      try {
        handler(status);
      } catch {}
    };
    ipcRenderer.on('license:lockout', listener);
    // Return unsubscribe
    return () => ipcRenderer.removeListener('license:lockout', listener);
  },

  // Open License Activation modal on demand (from Help menu)
  onOpenActivation: (handler: () => void) => {
    ipcRenderer.removeAllListeners('license:openActivation');
    const listener = () => {
      try {
        handler();
      } catch {}
    };
    ipcRenderer.on('license:openActivation', listener);
    return () => ipcRenderer.removeListener('license:openActivation', listener);
  },

  // Enhanced Licensing API (v1.8)
  getLicenseStatus: (): Promise<IPCResponse<any>> =>
    ipcRenderer.invoke('license:getStatus'),

  startTrial: (): Promise<IPCResponse<{ success: boolean; error?: string }>> =>
    ipcRenderer.invoke('license:startTrial'),

  activateLicense: (licenseKey: string): Promise<IPCResponse<{ success: boolean; error?: string }>> =>
    ipcRenderer.invoke('license:activate', licenseKey),

  // Privacy Settings API
  getPrivacySettings: (): Promise<IPCResponse<PrivacySettings>> =>
    ipcRenderer.invoke('privacy:getSettings'),

  setPrivacyMode: (enabled: boolean): Promise<IPCResponse<void>> =>
    ipcRenderer.invoke('privacy:setMode', enabled),

  // Agent (Admin Console) API
  agentGetState: (): Promise<IPCResponse<any>> =>
    ipcRenderer.invoke('agent:getState'),

  agentGetPairingState: (): Promise<IPCResponse<any>> =>
    ipcRenderer.invoke('agent:getPairingState'),

  agentGetDiscoveredAdmins: (): Promise<IPCResponse<any[]>> =>
    ipcRenderer.invoke('agent:getDiscoveredAdmins'),

  agentStartPairing: (adminHost: string, pairCode: string): Promise<IPCResponse<{ success: boolean; error?: string }>> =>
    ipcRenderer.invoke('agent:startPairing', { adminHost, pairCode }),

  agentStartCloudPairing: (cloudApiUrl: string, pairCode: string): Promise<IPCResponse<{ success: boolean; error?: string }>> =>
    ipcRenderer.invoke('agent:startCloudPairing', { cloudApiUrl, pairCode }),

  agentUnpair: (): Promise<IPCResponse<void>> =>
    ipcRenderer.invoke('agent:unpair'),

  agentAddManualAdmin: (host: string, port?: number): Promise<IPCResponse<any>> =>
    ipcRenderer.invoke('agent:addManualAdmin', { host, port }),

  agentGetEffectivePolicy: (): Promise<IPCResponse<any>> =>
    ipcRenderer.invoke('agent:getEffectivePolicy'),

  agentIsManaged: (): Promise<IPCResponse<boolean>> =>
    ipcRenderer.invoke('agent:isManaged'),

  // Agent event listeners
  onAgentStateChanged: (callback: (state: any) => void) => {
    const listener = (_event: any, state: any) => callback(state);
    ipcRenderer.on('agent:stateChanged', listener);
    return () => ipcRenderer.removeListener('agent:stateChanged', listener);
  },

  onAgentLocked: (callback: (data: { reason: string; message: string }) => void) => {
    const listener = (_event: any, data: any) => callback(data);
    ipcRenderer.on('agent:locked', listener);
    return () => ipcRenderer.removeListener('agent:locked', listener);
  },

  onAgentUnlocked: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('agent:unlocked', listener);
    return () => ipcRenderer.removeListener('agent:unlocked', listener);
  },

  onAgentPolicyUpdated: (callback: (policy: any) => void) => {
    const listener = (_event: any, policy: any) => callback(policy);
    ipcRenderer.on('agent:policyUpdated', listener);
    return () => ipcRenderer.removeListener('agent:policyUpdated', listener);
  },

  // Open Pairing modal on demand (from Help menu)
  onOpenPairing: (handler: () => void) => {
    ipcRenderer.removeAllListeners('agent:openPairing');
    const listener = () => {
      try {
        handler();
      } catch {}
    };
    ipcRenderer.on('agent:openPairing', listener);
    return () => ipcRenderer.removeListener('agent:openPairing', listener);
  },
});

// Expose separate enhanced licensing API (v1.8) as window.api
contextBridge.exposeInMainWorld('api', {
  getLicenseStatus: (): Promise<IPCResponse<any>> =>
    ipcRenderer.invoke('license:getStatus'),

  startTrial: (): Promise<IPCResponse<{ success: boolean; error?: string }>> =>
    ipcRenderer.invoke('license:startTrial'),

  activateLicense: (licenseKey: string): Promise<IPCResponse<{ success: boolean; error?: string }>> =>
    ipcRenderer.invoke('license:activate', licenseKey),
});

// Debug: Log that electronAPI has been exposed
console.log('✅ electronAPI exposed to renderer process');
console.log('✅ api exposed to renderer process (v1.8 licensing)');
console.log(
  '🔍 Available methods:',
  Object.keys((global as any).electronAPI || {})
);
