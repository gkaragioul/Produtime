/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AdminTimeoutWarning } from '../AdminTimeoutWarning';

// Mock timers for testing
jest.useFakeTimers();

describe('AdminTimeoutWarning', () => {
  const defaultProps = {
    isVisible: true,
    remainingSeconds: 10,
    onExtendSession: jest.fn(),
    onLogout: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Visibility and Rendering', () => {
    it('should render when visible', () => {
      render(<AdminTimeoutWarning {...defaultProps} />);

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText(/session timeout warning/i)).toBeInTheDocument();
    });

    it('should not render when not visible', () => {
      render(<AdminTimeoutWarning {...defaultProps} isVisible={false} />);

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('should display remaining time correctly', () => {
      render(<AdminTimeoutWarning {...defaultProps} remainingSeconds={15} />);

      expect(screen.getByText(/15 seconds/i)).toBeInTheDocument();
    });

    it('should handle singular second display', () => {
      render(<AdminTimeoutWarning {...defaultProps} remainingSeconds={1} />);

      expect(screen.getByText(/1 second/i)).toBeInTheDocument();
    });
  });

  describe('User Interactions', () => {
    it('should call onExtendSession when extend button is clicked', () => {
      const mockExtend = jest.fn();
      render(
        <AdminTimeoutWarning {...defaultProps} onExtendSession={mockExtend} />
      );

      const extendButton = screen.getByRole('button', {
        name: /extend admin session/i,
      });
      fireEvent.click(extendButton);

      expect(mockExtend).toHaveBeenCalledTimes(1);
    });

    it('should call onLogout when logout button is clicked', () => {
      const mockLogout = jest.fn();
      render(<AdminTimeoutWarning {...defaultProps} onLogout={mockLogout} />);

      const logoutButton = screen.getByRole('button', { name: /logout now/i });
      fireEvent.click(logoutButton);

      expect(mockLogout).toHaveBeenCalledTimes(1);
    });

    it('should handle keyboard navigation', () => {
      render(<AdminTimeoutWarning {...defaultProps} />);

      const extendButton = screen.getByRole('button', {
        name: /extend admin session/i,
      });
      const logoutButton = screen.getByRole('button', { name: /logout now/i });

      // Focus should be manageable
      extendButton.focus();
      expect(extendButton).toHaveFocus();

      logoutButton.focus();
      expect(logoutButton).toHaveFocus();
    });

    it('should handle Enter key on buttons', () => {
      const mockExtend = jest.fn();
      render(
        <AdminTimeoutWarning {...defaultProps} onExtendSession={mockExtend} />
      );

      const extendButton = screen.getByRole('button', {
        name: /extend admin session/i,
      });
      fireEvent.keyDown(extendButton, { key: 'Enter' });

      expect(mockExtend).toHaveBeenCalledTimes(1);
    });

    it('should handle Space key on buttons', () => {
      const mockLogout = jest.fn();
      render(<AdminTimeoutWarning {...defaultProps} onLogout={mockLogout} />);

      const logoutButton = screen.getByRole('button', { name: /logout now/i });
      fireEvent.keyDown(logoutButton, { key: ' ' });

      expect(mockLogout).toHaveBeenCalledTimes(1);
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA attributes', () => {
      render(<AdminTimeoutWarning {...defaultProps} />);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(dialog).toHaveAttribute('aria-labelledby');
      expect(dialog).toHaveAttribute('aria-describedby');
    });

    it('should have accessible title and description', () => {
      render(<AdminTimeoutWarning {...defaultProps} />);

      const title = screen.getByRole('heading', { level: 2 });
      expect(title).toHaveAttribute('id');

      const description = screen.getByText(/your admin session will expire/i);
      expect(description).toHaveAttribute('id');
    });

    it('should focus on first interactive element when opened', async () => {
      const { rerender } = render(
        <AdminTimeoutWarning {...defaultProps} isVisible={false} />
      );

      rerender(<AdminTimeoutWarning {...defaultProps} isVisible={true} />);

      await waitFor(() => {
        const extendButton = screen.getByRole('button', {
          name: /extend admin session/i,
        });
        expect(extendButton).toHaveFocus();
      });
    });

    it('should have focus trap functionality', () => {
      render(<AdminTimeoutWarning {...defaultProps} />);

      const extendButton = screen.getByRole('button', {
        name: /extend admin session/i,
      });
      const logoutButton = screen.getByRole('button', { name: /logout now/i });

      // Both buttons should be focusable
      expect(extendButton).toBeInTheDocument();
      expect(logoutButton).toBeInTheDocument();

      // Focus should work on both buttons
      extendButton.focus();
      expect(extendButton).toHaveFocus();

      logoutButton.focus();
      expect(logoutButton).toHaveFocus();
    });

    it('should handle Escape key to close modal', () => {
      const mockLogout = jest.fn();
      render(<AdminTimeoutWarning {...defaultProps} onLogout={mockLogout} />);

      const dialog = screen.getByRole('dialog');
      fireEvent.keyDown(dialog, { key: 'Escape' });

      expect(mockLogout).toHaveBeenCalledTimes(1);
    });
  });

  describe('Visual States', () => {
    it('should show warning state for normal countdown', () => {
      render(<AdminTimeoutWarning {...defaultProps} remainingSeconds={10} />);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveClass('warning');
    });

    it('should show critical state for low countdown', () => {
      render(<AdminTimeoutWarning {...defaultProps} remainingSeconds={3} />);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveClass('critical');
    });

    it('should display appropriate icon for warning state', () => {
      render(<AdminTimeoutWarning {...defaultProps} remainingSeconds={10} />);

      const warningIcon = screen.getByTestId('warning-icon');
      expect(warningIcon).toBeInTheDocument();
    });

    it('should display appropriate icon for critical state', () => {
      render(<AdminTimeoutWarning {...defaultProps} remainingSeconds={3} />);

      const criticalIcon = screen.getByTestId('critical-icon');
      expect(criticalIcon).toBeInTheDocument();
    });
  });

  describe('Animation and Timing', () => {
    it('should animate countdown updates', () => {
      const { rerender } = render(
        <AdminTimeoutWarning {...defaultProps} remainingSeconds={10} />
      );

      expect(screen.getByText(/10 seconds/i)).toBeInTheDocument();

      rerender(<AdminTimeoutWarning {...defaultProps} remainingSeconds={9} />);

      expect(screen.getByText(/9 seconds/i)).toBeInTheDocument();
    });

    it('should handle rapid countdown updates', () => {
      const { rerender } = render(
        <AdminTimeoutWarning {...defaultProps} remainingSeconds={5} />
      );

      for (let i = 4; i >= 1; i--) {
        rerender(
          <AdminTimeoutWarning {...defaultProps} remainingSeconds={i} />
        );
        expect(
          screen.getByText(new RegExp(`${i} second`, 'i'))
        ).toBeInTheDocument();
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid remaining seconds gracefully', () => {
      render(<AdminTimeoutWarning {...defaultProps} remainingSeconds={-1} />);

      expect(screen.getByText(/0 seconds/i)).toBeInTheDocument();
    });

    it('should handle missing callback functions', () => {
      render(
        <AdminTimeoutWarning
          {...defaultProps}
          onExtendSession={undefined}
          onLogout={undefined}
        />
      );

      const extendButton = screen.getByRole('button', {
        name: /extend admin session/i,
      });
      const logoutButton = screen.getByRole('button', { name: /logout now/i });

      expect(() => fireEvent.click(extendButton)).not.toThrow();
      expect(() => fireEvent.click(logoutButton)).not.toThrow();
    });

    it('should handle callback errors gracefully', () => {
      const errorCallback = jest.fn(() => {
        throw new Error('Callback error');
      });

      render(
        <AdminTimeoutWarning
          {...defaultProps}
          onExtendSession={errorCallback}
        />
      );

      const extendButton = screen.getByRole('button', {
        name: /extend admin session/i,
      });

      expect(() => fireEvent.click(extendButton)).not.toThrow();
      expect(errorCallback).toHaveBeenCalledTimes(1);
    });
  });

  describe('Responsive Design', () => {
    it('should adapt to different screen sizes', () => {
      // Mock window.innerWidth
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 320, // Mobile width
      });

      render(<AdminTimeoutWarning {...defaultProps} />);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveClass('responsive');
    });
  });

  describe('Performance', () => {
    it('should render efficiently with memo optimization', () => {
      const { rerender } = render(<AdminTimeoutWarning {...defaultProps} />);

      // Component should render without issues
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      // Re-render with same props should work
      rerender(<AdminTimeoutWarning {...defaultProps} />);

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });
});
