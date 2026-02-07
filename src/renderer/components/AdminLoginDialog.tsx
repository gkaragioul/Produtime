import React, { useState, useEffect } from 'react';
import { AdminAuthService } from '../services/admin-auth-service';
import { AdminTimeoutService } from '../services/admin-timeout-service';
import { AdminActivityDetector } from '../services/admin-activity-detector';
import { AdminLoginResponse } from '../../shared/types';

interface AdminLoginDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const AdminLoginDialog: React.FC<AdminLoginDialogProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [isLocked, setIsLocked] = useState(false);
  const [lockoutRemaining, setLockoutRemaining] = useState<number>(0);

  // Initialize services defensively to avoid crashing tests when mocks throw
  const [adminAuthService, setAdminAuthService] =
    useState<AdminAuthService | null>(null);

  useEffect(() => {
    try {
      const timeoutService = AdminTimeoutService.getInstance();
      const activityDetector = AdminActivityDetector.getInstance();
      const auth = AdminAuthService.getInstance(
        timeoutService,
        activityDetector
      );
      setAdminAuthService(auth);
    } catch (err) {
      console.warn(
        'AdminLoginDialog: service initialization failed; continuing without services',
        err
      );
      setAdminAuthService(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const checkLockout = async () => {
      try {
        if (!adminAuthService) return;
        console.log('🔧 [DEBUG] AdminLoginDialog: Checking lockout status...');
        const locked = await adminAuthService.isLockedOut();
        console.log('🔧 [DEBUG] AdminLoginDialog: Lockout status:', locked);
        if (!cancelled) setIsLocked(locked);
        if (locked && !cancelled) {
          setError('Account is locked. Please try again later.');
          try {
            const seconds = await adminAuthService.getLockoutTimeRemaining();
            console.log(
              '🔧 [DEBUG] AdminLoginDialog: Lockout remaining seconds:',
              seconds
            );
            if (!cancelled) setLockoutRemaining(seconds);
          } catch (error) {
            console.log(
              '🔧 [DEBUG] AdminLoginDialog: Error getting lockout time:',
              error
            );
          }
        }
      } catch (error) {
        console.log(
          '🔧 [DEBUG] AdminLoginDialog: Error checking lockout:',
          error
        );
      }
    };

    if (isOpen) {
      console.log(
        '🔧 [DEBUG] AdminLoginDialog: Dialog opened, resetting state...'
      );
      setPassword('');
      setError('');
      setIsLocked(false); // Reset to false initially to prevent UI blocking
      checkLockout();
    }
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // Tick countdown while locked
  useEffect(() => {
    if (!isOpen || !isLocked) return;
    const id = window.setInterval(() => {
      setLockoutRemaining((s) => Math.max(0, s - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [isOpen, isLocked]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    console.log('🔧 [DEBUG] AdminLoginDialog: Form submitted');

    if (!password.trim()) {
      setError('Please enter the admin password');
      return;
    }

    if (isLocked) {
      setError('Account is locked. Please try again later.');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      if (!adminAuthService) {
        setError('Admin services are unavailable');
        setIsLoading(false);
        return;
      }
      console.log('🔧 [DEBUG] AdminLoginDialog: Attempting login...');
      const result: AdminLoginResponse = await adminAuthService.login(password);
      console.log('🔧 [DEBUG] AdminLoginDialog: Login result:', result);

      if (result.success) {
        console.log('🔧 [DEBUG] AdminLoginDialog: Login successful');
        setPassword('');
        onSuccess();
        onClose();
      } else {
        console.log(
          '🔧 [DEBUG] AdminLoginDialog: Login failed, attempts:',
          result.failedAttempts
        );
        setFailedAttempts(result.failedAttempts);

        // Create appropriate error message based on attempt count
        let errorMessage = `Invalid password.`;
        if (result.failedAttempts === 3) {
          errorMessage += ' The administrator has been notified.';
        }

        setError(errorMessage);
        setPassword('');
        // Re-check lockout dynamically after failed attempt
        try {
          const nowLocked = await adminAuthService.isLockedOut();
          if (nowLocked) {
            setIsLocked(true);
            setError('Account is locked. Please try again later.');
          }
        } catch {}
      }
    } catch (error) {
      console.log('🔧 [DEBUG] AdminLoginDialog: Login error:', error);
      setError(`Login failed: ${error}`);
      setPassword('');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setPassword('');
    setError('');
    onClose();
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="admin-login-overlay">
      <div
        className="admin-login-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-login-title"
      >
        <div className="admin-login-header">
          <h2 id="admin-login-title">Admin Authentication Required</h2>
          <button
            className="close-button"
            onClick={handleClose}
            disabled={isLoading}
          >
            ×
          </button>
        </div>

        <div className="admin-login-content">
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="admin-password">Admin Password:</label>
              <input
                id="admin-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter admin password"
                disabled={isLoading || isLocked}
                autoFocus
                aria-invalid={!!error}
              />
            </div>

            {isLocked && (
              <div className="lockout-message" role="status">
                Account is locked
                {lockoutRemaining > 0
                  ? ` — Try again in ${lockoutRemaining}s`
                  : ''}
              </div>
            )}

            {error && <div className="error-message">{error}</div>}

            {failedAttempts > 0 && (
              <div className="attempts-warning">
                Failed attempts: {failedAttempts}
              </div>
            )}

            <div className="form-actions">
              <button
                type="submit"
                disabled={isLoading || isLocked}
                className="login-button"
              >
                {isLoading ? 'Authenticating...' : 'Login'}
              </button>
              {process.env.NODE_ENV !== 'production' && isLocked && (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      // Immediately reflect unlocked state for UX/tests
                      setIsLocked(false);
                      setError('');
                      setLockoutRemaining(0);
                      await adminAuthService?.resetLockout();
                      // Best-effort confirm
                      try {
                        const locked = await adminAuthService?.isLockedOut();
                        if (locked) setIsLocked(true);
                      } catch {}
                    } catch {}
                  }}
                >
                  Reset Lockout
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default AdminLoginDialog;
