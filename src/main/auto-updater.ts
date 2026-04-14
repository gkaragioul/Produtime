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
const STARTUP_CHECK_DELAY_MS = 10_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const AUTO_DOWNLOAD_DELAY_MS = 2_000; // Reduced from 30s — download almost immediately
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;
const TEMP_DIR = () => path.join(os.tmpdir(), 'produtime-update');
const TEMP_PATH = () => path.join(TEMP_DIR(), ASSET_NAME);
const BAT_LOG = () => path.join(os.tmpdir(), 'produtime-update.log');

export class AutoUpdaterManager {
  private mainWindow: BrowserWindow | null = null;
  private checkTimer: NodeJS.Timeout | null = null;
  private autoDownloadTimer: NodeJS.Timeout | null = null;
  private currentState: UpdateState = { status: UpdateStatus.NOT_AVAILABLE };
  private isManualCheck = false;
  private isDownloading = false; // prevents concurrent downloads
  private latestDownloadUrl: string | null = null;
  private latestVersion: string | null = null;
  private pendingUpdatePath: string | null = null;

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
    this.registerIPC();
    // Safe to call even before window is fully ready — swapAndRestart only uses app.quit()
    this.resumePendingUpdate();
    this.startSchedule();
  }

  /**
   * On startup, check if a valid update was already downloaded
   * but the swap failed (e.g. EXE was locked). Skip if it's the same version.
   */
  private resumePendingUpdate(): void {
    try {
      const tempPath = TEMP_PATH();
      const versionFile = tempPath + '.version';

      if (!fs.existsSync(tempPath)) return;

      const stat = fs.statSync(tempPath);
      if (stat.size < 10 * 1024 * 1024) {
        // Partial/corrupt — clean up
        try { fs.unlinkSync(tempPath); } catch {}
        try { fs.unlinkSync(versionFile); } catch {}
        return;
      }

      // Skip if it's the same version we're already running
      if (fs.existsSync(versionFile)) {
        const savedVersion = fs.readFileSync(versionFile, 'utf8').trim();
        if (savedVersion === app.getVersion()) {
          console.log('[UPDATER] Pre-downloaded file matches current version — cleaning up');
          try { fs.unlinkSync(tempPath); } catch {}
          try { fs.unlinkSync(versionFile); } catch {}
          return;
        }
      }

      console.log('[UPDATER] Found pre-downloaded update — retrying swap in 5s');
      this.pendingUpdatePath = tempPath;
      setTimeout(() => {
        if (this.pendingUpdatePath) {
          console.log('[UPDATER] Retrying swap from previous download');
          this.swapAndRestart(this.pendingUpdatePath);
        }
      }, 5000);
    } catch (err) {
      console.warn('[UPDATER] resumePendingUpdate error:', err);
    }
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
      return { success: true };
    });

    ipcMain.handle('updater:getStatus', async () => {
      return { success: true, data: this.currentState };
    });
  }

  private broadcastState(state: UpdateState): void {
    this.currentState = state;
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      try {
        this.mainWindow.webContents.send('updater:statusChanged', state);
      } catch (err) {
        console.warn('[UPDATER] Failed to broadcast state (renderer may be frozen):', (err as Error).message);
        // If we were signalling DOWNLOADED, force the swap anyway
        if (state.status === UpdateStatus.DOWNLOADED && this.pendingUpdatePath) {
          const p = this.pendingUpdatePath;
          setTimeout(() => this.swapAndRestart(p), 1500);
        }
      }
    }
  }

  private startSchedule(): void {
    let retries = 0;
    const scheduleCheck = (delay: number) => {
      setTimeout(async () => {
        try {
          await this.checkForUpdates();
        } catch (err: any) {
          // Retry on failure (network may not be ready at startup)
          if (retries < 4) {
            retries++;
            scheduleCheck(STARTUP_CHECK_DELAY_MS * Math.pow(2, retries - 1));
          }
        }
      }, delay);
    };
    scheduleCheck(STARTUP_CHECK_DELAY_MS);
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

      const asset = release.assets?.find((a: any) => a.name === ASSET_NAME);
      if (!asset) {
        console.warn(`[UPDATER] Asset "${ASSET_NAME}" not found in release ${latest}`);
        this.broadcastNotAvailable();
        return;
      }

      this.latestVersion = latest;
      this.latestDownloadUrl = asset.browser_download_url;
      this.isManualCheck = false; // reset here so interval checks don't show false dialogs

      this.broadcastState({
        status: UpdateStatus.AVAILABLE,
        info: { version: latest, releaseDate: release.published_at || '' },
      });

      // Start download quickly — don't wait 30s (app may crash before then)
      if (this.autoDownloadTimer) clearTimeout(this.autoDownloadTimer);
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
    // Prevent concurrent downloads
    if (this.isDownloading) {
      console.warn('[UPDATER] Download already in progress');
      return;
    }

    if (!this.latestDownloadUrl || !this.latestVersion) {
      this.broadcastState({ status: UpdateStatus.ERROR, error: 'Download URL not available — try checking for updates again' });
      return;
    }

    this.isDownloading = true;
    try {
      const tempDir = TEMP_DIR();
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
      const tempPath = TEMP_PATH();

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

      // Verify file size
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

      // Save version marker so resumePendingUpdate can skip same-version retries
      try { fs.writeFileSync(tempPath + '.version', this.latestVersion, 'utf8'); } catch {}

      // Strip Mark of the Web
      try { fs.unlinkSync(tempPath + ':Zone.Identifier'); } catch {}

      this.pendingUpdatePath = tempPath;

      this.broadcastState({
        status: UpdateStatus.DOWNLOADED,
        info: { version: this.latestVersion, releaseDate: '' },
      });

      setTimeout(() => {
        const p = this.pendingUpdatePath;
        if (p) this.swapAndRestart(p);
      }, 1500);
    } finally {
      this.isDownloading = false;
    }
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
        if (err) { fileStream?.destroy(); reject(err); } else { resolve(); }
      };

      const follow = (url: string, redirects = 0) => {
        if (redirects > 5) { done(new Error('Too many redirects')); return; }

        const req = https.get(url, { headers: { 'User-Agent': `ProduTime/${app.getVersion()}` } }, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            const location = res.headers.location;
            if (location) { res.resume(); follow(location, redirects + 1); return; }
          }
          if (res.statusCode !== 200) { done(new Error(`HTTP ${res.statusCode}`)); return; }

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
        req.on('error', (err) => { fileStream?.destroy(); done(err); });
      };

      follow(url);
    });
  }

  private swapAndRestart(newExePath: string): void {
    // Stop all timers — no further checks during shutdown
    if (this.checkTimer) { clearInterval(this.checkTimer); this.checkTimer = null; }
    if (this.autoDownloadTimer) { clearTimeout(this.autoDownloadTimer); this.autoDownloadTimer = null; }

    const currentExe = app.getPath('exe');
    const currentName = path.basename(currentExe);
    const backupName = currentName + '.old';
    const backupPath = path.join(path.dirname(currentExe), backupName);
    const q = (p: string) => `"${p}"`;

    const bat = `@echo off
echo [%date% %time%] ProduTime update starting >> "${BAT_LOG()}"
timeout /t 3 /nobreak >nul
if exist ${q(backupPath)} del /f ${q(backupPath)}
ren ${q(currentExe)} "${backupName}"
if errorlevel 1 (
  echo [%date% %time%] ERROR: rename failed >> "${BAT_LOG()}"
  if exist ${q(currentExe)} start "" ${q(currentExe)}
  goto cleanup
)
copy /y ${q(newExePath)} ${q(currentExe)}
if errorlevel 1 (
  echo [%date% %time%] ERROR: copy failed, restoring >> "${BAT_LOG()}"
  ren ${q(backupPath)} "${currentName}"
  if exist ${q(currentExe)} start "" ${q(currentExe)}
  goto cleanup
)
if not exist ${q(currentExe)} (
  echo [%date% %time%] ERROR: EXE missing, restoring >> "${BAT_LOG()}"
  ren ${q(backupPath)} "${currentName}"
  if exist ${q(currentExe)} start "" ${q(currentExe)}
  goto cleanup
)
echo [%date% %time%] Update successful, launching >> "${BAT_LOG()}"
start "" ${q(currentExe)}
:cleanup
del /f ${q(newExePath)} 2>nul
del /f "${newExePath}.version" 2>nul
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

    this.pendingUpdatePath = null;

    const { spawn } = require('child_process');
    // Use stdio:'ignore' for proper detachment — logs are written by the batch script itself
    const proc = spawn('cmd.exe', ['/c', batPath()], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    proc.on('error', (err: Error) => {
      try { fs.appendFileSync(BAT_LOG(), `[SPAWN_ERROR] ${err.message}\n`); } catch {}
    });
    proc.unref();

    app.removeAllListeners('window-all-closed');
    BrowserWindow.getAllWindows().forEach(w => {
      w.removeAllListeners('close');
      w.close();
    });

    // Force quit after 3s — batch script needs 3s to wait for process exit
    setTimeout(() => {
      BrowserWindow.getAllWindows().forEach(w => { try { w.destroy(); } catch {} });
      app.quit();
    }, 3000);
  }

  private async fetchLatestRelease(): Promise<any> {
    return new Promise((resolve, reject) => {
      const req = https.get({
        hostname: 'api.github.com',
        path: `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
        headers: { 'User-Agent': `ProduTime/${app.getVersion()}` },
        timeout: 10000,
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            if (res.statusCode === 403 || res.statusCode === 429) {
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
