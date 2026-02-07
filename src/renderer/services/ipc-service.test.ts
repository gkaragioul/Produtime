import { IPCService } from './ipc-service';
import { ElectronAPI } from '../../shared/types';

// Mock the global window.electronAPI
const mockElectronAPI: jest.Mocked<ElectronAPI> = {
  getVersion: jest.fn(),
  getPlatform: jest.fn(),
  getActivityLogs: jest.fn(),
  getActivityLogsByDate: jest.fn(),
  insertActivityLog: jest.fn(),
  getSetting: jest.fn(),
  setSetting: jest.fn(),
  getAllSettings: jest.fn(),
  getAnalytics: jest.fn(),
  insertAnalytics: jest.fn(),
  clearAllData: jest.fn(),
  getDbHealth: jest.fn(),
  checkForUpdates: jest.fn(),
  downloadUpdate: jest.fn(),
  installUpdate: jest.fn(),
  getUpdateStatus: jest.fn(),
  onUpdateStatusChanged: jest.fn(),

  // Activity control
  startTracking: jest.fn(),
  stopTracking: jest.fn(),

  generateReport: jest.fn(),
  getReportData: jest.fn(),
  saveReport: jest.fn(),
  openReport: jest.fn(),
  showTrayNotification: jest.fn(),
  updateTrayState: jest.fn(),
  getTrayState: jest.fn(),
  toggleWindowVisibility: jest.fn(),
  quitApplication: jest.fn(),
  onTrayNotificationClicked: jest.fn(),
  onTrayActionTriggered: jest.fn(),

  // Admin Authentication API
  adminLogin: jest.fn(),
  getAdminLockoutState: jest.fn(),
  resetAdminLockout: jest.fn(),

  // Enhanced Settings Management API
  bulkUpdateSettings: jest.fn(),
  getSettingsBackup: jest.fn(),
  restoreSettingsFromBackup: jest.fn(),

  // Activity events/additional getters
  onActivityChanged: jest.fn().mockReturnValue(() => {}),
  getCurrentActivity: jest.fn(),
  getTrackingStats: jest.fn(),
  selectExportFolder: jest.fn(),
};

// Mock window.electronAPI
Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
});

