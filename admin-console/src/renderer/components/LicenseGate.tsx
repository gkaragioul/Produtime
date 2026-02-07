/**
 * License Gate Component
 * CRITICAL: Blocks access to Admin Console until license is validated
 * 
 * This component:
 * 1. Checks license status on mount
 * 2. Shows activation form OR trial option if not licensed
 * 3. Handles license revocation events
 * 4. Only renders children when licensed
 */

import React, { useState, useEffect, useCallback } from 'react';

interface LicenseStatus {
  licensed: boolean;
  reason?: string;
  features?: Record<string, boolean>;
  licenseId?: string;
  expiresAt?: string;
  warnings?: string[];
  machineHash?: string;
  trialDaysRemaining?: number;
  mode?: string;
}

interface LicenseGateProps {
  children: React.ReactNode;
}

export const LicenseGate: React.FC<LicenseGateProps> = ({ children }) => {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);
  const [startingTrial, setStartingTrial] = useState(false);
  const [licenseKey, setLicenseKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showActivationModal, setShowActivationModal] = useState(false);

  const checkLicense = useCallback(async () => {
    try {
      const licenseStatus = await window.adminAPI.getLicenseStatus();
      setStatus(licenseStatus);
      setError(null);
    } catch (err: any) {
      console.error('Failed to check license:', err);
      setError('Failed to check license status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkLicense();

    // Listen for license revocation
    const unsubRevoked = window.adminAPI.onLicenseRevoked((data) => {
      console.log('License revoked:', data.reason);
      setStatus({ licensed: false, reason: data.reason });
      setError(`License ${data.reason.toLowerCase().replace('_', ' ')}`);
    });

    // Listen for open activation from Help menu
    const unsubActivation = window.adminAPI.onOpenActivation?.(() => {
      console.log('Open activation requested from menu');
      setShowActivationModal(true);
    });

    return () => {
      unsubRevoked();
      unsubActivation?.();
    };
  }, [checkLicense]);

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!licenseKey.trim()) {
      setError('Please enter a license key');
      return;
    }

    setActivating(true);
    setError(null);

    try {
      const result = await window.adminAPI.activateLicense(licenseKey.trim());
      
      if (result.success) {
        await checkLicense();
        setLicenseKey('');
        setShowActivationModal(false);
      } else {
        setError(result.error || 'Activation failed');
      }
    } catch (err: any) {
      console.error('Activation error:', err);
      setError(err.message || 'Activation failed');
    } finally {
      setActivating(false);
    }
  };

  const handleStartTrial = async () => {
    setStartingTrial(true);
    setError(null);

    try {
      const result = await window.adminAPI.startTrial();
      
      if (result.success) {
        await checkLicense();
      } else {
        setError(result.error || 'Failed to start trial');
      }
    } catch (err: any) {
      console.error('Trial start error:', err);
      setError(err.message || 'Failed to start trial');
    } finally {
      setStartingTrial(false);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={styles.spinner} />
          <p style={styles.loadingText}>Checking license...</p>
        </div>
      </div>
    );
  }

  // Licensed or in trial - render children
  if (status?.licensed || status?.mode === 'trial') {
    return (
      <>
        {/* Show warnings banner if any */}
        {status.warnings && status.warnings.length > 0 && (
          <div style={styles.warningBanner}>
            ⚠️ {status.warnings.join(' | ')}
          </div>
        )}
        {/* Show trial banner if in trial */}
        {status.mode === 'trial' && status.trialDaysRemaining !== undefined && (
          <div style={styles.trialBanner}>
            <span>🎁 Trial Mode - {status.trialDaysRemaining} days remaining</span>
            <button
              onClick={() => setShowActivationModal(true)}
              style={styles.activateButton}
            >
              Activate License
            </button>
          </div>
        )}
        {/* Activation Modal */}
        {showActivationModal && (
          <div style={styles.modalOverlay} onClick={() => setShowActivationModal(false)}>
            <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
              <button 
                style={styles.closeButton}
                onClick={() => setShowActivationModal(false)}
              >
                ✕
              </button>
              <div style={styles.logo}>🔑</div>
              <h2 style={styles.modalTitle}>Activate License</h2>
              <p style={styles.modalSubtitle}>Enter your license key to unlock full features</p>
              
              <form onSubmit={handleActivate} style={styles.form}>
                <div style={styles.inputGroup}>
                  <label style={styles.label}>License Key</label>
                  <input
                    type="text"
                    value={licenseKey}
                    onChange={(e) => setLicenseKey(e.target.value)}
                    placeholder="PT1-xxxxx.xxxxx"
                    style={styles.input}
                    disabled={activating}
                    autoFocus
                  />
                </div>

                {error && (
                  <div style={styles.error}>
                    ❌ {error}
                  </div>
                )}

                <button
                  type="submit"
                  style={{
                    ...styles.button,
                    opacity: activating ? 0.7 : 1,
                  }}
                  disabled={activating}
                >
                  {activating ? 'Activating...' : 'Activate License'}
                </button>
              </form>
              
              <p style={styles.modalFooter}>
                Need a license? Visit{' '}
                <a 
                  href="https://produtime.app/pricing" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  style={styles.link}
                >
                  produtime.app/pricing
                </a>
              </p>
            </div>
          </div>
        )}
        {children}
      </>
    );
  }

  // Not licensed - show activation form with trial option
  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.logo}>🔐</div>
        <h1 style={styles.title}>ProduTime Admin Console</h1>
        <p style={styles.subtitle}>License Required</p>
        
        {status?.reason && (
          <p style={styles.reason}>{status.reason}</p>
        )}

        {/* Trial Option */}
        <div style={styles.trialSection}>
          <button
            onClick={handleStartTrial}
            style={{
              ...styles.trialButton,
              opacity: startingTrial ? 0.7 : 1,
            }}
            disabled={startingTrial}
          >
            {startingTrial ? 'Starting...' : '🎁 Start 7-Day Free Trial'}
          </button>
          <p style={styles.trialNote}>No credit card required</p>
        </div>

        <div style={styles.divider}>
          <span style={styles.dividerText}>or enter license key</span>
        </div>

        <form onSubmit={handleActivate} style={styles.form}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>License Key</label>
            <input
              type="text"
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value)}
              placeholder="PT1-xxxxx.xxxxx"
              style={styles.input}
              disabled={activating}
            />
          </div>

          {error && (
            <div style={styles.error}>
              ❌ {error}
            </div>
          )}

          <button
            type="submit"
            style={{
              ...styles.button,
              opacity: activating ? 0.7 : 1,
            }}
            disabled={activating}
          >
            {activating ? 'Activating...' : 'Activate License'}
          </button>
        </form>

        <div style={styles.footer}>
          <p style={styles.footerText}>
            Need a license? Visit{' '}
            <a 
              href="https://produtime.app/pricing" 
              target="_blank" 
              rel="noopener noreferrer"
              style={styles.link}
            >
              produtime.app/pricing
            </a>
          </p>
          {status?.machineHash && (
            <p style={styles.machineHash}>
              Machine ID: {status.machineHash.substring(0, 16)}...
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    backgroundColor: '#1a1a2e',
    padding: '20px',
  },
  card: {
    backgroundColor: '#16213e',
    borderRadius: '12px',
    padding: '40px',
    maxWidth: '450px',
    width: '100%',
    textAlign: 'center',
    boxShadow: '0 10px 40px rgba(0, 0, 0, 0.3)',
  },
  logo: {
    fontSize: '48px',
    marginBottom: '20px',
  },
  title: {
    color: '#fff',
    fontSize: '24px',
    fontWeight: 600,
    margin: '0 0 8px 0',
  },
  subtitle: {
    color: '#888',
    fontSize: '14px',
    margin: '0 0 24px 0',
  },
  reason: {
    color: '#f39c12',
    fontSize: '13px',
    backgroundColor: 'rgba(243, 156, 18, 0.1)',
    padding: '10px 15px',
    borderRadius: '6px',
    marginBottom: '20px',
  },
  trialSection: {
    marginBottom: '20px',
  },
  trialButton: {
    width: '100%',
    padding: '16px 24px',
    fontSize: '16px',
    fontWeight: 600,
    backgroundColor: '#9b59b6',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  trialNote: {
    color: '#888',
    fontSize: '12px',
    marginTop: '8px',
    margin: '8px 0 0 0',
  },
  divider: {
    display: 'flex',
    alignItems: 'center',
    margin: '20px 0',
  },
  dividerText: {
    flex: 1,
    textAlign: 'center',
    color: '#666',
    fontSize: '12px',
    position: 'relative',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  inputGroup: {
    textAlign: 'left',
  },
  label: {
    display: 'block',
    color: '#aaa',
    fontSize: '12px',
    marginBottom: '6px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  input: {
    width: '100%',
    padding: '12px 16px',
    fontSize: '14px',
    fontFamily: 'monospace',
    backgroundColor: '#0f3460',
    border: '1px solid #1a4a7a',
    borderRadius: '6px',
    color: '#fff',
    outline: 'none',
    boxSizing: 'border-box',
  },
  error: {
    color: '#e74c3c',
    fontSize: '13px',
    backgroundColor: 'rgba(231, 76, 60, 0.1)',
    padding: '10px 15px',
    borderRadius: '6px',
    textAlign: 'left',
  },
  button: {
    padding: '14px 24px',
    fontSize: '16px',
    fontWeight: 600,
    backgroundColor: '#4CAF50',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  footer: {
    marginTop: '24px',
    paddingTop: '20px',
    borderTop: '1px solid #333',
  },
  footerText: {
    color: '#888',
    fontSize: '13px',
    margin: '0 0 8px 0',
  },
  link: {
    color: '#4CAF50',
    textDecoration: 'none',
  },
  machineHash: {
    color: '#555',
    fontSize: '11px',
    fontFamily: 'monospace',
    margin: 0,
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '3px solid #333',
    borderTopColor: '#4CAF50',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    margin: '0 auto 16px',
  },
  loadingText: {
    color: '#888',
    fontSize: '14px',
    margin: 0,
  },
  warningBanner: {
    backgroundColor: '#f39c12',
    color: '#000',
    padding: '8px 16px',
    fontSize: '13px',
    textAlign: 'center',
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
  },
  trialBanner: {
    backgroundColor: '#9b59b6',
    color: '#fff',
    padding: '8px 16px',
    fontSize: '13px',
    textAlign: 'center',
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '16px',
  },
  activateButton: {
    backgroundColor: '#fff',
    color: '#9b59b6',
    border: 'none',
    padding: '6px 16px',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
  },
  modalCard: {
    backgroundColor: '#16213e',
    borderRadius: '12px',
    padding: '40px',
    maxWidth: '420px',
    width: '90%',
    textAlign: 'center',
    boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5)',
    position: 'relative',
  },
  closeButton: {
    position: 'absolute',
    top: '12px',
    right: '12px',
    background: 'none',
    border: 'none',
    color: '#888',
    fontSize: '20px',
    cursor: 'pointer',
    padding: '4px 8px',
  },
  modalTitle: {
    color: '#fff',
    fontSize: '20px',
    fontWeight: 600,
    margin: '0 0 8px 0',
  },
  modalSubtitle: {
    color: '#888',
    fontSize: '13px',
    margin: '0 0 20px 0',
  },
  modalFooter: {
    color: '#888',
    fontSize: '12px',
    marginTop: '16px',
    margin: '16px 0 0 0',
  },
};

export default LicenseGate;
