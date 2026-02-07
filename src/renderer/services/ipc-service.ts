import {
  ActivityLog,
  Setting,
  Analytics,
  GetActivityLogsRequest,
  GetActivityLogsByDateRequest,
  InsertActivityLogRequest,
  GetSettingRequest,
  SetSettingRequest,
  GetAnalyticsRequest,
  InsertAnalyticsRequest,
  IPCResponse,
} from '../../shared/types';

export class IPCService {
  private static instance: IPCService;

  private constructor() {
    if (!window.electronAPI) {
      throw new Error(
        'Electron API not available. Make sure preload script is loaded.'
      );
    }
  }

  public static getInstance(): IPCService {
    if (!IPCService.instance) {
      IPCService.instance = new IPCService();
    }
    return IPCService.instance;
  }

  // Activity Logs methods
  public async getActivityLogs(
    limit?: number,
    offset?: number
  ): Promise<ActivityLog[]> {
    try {
      const response = await window.electronAPI.getActivityLogs({
        limit,
        offset,
      });
      if (!response.success) {
        throw new Error(response.error || 'Failed to get activity logs');
      }
      return response.data || [];
    } catch (error) {
      console.error('IPC Service - Error getting activity logs:', error);
      throw error;
    }
  }

  public async getActivityLogsByDate(
    startDate: string,
    endDate: string
  ): Promise<ActivityLog[]> {
    try {
      const response = await window.electronAPI.getActivityLogsByDate({
        startDate,
        endDate,
      });
      if (!response.success) {
        throw new Error(
          response.error || 'Failed to get activity logs by date'
        );
      }
      return response.data || [];
    } catch (error) {
      console.error(
        'IPC Service - Error getting activity logs by date:',
        error
      );
      throw error;
    }
  }

  public async insertActivityLog(
    log: InsertActivityLogRequest
  ): Promise<number> {
    try {
      const response = await window.electronAPI.insertActivityLog(log);
      if (!response.success) {
        throw new Error(response.error || 'Failed to insert activity log');
      }
      return response.data || 0;
    } catch (error) {
      console.error('IPC Service - Error inserting activity log:', error);
      throw error;
    }
  }

  // Settings methods
  public async getSetting(key: string): Promise<string | null> {
    try {
      const response = await window.electronAPI.getSetting({ key });
      if (!response.success) {
        throw new Error(response.error || 'Failed to get setting');
      }
      return response.data ?? null;
    } catch (error) {
      console.error('IPC Service - Error getting setting:', error);
      throw error;
    }
  }

  public async setSetting(key: string, value: string): Promise<void> {
    try {
      const response = await window.electronAPI.setSetting({ key, value });
      if (!response.success) {
        throw new Error(response.error || 'Failed to set setting');
      }
    } catch (error) {
      console.error('IPC Service - Error setting value:', error);
      throw error;
    }
  }

  public async getAllSettings(): Promise<Setting[]> {
    try {
      const response = await window.electronAPI.getAllSettings();
      if (!response.success) {
        throw new Error(response.error || 'Failed to get all settings');
      }
      return response.data || [];
    } catch (error) {
      console.error('IPC Service - Error getting all settings:', error);
      throw error;
    }
  }

  // Analytics methods
  public async getAnalytics(metricName?: string): Promise<Analytics[]> {
    try {
      const response = await window.electronAPI.getAnalytics({ metricName });
      if (!response.success) {
        throw new Error(response.error || 'Failed to get analytics');
      }
      return response.data || [];
    } catch (error) {
      console.error('IPC Service - Error getting analytics:', error);
      throw error;
    }
  }

  public async insertAnalytics(
    metric_name: string,
    metric_value: number
  ): Promise<number> {
    try {
      const response = await window.electronAPI.insertAnalytics({
        metric_name,
        metric_value,
      });
      if (!response.success) {
        throw new Error(response.error || 'Failed to insert analytics');
      }
      return response.data || 0;
    } catch (error) {
      console.error('IPC Service - Error inserting analytics:', error);
      throw error;
    }
  }

  // Database management methods
  public async clearAllData(): Promise<void> {
    try {
      const response = await window.electronAPI.clearAllData();
      if (!response.success) {
        throw new Error(response.error || 'Failed to clear all data');
      }
    } catch (error) {
      console.error('IPC Service - Error clearing all data:', error);
      throw error;
    }
  }

  // Enhanced settings management methods
  public async bulkUpdateSettings(
    settings: Record<string, string>
  ): Promise<void> {
    try {
      const response = await window.electronAPI.bulkUpdateSettings(settings);
      if (!response.success) {
        throw new Error(response.error || 'Failed to bulk update settings');
      }
    } catch (error) {
      console.error('IPC Service - Error bulk updating settings:', error);
      throw error;
    }
  }

  public async getDbHealth(): Promise<boolean> {
    try {
      const response = await window.electronAPI.getDbHealth();
      if (!response.success) {
        throw new Error(response.error || 'Failed to check database health');
      }
      return response.data || false;
    } catch (error) {
      console.error('IPC Service - Error checking database health:', error);
      throw error;
    }
  }

  // Utility method to handle IPC errors consistently
  private handleIPCError(error: any, operation: string): never {
    const message = `IPC Service - ${operation} failed: ${error.message || error}`;
    console.error(message);
    throw new Error(message);
  }
}
