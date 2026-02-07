// Mock the shared types module
jest.mock('../../shared/types', () => ({
  UpdateStatus: {
    CHECKING: 'checking-for-update',
    AVAILABLE: 'update-available',
    NOT_AVAILABLE: 'update-not-available',
    DOWNLOADING: 'download-progress',
    DOWNLOADED: 'update-downloaded',
    ERROR: 'error',
  },
}));

import { AutoUpdaterService } from './auto-updater-service';
import { UpdateStatus } from '../../shared/types';

interface UpdateState {
  status: string;
  info?: any;
  progress?: any;
  error?: string;
}

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
};

// Mock window.electronAPI
Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
});

describe('AutoUpdaterService', () => {
  let autoUpdaterService: AutoUpdaterService;
  let mockCleanupFunction: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset singleton instance
    (AutoUpdaterService as any).instance = undefined;
    
    // Mock the cleanup function
    mockCleanupFunction = jest.fn();
    mockElectronAPI.onUpdateStatusChanged.mockReturnValue(mockCleanupFunction);
    
    autoUpdaterService = AutoUpdaterService.getInstance();
  });

  describe('Singleton Pattern', () => {
    test('should return the same instance', () => {
      const instance1 = AutoUpdaterService.getInstance();
      const instance2 = AutoUpdaterService.getInstance();
      expect(instance1).toBe(instance2);
    });

    test('should throw error if electronAPI is not available', () => {
      // Temporarily remove electronAPI
      const originalAPI = window.electronAPI;
      delete (window as any).electronAPI;

      expect(() => {
        (AutoUpdaterService as any).instance = undefined;
        AutoUpdaterService.getInstance();
      }).toThrow('Electron API not available');

      // Restore electronAPI
      window.electronAPI = originalAPI;
    });
  });

  describe('Update Operations', () => {
    test('should check for updates successfully', async () => {
      mockElectronAPI.checkForUpdates.mockResolvedValue({ success: true });

      await autoUpdaterService.checkForUpdates();

      expect(mockElectronAPI.checkForUpdates).toHaveBeenCalled();
    });

    test('should handle check for updates error', async () => {
      mockElectronAPI.checkForUpdates.mockResolvedValue({ 
        success: false, 
        error: 'Network error' 
      });

      await expect(autoUpdaterService.checkForUpdates()).rejects.toThrow('Network error');
    });

    test('should download update successfully', async () => {
      mockElectronAPI.downloadUpdate.mockResolvedValue({ success: true });

      await autoUpdaterService.downloadUpdate();

      expect(mockElectronAPI.downloadUpdate).toHaveBeenCalled();
    });

    test('should handle download update error', async () => {
      mockElectronAPI.downloadUpdate.mockResolvedValue({ 
        success: false, 
        error: 'Download failed' 
      });

      await expect(autoUpdaterService.downloadUpdate()).rejects.toThrow('Download failed');
    });

    test('should install update successfully', async () => {
      mockElectronAPI.installUpdate.mockResolvedValue({ success: true });

      await autoUpdaterService.installUpdate();

      expect(mockElectronAPI.installUpdate).toHaveBeenCalled();
    });

    test('should handle install update error', async () => {
      mockElectronAPI.installUpdate.mockResolvedValue({ 
        success: false, 
        error: 'Install failed' 
      });

      await expect(autoUpdaterService.installUpdate()).rejects.toThrow('Install failed');
    });
  });

  describe('Status Management', () => {
    test('should get update status successfully', async () => {
      const mockStatus: UpdateState = {
        status: UpdateStatus.AVAILABLE,
        info: {
          version: '1.1.0',
          releaseDate: '2024-08-28',
          releaseNotes: 'Bug fixes and improvements'
        }
      };

      mockElectronAPI.getUpdateStatus.mockResolvedValue({ 
        success: true, 
        data: mockStatus 
      });

      const result = await autoUpdaterService.getUpdateStatus();

      expect(result).toEqual(mockStatus);
      expect(mockElectronAPI.getUpdateStatus).toHaveBeenCalled();
    });

    test('should handle get update status error', async () => {
      mockElectronAPI.getUpdateStatus.mockResolvedValue({ 
        success: false, 
        error: 'Status check failed' 
      });

      await expect(autoUpdaterService.getUpdateStatus()).rejects.toThrow('Status check failed');
    });

    test('should return current state', () => {
      const currentState = autoUpdaterService.getCurrentState();
      expect(currentState).toHaveProperty('status');
    });
  });

  describe('State Helpers', () => {
    test('should detect update available', () => {
      // Set internal state to available
      (autoUpdaterService as any).currentState = { status: UpdateStatus.AVAILABLE };
      
      expect(autoUpdaterService.isUpdateAvailable()).toBe(true);
      expect(autoUpdaterService.isUpdateDownloaded()).toBe(false);
      expect(autoUpdaterService.isUpdateInProgress()).toBe(false);
    });

    test('should detect update downloaded', () => {
      (autoUpdaterService as any).currentState = { status: UpdateStatus.DOWNLOADED };
      
      expect(autoUpdaterService.isUpdateAvailable()).toBe(false);
      expect(autoUpdaterService.isUpdateDownloaded()).toBe(true);
      expect(autoUpdaterService.isUpdateInProgress()).toBe(false);
    });

    test('should detect update in progress', () => {
      (autoUpdaterService as any).currentState = { status: UpdateStatus.DOWNLOADING };
      
      expect(autoUpdaterService.isUpdateAvailable()).toBe(false);
      expect(autoUpdaterService.isUpdateDownloaded()).toBe(false);
      expect(autoUpdaterService.isUpdateInProgress()).toBe(true);
    });
  });

  describe('Status Text and Progress', () => {
    test('should return correct status text for different states', () => {
      const testCases = [
        { status: UpdateStatus.CHECKING, expected: 'Checking for updates...' },
        { status: UpdateStatus.NOT_AVAILABLE, expected: 'No updates available' },
        { status: UpdateStatus.ERROR, expected: 'Update error: Test error' },
      ];

      testCases.forEach(({ status, expected }) => {
        (autoUpdaterService as any).currentState = { 
          status, 
          error: status === UpdateStatus.ERROR ? 'Test error' : undefined 
        };
        expect(autoUpdaterService.getStatusText()).toBe(expected);
      });
    });

    test('should return progress percentage', () => {
      (autoUpdaterService as any).currentState = {
        status: UpdateStatus.DOWNLOADING,
        progress: { percent: 75, bytesPerSecond: 1024, transferred: 750, total: 1000 }
      };

      expect(autoUpdaterService.getProgressPercent()).toBe(75);
    });

    test('should format bytes correctly', () => {
      expect(autoUpdaterService.formatBytes(0)).toBe('0 Bytes');
      expect(autoUpdaterService.formatBytes(1024)).toBe('1 KB');
      expect(autoUpdaterService.formatBytes(1048576)).toBe('1 MB');
      expect(autoUpdaterService.formatBytes(1073741824)).toBe('1 GB');
    });

    test('should return download info', () => {
      (autoUpdaterService as any).currentState = {
        status: UpdateStatus.DOWNLOADING,
        progress: { 
          percent: 50, 
          bytesPerSecond: 2048, 
          transferred: 1048576, 
          total: 2097152 
        }
      };

      const downloadInfo = autoUpdaterService.getDownloadInfo();
      expect(downloadInfo).toContain('1 MB / 2 MB');
      expect(downloadInfo).toContain('2 KB/s');
    });
  });

  describe('Event Listeners', () => {
    test('should add and remove status change listeners', () => {
      const mockListener = jest.fn();
      
      const cleanup = autoUpdaterService.addStatusChangeListener(mockListener);
      
      // Simulate status change
      const mockStatus: UpdateState = { status: UpdateStatus.AVAILABLE };
      (autoUpdaterService as any).notifyListeners(mockStatus);
      
      expect(mockListener).toHaveBeenCalledWith(mockStatus);
      
      // Test cleanup
      cleanup();
      (autoUpdaterService as any).notifyListeners(mockStatus);
      
      // Should not be called again after cleanup
      expect(mockListener).toHaveBeenCalledTimes(1);
    });

    test('should handle listener errors gracefully', () => {
      const errorListener = jest.fn(() => {
        throw new Error('Listener error');
      });
      const goodListener = jest.fn();
      
      autoUpdaterService.addStatusChangeListener(errorListener);
      autoUpdaterService.addStatusChangeListener(goodListener);
      
      const mockStatus: UpdateState = { status: UpdateStatus.AVAILABLE };
      
      // Should not throw error
      expect(() => {
        (autoUpdaterService as any).notifyListeners(mockStatus);
      }).not.toThrow();
      
      // Good listener should still be called
      expect(goodListener).toHaveBeenCalledWith(mockStatus);
    });
  });

  describe('Cleanup', () => {
    test('should cleanup properly', () => {
      autoUpdaterService.cleanup();
      
      expect(mockCleanupFunction).toHaveBeenCalled();
      expect((autoUpdaterService as any).statusChangeListeners).toEqual([]);
    });
  });
});
