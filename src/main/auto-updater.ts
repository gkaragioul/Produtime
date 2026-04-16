/**
 * Auto-Updater (NSIS installer + electron-updater)
 *
 * Uses electron-updater to check GitHub releases, download updates with
 * progress, and install automatically on app quit. Works reliably because
 * NSIS keeps the app in a fixed install directory (unlike portable EXE
 * which extracts to a random temp folder each launch).
 */

import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { autoUpdater, UpdateInfo, ProgressInfo } from 'electron-updater';
import { UpdateStatus, UpdateState } from '../shared/types';

const STARTUP_CHECK_DELAY_MS = 10_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

export class AutoUpdaterManager {
  private mainWindow: BrowserWindow | null = null;
  private checkTimer: NodeJS.Timeout | null = null;
  private currentState: UpdateState = { status: UpdateStatus.NOT_AVAILABLE };
  private isManualCheck = false;
  private updateDownloaded = false;

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
    this.configureAutoUpdater();
    this.registerIPC();
    this.wireAutoUpdaterEvents();
    this.startSchedule();
  }

  private configureAutoUpdater(): void {
    // Auto-download updates in the background as soon as they're detected
    autoUpdater.autoDownload = true;
    // Install automatically when the app quits (next launch runs the new version)
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;
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
      this.broadcastState({
        status: UpdateStatus.DOWNLOADED,
        info: {
          version: info.version,
          releaseDate: info.releaseDate || '',
        },
      });
    });

    autoUpdater.on('error', (err: Error) => {
      console.error('[UPDATER] Error:', err.message);
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

    // No-op — electron-updater auto-downloads when AVAILABLE
    ipcMain.handle('updater:downloadUpdate', async () => ({ success: true }));

    // Triggered when user clicks "Restart now" — quits and installs.
    // isSilent=false: show the NSIS UI so install can't hang on UAC/file
    // locks without the user noticing. isForceRunAfter=true: relaunch on
    // completion. The prior silent=true path stuck for some users.
    //
    // Fallback: if quit doesn't fire within 8 s (cleanup deadlock, stuck
    // tray, holding-on native module, etc.) we hard-exit so the NSIS
    // installer can replace the locked exe. The user just has to relaunch
    // ProduTime once after the installer finishes.
    ipcMain.handle('updater:installUpdate', async () => {
      if (!this.updateDownloaded) return { success: false, error: 'no_download' };

      const HARD_EXIT_DELAY_MS = 8000;
      const hardExit = setTimeout(() => {
        console.warn('[UPDATER] quitAndInstall timed out — forcing process exit');
        try { app.exit(0); } catch {}
        try { process.exit(0); } catch {}
      }, HARD_EXIT_DELAY_MS);
      hardExit.unref?.();

      // Make sure the close handler lets the window go.
      try { (global as any).__produtimeForceQuit = true; } catch {}

      setImmediate(() => {
        try {
          autoUpdater.quitAndInstall(false, true);
        } catch (e) {
          console.error('[UPDATER] quitAndInstall threw:', e);
          clearTimeout(hardExit);
          try { app.exit(0); } catch {}
        }
      });
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

  private startSchedule(): void {
    let retries = 0;
    const scheduleCheck = (delay: number) => {
      setTimeout(async () => {
        try {
          await autoUpdater.checkForUpdates();
        } catch (err: any) {
          if (retries < 4) {
            retries++;
            scheduleCheck(STARTUP_CHECK_DELAY_MS * Math.pow(2, retries - 1));
          }
        }
      }, delay);
    };
    scheduleCheck(STARTUP_CHECK_DELAY_MS);
    this.checkTimer = setInterval(
      () => autoUpdater.checkForUpdates().catch(console.error),
      CHECK_INTERVAL_MS
    );
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
