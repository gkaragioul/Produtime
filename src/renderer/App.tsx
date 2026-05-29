import React, { useState, useEffect, useRef } from "react";
import { DailyPerformanceConsole } from "./components/DailyPerformanceConsole";
import { AdminAuthService } from "./services/admin-auth-service";
import { AdminTimeoutService } from "./services/admin-timeout-service";
import { AdminActivityDetector } from "./services/admin-activity-detector";
import { ManagedBadge } from "./components/ManagedBadge";
import { PolicyView } from "./components/PolicyView";
import { AdminLockScreen } from "./components/AdminLockScreen";
import { PairingModal } from "./components/PairingModal";
import { UpdateProgressBar } from "./components/UpdateProgressBar";
import { AutoUpdaterService } from "./services/auto-updater-service";
import logoHeader from "../../assets/logo-header.png";
import { UpdateState } from "../shared/types";

type TabType = "dashboard" | "settings";

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>("dashboard");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [appVersion, setAppVersion] = useState<string>("");
  // Auto-updater state
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [updateError, setUpdateError] = useState<string>("");

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

  // Auto-updater listener + initial state seed.
  // The seed call handles renderer reloads (F5, devtools refresh) — without
  // it, the main process keeps the DOWNLOADED state but the progress bar
  // stays blank until the next status event fires.
  useEffect(() => {
    const unsubscribe = window.electronAPI.onUpdateStatusChanged?.((state: UpdateState) => {
      setUpdateState(state);
      setUpdateDismissed(false);
    });
    AutoUpdaterService.getInstance()
      .syncCurrentState()
      .then((seeded) => {
        if (seeded) setUpdateState(seeded);
      })
      .catch(() => { /* swallowed — service logs already */ });
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

    // Listen for agent state changes.
    // IMPORTANT: Do NOT derive isManaged from connection status (paired/connecting/disconnected).
    // "Managed" means the device is paired — that's a persisted fact, not a live connection state.
    // Only update isManaged by re-checking the authoritative agentIsManaged() IPC.
    const unsubscribeState = window.electronAPI.onAgentStateChanged?.((state: any) => {
      // Re-check persisted pairing state — not the volatile connection status
      window.electronAPI.agentIsManaged().then((res) => {
        if (res.success) {
          setIsManaged(res.data || false);
        }
      }).catch(() => {});
      if (state.adminName) setAdminName(state.adminName);
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

      <div className="app-shell">
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

      {/* Update progress bar — fixed bottom-left, always on top.
          Callbacks route through AutoUpdaterService so failures surface
          instead of silently swallowing the rejection. */}
      {!updateDismissed && (
        <UpdateProgressBar
          updateState={updateState}
          errorMessage={updateError}
          onDownload={async () => {
            try {
              setUpdateError("");
              await AutoUpdaterService.getInstance().downloadUpdate();
            } catch (e) {
              setUpdateError(e instanceof Error ? e.message : String(e));
            }
          }}
          onInstall={async () => {
            try {
              setUpdateError("");
              await AutoUpdaterService.getInstance().installUpdate();
            } catch (e) {
              setUpdateError(e instanceof Error ? e.message : String(e));
            }
          }}
          onDismiss={() => setUpdateDismissed(true)}
          onRetry={async () => {
            try {
              setUpdateError("");
              await AutoUpdaterService.getInstance().checkForUpdates();
            } catch (e) {
              setUpdateError(e instanceof Error ? e.message : String(e));
            }
          }}
          onOpenReleasesPage={async () => {
            try {
              setUpdateError("");
              await AutoUpdaterService.getInstance().openReleasesPage();
            } catch (e) {
              setUpdateError(e instanceof Error ? e.message : String(e));
            }
          }}
        />
      )}
    </div>
  );
};

export default App;
