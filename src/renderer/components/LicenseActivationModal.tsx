import React, { useState, useEffect } from 'react';
import './LicenseActivationModal.css';

interface LicenseActivationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onActivationSuccess: () => void;
  blockClose?: boolean; // If true, user cannot close modal (first-run activation)
  trialExpired?: boolean; // If true, show trial-ended messaging
}

export const LicenseActivationModal: React.FC<LicenseActivationModalProps> = ({
  isOpen,
  onClose,
  onActivationSuccess,
  blockClose = false,
  trialExpired = false,
}) => {
  const [licenseKey, setLicenseKey] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Load device ID when modal opens
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const loadDeviceId = async () => {
      try {
        const response = await window.electronAPI.getDeviceId();
        if (cancelled) return;
        if (response.success && response.data) {
          setDeviceId(response.data);
        } else {
          setError('Failed to get device ID');
        }
      } catch (err) {
        if (cancelled) return;
        console.error('Error loading device ID:', err);
        setError('Failed to load device information');
      }
    };
    loadDeviceId();
    return () => { cancelled = true; };
  }, [isOpen]);

  const handleOnlineActivation = async () => {
    setError('');
    setSuccess('');

    if (!licenseKey.trim()) {
      setError('Please enter a license key');
      return;
    }

    setIsLoading(true);

    try {
      const response = await window.electronAPI.activateLicense({
        licenseKey: licenseKey.trim(),
        deviceId,
      });

      if (response.success && response.data?.success) {
        setSuccess('License activated successfully!');
        setTimeout(() => {
          onActivationSuccess();
          handleClose();
        }, 1500);
      } else {
        const errorMsg =
          response.data?.error || response.error || 'Activation failed';
        setError(errorMsg);
      }
    } catch (err) {
      console.error('Activation error:', err);
      setError(`Activation failed: ${err}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartTrial = async () => {
    setError('');
    setSuccess('');
    setIsLoading(true);

    try {
      const response = await window.electronAPI.startTrial();

      if (response.success && response.data?.success) {
        setSuccess('7-day trial activated! Enjoy ProduTime!');
        setTimeout(() => {
          onActivationSuccess();
          handleClose();
        }, 1500);
      } else {
        setError(
          response.data?.error || response.error || 'Failed to start trial'
        );
      }
    } catch (err) {
      console.error('Trial activation error:', err);
      setError(`Failed to start trial: ${err}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    if (blockClose) {
      return; // Cannot close during first-run activation
    }
    setLicenseKey('');
    setError('');
    setSuccess('');
    onClose();
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="license-modal-overlay">
      <div
        className="license-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="license-modal-title"
      >
        <div className="license-modal-header">
          <h2 id="license-modal-title">
            {trialExpired
              ? 'Trial Finished — Activate to Continue'
              : blockClose
                ? 'Activate ProduTime'
                : 'License Activation'}
          </h2>
          {!blockClose && (
            <button
              className="close-button"
              onClick={handleClose}
              disabled={isLoading}
            >
              ×
            </button>
          )}
        </div>

        <div className="license-modal-content">
          {blockClose && (
            <div className="first-run-notice">
              <p>
                {trialExpired ? (
                  <>
                    Your ProduTime trial has ended. Please enter a license key
                    to continue.
                  </>
                ) : (
                  <>
                    <strong>Welcome to ProduTime!</strong> Please activate your
                    license to continue.
                  </>
                )}
              </p>
            </div>
          )}

          {/* License Key Input */}
          <div className="form-group">
            <label htmlFor="license-key">License Key *</label>
            <input
              id="license-key"
              type="text"
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value)}
              placeholder="Enter your license key"
              className="form-input"
              disabled={isLoading}
            />
          </div>

          {/* Error Message */}
          {error && (
            <div className="message error-message" role="alert">
              {error}
            </div>
          )}

          {/* Success Message */}
          {success && (
            <div className="message success-message" role="status">
              {success}
            </div>
          )}
        </div>

        <div className="license-modal-actions">
          <button
            className="btn btn-primary"
            onClick={handleOnlineActivation}
            disabled={isLoading || !licenseKey.trim()}
          >
            {isLoading ? 'Activating...' : 'Activate License'}
          </button>
        </div>

        {/* Trial Mode Option */}
        {blockClose && !trialExpired && (
          <div className="trial-mode-section">
            <div className="divider">
              <span>OR</span>
            </div>
            <p className="trial-info">
              Don't have a license key yet? Start a{' '}
              <strong>7-day free trial</strong>!
            </p>
            <button
              className="btn btn-trial"
              onClick={handleStartTrial}
              disabled={isLoading}
            >
              {isLoading ? 'Starting Trial...' : '🎉 Start 7-Day Free Trial'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
