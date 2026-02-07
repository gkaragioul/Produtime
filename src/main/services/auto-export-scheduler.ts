import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DatabaseManager } from '../database';
import { PDFGenerator } from '../pdf-generator';
import { SessionSnapshot, ActivityLog } from '../../shared/types';
import { DEFAULT_PRIVACY_APPS } from './privacy-constants';

interface SchedulerOptions {
  checkIntervalMs?: number; // default 60_000 ms
  now?: () => Date; // for testability
  logger?: (...args: any[]) => void;
}

export class AutoExportScheduler {
  private db: DatabaseManager;
  private pdf: PDFGenerator;
  private timer: NodeJS.Timeout | null = null;
  private isExporting = false;
  private opts: Required<SchedulerOptions>;

  constructor(
    db: DatabaseManager,
    pdf: PDFGenerator,
    options?: SchedulerOptions
  ) {
    this.db = db;
    this.pdf = pdf;
    this.opts = {
      checkIntervalMs: options?.checkIntervalMs ?? 60_000,
      now: options?.now ?? (() => new Date()),
      logger: options?.logger ?? console.log,
    };
  }

  /**
   * Sanitize activity logs based on privacy mode settings.
   * When privacy mode is enabled, window titles for privacy-sensitive apps
   * are replaced with just the app name to hide recipient/conversation details.
   */
  private sanitizeActivityLogs(logs: ActivityLog[]): ActivityLog[] {
    const privacyEnabled = this.db.getSetting('privacy_mode_enabled') === 'true';
    
    if (!privacyEnabled) {
      return logs;
    }

    // Get privacy apps list
    let privacyApps: string[] = DEFAULT_PRIVACY_APPS;
    const privacyAppsJson = this.db.getSetting('privacy_apps');
    if (privacyAppsJson) {
      try {
        const parsed = JSON.parse(privacyAppsJson);
        // Validate that parsed data is an array of strings
        if (Array.isArray(parsed) && parsed.every((item: unknown) => typeof item === 'string')) {
          privacyApps = parsed;
        } else {
          privacyApps = DEFAULT_PRIVACY_APPS;
        }
      } catch (err) {
        this.opts.logger('[AutoExport] Failed to parse privacy apps settings:', err);
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

  // Exposed for tests and manual triggering
  public async runOnce() {
    await this.tick();
  }

  // Build session snapshot similar to renderer's PDFReportService
  public async buildSessionSnapshot(): Promise<SessionSnapshot> {
    const now = this.opts.now();

    // Use a session start that's consistent with the current session
    // For auto-export, we'll use the start of the current day as session start
    // This ensures the report covers the full day's activity
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const sessionStartISO = startOfDay.toISOString();

    // Get recent activity logs
    let recentLogs: any[] = [];
    try {
      const rawLogs = this.db.getActivityLogs(200, 0);
      // Apply privacy sanitization to activity logs
      recentLogs = this.sanitizeActivityLogs(rawLogs || []);
      if (!recentLogs || recentLogs.length === 0) {
        this.opts.logger(
          '[AutoExport] ⚠️ WARNING: No activity logs found for today'
        );
      } else {
        this.opts.logger(
          `[AutoExport] ✅ Retrieved ${recentLogs.length} activity logs`
        );
      }
    } catch (err) {
      this.opts.logger(
        '[AutoExport] ❌ ERROR: Failed to retrieve activity logs:',
        err instanceof Error ? err.message : String(err)
      );
      recentLogs = [];
    }

    // Get current activity state
    let currentActivity: any = null;
    try {
      // Access the global activity tracker if available
      const activityTracker = (global as any).activityTracker;
      if (activityTracker && activityTracker.getCurrentActivity) {
        currentActivity = activityTracker.getCurrentActivity();
        this.opts.logger('[AutoExport] ✅ Retrieved current activity state');
      } else {
        this.opts.logger(
          '[AutoExport] ⚠️ WARNING: Activity tracker not available'
        );
      }
    } catch (err) {
      this.opts.logger(
        '[AutoExport] ❌ ERROR: Failed to get current activity:',
        err instanceof Error ? err.message : String(err)
      );
    }

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

  // Force an export regardless of time/date conditions (for testing)
  public async forceExport() {
    this.opts.logger('🔧 [AutoExport] forceExport called');
    if (this.isExporting) {
      throw new Error('Export already in progress');
    }
    this.isExporting = true;
    try {
      const enabled = this.db.getSetting('auto_export_enabled');
      this.opts.logger('🔧 [AutoExport] auto_export_enabled:', enabled);
      if (enabled !== 'true') {
        throw new Error('Auto export is disabled');
      }

      const exportFolder = this.db.getSetting('export_folder') || '';
      this.opts.logger('🔧 [AutoExport] export_folder:', exportFolder);
      if (!exportFolder) {
        throw new Error('Export folder not set');
      }

      this.opts.logger('🔧 [AutoExport] Ensuring directory exists...');
      this.ensureDir(exportFolder);

      const now = this.opts.now();
      const today = now.toISOString().split('T')[0];
      this.opts.logger('🔧 [AutoExport] Today:', today);

      // Build session snapshot for simplified report
      this.opts.logger('🔧 [AutoExport] Building session snapshot...');
      const sessionSnapshot = await this.buildSessionSnapshot();

      const options = {
        type: 'daily' as const,
        format: 'pdf' as const,
        dateRange: { startDate: today, endDate: today },
        includeCharts: true,
        includeSummary: true,
        includeDetails: true,
        useEnhancedAnalytics: true,
        title: `Manual Daily Activity Report - ${today}`,
      };

      this.opts.logger(
        '🔧 [AutoExport] Calling PDF generator with enhanced analytics...'
      );
      const result = await this.pdf.generateReport(options as any);
      this.opts.logger(
        '✅ [AutoExport] Manual export completed:',
        result.filePath
      );
      const ts = this.opts.now().toISOString();
      try {
        this.db.setSetting(
          'last_auto_export_status',
          JSON.stringify({
            success: true,
            timestamp: ts,
            mode: 'manual',
            message: 'Report exported successfully',
            filePath: result.filePath,
          })
        );
      } catch {}
      return result;
    } catch (err) {
      const ts = this.opts.now().toISOString();
      try {
        this.db.setSetting(
          'last_auto_export_status',
          JSON.stringify({
            success: false,
            timestamp: ts,
            mode: 'manual',
            message: err instanceof Error ? err.message : String(err),
          })
        );
      } catch {}
      this.opts.logger('❌ [AutoExport] Manual export error:', err);
      throw err;
    } finally {
      this.isExporting = false;
    }
  }

  public start() {
    this.stop();
    this.opts.logger('[AutoExport] Starting scheduler...');
    this.timer = setInterval(() => this.tick(), this.opts.checkIntervalMs);
    // also run one immediate tick so we don't have to wait a minute
    this.tick();
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.opts.logger('[AutoExport] Stopped scheduler.');
    }
  }

  private parseTimeHHMM(
    value: string
  ): { hours: number; minutes: number } | null {
    const m = /^(\d{1,2}):(\d{2})$/.exec(value || '');
    if (!m) return null;
    const hours = parseInt(m[1], 10);
    const minutes = parseInt(m[2], 10);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return { hours, minutes };
  }

  private isAfterOrEqual(now: Date, hhmm: string): boolean {
    const parsed = this.parseTimeHHMM(hhmm);
    if (!parsed) return false;
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const thrMinutes = parsed.hours * 60 + parsed.minutes;
    return nowMinutes >= thrMinutes;
  }

  /**
   * Validate that the export folder exists and is writable
   * @param dir Directory path to validate
   * @returns true if valid, false otherwise
   */
  public validateExportFolder(dir: string): boolean {
    try {
      if (!dir || dir.trim() === '') {
        this.opts.logger('[AutoExport] ❌ Export folder path is empty');
        return false;
      }

      // Security: only allow export paths within user's home or temp directories
      const normalized = path.resolve(dir);
      const allowedBases = [
        path.resolve(os.homedir()),
        path.resolve(os.tmpdir()),
      ];
      const withinAllowed = allowedBases.some((base) =>
        normalized.toLowerCase().startsWith(base.toLowerCase() + path.sep)
      );
      if (!withinAllowed) {
        this.opts.logger(
          `[AutoExport] ❌ Export path is outside allowed directories (home/temp): ${normalized}`
        );
        return false;
      }

      // Try to create directory if it doesn't exist
      if (!fs.existsSync(normalized)) {
        try {
          fs.mkdirSync(normalized, { recursive: true });
          this.opts.logger(
            `[AutoExport] ✅ Created export folder: ${normalized}`
          );
        } catch (err) {
          this.opts.logger(
            `[AutoExport] ❌ Failed to create export folder: ${normalized}`,
            err
          );
          return false;
        }
      }

      // Quick metadata-based check for read-only attributes (helps on some platforms)
      try {
        const st = fs.statSync(normalized);
        if ((st.mode & 0o222) === 0) {
          this.opts.logger(
            `[AutoExport] ❌ Export folder appears read-only by mode bits: ${normalized}`
          );
          return false;
        }
      } catch {
        // ignore and continue to write-test
      }

      // Perform an actual write test using a try-finally for guaranteed cleanup
      const probeName = `.write-test-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
      const probePath = path.join(normalized, probeName);
      let writeSucceeded = false;

      try {
        fs.writeFileSync(probePath, 'ok');
        writeSucceeded = true;
        this.opts.logger(
          `[AutoExport] ✅ Export folder is writable: ${normalized}`
        );
        return true;
      } catch (err) {
        this.opts.logger(
          `[AutoExport] ❌ Export folder is not writable: ${normalized}`,
          err
        );
        return false;
      } finally {
        // Guaranteed cleanup of test file if it was created
        if (writeSucceeded) {
          try {
            fs.unlinkSync(probePath);
          } catch (cleanupErr) {
            // Log but don't fail if cleanup fails
            this.opts.logger(
              `[AutoExport] ⚠️ Warning: Could not delete test file: ${probePath}`,
              cleanupErr
            );
          }
        }
      }
    } catch (err) {
      this.opts.logger(
        `[AutoExport] ❌ Error validating export folder: ${dir}`,
        err
      );
      return false;
    }
  }

  private ensureDir(dir: string) {
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      this.opts.logger(`[AutoExport] Failed to create directory: ${dir}`, err);
      throw new Error(`Failed to create export directory: ${dir}`);
    }
  }

  private async tick() {
    if (this.isExporting) {
      this.opts.logger('[AutoExport] Export already in progress, skipping tick');
      return;
    }
    try {
      const enabled = this.db.getSetting('auto_export_enabled');
      if (enabled !== 'true') {
        this.opts.logger('[AutoExport] Auto export disabled, skipping tick');
        return;
      }

      const exportFolder = this.db.getSetting('export_folder') || '';

      // Determine the trigger time with backward-compatible precedence:
      // 1) auto_export_time (if set)
      // 2) per-day end time from work_schedule_weekly (if present and not nonWorking)
      // 3) flat work_schedule_end
      // 4) default '17:00'
      const now = this.opts.now();
      const todayISO = now.toISOString();

      this.opts.logger(
        `[AutoExport] Tick at ${now.toLocaleTimeString()}, checking conditions...`
      );

      const parseHHMM = (v?: string | null): string | null => {
        if (!v) return null;
        return /^([0-1]?\d|2[0-3]):[0-5]\d$/.test(v) ? v : null;
      };

      // 🔍 COMPREHENSIVE SCHEDULE LOGIC DEBUGGING
      this.opts.logger(`[AutoExport] 🔍 SCHEDULE LOGIC INVESTIGATION:`);

      const autoTime = parseHHMM(this.db.getSetting('auto_export_time'));
      this.opts.logger(
        `[AutoExport] 1️⃣ auto_export_time: ${this.db.getSetting('auto_export_time')} → parsed: ${autoTime}`
      );

      let weeklyEnd: string | null = null;
      const weeklyRaw = this.db.getSetting('work_schedule_weekly');
      this.opts.logger(
        `[AutoExport] 2️⃣ work_schedule_weekly raw: ${weeklyRaw ? 'SET' : 'NOT SET'}`
      );

      try {
        if (weeklyRaw) {
          const weekly = JSON.parse(weeklyRaw);
          const idx = now.getDay(); // 0..6 local
          const dayKey = [
            'sunday',
            'monday',
            'tuesday',
            'wednesday',
            'thursday',
            'friday',
            'saturday',
          ][idx];
          this.opts.logger(`[AutoExport] Today is ${dayKey} (index ${idx})`);

          const entry = weekly?.[dayKey];
          this.opts.logger(
            `[AutoExport] Weekly entry for ${dayKey}: ${JSON.stringify(entry)}`
          );

          if (entry && !entry.nonWorking) {
            weeklyEnd = parseHHMM(entry.end);
            this.opts.logger(
              `[AutoExport] Weekly end time for ${dayKey}: ${entry.end} → parsed: ${weeklyEnd}`
            );
          } else {
            this.opts.logger(
              `[AutoExport] ${dayKey} is non-working or entry missing`
            );
          }
        }
      } catch (e) {
        this.opts.logger(
          `[AutoExport] Error parsing weekly schedule: ${e instanceof Error ? e.message : String(e)}`
        );
      }

      const flatEnd = parseHHMM(this.db.getSetting('work_schedule_end'));
      this.opts.logger(
        `[AutoExport] 3️⃣ work_schedule_end: ${this.db.getSetting('work_schedule_end')} → parsed: ${flatEnd}`
      );

      const scheduleEnd = autoTime || weeklyEnd || flatEnd || '17:00';
      this.opts.logger(
        `[AutoExport] 🎯 FINAL SCHEDULE END TIME: ${scheduleEnd}`
      );
      this.opts.logger(
        `[AutoExport] 📋 Fallback chain: ${autoTime ? '✅' : '❌'} auto_export_time → ${weeklyEnd ? '✅' : '❌'} weekly → ${flatEnd ? '✅' : '❌'} flat → ✅ default(17:00)`
      );

      const includeCharts =
        (this.db.getSetting('report_include_charts') || 'true') === 'true';
      const includeSummary =
        (this.db.getSetting('report_include_summary') || 'true') === 'true';
      const includeDetails =
        (this.db.getSetting('report_include_details') || 'true') === 'true';

      if (!this.isAfterOrEqual(now, scheduleEnd)) return;

      const today = now.toISOString().split('T')[0];
      const last = this.db.getSetting('last_auto_export_date');
      if (last === today) return; // already exported today

      // Validate export folder early to prevent silent failures
      if (!this.validateExportFolder(exportFolder)) {
        this.opts.logger(
          '[AutoExport] ❌ Export folder validation failed; skipping export'
        );
        try {
          this.db.setSetting(
            'last_auto_export_status',
            JSON.stringify({
              success: false,
              timestamp: now.toISOString(),
              mode: 'auto',
              message: `Export folder invalid or not writable: ${exportFolder}`,
            })
          );
        } catch {}
        return;
      }

      const options = {
        type: 'daily' as const,
        format: 'pdf' as const,
        dateRange: { startDate: today, endDate: today },
        includeCharts: includeCharts,
        includeSummary: includeSummary,
        includeDetails: includeDetails,
        useEnhancedAnalytics: true,
        title: `Daily Activity Report - ${today}`,
      };

      this.opts.logger(
        '[AutoExport] Generating comprehensive report with enhanced analytics...'
      );
      this.isExporting = true;
      let result;
      try {
        result = await this.pdf.generateReport(options as any);
      } finally {
        this.isExporting = false;
      }

      this.db.setSetting('last_auto_export_date', today);
      try {
        this.db.setSetting(
          'last_auto_export_status',
          JSON.stringify({
            success: true,
            timestamp: now.toISOString(),
            mode: 'auto',
            message: 'Report exported successfully',
            filePath: result.filePath,
          })
        );
      } catch {}
      this.opts.logger('[AutoExport] Exported daily report for', today);
    } catch (err) {
      try {
        this.db.setSetting(
          'last_auto_export_status',
          JSON.stringify({
            success: false,
            timestamp: this.opts.now().toISOString(),
            mode: 'auto',
            message: err instanceof Error ? err.message : String(err),
          })
        );
      } catch {}
      this.opts.logger('[AutoExport] Error:', err);
    }
  }
}
