import { IPCHandlers } from './ipc-handlers';
import { DatabaseManager } from './database';

// Mock shared types
jest.mock('../shared/types', () => ({
  IPCChannels: {
    GET_ACTIVITY_LOGS: 'get-activity-logs',
    GET_ACTIVITY_LOGS_BY_DATE: 'get-activity-logs-by-date',
    INSERT_ACTIVITY_LOG: 'insert-activity-log',
    GET_SETTING: 'get-setting',
    SET_SETTING: 'set-setting',
    GET_ALL_SETTINGS: 'get-all-settings',
    GET_ANALYTICS: 'get-analytics',
    INSERT_ANALYTICS: 'insert-analytics',
    CLEAR_ALL_DATA: 'clear-all-data',
    GET_DB_HEALTH: 'get-db-health',
    CHECK_FOR_UPDATES: 'check-for-updates',
    DOWNLOAD_UPDATE: 'download-update',
    INSTALL_UPDATE: 'install-update',
    GET_UPDATE_STATUS: 'get-update-status',
    GENERATE_REPORT: 'generate-report',
    GET_REPORT_DATA: 'get-report-data',
    SAVE_REPORT: 'save-report',
    OPEN_REPORT: 'open-report',
    SHOW_TRAY_NOTIFICATION: 'show-tray-notification',
    UPDATE_TRAY_STATE: 'update-tray-state',
    GET_TRAY_STATE: 'get-tray-state',
    TOGGLE_WINDOW_VISIBILITY: 'toggle-window-visibility',
    QUIT_APPLICATION: 'quit-application',
  },
}));

// Mock electron with proper initialization order
jest.mock('electron', () => ({
  ipcMain: {
    handle: jest.fn(),
    removeAllListeners: jest.fn(),
  },
  app: {
    getPath: jest.fn(() => './test-data'),
  },
}));

// Mock database
jest.mock('./database');

// Import the mocked IPCChannels
const { IPCChannels } = require('../shared/types');

