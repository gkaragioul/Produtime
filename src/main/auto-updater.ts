import { autoUpdater } from 'electron-updater';
import { app, BrowserWindow, dialog, Notification } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';
import { spawn } from 'child_process';
import { logger } from './logger';
import { DeviceIdService } from './services/device-id-service';
import { DatabaseManager } from './database';
import {
  UpdateStatus,
  UpdateState,
  UpdateInfo,
  UpdateProgress,
} from '../shared/types';

// Configuration constants
const UPDATE_CHECK_CONFIG = {
  API_TIMEOUT_MS: 30000, // 30 seconds for API calls
  DOWNLOAD_TIMEOUT_MS: 600000, // 10 minutes for large file downloads (was 5 min)
  PROGRESS_TIMEOUT_MS: 60000, // 60 seconds of no progress = stalled (was 30s, too aggressive for slow connections)
  MIN_PROGRESS_TIMEOUT_MS: 30000, // Minimum stall timeout
  MAX_PROGRESS_TIMEOUT_MS: 120000, // Maximum stall timeout for very large files
  MAX_RETRIES: 3,
  RETRY_DELAYS_MS: [1000, 2000, 5000], // Progressive delays: 1s, 2s, 5s
  BACKGROUND_CHECK_INTERVAL_MS: 24 * 60 * 60 * 1000, // 24 hours
  STARTUP_CHECK_DELAY_MS: 30000, // 30 seconds after startup
  MAX_URL_FALLBACK_RETRIES: 2, // Max retries when falling back to default URL
  RETRYABLE_ERROR_CODES: [
    'ETIMEDOUT',
    'ECONNRESET',
    'ENOTFOUND',
    'ECONNREFUSED',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'EAI_AGAIN',
  ],
};

// Default public License Manager base URL (used when no stored URL or to recover)
// Using HTTPS for security. Configure via environment variable in production.
const DEFAULT_PUBLIC_LM_BASE = process.env.LICENSE_MANAGER_URL || 'https://license.produtime.com';

interface RetryOptions {
  maxRetries: number;
  retryDelays: number[];
  retryOn: string[];
}

interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number;
}

export class AutoUpdaterManager {
  private mainWindow: BrowserWindow | null = null;
  private currentState: UpdateState = { status: UpdateStatus.NOT_AVAILABLE };
  private isUpdateInProgress = false;
  private backgroundCheckTimer: NodeJS.Timeout | null = null;
  private lastCheckTime: Date | null = null;
  private database?: DatabaseManager;

  constructor(mainWindow: BrowserWindow, database?: DatabaseManager) {
    this.mainWindow = mainWindow;
    this.database = database;
    this.initializeUpdater();
    this.startBackgroundChecks();
  }

  private initializeUpdater(): void {
    // Configure auto-updater
    autoUpdater.autoDownload = false; // We'll control downloads manually
    autoUpdater.autoInstallOnAppQuit = true;

    // Set up event listeners
    this.setupEventListeners();

    logger.info('UPDATER', 'Auto-updater initialized', {
      backgroundCheckInterval:
        UPDATE_CHECK_CONFIG.BACKGROUND_CHECK_INTERVAL_MS / (60 * 60 * 1000) +
        ' hours',
      apiTimeout: UPDATE_CHECK_CONFIG.API_TIMEOUT_MS / 1000 + ' seconds',
      maxRetries: UPDATE_CHECK_CONFIG.MAX_RETRIES,
    });
  }

  private startBackgroundChecks(): void {
    // BUG FIX #5: Add .catch() handlers to prevent unhandled promise rejections
    // Check on startup (after delay to avoid startup congestion)
    setTimeout(() => {
      logger.info('UPDATER', 'Running startup background update check');
      this.silentCheckForUpdates().catch((error) => {
        logger.error('UPDATER', 'Startup background check failed', { error });
      });
    }, UPDATE_CHECK_CONFIG.STARTUP_CHECK_DELAY_MS);

    // Schedule periodic checks
    this.backgroundCheckTimer = setInterval(() => {
      logger.info('UPDATER', 'Running scheduled background update check');
      this.silentCheckForUpdates().catch((error) => {
        logger.error('UPDATER', 'Scheduled background check failed', { error });
      });
    }, UPDATE_CHECK_CONFIG.BACKGROUND_CHECK_INTERVAL_MS);

    logger.info('UPDATER', 'Background update checks enabled', {
      intervalHours:
        UPDATE_CHECK_CONFIG.BACKGROUND_CHECK_INTERVAL_MS / (60 * 60 * 1000),
      startupDelaySeconds: UPDATE_CHECK_CONFIG.STARTUP_CHECK_DELAY_MS / 1000,
    });
  }

  private async silentCheckForUpdates(): Promise<void> {
    try {
      this.lastCheckTime = new Date();
      logger.info('UPDATER', 'Silent background check started', {
        timestamp: this.lastCheckTime.toISOString(),
      });

      if (this.isPortableWindows()) {
        await this.portableCheckForUpdates();

        // Only show notification if update available
        if (this.currentState.status === UpdateStatus.AVAILABLE) {
          const info = this.currentState.info;

          logger.info('UPDATER', 'Background check found update', {
            version: info?.version,
            currentVersion: app.getVersion(),
          });

          // Show system notification
          try {
            const notification = new Notification({
              title: 'ProduTime Update Available',
              body: `Version ${info?.version} is available. Click to download.`,
              silent: false,
            });

            notification.on('click', () => {
              logger.info('UPDATER', 'User clicked update notification');
              this.showUpdateDialog();
            });

            notification.show();
          } catch (notifError) {
            logger.error('UPDATER', 'Failed to show notification', notifError);
          }
        } else {
          logger.info('UPDATER', 'Background check: no update available');
        }
      }
    } catch (error) {
      // Silent failure - don't bother user with background check errors
      logger.error('UPDATER', 'Background check failed (silent)', error);
    }
  }

  private async showUpdateDialog(): Promise<void> {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      logger.warn(
        'UPDATER',
        'Cannot show update dialog - window not available'
      );
      return;
    }

    const info = this.currentState.info;
    const response = await dialog.showMessageBox(this.mainWindow, {
      type: 'info',
      title: 'Update Available',
      message: `Version ${info?.version} is available!`,
      detail: `Current version: ${app.getVersion()}\nNew version: ${info?.version}\n\nWould you like to download it now?`,
      buttons: ['Download', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });

    if (response.response === 0) {
      try {
        await this.downloadUpdate();
        await this.installUpdate();
      } catch (e) {
        logger.error('UPDATER', 'Download/install failed from notification', e);
        await dialog.showMessageBox(this.mainWindow, {
          type: 'error',
          title: 'Update Failed',
          message: 'Failed to download or install update',
          detail: String(e),
          buttons: ['OK'],
        });
      }
    }
  }

