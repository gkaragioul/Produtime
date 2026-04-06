// CRITICAL: Import startup logger FIRST - before anything else
// This captures crashes and startup issues even before Electron is ready
import { startupLogger, LOGS_DIRECTORY } from "./startup-logger";

startupLogger.info("Main process starting...");
startupLogger.info(`Executable: ${process.execPath}`);

import { app, BrowserWindow, dialog, Menu, shell, nativeImage } from "electron";
import * as path from "path";
import * as fs from "fs";

try { startupLogger.info(`App path: ${app?.getAppPath?.() || 'unknown'}`); } catch { /* app not ready yet */ }

// Override global error handlers to show user-friendly dialog with log location
process.on("uncaughtException", (err) => {
  startupLogger.crash(`UNCAUGHT EXCEPTION: ${err.message}`, err);
  try {
    dialog.showErrorBox(
      "Critical Startup Error",
      `ProduTime failed to start.\n\nError: ${err.message}\n\nPlease check logs at:\n${LOGS_DIRECTORY}`
    );
  } catch (dialogErr) {
    // Dialog may fail if display not available (headless/server mode)
    console.error("Failed to show error dialog:", dialogErr);
  }
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  startupLogger.crash("UNHANDLED REJECTION", reason);
});

startupLogger.info("Starting imports...");

import { logger } from "./logger";
startupLogger.info("Logger imported");

import type { DatabaseManager } from "./database";
startupLogger.info("DatabaseManager type imported");

import { IPCHandlers } from "./ipc-handlers";
startupLogger.info("IPCHandlers imported");

import type { AssistedUpdater } from "./assisted-updater";
startupLogger.info("AssistedUpdater type imported");


import type { PDFGenerator } from "./pdf-generator";
startupLogger.info("PDFGenerator type imported");

import { SystemTrayManager } from "./system-tray";
startupLogger.info("SystemTrayManager imported");

import { AutoExportScheduler } from "./services/auto-export-scheduler";
startupLogger.info("AutoExportScheduler imported");

import type { ActivityTracker } from "./services/activity-tracker";
startupLogger.info("ActivityTracker type imported");

import type { LicenseService } from "./services/license-service";
startupLogger.info("LicenseService type imported");

import type { EnhancedLicenseService } from "./services/licensing/EnhancedLicenseService";
startupLogger.info("EnhancedLicenseService type imported");

startupLogger.info("All imports complete");

startupLogger.info("Defining TimePortApp class...");

class TimePortApp {
  private mainWindow: BrowserWindow | null = null;
  private database: DatabaseManager | null = null;
  private ipcHandlers: IPCHandlers | null = null;
  private updater: AssistedUpdater | null = null;

  private pdfGenerator: PDFGenerator | null = null;
  private systemTray: SystemTrayManager | null = null;

  private activityTracker: ActivityTracker | null = null;
  private autoExportScheduler: any | null = null;
  private enhancedLicenseService: EnhancedLicenseService | null = null;

  // Timer for periodic heartbeat checks - needs to be cleaned up on app shutdown
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor() {
    startupLogger.info("TimePortApp constructor called");
    this.initializeApp();
  }

