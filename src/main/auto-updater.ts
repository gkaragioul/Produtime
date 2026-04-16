/**
 * Auto-Updater (NSIS installer + electron-updater)
 *
 * Uses electron-updater to check GitHub releases, download updates with
 * progress, and install on explicit user consent. Works reliably because
 * NSIS keeps the app in a fixed install directory (unlike portable EXE
 * which extracts to a random temp folder each launch).
 */

import { app, BrowserWindow, dialog, ipcMain, powerMonitor } from 'electron';
import { autoUpdater, UpdateInfo, ProgressInfo } from 'electron-updater';
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

export class AutoUpdaterManager {
  private mainWindow: BrowserWindow | null = null;
  private checkTimer: NodeJS.Timeout | null = null;
  private currentState: UpdateState = { status: UpdateStatus.NOT_AVAILABLE };
  private isManualCheck = false;
  private updateDownloaded = false;
  private downloadedInfo: UpdateInfo | null = null;
  private installPromptShown = false;
  private intervalRetries = 0;

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
    this.configureAutoUpdater();
    this.wireAutoUpdaterEvents();
    this.registerIPC();
    this.startSchedule();
    this.wirePowerMonitor();
  }

  private configureAutoUpdater(): void {
    autoUpdater.autoDownload = true;
    // Explicit install only — no silent install on arbitrary quit. The user
    // clicks "Restart now" in the UI (or picks Install in the native dialog
    // we show on update-downloaded).
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;

    // Route electron-updater's own logs through our on-disk Logger so
    // "no updates detected" / "checking failed" are diagnosable from the
    // field without attaching a debugger.
    const log = Logger.getInstance();
    (autoUpdater as any).logger = {
      info: (...args: any[]) => log.info('updater', args.map(String).join(' ')),
      warn: (...args: any[]) => log.warn('updater', args.map(String).join(' ')),
      error: (...args: any[]) => log.error('updater', args.map(String).join(' ')),
      debug: (...args: any[]) => log.debug('updater', args.map(String).join(' ')),
    };
  }

  private wireAutoUpdaterEvents(): void {
    autoUpdater.on('checking-for-update', () => {
      this.broadcastState({ status: UpdateStatus.CHECKING });
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.isManualCheck = false;
      this.broadcastState({
        status: UpdateStatus.AVAILABLE,
        info: {
          version: info.version,
          releaseDate: info.releaseDate || '',
        },
      });
    });

    autoUpdater.on('update-not-available', () => {
      this.broadcastState({ status: UpdateStatus.NOT_AVAILABLE });
      if (this.isManualCheck) {
        this.isManualCheck = false;
        dialog.showMessageBox({
          type: 'info',
          title: 'No Updates Available',
          message: `You're up to date! Current version: ${app.getVersion()}`,
          buttons: ['OK'],
        });
      }
    });

    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      this.broadcastState({
        status: UpdateStatus.DOWNLOADING,
        progress: {
          bytesPerSecond: progress.bytesPerSecond,
          percent: progress.percent,
          transferred: progress.transferred,
          total: progress.total,
        },
      });
    });

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      this.updateDownloaded = true;
      this.downloadedInfo = info;
      this.broadcastState({
        status: UpdateStatus.DOWNLOADED,
        info: {
          version: info.version,
          releaseDate: info.releaseDate || '',
        },
      });
      // Fallback surface when the window is hidden / minimised to tray —
      // the renderer push dropped silently and the user would otherwise
      // never see the prompt. Show at most once per download.
      if (!this.installPromptShown) {
        this.installPromptShown = true;
        this.showDownloadedDialog(info);
      }
    });

    autoUpdater.on('error', (err: Error) => {
      // Reset the manual-check flag so a later scheduled success doesn't
      // pop the "up to date" toast from a stale manual attempt.
      this.isManualCheck = false;
      Logger.getInstance().error('updater', `error: ${err.message}`);
      this.broadcastState({
        status: UpdateStatus.ERROR,
        error: err.message,
      });
    });
  }

  private registerIPC(): void {
    ipcMain.handle('updater:checkForUpdates', async () => {
      try {
        this.isManualCheck = true;
        await autoUpdater.checkForUpdates();
        return { success: true };
      } catch (e: any) {
        this.isManualCheck = false;
        return { success: false, error: e.message };
      }
    });

    // Previously a no-op. Now actually triggers a download in case the
    // operator flips autoDownload off, or the initial auto-download
    // errored and the user clicks the explicit retry button.
    ipcMain.handle('updater:downloadUpdate', async () => {
      try {
        await autoUpdater.downloadUpdate();
        return { success: true };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    });

    ipcMain.handle('updater:installUpdate', async () => {
      if (!this.updateDownloaded) return { success: false, error: 'no_download' };
      this.triggerQuitAndInstall();
      return { success: true };
    });

    ipcMain.handle('updater:getStatus', async () => ({
      success: true,
      data: this.currentState,
    }));
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
   *  - Non-silent so UAC (if any) is visible instead of hanging invisibly.
   *  - 8 s hard-exit fallback if the app never actually quits (cleanup
   *    deadlock, stuck native module, tray thread won't release).
   */
  private triggerQuitAndInstall(): void {
    const hardExit = setTimeout(() => {
      Logger.getInstance().warn(
        'updater',
        'quitAndInstall did not exit within 8s — forcing process exit'
      );
      try { app.exit(0); } catch {}
      try { process.exit(0); } catch {}
    }, QUIT_INSTALL_TIMEOUT_MS);
    hardExit.unref?.();

    setImmediate(() => {
      try {
        autoUpdater.quitAndInstall(false, true);
      } catch (e) {
        Logger.getInstance().error('updater', `quitAndInstall threw: ${e}`);
        clearTimeout(hardExit);
        try { app.exit(0); } catch {}
      }
    });
  }

  private async showDownloadedDialog(info: UpdateInfo): Promise<void> {
    const parent = this.mainWindow && !this.mainWindow.isDestroyed() ? this.mainWindow : undefined;
    const result = await dialog.showMessageBox(parent!, {
      type: 'info',
      title: 'ProduTime update ready',
      message: `Version ${info.version} has been downloaded.`,
      detail: 'Install now to apply the update. You can keep working and install later from Settings.',
      buttons: ['Install now', 'Install later'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    }).catch(() => ({ response: 1 }));
    if (result.response === 0) {
      this.triggerQuitAndInstall();
    }
  }

  private startSchedule(): void {
    const scheduleStartup = (delay: number, retry = 0) => {
      setTimeout(async () => {
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
        setTimeout(() => this.runIntervalCheck(retry + 1), delay);
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
   * sleep/resume on Windows/macOS. When the OS resumes, fire an extra
   * check so a laptop that slept 9h doesn't miss a whole cycle.
   */
  private wirePowerMonitor(): void {
    try {
      powerMonitor.on('resume', () => {
        Logger.getInstance().info('updater', 'resume from sleep — triggering update check');
        this.runIntervalCheck().catch(() => {});
      });
    } catch {
      // powerMonitor is unavailable in some test environments — ignore.
    }
  }

  public async checkForUpdates(): Promise<void> {
    this.isManualCheck = true;
    await autoUpdater.checkForUpdates();
  }

  public getCurrentState(): UpdateState {
    return this.currentState;
  }

  public cleanup(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    autoUpdater.removeAllListeners();
  }
}
