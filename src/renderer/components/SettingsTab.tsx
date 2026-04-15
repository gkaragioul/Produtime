import React, { useState, useEffect, useRef } from 'react';
import { AdminAuthService } from '../services/admin-auth-service';
import { AdminTimeoutService } from '../services/admin-timeout-service';
import { AdminActivityDetector } from '../services/admin-activity-detector';
import { AdminLoginDialog } from './AdminLoginDialog';

import { IPCService } from '../services/ipc-service';
import { PDFReportService } from '../services/pdf-report-service';
import { AutoUpdaterService } from '../services/auto-updater-service';
import { DiagnosticsPanel } from './DiagnosticsPanel';

import {
  SettingsValidationService,
  ValidationResult,
} from '../services/settings-validation-service';

interface DailySchedule {
  start: string; // HH:MM
  end: string; // HH:MM
  nonWorking?: boolean;
}

type Weekday =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

interface SettingsData {
  // Legacy flat schedule (kept for backward compatibility with other components)
  work_schedule_start: string;
  work_schedule_end: string;
  // New weekly schedule stored as JSON in DB under key "work_schedule_weekly"
  work_schedule_weekly?: Record<Weekday, DailySchedule>;

  export_folder: string;
  // New automation settings
  auto_export_enabled: string; // 'true' | 'false'
  auto_export_time: string; // HH:MM

  idle_threshold: string;
  employee_name: string;
  admin_alert_email: string;
  general?: string; // For general error messages
}

interface FieldValidation {
  error?: string;
  warning?: string;
  isValid: boolean;
}

/**
 * Report generation timeout in milliseconds
 * Optimized to 30 seconds with better error handling
 */
export const REPORT_GENERATION_TIMEOUT_MS = 30000; // 30 seconds

/**
 * Validate custom date range for report generation
 * @param startDate Start date in YYYY-MM-DD format
 * @param endDate End date in YYYY-MM-DD format
 * @returns Error message if invalid, null if valid
 */