  private initializeApp(): void {
    // Set app name to prevent "electron.app.Electron" from appearing in notifications
    app.setName("ProduTime");
    // Set Windows AppUserModelID so notifications show "ProduTime" instead of "electron.app.Electron"
    app.setAppUserModelId("com.produtime.app");

    // Apply GPU / sandbox compatibility flags early, especially important on Windows / virtualized environments
    if (process.platform === "win32") {
      try {
        console.log("[APP] Applying Windows GPU compatibility flags");
        app.commandLine.appendSwitch("disable-gpu");
        app.commandLine.appendSwitch("no-sandbox");
        app.commandLine.appendSwitch("disable-gpu-sandbox");
        app.commandLine.appendSwitch(
          "disable-features",
          "CalculateNativeWinOcclusion,UseAngle"
        );
        app.commandLine.appendSwitch("use-angle", "swiftshader");
      } catch (e) {
        console.error("[APP] Failed to apply GPU compatibility flags", e);
      }
    }

    // Disable GPU acceleration to avoid white/blank window issues on some Windows setups
    app.disableHardwareAcceleration();

    console.log(
      "🚨 MAIN PROCESS STARTED - TIMESTAMP:",
      new Date().toISOString()
    );
    try {
      console.log("[ENV] NODE_ENV=", process.env.NODE_ENV);
      console.log("[ENV] argv[0..5]=", process.argv.slice(0, 6));
      console.log("[ENV] versions=", {
        electron: process.versions.electron,
        node: process.versions.node,
        chrome: process.versions.chrome,
      });
    } catch (err) {
      console.error('Failed to log startup info:', err);
    }

    // Additional lifecycle diagnostics
    app.on("will-finish-launching", () => {
      console.log("[APP] will-finish-launching");
    });
    app.once("ready", () => {
      console.log("[APP] ready event fired");
    });

    // Add a watchdog in case app.whenReady() never fires
    const readyWatchdog = setTimeout(() => {
      try {
        console.error(
          "[APP] TIMEOUT: app.whenReady() did not fire within 20 seconds"
        );
      } catch (err) {
        console.error('Failed to log readiness timeout:', err);
      }
    }, 20000);

    // Handle app ready
    app.whenReady().then(async () => {
      startupLogger.section("APP READY");
      startupLogger.info("Electron app.whenReady() resolved");
      clearTimeout(readyWatchdog);
      logger.section("APP READY");
      logger.info("APP", "Electron app ready event fired");

      // App ready - no dialog needed
      try {
        // Early initialization complete

        // Initialize database first
        startupLogger.info("Initializing database...");
        await this.initializeDatabase();
        startupLogger.info("Database initialized successfully");

        // Test database functionality
        await this.testDatabaseFunctionality();

        // Initialize IPC handlers EARLY to avoid renderer race
        startupLogger.info("Initializing IPC handlers (early)...");
        this.initializeIPC();

        // Create main window
        startupLogger.info("Creating main window...");
        this.createMainWindow();
        startupLogger.info("Main window created");

        // Initialize auto-updater (needs window)
        startupLogger.info("Initializing auto-updater...");
        await this.initializeAutoUpdater();

        // Initialize PDF generator (needs database)
        startupLogger.info("Initializing PDF generator...");
        await this.initializePDFGenerator();

        // Ensure auto-start is enabled (silently, no dialogs)
        this.ensureAutoStartEnabled();

        // Initialize system tray (needs window)
        startupLogger.info("Initializing system tray...");
        this.initializeSystemTray();

        // Initialize activity tracker (needs database and window)
        startupLogger.info("Initializing activity tracker...");
        await this.initializeActivityTracker();

        // Optional accuracy verification (dev-only): when TIMEPORT_REPORT_ACCURACY_FILE is set
        if (
          process.env.TIMEPORT_REPORT_ACCURACY_FILE &&
          this.pdfGenerator &&
          this.database
        ) {
          try {
            const rangesPath = process.env
              .TIMEPORT_REPORT_ACCURACY_FILE as string;
            const content = fs.readFileSync(rangesPath, "utf-8");
            const ranges: Array<{
              label?: string;
              startDate: string;
              endDate: string;
            }> = JSON.parse(content);
            const proofs: any[] = [];
            for (const r of ranges) {
              const label = r.label || `${r.startDate}..${r.endDate}`;
              const integrity = await this.pdfGenerator.verifyDataIntegrity({
                startDate: r.startDate,
                endDate: r.endDate,
              });
              const reportData = await this.pdfGenerator.getReportData({
                type: "custom" as any,
                format: "pdf" as any,
                dateRange: { startDate: r.startDate, endDate: r.endDate },
                includeCharts: true,
                includeSummary: true,
                includeDetails: false,
                useEnhancedAnalytics: true,
                title: `Accuracy Check ${label}`,
              } as any);
              proofs.push({
                label,
                integrity,
                report: {
                  workSchedule: reportData.workSchedule,
                  timeDistribution: reportData.timeDistribution,
                  topApplications: reportData.topApplications,
                  summary: reportData.summary,
                },
              });
            }
            const outDirPrimary = path.join(
              app.getPath("documents"),
              "ProduTime",
              "Reports"
            );
            const outDirFallback = path.join(
              app.getPath("documents"),
              "TimePort",
              "Reports"
            );
            const outDir = fs.existsSync(outDirPrimary)
              ? outDirPrimary
              : outDirFallback;
            try {
              if (!fs.existsSync(outDir))
                fs.mkdirSync(outDir, { recursive: true });
            } catch (err) {
              console.warn('Failed to create directory:', err);
            }
            const defaultOutPath = path.join(
              outDir,
              "report-accuracy-proof.json"
            );
            const outPath =
              process.env.TIMEPORT_REPORT_PROOF_OUT || defaultOutPath;
            fs.writeFileSync(
              outPath,
              JSON.stringify(
                { generatedAt: new Date().toISOString(), proofs },
                null,
                2
              )
            );
            console.log("[ACCURACY] Proof file written at:", outPath);
            // Exit after writing proof to avoid UI automation
            this.cleanup();
            app.quit();
            return;
          } catch (e) {
            console.error("[ACCURACY] Verification failed:", e);
          }
        }

        // Dev-only: one-shot Auto-Export parity proof when TIMEPORT_FORCE_AUTO_EXPORT is set
        if (
          process.env.TIMEPORT_FORCE_AUTO_EXPORT &&
          this.pdfGenerator &&
          this.database
        ) {
          try {
            const today = new Date();
            const y = today.getFullYear();
            const m = String(today.getMonth() + 1).padStart(2, "0");
            const d = String(today.getDate()).padStart(2, "0");
            const iso = `${y}-${m}-${d}`;

            // Prepare temporary export folder
            const defaultFolder = path.join(
              app.getPath("documents"),
              "ProduTime",
              "Reports",
              "AutoExportProof"
            );
            const exportFolder =
              process.env.TIMEPORT_AUTO_EXPORT_FOLDER || defaultFolder;
            if (!fs.existsSync(exportFolder))
              fs.mkdirSync(exportFolder, { recursive: true });

            // Snapshot old settings and apply temporary ones
            const oldEnabled =
              this.database.getSetting("auto_export_enabled") || "";
            const oldFolder = this.database.getSetting("export_folder") || "";
            this.database.setSetting("auto_export_enabled", "true");
            this.database.setSetting("export_folder", exportFolder);

            // Run auto-export once
            const scheduler = new AutoExportScheduler(
              this.database,
              this.pdfGenerator
            );
            const autoRes = await scheduler.forceExport();

            // Compute integrity and report for the same daily range
            const integrity = await this.pdfGenerator.verifyDataIntegrity({
              startDate: iso,
              endDate: iso,
            });
            const reportData = await this.pdfGenerator.getReportData({
              type: "daily" as any,
              format: "pdf" as any,
              dateRange: { startDate: iso, endDate: iso },
              includeCharts: true,
              includeSummary: true,
              includeDetails: true,
              useEnhancedAnalytics: true,
              title: `Auto-Export Parity ${iso}`,
            } as any);

            const proofs = [
              {
                label: `AutoExport-${iso}`,
                autoExportFilePath: autoRes?.filePath,
                integrity,
                report: {
                  workSchedule: reportData.workSchedule,
                  timeDistribution: reportData.timeDistribution,
                  topApplications: reportData.topApplications,
                  summary: reportData.summary,
                },
              },
            ];

            const outDirPrimary = path.join(
              app.getPath("documents"),
              "ProduTime",
              "Reports"
            );
            const outDirFallback = path.join(
              app.getPath("documents"),
              "TimePort",
              "Reports"
            );
            const outDir = fs.existsSync(outDirPrimary)
              ? outDirPrimary
              : outDirFallback;
            try {
              if (!fs.existsSync(outDir))
                fs.mkdirSync(outDir, { recursive: true });
            } catch (err) {
              console.warn('Failed to create directory:', err);
            }
            const defaultOutPath = path.join(
              outDir,
              "report-accuracy-autoexport-proof.json"
            );
            const outPath =
              process.env.TIMEPORT_REPORT_PROOF_OUT || defaultOutPath;
            fs.writeFileSync(
              outPath,
              JSON.stringify(
                { generatedAt: new Date().toISOString(), proofs },
                null,
                2
              )
            );
            console.log(
              "[AUTO-EXPORT ACCURACY] Proof file written at:",
              outPath
            );

            // Restore settings
            this.database.setSetting("auto_export_enabled", oldEnabled);
            this.database.setSetting("export_folder", oldFolder);

            this.cleanup();
            app.quit();
            return;
          } catch (e) {
            console.error("[AUTO-EXPORT ACCURACY] Verification failed:", e);
          }
        }

        // Start auto export scheduler BEFORE final IPC initialization
        startupLogger.info("Initializing auto-export scheduler...");
        this.initializeAutoExportScheduler();

        // Reinitialize/augment IPC if necessary now that all services exist
        startupLogger.info("Refreshing IPC handlers with all services...");
        this.initializeIPC();

        // Initialize agent service for Admin Console connectivity
        startupLogger.info("Initializing agent service...");
        await this.initializeAgentService();

        // Initialize application menu (Help → Check for Updates, About)
        startupLogger.info("Initializing application menu...");
        this.initializeApplicationMenu();

        startupLogger.section("STARTUP COMPLETE");
        startupLogger.info("All services initialized successfully");
        startupLogger.info(`Log file location: ${LOGS_DIRECTORY}`);

        // Optional: auto-generate today's report on startup for verification
        if (process.env.TIMEPORT_AUTO_GENERATE_ON_START === "1") {
          try {
            console.log("[PDF] Auto-generate on start is enabled");
            const today = new Date();
            const y = today.getFullYear();
            const m = String(today.getMonth() + 1).padStart(2, "0");
            const d = String(today.getDate()).padStart(2, "0");
            const iso = `${y}-${m}-${d}`;
            if (this.pdfGenerator) {
              const res = await this.pdfGenerator.generateReport({
                type: "daily" as any,
                format: "pdf" as any,
                dateRange: { startDate: iso, endDate: iso },
                includeCharts: true,
                includeSummary: true,
                includeDetails: true,
              });
              console.log("[PDF] Auto-generated report:", res);
            } else {
              console.warn(
                "[PDF] Auto-generate skipped: pdfGenerator not ready"
              );
            }
          } catch (e) {
            console.error("[PDF] Auto-generate on start failed:", e);
          }
        }

        // Test error handling and logging
        await this.testErrorHandlingAndLogging();

        // Test IPC functionality
        this.testIPCFunctionality();

        // On macOS, re-create window when dock icon is clicked
        app.on("activate", () => {
          if (BrowserWindow.getAllWindows().length === 0) {
            this.createMainWindow();
          }
        });
      } catch (error) {
        const err = error as any;
        startupLogger.crash("Failed to initialize app", err);
        this.showErrorAndExit(
          `App initialization failed: ${err?.message || err}\n\nCheck logs at: ${LOGS_DIRECTORY}`
        );
      }
    });

    // Quit when all windows are closed (except on macOS)
    app.on("window-all-closed", () => {
      if (process.platform !== "darwin") {
        startupLogger.info("All windows closed, quitting...");
        this.cleanup();
        app.quit();
      }
    });

    // Handle app before quit
    app.on("before-quit", () => {
      startupLogger.logShutdown("user requested quit");
      this.cleanup();
    });
  }

