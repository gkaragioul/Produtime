import { IPCResponse } from '../../shared/types';

export type ExportFormat = 'csv' | 'json';
export interface DateRange { startDate: string; endDate: string }
export interface ExportRequest { format: ExportFormat; dateRange: DateRange }
export interface ExportResult { format: ExportFormat; content: string }

export class DataExportService {
  private static instance: DataExportService | undefined;
  public static getInstance(): DataExportService {
    if (!this.instance) this.instance = new DataExportService();
    return this.instance;
  }

  private constructor() {}

  public async export(req: ExportRequest): Promise<ExportResult> {
    const res: IPCResponse<ExportResult> = await (window as any).electronAPI.exportData(req);
    if (!res || !res.success) {
      throw new Error(res?.error || 'Failed to export data');
    }
    return res.data as ExportResult;
  }
}

