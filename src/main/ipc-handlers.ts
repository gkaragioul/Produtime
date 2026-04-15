import { app, ipcMain, IpcMainInvokeEvent } from 'electron';
import { DatabaseManager } from './database';
// Auto-updater IPC is registered directly in auto-updater.ts via AutoUpdaterManager
import { PDFGenerator } from './pdf-generator';
import { SystemTrayManager } from './system-tray';
import { EmailService } from './services/email-service';
import { ActivityTracker } from './services/activity-tracker';
import { StartupHelper } from './startup-helper';
// Freeware: LicenseService not used (EnhancedLicenseService stub handles everything)
import { DeviceIdService } from './services/device-id-service';
import { Logger } from './logger';
import { EnhancedLicenseService } from './services/licensing/EnhancedLicenseService';
import { AgentService, AgentState } from './services/agent';
import {
  IPCChannels,
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
  ReportFormat,
  TrayNotification,
  TrayState,
  AdminLoginRequest,
  AdminLoginResponse,
  AdminLockoutState,
  ActivateLicenseRequest,
  ActivationResponse,
  ActivationStatus,
  PrivacySettings,
} from '../shared/types';
import { AgentPairingState } from './services/agent';
import { DEFAULT_PRIVACY_APPS } from './services/privacy-constants';

export class IPCHandlers {
  private database: DatabaseManager;
  // Auto-updater IPC handled directly in AutoUpdaterManager
  private pdfGenerator: PDFGenerator | null = null;
  private systemTray: SystemTrayManager | null = null;
  private autoExportScheduler: any | null = null;
  private activityTracker: ActivityTracker | null = null;
  private agentService: AgentService | null = null;
  private emailService: EmailService;
  private licenseService: any;
  private deviceIdService: DeviceIdService;
  private logger: Logger;
  private enhancedLicenseService: EnhancedLicenseService | null = null;
  private readonly FAILED_ALERT_LAST_SENT_KEY =
    'failed_attempts_alert_last_sent_at';
  private readonly FAILED_ALERT_RATE_LIMIT_MIN = 10; // minutes

  private readonly FAILED_ALERT_THRESHOLD = 3; // Minimum failed attempts before sending alert
  private readonly LOCKOUT_THRESHOLD = 5; // Lock account after this many failed attempts
  private readonly LOCKOUT_DURATION_MINUTES = 15; // Lockout duration in minutes

  // License public key for verification (in production, this would be embedded)
  private readonly LICENSE_PUBLIC_KEY =
    process.env.ED25519_PUBLIC_KEY ||
    'yBpM6mVTBbG9j8SmQlQFvRWlL8TfOwHuzWEO7zhHzgw=';

  // License validation configuration
  private readonly LICENSE_VALIDATION_CONFIG = {
    LOCAL_CHECK_INTERVAL_MS: 30 * 1000, // 30 seconds - catch trial expiry reasonably fast
    SERVER_CHECK_INTERVAL_MS: parseInt(
      process.env.LICENSE_SERVER_CHECK_INTERVAL_MS || '1800000'
    ), // 30 minutes (1800s) - reduced server load while still detecting revocation
    SERVER_TIMEOUT_MS: 5000, // 5 second timeout for server requests
    RETRY_MAX_ATTEMPTS: 3, // Max retry attempts on transient failures
    RETRY_BACKOFF_MS: 1000, // Initial backoff: 1s, then 2s, then 4s
  };

  private licenseValidationTimers: NodeJS.Timeout[] = [];
  private onMenuRebuildNeeded: (() => void) | null = null;

  constructor(
    database: DatabaseManager,
    _autoUpdater?: unknown, // kept for call-site compat — updates handled in AutoUpdaterManager
    pdfGenerator?: PDFGenerator,
    systemTray?: SystemTrayManager,
    autoExportScheduler?: any,
    activityTracker?: ActivityTracker,
    enhancedLicenseService?: EnhancedLicenseService,
    onMenuRebuildNeeded?: () => void
  ) {
    this.database = database;
    this.pdfGenerator = pdfGenerator || null;
    this.systemTray = systemTray || null;
    this.autoExportScheduler = autoExportScheduler || null;
    this.activityTracker = activityTracker || null;
    this.enhancedLicenseService = enhancedLicenseService || null;
    this.onMenuRebuildNeeded = onMenuRebuildNeeded || null;
    this.emailService = EmailService.getInstance();
    this.emailService.configureFromDatabase((key) => this.database.getSetting(key));
    // Freeware: legacy license service not initialized (no network calls)
    this.licenseService = null;
    this.deviceIdService = DeviceIdService.getInstance();
    this.logger = Logger.getInstance();
    this.registerHandlers();

    // Initialize periodic license validation
    this.initializeLicenseValidation();
  }

  /**
   * Freeware: license validation disabled — always activated
   */
  private initializeLicenseValidation(): void {
    this.logger.info('LICENSE', 'Freeware mode — license validation disabled');
  }

