import {
  ReportOptions,
  ReportData,
  ReportType,
  ReportFormat,
  GenerateReportRequest,
  GenerateReportResponse,
} from '../../shared/types';

export class PDFReportService {
  private static instance: PDFReportService;

  private constructor() {
    if (!window.electronAPI) {
      throw new Error(
        'Electron API not available. Make sure preload script is loaded.'
      );
    }
  }

  public static getInstance(): PDFReportService {
    if (!PDFReportService.instance) {
      PDFReportService.instance = new PDFReportService();
    }
    return PDFReportService.instance;
  }

  // Public API methods
  public async generateReport(
    options: ReportOptions
  ): Promise<GenerateReportResponse> {
    try {
      // Build a renderer-side snapshot so the PDF matches what the user sees
      const sessionSnapshot = await this.buildSessionSnapshot();

      const request: GenerateReportRequest = { options, sessionSnapshot };
      const response = await window.electronAPI.generateReport(request);

      if (!response.success) {
        const errMsg = response.error || 'Failed to generate report';
        // Fallback: if main couldn't handle invalid export dir, prompt here and retry once
        if (errMsg.includes('[EXPORT_DIR_INVALID]')) {
          try {
            const picked = await (
              window.electronAPI as any
            ).selectExportFolder();
            if (picked?.success && picked.data) {
              // Persist and retry
              const setRes = await window.electronAPI.setSetting({
                key: 'export_folder',
                value: picked.data,
              });
              if (setRes.success) {
                const retry = await window.electronAPI.generateReport(request);
                if (retry.success && retry.data) return retry.data;
              }
            }
          } catch (e) {
            console.warn('Renderer fallback selectExportFolder failed:', e);
          }
        }
        throw new Error(errMsg);
      }

      return response.data!;
    } catch (error) {
      console.error('PDF Report Service - Error generating report:', error);
      throw error;
    }
  }

  private async buildSessionSnapshot(): Promise<
    import('../../shared/types').SessionSnapshot
  > {
    const api: any = (window as any).electronAPI;
    const now = new Date();
    // Use a shared session start persisted in localStorage with daily reset
    let sessionStartISO = '';
    try {
      const key = 'produtime.sessionStartISO';
      const lastSessionDateKey = 'produtime.lastSessionDate';
      let stored = window.localStorage.getItem(key);
      let lastSessionDate = window.localStorage.getItem(lastSessionDateKey);
      // Backward-compat: copy from legacy timeport.* keys if present
      if (!stored) {
        const legacy = window.localStorage.getItem('timeport.sessionStartISO');
        if (legacy) {
          stored = legacy;
          window.localStorage.setItem(key, legacy);
        }
      }
      if (!lastSessionDate) {
        const legacyDate = window.localStorage.getItem(
          'timeport.lastSessionDate'
        );
        if (legacyDate) {
          lastSessionDate = legacyDate;
          window.localStorage.setItem(lastSessionDateKey, legacyDate);
        }
      }
      const today = new Date().toDateString();

      // Reset session if it's from a different day
      if (stored && lastSessionDate && lastSessionDate !== today) {
        sessionStartISO = new Date().toISOString();
        window.localStorage.setItem(key, sessionStartISO);
        window.localStorage.setItem(lastSessionDateKey, today);
      } else if (stored) {
        sessionStartISO = stored;
      } else {
        // First time - create new session
        sessionStartISO = new Date().toISOString();
        window.localStorage.setItem(key, sessionStartISO);
        window.localStorage.setItem(lastSessionDateKey, today);
      }
    } catch {
      sessionStartISO = new Date().toISOString();
    }

    let recentLogs: any[] = [];
    try {
      const res = await api.getActivityLogs({ limit: 200, offset: 0 });
      if (res?.success && Array.isArray(res.data)) {
        recentLogs = res.data;
      }
    } catch {}

    // Gather current state similar to dashboard
    let isPaused = false;
    let currentActivity: any = null;
    try {
      const stats = await api.getTrackingStats();
      isPaused = !!stats?.data?.isPaused;
    } catch {}
    try {
      const res = await api.getCurrentActivity();
      currentActivity = res?.data || null;
    } catch {}

    const since = new Date(sessionStartISO).getTime();
    const relevant = recentLogs.filter(
      (log) => new Date(log.timestamp).getTime() >= since
    );

    let active = 0;
    let idle = 0;
    for (const log of relevant) {
      const isIdle =
        log.app_name === 'System' &&
        (log.window_title === 'Idle' || log.window_title === 'Paused');
      if (isIdle) idle += log.duration || 0;
      else active += log.duration || 0;
    }

    // Include ongoing current activity block as dashboard does
    let ongoingEntry: any = null;
    if (currentActivity && currentActivity.startTime) {
      const elapsed = Math.max(
        0,
        Math.floor(
          (now.getTime() - new Date(currentActivity.startTime).getTime()) / 1000
        )
      );
      const isIdle = !!currentActivity.isIdle;
      if (isIdle) idle += elapsed;
      else active += elapsed;
      ongoingEntry = {
        id: -1,
        timestamp: new Date(currentActivity.startTime).toISOString(),
        app_name: currentActivity.appName,
        window_title: currentActivity.windowTitle,
        duration: elapsed,
      };
    }

    let display = relevant.slice();
    if (ongoingEntry) display = [ongoingEntry, ...display];
    const recentActivities = display.slice(0, 8);

    const sessionDurationSeconds = Math.max(
      0,
      Math.floor((now.getTime() - new Date(sessionStartISO).getTime()) / 1000)
    );

    return {
      sessionStartISO,
      sessionDurationSeconds,
      activeSeconds: active,
      idleSeconds: idle,
      recentActivities,
    };
  }