  private setupEventListeners(): void {
    autoUpdater.on('checking-for-update', () => {
      console.log('Checking for updates...');
      this.updateState({ status: UpdateStatus.CHECKING });
    });

    autoUpdater.on('update-available', (info) => {
      console.log('Update available:', info);
      const updateInfo: UpdateInfo = {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: info.releaseNotes as string,
      };
      this.updateState({
        status: UpdateStatus.AVAILABLE,
        info: updateInfo,
      });
    });

    autoUpdater.on('update-not-available', (info) => {
      console.log('Update not available:', info);
      this.updateState({ status: UpdateStatus.NOT_AVAILABLE });
    });

    autoUpdater.on('error', (error) => {
      console.error('Auto-updater error:', error);
      this.updateState({
        status: UpdateStatus.ERROR,
        error: error.message,
      });
    });

    autoUpdater.on('download-progress', (progressObj) => {
      console.log('Download progress:', progressObj);
      const progress: UpdateProgress = {
        bytesPerSecond: progressObj.bytesPerSecond,
        percent: progressObj.percent,
        transferred: progressObj.transferred,
        total: progressObj.total,
      };
      this.updateState({
        status: UpdateStatus.DOWNLOADING,
        progress,
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      console.log('Update downloaded:', info);
      const updateInfo: UpdateInfo = {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: info.releaseNotes as string,
      };
      this.updateState({
        status: UpdateStatus.DOWNLOADED,
        info: updateInfo,
      });
      this.isUpdateInProgress = false;
    });
  }

  private updateState(newState: Partial<UpdateState>): void {
    this.currentState = { ...this.currentState, ...newState };

    // Notify renderer process
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(
        'updater:statusChanged',
        this.currentState
      );
    }
  }

  public async checkForUpdates(): Promise<void> {
    logger.info('UPDATER', 'checkForUpdates called');
    try {
      if (this.isUpdateInProgress) {
        throw new Error('Update operation already in progress');
      }

      const isWindows = process.platform === 'win32';
      const isPortable = this.isPortableWindows();
      logger.info('UPDATER', 'Update channel selection', {
        isWindows,
        isPortable,
      });

      if (isWindows) {
        logger.info('UPDATER', 'Running License Manager update check (Windows)');
        await this.portableCheckForUpdates();

        logger.info('UPDATER', 'Portable check completed, status', {
          status: this.currentState.status,
        });

        // Show result to user
        if (this.currentState.status === UpdateStatus.AVAILABLE && this.mainWindow && !this.mainWindow.isDestroyed()) {
          logger.info('UPDATER', 'Update available, showing dialog');
          const info = this.currentState.info;
          const response = await dialog.showMessageBox(this.mainWindow, {
            type: 'info',
            title: 'Update Available',
            message: `Version ${info?.version} is available!`,
            detail: `Current version: ${app.getVersion()}\nNew version: ${info?.version}\n\nWould you like to download it now?`,
            buttons: ['Download', 'Later'],
            defaultId: 0,
            cancelId: 1,
          });
          logger.info('UPDATER', 'User response', {
            response: response.response,
          });
          if (response.response === 0) {
            try {
              await this.downloadUpdate();
              // After successful download, immediately prompt to install
              await this.installUpdate();
            } catch (e) {
              logger.error('UPDATER', 'Download failed', e);
              await dialog.showMessageBox(this.mainWindow!, {
                type: 'error',
                title: 'Download Failed',
                message: 'Failed to download update',
                detail: String(e),
                buttons: ['OK'],
              });
            }
          }
        } else if (this.currentState.status === UpdateStatus.NOT_AVAILABLE) {
          logger.info('UPDATER', 'No update available, showing dialog');
          await dialog.showMessageBox(this.mainWindow!, {
            type: 'info',
            title: 'No Updates',
            message: 'You are running the latest version.',
            detail: `Current version: ${app.getVersion()}`,
            buttons: ['OK'],
          });
          logger.info('UPDATER', 'No update dialog closed');
        } else if (this.currentState.status === UpdateStatus.ERROR) {
          logger.error('UPDATER', 'Update check resulted in error status', {
            error: this.currentState.error,
          });

          // Provide user-friendly error message with actionable guidance
          const errorDetail = this.getUserFriendlyErrorMessage(
            this.currentState.error || 'Unknown error'
          );

          // Check if this is a license manager offline error (less severe)
          const errorLower = (this.currentState.error || '').toLowerCase();
          const isLicenseManagerOffline =
            (errorLower.includes('econnrefused') ||
              errorLower.includes('etimedout') ||
              errorLower.includes('aggregateerror') ||
              errorLower.includes('enotfound') ||
              errorLower.includes('econnreset')) &&
            (errorLower.includes('localhost') ||
              errorLower.includes('127.0.0.1') ||
              errorLower.includes('192.168') ||
              errorLower.includes(':3000'));

          await dialog.showMessageBox(this.mainWindow!, {
            type: isLicenseManagerOffline ? 'info' : 'error',
            title: isLicenseManagerOffline
              ? 'License Manager Offline'
              : 'Update Check Failed',
            message: isLicenseManagerOffline
              ? 'License Manager server is not available. You are running the latest version.'
              : 'Unable to check for updates',
            detail: errorDetail,
            buttons: ['OK'],
          });
        } else {
          logger.warn('UPDATER', 'Unexpected status after check', {
            status: this.currentState.status,
          });
        }
      } else {
        logger.info('UPDATER', 'Running standard electron-updater check');
        await autoUpdater.checkForUpdates();
      }
    } catch (error) {
      logger.error('UPDATER', 'Exception in checkForUpdates', error);
      this.updateState({
        status: UpdateStatus.ERROR,
        error: `Failed to check for updates: ${error}`,
      });
      // Show error to user
      await dialog.showMessageBox(this.mainWindow!, {
        type: 'error',
        title: 'Update Check Failed',
        message: 'Failed to check for updates',
        detail: String(error),
        buttons: ['OK'],
      });
      throw error;
    }
  }

  public async downloadUpdate(): Promise<void> {
    try {
      if (this.currentState.status !== UpdateStatus.AVAILABLE) {
        throw new Error('No update available to download');
      }

      if (this.isUpdateInProgress) {
        throw new Error('Update operation already in progress');
      }

      this.isUpdateInProgress = true;
      console.log('Starting update download...');

      if (process.platform === 'win32') {
        await this.portableDownloadUpdate();
      } else {
        await autoUpdater.downloadUpdate();
      }
    } catch (error) {
      console.error('Error downloading update:', error);
      this.isUpdateInProgress = false;
      this.updateState({
        status: UpdateStatus.ERROR,
        error: `Failed to download update: ${error}`,
      });
      throw error;
    }
  }

  public async installUpdate(): Promise<void> {
    try {
      if (this.currentState.status !== UpdateStatus.DOWNLOADED) {
        throw new Error('No update downloaded to install');
      }

      console.log('Installing update and restarting...');

      const showShortcutCheckbox = process.platform === 'win32';
      const response = await dialog.showMessageBox(this.mainWindow!, {
        type: 'info',
        title: 'Install Update',
        message:
          'Update is ready. The application will restart and switch to the new version.',
        buttons: ['Restart and Switch', 'Later'],
        defaultId: 0,
        cancelId: 1,
        checkboxLabel: showShortcutCheckbox
          ? 'Update desktop shortcut (if found)'
          : undefined,
        checkboxChecked: showShortcutCheckbox ? true : undefined,
      });

      if (response.response === 0) {
        if (process.platform === 'win32') {
          const updateShortcuts =
            showShortcutCheckbox && response.checkboxChecked !== undefined
              ? !!response.checkboxChecked
              : true;
          await this.portableInstallUpdate(updateShortcuts);
          return; // portable path quits app
        } else {
          autoUpdater.quitAndInstall();
          return;
        }
      } else {
        console.log('User chose to install later');
      }
    } catch (error) {
      console.error('Error installing update:', error);
      this.updateState({
        status: UpdateStatus.ERROR,
        error: `Failed to install update: ${error}`,
      });
      throw error;
    }
  }

  // ===== Portable (Windows) custom updater helpers =====
  private isPortableWindows(): boolean {
    if (process.platform !== 'win32') {
      return false;
    }

    // Detection logic for portable vs installed builds:
    // 1. Check for PORTABLE_EXECUTABLE_DIR (single-file portable)
    // 2. Check for NSIS uninstaller (MUST check before Program Files!)
    // 3. Check for Windows Registry installation entry
    // 4. Check if running from Program Files (likely installed)
    // 5. Default to portable for our builds

    // Single-file portable builds set this environment variable
    if (process.env.PORTABLE_EXECUTABLE_DIR) {
      logger.info('UPDATER', 'Detected single-file portable build');
      return true;
    }

    const appDir = path.dirname(app.getPath('exe'));
    const exePath = app.getPath('exe').toLowerCase();
    
    // Check for NSIS uninstaller (indicates installed build)
    // CRITICAL: Must check BEFORE Program Files check to detect NSIS installs correctly
    const uninstallerPath = path.join(appDir, 'Uninstall ProduTime.exe');

    if (fs.existsSync(uninstallerPath)) {
      logger.info(
        'UPDATER',
        'Detected NSIS installation - using License Manager updater for all builds'
      );
      // Return true to force License Manager updater for NSIS builds
      // This unifies update distribution through License Manager instead of GitHub
      return true;
    }

    // Check if running from Program Files (typical installation location)
    const isProgramFiles =
      exePath.includes('program files') ||
      exePath.includes('program files (x86)');

    if (isProgramFiles) {
      // Additional check: look for common installation markers even without uninstaller
      const hasResourcesFolder = fs.existsSync(path.join(appDir, 'resources'));
      const hasLocalesFolder = fs.existsSync(path.join(appDir, 'locales'));
      const isTypicalInstall = hasResourcesFolder && hasLocalesFolder;
      
      if (isTypicalInstall) {
        logger.info(
          'UPDATER',
          'Installation in Program Files with typical structure - using License Manager updater',
          { appDir, hasResourcesFolder, hasLocalesFolder }
        );
        // Use License Manager updater for Program Files installs too
        // This ensures consistent update experience
        return true;
      }
      
      logger.info(
        'UPDATER',
        'Installation in Program Files without typical structure - using GitHub updater'
      );
      return false;
    }

    // Default: treat as portable (our current build target)
    logger.info(
      'UPDATER',
      'No installation markers found - using portable updater',
      {
        exePath: app.getPath('exe'),
        resourcesPath: process.resourcesPath,
      }
    );
    return true;
  }

  /**
   * Compare semantic versions with validation
   * Returns: 1 if a > b, -1 if a < b, 0 if equal
   */
  private compareVersions(a: string, b: string): number {
    // Remove 'v' prefix if present
    const cleanA = a.replace(/^v/i, '');
    const cleanB = b.replace(/^v/i, '');

    // Remove pre-release and build metadata (e.g., "1.6.6-beta+build.123" -> "1.6.6")
    const versionOnlyA = cleanA.split(/[-+]/)[0];
    const versionOnlyB = cleanB.split(/[-+]/)[0];

    // Validate version format
    const versionRegex = /^\d+(\.\d+)*$/;
    if (!versionRegex.test(versionOnlyA)) {
      logger.warn('UPDATER', 'Invalid version format', { version: a });
      return 0; // Treat as equal if invalid
    }
    if (!versionRegex.test(versionOnlyB)) {
      logger.warn('UPDATER', 'Invalid version format', { version: b });
      return 0; // Treat as equal if invalid
    }

    const pa = versionOnlyA.split('.').map((n) => {
      const parsed = parseInt(n, 10);
      return isNaN(parsed) ? 0 : parsed;
    });
    const pb = versionOnlyB.split('.').map((n) => {
      const parsed = parseInt(n, 10);
      return isNaN(parsed) ? 0 : parsed;
    });

    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const da = pa[i] || 0;
      const db = pb[i] || 0;
      if (da > db) return 1;
      if (da < db) return -1;
    }
    return 0;
  }

