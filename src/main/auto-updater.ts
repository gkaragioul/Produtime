/**
 * Auto-Updater (NSIS installer + electron-updater)
 *
 * Uses electron-updater to check GitHub releases, download updates with
 * progress, and install on explicit user consent. Works reliably because
 * NSIS keeps the app in a fixed install directory (unlike portable EXE
 * which extracts to a random temp folder each launch).
 */

import { app, BrowserWindow, dialog, ipcMain, powerMonitor, shell } from 'electron';
import { autoUpdater, UpdateInfo, ProgressInfo } from 'electron-updater';
import * as fs from 'fs';
import * as path from 'path';
import { UpdateStatus, UpdateState } from '../shared/types';
import { Logger } from './logger';

const STARTUP_CHECK_DELAY_MS = 10_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const STARTUP_MAX_RETRIES = 4;
// Hard-exit fallback after the installer trigger: if the app hasn't exited
// on its own (cleanup deadlock, stuck tray, native-module file lock) the
// NSIS installer sits forever waiting for files. Forcing a process exit
// releases the lock and lets the installer proceed.
const QUIT_INSTALL_TIMEOUT_MS = 8_000;
// Max jitter before a power-resume-triggered check. Prevents a fleet of
// devices waking in sync (shared LAN after blackout) from hammering the
// GitHub API within the same anonymous-rate-limit window.
const RESUME_CHECK_JITTER_MS = 60_000;
// Orphan installer files in electron-updater's pending cache that are
// older than this are swept on startup. Happens when the user cancels
// UAC after quitAndInstall — the .exe.tmp never gets consumed.
const PENDING_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
// Source of truth for where electron-updater caches pending installers.
// electron-updater on Windows writes to %LOCALAPPDATA%\{productName}-updater\pending\.
const PENDING_CACHE_PRODUCT_DIR = 'ProduTime-updater';

export type PreInstallCleanup = () => void | Promise<void>;

export class AutoUpdaterManager {
  private mainWindow: BrowserWindow | null = null;
  private checkTimer: NodeJS.Timeout | null = null;
  private currentState: UpdateState = { status: UpdateStatus.NOT_AVAILABLE };
  // Pending manual-check tokens. A manual click adds a token before invoking
  // checkForUpdates; the next update-available/not-available/error consumes
  // one. Using a counter instead of a boolean avoids a race where a scheduled
  // check already in flight consumes a later manual click's flag.
  // Whether the user explicitly initiated the last check. Gated at "1"
  // (boolean-ish counter) so rapid user clicks don't queue a stack of
  // "up to date" toasts from stale attempts.
  private pendingManualChecks = 0;
  private static readonly MAX_PENDING_MANUAL = 1;
  private updateDownloaded = false;
  private downloadedInfo: UpdateInfo | null = null;
  private installPromptShown = false;
  private intervalRetries = 0;
  private preInstallCleanup: PreInstallCleanup | null = null;
  // Outstanding startup/retry setTimeouts. cleanup() clears them so they
  // don't fire after autoUpdater.removeAllListeners() and spam the log
  // with "handler registered after destroy" / wasted network calls.
  private retryTimers: Set<NodeJS.Timeout> = new Set();
  // Set once triggerQuitAndInstall fires — signals main.cleanup() that the
  // updater is mid-spawn of the installer and we must NOT call
  // autoUpdater.cleanup() (removeAllListeners) while the installer is still
  // being handed off. Otherwise electron-updater's internal state can race
  // the quitAndInstall handoff on slow machines.
  private isInstallingUpdate = false;
  // Drained on the first download-progress event of a fresh download so
  // a user "Check for updates" click during a long download doesn't leave
  // a stale token that a later scheduled check consumes with a phantom
  // "up to date" toast.
  private downloadProgressSeenForCurrentCheck = false;

  constructor(mainWindow: BrowserWindow, preInstallCleanup?: PreInstallCleanup) {
    this.mainWindow = mainWindow;
    this.preInstallCleanup = preInstallCleanup || null;
    this.configureAutoUpdater();
    this.wireAutoUpdaterEvents();
    this.registerIPC();
    this.startSchedule();
    this.wirePowerMonitor();
    this.sweepPendingCache();
  }

  public isInstalling(): boolean {
    return this.isInstallingUpdate;
  }

