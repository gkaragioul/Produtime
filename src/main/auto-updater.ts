/**
 * Portable Auto-Updater
 *
 * Checks GitHub releases for updates, downloads the new portable EXE
 * with progress, strips Mark of the Web, and uses a batch script to
 * swap the old EXE for the new one and relaunch.
 *
 * No NSIS installer, no SmartScreen issues.
 */

import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { UpdateStatus, UpdateState } from '../shared/types';

const GITHUB_OWNER = 'wotbyalice';
const GITHUB_REPO = 'WOT-Produtime-Releases';
const STARTUP_CHECK_DELAY_MS = 30_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const AUTO_DOWNLOAD_DELAY_MS = 30_000;

export class AutoUpdaterManager {
  private mainWindow: BrowserWindow | null = null;
  private checkTimer: NodeJS.Timeout | null = null;
  private autoDownloadTimer: NodeJS.Timeout | null = null;
  private currentState: UpdateState = { status: UpdateStatus.NOT_AVAILABLE };
  private isManualCheck = false;
  private latestDownloadUrl: string | null = null;
  private latestVersion: string | null = null;

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
    this.registerIPC();
    this.startSchedule();
  }

  private registerIPC(): void {
    ipcMain.handle('updater:checkForUpdates', async () => {
      try {
        this.isManualCheck = true;
        await this.checkForUpdates();
        return { success: true };
      } catch (e: any) {
        this.isManualCheck = false;
        return { success: false, error: e.message };
      }
    });

    ipcMain.handle('updater:downloadUpdate', async () => {
      try {
        if (this.autoDownloadTimer) {
          clearTimeout(this.autoDownloadTimer);
          this.autoDownloadTimer = null;
        }
        await this.downloadUpdate();
        return { success: true };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    });

    ipcMain.handle('updater:installUpdate', async () => {
      return { success: true }; // install happens automatically after download
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
    setTimeout(() => this.checkForUpdates().catch(console.error), STARTUP_CHECK_DELAY_MS);
    this.checkTimer = setInterval(() => this.checkForUpdates().catch(console.error), CHECK_INTERVAL_MS);
  }

  public async checkForUpdates(): Promise<void> {
    this.broadcastState({ status: UpdateStatus.CHECKING });
    try {
      const release = await this.fetchLatestRelease();
      if (!release) {
        this.broadcastNotAvailable();
        return;
      }

      const latest = release.tag_name.replace(/^v/, '');
      const current = app.getVersion();

      if (!this.isNewer(latest, current)) {
        this.broadcastNotAvailable();
        return;
      }

      // Find the portable EXE asset
      const asset = release.assets?.find((a: any) =>
        a.name.endsWith('.exe') && !a.name.includes('blockmap')
      );
      if (!asset) {
        this.broadcastNotAvailable();
        return;
      }

      this.latestVersion = latest;
      this.latestDownloadUrl = asset.browser_download_url;

      this.broadcastState({
        status: UpdateStatus.AVAILABLE,
        info: { version: latest, releaseDate: release.published_at || '' },
      });

      // Auto-download after delay
      this.autoDownloadTimer = setTimeout(() => {
        this.downloadUpdate().catch(console.error);
      }, AUTO_DOWNLOAD_DELAY_MS);
    } catch (err: any) {
      console.error('[UPDATER] Check failed:', err.message);
      this.broadcastState({ status: UpdateStatus.ERROR, error: err.message });
    }
  }

  private broadcastNotAvailable(): void {
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
  }

  private async downloadUpdate(): Promise<void> {
    if (!this.latestDownloadUrl || !this.latestVersion) return;

    const tempDir = path.join(os.tmpdir(), 'produtime-update');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const fileName = 'WOT-Produtime.exe';
    const tempPath = path.join(tempDir, fileName);

    this.broadcastState({
      status: UpdateStatus.DOWNLOADING,
      info: { version: this.latestVersion, releaseDate: '' },
      progress: { bytesPerSecond: 0, percent: 0, transferred: 0, total: 0 },
    });

    try {
      await this.downloadFile(this.latestDownloadUrl, tempPath);
    } catch (err: any) {
      // Clean up partial download
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
      this.broadcastState({ status: UpdateStatus.ERROR, error: `Download failed: ${err.message}` });
      return;
    }

    // Verify downloaded file is valid (at least 10MB for an Electron app)
    try {
      const stat = fs.statSync(tempPath);
      if (stat.size < 10 * 1024 * 1024) {
        fs.unlinkSync(tempPath);
        this.broadcastState({ status: UpdateStatus.ERROR, error: 'Downloaded file too small — incomplete download' });
        return;
      }
    } catch {
      this.broadcastState({ status: UpdateStatus.ERROR, error: 'Could not verify downloaded file' });
      return;
    }

    // Strip Mark of the Web so SmartScreen won't block it
    try { fs.unlinkSync(tempPath + ':Zone.Identifier'); } catch {}

    this.broadcastState({
      status: UpdateStatus.DOWNLOADED,
      info: { version: this.latestVersion, releaseDate: '' },
    });

    // Auto-swap after brief delay
    setTimeout(() => this.swapAndRestart(tempPath), 1500);
  }

  private downloadFile(url: string, dest: string): Promise<void> {
    const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes max

    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) { settled = true; reject(new Error('Download timed out (5 minutes)')); }
      }, DOWNLOAD_TIMEOUT_MS);

      const done = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        err ? reject(err) : resolve();
      };

      const follow = (url: string, redirects = 0) => {
        if (redirects > 5) { done(new Error('Too many redirects')); return; }

        const req = https.get(url, { headers: { 'User-Agent': `ProduTime/${app.getVersion()}` } }, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            const location = res.headers.location;
            if (location) { res.resume(); follow(location, redirects + 1); return; }
          }
          if (res.statusCode !== 200) {
            done(new Error(`HTTP ${res.statusCode}`));
            return;
          }

          const total = parseInt(res.headers['content-length'] || '0', 10);
          let transferred = 0;
          let lastBroadcast = 0;
          const file = fs.createWriteStream(dest);

          res.on('data', (chunk: Buffer) => {
            transferred += chunk.length;
            file.write(chunk);

            const now = Date.now();
            if (now - lastBroadcast > 300) {
              lastBroadcast = now;
              this.broadcastState({
                status: UpdateStatus.DOWNLOADING,
                info: { version: this.latestVersion || '', releaseDate: '' },
                progress: {
                  bytesPerSecond: 0,
                  percent: total > 0 ? (transferred / total) * 100 : 0,
                  transferred,
                  total,
                },
              });
            }
          });

          res.on('end', () => { file.end(() => done()); });
          res.on('error', (err) => { file.destroy(); done(err); });
        });
        req.on('error', (err) => done(err));
      };
      follow(url);
    });
  }

  private swapAndRestart(newExePath: string): void {
    const currentExe = app.getPath('exe');
    const currentDir = path.dirname(currentExe);
    const currentName = path.basename(currentExe);
    const backupName = currentName + '.old';
    const backupPath = path.join(currentDir, backupName);

    // Batch script: wait for exit, swap EXE, relaunch. If swap fails, restore backup.
    const batPath = path.join(os.tmpdir(), 'produtime-update.bat');
    const bat = `@echo off
timeout /t 2 /nobreak >nul
if exist "${backupPath}" del /f "${backupPath}"
ren "${currentExe}" "${backupName}"
if errorlevel 1 (
  echo Failed to rename current EXE — aborting update
  start "" "${currentExe}"
  goto cleanup
)
copy /y "${newExePath}" "${currentExe}"
if errorlevel 1 (
  echo Failed to copy new EXE — restoring backup
  ren "${backupPath}" "${currentName}"
  start "" "${currentExe}"
  goto cleanup
)
start "" "${currentExe}"
:cleanup
del /f "${newExePath}" 2>nul
del /f "%~f0"
`;

    try {
      fs.writeFileSync(batPath, bat);
    } catch (err) {
      console.error('[UPDATER] Failed to write update batch script:', err);
      this.broadcastState({ status: UpdateStatus.ERROR, error: 'Failed to prepare update script' });
      return;
    }

    try { fs.unlinkSync(batPath + ':Zone.Identifier'); } catch {}

    const { spawn } = require('child_process');
    spawn('cmd.exe', ['/c', batPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();

    app.removeAllListeners('window-all-closed');
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(w => w.removeAllListeners('close'));
    windows.forEach(w => w.close());
    app.quit();
  }

  private async fetchLatestRelease(): Promise<any> {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.github.com',
        path: `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
        headers: { 'User-Agent': `ProduTime/${app.getVersion()}` },
        timeout: 10000,
      };

      https.get(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              resolve(null);
              return;
            }
            resolve(JSON.parse(data));
          } catch { resolve(null); }
        });
        res.on('error', reject);
      }).on('error', reject);
    });
  }

  private isNewer(latest: string, current: string): boolean {
    const [lM, lm, lp] = latest.split('.').map(Number);
    const [cM, cm, cp] = current.split('.').map(Number);
    if (lM !== cM) return lM > cM;
    if (lm !== cm) return lm > cm;
    return lp > cp;
  }

  public getCurrentState(): UpdateState { return this.currentState; }

  public cleanup(): void {
    if (this.checkTimer) { clearInterval(this.checkTimer); this.checkTimer = null; }
    if (this.autoDownloadTimer) { clearTimeout(this.autoDownloadTimer); this.autoDownloadTimer = null; }

    // Clean up old backup EXE if exists
    try {
      const oldPath = app.getPath('exe') + '.old';
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    } catch { }
  }
}