  private async portableCheckForUpdates(
    isRetry: boolean = false,
    retryCount: number = 0
  ): Promise<void> {
    let licenseManagerUrl = '';
    try {
      this.updateState({ status: UpdateStatus.CHECKING });
      licenseManagerUrl = this.getLicenseManagerUrl();
      const currentVersion = app.getVersion();
      const updatePreference = this.getUpdatePreference();
      const query = new URLSearchParams({
        version: currentVersion,
        type: updatePreference.type,
      });
      const checkUrl = `${licenseManagerUrl}/api/updates/check?${query.toString()}`;

      logger.info('UPDATER', 'Checking for updates from License Manager', {
        licenseManagerUrl,
        currentVersion,
        updateType: updatePreference.type,
        checkUrl,
        isRetry,
        retryCount,
      });

      // Use retry logic for API call
      const updateInfo = await this.fetchJsonWithRetry(checkUrl, ''); // No token needed

      logger.info('UPDATER', 'Update check response from License Manager', {
        hasUpdate: updateInfo.hasUpdate,
        latestVersion: updateInfo.latestVersion,
        currentVersion: updateInfo.currentVersion,
      });

      // If no update available, return early
      if (!updateInfo.hasUpdate) {
        logger.info('UPDATER', 'Already on latest version');
        this.updateState({ status: UpdateStatus.NOT_AVAILABLE });
        return;
      }

      // Update is available
      const updateData = updateInfo.update;
      if (!updateData) {
        throw new Error('Update info missing from response');
      }

      logger.info('UPDATER', 'Update available', {
        latestVersion: updateData.version,
        fileName: updateData.fileName,
        fileSize: updateData.fileSize,
        releaseNotes: updateData.releaseNotes,
        sha256: updateData.sha256 || 'not provided',
      });

      // Create update info for the available update
      // Include device ID and client version for download tracking
      const deviceId = this.getDeviceId();
      const clientVersion = app.getVersion();
      const downloadUrl = `${licenseManagerUrl}/api/updates/download/${updateData.version}?deviceId=${encodeURIComponent(deviceId)}&clientVersion=${encodeURIComponent(clientVersion)}&type=${encodeURIComponent(updatePreference.type)}`;

      const info: UpdateInfo = {
        version: updateData.version,
        releaseDate: updateData.uploadedAt,
        releaseNotes: updateData.releaseNotes || '',
        downloadUrl,
        assetName: updateData.fileName,
        sha256: updateData.sha256, // Include SHA256 for verification if provided
        fileSize: updateData.fileSize, // Include expected file size
      };

      this.updateState({ status: UpdateStatus.AVAILABLE, info });
    } catch (err: any) {
      logger.error('UPDATER', 'License Manager check failed', {
        error: err.message,
        licenseManagerUrl,
        isRetry,
        retryCount,
      });

      // Fallback: retry using default public License Manager base (with retry limit)
      const defaultBase = DEFAULT_PUBLIC_LM_BASE.replace(/\/$/, '');
      const canRetry = !isRetry && 
                       licenseManagerUrl !== defaultBase && 
                       retryCount < UPDATE_CHECK_CONFIG.MAX_URL_FALLBACK_RETRIES;
      
      if (canRetry) {
        try {
          this.database?.bulkUpdateSettings({
            activation_server_url: defaultBase + '/activate',
            validation_server_url: defaultBase + '/validate',
          });
        } catch (err) {
          logger.warn('UPDATER', 'Failed to update server URLs:', err);
        }
        logger.info(
          'UPDATER',
          'Retrying update check with default public URL',
          { defaultBase, retryCount: retryCount + 1 }
        );
        return await this.portableCheckForUpdates(true, retryCount + 1);
      }

      // Max retries reached or already on default URL
      if (retryCount >= UPDATE_CHECK_CONFIG.MAX_URL_FALLBACK_RETRIES) {
        logger.warn('UPDATER', 'Max URL fallback retries reached', {
          maxRetries: UPDATE_CHECK_CONFIG.MAX_URL_FALLBACK_RETRIES,
          retryCount,
        });
      }

      this.updateState({ status: UpdateStatus.ERROR, error: String(err) });
      throw err;
    }
  }