  /**
   * Log through our disk logger with every call try/caught. A logger
   * exception (disk full, antivirus locking the log file) inside an
   * electron-updater event handler would otherwise bubble up through the
   * EventEmitter and desync further events.
   */
  private safeLog(level: 'info' | 'warn' | 'error' | 'debug', msg: string): void {
    try {
      const log = Logger.getInstance();
      log[level]('updater', msg);
    } catch {
      // Swallow — the logger itself failed. Falling back to console is
      // also risky (stdout may be piped to a locked file in some setups);
      // we deliberately accept losing this one log line.
    }
  }

  private configureAutoUpdater(): void {
    // Explicit consent before burning ~50 MB of the user's bandwidth.
    // The renderer shows a "Download & Install" button in AVAILABLE state
    // that calls updater:downloadUpdate; until clicked, we only check and
    // notify. Matches user expectation on metered connections.
    autoUpdater.autoDownload = false;
    // Explicit install only — no silent install on arbitrary quit. The user
    // clicks "Restart now" in the UI (or picks Install in the native dialog
    // we show on update-downloaded).
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;

    // Route electron-updater's own logs through our on-disk Logger so
    // "no updates detected" / "checking failed" are diagnosable from the
    // field without attaching a debugger. Each call is wrapped so a
    // logger exception doesn't crash updater event dispatch.
    (autoUpdater as any).logger = {
      info: (...args: any[]) => this.safeLog('info', args.map(String).join(' ')),
      warn: (...args: any[]) => this.safeLog('warn', args.map(String).join(' ')),
      error: (...args: any[]) => this.safeLog('error', args.map(String).join(' ')),
      debug: (...args: any[]) => this.safeLog('debug', args.map(String).join(' ')),
    };

    // Log effective feed URL at init so field logs show which repo/channel
    // this client will pull from — critical when debugging "why is my
    // customer not getting updates?" (app-update.yml was baked in at
    // build time from package.json publish config).
    try {
      const feed = (autoUpdater as any).getFeedURL?.() ?? '(not set by provider)';
      this.safeLog('info', `feed URL at init: ${feed}`);
    } catch (err) {
      this.safeLog('warn', `feed URL lookup failed: ${String(err)}`);
    }
  }

  private consumeManualToken(): boolean {
    if (this.pendingManualChecks > 0) {
      this.pendingManualChecks -= 1;
      return true;
    }
    return false;
  }

  /**
   * Wrap an event handler body so a thrown error from inside (logger
   * failure, broadcast to a torn-down window, etc.) can't escape back
   * into electron-updater's EventEmitter and desync further dispatches.
   */
  private guardHandler<A extends any[]>(name: string, fn: (...args: A) => void): (...args: A) => void {
    return (...args: A) => {
      try {
        fn(...args);
      } catch (err) {
        this.safeLog('error', `handler ${name} threw: ${String((err as Error)?.message || err)}`);
      }
    };
  }

