import { ActivityLog } from '../shared/types';

export interface DateRange {
  startDate: string;
  endDate: string;
}

export interface ExportOptions {
  dateRange: DateRange;
}

export class DataExporter {
  private db: { getActivityLogsByDateRange: (start: string, end: string) => ActivityLog[] };

  constructor(db: any) {
    this.db = db;
  }

  public async exportCSV(opts: ExportOptions): Promise<string> {
    const logs = this.fetchLogs(opts);
    const header = 'timestamp,app_name,window_title,duration';
    const lines = logs.map((l) =>
      [l.timestamp, l.app_name, l.window_title, String(l.duration)].map(this.csvCell).join(',')
    );
    return [header, ...lines].join('\n') + '\n';
  }

  public async exportJSON(opts: ExportOptions): Promise<string> {
    const logs = this.fetchLogs(opts);
    const payload = logs.map((l) => ({
      timestamp: l.timestamp,
      app_name: l.app_name,
      window_title: l.window_title,
      duration: l.duration,
    }));
    return JSON.stringify(payload);
  }

  private fetchLogs(opts: ExportOptions): ActivityLog[] {
    const { startDate, endDate } = opts.dateRange;
    const logs = this.db.getActivityLogsByDateRange(startDate, endDate) as ActivityLog[];
    // Ensure desc by timestamp (ISO strings sort lexicographically by time)
    return [...logs].sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
  }

  private csvCell(value: string): string {
    if (value == null) return '';
    const needsQuoting = /[",\n]/.test(value);
    const escaped = String(value).replace(/"/g, '""');
    return needsQuoting ? `"${escaped}"` : escaped;
  }
}

