// Mock the shared types module
jest.mock('../../shared/types', () => ({
  TrayNotificationType: {
    INFO: 'info',
    SUCCESS: 'success',
    WARNING: 'warning',
    ERROR: 'error',
  },
}));

import { SystemTrayService } from './system-tray-service';
import { TrayNotificationType } from '../../shared/types';

// Mock the global window.electronAPI
const mockElectronAPI = {
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
};

// Mock window.electronAPI
Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
});

describe('SystemTrayService', () => {
  let systemTrayService: SystemTrayService;
  let mockNotificationCleanup: jest.Mock;
  let mockActionCleanup: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset singleton instance
    (SystemTrayService as any).instance = undefined;
    
    // Mock the cleanup functions
    mockNotificationCleanup = jest.fn();
    mockActionCleanup = jest.fn();
    mockElectronAPI.onTrayNotificationClicked.mockReturnValue(mockNotificationCleanup);
    mockElectronAPI.onTrayActionTriggered.mockReturnValue(mockActionCleanup);
    
    systemTrayService = SystemTrayService.getInstance();
  });

  describe('Singleton Pattern', () => {
    test('should return the same instance', () => {
      const instance1 = SystemTrayService.getInstance();
      const instance2 = SystemTrayService.getInstance();
      expect(instance1).toBe(instance2);
    });

    test('should throw error if electronAPI is not available', () => {
      // Temporarily remove electronAPI
      const originalAPI = window.electronAPI;
      delete (window as any).electronAPI;

      expect(() => {
        (SystemTrayService as any).instance = undefined;
        SystemTrayService.getInstance();
      }).toThrow('Electron API not available');

      // Restore electronAPI
      window.electronAPI = originalAPI;
    });
  });

  describe('Tray Operations', () => {
    test('should show notification successfully', async () => {
      mockElectronAPI.showTrayNotification.mockResolvedValue({ success: true });

      const notification = {
        title: 'Test Title',
        body: 'Test Body',
        type: TrayNotificationType.INFO,
        duration: 3000,
      };

      await systemTrayService.showNotification(notification);

      expect(mockElectronAPI.showTrayNotification).toHaveBeenCalledWith(notification);
    });

    test('should handle show notification error', async () => {
      mockElectronAPI.showTrayNotification.mockResolvedValue({
        success: false,
        error: 'Notification failed',
      });

      const notification = {
        title: 'Test Title',
        body: 'Test Body',
        type: TrayNotificationType.INFO,
      };

      await expect(systemTrayService.showNotification(notification)).rejects.toThrow('Notification failed');
    });

    test('should update tray state successfully', async () => {
      mockElectronAPI.updateTrayState.mockResolvedValue({ success: true });

      const stateUpdate = { isTrackingActive: true };
      await systemTrayService.updateTrayState(stateUpdate);

      expect(mockElectronAPI.updateTrayState).toHaveBeenCalledWith(stateUpdate);
    });

    test('should get tray state successfully', async () => {
      const mockState = {
        isVisible: true,
        isTrackingActive: false,
        unreadNotifications: 2,
        lastActivity: 'Test Activity',
      };

      mockElectronAPI.getTrayState.mockResolvedValue({
        success: true,
        data: mockState,
      });

      const result = await systemTrayService.getTrayState();

      expect(mockElectronAPI.getTrayState).toHaveBeenCalled();
      expect(result).toEqual(mockState);
    });

    test('should toggle window visibility successfully', async () => {
      mockElectronAPI.toggleWindowVisibility.mockResolvedValue({ success: true });

      await systemTrayService.toggleWindowVisibility();

      expect(mockElectronAPI.toggleWindowVisibility).toHaveBeenCalled();
    });

    test('should quit application successfully', async () => {
      mockElectronAPI.quitApplication.mockResolvedValue({ success: true });

      await systemTrayService.quitApplication();

      expect(mockElectronAPI.quitApplication).toHaveBeenCalled();
    });
  });

  describe('State Management', () => {
    test('should return current state', () => {
      const currentState = systemTrayService.getCurrentState();
      expect(currentState).toHaveProperty('isVisible');
      expect(currentState).toHaveProperty('isTrackingActive');
      expect(currentState).toHaveProperty('unreadNotifications');
    });

    test('should check tracking status', () => {
      expect(systemTrayService.isTrackingActive()).toBe(false);
    });

    test('should check window visibility', () => {
      expect(systemTrayService.isWindowVisible()).toBe(true);
    });

    test('should get unread notifications count', () => {
      expect(systemTrayService.getUnreadNotifications()).toBe(0);
    });
  });

  describe('Utility Notification Methods', () => {
    beforeEach(() => {
      mockElectronAPI.showTrayNotification.mockResolvedValue({ success: true });
    });

    test('should show success notification', async () => {
      await systemTrayService.showSuccessNotification('Success', 'Test success message');

      expect(mockElectronAPI.showTrayNotification).toHaveBeenCalledWith({
        title: 'Success',
        body: 'Test success message',
        type: TrayNotificationType.SUCCESS,
        duration: 3000,
      });
    });

    test('should show error notification', async () => {
      await systemTrayService.showErrorNotification('Error', 'Test error message');

      expect(mockElectronAPI.showTrayNotification).toHaveBeenCalledWith({
        title: 'Error',
        body: 'Test error message',
        type: TrayNotificationType.ERROR,
        duration: 5000,
      });
    });

    test('should show info notification', async () => {
      await systemTrayService.showInfoNotification('Info', 'Test info message');

      expect(mockElectronAPI.showTrayNotification).toHaveBeenCalledWith({
        title: 'Info',
        body: 'Test info message',
        type: TrayNotificationType.INFO,
        duration: 3000,
      });
    });

    test('should show warning notification', async () => {
      await systemTrayService.showWarningNotification('Warning', 'Test warning message');

      expect(mockElectronAPI.showTrayNotification).toHaveBeenCalledWith({
        title: 'Warning',
        body: 'Test warning message',
        type: TrayNotificationType.WARNING,
        duration: 4000,
      });
    });
  });

  describe('Activity Tracking Helpers', () => {
    beforeEach(() => {
      mockElectronAPI.updateTrayState.mockResolvedValue({ success: true });
      mockElectronAPI.showTrayNotification.mockResolvedValue({ success: true });
    });

    test('should start tracking', async () => {
      await systemTrayService.startTracking();

      expect(mockElectronAPI.updateTrayState).toHaveBeenCalledWith({ isTrackingActive: true });
      expect(mockElectronAPI.showTrayNotification).toHaveBeenCalledWith({
        title: 'TimePort',
        body: 'Activity tracking started',
        type: TrayNotificationType.SUCCESS,
        duration: 3000,
      });
    });

    test('should stop tracking', async () => {
      await systemTrayService.stopTracking();

      expect(mockElectronAPI.updateTrayState).toHaveBeenCalledWith({ isTrackingActive: false });
      expect(mockElectronAPI.showTrayNotification).toHaveBeenCalledWith({
        title: 'TimePort',
        body: 'Activity tracking stopped',
        type: TrayNotificationType.INFO,
        duration: 3000,
      });
    });

    test('should set last activity', async () => {
      await systemTrayService.setLastActivity('Test Activity');

      expect(mockElectronAPI.updateTrayState).toHaveBeenCalledWith({ lastActivity: 'Test Activity' });
    });
  });

  describe('Event Handling', () => {
    test('should set up event listeners on initialization', () => {
      expect(mockElectronAPI.onTrayNotificationClicked).toHaveBeenCalled();
      expect(mockElectronAPI.onTrayActionTriggered).toHaveBeenCalled();
    });

    test('should handle tray actions', () => {
      // Get the action handler from the mock call
      const actionHandler = mockElectronAPI.onTrayActionTriggered.mock.calls[0][0];
      
      // Mock the methods that would be called
      const updateStateSpy = jest.spyOn(systemTrayService, 'updateTrayState').mockResolvedValue();
      const showNotificationSpy = jest.spyOn(systemTrayService, 'showNotification').mockResolvedValue();

      // Test start tracking action
      actionHandler('start-tracking');
      
      // Test stop tracking action
      actionHandler('stop-tracking');
      
      // Test unknown action
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      actionHandler('unknown-action');
      expect(consoleSpy).toHaveBeenCalledWith('Unknown tray action:', 'unknown-action');
      
      consoleSpy.mockRestore();
    });
  });

  describe('Cleanup', () => {
    test('should cleanup event listeners', () => {
      systemTrayService.cleanup();

      expect(mockNotificationCleanup).toHaveBeenCalled();
      expect(mockActionCleanup).toHaveBeenCalled();
    });
  });
});