  private wireAutoUpdaterEvents(): void {
    autoUpdater.on('checking-for-update', this.guardHandler('checking-for-update', () => {
      // New check cycle → allow download-progress to drain the manual
      // token again for this cycle's download (if any).
      this.downloadProgressSeenForCurrentCheck = false;
      this.broadcastState({ status: UpdateStatus.CHECKING });
    }));

    autoUpdater.on('update-available', this.guardHandler('update-available', (info: UpdateInfo) => {
      this.consumeManualToken();
      this.broadcastState({
        status: UpdateStatus.AVAILABLE,
        info: {
          version: info.version,
          releaseDate: info.releaseDate || '',
        },
      });
    }));

    autoUpdater.on('update-not-available', this.guardHandler('update-not-available', () => {
      this.broadcastState({ status: UpdateStatus.NOT_AVAILABLE });
      if (this.consumeManualToken()) {
        try {
          // Parent the dialog on the main window when alive so it stays
          // on top and receives focus on Windows. An unparented dialog
          // can end up behind other apps' windows and the user never
          // sees the response to their click.
          const opts = {
            type: 'info' as const,
            title: 'No Updates Available',
            message: `ProduTime v${app.getVersion()} is the latest version.`,
            detail: 'You are up to date. We check automatically every 4 hours.',
            buttons: ['OK'],
          };
          const parent = this.mainWindow && !this.mainWindow.isDestroyed() ? this.mainWindow : null;
          if (parent) {
            dialog.showMessageBox(parent, opts);
          } else {
            dialog.showMessageBox(opts);
          }
        } catch (err) {
          this.safeLog('warn', `up-to-date dialog failed: ${String(err)}`);
        }
      }
    }));

    autoUpdater.on('download-progress', this.guardHandler('download-progress', (progress: ProgressInfo) => {
      // First progress event of this download cycle — if the user
      // manually kicked off a check that DID find an update, the token
      // from update-available was already consumed. But if the user
      // triggered a check DURING an in-progress download from an earlier
      // cycle, the DOWNLOADING transition consumes their token here so a
      // later scheduled check doesn't pop a stale "up to date" toast.
      if (!this.downloadProgressSeenForCurrentCheck) {
        this.downloadProgressSeenForCurrentCheck = true;
        this.consumeManualToken();
      }
      this.broadcastState({
        status: UpdateStatus.DOWNLOADING,
        progress: {
          bytesPerSecond: progress.bytesPerSecond,
          percent: progress.percent,
          transferred: progress.transferred,
          total: progress.total,
        },
      });
    }));

    autoUpdater.on('update-downloaded', this.guardHandler('update-downloaded', (info: UpdateInfo) => {
      // A fresh download cycle — reset the one-shot native dialog flag so
      // a later version that the user deferred shows the prompt again.
      if (this.downloadedInfo?.version !== info.version) {
        this.installPromptShown = false;
      }
      this.updateDownloaded = true;
      this.downloadedInfo = info;
      this.broadcastState({
        status: UpdateStatus.DOWNLOADED,
        info: {
          version: info.version,
          releaseDate: info.releaseDate || '',
        },
      });
      // Native dialog is a FALLBACK for when the renderer isn't visible
      // (tray-hidden or destroyed). A minimized-to-taskbar window is
      // NOT hidden — restoring it already surfaces the renderer progress
      // bar, so firing a native modal too would double-prompt.
      if (!this.installPromptShown && this.isWindowHidden()) {
        this.installPromptShown = true;
        this.showDownloadedDialog(info);
      }
    }));

    autoUpdater.on('error', this.guardHandler('error', (err: Error) => {
      // Drain any pending manual-check token so a later scheduled success
      // doesn't pop the "up to date" toast from a stale manual attempt.
      this.consumeManualToken();
      // If we were pre-install (download in flight / available / fresh
      // error after DOWNLOADED became stale), reset the post-download
      // flags. Otherwise a stale cache file could drive a phantom
      // updater:installUpdate success into triggerQuitAndInstall.
      // We deliberately clear even when state was DOWNLOADED: if the
      // installer file on disk is still valid, electron-updater will
      // re-emit DOWNLOADED on the next check/download cycle.
      if (!this.isInstallingUpdate) {
        this.updateDownloaded = false;
        this.downloadedInfo = null;
        this.installPromptShown = false;
      }
      this.safeLog('error', `error: ${err.message}`);
      this.broadcastState({
        status: UpdateStatus.ERROR,
        error: err.message,
      });
    }));
  }

  /**
   * True only when the window is genuinely off-screen for the user — NOT
   * merely minimized to taskbar. Restoring a minimized window immediately
   * shows the renderer's UpdateProgressBar, so a native modal on top of
   * that is redundant and disorienting.
   */
  private isWindowHidden(): boolean {
    const w = this.mainWindow;
    if (!w || w.isDestroyed()) return true;
    try {
      return !w.isVisible();
    } catch {
      return true;
    }
  }

  /**
   * Channels owned by this manager. Kept here as the single source of
   * truth so both register + cleanup stay in sync and IPCHandlers can
   * defer to AutoUpdaterManager for ownership.
   */
  private static readonly IPC_CHANNELS: readonly string[] = [
    'updater:checkForUpdates',
    'updater:downloadUpdate',
    'updater:installUpdate',
    'updater:getStatus',
    'updater:openReleasesPage',
  ];

  /**
   * Remove any already-registered updater handlers. Idempotent —
   * `ipcMain.removeHandler` is a no-op on channels without a handler.
   * Must run before `registerIPC()` when re-registering, because
   * `ipcMain.handle()` throws if a handler is already present.
   */
  private unregisterIPC(): void {
    for (const ch of AutoUpdaterManager.IPC_CHANNELS) {
      try { ipcMain.removeHandler(ch); } catch {}
    }
  }