  public async getReportData(options: ReportOptions): Promise<ReportData> {
    try {
      const response = await window.electronAPI.getReportData(options);

      if (!response.success) {
        throw new Error(response.error || 'Failed to get report data');
      }

      return response.data!;
    } catch (error) {
      console.error('PDF Report Service - Error getting report data:', error);
      throw error;
    }
  }

  public async saveReport(reportId: string, filePath: string): Promise<void> {
    try {
      const response = await window.electronAPI.saveReport(reportId, filePath);

      if (!response.success) {
        throw new Error(response.error || 'Failed to save report');
      }
    } catch (error) {
      console.error('PDF Report Service - Error saving report:', error);
      throw error;
    }
  }

  public async openReport(filePath: string): Promise<void> {
    try {
      const response = await window.electronAPI.openReport(filePath);

      if (!response.success) {
        throw new Error(response.error || 'Failed to open report');
      }
    } catch (error) {
      console.error('PDF Report Service - Error opening report:', error);
      throw error;
    }
  }

  // Settings helper: prompt user to select export folder and persist setting
  public async selectExportFolderAndSave(): Promise<string | null> {
    const response = await (window.electronAPI as any).selectExportFolder();
    if (!response.success) {
      throw new Error(response.error || 'Failed to select export folder');
    }
    const folder: string | null = response.data ?? null;
    if (folder) {
      const setRes = await window.electronAPI.setSetting({
        key: 'export_folder',
        value: folder,
      });
      if (!setRes.success) {
        throw new Error(setRes.error || 'Failed to save export folder');
      }
    }
    return folder;
  }

  // Utility methods for creating report options
  public createDailyReportOptions(
    date: string,
    includeCharts = true
  ): ReportOptions {
    return {
      type: ReportType.DAILY,
      format: ReportFormat.PDF,
      dateRange: {
        startDate: date,
        endDate: date,
      },
      includeCharts,
      includeSummary: true,
      includeDetails: true,
      title: `Daily Activity Report - ${new Date(date).toLocaleDateString()}`,
    };
  }