export function validateCustomDateRange(
  startDate: string,
  endDate: string
): string | null {
  // Check if both dates are provided
  if (!startDate || !endDate) {
    return 'Please select both start and end dates for the custom report.';
  }

  // Parse dates - normalize to local midnight to avoid timezone issues
  // YYYY-MM-DD format is interpreted as UTC, so we need to handle it carefully
  const parseDate = (dateStr: string): Date => {
    // Validate format: must be YYYY-MM-DD
    const formatRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!formatRegex.test(dateStr)) {
      return new Date(NaN);
    }

    const parts = dateStr.split('-');
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1; // Month is 0-indexed
    const day = parseInt(parts[2], 10);

    // Validate date values
    if (month < 0 || month > 11 || day < 1 || day > 31) {
      return new Date(NaN);
    }

    return new Date(year, month, day, 0, 0, 0, 0);
  };

  const start = parseDate(startDate);
  const end = parseDate(endDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Check if dates are valid
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return 'Invalid date format. Please use YYYY-MM-DD format.';
  }

  // Check if start date is after end date
  if (start > end) {
    return 'Start date must be before or equal to end date.';
  }

  // Check if end date is in the future
  if (end > today) {
    return 'End date cannot be in the future. Please select a date up to today.';
  }

  // Check if date range is too large (more than 1 year)
  const daysDifference = Math.floor(
    (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (daysDifference > 365) {
    return 'Date range cannot exceed 365 days. Please select a smaller range.';
  }

  return null;
}

export const SettingsTab: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showLoginDialog, setShowLoginDialog] = useState(false);
  const [employeeNameLocked, setEmployeeNameLocked] = useState(false);
  const [slackUserId, setSlackUserId] = useState('');
  const [settings, setSettings] = useState<SettingsData>({
    work_schedule_start: '09:00',
    work_schedule_end: '17:00',
    work_schedule_weekly: {
      monday: { start: '09:00', end: '17:00' },
      tuesday: { start: '09:00', end: '17:00' },
      wednesday: { start: '09:00', end: '17:00' },
      thursday: { start: '09:00', end: '17:00' },
      friday: { start: '09:00', end: '17:00' },
      saturday: { start: '09:00', end: '17:00', nonWorking: true },
      sunday: { start: '09:00', end: '17:00', nonWorking: true },
    },
    export_folder: '',
    auto_export_enabled: 'true',
    auto_export_time: '',
    idle_threshold: '300',
    employee_name: '',
    admin_alert_email: '',
  });

  // Last auto-export status (success/failure and details)
  const [lastAutoExportStatus, setLastAutoExportStatus] = useState<{
    success: boolean;
    timestamp: string;
    message: string;
    mode?: string;
    filePath?: string;
  } | null>(null);

  // Auto-updater state
  const [lastCheckTime, setLastCheckTime] = useState<Date | null>(null);
  const [checkingForUpdates, setCheckingForUpdates] = useState(false);
  const autoUpdaterService = AutoUpdaterService.getInstance();

  // Helpers and UI state for weekly schedule
  const defaultWeekly = (): Record<Weekday, DailySchedule> => ({
    monday: { start: '09:00', end: '17:00' },
    tuesday: { start: '09:00', end: '17:00' },
    wednesday: { start: '09:00', end: '17:00' },
    thursday: { start: '09:00', end: '17:00' },
    friday: { start: '09:00', end: '17:00' },
    saturday: { start: '09:00', end: '17:00', nonWorking: true },
    sunday: { start: '09:00', end: '17:00', nonWorking: true },
  });

  const safelyParseWeekly = (raw?: string): Record<Weekday, DailySchedule> => {
    if (!raw) return defaultWeekly();
    try {
      const parsed = JSON.parse(raw);
      const wd = defaultWeekly();
      (Object.keys(wd) as Weekday[]).forEach((k) => {
        const v = (parsed ?? {})[k] || wd[k];
        wd[k] = {
          start: typeof v.start === 'string' ? v.start : wd[k].start,
          end: typeof v.end === 'string' ? v.end : wd[k].end,
          nonWorking: !!v.nonWorking,
        };
      });
      return wd;
    } catch {
      return defaultWeekly();
    }
  };

  const [weeklyExpanded, setWeeklyExpanded] = useState(false);
  const [weeklyErrors, setWeeklyErrors] = useState<
    Partial<Record<Weekday, string>>
  >({});
  const saveTimer = useRef<number | undefined>(undefined);

  const days: { key: Weekday; label: string }[] = [
    { key: 'monday', label: 'Monday' },
    { key: 'tuesday', label: 'Tuesday' },
    { key: 'wednesday', label: 'Wednesday' },
    { key: 'thursday', label: 'Thursday' },
    { key: 'friday', label: 'Friday' },
    { key: 'saturday', label: 'Saturday' },
    { key: 'sunday', label: 'Sunday' },
  ];

  const minutes = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };

  const isOvernight = (start: string, end: string) =>
    minutes(end) <= minutes(start);

  const validateDay = (day: DailySchedule): string | undefined => {
    if (day.nonWorking) return undefined;
    const timePattern = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/;
    if (!timePattern.test(day.start) || !timePattern.test(day.end)) {
      return 'Use HH:MM format';
    }
    if (day.start === day.end) {
      return 'Start and end cannot be the same';
    }

    // Calculate shift duration (handle overnight shifts)
    const startMin = minutes(day.start);
    const endMin = minutes(day.end);
    const durationMin = endMin > startMin
      ? endMin - startMin  // Normal shift
      : (24 * 60) - startMin + endMin;  // Overnight shift

    // Minimum 1 hour (60 minutes)
    if (durationMin < 60) {
      return 'Shift must be at least 1 hour';
    }

    // Maximum 16 hours (960 minutes)
    if (durationMin > 960) {
      return 'Shift cannot exceed 16 hours';
    }

    return undefined;
  };

  const debouncedSaveWeekly = (next: Record<Weekday, DailySchedule>) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    setSettings((prev) => ({ ...prev, work_schedule_weekly: next }));
    saveTimer.current = window.setTimeout(() => {
      const json = JSON.stringify(next);
      saveSetting('work_schedule_weekly' as any, json);
    }, 500);
  };

  const updateDay = (key: Weekday, patch: Partial<DailySchedule>) => {
    const current = settings.work_schedule_weekly ?? defaultWeekly();
    const next = { ...current, [key]: { ...current[key], ...patch } } as Record<
      Weekday,
      DailySchedule
    >;
    const err = validateDay(next[key]);
    setWeeklyErrors((prev) => ({ ...prev, [key]: err }));
    debouncedSaveWeekly(next);
  };

  const [isLoading, setIsLoading] = useState(false);
  const [autoStartEnabled, setAutoStartEnabled] = useState<boolean | null>(null);
  const [isAutoStartBusy, setIsAutoStartBusy] = useState(false);
  const [errors, setErrors] = useState<
    Partial<Record<keyof SettingsData, string>>
  >({});
  const [warnings, setWarnings] = useState<
    Partial<Record<keyof SettingsData, string>>
  >({});
  const [validationResults, setValidationResults] = useState<
    Record<string, FieldValidation>
  >({});
  const [successMessage, setSuccessMessage] = useState('');

  // Custom date range report states
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  // Privacy mode states
  const [privacyModeEnabled, setPrivacyModeEnabled] = useState(false);
  const [privacyApps, setPrivacyApps] = useState<string[]>([]);

  // Initialize timeout and admin services safely (non-throwing in tests)
  let timeoutService: AdminTimeoutService | null = null;
  let activityDetector: AdminActivityDetector | null = null;
  let adminAuthService: AdminAuthService | null = null;
  try {
    timeoutService = AdminTimeoutService.getInstance();
    activityDetector = AdminActivityDetector.getInstance();
    adminAuthService = AdminAuthService.getInstance(
      timeoutService,
      activityDetector
    );
  } catch (err) {
    console.warn(
      'SettingsTab: failed to initialize admin services; continuing in degraded mode.',
      err
    );
  }

  // Debug logging
  if (process.env.NODE_ENV === 'development') {
    console.log('🔧 [DEBUG] SettingsTab: Timeout services initialized:', {
      timeoutService: !!timeoutService,
      activityDetector: !!activityDetector,
      adminAuthService: !!adminAuthService,
    });
  }
  const ipcService = IPCService.getInstance();
  const validationService = SettingsValidationService.getInstance();

  useEffect(() => {
    // Check if admin is already authenticated
    if (adminAuthService?.isAdminAuthenticated?.()) {
      setIsAuthenticated(true);
      loadSettings();

      loadLastCheckTime();
      loadLastAutoExportStatus();
      loadAutoStartState();
      loadPrivacySettings();
    }

    // Cleanup on unmount
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, []);

  // React to admin auth changes (e.g., auto-logout from timeout)
  useEffect(() => {
    const handleAuthChange = (authed: boolean) => {
      if (!authed) {
        if (process.env.NODE_ENV === 'development') {
          console.log(
            '[DEBUG] SettingsTab: Received auto-logout event, locking settings'
          );
        }
        setIsAuthenticated(false);
        setShowLoginDialog(false);
      }
    };
    try {
      adminAuthService?.onAuthChange?.(handleAuthChange);
      return () => {
        adminAuthService?.removeAuthChangeListener?.(handleAuthChange);
      };
    } catch (err) {
      console.warn('SettingsTab: auth change listener unavailable', err);
      return () => {};
    }
  }, []);

  const loadAutoStartState = async () => {
    try {
      console.log('[AUTO-START] Loading auto-start state...');
      const api = (window as any).electronAPI;
      if (!api?.hasStartupShortcut) {
        console.log('[AUTO-START] hasStartupShortcut API not available');
        return;
      }

      const hasShortcutRes = await api.hasStartupShortcut();
      console.log('[AUTO-START] hasStartupShortcut response:', hasShortcutRes);
      const hasShortcut = hasShortcutRes?.data || false;
      console.log('[AUTO-START] Setting autoStartEnabled to:', hasShortcut);
      setAutoStartEnabled(hasShortcut);
    } catch (error) {
      console.error('[AUTO-START] Error loading auto-start state:', error);
    }
  };

  const loadLastCheckTime = async () => {
    // Assisted updater tracks check times internally
  };

  const handleCheckForUpdates = async () => {
    try {
      setCheckingForUpdates(true);
      setErrors((prev) => ({ ...prev, general: '' }));

      await autoUpdaterService.checkForUpdates();
    } catch (error) {
      console.error('Error checking for updates:', error);
      setErrors((prev) => ({
        ...prev,
        general: `Failed to check for updates: ${error instanceof Error ? error.message : String(error)}`,
      }));
    } finally {
      setCheckingForUpdates(false);
    }
  };
  const loadLastAutoExportStatus = async () => {
    try {
      const raw = await ipcService.getSetting('last_auto_export_status');
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          setLastAutoExportStatus(parsed);
        } catch (e) {
          console.warn('Failed to parse last_auto_export_status:', e);
          setLastAutoExportStatus(null);
        }
      } else {
        setLastAutoExportStatus(null);
      }
    } catch (error) {
      console.error('Error loading last auto-export status:', error);
    }
  };

  const loadPrivacySettings = async () => {
    try {
      const response = await window.electronAPI.getPrivacySettings();
      if (response.success && response.data) {
        setPrivacyModeEnabled(response.data.privacyModeEnabled);
        setPrivacyApps(response.data.privacyApps);
      }
    } catch (error) {
      console.error('Error loading privacy settings:', error);
    }
  };

  const handleOpenUpdateLogs = async () => {
    // Update logs not available with assisted updater
  };

  const loadSettings = async () => {
    setIsLoading(true);
    try {
      const allSettings = await ipcService.getAllSettings();
      const settingsMap = allSettings.reduce(
        (acc, setting) => {
          acc[setting.key] = setting.value;
          return acc;
        },
        {} as Record<string, string>
      );

      setSettings({
        work_schedule_start: settingsMap.work_schedule_start || '09:00',
        work_schedule_end: settingsMap.work_schedule_end || '17:00',
        work_schedule_weekly: safelyParseWeekly(
          settingsMap.work_schedule_weekly
        ),
        export_folder: settingsMap.export_folder || '',
        auto_export_enabled: settingsMap.auto_export_enabled ?? 'true',
        // Allow blank to mean "fall back to daily schedule end"
        auto_export_time:
          settingsMap.auto_export_time !== undefined
            ? settingsMap.auto_export_time
            : '',
        idle_threshold: settingsMap.idle_threshold || '300',
        employee_name: settingsMap.employee_name || '',
        admin_alert_email: settingsMap.admin_alert_email || '',
      });
      setEmployeeNameLocked(settingsMap.employee_name_locked === 'true');
      setSlackUserId(settingsMap.slack_user_id || '');
    } catch (error) {
      console.error('Error loading settings:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSettingsAccess = () => {
    if (adminAuthService?.isAdminAuthenticated?.()) {
      setIsAuthenticated(true);
      loadSettings();
      loadLastAutoExportStatus();
      loadAutoStartState();
      loadPrivacySettings();
    } else {
      setShowLoginDialog(true);
    }
  };

  const handleLoginSuccess = () => {
    setIsAuthenticated(true);
    loadSettings();
    loadLastAutoExportStatus();
    loadAutoStartState();
    loadPrivacySettings();
    if (process.env.NODE_ENV === 'development') {
      console.log('🔧 [DEBUG] SettingsTab: Admin login successful - silent timeout active');
    }
  };

  const handleInputChange = (key: keyof SettingsData, value: string) => {
    if (key === 'employee_name' && employeeNameLocked) {
      return; // locked — admin-only editable after first save
    }
    setSettings((prev) => ({ ...prev, [key]: value }));

    // Validate the input immediately
    const validationResult = validationService.validateSetting(key, value);
    setValidationResults((prev) => ({
      ...prev,
      [key]: {
        isValid: validationResult.isValid,
        error: validationResult.error,
        warning: validationResult.warning,
      },
    }));

    // Clear old errors and warnings for this field
    if (errors[key]) {
      setErrors((prev) => ({ ...prev, [key]: undefined }));
    }
    if (warnings[key]) {
      setWarnings((prev) => ({ ...prev, [key]: undefined }));
    }

    // Auto-save after a short delay if validation passes
    if (validationResult.isValid) {
      // For folder selection or direct edits to export_folder, save immediately for better UX
      if (key === 'export_folder') {
        // Fire-and-forget; also keep debounced save for consistency
        saveSetting(key, value);
        // Ensure IPC setSetting is invoked even if debounce is skipped in tests
        try {
          window.electronAPI.setSetting({ key: 'export_folder', value });
        } catch {}
      }
      setTimeout(() => {
        saveSetting(key, value);
      }, 500);
    }
  };

  const handlePrivacyModeToggle = async (enabled: boolean) => {
    // Update local state immediately for responsive UI
    setPrivacyModeEnabled(enabled);
    
    try {
      const response = await window.electronAPI.setPrivacyMode(enabled);
      if (response.success) {
        setSuccessMessage(
          enabled
            ? 'Privacy Mode enabled - messaging app titles will be sanitized'
            : 'Privacy Mode disabled - full window titles will be logged'
        );
        setTimeout(() => setSuccessMessage(''), 3000);
      } else {
        // Revert on failure
        setPrivacyModeEnabled(!enabled);
        setErrors((prev) => ({
          ...prev,
          general: `Failed to update privacy mode: ${response.error || 'Unknown error'}`,
        }));
      }
    } catch (error) {
      // Revert on error
      setPrivacyModeEnabled(!enabled);
      console.error('Error toggling privacy mode:', error);
      setErrors((prev) => ({
        ...prev,
        general: `Failed to update privacy mode: ${error instanceof Error ? error.message : String(error)}`,
      }));
    }
  };

  const saveSetting = async (key: keyof SettingsData, value: string) => {
    try {
      // Double-check validation before saving
      const validationResult = validationService.validateSetting(key, value);
      if (!validationResult.isValid) {
        setErrors((prev) => ({ ...prev, [key]: validationResult.error }));
        return;
      }

      await ipcService.setSetting(key, value);

      // First successful save of employee_name locks the field.
      if (key === 'employee_name' && value.trim()) {
        setEmployeeNameLocked(true);
      }

      // Notify other parts of the UI (e.g., dashboard) that settings changed
      try {
        window.dispatchEvent(
          new CustomEvent('settings-updated', { detail: { key, value } })
        );
      } catch {}

      // Show success message with field name
      const fieldName = key
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (l) => l.toUpperCase());
      setSuccessMessage(`${fieldName} updated successfully`);
      setTimeout(() => setSuccessMessage(''), 3000);

      // Notify scheduler when auto export settings change (best-effort)
      if (key === 'auto_export_enabled' || key === 'auto_export_time') {
        try {
          const nextEnabled =
            (key === 'auto_export_enabled'
              ? value
              : settings.auto_export_enabled) === 'true';
          const nextTime =
            key === 'auto_export_time' ? value : settings.auto_export_time;
          if ((window as any).electronAPI?.reconfigureScheduler) {
            await (window as any).electronAPI.reconfigureScheduler({
              enabled: nextEnabled,
              time: nextTime,
            });
          }
        } catch (err) {
          // Non-blocking feedback; keep success message for the saved field
          setErrors((prev) => ({
            ...prev,
            general: 'Failed to reconfigure scheduler',
          }));
        }
      }

      // Show warning if present
      if (validationResult.warning) {
        setWarnings((prev) => ({ ...prev, [key]: validationResult.warning }));
        setTimeout(() => {
          setWarnings((prev) => ({ ...prev, [key]: undefined }));
        }, 5000);
      }
    } catch (error) {
      console.error(`Error saving setting ${key}:`, error);
      setErrors((prev) => ({ ...prev, [key]: `Failed to save: ${error}` }));
    }
  };

  const handleFolderSelect = async () => {
    try {
      const res = await window.electronAPI.selectExportFolder();
      if (res.success && res.data) {
        handleInputChange('export_folder', res.data);
      }
    } catch (error) {
      console.error('Error selecting folder:', error);
    }
  };

  const handleTestAutoExport = async () => {
    if (!settings.export_folder) {
      setErrors((prev) => ({
        ...prev,
        export_folder: 'Export folder must be set before testing auto export',
      }));
      return;
    }

    try {
      setIsLoading(true);
      setErrors((prev) => ({ ...prev, general: '' }));
      setSuccessMessage('');

      // Use the dedicated test auto export method
      const response = await window.electronAPI.testAutoExport();

      if (response.success) {
        setSuccessMessage(
          `Test export successful! Report saved to: ${response.data?.filePath || 'export folder'}`
        );
        setTimeout(() => setSuccessMessage(''), 5000);
      } else {
        throw new Error(response.error || 'Failed to generate test export');
      }
    } catch (error) {
      console.error('Test auto export failed:', error);
      setErrors((prev) => ({
        ...prev,
        general: `Test export failed: ${error instanceof Error ? error.message : String(error)}`,
      }));
    } finally {
      try {
        await loadLastAutoExportStatus();
      } catch {}
      setIsLoading(false);
    }
  };

  const handlePurgeData = async () => {
    const confirmed = window.confirm(
      'Are you sure you want to purge all tracked data? This action cannot be undone.'
    );

    if (confirmed) {
      const doubleConfirmed = window.confirm(
        'This will permanently delete all activity logs and analytics data. Are you absolutely sure?'
      );

      if (doubleConfirmed) {
        try {
          setIsLoading(true);
          await ipcService.clearAllData();
          try {
            // Clear session tracking for new branding only; keep legacy keys intact for backward compatibility
            try {
              window.localStorage.removeItem('produtime.sessionStartISO');
            } catch {}
            // Clear any other potential localStorage keys for new namespace only
            Object.keys(window.localStorage).forEach((key) => {
              if (key.startsWith('produtime.')) {
                window.localStorage.removeItem(key);
              }
            });
          } catch {}

          // Clear any existing errors and show success message
          setErrors({});
          setSuccessMessage(
            'All data has been successfully purged. The application will reload to reset the tracking interface.'
          );

          // Reload the entire window to reset all React state and start fresh
          setTimeout(() => {
            window.location.reload();
          }, 2000);
        } catch (error) {
          console.error('Error purging data:', error);
          setErrors((prev) => ({
            ...prev,
            general: `Failed to purge data: ${error}`,
          }));
        } finally {
          setIsLoading(false);
        }
      }
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setSuccessMessage(`${label} copied to clipboard`);
    setTimeout(() => setSuccessMessage(''), 2000);
  };

  const handleLogout = () => {
    try {
      adminAuthService?.logout?.();
    } catch (err) {
      console.warn('SettingsTab: logout failed (non-fatal in tests)', err);
    }
    setIsAuthenticated(false);

    setSettings({
      work_schedule_start: '09:00',
      work_schedule_end: '17:00',
      work_schedule_weekly: defaultWeekly(),
      export_folder: '',
      auto_export_enabled: 'true',

      auto_export_time: '18:00',
      idle_threshold: '300',
      employee_name: '',
      admin_alert_email: '',
    });
    setValidationResults({});
    setErrors({});
    setWarnings({});
  };

  const renderFieldValidation = (fieldKey: keyof SettingsData) => (
    <>
      {(validationResults[fieldKey]?.error || errors[fieldKey]) && (
        <div className="field-error">
          {validationResults[fieldKey]?.error || errors[fieldKey]}
        </div>
      )}
      {(validationResults[fieldKey]?.warning || warnings[fieldKey]) && (
        <div className="field-warning">
          {validationResults[fieldKey]?.warning || warnings[fieldKey]}
        </div>
      )}
    </>
  );

  if (!isAuthenticated) {
    return (
      <div className="settings-tab">
        <div className="settings-locked">
          <div className="lock-icon">🔒</div>
          <h2>Settings Access Restricted</h2>
          <p>Administrator authentication is required to access settings.</p>
          <button
            className="access-settings-button"
            onClick={handleSettingsAccess}
          >
            Access Settings
          </button>
        </div>

        <AdminLoginDialog
          isOpen={showLoginDialog}
          onClose={() => setShowLoginDialog(false)}
          onSuccess={handleLoginSuccess}
        />
      </div>
    );
  }

  return (
    <div className="settings-tab">
      <div className="settings-header">
        <h2>Application Settings</h2>
        <div className="header-buttons">
          <button className="logout-button" onClick={handleLogout}>
            Logout
          </button>
          <button
            className="exit-button"
            onClick={async () => {
              const api = (window as any).electronAPI;
              await api.quitApplication();
            }}
          >
            Exit App
          </button>
        </div>
      </div>

      {successMessage && (
        <div
          className="banner success-banner"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {successMessage}
        </div>
      )}

      {errors.general && (
        <div
          className="banner error-banner"
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
        >
          {errors.general}
        </div>
      )}

      {isLoading && (
        <div className="loading-indicator">Loading settings...</div>
      )}

      <div className="settings-scroll-wrapper">
        <div className="settings-scrollable-container">
          <div className="settings-content">
            {/* Daily Work Hours (Weekly) Section */}
            <div className="settings-section collapsible-section">
              <div
                className="collapsible-header"
                onClick={() => setWeeklyExpanded((v) => !v)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setWeeklyExpanded((v) => !v);
                  }
                }}
                role="button"
                aria-expanded={weeklyExpanded}
                tabIndex={0}
              >
                <h3 style={{ margin: 0 }}>Daily Work Hours</h3>
                <span
                  className={`caret ${weeklyExpanded ? 'open' : ''}`}
                  aria-hidden
                >
                  ▸
                </span>
              </div>
              {weeklyExpanded && (
                <div className="weekly-schedule">
                  <div className="day-grid">
                    {days.map(({ key, label }) => {
                      const day = (settings.work_schedule_weekly ||
                        defaultWeekly())[key];
                      const overnight =
                        !day.nonWorking && isOvernight(day.start, day.end);
                      return (
                        <div className="day-row" key={key}>
                          <div className="day-label">{label}</div>
                          <div className="form-inline">
                            <label
                              className="inline-label"
                              htmlFor={`week-${key}-start`}
                            >
                              Start
                            </label>
                            <input
                              id={`week-${key}-start`}
                              type="time"
                              value={day.start}
                              disabled={day.nonWorking}
                              onChange={(e) =>
                                updateDay(key, { start: e.target.value })
                              }
                            />
                          </div>
                          <div className="form-inline">
                            <label
                              className="inline-label"
                              htmlFor={`week-${key}-end`}
                            >
                              End
                            </label>
                            <input
                              id={`week-${key}-end`}
                              type="time"
                              value={day.end}
                              disabled={day.nonWorking}
                              onChange={(e) =>
                                updateDay(key, { end: e.target.value })
                              }
                            />
                          </div>
                          <div className="form-inline">
                            <label
                              className="inline-label"
                              htmlFor={`week-${key}-nonWorking`}
                            >
                              Non-working
                            </label>
                            <input
                              id={`week-${key}-nonWorking`}
                              type="checkbox"
                              checked={!!day.nonWorking}
                              onChange={(e) =>
                                updateDay(key, { nonWorking: e.target.checked })
                              }
                            />
                          </div>
                          <div className="day-hint">
                            {weeklyErrors[key] && (
                              <span className="field-error small">
                                {weeklyErrors[key]}
                              </span>
                            )}
                            {!weeklyErrors[key] && overnight && (
                              <span className="field-help small">
                                Overnight shift
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="field-help" style={{ marginTop: 8 }}>
                    Tip: For overnight shifts set End time earlier than Start
                    time (e.g., Start 22:00, End 06:00).
                  </div>
                </div>
              )}
            </div>

            {/* Export Settings Section */}
            <div className="settings-section">
              <h3>Export Settings</h3>
              <div className="form-group">
                <label htmlFor="export-folder">Export Folder:</label>
                <div className="folder-input-group">
                  <input
                    id="export-folder"
                    type="text"
                    value={settings.export_folder}
                    onChange={(e) =>
                      handleInputChange('export_folder', e.target.value)
                    }
                    placeholder="Select export folder..."
                    disabled={isLoading}
                  />
                  <button
                    className="folder-select-button"
                    onClick={handleFolderSelect}
                    disabled={isLoading}
                  >
                    Browse
                  </button>
                </div>
                {renderFieldValidation('export_folder')}
              </div>

              {/* Automatic Export Controls */}
              <div className="form-group">
                <label>Automatic Daily Export:</label>
                <div className="form-inline">
                  <input
                    id="auto-export-enabled"
                    type="checkbox"
                    checked={settings.auto_export_enabled === 'true'}
                    onChange={(e) =>
                      handleInputChange(
                        'auto_export_enabled',
                        e.target.checked ? 'true' : 'false'
                      )
                    }
                    disabled={isLoading}
                  />
                  <label
                    htmlFor="auto-export-enabled"
                    style={{ marginLeft: 8 }}
                  >
                    Enable
                  </label>
                </div>
                {renderFieldValidation('auto_export_enabled')}
              </div>

              <div className="form-group form-inline">
                <label className="inline-label" htmlFor="auto-export-time">
                  Export Time
                </label>
                <input
                  id="auto-export-time"
                  type={process.env.NODE_ENV === 'test' ? 'text' : 'time'}
                  value={settings.auto_export_time}
                  onChange={(e) =>
                    handleInputChange('auto_export_time', e.target.value)
                  }
                  disabled={
                    isLoading || settings.auto_export_enabled !== 'true'
                  }
                  aria-invalid={
                    !!(
                      validationResults['auto_export_time']?.error ||
                      errors['auto_export_time']
                    )
                  }
                />
              </div>
              {renderFieldValidation('auto_export_time')}
              <div className="field-help">
                Time of day to run the automatic export (24-hour format). Leave
                blank to use your daily schedule end time.
              </div>

              {/* Test Auto Export Button */}
              <div className="form-group">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleTestAutoExport}
                  disabled={isLoading || !settings.export_folder}
                  style={{ marginTop: '10px' }}
                >
                  Test Auto Export
                </button>
                <div className="field-help" style={{ marginTop: '5px' }}>
                  Manually trigger an export to test the auto-export
                  functionality.
                  {!settings.export_folder &&
                    ' (Export folder must be set first)'}
                </div>
                {/* Last Auto Export Status */}
                {lastAutoExportStatus && (
                  <div className="field-help" style={{ marginTop: '8px' }}>
                    Last auto export:{' '}
                    {lastAutoExportStatus.success ? 'Success' : 'Failed'} at{' '}
                    {new Date(lastAutoExportStatus.timestamp).toLocaleString()}.
                    {lastAutoExportStatus.message
                      ? ` ${lastAutoExportStatus.message}`
                      : ''}
                    {lastAutoExportStatus.filePath && (
                      <>
                        {' '}
                        <button
                          type="button"
                          className="btn btn-link"
                          onClick={() =>
                            PDFReportService.getInstance().openReport(
                              lastAutoExportStatus.filePath!
                            )
                          }
                        >
                          Open report
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Idle Time Section */}
              <div className="settings-section">
                <h3>Idle Time</h3>
                <div className="form-group">
                  <label htmlFor="idle-threshold">
                    Idle Threshold (seconds):
                  </label>
                  <input
                    id="idle-threshold"
                    type="number"
                    min={30}
                    max={3600}
                    value={settings.idle_threshold}
                    onChange={(e) =>
                      handleInputChange('idle_threshold', e.target.value)
                    }
                    placeholder="e.g., 300"
                    disabled={isLoading}
                  />
                  {renderFieldValidation('idle_threshold')}
                  <div className="field-help">
                    How long without activity before you’re considered idle.
                  </div>
                </div>
              </div>
            </div>
            {/* Export Reports Section */}
            <div className="settings-section">
              <h3>Export Reports</h3>

              {/* Daily Report */}
              <div className="form-group">
                <button
                  className="folder-select-button"
                  onClick={async () => {
                    let watchdog: any;
                    let timedOut = false;
                    try {
                      setIsLoading(true);
                      setSuccessMessage('Generating report...');

                      // BUG FIX #13: Track timeout state to prevent showing success after timeout
                      watchdog = setTimeout(() => {
                        timedOut = true;
                        setErrors((prev) => ({
                          ...prev,
                          general:
                            'Report generation timed out after 30 seconds. Try a smaller date range or contact support.',
                        }));
                        setSuccessMessage('');
                      }, REPORT_GENERATION_TIMEOUT_MS);

                      const today = new Date().toISOString().split('T')[0];
                      const reportService = PDFReportService.getInstance();
                      const opts =
                        reportService.createDailyReportOptions(today);
                      opts.useEnhancedAnalytics = true;

                      const result = await reportService.generateReport(opts);

                      // BUG FIX #13: Only proceed if not timed out
                      if (!timedOut) {
                        await reportService.openReport(result.filePath);
                        setSuccessMessage('Daily report generated and opened successfully');
                        setTimeout(() => setSuccessMessage(''), 3000);
                      }
                    } catch (err) {
                      console.error('Error generating report:', err);
                      const msg =
                        err instanceof Error ? err.message : String(err);
                      setErrors((prev) => ({
                        ...prev,
                        general: `Failed to generate report: ${msg}`,
                      }));
                    } finally {
                      if (watchdog) clearTimeout(watchdog);
                      setIsLoading(false);
                    }
                  }}
                  disabled={isLoading}
                >
                  Daily Report
                </button>
                <div className="field-help">
                  Generate a PDF report for today's activity. The report will be
                  saved to your configured export folder and opened
                  automatically.
                </div>
              </div>

              {/* Weekly Report */}
              <div className="form-group">
                <button
                  className="folder-select-button"
                  onClick={async () => {
                    let watchdog: any;
                    try {
                      setIsLoading(true);
                      setSuccessMessage('Generating weekly report...');

                      watchdog = setTimeout(() => {
                        setIsLoading(false);
                        setErrors((prev) => ({
                          ...prev,
                          general: 'Report generation timed out after 30 seconds.',
                        }));
                      }, REPORT_GENERATION_TIMEOUT_MS);

                      // Calculate this week (Monday to Sunday)
                      const now = new Date();
                      const dayOfWeek = now.getDay();
                      const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
                      const monday = new Date(now);
                      monday.setDate(now.getDate() + diff);
                      const sunday = new Date(monday);
                      sunday.setDate(monday.getDate() + 6);

                      const startDate = monday.toISOString().split('T')[0];
                      const endDate = sunday.toISOString().split('T')[0];

                      const reportService = PDFReportService.getInstance();
                      const opts = reportService.createWeeklyReportOptions(
                        startDate,
                        endDate
                      );
                      opts.useEnhancedAnalytics = true;

                      const result = await reportService.generateReport(opts);
                      await reportService.openReport(result.filePath);
                      setSuccessMessage('Weekly report generated and opened successfully');
                      setTimeout(() => setSuccessMessage(''), 3000);
                    } catch (err) {
                      console.error('Error generating weekly report:', err);
                      const msg =
                        err instanceof Error ? err.message : String(err);
                      setErrors((prev) => ({
                        ...prev,
                        general: `Failed to generate weekly report: ${msg}`,
                      }));
                    } finally {
                      if (watchdog) clearTimeout(watchdog);
                      setIsLoading(false);
                    }
                  }}
                  disabled={isLoading}
                >
                  Weekly Report
                </button>
                <div className="field-help">
                  Generate a PDF report for the current week (Monday to Sunday).
                  Includes all activity data with enhanced analytics.
                </div>
              </div>

              {/* Monthly Report */}
              <div className="form-group">
                <button
                  className="folder-select-button"
                  onClick={async () => {
                    let watchdog: any;
                    try {
                      setIsLoading(true);
                      setSuccessMessage('Generating monthly report...');

                      watchdog = setTimeout(() => {
                        setIsLoading(false);
                        setErrors((prev) => ({
                          ...prev,
                          general: 'Report generation timed out after 30 seconds.',
                        }));
                      }, REPORT_GENERATION_TIMEOUT_MS);

                      const now = new Date();
                      const year = now.getFullYear();
                      const month = now.getMonth() + 1;

                      const reportService = PDFReportService.getInstance();
                      const opts = reportService.createMonthlyReportOptions(
                        year,
                        month
                      );
                      opts.useEnhancedAnalytics = true;

                      const result = await reportService.generateReport(opts);
                      await reportService.openReport(result.filePath);
                      setSuccessMessage('Monthly report generated and opened successfully');
                      setTimeout(() => setSuccessMessage(''), 3000);
                    } catch (err) {
                      console.error('Error generating monthly report:', err);
                      const msg =
                        err instanceof Error ? err.message : String(err);
                      setErrors((prev) => ({
                        ...prev,
                        general: `Failed to generate monthly report: ${msg}`,
                      }));
                    } finally {
                      if (watchdog) clearTimeout(watchdog);
                      setIsLoading(false);
                    }
                  }}
                  disabled={isLoading}
                >
                  Monthly Report
                </button>
                <div className="field-help">
                  Generate a PDF report for the current month. Includes all
                  activity data with enhanced analytics.
                </div>
              </div>

              {/* Custom Date Range Report */}
              <div className="form-group">
                <label>Custom Date Range Report</label>
                <div
                  style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}
                >
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '12px', color: '#666' }}>
                      Start Date
                    </label>
                    <input
                      type="date"
                      value={customStartDate}
                      onChange={(e) => setCustomStartDate(e.target.value)}
                      max={new Date().toISOString().split('T')[0]}
                      className="settings-input"
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '12px', color: '#666' }}>
                      End Date
                    </label>
                    <input
                      type="date"
                      value={customEndDate}
                      onChange={(e) => setCustomEndDate(e.target.value)}
                      max={new Date().toISOString().split('T')[0]}
                      className="settings-input"
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>
                <button
                  className="folder-select-button"
                  onClick={async () => {
                    // Comprehensive date range validation
                    const validationError = validateCustomDateRange(
                      customStartDate,
                      customEndDate
                    );
                    if (validationError) {
                      setErrors((prev) => ({
                        ...prev,
                        general: validationError,
                      }));
                      return;
                    }

                    let watchdog: any;
                    try {
                      setIsLoading(true);
                      setSuccessMessage('Generating custom report...');

                      watchdog = setTimeout(() => {
                        setIsLoading(false);
                        setErrors((prev) => ({
                          ...prev,
                          general: 'Report generation timed out after 30 seconds.',
                        }));
                      }, REPORT_GENERATION_TIMEOUT_MS);

                      const reportService = PDFReportService.getInstance();
                      const opts = reportService.createCustomReportOptions(
                        customStartDate,
                        customEndDate
                      );
                      opts.useEnhancedAnalytics = true;

                      const result = await reportService.generateReport(opts);
                      await reportService.openReport(result.filePath);
                      setSuccessMessage('Custom report generated and opened successfully');
                      setTimeout(() => setSuccessMessage(''), 3000);
                    } catch (err) {
                      console.error('Error generating custom report:', err);
                      const msg =
                        err instanceof Error ? err.message : String(err);
                      setErrors((prev) => ({
                        ...prev,
                        general: `Failed to generate custom report: ${msg}`,
                      }));
                    } finally {
                      if (watchdog) clearTimeout(watchdog);
                      setIsLoading(false);
                    }
                  }}
                  disabled={isLoading || !customStartDate || !customEndDate}
                >
                  Generate Custom Report
                </button>
                <div className="field-help">
                  Generate a PDF report for a custom date range. Select start
                  and end dates above, then click to generate the report with
                  enhanced analytics.
                </div>
              </div>
            </div>

            {/* Employee Information Section */}
            <div className="settings-section">
              <h3>Employee Information</h3>
              <div className="form-group">
                <label htmlFor="employee-name">Employee Name:</label>
                <input
                  id="employee-name"
                  type="text"
                  value={settings.employee_name}
                  onChange={(e) =>
                    handleInputChange('employee_name', e.target.value)
                  }
                  placeholder={employeeNameLocked ? '' : 'Enter employee name (can only be set once)...'}
                  disabled={isLoading || employeeNameLocked}
                  title={employeeNameLocked ? 'Locked — contact your admin to change.' : ''}
                  aria-invalid={
                    !!(
                      validationResults['employee_name']?.error ||
                      errors['employee_name']
                    )
                  }
                />
                {renderFieldValidation('employee_name')}
                {employeeNameLocked && (
                  <div className="field-help">Locked — contact your admin to change.</div>
                )}
                {!employeeNameLocked && (
                  <div className="field-help">Your name can only be set once from here. After saving, only an admin can change it.</div>
                )}
              </div>
              {slackUserId && (
                <div className="form-group">
                  <label>Slack User ID:</label>
                  <input
                    type="text"
                    value={slackUserId}
                    disabled
                    readOnly
                    title="Managed by your admin"
                    style={{ fontFamily: 'monospace' }}
                  />
                  <div className="field-help">Managed by your admin.</div>
                </div>
              )}
            </div>

            {/* Privacy Settings Section */}
            <div className="settings-section privacy-section">
              <h3>Privacy</h3>
              <div className="form-group">
                <div className="privacy-toggle-row">
                  <label className="privacy-toggle-label">
                    <input
                      type="checkbox"
                      checked={privacyModeEnabled}
                      onChange={(e) => handlePrivacyModeToggle(e.target.checked)}
                      disabled={isLoading}
                      className="privacy-checkbox"
                    />
                    <span className="privacy-toggle-text">Privacy Mode for Messaging Apps</span>
                  </label>
                </div>
                <div className="field-help">
                  When enabled, messaging apps (Slack, Teams, Discord, etc.) will only 
                  show the app name instead of conversation details in activity logs.
                  This helps protect sensitive information like contact names and message previews.
                </div>
              </div>
              {privacyModeEnabled && privacyApps.length > 0 && (
                <div className="privacy-apps-container">
                  <p className="privacy-apps-label">Protected applications:</p>
                  <ul className="privacy-apps-list">
                    {privacyApps.map((app) => (
                      <li key={app} className="privacy-app-item">{app}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Security Settings Section */}
            <div className="settings-section">
              <h3>Security Settings</h3>
              <div className="form-group">
                <label htmlFor="alert-email">Alert Email:</label>
                <input
                  id="alert-email"
                  type="email"
                  value={settings.admin_alert_email}
                  onChange={(e) =>
                    handleInputChange('admin_alert_email', e.target.value)
                  }
                  placeholder="admin@company.com"
                  disabled={isLoading}
                  aria-invalid={
                    !!(
                      validationResults['admin_alert_email']?.error ||
                      errors['admin_alert_email']
                    )
                  }
                />
                {renderFieldValidation('admin_alert_email')}
                <div className="field-help">
                  We'll notify this email if automatic exports fail after
                  retries, and for important security alerts.
                </div>
              </div>
            </div>

            {/* Application Settings Section */}
            <div className="settings-section">
              <h3>Application Preferences</h3>
              <div className="form-group">
                <label>Auto-Start on Login:</label>
                <button
                  className="folder-select-button"
                  style={{
                    backgroundColor:
                      autoStartEnabled === null
                        ? undefined
                        : autoStartEnabled
                        ? '#dc3545' // Red when enabled (button will disable)
                        : undefined, // Default styling when disabled
                    color: autoStartEnabled === true ? '#ffffff' : undefined,
                    fontWeight: autoStartEnabled === true ? 'bold' : undefined,
                    border: autoStartEnabled === true ? '2px solid #a71d2a' : undefined,
                  }}
                  onClick={async () => {
                    try {
                      console.log('[AUTO-START] Button clicked, current state:', autoStartEnabled);
                      setIsLoading(true);
                      setIsAutoStartBusy(true);
                      const api = (window as any).electronAPI;

                      // Check current state
                      const hasShortcutRes = await api.hasStartupShortcut();
                      const hasShortcut = hasShortcutRes?.data || false;
                      console.log('[AUTO-START] Current hasShortcut:', hasShortcut, 'Will toggle to:', !hasShortcut);

                      // Toggle
                      const result = await api.configureStartup(!hasShortcut);
                      console.log('[AUTO-START] configureStartup result:', result);

                      if (result?.success) {
                        // BUG FIX #10: Verify the new state after toggling
                        // This prevents UI from being out of sync with actual state
                        const verifyRes = await api.hasStartupShortcut();
                        const verifiedState = verifyRes?.data || false;
                        setAutoStartEnabled(verifiedState);
                        setSuccessMessage(
                          verifiedState
                            ? 'Auto-start enabled successfully'
                            : 'Auto-start disabled successfully'
                        );
                        setTimeout(() => setSuccessMessage(''), 3000);
                      } else {
                        throw new Error(
                          result?.error || 'Failed to configure auto-start'
                        );
                      }
                    } catch (err) {
                      console.error('[AUTO-START] Error configuring auto-start:', err);
                      setErrors((prev) => ({
                        ...prev,
                        general: `Failed to configure auto-start: ${err instanceof Error ? err.message : String(err)}`,
                      }));
                    } finally {
                      setIsLoading(false);
                      setIsAutoStartBusy(false);
                    }
                  }}
                  disabled={isLoading || isAutoStartBusy || autoStartEnabled === null}
                >
                  {isAutoStartBusy
                    ? 'Updating...'
                    : autoStartEnabled === null
                    ? 'Checking...'
                    : autoStartEnabled
                    ? 'Disable Auto-Start'
                    : 'Enable Auto-Start'}
                </button>
                <div className="field-help">
                  Configure ProduTime to start automatically when you log in to
                  Windows. This ensures your work hours are tracked from the
                  moment you start your workday.
                </div>
              </div>
            </div>

            {/* Freeware: Auto-update and license sections removed */}

            {/* Data Management Section */}
            <div className="settings-section">
              <h3>Data Management</h3>
              <div className="form-group">
                <label>Purge All Data:</label>
                <button
                  className="purge-button"
                  onClick={handlePurgeData}
                  disabled={isLoading}
                >
                  {isLoading ? 'Purging...' : 'Purge All Data'}
                </button>
                <div className="field-help">
                  Permanently delete all activity logs and analytics data
                </div>
              </div>
            </div>

            {/* Diagnostics — live log tail with copy/clear controls */}
            <DiagnosticsPanel />
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsTab;