  /**
   * Public re-registration hook. Call after any post-init IPC refresh
   * that may have wiped our handlers (e.g. IPCHandlers.removeAllHandlers
   * during the second initializeIPC pass in main.ts). Idempotent and
   * safe to call multiple times.
   */
  public reregisterIPC(): void {
    this.safeLog('info', 'reregisterIPC called — re-registering updater IPC handlers');
    this.registerIPC();
  }

  private registerIPC(): void {
    // Idempotent: drop any prior registrations before re-adding. Prevents
    // the "Attempted to register a second handler" throw when this runs
    // via reregisterIPC() after the IPC refresh.
    this.unregisterIPC();
    ipcMain.handle('updater:checkForUpdates', async () => {
      this.safeLog('info', 'IPC updater:checkForUpdates invoked');
      this.pendingManualChecks = Math.min(
        this.pendingManualChecks + 1,
        AutoUpdaterManager.MAX_PENDING_MANUAL
      );
      try {
        await autoUpdater.checkForUpdates();
        return { success: true };
      } catch (e: any) {
        this.consumeManualToken();
        const msg = e?.message || String(e);
        this.safeLog('error', `IPC updater:checkForUpdates rejected: ${msg}`);
        return { success: false, error: msg };
      }
    });

    // Previously a no-op. Now actually triggers a download in case the
    // operator flips autoDownload off, or the initial auto-download
    // errored and the user clicks the explicit retry button.
    ipcMain.handle('updater:downloadUpdate', async () => {
      this.safeLog('info', 'IPC updater:downloadUpdate invoked');
      try {
        // Defensive: if we don't have cached update info (e.g. because a
        // stale startup "not available" cached before the menu-triggered
        // check that actually found a newer version), run a fresh check
        // first so downloadUpdate has a valid updateInfo to work with.
        // Harmless if info is already current.
        if (this.currentState.status !== UpdateStatus.AVAILABLE &&
            this.currentState.status !== UpdateStatus.ERROR) {
          this.safeLog('info', `downloadUpdate: current state=${this.currentState.status}, running fresh check first`);
          try {
            await autoUpdater.checkForUpdates();
          } catch (checkErr: any) {
            this.safeLog('warn', `downloadUpdate: pre-check failed: ${checkErr?.message || checkErr}`);
          }
        }
        await autoUpdater.downloadUpdate();
        this.safeLog('info', 'IPC updater:downloadUpdate completed');
        return { success: true };
      } catch (e: any) {
        const msg = e?.message || String(e);
        const stack = e?.stack ? ` | stack: ${e.stack.split('\n').slice(0, 3).join(' | ')}` : '';
        this.safeLog('error', `IPC updater:downloadUpdate rejected: ${msg}${stack}`);
        return { success: false, error: msg };
      }
    });

    ipcMain.handle('updater:installUpdate', async () => {
      this.safeLog('info', `IPC updater:installUpdate invoked (updateDownloaded=${this.updateDownloaded})`);
      if (!this.updateDownloaded) return { success: false, error: 'no_download' };
      this.triggerQuitAndInstall();
      return { success: true };
    });

    ipcMain.handle('updater:getStatus', async () => ({
      success: true,
      data: this.currentState,
    }));

    // Force-reinstall escape hatch: opens the GitHub releases page so the
    // user can manually download and re-run the installer. Needed when
    // the current installation is corrupt but the version matches what's
    // already published (allowDowngrade=false means our checker would
    // otherwise report "up to date" and the user has no way out).
    ipcMain.handle('updater:openReleasesPage', async () => {
      try {
        // Publish config in package.json — keep in sync.
        const url = 'https://github.com/gkaragioul/Produtime/releases/latest';
        await shell.openExternal(url);
        return { success: true };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    });
  }

  private broadcastState(state: UpdateState): void {
    this.currentState = state;
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      try {
        this.mainWindow.webContents.send('updater:statusChanged', state);
      } catch (err) {
        console.warn('[UPDATER] Failed to broadcast state:', (err as Error).message);
      }
    }
  }

