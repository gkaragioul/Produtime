import { DatabaseManager } from '../database';
import {
    ReportOptions,
    SessionSnapshot,
    ComprehensiveReportData,
    ActivityLog,
    ApplicationCategory,
    HourlyActivity
} from '../../shared/types';
import * as os from 'os';

// Helper for formatting duration
const formatDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const sec = Math.floor(seconds % 60);
    return [h, m, sec].map((v) => String(v).padStart(2, '0')).join(':');
};

export class ReportRenderer {
    constructor(private database: DatabaseManager) { }

    public generateSimpleSessionHTML(
        snapshot: SessionSnapshot,
        options: ReportOptions
    ): string {
        const fmt = formatDuration;

        // Display-only schedule context and recent categorization
        const isHHMM = (v?: string | null) =>
            !!v && /^([0-1]?\d|2[0-3]):[0-5]\d$/.test(v);
        const toMin = (v: string) => {
            const [h, m] = v.split(':').map((n) => parseInt(n, 10));
            return h * 60 + m;
        };
        const defaultStart = '09:00';
        const defaultEnd = '17:00';
        let schedStart = defaultStart,
            schedEnd = defaultEnd,
            schedNonWorking = false,
            schedOvernight = false;

        try {
            const now = new Date();
            const idx = now.getDay();
            const dayKey = [
                'sunday',
                'monday',
                'tuesday',
                'wednesday',
                'thursday',
                'friday',
                'saturday',
            ][idx];

            const weeklyRaw = this.database.getSetting('work_schedule_weekly');

            if (weeklyRaw) {
                try {
                    const weekly = JSON.parse(weeklyRaw);
                    const entry = weekly?.[dayKey];

                    if (entry) {
                        schedStart = isHHMM(entry.start) ? entry.start : defaultStart;
                        schedEnd = isHHMM(entry.end) ? entry.end : defaultEnd;
                        schedNonWorking = !!entry.nonWorking;
                        schedOvernight = toMin(schedEnd) < toMin(schedStart);
                    }
                } catch (e) {
                    console.error('Error parsing weekly schedule:', e);
                }
            }

            if (!weeklyRaw || !isHHMM(schedStart) || !isHHMM(schedEnd)) {
                const flatStart =
                    this.database.getSetting('work_schedule_start') || defaultStart;
                const flatEnd =
                    this.database.getSetting('work_schedule_end') || defaultEnd;

                schedStart = isHHMM(flatStart) ? flatStart : defaultStart;
                schedEnd = isHHMM(flatEnd) ? flatEnd : defaultEnd;
                schedOvernight = toMin(schedEnd) < toMin(schedStart);
            }
        } catch (e) {
            console.error('Error in schedule logic:', e);
        }
        const startMin = toMin(schedStart),
            endMin = toMin(schedEnd);
        const withinWindow = (d: Date) => {
            const m = d.getHours() * 60 + d.getMinutes();
            return schedOvernight
                ? m >= startMin || m < endMin
                : m >= startMin && m < endMin;
        };
        const recentActivities = (snapshot.recentActivities || []).slice(0, 8);
        const withinCount = recentActivities.filter((log) =>
            withinWindow(new Date(log.timestamp))
        ).length;
        const outsideCount = recentActivities.length - withinCount;

        const recentItems = recentActivities
            .map(
                (log) => `
          <tr>
            <td>${new Date(log.timestamp).toLocaleTimeString()}</td>
            <td>${this.escapeHtml(log.app_name || '')}</td>
            <td>${this.escapeHtml(log.window_title || '')}</td>
            <td style="text-align:right">${fmt(log.duration || 0)}</td>
          </tr>`
            )
            .join('');

        const title = options.title || 'Session Summary';

        return `<!doctype html>
<html><head><meta charset="utf-8"><title>${this.escapeHtml(title)}</title>
<style>
  body{font-family:Segoe UI,Arial,sans-serif;margin:0;padding:24px;color:#222}
  .card{border:1px solid #e0e0e0;border-radius:8px;padding:16px}
  h1{font-size:20px;margin:0 0 8px}
  .meta{color:#555;margin-bottom:12px}
  .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin:12px 0}
  .metric{background:#fafafa;border:1px solid #eee;border-radius:6px;padding:12px}
  .label{font-size:12px;color:#666}
  .value{font-size:18px;font-weight:600}
  table{width:100%;border-collapse:collapse;margin-top:12px}
  th,td{border-bottom:1px solid #eee;padding:8px 6px;font-size:12px}
  th{text-align:left;color:#555}
  footer{margin-top:10px;color:#777;font-size:11px}
  @page { size: A4; margin: 18mm; }
</style></head>
<body>
  <div class="card">
    <h1>ProduTime - Session Summary</h1>
    <div class="meta">Session start: ${new Date(snapshot.sessionStartISO).toLocaleString()}</div>
    <div class="meta">Today's Scheduled Hours: ${schedStart}-${schedEnd}${schedNonWorking ? ' (Non-working day)' : ''}</div>
    <div class="grid">
      <div class="metric"><div class="label">Session Duration</div><div class="value">${fmt(
            snapshot.sessionDurationSeconds
        )}</div></div>
      <div class="metric"><div class="label">Active Time</div><div class="value">${fmt(
            snapshot.activeSeconds
        )}</div></div>
      <div class="metric"><div class="label">Idle Time</div><div class="value">${fmt(
            snapshot.idleSeconds
        )}</div></div>
      <div class="metric"><div class="label">Total Logged</div><div class="value">${fmt(
            (snapshot.activeSeconds || 0) + (snapshot.idleSeconds || 0)
        )}</div></div>
    </div>
    <h2 style="font-size:16px;margin:12px 0 6px">Recent Activity</h2>
    <div class="meta">Within scheduled hours (recent): ${withinCount} | Outside: ${outsideCount}</div>
    <table>
      <thead><tr><th>Time</th><th>Application</th><th>Window</th><th style="text-align:right">Duration</th></tr></thead>
      <tbody>${recentItems || '<tr><td colspan="4">No activity</td></tr>'}</tbody>
    </table>
    <footer>Generated on ${new Date().toLocaleString()}</footer>
  </div>
</body></html>`;
    }

