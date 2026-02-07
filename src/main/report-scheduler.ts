import type { ReportOptions } from '../shared/types';
import { PDFGenerator } from './pdf-generator';
import type { DatabaseManager } from './database';
import { setTimeout as nodeSetTimeout } from 'timers';
import EmailService from './services/email-service';

export class ReportScheduler {
  private timer: any = null;
  constructor(private readonly database: DatabaseManager) {}

  private getAutoExportEnabled(): boolean {
    const v = this.database.getSetting('auto_export_enabled');
    return v == null ? true : v === 'true';
  }

  private getAutoExportTime(): { hours: number; minutes: number } {
    const v = this.database.getSetting('auto_export_time') || '18:00';
    const m = v.match(/^(\d{1,2}):(\d{2})$/);
    let hours = 18;
    let minutes = 0;
    if (m) {
      hours = Math.min(23, Math.max(0, parseInt(m[1], 10)));
      minutes = Math.min(59, Math.max(0, parseInt(m[2], 10)));
    }
    return { hours, minutes };
  }

  // Compute next run at configured local time
  public computeNextRun(now = new Date()): {
    scheduledAt: Date;
    delayMs: number;
  } {
    const { hours, minutes } = this.getAutoExportTime();
    const scheduledAt = new Date(now);
    scheduledAt.setHours(hours, minutes, 0, 0);
    if (scheduledAt.getTime() <= now.getTime()) {
      // Schedule for next day
      scheduledAt.setDate(scheduledAt.getDate() + 1);
    }
    return { scheduledAt, delayMs: scheduledAt.getTime() - now.getTime() };
  }

  public start(): void {
    this.clear();
    if (!this.getAutoExportEnabled()) {
      console.log('Automatic exports disabled; scheduler not started');
      return;
    }
    const { delayMs } = this.computeNextRun(new Date());
    this.timer = setTimeout(async () => {
      try {
        await this.runNow();
      } catch (err) {
        console.error('Automatic export failed:', err);
      } finally {
        // Reschedule for the next day
        this.start();
      }
    }, delayMs);
  }

  public clear(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => nodeSetTimeout(resolve, ms));
  }

  private async notifyAdminOfFailure(
    error: any,
    totalAttempts: number
  ): Promise<void> {
    try {
      const recipient = this.database.getSetting('admin_alert_email');
      if (!recipient) {
        return;
      }
      // Rate limit to at most once per 24 hours
      const rateKey = 'auto_export_failure_last_sent_at';
      const last = this.database.getSetting(rateKey);
      const now = new Date();
      if (last) {
        const lastDate = new Date(last);
        const diffMs = now.getTime() - lastDate.getTime();
        const oneDayMs = 24 * 60 * 60 * 1000;
        if (diffMs < oneDayMs) {
          return;
        }
      }

      const email = EmailService.getInstance();
      // Ensure configured before sending (safe no-op if already configured)
      email.configure();
      await email.sendReportFailure(recipient, {
        timestamp: now.toISOString(),
        errorMessage: String(error?.message || error),
        retries: totalAttempts,
      });
      this.database.setSetting(rateKey, now.toISOString());
    } catch (e) {
      console.error('Failed to send automatic export failure email:', e);
    }
  }

  // Immediately generate today's daily PDF report with optional retry
  public async runNow(options?: {
    maxRetries?: number;
    baseDelayMs?: number;
  }): Promise<void> {
    const maxRetries = options?.maxRetries ?? 0;
    const baseDelayMs = options?.baseDelayMs ?? 1000;

    const today = new Date();
    const isoDate = today.toISOString().split('T')[0];

    const reportOptions: ReportOptions = {
      type: 'daily' as any,
      format: 'pdf' as any,
      dateRange: { startDate: isoDate, endDate: isoDate },
      includeCharts: true,
      includeSummary: true,
      includeDetails: true,
    };

    const generator = new PDFGenerator(this.database as any);

    let attempt = 0;
    // First attempt + retries
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        await generator.generateReport(reportOptions);
        return;
      } catch (err) {
        if (attempt >= maxRetries) {
          console.error(
            'Automatic report generation failed after retries:',
            err
          );
          await this.notifyAdminOfFailure(err, attempt + 1);
          throw err;
        }
        const delay = baseDelayMs * Math.pow(2, attempt); // 1x, 2x, 4x ...
        attempt += 1;
        await this.sleep(delay);
      }
    }
  }
}
