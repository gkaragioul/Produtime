"use strict";
// Shared types for IPC communication and data structures
Object.defineProperty(exports, "__esModule", { value: true });
exports.TrayNotificationType = exports.ReportFormat = exports.ReportType = exports.UpdateStatus = exports.IPCChannels = void 0;
// IPC Channel definitions
var IPCChannels;
(function (IPCChannels) {
    // Activity Logs
    IPCChannels["GET_ACTIVITY_LOGS"] = "activity:getLogs";
    IPCChannels["GET_ACTIVITY_LOGS_BY_DATE"] = "activity:getLogsByDate";
    IPCChannels["INSERT_ACTIVITY_LOG"] = "activity:insertLog";
    // Settings
    IPCChannels["GET_SETTING"] = "settings:get";
    IPCChannels["SET_SETTING"] = "settings:set";
    IPCChannels["GET_ALL_SETTINGS"] = "settings:getAll";
    // Read-only schedule accessor
    IPCChannels["SETTINGS_GET_WORK_SCHEDULE_FOR_DAY"] = "settings:getWorkScheduleForDay";
    // Analytics
    IPCChannels["GET_ANALYTICS"] = "analytics:get";
    IPCChannels["INSERT_ANALYTICS"] = "analytics:insert";
    // Database Management
    IPCChannels["CLEAR_ALL_DATA"] = "database:clearAll";
    IPCChannels["GET_DB_HEALTH"] = "database:health";
    // Auto-updater
    IPCChannels["CHECK_FOR_UPDATES"] = "updater:checkForUpdates";
    IPCChannels["DOWNLOAD_UPDATE"] = "updater:downloadUpdate";
    IPCChannels["INSTALL_UPDATE"] = "updater:installUpdate";
    IPCChannels["GET_UPDATE_STATUS"] = "updater:getStatus";
    IPCChannels["GET_LAST_UPDATE_CHECK_TIME"] = "updater:getLastCheckTime";
    IPCChannels["OPEN_UPDATE_LOGS"] = "updater:openLogs";
    // Auto-updater events (main -> renderer)
    IPCChannels["UPDATE_STATUS_CHANGED"] = "updater:statusChanged";
    // Activity control
    IPCChannels["ACTIVITY_START"] = "activity:start";
    IPCChannels["ACTIVITY_STOP"] = "activity:stop";
    IPCChannels["ACTIVITY_PAUSE"] = "activity:pause";
    IPCChannels["ACTIVITY_RESUME"] = "activity:resume";
    // PDF Reports
    IPCChannels["GENERATE_REPORT"] = "reports:generate";
    IPCChannels["GET_REPORT_DATA"] = "reports:getData";
    IPCChannels["SAVE_REPORT"] = "reports:save";
    IPCChannels["OPEN_REPORT"] = "reports:open";
    // System Tray
    IPCChannels["SHOW_TRAY_NOTIFICATION"] = "tray:showNotification";
    IPCChannels["UPDATE_TRAY_STATE"] = "tray:updateState";
    IPCChannels["GET_TRAY_STATE"] = "tray:getState";
    IPCChannels["TOGGLE_WINDOW_VISIBILITY"] = "tray:toggleWindow";
    IPCChannels["QUIT_APPLICATION"] = "tray:quitApp";
    // Settings helpers
    IPCChannels["SELECT_EXPORT_FOLDER"] = "settings:selectExportFolder";
    // Auto-export testing
    IPCChannels["TEST_AUTO_EXPORT"] = "autoexport:test";
    // System Tray events (main -> renderer)
    IPCChannels["TRAY_NOTIFICATION_CLICKED"] = "tray:notificationClicked";
    IPCChannels["TRAY_ACTION_TRIGGERED"] = "tray:actionTriggered";
    // Admin Authentication
    IPCChannels["ADMIN_LOGIN"] = "admin:login";
    IPCChannels["ADMIN_GET_LOCKOUT_STATE"] = "admin:getLockoutState";
    IPCChannels["ADMIN_RESET_LOCKOUT"] = "admin:resetLockout";
    // Enhanced Settings Management
    IPCChannels["BULK_UPDATE_SETTINGS"] = "settings:bulkUpdate";
    // License Activation
    IPCChannels["GET_DEVICE_ID"] = "license:getDeviceId";
    IPCChannels["ACTIVATE_LICENSE"] = "license:activate";
    IPCChannels["VALIDATE_ACTIVATION"] = "license:validate";
    IPCChannels["START_TRIAL"] = "license:startTrial";
})(IPCChannels || (exports.IPCChannels = IPCChannels = {}));
var UpdateStatus;
(function (UpdateStatus) {
    UpdateStatus["CHECKING"] = "checking-for-update";
    UpdateStatus["AVAILABLE"] = "update-available";
    UpdateStatus["NOT_AVAILABLE"] = "update-not-available";
    UpdateStatus["DOWNLOADING"] = "download-progress";
    UpdateStatus["DOWNLOADED"] = "update-downloaded";
    UpdateStatus["ERROR"] = "error";
})(UpdateStatus || (exports.UpdateStatus = UpdateStatus = {}));
// PDF Report types
var ReportType;
(function (ReportType) {
    ReportType["DAILY"] = "daily";
    ReportType["WEEKLY"] = "weekly";
    ReportType["MONTHLY"] = "monthly";
    ReportType["CUSTOM"] = "custom";
})(ReportType || (exports.ReportType = ReportType = {}));
var ReportFormat;
(function (ReportFormat) {
    ReportFormat["PDF"] = "pdf";
    ReportFormat["HTML"] = "html";
})(ReportFormat || (exports.ReportFormat = ReportFormat = {}));
// System Tray types
var TrayNotificationType;
(function (TrayNotificationType) {
    TrayNotificationType["INFO"] = "info";
    TrayNotificationType["SUCCESS"] = "success";
    TrayNotificationType["WARNING"] = "warning";
    TrayNotificationType["ERROR"] = "error";
})(TrayNotificationType || (exports.TrayNotificationType = TrayNotificationType = {}));
//# sourceMappingURL=types.js.map