    public renderWorkActivityReport(
        data: ComprehensiveReportData,
        _options: ReportOptions
    ): string {
        const user = this.getSystemInfo();

        const scheduled = Number(data.workSchedule?.scheduledHours || 0);
        const active = Number(data.workSchedule?.actualHours || 0);
        const productivityPct =
            scheduled > 0 ? Math.round((active / scheduled) * 100) : 0;
        const overtime = Number(data.timeDistribution?.overtimeHours || 0);
        const undertime = Number(data.timeDistribution?.undertimeHours || 0);
        const isOvertime = overtime > 0;

        const timeDistSvg = this.generateTimeDistributionChart(
            scheduled,
            active,
            0
        );

        return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Work Activity Report - ${this.escapeHtml(user.employeeName)}</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin:0; padding:30px; color:#1f2937; background:#f3f4f6; }
    .container { max-width: 1100px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 32px 36px; box-shadow: 0 10px 25px rgba(0,0,0,0.08); }
    .header h1 { font-size: 28px; color:#1f2937; margin: 0 0 8px; }
    .header-info { display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; color:#6b7280; font-size: 13px; margin-bottom: 18px; }
    .info-label { display:block; text-transform: uppercase; font-size: 11px; color:#9ca3af; }
    .divider { height: 3px; background: linear-gradient(90deg,#60a5fa,#a78bfa); border-radius: 2px; margin: 12px 0 22px; }

    .metrics-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-bottom: 26px; }
    .metric-card { border-radius: 12px; padding: 18px 20px; color:#fff; background: linear-gradient(135deg,#67e8f9,#38bdf8); }
    .metric-card.success { background: linear-gradient(135deg,#34d399,#2dd4bf); }
    .metric-card.purple { background: linear-gradient(135deg,#a78bfa,#7c3aed); }
    .metric-card.warning { background: linear-gradient(135deg,#f59e0b,#f97316); }
    .metric-card.info { background: linear-gradient(135deg,#67e8f9,#38bdf8); }
    .metric-label { text-transform: uppercase; font-size: 11px; letter-spacing: .08em; opacity: .9; }
    .metric-value { font-size: 32px; font-weight: 700; margin-top: 6px; }
    .metric-subtitle { font-size: 12px; opacity: .95; margin-top: 4px; }

    .chart-section { margin-top: 24px; }
    .chart-title { font-size: 16px; color:#374151; margin: 6px 0 10px; }
    .chart-container { background:#fff; border:1px solid #e5e7eb; border-radius: 10px; padding: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Work Activity Report</h1>
      <div class="header-info">
        <div class="info-item"><span class="info-label">Employee</span><span class="info-value">${this.escapeHtml(user.employeeName)}</span></div>
        <div class="info-item"><span class="info-label">Computer</span><span class="info-value">${this.escapeHtml(user.computerName)}</span></div>
        <div class="info-item"><span class="info-label">IP Address</span><span class="info-value">${this.escapeHtml(user.ipAddress)}</span></div>
        <div class="info-item"><span class="info-label">Generated</span><span class="info-value">${new Date(user.reportGeneratedAt).toLocaleString()}</span></div>
      </div>
      <div class="divider"></div>
    </div>

    <div class="metrics-grid">
      <div class="metric-card info">
        <div class="metric-label">Scheduled Hours</div>
        <div class="metric-value">${scheduled.toFixed(1)}</div>
        <div class="metric-subtitle">Expected work time</div>
      </div>
      <div class="metric-card success">
        <div class="metric-label">Active Hours</div>
        <div class="metric-value">${active.toFixed(1)}</div>
        <div class="metric-subtitle">Productive time</div>
      </div>
      <div class="metric-card purple">
        <div class="metric-label">Productivity</div>
        <div class="metric-value">${productivityPct}%</div>
        <div class="metric-subtitle">Active / Scheduled</div>
      </div>
      <div class="metric-card ${isOvertime ? 'warning' : 'info'}">
        <div class="metric-label">${isOvertime ? 'Overtime' : 'Undertime'}</div>
        <div class="metric-value">${(isOvertime ? overtime : undertime).toFixed(1)}</div>
        <div class="metric-subtitle">${isOvertime ? 'Extra hours worked' : 'Hours below schedule'}</div>
      </div>
    </div>

    <div class="chart-section">
      <h2 class="chart-title">Time Distribution</h2>
      <div class="chart-container">${timeDistSvg}</div>
    </div>
  </div>
</body>
</html>`;
    }

    public generateHTMLReport(
        data: ComprehensiveReportData,
        options: ReportOptions
    ): string {
        const user = this.getSystemInfo();
        const fmt = formatDuration;

        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${data.title}</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 20px; color: #333; background: #f8f9fa; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        .header { margin-bottom: 24px; }
        .header h1 { color: #1f2937; font-size: 2em; margin: 0 0 10px; }
        .header-info { display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; color:#6b7280; font-size: 13px; margin-bottom: 12px; }
        .info-label { display:block; text-transform: uppercase; font-size: 11px; color:#9ca3af; }
        .divider { height: 3px; background: linear-gradient(90deg,#60a5fa,#a78bfa); border-radius: 2px; margin: 8px 0 18px; }

        .warning-banner { background: #fef3c7; border: 2px solid #f59e0b; border-radius: 8px; padding: 16px; margin: 0 0 24px; color: #92400e; }
        .warning-banner h3 { margin: 0 0 8px; color: #b45309; font-size: 16px; }
        .warning-banner p { margin: 0; font-size: 14px; line-height: 1.5; }

        .schedule-line { color:#6b7280; font-size: 13px; margin: 8px 0 12px; }
        
        .executive-summary { background: linear-gradient(135deg, #007bff, #0056b3); color: white; padding: 30px; border-radius: 12px; margin-bottom: 40px; }
        .executive-summary h2 { margin: 0 0 20px 0; font-size: 1.8em; }
        .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; }
        .summary-item { text-align: center; background: rgba(255,255,255,0.1); padding: 20px; border-radius: 8px; }
        .summary-value { font-size: 2.2em; font-weight: bold; margin-bottom: 5px; }
        .summary-label { font-size: 0.9em; opacity: 0.9; }

        .metrics-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin: 10px 0 26px; }
        .metric-card { border-radius: 12px; padding: 18px 20px; color:#fff; background: linear-gradient(135deg,#67e8f9,#38bdf8); }
        .metric-card.success { background: linear-gradient(135deg,#34d399,#2dd4bf); }
        .metric-card.purple { background: linear-gradient(135deg,#a78bfa,#7c3aed); }
        .metric-card.warning { background: linear-gradient(135deg,#f59e0b,#f97316); }
        .metric-card.info { background: linear-gradient(135deg,#67e8f9,#38bdf8); }
        .metric-label { text-transform: uppercase; font-size: 11px; letter-spacing: .08em; opacity: .9; }
        .metric-value { font-size: 32px; font-weight: 700; margin-top: 6px; }
        .metric-subtitle { font-size: 12px; opacity: .95; margin-top: 4px; }
        
        .chart-container { background:#fff; border:1px solid #e5e7eb; border-radius: 10px; padding: 16px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Work Activity Report</h1>
            <div class="header-info">
              <div class="info-item"><span class="info-label">Employee</span><span class="info-value">${this.escapeHtml(user.employeeName)}</span></div>
              <div class="info-item"><span class="info-label">Computer</span><span class="info-value">${this.escapeHtml(user.computerName)}</span></div>
              <div class="info-item"><span class="info-label">IP Address</span><span class="info-value">${this.escapeHtml(user.ipAddress)}</span></div>
              <div class="info-item"><span class="info-label">Generated</span><span class="info-value">${new Date(user.reportGeneratedAt).toLocaleString()}</span></div>
            </div>
            <div class="divider"></div>
        </div>

        ${data.isTruncated ? `
        <div class="warning-banner">
            <h3>⚠️ Large Dataset Notice</h3>
            <p>This report displays data from the most recent ${data.truncatedAtLimit?.toLocaleString()} activity entries to prevent performance issues.
            For complete historical data over this ${Math.ceil((new Date(data.dateRange.endDate).getTime() - new Date(data.dateRange.startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1}-day period,
            consider generating weekly reports instead.</p>
        </div>` : ''}

        <!-- Metric Cards -->
        ${(() => {
                const scheduled = Number(data.workSchedule?.scheduledHours || 0);
                const active = Number(data.workSchedule?.actualHours || 0);

                let activeSeconds = 0;
                let idleSeconds = 0;
                for (const log of data.activityLogs || []) {
                    const d = log.duration || 0;
                    if (log.app_name === 'System' && (log.window_title === 'Idle' || log.window_title === 'Paused'))
                        idleSeconds += d;
                    else activeSeconds += d;
                }
                const totalSeconds = activeSeconds + idleSeconds;
                const productivityPct =
                    totalSeconds > 0
                        ? Math.round((activeSeconds / totalSeconds) * 100)
                        : 0;

                const overtime = Number(data.timeDistribution?.overtimeHours || 0);
                const undertime = Number(data.timeDistribution?.undertimeHours || 0);
                const isOvertime = overtime > 0;
                const overUnderLabel = isOvertime ? 'Overtime' : 'Undertime';
                const overUnderValue = (isOvertime ? overtime : undertime).toFixed(1);
                return `
          <div class="metrics-grid">
            <div class="metric-card info">
              <div class="metric-label">Scheduled Hours</div>
              <div class="metric-value">${scheduled.toFixed(1)}</div>
              <div class="metric-subtitle">Expected work time</div>
            </div>
            <div class="metric-card success">
              <div class="metric-label">Active Hours</div>
              <div class="metric-value">${active.toFixed(1)}</div>
              <div class="metric-subtitle">Productive time</div>
            </div>
            <div class="metric-card purple">
              <div class="metric-label">Productivity</div>
              <div class="metric-value">${productivityPct}%</div>
              <div class="metric-subtitle">Active / Total</div>
            </div>
            <div class="metric-card ${isOvertime ? 'warning' : 'info'}">
              <div class="metric-label">${overUnderLabel}</div>
              <div class="metric-value">${overUnderValue}</div>
              <div class="metric-subtitle">${isOvertime ? 'Extra hours worked' : 'Hours below schedule'}</div>
            </div>
          </div>`;
            })()}

        <!-- Compact schedule info -->
        <div class="schedule-line">Schedule: ${data.workSchedule.start} – ${data.workSchedule.end}</div>

        <!-- Time Distribution -->
        <div class="chart-container">
          <h3>Time Distribution</h3>
          ${this.generateTimeDistributionChart(Number(data.workSchedule?.scheduledHours || 0), Number(data.workSchedule?.actualHours || 0), 0)}
        </div>

        <!-- Executive Summary -->
        <div class="executive-summary">
            <h2>📊 Executive Summary</h2>
            <div class="summary-grid">
                <div class="summary-item">
                    <div class="summary-value">${fmt(data.summary.totalHours * 3600)}</div>
                    <div class="summary-label">Total Active Time</div>
                </div>
                <div class="summary-item">
                    <div class="summary-value">${data.productivityMetrics.productivityScore}%</div>
                    <div class="summary-label">Productivity Score</div>
                </div>
                <div class="summary-item">
                    <div class="summary-value">${data.workSchedule.efficiency}%</div>
                    <div class="summary-label">Schedule Efficiency</div>
                </div>
                <div class="summary-item">
                    <div class="summary-value">${data.summary.totalSessions}</div>
                    <div class="summary-label">Total Sessions</div>
                </div>
                <div class="summary-item">
                    <div class="summary-value">${data.topApplications.length > 0 ? data.topApplications[0].name : 'N/A'}</div>
                    <div class="summary-label">Most Used App</div>
                </div>
                <div class="summary-item">
                    <div class="summary-value">${data.productivityMetrics.mostProductiveHour}:00</div>
                    <div class="summary-label">Peak Hour</div>
                </div>
            </div>
        </div>

    </div>
</body>
</html>`;
    }

    public generateReportTitle(options: ReportOptions): string {
        const { type, dateRange } = options;
        const startDate = new Date(dateRange.startDate).toLocaleDateString();
        const endDate = new Date(dateRange.endDate).toLocaleDateString();

        switch (type) {
            case 'daily':
                return `Daily Activity Report - ${startDate}`;
            case 'weekly':
                return `Weekly Activity Report - ${startDate} to ${endDate}`;
            case 'monthly':
                return `Monthly Activity Report - ${startDate} to ${endDate}`;
            case 'custom':
                return `Custom Activity Report - ${startDate} to ${endDate}`;
            default:
                return `Activity Report - ${startDate} to ${endDate}`;
        }
    }

    public generateReportId(): string {
        return `report_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    public generateFileName(options: ReportOptions, reportId: string): string {
        const timestamp = new Date().toISOString().split('T')[0];
        const extension = options.format === 'html' ? 'html' : 'pdf';
        return `ProduTime_${options.type}_Report_${timestamp}_${reportId}.${extension}`;
    }

    private escapeHtml(unsafe: string): string {
        return unsafe
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    private generateTimeDistributionChart(
        scheduledHours: number,
        activeHours: number,
        idleHours: number
    ): string {
        const width = 700,
            height = 260;
        const margin = { top: 20, right: 20, bottom: 40, left: 50 };
        const chartW = width - margin.left - margin.right;
        const chartH = height - margin.top - margin.bottom;
        const max = Math.max(scheduledHours, activeHours + idleHours, 1);
        const scale = (v: number) => (v / max) * chartH;

        const bars = [
            { label: 'Scheduled', value: scheduledHours, color: '#7bd3ff' },
            { label: 'Active', value: activeHours, color: '#34d399' },
            { label: 'Idle', value: idleHours, color: '#cbd5e1' },
        ];

        const gap = 40;
        const barW = (chartW - gap * (bars.length - 1)) / bars.length;

        const rects = bars
            .map((b, i) => {
                const h = scale(b.value);
                const x = margin.left + i * (barW + gap);
                const y = margin.top + (chartH - h);
                return `
        <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="6" fill="${b.color}" />
        <text x="${x + barW / 2}" y="${y - 6}" text-anchor="middle" font-size="12" fill="#666">${b.value.toFixed(1)}</text>
        <text x="${x + barW / 2}" y="${height - 12}" text-anchor="middle" font-size="12" fill="#666">${b.label}</text>
      `;
            })
            .join('');

        return `
      <svg width="${width}" height="${height}" role="img" aria-label="Time Distribution">
        <g>
          ${rects}
          <text x="${margin.left}" y="${margin.top - 6}" font-size="12" fill="#666">Hours</text>
        </g>
      </svg>
    `;
    }

    private getSystemInfo(): {
        employeeName: string;
        computerName: string;
        ipAddress: string;
        reportGeneratedAt: string;
    } {
        try {
            const hostname = os.hostname();
            const nets = os.networkInterfaces();
            let ipAddress = 'Unknown';
            if (nets) {
                for (const name of Object.keys(nets)) {
                    const addrs = nets[name] || [];
                    for (const addr of addrs) {
                        if (addr.family === 'IPv4' && !addr.internal) {
                            ipAddress = addr.address;
                            break;
                        }
                    }
                    if (ipAddress !== 'Unknown') break;
                }
            }
            const employeeName = (
                this.database.getSetting('employee_name') || 'Unknown'
            ).trim();
            return {
                employeeName: employeeName || 'Unknown',
                computerName: hostname || 'Unknown',
                ipAddress,
                reportGeneratedAt: new Date().toISOString(),
            };
        } catch {
            return {
                employeeName:
                    (this.database.getSetting('employee_name') || 'Unknown').trim() ||
                    'Unknown',
                computerName: 'Unknown',
                ipAddress: 'Unknown',
                reportGeneratedAt: new Date().toISOString(),
            };
        }
    }
}