describe('IPCService', () => {
  let ipcService: IPCService;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset singleton instance
    (IPCService as any).instance = undefined;
    ipcService = IPCService.getInstance();
  });

  describe('Singleton Pattern', () => {
    test('should return the same instance', () => {
      const instance1 = IPCService.getInstance();
      const instance2 = IPCService.getInstance();
      expect(instance1).toBe(instance2);
    });

    test('should throw error if electronAPI is not available', () => {
      // Temporarily remove electronAPI
      const originalAPI = window.electronAPI;
      delete (window as any).electronAPI;

      expect(() => {
        (IPCService as any).instance = undefined;
        IPCService.getInstance();
      }).toThrow('Electron API not available');

      // Restore electronAPI
      window.electronAPI = originalAPI;
    });
  });

  describe('Activity Logs Methods', () => {
    test('should get activity logs successfully', async () => {
      const mockLogs = [
        {
          id: 1,
          timestamp: '2024-08-28 10:00:00',
          app_name: 'Test App',
          window_title: 'Test',
          duration: 300,
        },
      ];
      mockElectronAPI.getActivityLogs.mockResolvedValue({
        success: true,
        data: mockLogs,
      });

      const result = await ipcService.getActivityLogs(10, 0);

      expect(result).toEqual(mockLogs);
      expect(mockElectronAPI.getActivityLogs).toHaveBeenCalledWith({
        limit: 10,
        offset: 0,
      });
    });

    test('should handle get activity logs error', async () => {
      mockElectronAPI.getActivityLogs.mockResolvedValue({
        success: false,
        error: 'Database error',
      });

      await expect(ipcService.getActivityLogs()).rejects.toThrow(
        'Database error'
      );
    });

    test('should get activity logs by date successfully', async () => {
      const mockLogs = [
        {
          id: 1,
          timestamp: '2024-08-28 10:00:00',
          app_name: 'Test App',
          window_title: 'Test',
          duration: 300,
        },
      ];
      mockElectronAPI.getActivityLogsByDate.mockResolvedValue({
        success: true,
        data: mockLogs,
      });

      const result = await ipcService.getActivityLogsByDate(
        '2024-08-28',
        '2024-08-29'
      );

      expect(result).toEqual(mockLogs);
      expect(mockElectronAPI.getActivityLogsByDate).toHaveBeenCalledWith({
        startDate: '2024-08-28',
        endDate: '2024-08-29',
      });
    });

    test('should insert activity log successfully', async () => {
      mockElectronAPI.insertActivityLog.mockResolvedValue({
        success: true,
        data: 123,
      });

      const logData = {
        timestamp: '2024-08-28 10:00:00',
        app_name: 'Test App',
        window_title: 'Test Window',
        duration: 300,
      };

      const result = await ipcService.insertActivityLog(logData);

      expect(result).toBe(123);
      expect(mockElectronAPI.insertActivityLog).toHaveBeenCalledWith(logData);
    });
  });

  describe('Settings Methods', () => {
    test('should get setting successfully', async () => {
      mockElectronAPI.getSetting.mockResolvedValue({
        success: true,
        data: 'test_value',
      });

      const result = await ipcService.getSetting('test_key');

      expect(result).toBe('test_value');
      expect(mockElectronAPI.getSetting).toHaveBeenCalledWith({
        key: 'test_key',
      });
    });

    test('should return null for non-existent setting', async () => {
      mockElectronAPI.getSetting.mockResolvedValue({
        success: true,
        data: null,
      });

      const result = await ipcService.getSetting('non_existent');

      expect(result).toBeNull();
    });

    test('should set setting successfully', async () => {
      mockElectronAPI.setSetting.mockResolvedValue({ success: true });

      await ipcService.setSetting('test_key', 'test_value');

      expect(mockElectronAPI.setSetting).toHaveBeenCalledWith({
        key: 'test_key',
        value: 'test_value',
      });
    });

    test('should get all settings successfully', async () => {
      const mockSettings = [
        { key: 'setting1', value: 'value1' },
        { key: 'setting2', value: 'value2' },
      ];
      mockElectronAPI.getAllSettings.mockResolvedValue({
        success: true,
        data: mockSettings,
      });

      const result = await ipcService.getAllSettings();

      expect(result).toEqual(mockSettings);
      expect(mockElectronAPI.getAllSettings).toHaveBeenCalled();
    });
  });

  describe('Analytics Methods', () => {
    test('should get analytics successfully', async () => {
      const mockAnalytics = [
        {
          id: 1,
          metric_name: 'test_metric',
          metric_value: 10,
          recorded_at: '2024-08-28 10:00:00',
        },
      ];
      mockElectronAPI.getAnalytics.mockResolvedValue({
        success: true,
        data: mockAnalytics,
      });

      const result = await ipcService.getAnalytics('test_metric');

      expect(result).toEqual(mockAnalytics);
      expect(mockElectronAPI.getAnalytics).toHaveBeenCalledWith({
        metricName: 'test_metric',
      });
    });

    test('should insert analytics successfully', async () => {
      mockElectronAPI.insertAnalytics.mockResolvedValue({
        success: true,
        data: 456,
      });

      const result = await ipcService.insertAnalytics('test_metric', 10);

      expect(result).toBe(456);
      expect(mockElectronAPI.insertAnalytics).toHaveBeenCalledWith({
        metric_name: 'test_metric',
        metric_value: 10,
      });
    });
  });

  describe('Database Management Methods', () => {
    test('should clear all data successfully', async () => {
      mockElectronAPI.clearAllData.mockResolvedValue({ success: true });

      await ipcService.clearAllData();

      expect(mockElectronAPI.clearAllData).toHaveBeenCalled();
    });

    test('should get database health successfully', async () => {
      mockElectronAPI.getDbHealth.mockResolvedValue({
        success: true,
        data: true,
      });

      const result = await ipcService.getDbHealth();

      expect(result).toBe(true);
      expect(mockElectronAPI.getDbHealth).toHaveBeenCalled();
    });

    test('should handle database health check error', async () => {
      mockElectronAPI.getDbHealth.mockResolvedValue({
        success: false,
        error: 'Health check failed',
      });

      await expect(ipcService.getDbHealth()).rejects.toThrow(
        'Health check failed'
      );
    });
  });

  describe('Error Handling', () => {
    test('should handle IPC communication errors', async () => {
      mockElectronAPI.getSetting.mockRejectedValue(
        new Error('IPC communication failed')
      );

      await expect(ipcService.getSetting('test_key')).rejects.toThrow(
        'IPC communication failed'
      );
    });

    test('should handle response errors consistently', async () => {
      mockElectronAPI.setSetting.mockResolvedValue({
        success: false,
        error: 'Setting update failed',
      });

      await expect(
        ipcService.setSetting('test_key', 'test_value')
      ).rejects.toThrow('Setting update failed');
    });
  });
});