describe('IPCHandlers', () => {
  let ipcHandlers: IPCHandlers;
  let mockDatabase: jest.Mocked<DatabaseManager>;
  let mockIpcMain: any;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Get the mocked ipcMain
    const { ipcMain } = require('electron');
    mockIpcMain = ipcMain;

    // Create mock database
    mockDatabase = {
      getActivityLogs: jest.fn(),
      getActivityLogsByDateRange: jest.fn(),
      insertActivityLog: jest.fn(),
      getSetting: jest.fn(),
      setSetting: jest.fn(),
      getAllSettings: jest.fn(),
      getAnalytics: jest.fn(),
      insertAnalytics: jest.fn(),
      clearAllData: jest.fn(),
      isHealthy: jest.fn(),
      close: jest.fn(),
      getDbPath: jest.fn(),
    } as any;

    // Create IPC handlers instance
    ipcHandlers = new IPCHandlers(mockDatabase);
  });

  afterEach(() => {
    if (ipcHandlers) {
      ipcHandlers.removeAllHandlers();
    }
  });

  describe('Handler Registration', () => {
    test('should register all IPC handlers', () => {
      // Ensure handlers were registered; specific channels are asserted below
      expect(mockIpcMain.handle).toHaveBeenCalled();

      // Verify all channels are registered
      const expectedChannels = [
        IPCChannels.GET_ACTIVITY_LOGS,
        IPCChannels.GET_ACTIVITY_LOGS_BY_DATE,
        IPCChannels.INSERT_ACTIVITY_LOG,
        IPCChannels.GET_SETTING,
        IPCChannels.SET_SETTING,
        IPCChannels.GET_ALL_SETTINGS,
        IPCChannels.GET_ANALYTICS,
        IPCChannels.INSERT_ANALYTICS,
        IPCChannels.CLEAR_ALL_DATA,
        IPCChannels.GET_DB_HEALTH,
      ];

      expectedChannels.forEach((channel) => {
        expect(mockIpcMain.handle).toHaveBeenCalledWith(
          channel,
          expect.any(Function)
        );
      });
    });

    test('should remove all handlers on cleanup', () => {
      ipcHandlers.removeAllHandlers();

      const expectedChannels = [
        IPCChannels.GET_ACTIVITY_LOGS,
        IPCChannels.GET_ACTIVITY_LOGS_BY_DATE,
        IPCChannels.INSERT_ACTIVITY_LOG,
        IPCChannels.GET_SETTING,
        IPCChannels.SET_SETTING,
        IPCChannels.GET_ALL_SETTINGS,
        IPCChannels.GET_ANALYTICS,
        IPCChannels.INSERT_ANALYTICS,
        IPCChannels.CLEAR_ALL_DATA,
        IPCChannels.GET_DB_HEALTH,
      ];

      expectedChannels.forEach((channel) => {
        expect(mockIpcMain.removeAllListeners).toHaveBeenCalledWith(channel);
      });
    });
  });

  describe('Activity Logs Handlers', () => {
    test('should handle getActivityLogs successfully', async () => {
      const mockLogs = [
        {
          id: 1,
          timestamp: '2024-08-28 10:00:00',
          app_name: 'Test App',
          window_title: 'Test',
          duration: 300,
        },
      ];
      mockDatabase.getActivityLogs.mockReturnValue(mockLogs);

      // Get the handler function
      const handlerCall = mockIpcMain.handle.mock.calls.find(
        (call) => call[0] === IPCChannels.GET_ACTIVITY_LOGS
      );
      const handler = handlerCall![1];

      const result = await handler({} as any, { limit: 10, offset: 0 });

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockLogs);
      expect(mockDatabase.getActivityLogs).toHaveBeenCalledWith(10, 0);
    });

    test('should handle getActivityLogs error', async () => {
      mockDatabase.getActivityLogs.mockImplementation(() => {
        throw new Error('Database error');
      });

      const handlerCall = mockIpcMain.handle.mock.calls.find(
        (call) => call[0] === IPCChannels.GET_ACTIVITY_LOGS
      );
      const handler = handlerCall![1];

      const result = await handler({} as any, { limit: 10 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Database error');
    });

    test('should handle insertActivityLog successfully', async () => {
      mockDatabase.insertActivityLog.mockReturnValue(123);

      const handlerCall = mockIpcMain.handle.mock.calls.find(
        (call) => call[0] === IPCChannels.INSERT_ACTIVITY_LOG
      );
      const handler = handlerCall![1];

      const logData = {
        timestamp: '2024-08-28 10:00:00',
        app_name: 'Test App',
        window_title: 'Test Window',
        duration: 300,
      };

      const result = await handler({} as any, logData);

      expect(result.success).toBe(true);
      expect(result.data).toBe(123);
      expect(mockDatabase.insertActivityLog).toHaveBeenCalledWith(logData);
    });
  });

  describe('Settings Handlers', () => {
    test('should handle getSetting successfully', async () => {
      mockDatabase.getSetting.mockReturnValue('test_value');

      const handlerCall = mockIpcMain.handle.mock.calls.find(
        (call) => call[0] === IPCChannels.GET_SETTING
      );
      const handler = handlerCall![1];

      const result = await handler({} as any, { key: 'test_key' });

      expect(result.success).toBe(true);
      expect(result.data).toBe('test_value');
      expect(mockDatabase.getSetting).toHaveBeenCalledWith('test_key');
    });

    test('should handle setSetting successfully', async () => {
      const handlerCall = mockIpcMain.handle.mock.calls.find(
        (call) => call[0] === IPCChannels.SET_SETTING
      );
      const handler = handlerCall![1];

      const result = await handler({} as any, {
        key: 'test_key',
        value: 'test_value',
      });

      expect(result.success).toBe(true);
      expect(mockDatabase.setSetting).toHaveBeenCalledWith(
        'test_key',
        'test_value'
      );
    });

    test('setSetting idle_threshold updates ActivityTracker idle threshold (RED)', async () => {
      const handlerCall = mockIpcMain.handle.mock.calls.find(
        (call) => call[0] === IPCChannels.SET_SETTING
      );
      const handler = handlerCall![1];

      // Mock global activity tracker used by handler
      (global as any).activityTracker = { updateIdleThreshold: jest.fn() };

      const result = await handler({} as any, {
        key: 'idle_threshold',
        value: '45',
      });

      expect(result.success).toBe(true);
      expect(
        (global as any).activityTracker.updateIdleThreshold
      ).toHaveBeenCalledWith(45);

      // Cleanup
      delete (global as any).activityTracker;
    });

    test('should handle getAllSettings successfully', async () => {
      const mockSettings = [
        { key: 'setting1', value: 'value1' },
        { key: 'setting2', value: 'value2' },
      ];
      mockDatabase.getAllSettings.mockReturnValue(mockSettings);

      const handlerCall = mockIpcMain.handle.mock.calls.find(
        (call) => call[0] === IPCChannels.GET_ALL_SETTINGS
      );
      const handler = handlerCall![1];

      const result = await handler({} as any);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockSettings);
    });
  });

  describe('Analytics Handlers', () => {
    test('should handle getAnalytics successfully', async () => {
      const mockAnalytics = [
        {
          id: 1,
          metric_name: 'test_metric',
          metric_value: 10,
          recorded_at: '2024-08-28 10:00:00',
        },
      ];
      mockDatabase.getAnalytics.mockReturnValue(mockAnalytics);

      const handlerCall = mockIpcMain.handle.mock.calls.find(
        (call) => call[0] === IPCChannels.GET_ANALYTICS
      );
      const handler = handlerCall![1];

      const result = await handler({} as any, { metricName: 'test_metric' });

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockAnalytics);
      expect(mockDatabase.getAnalytics).toHaveBeenCalledWith('test_metric');
    });

    test('should handle insertAnalytics successfully', async () => {
      mockDatabase.insertAnalytics.mockReturnValue(456);

      const handlerCall = mockIpcMain.handle.mock.calls.find(
        (call) => call[0] === IPCChannels.INSERT_ANALYTICS
      );
      const handler = handlerCall![1];

      const analyticsData = { metric_name: 'test_metric', metric_value: 10 };
      const result = await handler({} as any, analyticsData);

      expect(result.success).toBe(true);
      expect(result.data).toBe(456);
      expect(mockDatabase.insertAnalytics).toHaveBeenCalledWith(analyticsData);
    });
  });

  describe('Database Management Handlers', () => {
    test('should handle clearAllData successfully', async () => {
      const handlerCall = mockIpcMain.handle.mock.calls.find(
        (call) => call[0] === IPCChannels.CLEAR_ALL_DATA
      );
      const handler = handlerCall![1];

      const result = await handler({} as any);

      expect(result.success).toBe(true);
      expect(mockDatabase.clearAllData).toHaveBeenCalled();
    });

    test('should handle getDbHealth successfully', async () => {
      mockDatabase.isHealthy.mockReturnValue(true);

      const handlerCall = mockIpcMain.handle.mock.calls.find(
        (call) => call[0] === IPCChannels.GET_DB_HEALTH
      );
      const handler = handlerCall![1];

      const result = await handler({} as any);

      expect(result.success).toBe(true);
      expect(result.data).toBe(true);
      expect(mockDatabase.isHealthy).toHaveBeenCalled();
    });
  });
});