  private async portableDownloadUpdate(): Promise<void> {
    try {
      const info = this.currentState.info;
      if (!info?.downloadUrl || !info.version)
        throw new Error('Missing update info');

      const userData = app.getPath('userData');
      const stageDir = path.join(userData, 'updates', `v${info.version}`);
      fs.mkdirSync(stageDir, { recursive: true });
      const fileName = info.assetName || `ProduTime-${info.version}.zip`;
      const dest = path.join(stageDir, fileName);

      logger.info('UPDATER', 'Starting update download from License Manager', {
        downloadUrl: info.downloadUrl,
        dest,
        version: info.version,
        assetName: info.assetName,
        expectedSha256: info.sha256 || 'not provided',
      });

      await this.downloadToFile(info.downloadUrl!, dest, '', (progress) => {
        this.updateState({ status: UpdateStatus.DOWNLOADING, progress });
      });

      // Verify SHA256 checksum if provided
      if (info.sha256) {
        logger.info('UPDATER', 'Verifying SHA256 checksum');
        const actualHash = await this.calculateFileSha256(dest);
        const expectedHash = info.sha256.toLowerCase();
        
        if (actualHash !== expectedHash) {
          // Delete corrupted file
          try {
            fs.unlinkSync(dest);
          } catch (err) {
            logger.warn('UPDATER', 'Failed to delete corrupted file:', err);
          }

          const error = new Error(
            `SHA256 checksum mismatch: expected ${expectedHash}, got ${actualHash}`
          );
          logger.error('UPDATER', 'Checksum verification failed', {
            expected: expectedHash,
            actual: actualHash,
            dest,
          });
          throw error;
        }
        
        logger.info('UPDATER', 'SHA256 checksum verified successfully', {
          hash: actualHash,
        });
      } else {
        logger.warn('UPDATER', 'No SHA256 checksum provided, skipping verification');
      }

      // Mark downloaded
      this.updateState({
        status: UpdateStatus.DOWNLOADED,
        info: { ...info, downloadUrl: dest },
      });
      this.isUpdateInProgress = false;
    } catch (err: any) {
      this.isUpdateInProgress = false;
      this.updateState({ status: UpdateStatus.ERROR, error: String(err) });
      throw err;
    }
  }