  /**
   * Perform local license validation
   * Uses EnhancedLicenseService (v1.8) when available, falls back to old LicenseService
   */
  private performLocalLicenseValidation(electron: any): void {
    try {
      // Prefer EnhancedLicenseService (v1.8) for consistent validation
      if (this.enhancedLicenseService) {
        const status = this.enhancedLicenseService.getStatus();
        if (!status.isEntitled) {
          this.logger.warn('LICENSE', 'Local validation (v1.8): License invalid', {
            mode: status.mode,
            reason: status.reason,
          });
          // Convert to old format for broadcast
          this.broadcastLicenseLockout(electron, {
            isActivated: false,
            isTrialMode: false,
            message: status.reason || 'License required',
          });
        }
        return;
      }

      // Fallback to old LicenseService
      const status = this.licenseService.validateActivation();
      if (!status.isActivated && !status.isTrialMode) {
        this.logger.warn('LICENSE', 'Local validation: License invalid', {
          message: status.message,
        });
        this.broadcastLicenseLockout(electron, status);
      }
    } catch (e) {
      this.logger.error('LICENSE', 'Local validation error', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /**
   * Perform server license validation with retry logic
   * Uses EnhancedLicenseService (v1.8) heartbeat when available
   */
  private async performServerLicenseValidation(
    electron: any,
    attempt: number = 1
  ): Promise<void> {
    try {
      // Prefer EnhancedLicenseService (v1.8) for server validation
      if (this.enhancedLicenseService) {
        await this.enhancedLicenseService.heartbeatIfDue();
        // Re-check status after heartbeat
        const status = this.enhancedLicenseService.getStatus();
        if (!status.isEntitled) {
          this.logger.warn('LICENSE', 'Server validation (v1.8): License revoked', {
            mode: status.mode,
            reason: status.reason,
            attempt,
          });
          this.broadcastLicenseLockout(electron, {
            isActivated: false,
            isTrialMode: false,
            message: status.reason || 'License revoked',
          });
        }
        return;
      }

      // Fallback to old LicenseService
      const status = await this.licenseService.validateActivationWithServer();
      if (!status.isActivated && !status.isTrialMode) {
        this.logger.warn('LICENSE', 'Server validation: License revoked', {
          message: status.message,
          attempt,
        });
        this.broadcastLicenseLockout(electron, status);
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      this.logger.warn('LICENSE', 'Server validation error', {
        error,
        attempt,
        maxAttempts: this.LICENSE_VALIDATION_CONFIG.RETRY_MAX_ATTEMPTS,
      });

      // Retry with exponential backoff on transient failures
      if (attempt < this.LICENSE_VALIDATION_CONFIG.RETRY_MAX_ATTEMPTS) {
        const backoffMs =
          this.LICENSE_VALIDATION_CONFIG.RETRY_BACKOFF_MS *
          Math.pow(2, attempt - 1);
        this.logger.info('LICENSE', 'Scheduling retry', {
          attempt: attempt + 1,
          backoffMs,
        });
        setTimeout(() => {
          this.performServerLicenseValidation(electron, attempt + 1);
        }, backoffMs);
      }
    }
  }

  /**
   * Broadcast license lockout to all windows
   */
  private broadcastLicenseLockout(
    electron: any,
    status: ActivationStatus
  ): void {
    try {
      const windows = electron.BrowserWindow.getAllWindows
        ? electron.BrowserWindow.getAllWindows()
        : [];
      windows.forEach((w: any) => {
        try {
          w.webContents.send('license:lockout', status);
        } catch (err) {
          // Window may have been destroyed; silently ignore
          // Log at debug level to prevent spam
          this.logger.debug('LICENSE', 'Failed to send lockout to window', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });
    } catch (e) {
      this.logger.error('LICENSE', 'Failed to broadcast lockout', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  private registerHandlers(): void {
    // Make registration idempotent when initializeIPC() is called multiple times
    const channelsToReset = [
      // Activity logs
      IPCChannels.GET_ACTIVITY_LOGS,
      IPCChannels.GET_ACTIVITY_LOGS_BY_DATE,
      'activity:getDailySummary',
      IPCChannels.INSERT_ACTIVITY_LOG,
      // Settings
      IPCChannels.GET_SETTING,
      IPCChannels.SET_SETTING,
      IPCChannels.GET_ALL_SETTINGS,
      IPCChannels.SETTINGS_GET_WORK_SCHEDULE_FOR_DAY,
      // Analytics
      IPCChannels.GET_ANALYTICS,
      IPCChannels.INSERT_ANALYTICS,
      // Database
      IPCChannels.CLEAR_ALL_DATA,
      IPCChannels.GET_DB_HEALTH,
      // Auto-updater
      IPCChannels.CHECK_FOR_UPDATES,
      IPCChannels.DOWNLOAD_UPDATE,
      IPCChannels.INSTALL_UPDATE,
      IPCChannels.GET_UPDATE_STATUS,
      // Reports
      IPCChannels.GENERATE_REPORT,
      IPCChannels.GET_REPORT_DATA,
      IPCChannels.SAVE_REPORT,
      IPCChannels.OPEN_REPORT,
      // Tray
      IPCChannels.SHOW_TRAY_NOTIFICATION,
      IPCChannels.UPDATE_TRAY_STATE,
      IPCChannels.GET_TRAY_STATE,
      IPCChannels.TOGGLE_WINDOW_VISIBILITY,
      IPCChannels.QUIT_APPLICATION,
      // Admin
      IPCChannels.ADMIN_LOGIN,
      IPCChannels.ADMIN_GET_LOCKOUT_STATE,
      IPCChannels.ADMIN_RESET_LOCKOUT,
      // Enhanced settings
      IPCChannels.BULK_UPDATE_SETTINGS,

      // Settings helper
      IPCChannels.SELECT_EXPORT_FOLDER,
      IPCChannels.TEST_AUTO_EXPORT,
      // Activity control and data
      'activity:getCurrent',
      'activity:getStats',
      'activity:getDiagnostics',
      IPCChannels.ACTIVITY_START,
      IPCChannels.ACTIVITY_STOP,
      IPCChannels.ACTIVITY_PAUSE,
      IPCChannels.ACTIVITY_RESUME,
      // Startup configuration
      'startup:hasShortcut',
      'startup:configure',
      'startup:openFolder',
      'app:getVersion',
      // License management
      IPCChannels.GET_DEVICE_ID,
      IPCChannels.ACTIVATE_LICENSE,
      IPCChannels.VALIDATE_ACTIVATION,
      IPCChannels.START_TRIAL,
      // Enhanced licensing (v1.8) - START_TRIAL already covers 'license:startTrial'
      'license:getStatus',
      'license:activate',
      // Privacy settings
      'privacy:getSettings',
      'privacy:setMode',
      // Agent (Admin Console)
      'agent:getState',
      'agent:getPairingState',
      'agent:startCloudPairing',
      'agent:unpair',
      'agent:getEffectivePolicy',
      'agent:isManaged',
    ];
    channelsToReset.forEach((ch) => {
      try {
        // @ts-ignore - Electron accepts string channel here
        ipcMain.removeHandler(ch);
      } catch {}
    });

    // Activity Logs handlers
    ipcMain.handle(
      IPCChannels.GET_ACTIVITY_LOGS,
      this.handleGetActivityLogs.bind(this)
    );
    ipcMain.handle(
      IPCChannels.GET_ACTIVITY_LOGS_BY_DATE,
      this.handleGetActivityLogsByDate.bind(this)
    );
    ipcMain.handle(
      'activity:getDailySummary',
      this.handleGetDailySummary.bind(this)
    );
    ipcMain.handle(
      IPCChannels.INSERT_ACTIVITY_LOG,
      this.handleInsertActivityLog.bind(this)
    );

    // Settings handlers
    ipcMain.handle(IPCChannels.GET_SETTING, this.handleGetSetting.bind(this));
    ipcMain.handle(IPCChannels.SET_SETTING, this.handleSetSetting.bind(this));
    ipcMain.handle(
      IPCChannels.GET_ALL_SETTINGS,
      this.handleGetAllSettings.bind(this)
    );
    ipcMain.handle(
      IPCChannels.SETTINGS_GET_WORK_SCHEDULE_FOR_DAY,
      this.handleGetWorkScheduleForDay.bind(this)
    );

    // Analytics handlers
    ipcMain.handle(
      IPCChannels.GET_ANALYTICS,
      this.handleGetAnalytics.bind(this)
    );
    ipcMain.handle(
      IPCChannels.INSERT_ANALYTICS,
      this.handleInsertAnalytics.bind(this)
    );

    // Database management handlers
    ipcMain.handle(
      IPCChannels.CLEAR_ALL_DATA,
      this.handleClearAllData.bind(this)
    );
    ipcMain.handle(
      IPCChannels.GET_DB_HEALTH,
      this.handleGetDbHealth.bind(this)
    );

    // Auto-updater handlers removed — assisted updater registers its own IPC in main.ts

    // PDF report handlers
    if (this.pdfGenerator) {
      ipcMain.handle(
        IPCChannels.GENERATE_REPORT,
        this.handleGenerateReport.bind(this)
      );
      ipcMain.handle(
        IPCChannels.GET_REPORT_DATA,
        this.handleGetReportData.bind(this)
      );
      ipcMain.handle(IPCChannels.SAVE_REPORT, this.handleSaveReport.bind(this));
      ipcMain.handle(IPCChannels.OPEN_REPORT, this.handleOpenReport.bind(this));
    }

    // System tray handlers
    if (this.systemTray) {
      ipcMain.handle(
        IPCChannels.SHOW_TRAY_NOTIFICATION,
        this.handleShowTrayNotification.bind(this)
      );
      ipcMain.handle(
        IPCChannels.UPDATE_TRAY_STATE,
        this.handleUpdateTrayState.bind(this)
      );
      ipcMain.handle(
        IPCChannels.GET_TRAY_STATE,
        this.handleGetTrayState.bind(this)
      );
      ipcMain.handle(
        IPCChannels.TOGGLE_WINDOW_VISIBILITY,
        this.handleToggleWindowVisibility.bind(this)
      );
      ipcMain.handle(
        IPCChannels.QUIT_APPLICATION,
        this.handleQuitApplication.bind(this)
      );
    }

    // Admin authentication handlers
    ipcMain.handle(IPCChannels.ADMIN_LOGIN, this.handleAdminLogin.bind(this));
    ipcMain.handle(
      IPCChannels.ADMIN_GET_LOCKOUT_STATE,
      this.handleGetAdminLockoutState.bind(this)
    );
    ipcMain.handle(
      IPCChannels.ADMIN_RESET_LOCKOUT,
      this.handleResetAdminLockout.bind(this)
    );

    // Email configuration handlers
    try { ipcMain.removeHandler('email:getConfig'); } catch {}
    try { ipcMain.removeHandler('email:saveConfig'); } catch {}
    try { ipcMain.removeHandler('email:test'); } catch {}
    ipcMain.handle('email:getConfig', async () => {
      try {
        return {
          success: true,
          data: {
            host: this.database.getSetting('email_smtp_host') || '',
            port: this.database.getSetting('email_smtp_port') || '587',
            user: this.database.getSetting('email_smtp_user') || '',
            pass: this.database.getSetting('email_smtp_pass') ? '********' : '', // Mask password
            secure: this.database.getSetting('email_smtp_secure') || 'false',
            recipient: this.database.getSetting('admin_alert_email') || '',
            isConfigured: this.emailService.isConfigured,
          },
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('email:saveConfig', async (_event: IpcMainInvokeEvent, config: {
      host: string; port: string; user: string; pass: string; secure: string; recipient: string;
    }) => {
      try {
        this.database.setSetting('email_smtp_host', config.host);
        this.database.setSetting('email_smtp_port', config.port);
        this.database.setSetting('email_smtp_user', config.user);
        if (config.pass && config.pass !== '********') {
          this.database.setSetting('email_smtp_pass', config.pass);
        }
        this.database.setSetting('email_smtp_secure', config.secure);
        this.database.setSetting('admin_alert_email', config.recipient);

        // Reconfigure email service with new settings
        this.emailService.configureFromDatabase((key) => this.database.getSetting(key));

        return { success: true, data: { isConfigured: this.emailService.isConfigured } };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('email:test', async () => {
      try {
        const alertEmail = this.database.getSetting('admin_alert_email');
        if (!alertEmail) {
          return { success: false, error: 'No recipient email configured' };
        }
        if (!this.emailService.isConfigured) {
          return { success: false, error: 'Email service not configured' };
        }
        await this.emailService.sendSecurityAlert(alertEmail, {
          type: 'failed_attempts',
          timestamp: new Date().toISOString(),
          details: { failedAttempts: 0, maxAttempts: 0 },
        });
        return { success: true };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    // Enhanced settings management handlers
    ipcMain.handle(
      IPCChannels.BULK_UPDATE_SETTINGS,
      this.handleBulkUpdateSettings.bind(this)
    );

    // Settings helper: folder picker
    ipcMain.handle(
      IPCChannels.SELECT_EXPORT_FOLDER,
      this.handleSelectExportFolder.bind(this)
    );

    // Auto-export testing
    ipcMain.handle(
      IPCChannels.TEST_AUTO_EXPORT,
      this.handleTestAutoExport.bind(this)
    );

    // Activity tracking handlers (for real-time activity data)
    ipcMain.handle(
      'activity:getCurrent',
      this.handleGetCurrentActivity.bind(this)
    );
    ipcMain.handle('activity:getStats', this.handleGetTrackingStats.bind(this));
    ipcMain.handle(
      'activity:getDiagnostics',
      this.handleGetActivityDiagnostics.bind(this)
    );

    // Activity control handlers
    ipcMain.handle(
      IPCChannels.ACTIVITY_START,
      this.handleStartTracking.bind(this)
    );
    ipcMain.handle(
      IPCChannels.ACTIVITY_STOP,
      this.handleStopTracking.bind(this)
    );
    ipcMain.handle(
      IPCChannels.ACTIVITY_PAUSE,
      this.handlePauseTracking.bind(this)
    );
    ipcMain.handle(
      IPCChannels.ACTIVITY_RESUME,
      this.handleResumeTracking.bind(this)
    );

    // Startup configuration handlers
    ipcMain.handle(
      'startup:hasShortcut',
      this.handleHasStartupShortcut.bind(this)
    );
    ipcMain.handle('startup:configure', this.handleConfigureStartup.bind(this));
    ipcMain.handle(
      'startup:openFolder',
      this.handleOpenStartupFolder.bind(this)
    );

    // App version handler
    ipcMain.handle('app:getVersion', this.handleGetAppVersion.bind(this));

    // License management handlers
    ipcMain.handle(
      IPCChannels.GET_DEVICE_ID,
      this.handleGetDeviceId.bind(this)
    );
    ipcMain.handle(
      IPCChannels.VALIDATE_ACTIVATION,
      this.handleValidateActivation.bind(this)
    );
    // Legacy START_TRIAL and ACTIVATE_LICENSE removed - using enhanced v1.8 handlers instead

    // Enhanced Licensing handlers (v1.8)
    ipcMain.handle('license:getStatus', this.handleGetLicenseStatus.bind(this));
    ipcMain.handle('license:startTrial', this.handleEnhancedStartTrial.bind(this));
    ipcMain.handle('license:activate', this.handleEnhancedActivate.bind(this));

    // Privacy settings handlers
    ipcMain.handle('privacy:getSettings', this.handleGetPrivacySettings.bind(this));
    ipcMain.handle('privacy:setMode', this.handleSetPrivacyMode.bind(this));

    // Agent (Admin Console) handlers
    ipcMain.handle('agent:getState', this.handleAgentGetState.bind(this));
    ipcMain.handle('agent:getPairingState', this.handleAgentGetPairingState.bind(this));
    ipcMain.handle('agent:startCloudPairing', this.handleAgentStartCloudPairing.bind(this));
    ipcMain.handle('agent:unpair', this.handleAgentUnpair.bind(this));
    ipcMain.handle('agent:getEffectivePolicy', this.handleAgentGetEffectivePolicy.bind(this));
    ipcMain.handle('agent:isManaged', this.handleAgentIsManaged.bind(this));
    ipcMain.handle('agent:getSalesStats', this.handleAgentGetSalesStats.bind(this));

    console.log('IPC handlers registered successfully');
  }

  private async handleAgentGetSalesStats(
    _event: IpcMainInvokeEvent,
    range: 'day' | 'week' | 'month'
  ): Promise<IPCResponse<any>> {
    try {
      const svc = this.agentService;
      if (!svc) {
        return { success: true, data: { unavailable: true, reason: 'not_initialized' } };
      }
      const r: 'day' | 'week' | 'month' = (['day','week','month'] as const).includes(range as any)
        ? range
        : 'week';
      const data = await (svc as any).requestSales(r);
      return { success: true, data };
    } catch (error) {
      console.error('Error requesting sales stats:', error);
      return { success: false, error: String(error) };
    }
  }

  private async handleGetActivityDiagnostics(
    event: IpcMainInvokeEvent
  ): Promise<IPCResponse<any>> {
    try {
      const tracker = (global as any).activityTracker as any;
      if (!tracker || typeof tracker.getDiagnostics !== 'function') {
        throw new Error('Activity tracker diagnostics not available');
      }
      const diag = tracker.getDiagnostics();
      return { success: true, data: diag };
    } catch (error) {
      console.error('Error getting activity diagnostics:', error);
      return { success: false, error: String(error) };
    }
  }

  // Activity Logs handlers
  private async handleGetActivityLogs(
    event: IpcMainInvokeEvent,
    request: GetActivityLogsRequest
  ): Promise<IPCResponse<ActivityLog[]>> {
    try {
      const logs = this.database.getActivityLogs(request.limit, request.offset);
      // Apply privacy sanitization when reading logs
      const sanitizedLogs = this.sanitizeActivityLogs(logs);
      return { success: true, data: sanitizedLogs };
    } catch (error) {
      console.error('Error getting activity logs:', error);
      return { success: false, error: `Failed to get activity logs: ${error}` };
    }
  }

  private async handleGetDailySummary(
    event: IpcMainInvokeEvent,
    request: { startDate: string; endDate: string }
  ): Promise<IPCResponse<{ active: number; idle: number }>> {
    try {
      const summary = this.database.getActivitySummaryByDateRange(request.startDate, request.endDate);
      return {
        success: true,
        data: {
          active: summary.total_active_seconds || 0,
          idle: summary.total_idle_seconds || 0,
        },
      };
    } catch (error) {
      return { success: false, error: `Failed to get daily summary: ${error}` };
    }
  }

  private async handleGetActivityLogsByDate(
    event: IpcMainInvokeEvent,
    request: GetActivityLogsByDateRequest
  ): Promise<IPCResponse<ActivityLog[]>> {
    try {
      const logs = this.database.getActivityLogsByDateRange(
        request.startDate,
        request.endDate,
        100 // Limit to 100 most recent logs to prevent renderer OOM
      );
      // Apply privacy sanitization when reading logs
      const sanitizedLogs = this.sanitizeActivityLogs(logs);
      return { success: true, data: sanitizedLogs };
    } catch (error) {
      console.error('Error getting activity logs by date:', error);
      return {
        success: false,
        error: `Failed to get activity logs by date: ${error}`,
      };
    }
  }

  /**
   * Sanitize activity logs based on privacy mode settings.
   * When privacy mode is enabled, window titles for privacy-sensitive apps
   * are replaced with just the app name to hide recipient/conversation details.
   */
  private sanitizeActivityLogs(logs: ActivityLog[]): ActivityLog[] {
    const privacyEnabled = this.database.getSetting('privacy_mode_enabled') === 'true';
    
    if (!privacyEnabled) {
      return logs;
    }

    // Get privacy apps list
    let privacyApps: string[] = DEFAULT_PRIVACY_APPS;
    const privacyAppsJson = this.database.getSetting('privacy_apps');
    if (privacyAppsJson) {
      try {
        privacyApps = JSON.parse(privacyAppsJson);
      } catch {
        privacyApps = DEFAULT_PRIVACY_APPS;
      }
    }

    return logs.map(log => {
      // Check if this app or window title matches a privacy app
      const isPrivacyApp = privacyApps.some(app => {
        const appLower = app.toLowerCase();
        return log.app_name.toLowerCase().includes(appLower) ||
               log.window_title.toLowerCase().includes(appLower);
      });

      if (isPrivacyApp) {
        // Replace window title with just the app name
        return {
          ...log,
          window_title: log.app_name
        };
      }

      return log;
    });
  }

  private async handleInsertActivityLog(
    event: IpcMainInvokeEvent,
    request: InsertActivityLogRequest
  ): Promise<IPCResponse<number>> {
    try {
      const id = this.database.insertActivityLog(request);
      return { success: true, data: id };
    } catch (error) {
      console.error('Error inserting activity log:', error);
      return {
        success: false,
        error: `Failed to insert activity log: ${error}`,
      };
    }
  }

  // Settings handlers
  private async handleGetSetting(
    event: IpcMainInvokeEvent,
    request: GetSettingRequest
  ): Promise<IPCResponse<string | null>> {
    try {
      const value = this.database.getSetting(request.key);
      return { success: true, data: value };
    } catch (error) {
      console.error('Error getting setting:', error);
      return { success: false, error: `Failed to get setting: ${error}` };
    }
  }

  private async handleSetSetting(
    event: IpcMainInvokeEvent,
    request: SetSettingRequest
  ): Promise<IPCResponse<void>> {
    try {
      // License enforcement
      if (this.enhancedLicenseService) {
        this.enhancedLicenseService.assertEntitledOrThrow('Update Settings');
      }

      // Employee name is locked after first save. Admin policy pushes bypass this
      // by writing via applyPolicy() which does not go through this IPC path.
      if (request.key === 'employee_name') {
        const locked = this.database.getSetting('employee_name_locked') === 'true';
        if (locked) {
          return { success: false, error: 'employee_name is locked. Contact your admin to change.' };
        }
        const trimmed = String(request.value ?? '').trim();
        if (!trimmed) {
          return { success: false, error: 'employee_name cannot be empty.' };
        }
        // Normalise and lock as part of the same write.
        request = { ...request, value: trimmed };
      }
      if (request.key === 'slack_user_id') {
        // slack_user_id is admin-owned; never writable via the generic settings IPC.
        return { success: false, error: 'slack_user_id is managed by the admin.' };
      }

      // Persist setting (prefer validated method if available)
      const dbAny: any = this.database as any;
      if (typeof dbAny.setSettingWithValidation === 'function') {
        dbAny.setSettingWithValidation(request.key, request.value);
      } else {
        this.database.setSetting(request.key, request.value);
      }

      // Lock the name after the first successful user-initiated save.
      if (request.key === 'employee_name') {
        this.database.setSetting('employee_name_locked', 'true');
      }

      // Apply to live ActivityTracker where applicable
      const tracker = (global as any).activityTracker as any;
      if (tracker) {
        switch (request.key) {
          case 'idle_threshold': {
            const v = parseInt(String(request.value));
            if (!isNaN(v)) tracker.updateIdleThreshold(v);
            break;
          }
          case 'poll_interval_ms': {
            const v = parseInt(String(request.value));
            if (!isNaN(v) && typeof tracker.setPollInterval === 'function') {
              tracker.setPollInterval(v);
            }
            break;
          }
          case 'enable_logging': {
            const v = String(request.value).toLowerCase();
            const on = v === 'true' || v === '1' || v === 'yes';
            if (typeof tracker.setEnableLogging === 'function') {
              tracker.setEnableLogging(on);
            }
            break;
          }
        }
      }

      return { success: true };
    } catch (error) {
      console.error('Error setting value:', error);
      return { success: false, error: `Failed to set setting: ${error}` };
    }
  }

  private async handleGetAllSettings(
    event: IpcMainInvokeEvent
  ): Promise<IPCResponse<Setting[]>> {
    try {
      const settings = this.database.getAllSettings();
      return { success: true, data: settings };
    } catch (error) {
      console.error('Error getting all settings:', error);
      return { success: false, error: `Failed to get all settings: ${error}` };
    }
  }

  private async handleGetWorkScheduleForDay(
    event: IpcMainInvokeEvent,
    request: { dateISO: string }
  ): Promise<IPCResponse<import('../shared/types').WorkScheduleForDay>> {
    try {
      // Validate dateISO input to prevent invalid dates
      let date = new Date();
      if (request?.dateISO) {
        const parsedDate = new Date(request.dateISO);
        // Check if the date is valid (not NaN)
        if (!isNaN(parsedDate.getTime())) {
          date = parsedDate;
        }
      }

      const weekdayKey = ((d: Date) => {
        const idx = d.getDay(); // 0=Sun .. 6=Sat (local time)
        return [
          'sunday',
          'monday',
          'tuesday',
          'wednesday',
          'thursday',
          'friday',
          'saturday',
        ][idx] as
          | 'sunday'
          | 'monday'
          | 'tuesday'
          | 'wednesday'
          | 'thursday'
          | 'friday'
          | 'saturday';
      })(date);

      const defaultStart = '09:00';
      const defaultEnd = '17:00';

      const isHHMM = (v?: string) =>
        !!v && /^([0-1]?\d|2[0-3]):[0-5]\d$/.test(v);
      const toMin = (v: string) => {
        const parts = v.split(':').map((n) => parseInt(n, 10));
        // Ensure we have both hours and minutes, and they're valid numbers
        if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) {
          throw new Error(`Invalid time format: ${v}`);
        }
        const [h, m] = parts;
        return h * 60 + m;
      };

      // Try weekly schedule first (if present) for the specific day
      let weeklyRaw: string | null = null;
      try {
        weeklyRaw = this.database.getSetting('work_schedule_weekly');
      } catch {}

      if (weeklyRaw) {
        try {
          const weekly = JSON.parse(weeklyRaw);
          const entry = weekly?.[weekdayKey];
          if (entry && typeof entry === 'object') {
            const nonWorking = !!entry.nonWorking;
            const start = isHHMM(entry.start) ? entry.start : defaultStart;
            const end = isHHMM(entry.end) ? entry.end : defaultEnd;
            const overnight = toMin(end) < toMin(start);
            return {
              success: true,
              data: { start, end, nonWorking, overnight, source: 'weekly' },
            };
          }
        } catch (e) {
          // ignore and fallback
        }
      }

      // Fallback to flat schedule
      const flatStart =
        this.database.getSetting('work_schedule_start') || defaultStart;
      const flatEnd =
        this.database.getSetting('work_schedule_end') || defaultEnd;
      const start = isHHMM(flatStart) ? flatStart : defaultStart;
      const end = isHHMM(flatEnd) ? flatEnd : defaultEnd;
      const overnight = toMin(end) < toMin(start);
      return {
        success: true,
        data: { start, end, nonWorking: false, overnight, source: 'flat' },
      };
    } catch (error) {
      console.error('Error getting schedule for day:', error);
      return {
        success: true,
        data: {
          start: '09:00',
          end: '17:00',
          nonWorking: false,
          overnight: false,
          source: 'default',
        },
      };
    }
  }

  // Analytics handlers
  private async handleGetAnalytics(
    event: IpcMainInvokeEvent,
    request: GetAnalyticsRequest
  ): Promise<IPCResponse<Analytics[]>> {
    try {
      const analytics = this.database.getAnalytics(request.metricName);
      return { success: true, data: analytics };
    } catch (error) {
      console.error('Error getting analytics:', error);
      return { success: false, error: `Failed to get analytics: ${error}` };
    }
  }

  private async handleInsertAnalytics(
    event: IpcMainInvokeEvent,
    request: InsertAnalyticsRequest
  ): Promise<IPCResponse<number>> {
    try {
      const id = this.database.insertAnalytics(request);
      return { success: true, data: id };
    } catch (error) {
      console.error('Error inserting analytics:', error);
      return { success: false, error: `Failed to insert analytics: ${error}` };
    }
  }

  // Database management handlers
  private async handleClearAllData(
    event: IpcMainInvokeEvent
  ): Promise<IPCResponse<void>> {
    try {
      // License enforcement
      if (this.enhancedLicenseService) {
        this.enhancedLicenseService.assertEntitledOrThrow('Clear All Data');
      }

      // Clear database data
      this.database.clearAllData();

      // Reset ActivityTracker state to start fresh
      if (this.activityTracker) {
        console.log('🔄 Resetting ActivityTracker state after data purge...');
        // Stop tracking to clear current activity and intervals
        await this.activityTracker.stopTracking();
        // Start tracking again to begin fresh
        await this.activityTracker.startTracking();
        console.log('✅ ActivityTracker state reset complete');
      }

      return { success: true };
    } catch (error) {
      console.error('Error clearing all data:', error);
      return { success: false, error: `Failed to clear all data: ${error}` };
    }
  }

  private async handleGetDbHealth(
    event: IpcMainInvokeEvent
  ): Promise<IPCResponse<boolean>> {
    try {
      const isHealthy = this.database.isHealthy();
      return { success: true, data: isHealthy };
    } catch (error) {
      console.error('Error checking database health:', error);
      return {
        success: false,
        error: `Failed to check database health: ${error}`,
      };
    }
  }

  // PDF report handlers
  private async handleGenerateReport(
    event: IpcMainInvokeEvent,
    request: GenerateReportRequest
  ): Promise<IPCResponse<GenerateReportResponse>> {
    try {
      // License enforcement
      if (this.enhancedLicenseService) {
        this.enhancedLicenseService.assertEntitledOrThrow('Generate Report');
      }

      if (!this.pdfGenerator) {
        throw new Error('PDF generator not available');
      }
      const result = await this.pdfGenerator.generateReport(
        request.options,
        request.sessionSnapshot
      );
      return { success: true, data: result };
    } catch (error) {
      const errStr = String(error);
      console.error('Error generating report:', errStr);

      // If export folder is invalid/unavailable, prompt to select a new one and retry
      if (errStr.includes('[EXPORT_DIR_INVALID]')) {
        try {
          const pickRes = await this.handleSelectExportFolder();
          if (pickRes.success && pickRes.data) {
            // Save new folder and retry generation
            this.database.setSettingWithValidation(
              'export_folder',
              pickRes.data
            );
            try {
              if (!this.pdfGenerator) {
                return {
                  success: false,
                  error: 'PDF generator not initialized',
                };
              }
              const retry = await this.pdfGenerator.generateReport(
                request.options
              );
              return { success: true, data: retry };
            } catch (retryErr) {
              console.error(
                'Retry after selecting export folder failed:',
                retryErr
              );
              return {
                success: false,
                error: `Failed to generate report after selecting folder: ${retryErr}`,
              };
            }
          }
          return {
            success: false,
            error:
              'Export folder invalid or unavailable. Please select a valid folder and try again.',
          };
        } catch (pickErr) {
          console.error('Error prompting for export folder:', pickErr);
          return {
            success: false,
            error: `Failed to select export folder: ${pickErr}`,
          };
        }
      }

      return { success: false, error: `Failed to generate report: ${errStr}` };
    }
  }

  private async handleGetReportData(
    event: IpcMainInvokeEvent,
    options: ReportOptions
  ): Promise<IPCResponse<ReportData>> {
    try {
      if (!this.pdfGenerator) {
        throw new Error('PDF generator not available');
      }
      const data = await this.pdfGenerator.getReportData(options);
      return { success: true, data };
    } catch (error) {
      console.error('Error getting report data:', error);
      return { success: false, error: `Failed to get report data: ${error}` };
    }
  }

  private async handleSaveReport(
    event: IpcMainInvokeEvent,
    reportId: string,
    filePath: string
  ): Promise<IPCResponse<void>> {
    try {
      // License enforcement
      if (this.enhancedLicenseService) {
        this.enhancedLicenseService.assertEntitledOrThrow('Save Report');
      }

      if (!this.pdfGenerator) {
        throw new Error('PDF generator not available');
      }
      await this.pdfGenerator.saveReport(reportId, filePath);
      return { success: true };
    } catch (error) {
      console.error('Error saving report:', error);
      return { success: false, error: `Failed to save report: ${error}` };
    }
  }

  private async handleOpenReport(
    event: IpcMainInvokeEvent,
    filePath: string
  ): Promise<IPCResponse<void>> {
    try {
      if (!this.pdfGenerator) {
        throw new Error('PDF generator not available');
      }
      await this.pdfGenerator.openReport(filePath);
      return { success: true };
    } catch (error) {
      console.error('Error opening report:', error);
      return { success: false, error: `Failed to open report: ${error}` };
    }
  }

  // System tray handlers
  private async handleShowTrayNotification(
    event: IpcMainInvokeEvent,
    notification: TrayNotification
  ): Promise<IPCResponse<void>> {
    try {
      if (!this.systemTray) {
        throw new Error('System tray not available');
      }
      this.systemTray.showNotification(notification);
      return { success: true };
    } catch (error) {
      console.error('Error showing tray notification:', error);
      return {
        success: false,
        error: `Failed to show tray notification: ${error}`,
      };
    }
  }

  private async handleUpdateTrayState(
    event: IpcMainInvokeEvent,
    state: Partial<TrayState>
  ): Promise<IPCResponse<void>> {
    try {
      if (!this.systemTray) {
        throw new Error('System tray not available');
      }
      this.systemTray.updateState(state);
      return { success: true };
    } catch (error) {
      console.error('Error updating tray state:', error);
      return { success: false, error: `Failed to update tray state: ${error}` };
    }
  }

  private async handleGetTrayState(
    event: IpcMainInvokeEvent
  ): Promise<IPCResponse<TrayState>> {
    try {
      if (!this.systemTray) {
        throw new Error('System tray not available');
      }
      const state = this.systemTray.getCurrentState();
      return { success: true, data: state };
    } catch (error) {
      console.error('Error getting tray state:', error);
      return { success: false, error: `Failed to get tray state: ${error}` };
    }
  }

  private async handleToggleWindowVisibility(
    event: IpcMainInvokeEvent
  ): Promise<IPCResponse<void>> {
    try {
      if (!this.systemTray) {
        throw new Error('System tray not available');
      }
      // The system tray manager handles window visibility internally
      return { success: true };
    } catch (error) {
      console.error('Error toggling window visibility:', error);
      return {
        success: false,
        error: `Failed to toggle window visibility: ${error}`,
      };
    }
  }

  private async handleQuitApplication(
    event: IpcMainInvokeEvent
  ): Promise<IPCResponse<void>> {
    try {
      // This will be handled by the system tray manager
      return { success: true };
    } catch (error) {
      console.error('Error quitting application:', error);
      return { success: false, error: `Failed to quit application: ${error}` };
    }
  }

  // Admin authentication handlers
  private async handleAdminLogin(
    event: IpcMainInvokeEvent,
    request: AdminLoginRequest
  ): Promise<IPCResponse<AdminLoginResponse>> {
    try {
      // Check if account is locked out
      if (this.database.isAdminLockedOut()) {
        const lockoutState = this.database.getLockoutState();
        return {
          success: true,
          data: {
            success: false,
            isLockedOut: true,
            failedAttempts: lockoutState.failed_attempts_count,
            maxAttempts: this.LOCKOUT_THRESHOLD,
            lockoutExpiresAt: lockoutState.locked_until || undefined,
          },
        };
      }
      const lockoutState = this.database.getLockoutState();

      // Get the admin password hash from settings, or generate and store a secure one on first run
      const crypto = require('crypto');
      let adminPasswordHash = await this.database.getSetting('admin_password_hash');

      if (!adminPasswordHash) {
        // Default password on first run: admin123
        const defaultPassword = 'admin123';
        const salt = crypto.randomBytes(16);
        const derivedKey = crypto.scryptSync(defaultPassword, salt, 32);
        adminPasswordHash = salt.toString('hex') + ':' + derivedKey.toString('hex');
        this.database.setSetting('admin_password_hash', adminPasswordHash);
        this.logger.info('ADMIN', 'Set default admin password on first run');
      }

      // Hash the incoming password for comparison
      let isValidPassword = false;
      try {
        const parts = adminPasswordHash.split(':');
        if (parts.length !== 2) {
          this.logger.warn('ADMIN', 'Invalid password hash format in database');
          isValidPassword = false;
        } else {
          const salt = Buffer.from(parts[0], 'hex');
          const storedHash = Buffer.from(parts[1], 'hex');
          const incomingDerivedKey = crypto.scryptSync(request.password || '', salt, 32);

          // Use constant-time comparison to prevent timing attacks
          isValidPassword = crypto.timingSafeEqual(incomingDerivedKey, storedHash);
        }
      } catch (err) {
        // Hashing or comparison failed
        this.logger.error('ADMIN', 'Password verification error', err);
        isValidPassword = false;
      }

      // Record the login attempt
      this.database.recordLoginAttempt(
        request.ipAddress || null,
        isValidPassword
      );

      if (isValidPassword) {
        // Reset failed attempts on successful login
        this.database.updateLockoutState({
          failed_attempts_count: 0,
          is_locked: false,
          locked_until: null,
        });

        return {
          success: true,
          data: {
            success: true,
            isLockedOut: false,
            failedAttempts: 0,
            maxAttempts: this.LOCKOUT_THRESHOLD,
          },
        };
      } else {
        // Handle failed login
        const lockoutState = this.database.getLockoutState();
        const newFailedCount = lockoutState.failed_attempts_count + 1;

        // Lock out if threshold reached
        const shouldLock = newFailedCount >= this.LOCKOUT_THRESHOLD;
        const lockedUntil = shouldLock
          ? new Date(Date.now() + this.LOCKOUT_DURATION_MINUTES * 60 * 1000).toISOString()
          : null;

        this.database.updateLockoutState({
          failed_attempts_count: newFailedCount,
          last_attempt_at: new Date().toISOString(),
          is_locked: shouldLock,
          locked_until: lockedUntil,
        });

        if (shouldLock) {
          this.logger.warn('ADMIN', `Account locked after ${newFailedCount} failed attempts. Locked for ${this.LOCKOUT_DURATION_MINUTES} minutes.`);
        }

        // Send an admin alert only after threshold failures (rate-limited)
        // Fire-and-forget to avoid blocking the authentication response
        console.log(
          `🔧 [DEBUG] Failed login count: ${newFailedCount}, threshold: ${this.FAILED_ALERT_THRESHOLD}`
        );

        if (newFailedCount >= this.FAILED_ALERT_THRESHOLD) {
          console.log(
            `🚨 [SECURITY] Threshold reached! Triggering email alert...`
          );
          this.sendFailedAttemptsAlert(
            newFailedCount,
            this.FAILED_ALERT_THRESHOLD,
            request.ipAddress
          ).catch((error) => {
            console.error('Failed to send admin alert email:', error);
          });
        } else {
          console.log(
            `🔧 [DEBUG] Threshold not reached yet (${newFailedCount}/${this.FAILED_ALERT_THRESHOLD})`
          );
        }

        return {
          success: true,
          data: {
            success: false,
            isLockedOut: shouldLock,
            failedAttempts: newFailedCount,
            maxAttempts: this.LOCKOUT_THRESHOLD,
            lockoutExpiresAt: lockedUntil || undefined,
          },
        };
      }
    } catch (error) {
      console.error('Error during admin login:', error);
      return {
        success: false,
        error: `Failed to process admin login: ${error}`,
      };
    }
  }

  private async handleGetAdminLockoutState(
    event: IpcMainInvokeEvent
  ): Promise<IPCResponse<AdminLockoutState>> {
    try {
      const lockoutState = this.database.getLockoutState();
      return { success: true, data: lockoutState };
    } catch (error) {
      console.error('Error getting admin lockout state:', error);
      return {
        success: false,
        error: `Failed to get admin lockout state: ${error}`,
      };
    }
  }

  private async handleResetAdminLockout(
    event: IpcMainInvokeEvent
  ): Promise<IPCResponse<void>> {
    try {
      this.database.updateLockoutState({
        is_locked: false,
        locked_until: null,
        failed_attempts_count: 0,
      });
      return { success: true };
    } catch (error) {
      console.error('Error resetting admin lockout:', error);
      return {
        success: false,
        error: `Failed to reset admin lockout: ${error}`,
      };
    }
  }

  // Enhanced settings management handlers
  private async handleBulkUpdateSettings(
    event: IpcMainInvokeEvent,
    settings: Record<string, string>
  ): Promise<IPCResponse<void>> {
    try {
      // License enforcement
      if (this.enhancedLicenseService) {
        this.enhancedLicenseService.assertEntitledOrThrow('Bulk Update Settings');
      }

      this.database.bulkUpdateSettings(settings);
      return { success: true };
    } catch (error) {
      console.error('Error bulk updating settings:', error);
      return {
        success: false,
        error: `Failed to bulk update settings: ${error}`,
      };
    }
  }

  // Email alert helper methods
  private async sendLockoutAlert(
    failedAttempts: number,
    maxAttempts: number,
    lockoutDurationMinutes: number,
    ipAddress?: string
  ): Promise<void> {
    try {
      const alertEmail = await this.database.getSetting('admin_alert_email');
      if (!alertEmail) {
        console.log('No admin alert email configured. Lockout alert not sent.');
        return;
      }

      const lockoutDuration = `${lockoutDurationMinutes} minute${lockoutDurationMinutes !== 1 ? 's' : ''}`;

      // Get employee name from settings
      const employeeName = await this.database.getSetting('employee_name');

      await this.emailService.sendSecurityAlert(alertEmail, {
        type: 'lockout',
        timestamp: new Date().toISOString(),
        employeeName: employeeName || undefined,
        details: {
          failedAttempts,
          maxAttempts,
          lockoutDuration,
          ipAddress,
        },
      });
    } catch (error) {
      console.error('Failed to send lockout alert email:', error);
    }
  }

  private async sendFailedAttemptsAlert(
    failedAttempts: number,
    maxAttempts: number,
    ipAddress?: string
  ): Promise<void> {
    try {
      console.log(
        `🔧 [DEBUG] sendFailedAttemptsAlert called with failedAttempts: ${failedAttempts}, maxAttempts: ${maxAttempts}`
      );

      const alertEmail = await this.database.getSetting('admin_alert_email');
      console.log(`🔧 [DEBUG] admin_alert_email setting: ${alertEmail}`);

      if (!alertEmail) {
        console.log(
          '❌ [EMAIL] No admin alert email configured. Failed attempts alert not sent.'
        );
        return;
      }

      // Rate limit: only send once per FAILED_ALERT_RATE_LIMIT_MIN minutes
      const lastSent = this.database.getSetting(
        this.FAILED_ALERT_LAST_SENT_KEY
      );
      console.log(`🔧 [DEBUG] lastSent: ${lastSent}`);

      const now = new Date();
      let canSend = true;
      if (lastSent) {
        const last = new Date(lastSent);
        const diffMin = (now.getTime() - last.getTime()) / 60000;
        canSend = diffMin >= this.FAILED_ALERT_RATE_LIMIT_MIN;
        console.log(
          `🔧 [DEBUG] Rate limit check: diffMin=${diffMin}, canSend=${canSend}, threshold=${this.FAILED_ALERT_RATE_LIMIT_MIN}`
        );
      } else {
        console.log(`🔧 [DEBUG] No previous email sent, canSend=${canSend}`);
      }

      if (!canSend) {
        console.log(
          `⏰ [EMAIL] Skipping failed-attempts alert due to rate limiting. Next alert allowed after ${this.FAILED_ALERT_RATE_LIMIT_MIN} minutes.`
        );
        return;
      }

      console.log(
        `📧 [EMAIL] Attempting to send security alert to: ${alertEmail}`
      );

      // Get employee name from settings
      const employeeName = await this.database.getSetting('employee_name');
      console.log(`🔧 [DEBUG] Employee name: ${employeeName}`);

      const sent = await this.emailService.sendSecurityAlert(alertEmail, {
        type: 'failed_attempts',
        timestamp: now.toISOString(),
        employeeName: employeeName || undefined,
        details: {
          failedAttempts,
          maxAttempts,
          ipAddress,
        },
      });

      console.log(`📧 [EMAIL] Email send result: ${sent}`);

      if (sent) {
        this.database.setSetting(
          this.FAILED_ALERT_LAST_SENT_KEY,
          now.toISOString()
        );
        console.log(
          `🔧 [DEBUG] Updated last sent timestamp: ${now.toISOString()}`
        );
      } else {
        console.log(`❌ [EMAIL] Failed to send security alert email`);
      }
    } catch (error) {
      console.error('Failed to send failed attempts alert email:', error);
    }
  }

  private async sendUnlockAlert(): Promise<void> {
    try {
      const alertEmail = await this.database.getSetting('admin_alert_email');
      if (!alertEmail) {
        return;
      }

      // Get employee name from settings
      const employeeName = await this.database.getSetting('employee_name');

      await this.emailService.sendSecurityAlert(alertEmail, {
        type: 'unlock',
        timestamp: new Date().toISOString(),
        employeeName: employeeName || undefined,
        details: {
          failedAttempts: 0,
          maxAttempts: 0,
        },
      });
    } catch (error) {
      console.error('Failed to send unlock alert email:', error);
    }
  }

  private async handleGetAppVersion(): Promise<IPCResponse<string>> {
    try {
      const version = app.getVersion();
      return { success: true, data: version };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get app version: ${error}`,
      };
    }
  }

  /**
   * BUG FIX #2: Cleanup method to clear license validation timers
   * Prevents memory leak by clearing all timers before shutdown
   */
  private cleanup(): void {
    this.logger.info('IPC', 'Cleaning up license validation timers');
    this.licenseValidationTimers.forEach((timer) => {
      clearInterval(timer);
    });
    this.licenseValidationTimers = [];
  }

  public removeAllHandlers(): void {
    // BUG FIX #2: Clear license validation timers to prevent memory leak
    this.cleanup();

    // Remove all registered handlers using removeHandler (for ipcMain.handle)
    Object.values(IPCChannels).forEach((channel) => {
      try {
        ipcMain.removeHandler(channel);
      } catch (err) {
        this.logger.warn('IPC', 'Failed to remove handler:', { channel, error: err });
      }
    });

    // Remove additional handlers not in IPCChannels
    const additionalHandlers = [
      'activity:getDailySummary',
      'startup:hasShortcut',
      'startup:configure',
      'startup:openFolder',
      'app:getVersion',
      'license:getStatus',
      'license:startTrial',
      'license:activate',
      'privacy:getSettings',
      'privacy:setMode',
      'agent:getState',
      'agent:getPairingState',
      'agent:startCloudPairing',
      'agent:unpair',
      'agent:getEffectivePolicy',
      'agent:isManaged',
    ];
    
    additionalHandlers.forEach((channel) => {
      try {
        ipcMain.removeHandler(channel);
      } catch (err) {
        this.logger.warn('IPC', 'Failed to remove additional handler:', { channel, error: err });
      }
    });

    console.log('All IPC handlers removed');
  }

  private async handleSelectExportFolder(): Promise<
    IPCResponse<string | null>
  > {
    try {
      const electron = require('electron');
      let win = electron.BrowserWindow.getFocusedWindow();
      if (!win && electron.BrowserWindow.getAllWindows) {
        const windows = electron.BrowserWindow.getAllWindows();
        win = windows && windows.length > 0 ? windows[0] : undefined;
      }
      const result = await electron.dialog.showOpenDialog(win ?? undefined, {
        title: 'Select Export Folder',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { success: true, data: null };
      }
      const folder = result.filePaths[0];
      return { success: true, data: folder };
    } catch (error) {
      console.error('Error selecting export folder:', error);
      return { success: false, error: String(error) };
    }
  }

  private async handleTestAutoExport(): Promise<
    IPCResponse<GenerateReportResponse>
  > {
    console.log('🔧 [IPC] handleTestAutoExport called');
    try {
      if (!this.autoExportScheduler) {
        console.log('❌ [IPC] Auto export scheduler not available');
        throw new Error('Auto export scheduler not available');
      }
      console.log('🔧 [IPC] Calling forceExport...');
      const result = await this.autoExportScheduler.forceExport();
      console.log('✅ [IPC] Force export successful:', result);
      return { success: true, data: result };
    } catch (error) {
      console.error('❌ [IPC] Test auto export failed:', error);
      return { success: false, error: String(error) };
    }
  }

  // Activity tracking handlers
  private async handleStartTracking(
    event: IpcMainInvokeEvent
  ): Promise<IPCResponse<void>> {
    try {
      const activityTracker = (global as any).activityTracker;
      if (!activityTracker) throw new Error('Activity tracker not initialized');
      await activityTracker.startTracking();
      return { success: true };
    } catch (error) {
      console.error('Error starting tracking:', error);
      return { success: false, error: `Failed to start tracking: ${error}` };
    }
  }

  private async handleStopTracking(
    event: IpcMainInvokeEvent
  ): Promise<IPCResponse<void>> {
    try {
      const activityTracker = (global as any).activityTracker;
      if (!activityTracker) throw new Error('Activity tracker not initialized');
      await activityTracker.stopTracking();
      return { success: true };
    } catch (error) {
      console.error('Error stopping tracking:', error);
      return { success: false, error: `Failed to stop tracking: ${error}` };
    }
  }

  private async handlePauseTracking(
    event: IpcMainInvokeEvent
  ): Promise<IPCResponse<void>> {
    try {
      const activityTracker = (global as any).activityTracker;
      if (!activityTracker) throw new Error('Activity tracker not initialized');
      await activityTracker.pauseTracking();
      return { success: true };
    } catch (error) {
      console.error('Error pausing tracking:', error);
      return { success: false, error: `Failed to pause tracking: ${error}` };
    }
  }

  private async handleResumeTracking(
    event: IpcMainInvokeEvent
  ): Promise<IPCResponse<void>> {
    try {
      const activityTracker = (global as any).activityTracker;
      if (!activityTracker) throw new Error('Activity tracker not initialized');
      await activityTracker.resumeTracking();
      return { success: true };
    } catch (error) {
      console.error('Error resuming tracking:', error);
      return { success: false, error: `Failed to resume tracking: ${error}` };
    }
  }

  private async handleGetCurrentActivity(
    event: IpcMainInvokeEvent
  ): Promise<any> {
    try {
      // Get current activity from the activity tracker
      const activityTracker = (global as any).activityTracker;
      if (!activityTracker) {
        return { success: false, error: 'Activity tracker not initialized' };
      }

      const currentActivity = activityTracker.getCurrentActivity();
      return { success: true, data: currentActivity };
    } catch (error) {
      console.error('Error getting current activity:', error);
      return {
        success: false,
        error: `Failed to get current activity: ${error}`,
      };
    }
  }

  private async handleGetTrackingStats(
    event: IpcMainInvokeEvent
  ): Promise<any> {
    try {
      // Get basic tracking statistics
      const recentLogs = this.database.getActivityLogs(200, 0); // Get last 200 activities
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const todayLogs = recentLogs.filter(
        (log) => new Date(log.timestamp).getTime() >= today.getTime()
      );

      const isPaused =
        (global as any).activityTracker?.isPausedState?.() || false;

      const stats = {
        totalActivitiesToday: todayLogs.length,
        totalTimeToday: todayLogs.reduce((sum, log) => sum + log.duration, 0),
        activeTime: todayLogs
          .filter(
            (log) =>
              !(
                log.app_name === 'System' &&
                (log.window_title === 'Idle' || log.window_title === 'Paused')
              )
          )
          .reduce((sum, log) => sum + log.duration, 0),
        isPaused,
        idleTime: todayLogs
          .filter(
            (log) => log.app_name === 'System' && log.window_title === 'Idle'
          )
          .reduce((sum, log) => sum + log.duration, 0),
      };

      return { success: true, data: stats };
    } catch (error) {
      console.error('Error getting tracking stats:', error);
      return {
        success: false,
        error: `Failed to get tracking stats: ${error}`,
      };
    }
  }

  /**
   * Check if startup shortcut exists
   */
  private async handleHasStartupShortcut(): Promise<IPCResponse<boolean>> {
    try {
      const hasShortcut = StartupHelper.hasStartupShortcut();
      return { success: true, data: hasShortcut };
    } catch (error) {
      console.error('Error checking startup shortcut:', error);
      return {
        success: false,
        error: `Failed to check startup shortcut: ${error}`,
      };
    }
  }

  /**
   * Enable or disable auto-start on login
   */
  private async handleConfigureStartup(
    _event: IpcMainInvokeEvent,
    request: { enable: boolean }
  ): Promise<IPCResponse<boolean>> {
    try {
      const result = await StartupHelper.configure(request.enable);
      return { success: true, data: result };
    } catch (error) {
      console.error('Error configuring startup:', error);
      return {
        success: false,
        error: `Failed to configure startup: ${error}`,
      };
    }
  }

  /**
   * Open Windows Startup folder
   */
  private async handleOpenStartupFolder(): Promise<IPCResponse<void>> {
    try {
      await StartupHelper.openStartupFolder();
      return { success: true, data: undefined };
    } catch (error) {
      console.error('Error opening startup folder:', error);
      return {
        success: false,
        error: `Failed to open startup folder: ${error}`,
      };
    }
  }

  /**
   * Get device ID for license activation
   */
  private async handleGetDeviceId(): Promise<IPCResponse<string>> {
    try {
      const deviceId = this.deviceIdService.getDeviceId();
      return { success: true, data: deviceId };
    } catch (error) {
      console.error('Error getting device ID:', error);
      return {
        success: false,
        error: `Failed to get device ID: ${error}`,
      };
    }
  }

  /**
   * Activate license with online activation
   */
  private async handleActivateLicense(
    _event: IpcMainInvokeEvent,
    request: ActivateLicenseRequest
  ): Promise<IPCResponse<ActivationResponse>> {
    try {
      const deviceId = this.deviceIdService.getDeviceId();
      const response = await this.licenseService.activateLicense(
        request.licenseKey,
        deviceId
      );
      return { success: true, data: response };
    } catch (error) {
      console.error('Error activating license:', error);
      return {
        success: false,
        error: `Failed to activate license: ${error}`,
      };
    }
  }

  /**
   * Validate current activation status
   */
  private async handleValidateActivation(): Promise<
    IPCResponse<ActivationStatus>
  > {
    try {
      this.logger.info('IPC', 'Validate activation request received');
      const status = this.licenseService.validateActivation();
      this.logger.info('IPC', 'Validation complete', {
        isActivated: status.isActivated,
        requiresReactivation: status.requiresReactivation,
      });
      return { success: true, data: status };
    } catch (error) {
      this.logger.error('IPC', 'Error validating activation', { error });
      return {
        success: false,
        error: `Failed to validate activation: ${error}`,
      };
    }
  }

  /**
   * Start 7-day trial mode
   */
  private async handleStartTrial(): Promise<IPCResponse<ActivationResponse>> {
    try {
      this.logger.info('IPC', 'Start trial request received');
      const response = await this.licenseService.startTrial();
      this.logger.info('IPC', 'Trial started successfully', {
        expiresAt: response.expiryDate,
      });
      return { success: true, data: response };
    } catch (error) {
      this.logger.error('IPC', 'Error starting trial', { error });
      return {
        success: false,
        error: `Failed to start trial: ${error}`,
      };
    }
  }

  // ============================================================
  // Enhanced Licensing Handlers (v1.8)
  // ============================================================

  /**
   * Freeware: always returns activated with all features
   */
  private async handleGetLicenseStatus(
    _event: IpcMainInvokeEvent
  ): Promise<IPCResponse<any>> {
    return {
      success: true,
      data: {
        mode: 'activated',
        isEntitled: true,
        trialDaysRemaining: null,
        features: {
          adminPanel: true,
          managedMode: true,
          exports: true,
          advancedReports: true,
          customBranding: true,
          apiAccess: true,
        },
      },
    };
  }

  /**
   * Start trial mode using EnhancedLicenseService
   */
  private async handleEnhancedStartTrial(
    event: IpcMainInvokeEvent
  ): Promise<IPCResponse<{ success: boolean; error?: string }>> {
    try {
      if (!this.enhancedLicenseService) {
        // Fallback for development
        return { success: true, data: { success: true } };
      }

      const result = await this.enhancedLicenseService.startTrial();

      // If trial start was successful, rebuild the application menu to hide "Enter License Key..."
      if (result.success) {
        if (this.onMenuRebuildNeeded) {
          try {
            this.onMenuRebuildNeeded();
            this.logger.info('IPC', 'Application menu rebuilt after successful trial start');
          } catch (menuError: any) {
            this.logger.warn('IPC', 'Failed to rebuild menu after trial start', { 
              error: menuError.message 
            });
          }
        }
      }

      return { success: true, data: result };
    } catch (error: any) {
      this.logger.error('IPC', 'Error starting enhanced trial', { error });
      return {
        success: false,
        error: error.message || 'Failed to start trial',
      };
    }
  }

  /**
   * Activate license using EnhancedLicenseService
   */
  private async handleEnhancedActivate(
    event: IpcMainInvokeEvent,
    licenseKeyOrRequest: string | { licenseKey: string; deviceId?: string }
  ): Promise<IPCResponse<{ success: boolean; error?: string }>> {
    try {
      if (!this.enhancedLicenseService) {
        // Fallback for development
        return { success: true, data: { success: true } };
      }

      // Support both old object format and new string format
      let licenseKey: string;
      if (typeof licenseKeyOrRequest === 'string') {
        licenseKey = licenseKeyOrRequest;
      } else if (licenseKeyOrRequest && typeof licenseKeyOrRequest === 'object' && licenseKeyOrRequest.licenseKey) {
        licenseKey = licenseKeyOrRequest.licenseKey;
      } else {
        return {
          success: false,
          error: 'License key is required',
        };
      }

      if (!licenseKey || typeof licenseKey !== 'string') {
        return {
          success: false,
          error: 'License key is required',
        };
      }

      const result = await this.enhancedLicenseService.activateWithKey(
        licenseKey
      );

      // If activation was successful, rebuild the application menu to hide "Enter License Key..."
      if (result.success) {
        if (this.onMenuRebuildNeeded) {
          try {
            this.onMenuRebuildNeeded();
            this.logger.info('IPC', 'Application menu rebuilt after successful activation');
          } catch (menuError: any) {
            this.logger.warn('IPC', 'Failed to rebuild menu after activation', { 
              error: menuError.message 
            });
          }
        }
      }

      return { success: true, data: result };
    } catch (error: any) {
      this.logger.error('IPC', 'Error activating license', { error });
      return {
        success: false,
        error: error.message || 'Failed to activate license',
      };
    }
  }

  // ============================================================
  // Privacy Settings Handlers
  // ============================================================

  /**
   * Get current privacy settings (privacy_mode_enabled and privacy_apps)
   * Requirements: 1.2, 2.2
   */
  private async handleGetPrivacySettings(
    event: IpcMainInvokeEvent
  ): Promise<IPCResponse<PrivacySettings>> {
    try {
      const privacyModeEnabled = this.database.getSetting('privacy_mode_enabled') === 'true';
      
      let privacyApps: string[] = DEFAULT_PRIVACY_APPS;
      const privacyAppsJson = this.database.getSetting('privacy_apps');
      if (privacyAppsJson) {
        try {
          privacyApps = JSON.parse(privacyAppsJson);
        } catch {
          // Fall back to default if JSON is invalid
          privacyApps = DEFAULT_PRIVACY_APPS;
        }
      }

      return {
        success: true,
        data: {
          privacyModeEnabled,
          privacyApps,
        },
      };
    } catch (error) {
      console.error('Error getting privacy settings:', error);
      return {
        success: false,
        error: `Failed to get privacy settings: ${error}`,
      };
    }
  }

  /**
   * Set privacy mode enabled/disabled
   * Requirements: 1.2, 1.3
   */
  private async handleSetPrivacyMode(
    event: IpcMainInvokeEvent,
    enabled: boolean
  ): Promise<IPCResponse<void>> {
    try {
      this.database.setSetting('privacy_mode_enabled', enabled ? 'true' : 'false');
      return { success: true };
    } catch (error) {
      console.error('Error setting privacy mode:', error);
      return {
        success: false,
        error: `Failed to set privacy mode: ${error}`,
      };
    }
  }

  // ============================================================
  // Agent (Admin Console) Handlers
  // ============================================================

  /**
   * Initialize the agent service
   * Called from main.ts after app is ready
   */
  private agentServiceInitialized: boolean = false;
  public async initializeAgentService(appVersion: string): Promise<void> {
    // AgentService is a singleton that outlives this IPCHandlers instance.
    // If we add listeners twice, every event is broadcast twice — fires IPC
    // updates to renderer twice, redraws tray twice, etc.
    if (this.agentServiceInitialized) {
      this.logger.warn('AGENT', 'Agent service already initialized on this IPCHandlers — skipping duplicate listener registration');
      return;
    }

    try {
      this.agentService = AgentService.getInstance(this.database);
      await this.agentService.initialize(appVersion);

      // Clear any listeners from a previous IPCHandlers instance before
      // re-registering. Safe because we own the full set below.
      this.agentService.removeAllListeners('stateChanged');
      this.agentService.removeAllListeners('locked');
      this.agentService.removeAllListeners('unlocked');
      this.agentService.removeAllListeners('policyUpdated');
      this.agentService.removeAllListeners('exportRequested');

      this.agentService.on('stateChanged', (state: AgentState) => {
        this.broadcastAgentStateChange(state);
      });

      this.agentService.on('locked', (data: { reason: string; message: string }) => {
        this.broadcastAgentLocked(data);
      });

      this.agentService.on('unlocked', () => {
        this.broadcastAgentUnlocked();
      });

      this.agentService.on('policyUpdated', (policy: any) => {
        this.broadcastPolicyUpdated(policy);
      });

      this.agentService.on('exportRequested', async (request: any) => {
        await this.handleAgentExportRequest(request);
      });

      this.agentServiceInitialized = true;
      this.logger.info('AGENT', 'Agent service initialized');
    } catch (error: any) {
      this.logger.error('AGENT', 'Failed to initialize agent service', { error: error.message });
    }
  }

  private async handleAgentGetState(event: IpcMainInvokeEvent): Promise<IPCResponse<AgentState | null>> {
    try {
      if (!this.agentService) return { success: true, data: null };
      return { success: true, data: this.agentService.getState() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async handleAgentGetPairingState(event: IpcMainInvokeEvent): Promise<IPCResponse<AgentPairingState | null>> {
    try {
      if (!this.agentService) return { success: true, data: null };
      return { success: true, data: this.agentService.getPairingState() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async handleAgentStartCloudPairing(_event: IpcMainInvokeEvent, request: { cloudApiUrl: string; pairCode: string }): Promise<IPCResponse<{ success: boolean; error?: string }>> {
    try {
      if (!this.agentService) return { success: false, error: 'Agent service not initialized' };
      const result = await this.agentService.startCloudPairing(request.cloudApiUrl, request.pairCode);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async handleAgentUnpair(event: IpcMainInvokeEvent): Promise<IPCResponse<void>> {
    try {
      if (!this.agentService) return { success: false, error: 'Agent service not initialized' };
      await this.agentService.unpair();
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async handleAgentGetEffectivePolicy(event: IpcMainInvokeEvent): Promise<IPCResponse<any>> {
    try {
      if (!this.agentService) return { success: true, data: null };
      return { success: true, data: this.agentService.getEffectivePolicy() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async handleAgentIsManaged(event: IpcMainInvokeEvent): Promise<IPCResponse<boolean>> {
    try {
      if (!this.agentService) return { success: true, data: false };
      return { success: true, data: this.agentService.isManaged() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async handleAgentExportRequest(request: any): Promise<void> {
    try {
      if (!this.pdfGenerator) {
        this.agentService?.sendExportResult({ success: false, error: 'PDF generator not available' });
        return;
      }
      const reportOptions: ReportOptions = {
        type: request.reportType as any,
        format: ReportFormat.PDF,
        dateRange: { startDate: request.startDate, endDate: request.endDate },
        includeCharts: true, includeSummary: true, includeDetails: true,
      };
      const result = await this.pdfGenerator.generateReport(reportOptions);
      this.agentService?.sendExportResult({ success: true, reportId: result.reportId, filePath: result.filePath, fileSize: result.fileSize });
    } catch (error: any) {
      this.agentService?.sendExportResult({ success: false, error: error.message });
    }
  }

  private lastBroadcastStatus: string = '';
  private broadcastAgentStateChange(state: AgentState): void {
    // Skip broadcast if status hasn't changed (belt-and-suspenders with agent-service dedup)
    if (state.status === this.lastBroadcastStatus) return;
    this.lastBroadcastStatus = state.status;
    try {
      const electron = require('electron');
      const windows = electron.BrowserWindow.getAllWindows();
      windows.forEach((w: any) => { try { w.webContents.send('agent:stateChanged', state); } catch {} });
    } catch {}
  }

  private broadcastAgentLocked(data: { reason: string; message: string }): void {
    try {
      const electron = require('electron');
      const windows = electron.BrowserWindow.getAllWindows();
      windows.forEach((w: any) => { try { w.webContents.send('agent:locked', data); } catch {} });
    } catch {}
  }

  private broadcastAgentUnlocked(): void {
    try {
      const electron = require('electron');
      const windows = electron.BrowserWindow.getAllWindows();
      windows.forEach((w: any) => { try { w.webContents.send('agent:unlocked'); } catch {} });
    } catch {}
  }

  private broadcastPolicyUpdated(policy: any): void {
    try {
      const electron = require('electron');
      const windows = electron.BrowserWindow.getAllWindows();
      windows.forEach((w: any) => { try { w.webContents.send('agent:policyUpdated', policy); } catch {} });
    } catch {}
  }

  public shutdownAgentService(): void {
    if (this.agentService) {
      this.agentService.shutdown();
    }
  }
}