  private createMainWindow(): void {
    console.log(
      "🚨 CREATING MAIN WINDOW - TIMESTAMP:",
      new Date().toISOString()
    );

    // Get icon path - try multiple locations for dev and production (prefer ICO on Windows)
    let iconPath = path.join(process.resourcesPath, "assets", "icon.ico");
    if (!require("fs").existsSync(iconPath)) {
      iconPath = path.join(__dirname, "..", "..", "assets", "icon.ico");
    }
    if (!require("fs").existsSync(iconPath)) {
      iconPath = path.join(process.resourcesPath, "assets", "icon.png");
    }
    if (!require("fs").existsSync(iconPath)) {
      iconPath = path.join(__dirname, "..", "..", "assets", "icon.png");
    }
    console.log("Using icon path:", iconPath);

    // Create the browser window
    this.mainWindow = new BrowserWindow({
      width: 1280,
      height: 860,
      minWidth: 1200,
      minHeight: 800,
      useContentSize: true,
      center: true,
      title: "ProduTime",
      icon: iconPath,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: (() => {
          const preloadPath = path.join(__dirname, "preload.js");
          console.log("🔧 DEBUG: __dirname =", __dirname);
          console.log("🔧 DEBUG: preload path =", preloadPath);
          console.log(
            "🔧 DEBUG: preload exists =",
            require("fs").existsSync(preloadPath)
          );
          return preloadPath;
        })(),
      },
      show: false, // Don't show until ready
    });

