/**
 * Auto-Updater
 *
 * Uses electron-updater to check GitHub releases for updates,
 * download them with progress, and install on restart.
 */

import { autoUpdater, UpdateInfo as ElectronUpdateInfo } from 'electron-updater';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import {
  UpdateStatus,
  UpdateState,
} from '../shared/types';

const STARTUP_CHECK_DELAY_MS = 30_000; // 30 seconds after startup
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const AUTO_DOWNLOAD_DELAY_MS = 30_000; // 30 seconds before auto-downloading

export class AutoUpdaterManager {
  private mainWindow: BrowserWindow | null = null;
  private checkTimer: NodeJS.Timeout | null = null;
  private autoDownloadTimer: NodeJS.Timeout | null = null;
  private currentState: UpdateState = { status: UpdateStatus.NOT_AVAILABLE };
  private isManualCheck: boolean = false;

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;

    // Configure electron-updater
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = console;

    this.setupListeners();
    this.registerIPC();
    this.startSchedule();
  }

  private setupListeners(): void {
    autoUpdater.on('checking-for-update', () => {
      this.broadcastState({ status: UpdateStatus.CHECKING });
    });

    autoUpdater.on('update-available', (info: ElectronUpdateInfo) => {
      this.broadcastState({
        status: UpdateStatus.AVAILABLE,
        info: {
          version: info.version,
          releaseDate: info.releaseDate || '',
          releaseNotes: typeof info.releaseNotes === 'string'
            ? info.releaseNotes
            : undefined,
        },
      });

      // Auto-download after 30 seconds if user doesn't act
      this.autoDownloadTimer = setTimeout(() => {
        autoUpdater.downloadUpdate().catch(console.error);
      }, AUTO_DOWNLOAD_DELAY_MS);
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

    autoUpdater.on('download-progress', (progress) => {
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

    autoUpdater.on('update-downloaded', (info: ElectronUpdateInfo) => {
      console.log(`[AUTO-UPDATER] Update downloaded: v${info.version} — installing now`);
      this.broadcastState({
        status: UpdateStatus.DOWNLOADED,
        info: {
          version: info.version,
          releaseDate: info.releaseDate || '',
          releaseNotes: typeof info.releaseNotes === 'string'
            ? info.releaseNotes
            : undefined,
        },
      });

      // Auto-install immediately — close all windows and quit
      setTimeout(() => {
        app.removeAllListeners('window-all-closed');
        const windows = BrowserWindow.getAllWindows();
        windows.forEach(w => w.removeAllListeners('close'));
        windows.forEach(w => w.close());
        autoUpdater.quitAndInstall(false, true);
      }, 1500); // Brief delay so user sees "ready to install" before restart
    });

    autoUpdater.on('error', (err) => {
      console.error('[AUTO-UPDATER] Error:', err.message);
      this.isManualCheck = false;
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
      } catch (error: any) {
        this.isManualCheck = false;
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('updater:downloadUpdate', async () => {
      try {
        if (this.autoDownloadTimer) {
          clearTimeout(this.autoDownloadTimer);
          this.autoDownloadTimer = null;
        }
        await autoUpdater.downloadUpdate();
        return { success: true };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('updater:installUpdate', async () => {
      setImmediate(() => {
        app.removeAllListeners('window-all-closed');
        const windows = BrowserWindow.getAllWindows();
        windows.forEach(w => w.removeAllListeners('close'));
        windows.forEach(w => w.close());
        autoUpdater.quitAndInstall(false, true);
      });
      return { success: true };
    });

    ipcMain.handle('updater:getStatus', async () => {
      return { success: true, data: this.currentState };
    });
  }

  private broadcastState(state: UpdateState): void {
    this.currentState = state;
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('updater:statusChanged', state);
    }
  }

  private startSchedule(): void {
    // Check after startup delay
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(console.error);
    }, STARTUP_CHECK_DELAY_MS);

    // Check every 4 hours
    this.checkTimer = setInterval(() => {
      autoUpdater.checkForUpdates().catch(console.error);
    }, CHECK_INTERVAL_MS);
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
    if (this.autoDownloadTimer) {
      clearTimeout(this.autoDownloadTimer);
      this.autoDownloadTimer = null;
    }
    autoUpdater.removeAllListeners();
  }
}