  /**
   * Calculate SHA256 hash of a file
   */
  private calculateFileSha256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      
      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', (err) => reject(err));
    });
  }

  private getRuntimeAppDir(): string {
    const resourcesPath = process.resourcesPath;
    const runtimeExe = path.join(path.dirname(resourcesPath), 'ProduTime.exe');
    return path.dirname(runtimeExe);
  }

  private getUpdatePreference(): {
    type: 'installer' | 'portable';
    appDir: string;
    isProgramFiles: boolean;
    canWrite: boolean;
    isNsisInstall: boolean;
  } {
    const appDir = this.getRuntimeAppDir();
    const installPath = appDir.toLowerCase();
    const isProgramFiles =
      installPath.includes('\\program files\\') ||
      installPath.includes('\\program files (x86)\\');

    // Check for NSIS uninstaller to detect NSIS installations
    const uninstallerPath = path.join(appDir, 'Uninstall ProduTime.exe');
    const isNsisInstall = fs.existsSync(uninstallerPath);

    const canWrite = (() => {
      try {
        fs.accessSync(appDir, fs.constants.W_OK);
        return true;
      } catch {
        return false;
      }
    })();

    // Use installer type if:
    // 1. NSIS installation detected (has uninstaller), OR
    // 2. In Program Files, OR
    // 3. Not writable
    const type: 'installer' | 'portable' =
      isNsisInstall || isProgramFiles || !canWrite ? 'installer' : 'portable';

    logger.info('UPDATER', 'Update preference determined', {
      type,
      isNsisInstall,
      isProgramFiles,
      canWrite,
      appDir,
    });

    return { type, appDir, isProgramFiles, canWrite, isNsisInstall };
  }

  private async portableInstallUpdate(
    updateShortcuts: boolean = true
  ): Promise<void> {
    const info = this.currentState.info;
    const stagedPath = info?.downloadUrl; // We reused downloadUrl to store local path
    if (!stagedPath) throw new Error('No staged update found');

    // CRITICAL: For portable builds, both process.execPath and app.getPath('exe')
    // can return the BUILD-TIME path, not the RUNTIME path!
    // We need to construct the actual path from the app's resource directory

    // Get the resources path (this is always correct at runtime)
    const resourcesPath = process.resourcesPath;

    // For portable builds, the structure is:
    // ProduTime-Portable/
    //   ├── ProduTime.exe  (the actual executable)
    //   └── resources/
    //       └── app.asar

    // So the EXE is one level up from resources
    const originalExe = path.join(path.dirname(resourcesPath), 'ProduTime.exe');

    logger.info('UPDATER', 'Executable paths', {
      'process.execPath': process.execPath,
      'app.getPath(exe)': app.getPath('exe'),
      'process.resourcesPath': resourcesPath,
      'Calculated EXE path': originalExe,
      'EXE exists': fs.existsSync(originalExe),
    });

    // Verify staged file exists
    if (!fs.existsSync(stagedPath)) {
      throw new Error(`Staged update file not found: ${stagedPath}`);
    }

    // Detect if this is an NSIS installer (Setup file)
    const ext = path.extname(stagedPath).toLowerCase();
    const fileName = path.basename(stagedPath).toLowerCase();
    const isNsisInstaller = ext === '.exe' &&
                           (fileName.includes('setup') || fileName.includes('installer'));

    const updatePreference = this.getUpdatePreference();
    const appDir = updatePreference.appDir;
    const isProgramFilesInstall = updatePreference.isProgramFiles;
    const canWriteInstallDir = updatePreference.canWrite;

    if (!isNsisInstaller && (isProgramFilesInstall || !canWriteInstallDir)) {
      logger.warn('UPDATER', 'ZIP update blocked by install location', {
        appDir,
        isProgramFilesInstall,
        canWriteInstallDir,
      });

      await dialog.showMessageBox(this.mainWindow!, {
        type: 'error',
        title: 'Update Install Blocked',
        message:
          'This update package cannot be applied in the current install location.',
        detail:
          'Please publish the installer update or reinstall using the latest installer, then try again.',
        buttons: ['OK'],
      });
      return;
    }

    // Handle NSIS installer separately
    if (isNsisInstaller) {
      logger.info('UPDATER', 'Detected NSIS installer, launching silent update');

      const response = await dialog.showMessageBox(this.mainWindow!, {
        type: 'info',
        title: 'Install Update',
        message: `ProduTime ${info.version} is ready to install.\n\nThe application will close and the installer will run.`,
        detail: 'The update will install silently and restart the application automatically.',
        buttons: ['Install Now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      });

      if (response.response === 0) {
        // Launch NSIS installer with silent parameters
        // /S = Silent mode
        // /D= = Installation directory (must be last parameter, no quotes)
        const installDir = appDir;

        logger.info('UPDATER', 'Launching NSIS installer', {
          installerPath: stagedPath,
          installDir: installDir,
          parameters: ['/S', `/D=${installDir}`]
        });

        spawn(stagedPath, ['/S', `/D=${installDir}`], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        }).unref();

        // Give installer time to start, then quit
        setTimeout(() => {
          logger.info('UPDATER', 'Quitting app for NSIS installer to proceed');
          app.quit();
        }, 1000);
      }
      return;
    }

    // Use userData directory for temp files (portable across all computers)
    const userData = app.getPath('userData');
    const tempDir = path.join(userData, 'temp-update');
    fs.mkdirSync(tempDir, { recursive: true });

    const tempUpdateFile = path.join(
      tempDir,
      `ProduTimeUpdate_${Date.now()}${ext === '.zip' ? '.zip' : '.exe'}`
    );
    fs.copyFileSync(stagedPath, tempUpdateFile);

    // Create a small updater batch to swap files after this process exits
    const scriptPath = path.join(
      tempDir,
      `produtime_portable_swap_${Date.now()}.bat`
    );

    // Log paths for debugging
    logger.info('UPDATER', 'Portable install paths', {
      stagedPath,
      originalExe,
      tempUpdateFile,
      scriptPath,
    });

    // Create a PowerShell script that accepts arguments (NO hardcoded paths!)
    const psScriptPath = path.join(
      tempDir,
      `produtime_portable_swap_${Date.now()}.ps1`
    );

    // Log file for debugging
    const logPath = path.join(tempDir, 'update.log');

    // Build PowerShell script content
    // Note: Use template literals to avoid quote escaping issues
    const psScript = `param(
  [string]$tempUpdate,
  [string]$originalExe,
  [string]$updateShortcut
)

$logFile = "${logPath.replace(/\\/g, '\\\\')}"

function Write-Log {
  param([string]$message)
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  "$timestamp - $message" | Out-File -FilePath $logFile -Append -Encoding UTF8
  Write-Host $message
}

Write-Log "========================================="
Write-Log "ProduTime Update Installer"
Write-Log "========================================="
Write-Log "Temp Update: $tempUpdate"
Write-Log "Original EXE: $originalExe"
Write-Log "Update Shortcut: $updateShortcut"
Write-Log ""

# Validate parameters
if ([string]::IsNullOrWhiteSpace($tempUpdate)) {
  Write-Log "ERROR: tempUpdate parameter is empty!"
  Write-Log "Press any key to exit..."
  $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
  exit 1
}

if ([string]::IsNullOrWhiteSpace($originalExe)) {
  Write-Log "ERROR: originalExe parameter is empty!"
  Write-Log "Press any key to exit..."
  $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
  exit 1
}

if (-not (Test-Path $tempUpdate)) {
  Write-Log "ERROR: Temp update file not found: $tempUpdate"
  Write-Log "Press any key to exit..."
  $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
  exit 1
}

Write-Log "Waiting for app to close..."
Start-Sleep -Seconds 2

Write-Log "Copying new version..."
try {
  $retryCount = 0
  $maxRetries = 5

  while ($retryCount -lt $maxRetries) {
    try {
      Copy-Item -Path $tempUpdate -Destination $originalExe -Force -ErrorAction Stop
      Write-Log "Successfully copied update to: $originalExe"
      break
    } catch {
      $retryCount++
      Write-Log "Retry $retryCount/$maxRetries - File may be locked, waiting..."
      Start-Sleep -Seconds 2

      if ($retryCount -eq $maxRetries) {
        throw "Failed to copy update after $maxRetries attempts: $_"
      }
    }
  }
} catch {
  Write-Log "ERROR: Failed to copy update: $_"
  Write-Log "Press any key to exit..."
  $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
  exit 1
}

Write-Log "Cleaning up temp file..."
try {
  Remove-Item -Path $tempUpdate -Force -ErrorAction SilentlyContinue
  Write-Log "Temp file removed"
} catch {
  Write-Log "Warning: Could not remove temp file: $_"
}

if ($updateShortcut -eq "1") {
  Write-Log "Updating desktop shortcut..."
  try {
    $shell = New-Object -ComObject WScript.Shell
    $desktop = [Environment]::GetFolderPath('Desktop')
    $shortcutPath = Join-Path $desktop "ProduTime.lnk"
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $originalExe
    $shortcut.IconLocation = $originalExe
    $shortcut.Save()
    Write-Log "Desktop shortcut updated"
  } catch {
    Write-Log "Warning: Could not update shortcut: $_"
  }
}

Write-Log ""
Write-Log "Update completed successfully!"
Write-Log "Starting updated application..."

try {
  Start-Process -FilePath $originalExe
  Write-Log "Application started"
} catch {
  Write-Log "Warning: Could not start application: $_"
}

Write-Log ""
Write-Log "Cleaning up update script..."
Start-Sleep -Seconds 1

# Self-delete (this script)
try {
  Remove-Item -Path $PSCommandPath -Force -ErrorAction SilentlyContinue
  Write-Log "Update script removed"
} catch {
  Write-Log "Warning: Could not remove update script: $_"
}

Write-Log "Update process complete!"
# Auto-close without waiting for user input
Start-Sleep -Milliseconds 500
`;

    fs.writeFileSync(psScriptPath, psScript, 'utf8');

    logger.info('UPDATER', 'PowerShell script created', {
      psScriptPath,
      logPath,
    });

    const isZip = ext === '.zip';

    const shortcutFlag = updateShortcuts ? '1' : '0';

    // Create a batch file launcher that survives parent process exit
    // This is more reliable than direct spawn with detached
    const batchLauncherPath = path.join(
      tempDir,
      `launch_update_${Date.now()}.bat`
    );

    const batchContent = isZip
      ? [
          '@echo off',
          'setlocal enabledelayedexpansion',
          'REM ProduTime ZIP Update Launcher',
          'set EXTRACT_DIR=%TEMP%\\ProduTimeExtract_%RANDOM%%RANDOM%',
          'mkdir "%EXTRACT_DIR%" >nul 2>&1',
          `powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "Expand-Archive -Path '${tempUpdateFile.replace(/\\/g, '\\\\')}' -DestinationPath '%EXTRACT_DIR%' -Force" >nul 2>&1`,
          'ping 127.0.0.1 -n 2 >nul',
          `powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "Copy-Item -Path '%EXTRACT_DIR%\\*' -Destination '${appDir.replace(/\\/g, '\\\\')}' -Recurse -Force" >nul 2>&1`,
          'if %ERRORLEVEL% NEQ 0 exit /b %ERRORLEVEL%',
          `rmdir /s /q "%EXTRACT_DIR%" >nul 2>&1`,
          `powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "Start-Process -FilePath '${originalExe.replace(/\\/g, '\\\\')}' -WindowStyle Hidden" >nul 2>&1`,
          'del "%~f0"',
        ].join('\r\n')
      : [
          '@echo off',
          'REM ProduTime Update Launcher',
          `powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${psScriptPath}" -tempUpdate "${tempUpdateFile}" -originalExe "${originalExe}" -updateShortcut ${shortcutFlag} >nul 2>&1`,
          'REM Self-delete this launcher',
          `del "%~f0"`,
        ].join('\r\n');

    fs.writeFileSync(batchLauncherPath, batchContent, 'utf8');

    logger.info('UPDATER', 'Batch launcher created', {
      batchLauncherPath,
      psScriptPath,
      tempUpdateFile,
      originalExe,
      appDir,
      isZip,
      shortcutFlag,
    });

    // Launch the batch file in a new detached process
    // Using cmd /c start creates a completely independent process tree
    const child = spawn(
      'cmd.exe',
      ['/c', 'start', '""', '/wait', batchLauncherPath],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: true, // Hide console window
      }
    );

    child.on('error', (err) => {
      logger.error('UPDATER', 'Failed to spawn batch launcher', err);
    });

    // Unref so the parent can exit
    child.unref();

    logger.info('UPDATER', 'Batch launcher process started, quitting app', {
      pid: child.pid,
      batchLauncherPath,
    });

    // Give the launcher time to start before quitting
    setTimeout(() => {
      app.quit();
    }, 1000);
  }

  /**
   * Fetch JSON with retry logic and timeout handling
   */
  private async fetchJsonWithRetry(
    url: string,
    token: string,
    options?: Partial<RetryOptions>
  ): Promise<any> {
    const retryOptions: RetryOptions = {
      maxRetries: options?.maxRetries ?? UPDATE_CHECK_CONFIG.MAX_RETRIES,
      retryDelays: options?.retryDelays ?? UPDATE_CHECK_CONFIG.RETRY_DELAYS_MS,
      retryOn: options?.retryOn ?? UPDATE_CHECK_CONFIG.RETRYABLE_ERROR_CODES,
    };

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retryOptions.maxRetries; attempt++) {
      try {
        logger.info(
          'UPDATER',
          `API request attempt ${attempt + 1}/${retryOptions.maxRetries + 1}`,
          {
            url,
            attempt: attempt + 1,
          }
        );

        const result = await this.fetchJson(url, token);

        if (attempt > 0) {
          logger.info(
            'UPDATER',
            `API request succeeded after ${attempt} retries`
          );
        }

        return result;
      } catch (err: any) {
        lastError = err;

        // Check if error is retryable
        const isRetryable = retryOptions.retryOn.some(
          (code) => err.code === code || err.message?.includes(code)
        );

        // Check if it's a rate limit error (always retry with longer delay)
        const isRateLimit = err.message?.includes('rate limit');

        if (
          (!isRetryable && !isRateLimit) ||
          attempt === retryOptions.maxRetries
        ) {
          logger.error(
            'UPDATER',
            'API request failed (not retryable or max retries reached)',
            {
              error: err.message,
              code: err.code,
              attempt: attempt + 1,
              isRetryable,
              isRateLimit,
            }
          );
          throw err;
        }

        const delay = isRateLimit
          ? 60000 // Wait 1 minute for rate limit
          : retryOptions.retryDelays[attempt] ||
            retryOptions.retryDelays[retryOptions.retryDelays.length - 1];

        logger.warn(
          'UPDATER',
          `API request failed, retrying after ${delay}ms`,
          {
            error: err.message,
            code: err.code,
            attempt: attempt + 1,
            delay,
          }
        );

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError || new Error('API request failed after all retries');
  }

  /**
   * Fetch JSON from URL with timeout and rate limit handling
   */
  private fetchJson(url: string, token: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeoutMs = UPDATE_CHECK_CONFIG.API_TIMEOUT_MS;
      let timedOut = false;

      const headers: Record<string, string> = {
        'User-Agent': 'ProduTime-Updater',
        Accept: 'application/vnd.github+json',
      };

      if (token) {
        headers.Authorization = `token ${token}`;
      }

      // Determine if we should use HTTP or HTTPS based on URL
      const isHttps = url.startsWith('https://');
      const requestModule = isHttps ? https : http;

      const req = requestModule.request(
        url,
        {
          method: 'GET',
          headers,
          timeout: timeoutMs,
        },
        (res) => {
          // Check rate limit headers
          const rateLimit: RateLimitInfo = {
            limit: parseInt(
              (res.headers['x-ratelimit-limit'] as string) || '0'
            ),
            remaining: parseInt(
              (res.headers['x-ratelimit-remaining'] as string) || '0'
            ),
            reset: parseInt(
              (res.headers['x-ratelimit-reset'] as string) || '0'
            ),
          };

          logger.debug('UPDATER', 'GitHub API rate limit', rateLimit);

          // Handle rate limiting
          if (res.statusCode === 403 && rateLimit.remaining === 0) {
            const resetDate = new Date(rateLimit.reset * 1000);
            const retryAfter = res.headers['retry-after'];

            const error = new Error(
              `GitHub API rate limit exceeded. Resets at ${resetDate.toLocaleString()}. ` +
                `Retry after: ${retryAfter || 'unknown'}`
            );
            logger.error('UPDATER', 'Rate limit exceeded', {
              resetDate: resetDate.toISOString(),
              retryAfter,
              rateLimit,
            });
            reject(error);
            return;
          }

          // Handle non-200 status codes
          if (res.statusCode !== 200) {
            const error = new Error(
              `HTTP ${res.statusCode}: ${res.statusMessage || 'Unknown error'}`
            );
            logger.error('UPDATER', 'API request failed with non-200 status', {
              statusCode: res.statusCode,
              statusMessage: res.statusMessage,
              url,
            });
            reject(error);
            return;
          }

          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            if (timedOut) return;

            try {
              const parsed = JSON.parse(data);
              resolve(parsed);
            } catch (e) {
              logger.error('UPDATER', 'Failed to parse JSON response', {
                error: e,
                dataLength: data.length,
              });
              reject(new Error(`Invalid JSON response: ${e}`));
            }
          });
        }
      );

      // Set timeout
      req.setTimeout(timeoutMs, () => {
        timedOut = true;
        req.destroy();
        const error = new Error(
          `Request timeout after ${timeoutMs / 1000} seconds`
        );
        logger.error('UPDATER', 'API request timeout', {
          url,
          timeoutMs,
        });
        reject(error);
      });

      req.on('error', (err) => {
        if (timedOut) return;

        logger.error('UPDATER', 'API request error', {
          error: err.message,
          code: (err as any).code,
          url,
        });
        reject(err);
      });

      req.end();
    });
  }

  /**
   * Download file with timeout, progress tracking, and integrity validation
   */
  private downloadToFile(
    url: string,
    dest: string,
    token: string,
    onProgress: (p: UpdateProgress) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      let transferred = 0;
      let total = 0;
      let timedOut = false;
      let lastProgressTime = Date.now();
      let progressCheckInterval: NodeJS.Timeout | null = null;

      const cleanup = (deleteFile: boolean = true) => {
        if (progressCheckInterval) {
          clearInterval(progressCheckInterval);
          progressCheckInterval = null;
        }
        try {
          file.close();
          if (deleteFile && fs.existsSync(dest)) {
            fs.unlinkSync(dest);
            logger.debug('UPDATER', 'Cleaned up partial download', { dest });
          }
        } catch (cleanupErr) {
          logger.error('UPDATER', 'Cleanup error', cleanupErr);
        }
      };

      const headers: Record<string, string> = {
        'User-Agent': 'ProduTime-Updater',
        Accept: 'application/octet-stream',
      };

      if (token) {
        headers.Authorization = `token ${token}`;
      }

      // Determine if we should use HTTP or HTTPS based on URL
      const isHttps = url.startsWith('https://');
      const requestModule = isHttps ? https : http;

      logger.info('UPDATER', 'Using request module', {
        url,
        protocol: isHttps ? 'HTTPS' : 'HTTP',
      });

      const req = requestModule.get(
        url,
        {
          headers,
          timeout: UPDATE_CHECK_CONFIG.DOWNLOAD_TIMEOUT_MS,
        },
        (res) => {
          // Handle redirects
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            logger.info('UPDATER', 'Following redirect', {
              from: url,
              to: res.headers.location,
            });
            cleanup(true);
            this.downloadToFile(res.headers.location, dest, token, onProgress)
              .then(resolve)
              .catch(reject);
            return;
          }

          // Validate status code
          if (res.statusCode !== 200) {
            cleanup(true);
            const error = new Error(
              `Download failed: HTTP ${res.statusCode} ${res.statusMessage || ''}`
            );
            logger.error('UPDATER', 'Download failed with non-200 status', {
              statusCode: res.statusCode,
              statusMessage: res.statusMessage,
              url,
            });
            reject(error);
            return;
          }

          // Validate content type
          const contentType = res.headers['content-type'];
          if (
            contentType &&
            !contentType.includes('application/octet-stream') &&
            !contentType.includes('application/x-msdownload') &&
            !contentType.includes('application/zip')
          ) {
            logger.warn('UPDATER', 'Unexpected content type', {
              contentType,
              url,
            });
          }

          total = parseInt(res.headers['content-length'] || '0', 10);
          logger.info('UPDATER', 'Download started', {
            url,
            totalBytes: total,
            contentType,
          });

          // Calculate adaptive stall timeout based on file size
          // Larger files get more lenient timeouts for slow connections
          const baseTimeout = UPDATE_CHECK_CONFIG.PROGRESS_TIMEOUT_MS;
          const minTimeout = UPDATE_CHECK_CONFIG.MIN_PROGRESS_TIMEOUT_MS;
          const maxTimeout = UPDATE_CHECK_CONFIG.MAX_PROGRESS_TIMEOUT_MS;
          
          // Add 10 seconds per 50MB of file size
          const fileSizeMB = total / (1024 * 1024);
          const adaptiveTimeout = Math.min(
            maxTimeout,
            Math.max(minTimeout, baseTimeout + Math.floor(fileSizeMB / 50) * 10000)
          );
          
          logger.info('UPDATER', 'Using adaptive stall timeout', {
            fileSizeMB: fileSizeMB.toFixed(2),
            adaptiveTimeoutSeconds: adaptiveTimeout / 1000,
          });

          // Monitor progress to detect stalled downloads
          progressCheckInterval = setInterval(() => {
            const timeSinceLastProgress = Date.now() - lastProgressTime;
            if (timeSinceLastProgress > adaptiveTimeout) {
              timedOut = true;
              req.destroy();
              cleanup(true);
              const error = new Error(
                `Download stalled - no progress for ${adaptiveTimeout / 1000} seconds`
              );
              logger.error('UPDATER', 'Download stalled', {
                timeSinceLastProgress,
                adaptiveTimeout,
                transferred,
                total,
              });
              reject(error);
            }
          }, 5000); // Check every 5 seconds

          res.on('data', (chunk) => {
            if (timedOut) return;

            lastProgressTime = Date.now();
            transferred += chunk.length;
            const percent = total ? (transferred / total) * 100 : 0;

            // Calculate speed (rough estimate)
            const bytesPerSecond = chunk.length / 0.1; // Assuming chunks come ~every 100ms

            onProgress({ bytesPerSecond, percent, transferred, total });
            file.write(chunk);
          });

          res.on('end', () => {
            if (timedOut) return;

            cleanup(false); // Don't delete file on success

            // Validate download completeness
            if (total > 0 && transferred !== total) {
              const error = new Error(
                `Incomplete download: received ${transferred} bytes, expected ${total} bytes`
              );
              logger.error('UPDATER', 'Incomplete download', {
                transferred,
                total,
                missing: total - transferred,
              });
              try {
                fs.unlinkSync(dest);
              } catch {}
              reject(error);
              return;
            }

            logger.info('UPDATER', 'Download completed successfully', {
              transferred,
              total,
              dest,
            });
            resolve();
          });
        }
      );

      // Set timeout for initial connection
      req.setTimeout(UPDATE_CHECK_CONFIG.DOWNLOAD_TIMEOUT_MS, () => {
        timedOut = true;
        req.destroy();
        cleanup(true);
        const error = new Error(
          `Download timeout after ${UPDATE_CHECK_CONFIG.DOWNLOAD_TIMEOUT_MS / 1000} seconds`
        );
        logger.error('UPDATER', 'Download timeout', {
          url,
          timeoutMs: UPDATE_CHECK_CONFIG.DOWNLOAD_TIMEOUT_MS,
        });
        reject(error);
      });

      req.on('error', (err) => {
        if (timedOut) return;

        cleanup(true);
        logger.error('UPDATER', 'Download error', {
          error: err.message,
          code: (err as any).code,
          errno: (err as any).errno,
          url,
          transferred,
          total,
        });
        reject(err);
      });
    });
  }

  public getCurrentState(): UpdateState {
    return { ...this.currentState };
  }

  /**
   * Get the device ID for download tracking
   */
  private getDeviceId(): string {
    const deviceIdService = DeviceIdService.getInstance();
    return deviceIdService.getDeviceId();
  }

  private getGitHubToken(): string {
    // Priority order: environment variable > stored setting
    // SECURITY: Never hardcode tokens in source code
    const token =
      process.env.GITHUB_TOKEN || process.env.GH_TOKEN || this.getStoredToken();

    if (!token) {
      logger.warn(
        'UPDATER',
        'No GitHub token found. Set GITHUB_TOKEN environment variable for private repository access.'
      );
      logger.info(
        'UPDATER',
        'Update checks will use unauthenticated API (rate limited to 60 requests/hour)'
      );
    }

    return token || '';
  }

  private getStoredToken(): string | null {
    try {
      // TODO: Implement secure token storage in database settings table
      // For now, rely on environment variables only
      return null;
    } catch (error) {
      logger.error('UPDATER', 'Error retrieving stored token', error);
      return null;
    }
  }

  private getLicenseManagerUrl(): string {
    // 1) Prefer DB settings written during activation/validation (tunnel-aware)
    try {
      const fromDbAct = this.database?.getSetting('activation_server_url');
      const fromDbVal = this.database?.getSetting('validation_server_url');
      const fromDb = fromDbAct || fromDbVal || null;
      if (fromDb) {
        let base = fromDb;
        try {
          const u = new URL(fromDb);
          base = u.origin;
        } catch {
          // Fallback: strip common API suffixes if a full URL was stored
          base = fromDb
            .replace(/\/(activate|validate)(\/)?$/, '')
            .replace(/\/$/, '');
        }
        const isStale = /trycloudflare\.com/i.test(base);
        if (isStale) {
          logger.warn(
            'UPDATER',
            'Ignoring stale trycloudflare URL from database',
            { url: base }
          );
        } else {
          logger.info('UPDATER', 'Using update server URL from database', {
            url: base,
          });
          return base;
        }
      }
    } catch (error) {
      logger.warn(
        'UPDATER',
        'Could not read update server URL from database',
        error
      );
    }

    // 2) Environment variables (allow overriding explicitly)
    const envUrl =
      process.env.UPDATE_SERVER_URL || process.env.LICENSE_MANAGER_URL || '';
    if (envUrl) {
      return envUrl.replace(/\/$/, '');
    }

    // 3) Config file fallback
    try {
      const configPath = path.join(
        app.getPath('userData'),
        'license-manager-url.txt'
      );
      if (fs.existsSync(configPath)) {
        const url = fs.readFileSync(configPath, 'utf8').trim();
        if (url) {
          return url.replace(/\/$/, '');
        }
      }
    } catch (error) {
      logger.warn(
        'UPDATER',
        'Could not read License Manager URL from file',
        error
      );
    }

    // 4) Final default: public License Manager base
    const defaultUrl = DEFAULT_PUBLIC_LM_BASE;
    logger.warn('UPDATER', 'Falling back to default public update server URL', {
      url: defaultUrl,
      configFile: 'license-manager-url.txt',
      envVar: 'UPDATE_SERVER_URL | LICENSE_MANAGER_URL',
    });
    return defaultUrl;
  }

  public setFeedURL(url: string): void {
    try {
      const token = this.getGitHubToken();

      // Configure electron-updater for GitHub releases
      autoUpdater.setFeedURL({
        provider: 'github',
        owner: 'georgekgr12',
        repo: 'timeport',
        private: true,
        token: token || undefined, // Use undefined if no token (for public repos)
      });

      if (token) {
        logger.info(
          'UPDATER',
          'Auto-updater feed URL set to GitHub releases (authenticated)'
        );
      } else {
        logger.warn(
          'UPDATER',
          'Auto-updater feed URL set to GitHub releases (unauthenticated - rate limited)'
        );
      }
    } catch (error) {
      logger.error('UPDATER', 'Error setting feed URL', error);
    }
  }

  public cleanup(): void {
    // Stop background checks
    if (this.backgroundCheckTimer) {
      clearInterval(this.backgroundCheckTimer);
      this.backgroundCheckTimer = null;
      logger.info('UPDATER', 'Background update checks stopped');
    }

    // BUG FIX #6: Check if listeners exist before removing
    // This prevents potential errors if cleanup is called multiple times
    if (autoUpdater.listenerCount('checking-for-update') > 0) {
      autoUpdater.removeAllListeners();
      logger.info('UPDATER', 'Auto-updater listeners removed');
    }

    this.mainWindow = null;
    logger.info('UPDATER', 'Auto-updater cleaned up');
  }

  /**
   * Get the last time an update check was performed
   */
  public getLastCheckTime(): Date | null {
    return this.lastCheckTime;
  }

  /**
   * Get the log directory path
   */
  public getLogDirectory(): string {
    return path.join(app.getPath('userData'), 'logs');
  }

  /**
   * Open the log directory in file explorer
   */
  public async openLogDirectory(): Promise<void> {
    const logDir = this.getLogDirectory();

    // Ensure directory exists
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const { shell } = require('electron');
    await shell.openPath(logDir);
    logger.info('UPDATER', 'Opened log directory', { logDir });
  }

  // Development/testing methods
  public async checkForUpdatesAndNotify(): Promise<void> {
    try {
      if (process.platform === 'win32') {
        await this.checkForUpdates();
      } else {
        await autoUpdater.checkForUpdatesAndNotify();
      }
    } catch (error) {
      console.error('Error in checkForUpdatesAndNotify:', error);
    }
  }

  public isUpdateAvailable(): boolean {
    return this.currentState.status === UpdateStatus.AVAILABLE;
  }

  public isUpdateDownloaded(): boolean {
    return this.currentState.status === UpdateStatus.DOWNLOADED;
  }

  /**
   * Convert technical error messages to user-friendly messages with actionable guidance
   */
  private getUserFriendlyErrorMessage(technicalError: string): string {
    const error = technicalError.toLowerCase();

    // License Manager offline (specific to portable updates)
    if (
      error.includes('econnrefused') &&
      (error.includes('localhost') ||
        error.includes('127.0.0.1') ||
        error.includes(':3000'))
    ) {
      return (
        'No updates available at this time.\n\n' +
        'The update server is currently offline.\n\n' +
        'You are running the latest installed version: ' +
        app.getVersion() +
        '\n\n' +
        'Note:\n' +
        '• Updates are distributed through a local license manager\n' +
        '• The license manager is not currently running\n' +
        '• Your application will continue to work normally\n' +
        '• Check back later for updates'
      );
    }

    // AggregateError (multiple failed connection attempts)
    if (error.includes('aggregateerror')) {
      // Check if it's related to localhost/license manager
      if (
        error.includes('localhost') ||
        error.includes('127.0.0.1') ||
        error.includes(':3000')
      ) {
        return (
          'No updates available at this time.\n\n' +
          'The update server is currently offline.\n\n' +
          'You are running the latest installed version: ' +
          app.getVersion() +
          '\n\n' +
          'Note:\n' +
          '• Updates are distributed through a local license manager\n' +
          '• The license manager is not currently running\n' +
          '• Your application will continue to work normally\n' +
          '• Check back later for updates'
        );
      }
      // Generic aggregate error
      return (
        'Unable to connect to the update server.\n\n' +
        'Multiple connection attempts failed.\n\n' +
        'Possible causes:\n' +
        '• No internet connection\n' +
        '• Update server is offline\n' +
        '• Firewall blocking the connection\n\n' +
        'What to try:\n' +
        '• Check your internet connection\n' +
        '• Try again in a few minutes\n' +
        '• Contact support if the problem persists'
      );
    }

    // Network connectivity errors
    if (
      error.includes('etimedout') ||
      error.includes('timeout') ||
      error.includes('timed out')
    ) {
      return (
        'The update check timed out.\n\n' +
        'Possible causes:\n' +
        '• Slow or unstable internet connection\n' +
        '• Firewall blocking the connection\n' +
        '• Update server is temporarily unavailable\n\n' +
        'What to try:\n' +
        '• Check your internet connection\n' +
        '• Try again in a few minutes\n' +
        '• Check if other websites are accessible'
      );
    }

    if (
      error.includes('enotfound') ||
      error.includes('econnrefused') ||
      error.includes('econnreset')
    ) {
      // Check if it's a License Manager configuration issue
      if (error.includes('localhost') || error.includes('127.0.0.1')) {
        return (
          'License Manager is not configured correctly.\n\n' +
          "The update system is looking for License Manager on this computer, but it's not running here.\n\n" +
          'To fix this:\n' +
          '1. Find your License Manager IP address\n' +
          '2. Set the environment variable:\n' +
          '   LICENSE_MANAGER_URL=http://<IP>:3000\n' +
          '3. Restart this application\n\n' +
          'Or create a file at:\n' +
          '%APPDATA%\\ProduTime\\license-manager-url.txt\n' +
          'with content: http://<IP>:3000'
        );
      }

      return (
        'Unable to connect to the update server.\n\n' +
        'Possible causes:\n' +
        '• No internet connection\n' +
        '• DNS resolution failure\n' +
        '• Firewall or antivirus blocking the connection\n' +
        '• License Manager is offline\n\n' +
        'What to try:\n' +
        '• Verify your internet connection is active\n' +
        '• Check firewall/antivirus settings\n' +
        '• Verify License Manager is running and accessible\n' +
        '• Contact your network administrator if on a corporate network'
      );
    }

    // Authentication errors
    if (error.includes('401') || error.includes('unauthorized')) {
      return (
        'Authentication failed.\n\n' +
        'The GitHub token is invalid or has expired.\n\n' +
        'What to try:\n' +
        '• Verify the GITHUB_TOKEN environment variable is set correctly\n' +
        '• Generate a new token at: https://github.com/settings/tokens\n' +
        '• Ensure the token has "repo" access permissions\n' +
        '• Restart the application after setting the token'
      );
    }

    if (error.includes('403') || error.includes('forbidden')) {
      if (error.includes('rate limit')) {
        return (
          'GitHub API rate limit exceeded.\n\n' +
          'The application has made too many requests to GitHub.\n\n' +
          'What to try:\n' +
          '• Wait 60 minutes for the rate limit to reset\n' +
          '• Set a GitHub token to increase rate limits:\n' +
          '  $env:GITHUB_TOKEN = "your-token-here"\n' +
          '• Authenticated requests have a limit of 5,000/hour\n' +
          '• Unauthenticated requests are limited to 60/hour'
        );
      }
      return (
        'Access denied to the update repository.\n\n' +
        'Possible causes:\n' +
        '• GitHub token lacks required permissions\n' +
        '• Repository is private and requires authentication\n\n' +
        'What to try:\n' +
        '• Set the GITHUB_TOKEN environment variable\n' +
        '• Ensure the token has "repo" access permissions\n' +
        '• Contact the repository administrator'
      );
    }

    // Not found errors
    if (error.includes('404') || error.includes('not found')) {
      return (
        'Update repository or release not found.\n\n' +
        'Possible causes:\n' +
        '• No releases have been published yet\n' +
        '• Repository has been moved or deleted\n' +
        '• Network is blocking access to GitHub\n\n' +
        'What to try:\n' +
        '• Check if https://github.com/georgekgr12/timeport is accessible\n' +
        '• Contact the application administrator\n' +
        '• Try again later'
      );
    }

    // Asset errors
    if (error.includes('no suitable asset') || error.includes('no portable')) {
      return (
        'Update is available but no compatible installer was found.\n\n' +
        'The release does not contain a ProduTime.exe file.\n\n' +
        'What to try:\n' +
        '• Contact the application administrator\n' +
        '• Check the GitHub releases page manually\n' +
        '• Wait for a properly packaged release'
      );
    }

    // Download errors
    if (error.includes('download') && error.includes('failed')) {
      return (
        'Failed to download the update.\n\n' +
        'Possible causes:\n' +
        '• Insufficient disk space\n' +
        '• Antivirus blocking the download\n' +
        '• Network connection interrupted\n\n' +
        'What to try:\n' +
        '• Check available disk space\n' +
        '• Temporarily disable antivirus\n' +
        '• Try again with a stable internet connection\n' +
        '• Check the logs for more details (Settings → View Logs)'
      );
    }

    // Installation errors
    if (error.includes('install') && error.includes('failed')) {
      return (
        'Failed to install the update.\n\n' +
        'Possible causes:\n' +
        '• Insufficient permissions\n' +
        '• Application running from read-only location\n' +
        '• Antivirus blocking the installation\n\n' +
        'What to try:\n' +
        '• Run the application as administrator\n' +
        '• Move the application to a writable location\n' +
        '• Temporarily disable antivirus\n' +
        '• Check the logs for more details (Settings → View Logs)'
      );
    }

    // Generic error with technical details
    return (
      'An error occurred while checking for updates.\n\n' +
      `Technical details:\n${technicalError}\n\n` +
      'What to try:\n' +
      '• Check your internet connection\n' +
      '• Try again in a few minutes\n' +
      '• View detailed logs: Settings → View Logs\n' +
      '• Contact support if the problem persists'
    );
  }
}