    // Pipe renderer console messages to main process for verification in development
    this.mainWindow.webContents.on(
      "console-message",
      (_event, level, message, line, sourceId) => {
        const levels = ["LOG", "WARN", "ERROR"];
        const lvl = levels[level] || level;
        console.log(`[Renderer ${lvl}] ${message} (${sourceId}:${line})`);
      }
    );

    // Extra diagnostics for renderer stability and loading
    this.mainWindow.webContents.on(
      "did-fail-load",
      (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
        console.error("did-fail-load", {
          errorCode,
          errorDescription,
          validatedURL,
          isMainFrame,
        });
      }
    );
    this.mainWindow.webContents.on("render-process-gone", (_e, details) => {
      console.error("render-process-gone", details);
    });
    this.mainWindow.on("unresponsive", () => {
      console.error("Main window became unresponsive");
    });

    // Load the renderer (production mode only)
    const htmlPath = path.join(__dirname, "../renderer/index.html");
    const exists = require("fs").existsSync(htmlPath);
    console.log("[LOAD] index.html path:", htmlPath, "exists:", exists);
    if (!exists) {
      console.error("[LOAD] Missing renderer index.html at", htmlPath);
      const msg = encodeURIComponent(
        `Missing renderer index.html at: ${htmlPath}`
      );
      this.mainWindow.loadURL(`data:text/plain,${msg}`);
    } else {
      this.mainWindow
        .loadFile(htmlPath)
        .catch((err) => console.error("[LOAD] loadFile failed:", err));
    }

    // Show window when ready to prevent visual flash
    this.mainWindow.once("ready-to-show", () => {
      this.mainWindow?.maximize();
      this.mainWindow?.show();
      this.mainWindow?.focus();
      console.log("🪟 Main window shown, maximized, and focused");
    });

    // FALLBACK: If ready-to-show doesn't fire within 5 seconds, show anyway
    // This prevents the window from being hidden forever if renderer has issues
    setTimeout(() => {
      if (this.mainWindow && !this.mainWindow.isVisible()) {
        console.warn(
          "⚠️ ready-to-show event did not fire within 5s, showing window anyway"
        );
        this.mainWindow.show();
        this.mainWindow.focus();
      }
    }, 5000);

    // Handle window events for system tray integration
    this.mainWindow.on("close", (event) => {
      if (this.systemTray) {
        // Prevent closing, minimize to tray instead
        event.preventDefault();
        this.mainWindow?.hide();
        console.log("🔽 Window minimized to tray");
      }
    });

    this.mainWindow.on("closed", () => {
      this.mainWindow = null;
    });

    this.mainWindow.on("show", () => {
      if (this.systemTray) {
        this.systemTray.updateState({ isVisible: true });
      }
    });

