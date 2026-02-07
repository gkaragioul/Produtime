import React from 'react';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';
import { SettingsTab } from '../SettingsTab';
import { AdminAuthService } from '../../services/admin-auth-service';
import { AdminTimeoutService } from '../../services/admin-timeout-service';
import { AdminActivityDetector } from '../../services/admin-activity-detector';

// Mock the services
jest.mock('../../services/admin-auth-service');
jest.mock('../../services/admin-timeout-service');
jest.mock('../../services/admin-activity-detector');
jest.mock('../../services/ipc-service');
jest.mock('../../services/settings-validation-service');

describe('SettingsTab - Admin Timeout Integration', () => {
  let mockAuthService: jest.Mocked<AdminAuthService>;
  let mockTimeoutService: jest.Mocked<AdminTimeoutService>;
  let mockActivityDetector: jest.Mocked<AdminActivityDetector>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Create mock instances
    mockAuthService = {
      isAdminAuthenticated: jest.fn(),
      login: jest.fn(),
      logout: jest.fn(),
      onTimeoutWarning: jest.fn(),
      extendSession: jest.fn(),
      startTimeoutAndActivityDetection: jest.fn(),
      stopTimeoutAndActivityDetection: jest.fn(),
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
    (AdminAuthService.getInstance as jest.Mock).mockReturnValue(
      mockAuthService
    );
    (AdminTimeoutService.getInstance as jest.Mock).mockReturnValue(
      mockTimeoutService
    );
    (AdminActivityDetector.getInstance as jest.Mock).mockReturnValue(
      mockActivityDetector
    );

    // Mock IPCService
    const mockIpcService = {
      getAllSettings: jest.fn().mockResolvedValue([]),
      saveSetting: jest.fn().mockResolvedValue(undefined),
      purgeAllData: jest.fn().mockResolvedValue(undefined),
    };

    (
      require('../../services/ipc-service').IPCService.getInstance as jest.Mock
    ).mockReturnValue(mockIpcService);
    (
      require('../../services/settings-validation-service')
        .SettingsValidationService.getInstance as jest.Mock
    ).mockReturnValue({
      validateField: jest.fn().mockReturnValue({ isValid: true }),
    });

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

  describe.skip('Admin Timeout Warning Integration (feature removed)', () => {
    it('should show timeout warning when admin session is about to expire', async () => {
      // Setup authenticated state
      mockAuthService.isAdminAuthenticated.mockReturnValue(true);

      render(<SettingsTab />);

      // Verify admin is authenticated and settings are loaded
      expect(mockAuthService.isAdminAuthenticated).toHaveBeenCalled();

      // Simulate timeout warning callback being triggered
      const warningCallback =
        mockAuthService.onTimeoutWarning.mock.calls[0]?.[0];
      expect(warningCallback).toBeDefined();

      // Trigger the warning
      act(() => {
        warningCallback(10); // 10 seconds remaining
      });

      // Check that timeout warning modal is displayed
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(
          screen.getByText(/your admin session will expire/i)
        ).toBeInTheDocument();
        expect(screen.getByText(/10 seconds/i)).toBeInTheDocument();
      });
    });

    it('should allow extending session from timeout warning', async () => {
      mockAuthService.isAdminAuthenticated.mockReturnValue(true);

      render(<SettingsTab />);

      // Trigger timeout warning
      const warningCallback =
        mockAuthService.onTimeoutWarning.mock.calls[0]?.[0];
      act(() => {
        warningCallback(5);
      });

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      // Click extend session button
      const extendButton = screen.getByRole('button', {
        name: /extend admin session/i,
      });
      fireEvent.click(extendButton);

      // Verify extend session was called
      expect(mockAuthService.extendSession).toHaveBeenCalled();

      // Modal should close
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });

    it('should handle auto-logout when timeout expires', async () => {
      mockAuthService.isAdminAuthenticated.mockReturnValue(true);

      render(<SettingsTab />);

      // Trigger timeout warning first
      const warningCallback =
        mockAuthService.onTimeoutWarning.mock.calls[0]?.[0];
      act(() => {
        warningCallback(3);
      });

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      // Simulate countdown reaching zero (auto-logout)
      act(() => {
        warningCallback(0);
      });

      // Verify logout was called
      expect(mockAuthService.logout).toHaveBeenCalled();

      // Modal should close and user should be logged out
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });

    it('should handle manual logout from timeout warning', async () => {
      mockAuthService.isAdminAuthenticated.mockReturnValue(true);

      render(<SettingsTab />);

      // Trigger timeout warning
      const warningCallback =
        mockAuthService.onTimeoutWarning.mock.calls[0]?.[0];
      act(() => {
        warningCallback(8);
      });

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      // Click logout button
      const logoutButton = screen.getByRole('button', { name: /logout now/i });
      fireEvent.click(logoutButton);

      // Verify logout was called
      expect(mockAuthService.logout).toHaveBeenCalled();

      // Modal should close
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });

    it('should update countdown in real-time', async () => {
      mockAuthService.isAdminAuthenticated.mockReturnValue(true);

      render(<SettingsTab />);

      // Trigger timeout warning
      const warningCallback =
        mockAuthService.onTimeoutWarning.mock.calls[0]?.[0];

      // Start with 10 seconds
      act(() => {
        warningCallback(10);
      });

      await waitFor(() => {
        expect(screen.getByText(/10 seconds/i)).toBeInTheDocument();
      });

      // Update to 5 seconds
      act(() => {
        warningCallback(5);
      });

      await waitFor(() => {
        expect(screen.getByText(/5 seconds/i)).toBeInTheDocument();
      });

      // Update to 1 second (critical state)
      act(() => {
        warningCallback(1);
      });

      await waitFor(() => {
        expect(screen.getByText(/1 second/i)).toBeInTheDocument();
        // Should show critical state styling
        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveClass('critical');
      });
    });

    it('should not show timeout warning when not authenticated', () => {
      mockAuthService.isAdminAuthenticated.mockReturnValue(false);

      render(<SettingsTab />);

      // Verify no timeout warning setup
      expect(mockAuthService.onTimeoutWarning).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('should clean up timeout warning on component unmount', () => {
      mockAuthService.isAdminAuthenticated.mockReturnValue(true);

      const { unmount } = render(<SettingsTab />);

      // Verify timeout warning was set up
      expect(mockAuthService.onTimeoutWarning).toHaveBeenCalled();

      // Unmount component
      unmount();

      // Verify cleanup (this would be implementation-specific)
      // The component should remove its timeout warning callback
    });
  });

  describe.skip('Error Handling for timeout warning (feature removed)', () => {
    it('should handle timeout service errors gracefully', async () => {
      mockAuthService.isAdminAuthenticated.mockReturnValue(true);

      render(<SettingsTab />);

      // Trigger timeout warning
      const warningCallback =
        mockAuthService.onTimeoutWarning.mock.calls[0]?.[0];
      act(() => {
        warningCallback(5);
      });

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      // Mock the extend session to throw an error
      mockAuthService.extendSession.mockImplementation(() => {
        throw new Error('Service error');
      });

      // Try to extend session (should fail gracefully)
      const extendButton = screen.getByRole('button', {
        name: /extend admin session/i,
      });

      // This should not crash the component
      fireEvent.click(extendButton);

      // Component should still be rendered and functional
      expect(screen.getByText('Application Settings')).toBeInTheDocument();
      expect(screen.getByText('Export Settings')).toBeInTheDocument();
    });
  });
});