  /**
   * Trigger quitAndInstall with a safety net:
   *  - Run a best-effort pre-install cleanup first (checkpoint SQLite WAL,
   *    stop the activity tracker) so the 8 s hard-exit fallback can't leave
   *    a dirty DB or an in-flight write. Bounded to 2 s — if cleanup hangs,
   *    we still trigger the installer.
   *  - Non-silent so UAC (if any) is visible instead of hanging invisibly.
   *  - 8 s hard-exit fallback if the app never actually quits (cleanup
   *    deadlock, stuck native module, tray thread won't release).
   */
  private triggerQuitAndInstall(): void {
    // Signal to main.cleanup() to skip autoUpdater.cleanup() until after
    // the installer hand-off is complete (see main.ts before-quit). Set
    // BEFORE any other work so a racing app.quit() from elsewhere hits
    // the guard.
    this.isInstallingUpdate = true;

    const hardExit = setTimeout(() => {
      this.safeLog('warn', 'quitAndInstall did not exit within 8s — forcing process exit');
      try { app.exit(0); } catch {}
      try { process.exit(0); } catch {}
    }, QUIT_INSTALL_TIMEOUT_MS);
    hardExit.unref?.();

    const runPreInstall = async (): Promise<void> => {
      if (!this.preInstallCleanup) return;
      try {
        await Promise.race([
          Promise.resolve().then(() => this.preInstallCleanup?.()),
          new Promise<void>((resolve) =>
            setTimeout(() => {
              this.safeLog('warn', 'preInstallCleanup exceeded 2s — proceeding');
              resolve();
            }, 2_000).unref?.()
          ),
        ]);
      } catch (e) {
        this.safeLog('warn', `preInstallCleanup threw: ${e}`);
      }
    };

    this.safeLog('info', 'quitAndInstall: running pre-install cleanup');
    runPreInstall().finally(() => {
      this.safeLog('info', 'quitAndInstall: invoking installer');
      setImmediate(() => {
        try {
          autoUpdater.quitAndInstall(false, true);
        } catch (e) {
          this.safeLog('error', `quitAndInstall threw: ${e}`);
          clearTimeout(hardExit);
          try { app.exit(0); } catch {}
        }
      });
    });
  }