    this.mainWindow.on("hide", () => {
      if (this.systemTray) {
        this.systemTray.updateState({ isVisible: false });
      }
    });
  }

  private async initializeDatabase(): Promise<void> {
    try {
      if (process.env.DIAGNOSTIC_SKIP_DB === "1") {
        console.warn("[DIAGNOSTIC] Skipping database initialization");
        return;
      }
      const { DatabaseManager } = await import("./database");
      this.database = new DatabaseManager();
      console.log("Database initialized successfully");

      // Ensure default settings for automatic exports
      const enabled = this.database.getSetting("auto_export_enabled");
      if (enabled == null)
        this.database.setSetting("auto_export_enabled", "true");
      const time = this.database.getSetting("auto_export_time");
      if (time == null) this.database.setSetting("auto_export_time", "18:00");

      // Initialize enhanced license service
      await this.initializeEnhancedLicenseService();
    } catch (error) {
      console.error("Database initialization error:", error);
      if (process.env.DIAGNOSTIC_CONTINUE_ON_DB_ERROR === "1") {
        console.warn("[DIAGNOSTIC] Continuing without database due to error");
        (this as any).database = null;
        return;
      }
      throw error;
    }
  }

  private async initializeEnhancedLicenseService(): Promise<void> {
    try {
      if (!this.database) {
        console.warn("[LICENSE] Skipping license service - no database");
        return;
      }
      console.log("[LICENSE] Initializing freeware license service (all features unlocked)");
      const { EnhancedLicenseService } = await import("./services/licensing/EnhancedLicenseService");
      this.enhancedLicenseService = EnhancedLicenseService.getInstance(this.database, "", "");
      await this.enhancedLicenseService.init();
      console.log("[LICENSE] Freeware license service ready");
    } catch (error) {
      console.error("[LICENSE] Failed to initialize license service:", error);
    }
  }

  private showErrorAndExit(message: string): void {
    dialog.showErrorBox("ProduTime Error", message);
    app.quit();
  }

  private async initializeAutoUpdater(): Promise<void> {
    if (!this.mainWindow) {
      startupLogger.warn("AssistedUpdater: no main window, skipping");
      return;
    }
    const { AssistedUpdater } = await import("./assisted-updater");
    this.updater = new AssistedUpdater(this.mainWindow, {
      manifestUrl: "https://wot-produtime-production.up.railway.app/updates/latest.json",
    });
    this.updater.startBackgroundChecks();

    // Register IPC handler for renderer "Check for Updates" button
    const { ipcMain } = await import("electron");
    ipcMain.handle("updater:checkForUpdates", async () => {
      try {
        await this.updater?.checkForUpdates(true);
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    });

    startupLogger.info("AssistedUpdater initialized with background checks");
  }

  private async ensureAutoStartEnabled(): Promise<void> {
    try {
      const { StartupHelper } = await import("./startup-helper");
      if (!StartupHelper.hasStartupShortcut()) {
        await StartupHelper.createStartupShortcut();
        console.log("[STARTUP] Auto-start enabled for ProduTime");
      }
    } catch (error) {
      console.warn("[STARTUP] Failed to enable auto-start:", error);
    }
  }

  private async initializePDFGenerator(): Promise<void> {
    if (process.env.DIAGNOSTIC_SKIP_PDF === "1") {
      console.warn("[DIAGNOSTIC] Skipping PDF generator initialization");
      return;
    }
    if (this.database) {
      const { PDFGenerator } = await import("./pdf-generator");
      this.pdfGenerator = new PDFGenerator(this.database);
      console.log("PDF generator initialized successfully");
    } else {
      throw new Error("Database must be initialized before PDF generator");
    }
  }

  private initializeAutoExportScheduler(): void {
    try {
      if (this.database && this.pdfGenerator) {
        if (this.autoExportScheduler) {
          this.autoExportScheduler.stop();
        }
        this.autoExportScheduler = new AutoExportScheduler(
          this.database,
          this.pdfGenerator,
          {
            checkIntervalMs: 60_000,
            logger: (...args: any[]) => console.log(...args),
          }
        );
        this.autoExportScheduler.start();
        console.log("Auto export scheduler started");
      }
    } catch (error) {
      console.error("Failed to initialize auto export scheduler:", error);
    }
  }

  /**
   * Initialize the Agent Service for Admin Console connectivity
   * This enables LAN-based management from an Admin Console
   */
  private async initializeAgentService(): Promise<void> {
    try {
      if (!this.ipcHandlers) {
        console.warn("[AGENT] Skipping agent service - IPC handlers not ready");
        return;
      }

      const appVersion = app.getVersion();
      await this.ipcHandlers.initializeAgentService(appVersion);
      console.log("[AGENT] Agent service initialized successfully");

      // Connect agent service state changes to system tray (Requirement 3.8, 9.3)
      // This displays "Managed by [Company Name]" indicator in system tray
      this.connectAgentServiceToSystemTray();
    } catch (error) {
      console.error("[AGENT] Failed to initialize agent service:", error);
      // Don't crash the app - agent service is optional
    }
  }

  /**
   * Connect agent service state changes to system tray
   * Requirement 3.8, 9.3: Display "Managed by [Company Name]" indicator
   */
  private connectAgentServiceToSystemTray(): void {
    try {
      if (!this.systemTray) {
        console.warn("[AGENT] System tray not available for managed status updates");
        return;
      }

      // Import AgentService to get the singleton instance
      import("./services/agent/agent-service").then(({ AgentService }) => {
        try {
          const agentService = AgentService.getInstance();

          // Update system tray with initial state
          const initialState = agentService.getState();
          const pairingState = agentService.getPairingState();
          this.updateSystemTrayManagedStatus(initialState, pairingState);

          // Listen for state changes
          agentService.on('stateChanged', (state: any) => {
            const currentPairingState = agentService.getPairingState();
            this.updateSystemTrayManagedStatus(state, currentPairingState);
          });

          // Listen for paired event
          agentService.on('paired', () => {
            const state = agentService.getState();
            const currentPairingState = agentService.getPairingState();
            this.updateSystemTrayManagedStatus(state, currentPairingState);
          });

          // Listen for unpaired event
          agentService.on('unpaired', () => {
            if (this.systemTray) {
              this.systemTray.updateManagedStatus(false, null, false);
            }
          });

          console.log("[AGENT] Connected agent service to system tray for managed status updates");
        } catch (err) {
          console.warn("[AGENT] Could not get agent service instance for system tray:", err);
        }
      }).catch((err) => {
        console.warn("[AGENT] Could not import agent service for system tray:", err);
      });
    } catch (error) {
      console.error("[AGENT] Failed to connect agent service to system tray:", error);
    }
  }

  /**
   * Update system tray managed status based on agent state
   */
  private updateSystemTrayManagedStatus(state: any, pairingState: any): void {
    if (!this.systemTray) return;

    const isManaged = pairingState?.paired === true;
    const managedByName = state?.tenantName || state?.adminName || pairingState?.tenantName || pairingState?.adminName || null;
    const isCloudConnection = state?.isCloudConnection === true;

    this.systemTray.updateManagedStatus(isManaged, managedByName, isCloudConnection);
  }

  private initializeApplicationMenu(): void {
    logger.section("APPLICATION MENU INITIALIZATION");
    logger.info("MENU", "Starting menu initialization");
    logger.debug("MENU", "Updater exists", { exists: !!this.updater });
    try {
      // Check if license is active to determine menu items
      let isLicenseActive = false;
      if (this.enhancedLicenseService) {
        const status = this.enhancedLicenseService.getStatus();
        isLicenseActive = status.mode === 'activated' || status.mode === 'trial';
      }

      // Build Help submenu dynamically based on license status
      const helpSubmenu: Electron.MenuItemConstructorOptions[] = [];

      // Only show "Enter License Key..." if not fully activated with a license key
      // Show it during trial so users can upgrade, hide only when activated
      const isFullyActivated = this.enhancedLicenseService?.getStatus()?.mode === 'activated';
      logger.info("MENU", `Building menu - isFullyActivated: ${isFullyActivated}`);
      if (!isFullyActivated) {
        helpSubmenu.push({
          label: "Enter License Key…",
          click: () => {
            logger.info("MENU", "Enter License Key clicked");
            try {
              if (!this.mainWindow) {
                logger.warn("MENU", "mainWindow is null, cannot send openActivation event");
                return;
              }
              if (this.mainWindow.isDestroyed()) {
                logger.warn("MENU", "mainWindow is destroyed, cannot send openActivation event");
                return;
              }
              logger.info("MENU", "Sending license:openActivation to renderer");
              this.mainWindow.webContents.send("license:openActivation");
              // Also bring window to front
              this.mainWindow.show();
              this.mainWindow.focus();
            } catch (err) {
              logger.warn(
                "MENU",
                "Failed to send openActivation event",
                err
              );
            }
          },
        });
        helpSubmenu.push({ type: "separator" });
      }

      // Always show Check for Updates and About
      helpSubmenu.push({
        label: "Check for Updates…",
        click: async () => {
          logger.info("MENU", "Check for Updates menu item clicked");
          await this.handleCheckForUpdatesMenuClick();
        },
      });
      helpSubmenu.push({ type: "separator" });

      // Add Admin Console pairing option
      helpSubmenu.push({
        label: "Register Device…",
        click: () => {
          logger.info("MENU", "Connect to Admin Console clicked");
          try {
            if (!this.mainWindow) {
              logger.warn("MENU", "mainWindow is null, cannot send openPairing event");
              return;
            }
            if (this.mainWindow.isDestroyed()) {
              logger.warn("MENU", "mainWindow is destroyed, cannot send openPairing event");
              return;
            }
            logger.info("MENU", "Sending agent:openPairing to renderer");
            this.mainWindow.webContents.send("agent:openPairing");
            // Also bring window to front
            this.mainWindow.show();
            this.mainWindow.focus();
          } catch (err) {
            logger.warn("MENU", "Failed to send openPairing event", err);
          }
        },
      });
      helpSubmenu.push({ type: "separator" });

      const template: Electron.MenuItemConstructorOptions[] = [
        {
          label: "File",
          submenu: [{ role: "quit", label: "Quit" }],
        },
        {
          label: "Edit",
          submenu: [
            { role: "undo" },
            { role: "redo" },
            { type: "separator" },
            { role: "cut" },
            { role: "copy" },
            { role: "paste" },
          ],
        },
        {
          label: "View",
          submenu: [
            { role: "reload" },
            { role: "forceReload" },
            { role: "toggleDevTools" },
            { type: "separator" },
            { role: "resetZoom" },
            { role: "zoomIn" },
            { role: "zoomOut" },
            { type: "separator" },
            { role: "togglefullscreen" },
          ],
        },
        { label: "Window", submenu: [{ role: "minimize" }, { role: "close" }] },
        {
          label: "Help",
          submenu: [
            ...helpSubmenu,
            {
              label: "About ProduTime",
              click: async () => {
                logger.info("MENU", "About menu item clicked");
                const version = app.getVersion();
                let licenseLine = "";

                try {
                  // Use EnhancedLicenseService for v1.8 licensing
                  if (this.enhancedLicenseService) {
                    const status = this.enhancedLicenseService.getStatus();
                    if (status.mode === 'activated') {
                      const exp = status.expiresAt
                        ? new Date(status.expiresAt).toLocaleDateString()
                        : null;
                      licenseLine = `\n\nLicense: Active${exp ? ` — expires ${exp}` : ''}`;
                    } else if (status.mode === 'trial') {
                      const days = status.trialDaysRemaining;
                      const plural = days === 1 ? "" : "s";
                      licenseLine = `\n\nTrial: ${days != null ? `${days} day${plural} remaining` : "Active"}`;
                    } else {
                      licenseLine = `\n\nLicense: Not activated`;
                    }
                  } else {
                    licenseLine = `\n\nLicense: Not activated`;
                  }
                } catch (e) {
                  logger.warn(
                    "MENU",
                    "Failed to compute license status for About dialog",
                    e
                  );
                  licenseLine = `\n\nLicense: Unknown`;
                }
                await dialog.showMessageBox(this.mainWindow!, {
                  type: "info",
                  title: "About ProduTime",
                  message: `ProduTime v${version}${licenseLine}\n\nDeveloped by George Karagioules\nwww.georgekaragioules.com\n\nProvided free of charge to World of Travel as a freeware productivity tool.\nFree to use. Not for resale or redistribution.\n\nCopyright © 2026 George Karagioules. All rights reserved.`,
                  buttons: ["OK"],
                });
              },
            },
            { type: "separator" },
            {
              label: "View Debug Logs",
              click: () => {
                logger.info("MENU", "View Debug Logs clicked");
                shell.openPath(logger.getLogFile());
              },
            },
          ],
        },
      ];
      logger.debug("MENU", "Building menu from template");
      const menu = Menu.buildFromTemplate(template);
      logger.debug("MENU", "Setting application menu");
      Menu.setApplicationMenu(menu);
      logger.info("MENU", "Application menu initialized successfully");
      logger.separator();
    } catch (error) {
      logger.error("MENU", "Failed to initialize application menu", error);
    }
  }

  /**
   * Rebuild the application menu (called after license status changes)
   * This updates the Help menu to show/hide "Enter License Key..." based on activation status
   */
  public rebuildApplicationMenu(): void {
    logger.info("MENU", "Rebuilding application menu after license status change");
    this.initializeApplicationMenu();
  }

  private async handleCheckForUpdatesMenuClick(): Promise<void> {
    logger.section("CHECK FOR UPDATES");
    logger.info("UPDATE", "handleCheckForUpdatesMenuClick called");
    try {
      if (!this.updater) {
        logger.error("UPDATE", "Updater is not initialized");
        await dialog.showMessageBox(this.mainWindow!, {
          type: "error",
          title: "Error",
          message: "Updater is not initialized",
          buttons: ["OK"],
        });
        return;
      }
      await this.updater.checkForUpdates(true);
      logger.info("UPDATE", "checkForUpdates completed successfully");
    } catch (e) {
      logger.error("UPDATE", "Check for updates failed", e);
    }
  }

  private initializeSystemTray(): void {
    try {
      console.log("Initializing system tray...");
      if (this.mainWindow) {
        this.systemTray = new SystemTrayManager(this.mainWindow);
        console.log("System tray manager created successfully");
      } else {
        throw new Error("Main window must be created before system tray");
      }
    } catch (error) {
      console.error("Failed to initialize system tray:", error);
      // Don't throw - system tray is not critical for app functionality
    }
  }

  private async initializeActivityTracker(): Promise<void> {
    if (!this.database || !this.mainWindow) {
      throw new Error(
        "Database and main window must be initialized before activity tracker"
      );
    }
    if (process.env.DIAGNOSTIC_SKIP_TRACKER === "1") {
      console.warn("[DIAGNOSTIC] Skipping activity tracker initialization");
      return;
    }
    const idleSetting = this.database.getSetting("idle_threshold");
    const idleThreshold = idleSetting ? parseInt(idleSetting) : 300;
    console.log(
      `🔧 Activity Tracker: Using idle threshold = ${idleThreshold} seconds (from setting: "${idleSetting}")`
    );
    const { ActivityTracker } = await import("./services/activity-tracker");
    this.activityTracker = new ActivityTracker(this.database, {
      pollInterval: 500,
      idleThreshold,
      enableLogging: true,
    });
    this.activityTracker.setMainWindow(this.mainWindow);

    // Make activity tracker globally accessible for IPC handlers
    (global as any).activityTracker = this.activityTracker;

    await this.activityTracker.startTracking();
  }

  private initializeIPC(): void {
    if (this.database) {
      // Remove existing handlers before creating new ones to avoid duplicate registration
      if (this.ipcHandlers) {
        this.ipcHandlers.removeAllHandlers();
      }

      this.ipcHandlers = new IPCHandlers(
        this.database,
        undefined, // auto-updater removed — assisted updater handles updates directly
        this.pdfGenerator || undefined,
        this.systemTray || undefined,
        this.autoExportScheduler || undefined,
        this.activityTracker || undefined,
        this.enhancedLicenseService || undefined,
        () => this.rebuildApplicationMenu() // Callback for menu rebuild after license changes
      );
      console.log("IPC handlers initialized successfully");
    } else {
      throw new Error("Database must be initialized before IPC handlers");
    }
  }

  private async testDatabaseFunctionality(): Promise<void> {
    try {
      console.log("🔍 TESTING DATABASE FUNCTIONALITY...");

      if (!this.database) {
        throw new Error("Database not initialized");
      }

      // Test 1: Database path check
      const dbPath = this.database.getDbPath();
      console.log("✅ Database Path:", dbPath);

      // Test 2: Check tables exist
      const settings = await this.database.getAllSettings();
      console.log("✅ Settings table accessible, count:", settings.length);

      // Test 3: Test basic CRUD - Insert a test setting
      await this.database.setSetting("test_verification", "database_working");
      const testSetting = await this.database.getSetting("test_verification");
      console.log("✅ Database CRUD Test - Retrieved:", testSetting);

      // Test 4: Test activity logs table
      const recentLogs = await this.database.getActivityLogs(5);
      console.log(
        "✅ Activity logs table accessible, recent count:",
        recentLogs.length
      );

      console.log("✅ DATABASE FUNCTIONALITY TEST COMPLETED");
    } catch (error) {
      console.error("❌ DATABASE FUNCTIONALITY TEST FAILED:", error);
    }
  }

  private async testAutoUpdaterFunctionality(): Promise<void> {
    try {
      console.log("🔍 TESTING UPDATER FUNCTIONALITY...");

      if (!this.updater) {
        throw new Error("Updater not initialized");
      }

      console.log("✅ Updater instance exists");
      console.log("✅ UPDATER FUNCTIONALITY TEST COMPLETED");
    } catch (error) {
      console.error("❌ AUTO-UPDATER FUNCTIONALITY TEST FAILED:", error);
    }
  }

  private async testErrorHandlingAndLogging(): Promise<void> {
    try {
      console.log("🔍 TESTING ERROR HANDLING AND LOGGING...");

      // Test 1: Console logging in main process
      console.log("✅ Main process console.log working");
      console.warn("✅ Main process console.warn working");
      console.error("✅ Main process console.error working (this is a test)");

      // Test 2: Graceful error handling
      try {
        // Intentionally cause a minor error to test handling
        const nonExistentSetting = await this.database?.getSetting(
          "non_existent_test_key"
        );
        console.log(
          "✅ Error handling test - Non-existent setting handled gracefully:",
          nonExistentSetting
        );
      } catch (testError: any) {
        console.log(
          "✅ Error handling test - Caught expected error:",
          testError?.message || testError
        );
      }

      // Test 3: Test error logging with stack traces
      const testError = new Error("Test error for logging verification");
      console.error("✅ Error logging test - Error with stack:", testError);

      // Test 4: Test that app doesn't crash on errors
      console.log(
        "✅ Application stability test - App still running after error tests"
      );

      console.log("✅ ERROR HANDLING AND LOGGING TEST COMPLETED");
    } catch (error) {
      console.error("❌ ERROR HANDLING AND LOGGING TEST FAILED:", error);
    }
  }

  private async testIPCFunctionality(): Promise<void> {
    try {
      console.log("🔍 TESTING IPC FUNCTIONALITY...");

      // Wait for window to be ready
      if (this.mainWindow && this.mainWindow.webContents) {
        // Test basic IPC by getting app version
        const version = app.getVersion();
        console.log("✅ IPC Test - App version:", version);

        // Test database IPC by getting settings
        if (this.database) {
          const settings = await this.database.getAllSettings();
          console.log(
            "✅ IPC Test - Database accessible, settings count:",
            settings.length
          );
        }

        console.log("✅ IPC FUNCTIONALITY TEST COMPLETED");
      }
    } catch (error) {
      console.error("❌ IPC FUNCTIONALITY TEST FAILED:", error);
    }
  }

  private cleanup(): void {
    console.log("🧹 Starting application cleanup...");

    // 1. Stop activity tracking first (clears intervals)
    if (this.activityTracker) {
      try {
        console.log("  → Stopping activity tracker...");
        this.activityTracker.stopTracking();
        this.activityTracker = null;
        console.log("  ✅ Activity tracker stopped");
      } catch (error) {
        console.error("  ❌ Error stopping activity tracker:", error);
      }
    }

    // 2. Remove IPC handlers
    if (this.ipcHandlers) {
      try {
        console.log("  → Removing IPC handlers...");
        this.ipcHandlers.removeAllHandlers();
        this.ipcHandlers = null;
        console.log("  ✅ IPC handlers removed");
      } catch (error) {
        console.error("  ❌ Error removing IPC handlers:", error);
      }
    }

    // 3. Cleanup system tray (destroy tray icon and close notifications)
    if (this.systemTray) {
      try {
        console.log("  → Cleaning up system tray...");
        this.systemTray.cleanup();
        this.systemTray = null;
        console.log("  ✅ System tray cleaned up");
      } catch (error) {
        console.error("  ❌ Error cleaning up system tray:", error);
      }
    }

    // 4. Stop assisted updater (clears background check timer)
    if (this.updater) {
      try {
        console.log("  → Stopping updater...");
        this.updater.cleanup();
        this.updater = null;
        console.log("  ✅ Updater stopped");
      } catch (error) {
        console.error("  ❌ Error stopping updater:", error);
      }
    }

    // 5. Cleanup PDF generator
    if (this.pdfGenerator) {
      try {
        console.log("  → Cleaning up PDF generator...");
        this.pdfGenerator.cleanup();
        this.pdfGenerator = null;
        console.log("  ✅ PDF generator cleaned up");
      } catch (error) {
        console.error("  ❌ Error cleaning up PDF generator:", error);
      }
    }

    // 7. Stop auto-export scheduler
    if (this.autoExportScheduler) {
      try {
        console.log("  → Stopping auto-export scheduler...");
        this.autoExportScheduler.stop();
        this.autoExportScheduler = null;
        console.log("  ✅ Auto-export scheduler stopped");
      } catch (error) {
        console.error("  ❌ Error stopping auto-export scheduler:", error);
      }
    }

    // 8. Clear heartbeat timer (prevents memory leak)
    if (this.heartbeatTimer) {
      try {
        console.log("  → Clearing heartbeat timer...");
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
        console.log("  ✅ Heartbeat timer cleared");
      } catch (error) {
        console.error("  ❌ Error clearing heartbeat timer:", error);
      }
    }

    // 9. Close database (checkpoint WAL and close connection)
    if (this.database) {
      try {
        console.log("  → Closing database...");
        this.database.close();
        this.database = null;
        console.log("  ✅ Database closed");
      } catch (error) {
        console.error("  ❌ Error closing database:", error);
      }
    }

    console.log("✅ Application cleanup complete");
  }

  public getMainWindow(): BrowserWindow | null {
    return this.mainWindow;
  }

  public getDatabase(): DatabaseManager | null {
    return this.database;
  }

  public getEnhancedLicenseService(): EnhancedLicenseService | null {
    return this.enhancedLicenseService;
  }
}

// Create app instance
startupLogger.info("Creating TimePortApp instance...");
const timePortApp = new TimePortApp();
startupLogger.info("TimePortApp instance created - waiting for app.whenReady()");

export default timePortApp;
