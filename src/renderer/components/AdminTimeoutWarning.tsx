import React, { useEffect, useRef, memo } from 'react';
import './AdminTimeoutWarning.css';

interface AdminTimeoutWarningProps {
  isVisible: boolean;
  remainingSeconds: number;
  onExtendSession?: () => void;
  onLogout?: () => void;
}

export const AdminTimeoutWarning = memo<AdminTimeoutWarningProps>(
  ({ isVisible, remainingSeconds, onExtendSession, onLogout }) => {
    const dialogRef = useRef<HTMLDivElement>(null);
    const extendButtonRef = useRef<HTMLButtonElement>(null);

    // Ensure remaining seconds is not negative
    const safeRemainingSeconds = Math.max(0, remainingSeconds);

    // Determine if this is a critical state (5 seconds or less)
    const isCritical = safeRemainingSeconds <= 5;

    // Format seconds display
    const secondsText = safeRemainingSeconds === 1 ? 'second' : 'seconds';

    // Focus management
    useEffect(() => {
      if (isVisible && extendButtonRef.current) {
        extendButtonRef.current.focus();
      }
    }, [isVisible]);

    // Handle keyboard events
    const handleKeyDown = (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleLogout();
      } else if (event.key === 'Tab') {
        // Focus trap implementation
        const focusableElements = dialogRef.current?.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );

        if (focusableElements && focusableElements.length > 1) {
          const firstElement = focusableElements[0] as HTMLElement;
          const lastElement = focusableElements[
            focusableElements.length - 1
          ] as HTMLElement;

          if (event.shiftKey && document.activeElement === firstElement) {
            event.preventDefault();
            lastElement.focus();
          } else if (
            !event.shiftKey &&
            document.activeElement === lastElement
          ) {
            event.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    // Handle button clicks with error handling
    const handleExtendSession = () => {
      try {
        onExtendSession?.();
      } catch (error) {
        console.error('Error extending session:', error);
      }
    };

    const handleLogout = () => {
      try {
        onLogout?.();
      } catch (error) {
        console.error('Error logging out:', error);
      }
    };

    // Handle button key events
    const handleButtonKeyDown = (
      event: React.KeyboardEvent,
      action: () => void
    ) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        action();
      } else if (event.key === 'Tab') {
        // Handle focus trap on buttons
        const focusableElements = dialogRef.current?.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );

        if (focusableElements && focusableElements.length > 1) {
          const firstElement = focusableElements[0] as HTMLElement;
          const lastElement = focusableElements[
            focusableElements.length - 1
          ] as HTMLElement;

          if (event.shiftKey && document.activeElement === firstElement) {
            event.preventDefault();
            lastElement.focus();
          } else if (
            !event.shiftKey &&
            document.activeElement === lastElement
          ) {
            event.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    if (!isVisible) {
      return null;
    }

    return (
      <div className="admin-timeout-overlay">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="timeout-warning-title"
          aria-describedby="timeout-warning-description"
          className={`admin-timeout-warning ${isCritical ? 'critical' : 'warning'} responsive`}
          onKeyDown={handleKeyDown}
        >
          <div className="timeout-warning-header">
            <div className="timeout-warning-icon">
              {isCritical ? (
                <span data-testid="critical-icon" className="icon-critical">
                  ⚠️
                </span>
              ) : (
                <span data-testid="warning-icon" className="icon-warning">
                  ⏰
                </span>
              )}
            </div>
            <h2 id="timeout-warning-title" className="timeout-warning-title">
              Session Timeout Warning
            </h2>
          </div>

          <div className="timeout-warning-content">
            <p
              id="timeout-warning-description"
              className="timeout-warning-description"
            >
              Your admin session will expire in{' '}
              <span className={`countdown ${isCritical ? 'critical' : ''}`}>
                {safeRemainingSeconds} {secondsText}
              </span>
              . Would you like to extend your session or logout now?
            </p>
          </div>

          <div className="timeout-warning-actions">
            <button
              ref={extendButtonRef}
              type="button"
              className="btn btn-primary extend-session-btn"
              onClick={handleExtendSession}
              onKeyDown={(e) => handleButtonKeyDown(e, handleExtendSession)}
              aria-label="Extend admin session"
            >
              Extend Session
            </button>
            <button
              type="button"
              className="btn btn-secondary logout-btn"
              onClick={handleLogout}
              onKeyDown={(e) => handleButtonKeyDown(e, handleLogout)}
              aria-label="Logout now"
            >
              Logout Now
            </button>
          </div>
        </div>
      </div>
    );
  }
);

AdminTimeoutWarning.displayName = 'AdminTimeoutWarning';
