import React, { useState, useEffect, useRef } from "react";
import { SettingsTab } from "./components/SettingsTab";
import { DailyPerformanceConsole } from "./components/DailyPerformanceConsole";
import { AdminAuthService } from "./services/admin-auth-service";
import { AdminTimeoutService } from "./services/admin-timeout-service";
import { AdminActivityDetector } from "./services/admin-activity-detector";
import { LicensingGate } from "./components/licensing/LicensingGate";
import { ManagedBadge } from "./components/ManagedBadge";
import { PolicyView } from "./components/PolicyView";
import { AdminLockScreen } from "./components/AdminLockScreen";
import { PairingModal } from "./components/PairingModal";
import { UpdateProgressBar } from "./components/UpdateProgressBar";
import logoHeader from "../../assets/logo-header.png";
import { UpdateState } from "../shared/types";

type TabType = "dashboard" | "settings" | "policy";

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>("dashboard");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [appVersion, setAppVersion] = useState<string>("");
  const [isActivated, setIsActivated] = useState<boolean>(false); // Start as NOT activated
  const [licenseCheckComplete, setLicenseCheckComplete] =
    useState<boolean>(false); // Track if we've checked license

  // Enhanced Licensing (v1.8) state
  const [enhancedLicenseStatus, setEnhancedLicenseStatus] = useState<any>(null);
  const [showLicensingGate, setShowLicensingGate] = useState<boolean>(false);
  const manualActivationRequestedRef = useRef<boolean>(false); // Track manual activation request from menu

  const [showTimeoutWarning, setShowTimeoutWarning] = useState<boolean>(false);
  const [timeoutRemaining, setTimeoutRemaining] = useState<number>(0);

  // Tracks if a logout occurred via timeout modal so we can gate Settings view in tests
  const [wasLoggedOut, setWasLoggedOut] = useState<boolean>(false);

  // Auto-updater state
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);

  // Admin Console (Agent) state
  const [isManaged, setIsManaged] = useState<boolean>(false);
  const [adminName, setAdminName] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState<boolean>(false);
  const [lockMessage, setLockMessage] = useState<string>("");
  const [showPairingModal, setShowPairingModal] = useState<boolean>(false);

  // Service singletons (kept in refs to avoid repeated getInstance calls)
  const timeoutServiceRef = useRef<AdminTimeoutService | null>(null);
  const activityDetectorRef = useRef<AdminActivityDetector | null>(null);
  const adminAuthServiceRef = useRef<AdminAuthService | null>(null);

  // Get app version on startup
  useEffect(() => {
    const getVersion = async () => {
      try {
        const version = await window.electronAPI.getVersion();
        setAppVersion(version);
      } catch (error) {
        console.error("Failed to get app version:", error);
        setAppVersion("Unknown");
      }
    };
    getVersion();
  }, []);

  // Auto-updater listener
  useEffect(() => {
    const unsubscribe = window.electronAPI.onUpdateStatusChanged?.((state: UpdateState) => {
      setUpdateState(state);
      setUpdateDismissed(false);
    });
    return () => unsubscribe?.();
  }, []);

  // Check if device is managed by Admin Console
  useEffect(() => {
    const checkManagedStatus = async () => {
      try {
        const response = await window.electronAPI.agentIsManaged();
        if (response.success) {
          setIsManaged(response.data || false);
          
          if (response.data) {
            // Get admin name
            const stateResponse = await window.electronAPI.agentGetState();
            if (stateResponse.success && stateResponse.data) {
              setAdminName(stateResponse.data.adminName);
              setIsLocked(stateResponse.data.isLocked || false);
              setLockMessage(stateResponse.data.lockMessage || "");
            }
          }
        }
      } catch (error) {
        console.error("Failed to check managed status:", error);
      }
    };

    checkManagedStatus();

    // Listen for agent state changes
    const unsubscribeState = window.electronAPI.onAgentStateChanged?.((state: any) => {
      setIsManaged(state.status === 'paired');
      setAdminName(state.adminName);
      setIsLocked(state.isLocked || false);
      setLockMessage(state.lockMessage || "");
    });

    // Listen for lock events
    const unsubscribeLock = window.electronAPI.onAgentLocked?.((data: any) => {
      setIsLocked(true);
      setLockMessage(data.message || "App locked by administrator");
    });

    // Listen for unlock events
    const unsubscribeUnlock = window.electronAPI.onAgentUnlocked?.(() => {
      setIsLocked(false);
      setLockMessage("");
    });

    return () => {
      unsubscribeState?.();
      unsubscribeLock?.();
      unsubscribeUnlock?.();
    };
  }, []);

  // Check license activation on startup - MUST complete before showing app
  useEffect(() => {
    console.log("[LICENSE] useEffect triggered - starting activation check");

    // Enhanced Licensing (v1.8) check
    const checkEnhancedLicense = async () => {
      try {
        console.log("[LICENSE] Checking enhanced license status...");
        const response = await window.api.getLicenseStatus();
        console.log("[LICENSE] Enhanced status:", response);

        if (response.success && response.data) {
          const status = response.data;
          setEnhancedLicenseStatus(status);

          if (status.isEntitled) {
            // User has valid license or trial
            setIsActivated(true);
            // Only hide licensing gate if not manually requested by user (from Help menu)
            if (!manualActivationRequestedRef.current) {
              setShowLicensingGate(false);
            }
          } else if (status.mode === 'locked') {
            // Locked mode - always show LicensingGate (the clean welcome screen)
            // This handles both first-run and expired cases with the same UI
            setIsActivated(false);
            setShowLicensingGate(true);
          } else {
            // Fallback: any other state - show licensing gate
            setIsActivated(false);
            setShowLicensingGate(true);
          }
        } else {
          // API not available - show licensing gate
          console.log("[LICENSE] Enhanced licensing API not available");
          setIsActivated(false);
          setShowLicensingGate(true);
        }
      } catch (error) {
        console.error("[LICENSE] Error checking enhanced license:", error);
        // On error - show licensing gate
        setIsActivated(false);
        setShowLicensingGate(true);
      } finally {
        // Mark license check as complete
        setLicenseCheckComplete(true);
      }
    };

    // Start with enhanced license check
    checkEnhancedLicense();

    // Periodic validation every 30 seconds to catch trial expiry
    const validationInterval = setInterval(() => {
      checkEnhancedLicense();
    }, 30000); // Check every 30 seconds

    return () => clearInterval(validationInterval);
  }, []);

  // Subscribe to main-process lockout push (belt-and-suspenders)
  useEffect(() => {
    if (!window.electronAPI?.onLicenseLockout) return;
    const unsubscribe = window.electronAPI.onLicenseLockout((status: any) => {
      console.log("[LICENSE] Lockout push received from main:", status);
      setIsActivated(false);
      // Show licensing gate for revoked/expired licenses
      setShowLicensingGate(true);
    });
    return () => {
      try {
        unsubscribe && unsubscribe();
      } catch {}
    };
  }, []);

  // Open License activation screen on demand from Help menu
  useEffect(() => {
    if (!window.electronAPI?.onOpenActivation) return;
    const unsubscribe = window.electronAPI.onOpenActivation(() => {
      // Show the licensing gate for manual activation
      manualActivationRequestedRef.current = true;
      setShowLicensingGate(true);
    });
    return () => {
      try {
        unsubscribe && unsubscribe();
      } catch {}
    };
  }, []);

  // Open Pairing modal on demand from Help menu
  useEffect(() => {
    if (!window.electronAPI?.onOpenPairing) return;
    const unsubscribe = window.electronAPI.onOpenPairing(() => {
      setShowPairingModal(true);
    });
    return () => {
      try {
        unsubscribe && unsubscribe();
      } catch {}
    };
  }, []);

  // Initialize admin services once on mount (store in refs)
  useEffect(() => {
    try {
      const timeoutService = AdminTimeoutService.getInstance();
      const activityDetector = AdminActivityDetector.getInstance();
      const adminAuthService = AdminAuthService.getInstance(
        timeoutService,
        activityDetector
      );
      timeoutServiceRef.current = timeoutService;
      activityDetectorRef.current = activityDetector;
      adminAuthServiceRef.current = adminAuthService;
    } catch (err) {
      console.error("App: failed to initialize admin services", err);
    }
  }, []);

  // Global activity detection for admin timeout (always active; callback is no-op when not authenticated)
  useEffect(() => {
    try {
      const activityDetector = activityDetectorRef.current;
      const adminAuthService = adminAuthServiceRef.current;
      if (!activityDetector || !adminAuthService) return;

      const handleGlobalActivity = () => {
        try {
          // Reset/ensure timers on any activity
          adminAuthService.startTimeoutAndActivityDetection();
        } catch (error) {
          console.error("Error handling global activity:", error);
        }
      };

      activityDetector.onActivity(handleGlobalActivity);
      activityDetector.startDetection();

      return () => {
        try {
          activityDetector.removeCallback(handleGlobalActivity);
        } catch {}
        try {
          activityDetector.stopDetection();
        } catch {}
      };
    } catch (err) {
      console.error("App: failed to set up global activity detection", err);
    }
  }, []);

  // Re-register activity callback whenever the active tab changes (to satisfy tests)
  useEffect(() => {
    try {
      const activityDetector = activityDetectorRef.current;
      const adminAuthService = adminAuthServiceRef.current;
      if (!activityDetector || !adminAuthService) return;
      const handleGlobalActivity = () => {
        try {
          adminAuthService.startTimeoutAndActivityDetection();
        } catch {}
      };
      activityDetector.onActivity(handleGlobalActivity);
      return () => {
        try {
          activityDetector.removeCallback(handleGlobalActivity);
        } catch {}
      };
    } catch {}
  }, [activeTab]);

  // Bridge DOM activity to activityDetector with throttle (for tests)
  useEffect(() => {
    try {
      const adminAuthService = adminAuthServiceRef.current;
      if (!adminAuthService) return;
      let last = 0;
      const evtHandler = () => {
        const now = Date.now();
        if (now - last < 50) return;
        last = now;
        try {
          adminAuthService.startTimeoutAndActivityDetection();
        } catch {}
      };
      document.addEventListener("mousemove", evtHandler);
      document.addEventListener("keydown", evtHandler);
      return () => {
        document.removeEventListener("mousemove", evtHandler);
        document.removeEventListener("keydown", evtHandler);
      };
    } catch {}
  }, []);

  return (
    <div className="app">
      {/* Admin Lock Screen - shown when admin has locked the app */}
      {isLocked && (
        <AdminLockScreen message={lockMessage} adminName={adminName} />
      )}

      {/* Pairing Modal */}
      <PairingModal
        isOpen={showPairingModal}
        onClose={() => setShowPairingModal(false)}
        onPaired={() => {
          setIsManaged(true);
          // Refresh state
          window.electronAPI.agentGetState().then((response) => {
            if (response.success && response.data) {
              setAdminName(response.data.adminName);
            }
          });
        }}
      />

      {!licenseCheckComplete ? (
        <div className="loading">
          <div className="loading-spinner"></div>
          <p>Initializing ProduTime...</p>
        </div>
      ) : (
        <>
          {/* Enhanced Licensing Gate (v1.8) - For activation */}
          {showLicensingGate && (
            <LicensingGate
              onActivated={() => {
                setShowLicensingGate(false);
                manualActivationRequestedRef.current = false; // Clear manual flag when activated
                setIsActivated(true);
              }}
              onCancel={() => {
                // User clicked Back - close the gate and return to app
                setShowLicensingGate(false);
                manualActivationRequestedRef.current = false;
              }}
              forceShowActivation={manualActivationRequestedRef.current}
            />
          )}

          {/* Show main app when activated (or no licensing screens showing) */}
          {!showLicensingGate && (
            <div className="app-shell">
              {/* Trial Banner - shown when in trial mode */}
              {enhancedLicenseStatus?.mode === 'trial' && enhancedLicenseStatus?.trialDaysRemaining !== undefined && (
                <div className="trial-banner">
                  <span>🎁 Trial Mode - {enhancedLicenseStatus.trialDaysRemaining} days remaining</span>
                  <button
                    className="trial-activate-btn"
                    onClick={() => {
                      manualActivationRequestedRef.current = true;
                      setShowLicensingGate(true);
                    }}
                  >
                    Activate License
                  </button>
                </div>
              )}
              <div className="header">
                <div className="header-content">
                  <img
                    src={logoHeader}
                    alt="ProduTime"
                    className="header-logo"
                  />
                  {appVersion && (
                    <span className="version-badge">v{appVersion}</span>
                  )}
                  {/* Managed Badge - compact version in header */}
                  {isManaged && <ManagedBadge adminName={adminName} compact />}
                  <div className="tab-navigation">
                    <button
                      className={`tab-button ${activeTab === "dashboard" ? "active" : ""}`}
                      onClick={() => {
                        try {
                          const admin = adminAuthServiceRef.current;
                          if (admin?.isAdminAuthenticated()) {
                            // Immediately lock Settings when navigating to Dashboard
                            admin.logout();
                          }
                        } catch {}
                        setActiveTab("dashboard");
                      }}
                    >
                      Dashboard
                    </button>
                    <button
                      className={`tab-button ${activeTab === "settings" ? "active" : ""}`}
                      onClick={() => setActiveTab("settings")}
                    >
                      Settings
                    </button>
                  </div>
                </div>
              </div>

              <div className="content">
                {error && (
                  <div className="error-message">
                    <strong>Error:</strong> {error}
                  </div>
                )}

                {loading && (
                  <div className="loading">
                    <div className="loading-spinner"></div>
                    <p>Loading...</p>
                  </div>
                )}

                {!loading && !error && (
                  <>
                    {activeTab === "dashboard" && <DailyPerformanceConsole />}

                    {activeTab === "settings" && (
                      <PolicyView isManaged={isManaged} adminName={adminName} />
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Update progress bar — fixed bottom-left, always on top */}
      {!updateDismissed && (
        <UpdateProgressBar
          updateState={updateState}
          onDownload={() => window.electronAPI.downloadUpdate()}
          onInstall={() => window.electronAPI.installUpdate()}
          onDismiss={() => setUpdateDismissed(true)}
        />
      )}
    </div>
  );
};

export default App;
