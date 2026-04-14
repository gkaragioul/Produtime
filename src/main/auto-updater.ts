/**
 * Portable Auto-Updater
 *
 * Checks GitHub releases for updates, downloads the new portable EXE
 * with progress, strips Mark of the Web, and uses a batch script to
 * swap the old EXE for the new one and relaunch.
 */

import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { UpdateStatus, UpdateState } from '../shared/types';

const GITHUB_OWNER = 'wotbyalice';
const GITHUB_REPO = 'WOT-Produtime-Releases';
const ASSET_NAME = 'WOT-Produtime.exe';
const STARTUP_CHECK_DELAY_MS = 30_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const AUTO_DOWNLOAD_DELAY_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes (100MB on slow connections)

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

      // Match exact asset name — no ambiguity
      const asset = release.assets?.find((a: any) => a.name === ASSET_NAME);
      if (!asset) {
        console.warn(`[UPDATER] Asset "${ASSET_NAME}" not found in release ${latest}`);
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
    if (!this.latestDownloadUrl || !this.latestVersion) {
      // Always broadcast error so UI button resets
      this.broadcastState({ status: UpdateStatus.ERROR, error: 'Download URL not available — try checking for updates again' });
      return;
    }

    const tempDir = path.join(os.tmpdir(), 'produtime-update');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const tempPath = path.join(tempDir, ASSET_NAME);

    this.broadcastState({
      status: UpdateStatus.DOWNLOADING,
      info: { version: this.latestVersion, releaseDate: '' },
      progress: { bytesPerSecond: 0, percent: 0, transferred: 0, total: 0 },
    });

    try {
      await this.downloadFile(this.latestDownloadUrl, tempPath);
    } catch (err: any) {
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
      this.broadcastState({ status: UpdateStatus.ERROR, error: `Download failed: ${err.message}` });
      return;
    }

    // Verify file is a valid Electron app (at least 10MB)
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
    return new Promise((resolve, reject) => {
      let settled = false;
      let fileStream: fs.WriteStream | null = null;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          fileStream?.destroy();
          reject(new Error(`Download timed out (${DOWNLOAD_TIMEOUT_MS / 60000} minutes)`));
        }
      }, DOWNLOAD_TIMEOUT_MS);

      const done = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (err) {
          fileStream?.destroy();
          reject(err);
        } else {
          resolve();
        }
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
          fileStream = fs.createWriteStream(dest);

          res.on('data', (chunk: Buffer) => {
            transferred += chunk.length;
            fileStream!.write(chunk);

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

          res.on('end', () => { fileStream!.end(() => done()); });
          res.on('error', (err) => done(err));
        });

        // Fix: destroy fileStream on request-level errors too
        req.on('error', (err) => { fileStream?.destroy(); done(err); });
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

    // Quote all paths for batch to handle spaces correctly
    const q = (p: string) => `"${p}"`;

    const bat = `@echo off
timeout /t 2 /nobreak >nul
if exist ${q(backupPath)} del /f ${q(backupPath)}
ren ${q(currentExe)} "${backupName}"
if errorlevel 1 (
  echo [UPDATER] ERROR: Failed to rename current EXE
  if exist ${q(currentExe)} start "" ${q(currentExe)}
  goto cleanup
)
copy /y ${q(newExePath)} ${q(currentExe)}
if errorlevel 1 (
  echo [UPDATER] ERROR: Failed to copy new EXE - restoring backup
  ren ${q(backupPath)} "${currentName}"
  if exist ${q(currentExe)} start "" ${q(currentExe)}
  goto cleanup
)
if not exist ${q(currentExe)} (
  echo [UPDATER] ERROR: EXE missing after copy - restoring backup
  ren ${q(backupPath)} "${currentName}"
  if exist ${q(currentExe)} start "" ${q(currentExe)}
  goto cleanup
)
start "" ${q(currentExe)}
:cleanup
del /f ${q(newExePath)} 2>nul
del /f "%~f0"
`;

    try {
      fs.writeFileSync(batPath(), bat, 'utf8');
    } catch (err) {
      console.error('[UPDATER] Failed to write batch script:', err);
      this.broadcastState({ status: UpdateStatus.ERROR, error: 'Failed to prepare update script' });
      return;
    }

    try { fs.unlinkSync(batPath() + ':Zone.Identifier'); } catch {}

    const { spawn } = require('child_process');
    spawn('cmd.exe', ['/c', batPath()], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();

    // Force-close all windows with timeout fallback
    app.removeAllListeners('window-all-closed');
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(w => {
      w.removeAllListeners('close');
      w.close();
    });

    // Force quit after 2 seconds regardless
    setTimeout(() => {
      BrowserWindow.getAllWindows().forEach(w => { try { w.destroy(); } catch {} });
      app.quit();
    }, 2000);
  }

  private async fetchLatestRelease(): Promise<any> {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.github.com',
        path: `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
        headers: { 'User-Agent': `ProduTime/${app.getVersion()}` },
        timeout: 10000,
      };

      const req = https.get(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            if (res.statusCode === 403 || res.statusCode === 429) {
              // Rate-limited — treat as no update available (not an error)
              console.warn('[UPDATER] GitHub API rate-limited, skipping check');
              resolve(null);
              return;
            }
            if (res.statusCode !== 200) { resolve(null); return; }
            resolve(JSON.parse(data));
          } catch { resolve(null); }
        });
        res.on('error', reject);
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('GitHub API timeout')); });
    });
  }

  private isNewer(latest: string, current: string): boolean {
    const parse = (v: string) => {
      const m = v.match(/^v?(\d+)\.(\d+)\.(\d+)/);
      return m ? [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])] : [0, 0, 0];
    };
    const [lM, lm, lp] = parse(latest);
    const [cM, cm, cp] = parse(current);
    if (lM !== cM) return lM > cM;
    if (lm !== cm) return lm > cm;
    return lp > cp;
  }

  public getCurrentState(): UpdateState { return this.currentState; }

  public cleanup(): void {
    if (this.checkTimer) { clearInterval(this.checkTimer); this.checkTimer = null; }
    if (this.autoDownloadTimer) { clearTimeout(this.autoDownloadTimer); this.autoDownloadTimer = null; }
    try {
      const oldPath = app.getPath('exe') + '.old';
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    } catch {}
  }
}

function batPath(): string {
  return path.join(os.tmpdir(), 'produtime-update.bat');
}