  private async showDownloadedDialog(info: UpdateInfo): Promise<void> {
    const opts = {
      type: 'info' as const,
      title: 'ProduTime update ready',
      message: `Version ${info.version} has been downloaded.`,
      detail: 'Install now to apply the update. You can keep working and install later from Settings.',
      buttons: ['Install now', 'Install later'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    };
    const parent = this.mainWindow && !this.mainWindow.isDestroyed() ? this.mainWindow : null;
    // Use the parented overload only when we have a live window — passing
    // a destroyed/missing handle on Windows silently drops the dialog.
    const p = parent
      ? dialog.showMessageBox(parent, opts)
      : dialog.showMessageBox(opts);
    const result = await p.catch(() => ({ response: 1 }));
    if (result.response === 0) {
      this.triggerQuitAndInstall();
    }
  }

  private trackedSetTimeout(fn: () => void, delay: number): void {
    const t = setTimeout(() => {
      this.retryTimers.delete(t);
      fn();
    }, delay);
    t.unref?.();
    this.retryTimers.add(t);
  }

  private startSchedule(): void {
    const scheduleStartup = (delay: number, retry = 0) => {
      this.trackedSetTimeout(async () => {
        try {
          await autoUpdater.checkForUpdates();
        } catch (err: any) {
          if (retry < STARTUP_MAX_RETRIES) {
            scheduleStartup(STARTUP_CHECK_DELAY_MS * Math.pow(2, retry), retry + 1);
          }
        }
      }, delay);
    };
    scheduleStartup(STARTUP_CHECK_DELAY_MS);

    this.checkTimer = setInterval(() => {
      this.runIntervalCheck();
    }, CHECK_INTERVAL_MS);
  }

  /** 4h interval check with its own retry chain. */
  private async runIntervalCheck(retry = 0): Promise<void> {
    try {
      await autoUpdater.checkForUpdates();
      this.intervalRetries = 0;
    } catch (err) {
      if (retry < STARTUP_MAX_RETRIES) {
        const delay = STARTUP_CHECK_DELAY_MS * Math.pow(2, retry);
        this.trackedSetTimeout(() => this.runIntervalCheck(retry + 1), delay);
      } else {
        this.intervalRetries = retry;
        Logger.getInstance().warn(
          'updater',
          `interval check gave up after ${STARTUP_MAX_RETRIES} retries: ${String(err)}`
        );
      }
    }
  }

  /**
   * Wake-from-sleep hook — a 4h setInterval does not fire reliably across
   * sleep/resume on Windows. When the OS resumes, fire an extra check so
   * a laptop that slept 9h doesn't miss a whole cycle.
   *
   * Random 0–60s jitter avoids a thundering-herd against GitHub's
   * anonymous rate limit (60 req/hr/IP) when a fleet of devices wakes
   * within the same second — e.g. shared office LAN after a blackout.
   */
  private wirePowerMonitor(): void {
    try {
      powerMonitor.on('resume', () => {
        const jitter = Math.floor(Math.random() * RESUME_CHECK_JITTER_MS);
        this.safeLog('info', `resume from sleep — scheduling check in ${jitter}ms (jittered)`);
        this.trackedSetTimeout(() => {
          this.runIntervalCheck().catch(() => {});
        }, jitter);
      });
    } catch {
      // powerMonitor is unavailable in some test environments — ignore.
    }
  }

  /**
   * Delete stale orphan installers left in electron-updater's pending cache.
   * These accumulate when the user cancels UAC after quitAndInstall — the
   * .exe.tmp stays behind forever. Each failure adds ~50 MB; on a long-lived
   * install that can grow to hundreds of MB.
   *
   * Best-effort: errors are logged and swallowed. The sweep is skipped if
   * the cache dir doesn't exist or we can't read it.
   */
  private sweepPendingCache(): void {
    try {
      const dirs: string[] = [];
      // electron-updater default on Windows for NSIS:
      // %LOCALAPPDATA%\{productName}-updater\pending\
      if (process.env.LOCALAPPDATA) {
        dirs.push(path.join(process.env.LOCALAPPDATA, PENDING_CACHE_PRODUCT_DIR, 'pending'));
      }
      // Fallback for older/alternate electron-updater layouts — harmless
      // if the directory doesn't exist.
      dirs.push(path.join(app.getPath('userData'), 'pending'));

      const now = Date.now();
      let swept = 0;
      for (const dir of dirs) {
        if (!fs.existsSync(dir)) continue;
        let entries: string[] = [];
        try {
          entries = fs.readdirSync(dir);
        } catch (err) {
          this.safeLog('warn', `sweep: readdir ${dir} failed: ${String(err)}`);
          continue;
        }
        for (const name of entries) {
          // Only touch the patterns electron-updater writes: .tmp, .exe.tmp,
          // partial .exe, and .blockmap. Never delete anything else — a
          // mis-configured cache dir could be anywhere.
          if (!/\.(tmp|exe|blockmap)$/i.test(name)) continue;
          const full = path.join(dir, name);
          try {
            const st = fs.statSync(full);
            if (now - st.mtimeMs < PENDING_CACHE_MAX_AGE_MS) continue;
            fs.unlinkSync(full);
            swept += 1;
          } catch (err) {
            this.safeLog('warn', `sweep: unlink ${full} failed: ${String(err)}`);
          }
        }
      }
      if (swept > 0) {
        this.safeLog('info', `sweep: removed ${swept} stale file(s) from pending cache`);
      }
    } catch (err) {
      this.safeLog('warn', `sweepPendingCache failed: ${String(err)}`);
    }
  }

  public async checkForUpdates(): Promise<void> {
    this.pendingManualChecks = Math.min(
      this.pendingManualChecks + 1,
      AutoUpdaterManager.MAX_PENDING_MANUAL
    );
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      this.consumeManualToken();
      throw err;
    }
  }

  public getCurrentState(): UpdateState {
    return this.currentState;
  }

  public cleanup(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    for (const t of this.retryTimers) { clearTimeout(t); }
    this.retryTimers.clear();
    autoUpdater.removeAllListeners();
    // Our own IPC channels — must be explicitly removed so a hot-reload
    // init doesn't throw "Attempted to register a second handler".
    this.unregisterIPC();
  }

  /**
   * Re-push the current state to the renderer. Called when the main window
   * becomes visible after being hidden to tray so a DOWNLOADED state that
   * arrived while the window was hidden isn't lost.
   */
  public replayState(): void {
    this.broadcastState(this.currentState);
  }
}
