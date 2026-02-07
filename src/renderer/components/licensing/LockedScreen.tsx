import React, { useState, useEffect } from 'react';
import './LockedScreen.css';

interface LicenseStatus {
  mode: 'trial' | 'activated' | 'locked';
  isEntitled: boolean;
  trialDaysRemaining: number | null;
  error: string | null;
}

interface LockedScreenProps {
  onUnlocked: () => void;
}

export const LockedScreen: React.FC<LockedScreenProps> = ({ onUnlocked }) => {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [licenseKey, setLicenseKey] = useState('');
  const [activationError, setActivationError] = useState('');
  const [activating, setActivating] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    checkLicenseStatus();
    // Check license status every 30 seconds
    const interval = setInterval(checkLicenseStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const checkLicenseStatus = async () => {
    try {
      const response = await window.api.getLicenseStatus();

      if (response.success && response.data) {
        setStatus(response.data);

        // If license is now valid, unlock
        if (response.data.isEntitled) {
          onUnlocked();
        }
      }
    } catch (error: any) {
      console.error('Error checking license:', error);
    } finally {
      setChecking(false);
    }
  };

  const handleActivate = async () => {
    if (!licenseKey.trim()) {
      setActivationError('Please enter a license key');
      return;
    }

    try {
      setActivating(true);
      setActivationError('');

      const response = await window.api.activateLicense(licenseKey);

      if (response.success && response.data && response.data.success) {
        // Activation successful, recheck status
        await checkLicenseStatus();
      } else {
        setActivationError((response.data && response.data.error) || response.error || 'Activation failed');
      }
    } catch (error: any) {
      console.error('Error activating license:', error);
      setActivationError(error.message);
    } finally {
      setActivating(false);
    }
  };

  if (checking && !status) {
    return (
      <div className="locked-screen">
        <div className="locked-card">
          <div className="loading-spinner"></div>
          <p>Checking license status...</p>
        </div>
      </div>
    );
  }

  const getLockReason = () => {
    if (!status) return 'License verification failed';

    if (status.mode === 'trial' && status.trialDaysRemaining !== null && status.trialDaysRemaining <= 0) {
      return 'Your 7-day trial has expired';
    }

    if (status.mode === 'locked') {
      return status.error || 'License is no longer valid';
    }

    return 'License verification failed';
  };

  return (
    <div className="locked-screen">
      <div className="locked-card">
        <div className="lock-icon">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>

        <div className="lock-header">
          <h1>ProduTime Locked</h1>
          <p className="lock-reason">{getLockReason()}</p>
        </div>

        <div className="activation-section">
          <p className="activation-prompt">
            Enter a valid license key to continue using ProduTime.
          </p>

          <div className="form-group">
            <label htmlFor="license-key">License Key</label>
            <input
              id="license-key"
              type="text"
              className="license-input"
              placeholder="PT1-XXXXXXXXXXXXXXXX..."
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value)}
              disabled={activating}
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  handleActivate();
                }
              }}
            />
          </div>

          {activationError && (
            <div className="error-message">
              {activationError}
            </div>
          )}

          <button
            className="btn-activate"
            onClick={handleActivate}
            disabled={activating || !licenseKey.trim()}
          >
            {activating ? 'Activating...' : 'Activate License'}
          </button>
        </div>

        <div className="help-section">
          <p>Need help? Contact support for assistance.</p>
          <p className="status-info">
            Status: <strong>{status?.mode || 'Unknown'}</strong>
            {status && status.trialDaysRemaining !== null && status.trialDaysRemaining > 0 && (
              <span> • Trial days remaining: {status.trialDaysRemaining}</span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
};
