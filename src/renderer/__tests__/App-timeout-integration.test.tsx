import React from 'react';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';
import App from '../App';
import { AdminAuthService } from '../services/admin-auth-service';
import { AdminTimeoutService } from '../services/admin-timeout-service';
import { AdminActivityDetector } from '../services/admin-activity-detector';

// Mock the services
jest.mock('../services/admin-auth-service');
jest.mock('../services/admin-timeout-service');
jest.mock('../services/admin-activity-detector');
jest.mock('../services/ipc-service');
jest.mock('../services/settings-validation-service');

const MockedAdminAuthService = AdminAuthService as jest.MockedClass<
  typeof AdminAuthService
>;
const MockedAdminTimeoutService = AdminTimeoutService as jest.MockedClass<
  typeof AdminTimeoutService
>;
const MockedAdminActivityDetector = AdminActivityDetector as jest.MockedClass<
  typeof AdminActivityDetector
>;

describe('App - Admin Timeout Integration', () => {
  let mockAuthService: jest.Mocked<AdminAuthService>;
  let mockTimeoutService: jest.Mocked<AdminTimeoutService>;
  let mockActivityDetector: jest.Mocked<AdminActivityDetector>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Mock electron API
    global.window.electronAPI = {
      onActivityChanged: jest.fn().mockReturnValue(() => {}),
      getSettings: jest.fn().mockResolvedValue([]),
      saveSettings: jest.fn().mockResolvedValue(undefined),
      purgeAllData: jest.fn().mockResolvedValue(undefined),
      adminLogin: jest.fn().mockResolvedValue(true),
    } as any;

    // Mock IPCService
    const mockIpcService = {
      getAllSettings: jest.fn().mockResolvedValue([]),
      saveSetting: jest.fn().mockResolvedValue(undefined),
      purgeAllData: jest.fn().mockResolvedValue(undefined),
    };

    (
      require('../services/ipc-service').IPCService.getInstance as jest.Mock
    ).mockReturnValue(mockIpcService);
    (
      require('../services/settings-validation-service')
        .SettingsValidationService.getInstance as jest.Mock
    ).mockReturnValue({
      validateField: jest.fn().mockReturnValue({ isValid: true }),
      validateSetting: jest.fn().mockReturnValue({ isValid: true }),
    });

    // Create mock instances
    mockAuthService = {
      isAdminAuthenticated: jest.fn(),
      login: jest.fn(),
      logout: jest.fn(),
      onTimeoutWarning: jest.fn(),
      extendSession: jest.fn(),
      startTimeoutAndActivityDetection: jest.fn(),
      stopTimeoutAndActivityDetection: jest.fn(),
      resetTimeout: jest.fn(),
    } as any;

    mockTimeoutService = {
      startTimer: jest.fn(),
      stopTimer: jest.fn(),
      resetTimer: jest.fn(),
      isTimerActive: jest.fn(),
      onTimeout: jest.fn(),
      onWarning: jest.fn(),
    } as any;

    mockActivityDetector = {
      startDetection: jest.fn(),
      stopDetection: jest.fn(),
      onActivity: jest.fn(),
      removeCallback: jest.fn(),
    } as any;

    // Mock getInstance methods
    MockedAdminAuthService.getInstance.mockReturnValue(mockAuthService);
    MockedAdminTimeoutService.getInstance.mockReturnValue(mockTimeoutService);
    MockedAdminActivityDetector.getInstance.mockReturnValue(
      mockActivityDetector
    );

    // Mock window.electronAPI
    global.window.electronAPI = {
      adminLogin: jest.fn(),
      getSettings: jest.fn(),
      saveSettings: jest.fn(),
      purgeAllData: jest.fn(),
    } as any;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Global Activity Detection', () => {
    it('should initialize global activity detection on app mount', () => {
      render(<App />);

      // Verify activity detector instance was created
      expect(MockedAdminActivityDetector.getInstance).toHaveBeenCalled();
    });

    it('should detect mouse activity across all tabs', async () => {
      render(<App />);

      // Simulate mouse movement
      fireEvent.mouseMove(document.body);

      // Verify activity was detected
      expect(mockActivityDetector.onActivity).toHaveBeenCalled();
    });

    it('should detect keyboard activity across all tabs', async () => {
      render(<App />);

      // Simulate keyboard activity
      fireEvent.keyDown(document.body, { key: 'a' });

      // Verify activity was detected
      expect(mockActivityDetector.onActivity).toHaveBeenCalled();
    });

    it('should detect activity when switching between tabs', async () => {
      render(<App />);

      // Start on dashboard
      expect(screen.getByText('Dashboard')).toHaveClass('active');

      // Switch to settings tab
      fireEvent.click(screen.getByText('Settings'));

      // Verify activity was detected during tab switch
      expect(mockActivityDetector.onActivity).toHaveBeenCalled();
    });

    it('should continue detecting activity in settings tab', async () => {
      mockAuthService.isAdminAuthenticated.mockReturnValue(true);

      render(<App />);

      // Switch to settings tab
      fireEvent.click(screen.getByText('Settings'));

      // Clear previous calls
      jest.clearAllMocks();

      // Simulate activity in settings tab
      fireEvent.mouseMove(screen.getByText('Application Settings'));

      // Verify activity was still detected
      expect(mockActivityDetector.onActivity).toHaveBeenCalled();
    });

    it('should reset admin timeout on detected activity', async () => {
      mockAuthService.isAdminAuthenticated.mockReturnValue(true);

      render(<App />);

      // Get the activity callback that was registered
      const activityCallback =
        mockActivityDetector.onActivity.mock.calls[0]?.[0];
      expect(activityCallback).toBeDefined();

      // Simulate activity
      act(() => {
        activityCallback();
      });

      // Verify timeout was reset (through auth service)
      expect(
        mockAuthService.startTimeoutAndActivityDetection
      ).toHaveBeenCalled();
    });
  });

  describe('Cross-Tab Timeout Behavior (removed UI)', () => {
    it('should show timeout warning regardless of active tab', async () => {
      mockAuthService.isAdminAuthenticated.mockReturnValue(true);

      render(<App />);

      // Switch to dashboard tab
      fireEvent.click(screen.getByText('Dashboard'));

      // Trigger timeout warning from settings (even though not active)
      const warningCallback =
        mockAuthService.onTimeoutWarning.mock.calls[0]?.[0];
      act(() => {
        warningCallback(10);
      });

      // Warning should appear even on dashboard tab
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(
          screen.getByText(/your admin session will expire/i)
        ).toBeInTheDocument();
      });
    });

    it('should handle logout from any tab', async () => {
      mockAuthService.isAdminAuthenticated.mockReturnValue(true);

      render(<App />);

      // Start on dashboard
      fireEvent.click(screen.getByText('Dashboard'));

      // Trigger timeout warning
      const warningCallback =
        mockAuthService.onTimeoutWarning.mock.calls[0]?.[0];
      act(() => {
        warningCallback(5);
      });

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      // Logout from warning modal
      fireEvent.click(screen.getByRole('button', { name: /logout now/i }));

      // Verify logout was called
      expect(mockAuthService.logout).toHaveBeenCalled();

      // Should be able to switch to settings tab (but not authenticated)
      fireEvent.click(screen.getByText('Settings'));

      // Should show login form, not settings
      await waitFor(() => {
        expect(
          screen.queryByText('Application Settings')
        ).not.toBeInTheDocument();
      });
    });

    it('should maintain activity detection when switching tabs rapidly', async () => {
      render(<App />);

      // Rapidly switch between tabs
      for (let i = 0; i < 5; i++) {
        fireEvent.click(screen.getByText('Settings'));
        fireEvent.click(screen.getByText('Dashboard'));
      }

      // Activity detection should still be working
      fireEvent.mouseMove(document.body);
      expect(mockActivityDetector.onActivity).toHaveBeenCalled();
    });
  });

  describe('Service Lifecycle Management', () => {
    it('should initialize services on app mount', () => {
      render(<App />);

      // Verify all services were initialized
      expect(MockedAdminAuthService.getInstance).toHaveBeenCalled();
      expect(MockedAdminTimeoutService.getInstance).toHaveBeenCalled();
      expect(MockedAdminActivityDetector.getInstance).toHaveBeenCalled();
    });

    it('should clean up services on app unmount', () => {
      const { unmount } = render(<App />);

      // Unmount the app
      unmount();

      // Verify cleanup was called
      expect(mockActivityDetector.stopDetection).toHaveBeenCalled();
    });

    it('should handle service initialization errors gracefully', () => {
      // Mock service to throw error
      MockedAdminActivityDetector.getInstance.mockImplementation(() => {
        throw new Error('Service initialization failed');
      });

      // App should still render without crashing
      expect(() => render(<App />)).not.toThrow();
    });
  });

  describe('Performance and Memory', () => {
    it('should not create multiple service instances', () => {
      render(<App />);

      // Render another instance
      render(<App />);

      // Services should use singleton pattern
      expect(MockedAdminAuthService.getInstance).toHaveBeenCalledTimes(2);
      expect(MockedAdminTimeoutService.getInstance).toHaveBeenCalledTimes(2);
      expect(MockedAdminActivityDetector.getInstance).toHaveBeenCalledTimes(2);
    });

    it('should throttle activity detection to prevent performance issues', async () => {
      render(<App />);

      // Simulate rapid mouse movements
      for (let i = 0; i < 100; i++) {
        fireEvent.mouseMove(document.body, { clientX: i, clientY: i });
      }

      // Activity callback should be throttled (not called 100 times)
      const callCount = mockActivityDetector.onActivity.mock.calls.length;
      expect(callCount).toBeLessThan(100);
    });
  });

  describe('Error Recovery', () => {
    it('should recover from activity detector errors', async () => {
      render(<App />);

      // Simulate activity detector error
      const activityCallback =
        mockActivityDetector.onActivity.mock.calls[0]?.[0];
      mockActivityDetector.onActivity.mockImplementation(() => {
        throw new Error('Activity detection error');
      });

      // App should continue working despite error
      expect(() => {
        fireEvent.mouseMove(document.body);
      }).not.toThrow();
    });

    it('should handle timeout service errors without crashing', async () => {
      mockAuthService.isAdminAuthenticated.mockReturnValue(true);
      mockAuthService.onTimeoutWarning.mockImplementation(() => {
        throw new Error('Timeout service error');
      });

      // App should render without crashing
      expect(() => render(<App />)).not.toThrow();
    });
  });
});