  public createWeeklyReportOptions(
    startDate: string,
    endDate: string,
    includeCharts = true
  ): ReportOptions {
    return {
      type: ReportType.WEEKLY,
      format: ReportFormat.PDF,
      dateRange: {
        startDate,
        endDate,
      },
      includeCharts,
      includeSummary: true,
      includeDetails: true,
      title: `Weekly Activity Report - ${new Date(startDate).toLocaleDateString()} to ${new Date(endDate).toLocaleDateString()}`,
    };
  }

  public createMonthlyReportOptions(
    year: number,
    month: number,
    includeCharts = true
  ): ReportOptions {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0); // Last day of the month

    // Format dates in local timezone to avoid UTC conversion issues
    const formatLocalDate = (date: Date): string => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    return {
      type: ReportType.MONTHLY,
      format: ReportFormat.PDF,
      dateRange: {
        startDate: formatLocalDate(startDate),
        endDate: formatLocalDate(endDate),
      },
      includeCharts,
      includeSummary: true,
      includeDetails: true,
      title: `Monthly Activity Report - ${startDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`,
    };
  }

  public createCustomReportOptions(
    startDate: string,
    endDate: string,
    options: Partial<ReportOptions> = {}
  ): ReportOptions {
    return {
      type: ReportType.CUSTOM,
      format: ReportFormat.PDF,
      dateRange: {
        startDate,
        endDate,
      },
      includeCharts: true,
      includeSummary: true,
      includeDetails: true,
      title: `Custom Activity Report - ${new Date(startDate).toLocaleDateString()} to ${new Date(endDate).toLocaleDateString()}`,
      ...options,
    };
  }

  // Date utility methods
  public getToday(): string {
    return new Date().toISOString().split('T')[0];
  }

  public getYesterday(): string {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday.toISOString().split('T')[0];
  }

  public getThisWeek(): { startDate: string; endDate: string } {
    // Monday-start week
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0=Sun..6=Sat
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // if Sunday, go back 6 days
    const startDate = new Date(today);
    startDate.setDate(today.getDate() + mondayOffset);

    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 6);

    return {
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
    };
  }

  public getLastWeek(): { startDate: string; endDate: string } {
    // Monday-start week for "last week"
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0=Sun..6=Sat
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const startDate = new Date(today);
    // last week's Monday = this Monday - 7 days
    startDate.setDate(today.getDate() + mondayOffset - 7);

    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 6);

    return {
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
    };
  }

  public getThisMonth(): { startDate: string; endDate: string } {
    const today = new Date();
    const startDate = new Date(today.getFullYear(), today.getMonth(), 1);
    const endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    return {
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
    };
  }

  public getLastMonth(): { startDate: string; endDate: string } {
    const today = new Date();
    const startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const endDate = new Date(today.getFullYear(), today.getMonth(), 0);

    return {
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
    };
  }

  // Validation methods
  public validateDateRange(startDate: string, endDate: string): boolean {
    const start = new Date(startDate);
    const end = new Date(endDate);
    return start <= end && start <= new Date();
  }

  public validateReportOptions(options: ReportOptions): string[] {
    const errors: string[] = [];

    if (!options.dateRange.startDate) {
      errors.push('Start date is required');
    }

    if (!options.dateRange.endDate) {
      errors.push('End date is required');
    }

    if (options.dateRange.startDate && options.dateRange.endDate) {
      if (
        !this.validateDateRange(
          options.dateRange.startDate,
          options.dateRange.endDate
        )
      ) {
        errors.push(
          'Invalid date range: start date must be before or equal to end date and not in the future'
        );
      }
    }

    return errors;
  }

  // Format helpers
  public formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  public getReportTypeDisplayName(type: ReportType): string {
    switch (type) {
      case ReportType.DAILY:
        return 'Daily Report';
      case ReportType.WEEKLY:
        return 'Weekly Report';
      case ReportType.MONTHLY:
        return 'Monthly Report';
      case ReportType.CUSTOM:
        return 'Custom Report';
      default:
        return 'Report';
    }
  }
}
