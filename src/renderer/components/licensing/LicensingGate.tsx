import React, { useState, useEffect } from 'react';
import './LicensingGate.css';
import logoHeader from '../../../../assets/logo-header.png';

interface LicenseStatus {
  mode: 'trial' | 'activated' | 'locked';
  isEntitled: boolean;
  trialDaysRemaining: number | null;
  error: string | null;
}

interface LicensingGateProps {
  onActivated: () => void;
  onCancel?: () => void; // Called when user clicks Back during manual activation (to return to app)
  forceShowActivation?: boolean; // When true, show activation form even if user is entitled (for upgrading from trial)
}

export const LicensingGate: React.FC<LicensingGateProps> = ({ onActivated, onCancel, forceShowActivation = false }) => {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [showActivation, setShowActivation] = useState(forceShowActivation); // Start with activation form if forced
  const [licenseKey, setLicenseKey] = useState('');
  const [activationError, setActivationError] = useState('');
  const [activating, setActivating] = useState(false);

  useEffect(() => {
    checkLicenseStatus();
  }, []);

  const checkLicenseStatus = async () => {
    try {
      setLoading(true);
      const response = await window.api.getLicenseStatus();

      if (response.success && response.data) {
        setStatus(response.data);

        // If already entitled and not forcing activation, proceed to app
        if (response.data.isEntitled && !forceShowActivation) {
          onActivated();
        }
      } else {
        setStatus({
          mode: 'locked',
          isEntitled: false,
          trialDaysRemaining: null,
          error: response.error || 'Failed to check license status',
        });
      }
    } catch (error: any) {
      console.error('Error checking license:', error);
      setStatus({
        mode: 'locked',
        isEntitled: false,
        trialDaysRemaining: null,
        error: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleStartTrial = async () => {
    try {
      setLoading(true);
      setActivationError('');

      const response = await window.api.startTrial();

      if (response.success && response.data && response.data.success) {
        // Refresh status and proceed
        await checkLicenseStatus();
        onActivated();
      } else {
        setActivationError((response.data && response.data.error) || response.error || 'Failed to start trial');
      }
    } catch (error: any) {
      console.error('Error starting trial:', error);
      setActivationError(error.message);
    } finally {
      setLoading(false);
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
        // Activation successful
        await checkLicenseStatus();
        onActivated();
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

  if (loading && !status) {
    return (
      <div className="licensing-gate">
        <div className="licensing-card">
          <div className="loading-spinner"></div>
          <p>Checking license status...</p>
        </div>
      </div>
    );
  }

  if (!status) {
    return null;
  }

  // If locked OR forcing activation (user wants to upgrade from trial), show activation UI
  if (status.mode === 'locked' || !status.isEntitled || forceShowActivation) {
    // When forcing activation from trial, always show the activation form
    const shouldShowActivationForm = showActivation || (forceShowActivation && status.isEntitled);
    
    return (
      <div className="licensing-gate">
        <div className="licensing-card">
          <div className="logo-section">
            <img src={logoHeader} alt="ProduTime" className="logo-image" />
          </div>

          {!shouldShowActivationForm ? (
            <>
              <div className="welcome-section">
                <h2>Welcome to ProduTime</h2>
                <p>Get started with a 7-day free trial or activate with a license key.</p>
              </div>

              {activationError && (
                <div className="error-message">
                  {activationError}
                </div>
              )}

              <div className="action-buttons">
                <button
                  className="btn-primary"
                  onClick={handleStartTrial}
                  disabled={loading}
                >
                  {loading ? 'Starting Trial...' : 'Start 7-Day Free Trial'}
                </button>

                <button
                  className="btn-secondary"
                  onClick={() => setShowActivation(true)}
                >
                  I Have a License Key
                </button>
              </div>

              {status.error && (
                <div className="error-details">
                  {status.error}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="activation-section">
                <h2>Activate ProduTime</h2>
                <p>Enter your license key to activate.</p>

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

                <div className="action-buttons">
                  <button
                    className="btn-primary"
                    onClick={handleActivate}
                    disabled={activating || !licenseKey.trim()}
                  >
                    {activating ? 'Activating...' : 'Activate'}
                  </button>

                  <button
                    className="btn-secondary"
                    onClick={() => {
                      // If this was opened from menu (forceShowActivation), close the gate entirely
                      if (forceShowActivation && onCancel) {
                        onCancel();
                      } else {
                        setShowActivation(false);
                        setActivationError('');
                        setLicenseKey('');
                      }
                    }}
                    disabled={activating}
                  >
                    Back
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // If we reach here, user is entitled (should not render, onActivated should have been called)
  return null;
};
