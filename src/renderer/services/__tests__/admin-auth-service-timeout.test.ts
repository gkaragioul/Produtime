/**
 * @jest-environment jsdom
 */

import { AdminAuthService } from '../admin-auth-service';
import { AdminTimeoutService } from '../admin-timeout-service';
import { AdminActivityDetector } from '../admin-activity-detector';

// Mock the electron API
const mockElectronAPI = {
  adminLogin: jest.fn(),
  getAdminLockoutState: jest.fn(),
  resetAdminLockout: jest.fn(),
};

// Mock window.electronAPI
Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
});

// Mock sessionStorage
const mockSessionStorage = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
};

Object.defineProperty(window, 'sessionStorage', {
  value: mockSessionStorage,
  writable: true,
});

// Mock timers
jest.useFakeTimers();

describe('AdminAuthService with Timeout Integration', () => {
  let authService: AdminAuthService;
  let mockTimeoutService: jest.Mocked<AdminTimeoutService>;
  let mockActivityDetector: jest.Mocked<AdminActivityDetector>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    jest.clearAllTimers();

    // Create mock services
    mockTimeoutService = {
      startTimer: jest.fn(),
      stopTimer: jest.fn(),
      resetTimer: jest.fn(),
      isTimerActive: jest.fn(),
      getTimeoutDuration: jest.fn().mockReturnValue(30000),
      getWarningDuration: jest.fn().mockReturnValue(10000),
    } as any;

    mockActivityDetector = {
      onActivity: jest.fn(),
      startDetection: jest.fn(),
      stopDetection: jest.fn(),
      isDetecting: jest.fn(),
      removeCallback: jest.fn(),
      clearCallbacks: jest.fn(),
      getCallbackCount: jest.fn(),
    } as any;

    // Create auth service with injected dependencies
    authService = new AdminAuthService(
      mockTimeoutService,
      mockActivityDetector
    );

    // Setup default mock responses
    mockElectronAPI.adminLogin.mockResolvedValue({
      success: true,
      data: { success: true, message: 'Login successful' },
    });

    mockSessionStorage.getItem.mockReturnValue(null);
  });

  afterEach(() => {
    authService.logout();
  });

  describe('Timeout Service Integration', () => {
    it('should start timeout timer on successful login', async () => {
      await authService.login('correct-password');

      expect(mockTimeoutService.startTimer).toHaveBeenCalledTimes(1);
      expect(mockTimeoutService.startTimer).toHaveBeenCalledWith(
        expect.any(Function), // timeout callback
        expect.any(Function) // warning callback
      );
    });

    it('should not start timeout timer on failed login', async () => {
      mockElectronAPI.adminLogin.mockResolvedValue({
        success: true,
        data: { success: false, message: 'Invalid password' },
      });

      await authService.login('wrong-password');

      expect(mockTimeoutService.startTimer).not.toHaveBeenCalled();
    });

    it('should stop timeout timer on logout', () => {
      authService.logout();

      expect(mockTimeoutService.stopTimer).toHaveBeenCalledTimes(1);
    });

    it('should stop timeout timer on manual logout after login', async () => {
      await authService.login('correct-password');
      mockTimeoutService.startTimer.mockClear();

      authService.logout();

      expect(mockTimeoutService.stopTimer).toHaveBeenCalledTimes(1);
    });
  });

  describe('Activity Detection Integration', () => {
    it('should start activity detection on successful login', async () => {
      await authService.login('correct-password');

      expect(mockActivityDetector.onActivity).toHaveBeenCalledTimes(1);
      expect(mockActivityDetector.startDetection).toHaveBeenCalledTimes(1);
    });

    it('should stop activity detection on logout', () => {
      authService.logout();

      expect(mockActivityDetector.stopDetection).toHaveBeenCalledTimes(1);
      expect(mockActivityDetector.clearCallbacks).toHaveBeenCalledTimes(1);
    });

    it('should reset timeout timer when activity is detected', async () => {
      await authService.login('correct-password');

      // Get the activity callback that was registered
      const activityCallback = mockActivityDetector.onActivity.mock.calls[0][0];

      // Simulate activity detection
      activityCallback();

      expect(mockTimeoutService.resetTimer).toHaveBeenCalledTimes(1);
    });
  });

  describe('Auto-logout Functionality', () => {
    it('should automatically logout admin on timeout', async () => {
      await authService.login('correct-password');

      expect(authService.isAdminAuthenticated()).toBe(true);

      // Get the timeout callback that was registered
      const timeoutCallback = mockTimeoutService.startTimer.mock.calls[0][0];

      // Simulate timeout
      timeoutCallback();

      expect(authService.isAdminAuthenticated()).toBe(false);
    });

    it('should clear session storage on auto-logout', async () => {
      await authService.login('correct-password');

      // Get the timeout callback
      const timeoutCallback = mockTimeoutService.startTimer.mock.calls[0][0];

      // Simulate timeout
      timeoutCallback();

      expect(mockSessionStorage.removeItem).toHaveBeenCalledWith(
        'admin_authenticated'
      );
      expect(mockSessionStorage.removeItem).toHaveBeenCalledWith(
        'admin_auth_token'
      );
      expect(mockSessionStorage.removeItem).toHaveBeenCalledWith(
        'admin_auth_time'
      );
    });

    it('should stop activity detection on auto-logout', async () => {
      await authService.login('correct-password');
      mockActivityDetector.stopDetection.mockClear();
      mockActivityDetector.clearCallbacks.mockClear();

      // Get the timeout callback
      const timeoutCallback = mockTimeoutService.startTimer.mock.calls[0][0];

      // Simulate timeout
      timeoutCallback();

      expect(mockActivityDetector.stopDetection).toHaveBeenCalledTimes(1);
      expect(mockActivityDetector.clearCallbacks).toHaveBeenCalledTimes(1);
    });
  });

  describe('Warning System Integration', () => {
    it('should provide warning callback to timeout service', async () => {
      await authService.login('correct-password');

      const [timeoutCallback, warningCallback] =
        mockTimeoutService.startTimer.mock.calls[0];

      expect(warningCallback).toBeDefined();
      expect(typeof warningCallback).toBe('function');
    });

    it('should emit warning event when warning callback is triggered', async () => {
      const warningListener = jest.fn();
      authService.onTimeoutWarning(warningListener);

      await authService.login('correct-password');

      // Get the warning callback
      const warningCallback = mockTimeoutService.startTimer.mock.calls[0][1];

      // Simulate warning
      warningCallback(10);

      expect(warningListener).toHaveBeenCalledWith(10);
    });

    it('should allow extending session when warning is active', async () => {
      await authService.login('correct-password');

      // Get the warning callback
      const warningCallback = mockTimeoutService.startTimer.mock.calls[0][1];

      // Simulate warning
      warningCallback(10);

      // Extend session
      authService.extendSession();

      expect(mockTimeoutService.resetTimer).toHaveBeenCalled();
    });
  });

  describe('Session State Management', () => {
    it('should maintain authentication state during timeout period', async () => {
      await authService.login('correct-password');

      expect(authService.isAdminAuthenticated()).toBe(true);

      // Simulate some time passing but not timeout
      jest.advanceTimersByTime(15000);

      expect(authService.isAdminAuthenticated()).toBe(true);
    });

    it('should handle session restoration with timeout integration', () => {
      // Mock existing session that's expired (30 minutes ago, but limit is 1 hour)
      mockSessionStorage.getItem.mockImplementation((key) => {
        switch (key) {
          case 'admin_authenticated':
            return 'true';
          case 'admin_auth_token':
            return 'mock-token';
          case 'admin_auth_time':
            return new Date(Date.now() - 3700000).toISOString(); // 61+ minutes ago (expired)
          default:
            return null;
        }
      });

      // Create new auth service (simulating app restart)
      const newAuthService = new AdminAuthService(
        mockTimeoutService,
        mockActivityDetector
      );

      // Should not be authenticated due to expired session (>1 hour)
      expect(newAuthService.isAdminAuthenticated()).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle timeout service errors gracefully', async () => {
      mockTimeoutService.startTimer.mockImplementation(() => {
        throw new Error('Timeout service error');
      });

      // Should not throw
      await expect(
        authService.login('correct-password')
      ).resolves.not.toThrow();
    });

    it('should handle activity detector errors gracefully', async () => {
      mockActivityDetector.startDetection.mockImplementation(() => {
        throw new Error('Activity detector error');
      });

      // Should not throw
      await expect(
        authService.login('correct-password')
      ).resolves.not.toThrow();
    });

    it('should cleanup properly even if services throw errors', () => {
      mockTimeoutService.stopTimer.mockImplementation(() => {
        throw new Error('Cleanup error');
      });

      // Should not throw
      expect(() => authService.logout()).not.toThrow();
    });
  });

  describe('Event System', () => {
    it('should support multiple warning listeners', async () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      authService.onTimeoutWarning(listener1);
      authService.onTimeoutWarning(listener2);

      await authService.login('correct-password');

      // Get the warning callback
      const warningCallback = mockTimeoutService.startTimer.mock.calls[0][1];

      // Simulate warning
      warningCallback(5);

      expect(listener1).toHaveBeenCalledWith(5);
      expect(listener2).toHaveBeenCalledWith(5);
    });

    it('should allow removing warning listeners', async () => {
      const listener = jest.fn();

      authService.onTimeoutWarning(listener);
      authService.removeTimeoutWarningListener(listener);

      await authService.login('correct-password');

      // Get the warning callback
      const warningCallback = mockTimeoutService.startTimer.mock.calls[0][1];

      // Simulate warning
      warningCallback(5);

      expect(listener).not.toHaveBeenCalled();
    });
  });
});
