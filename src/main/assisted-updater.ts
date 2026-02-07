import { app, dialog, shell, BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from './logger';

/**
 * Assisted Updater
 *
 * Checks a hosted JSON manifest for updates and opens download URL in browser.
 * Does NOT download or install updates automatically.
 *
 * CONSTRAINTS:
 * - No downloadUpdate(), no quitAndInstall(), no self-patching
 * - Check JSON → compare versions → show UI → open URL in browser
 * - Safe: timeouts, silent failures, no crash if offline
 * - Avoids caching: request with cache-buster query param
 */

interface UpdateManifest {
  product: string;
  channel: string;
  latest: {
    version: string;
    url: string;
    releaseNotesUrl?: string;
    mandatory?: boolean;
    minSupportedVersion?: string;
    sha256?: string; // Future: download verification
  };
}

interface AssistedUpdaterOptions {
  /** Enable/disable assisted updates (default: true) */
  enabled?: boolean;
  /** Manifest URL (required in production) */
  manifestUrl?: string;
  /** Enable background checks every 24h (default: true) */
  enableBackgroundChecks?: boolean;
  /** Interval for background checks in ms (default: 24h) */
  backgroundCheckInterval?: number;
}

export class AssistedUpdater {
  private options: Required<AssistedUpdaterOptions>;
  private mainWindow: BrowserWindow | null = null;
  private backgroundCheckTimer: NodeJS.Timeout | null = null;
  private lastCheckTimestampFile: string;

  constructor(
    mainWindow: BrowserWindow | null,
    options: AssistedUpdaterOptions = {}
  ) {
    this.mainWindow = mainWindow;

    // Default options
    this.options = {
      enabled: options.enabled ?? this.getEnabledFromEnv(),
      manifestUrl: options.manifestUrl ?? this.getManifestUrlFromEnv(),
      enableBackgroundChecks: options.enableBackgroundChecks ?? true,
      backgroundCheckInterval: options.backgroundCheckInterval ?? 24 * 60 * 60 * 1000, // 24 hours
    };

    // Store last check timestamp in userData
    this.lastCheckTimestampFile = path.join(
      app.getPath('userData'),
      'assisted-update-last-check.json'
    );

    logger.info('ASSISTED_UPDATER', 'Initialized', {
      enabled: this.options.enabled,
      manifestUrl: this.options.manifestUrl || 'dev mode',
      backgroundChecks: this.options.enableBackgroundChecks,
    });
  }

  /**
   * Get enabled state from environment variable
   */
  private getEnabledFromEnv(): boolean {
    const envValue = process.env.ASSISTED_UPDATE_ENABLED;
    if (envValue === undefined) return true; // Default enabled
    return envValue.toLowerCase() === 'true' || envValue === '1';
  }

  /**
   * Get manifest URL from environment or dev fallback
   */
  private getManifestUrlFromEnv(): string {
    // Check environment variable first
    if (process.env.ASSISTED_UPDATE_MANIFEST_URL) {
      return process.env.ASSISTED_UPDATE_MANIFEST_URL;
    }

    // In dev mode, use local manifest
    const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
    if (isDev) {
      const devManifestPath = path.join(
        app.getAppPath(),
        'dev',
        'updates',
        'latest.json'
      );
      logger.info('ASSISTED_UPDATER', 'Using dev manifest', { path: devManifestPath });
      return `file://${devManifestPath}`;
    }

    // Production with no URL: disabled
    return '';
  }

  /**
   * Start background update checks
   */
  public startBackgroundChecks(): void {
    if (!this.options.enabled || !this.options.enableBackgroundChecks) {
      logger.info('ASSISTED_UPDATER', 'Background checks disabled');
      return;
    }

    if (!this.options.manifestUrl) {
      logger.warn('ASSISTED_UPDATER', 'No manifest URL configured, background checks disabled');
      return;
    }

    // Check if we need to run a background check now
    this.checkIfBackgroundCheckNeeded();

    // Set up periodic checks
    this.backgroundCheckTimer = setInterval(() => {
      this.checkIfBackgroundCheckNeeded();
    }, 60 * 60 * 1000); // Check every hour if background check is needed

    logger.info('ASSISTED_UPDATER', 'Background checks started');
  }

  /**
   * Stop background update checks
   */
  public stopBackgroundChecks(): void {
    if (this.backgroundCheckTimer) {
      clearInterval(this.backgroundCheckTimer);
      this.backgroundCheckTimer = null;
      logger.info('ASSISTED_UPDATER', 'Background checks stopped');
    }
  }

  /**
   * Check if background check is needed (24h since last check)
   */
  private async checkIfBackgroundCheckNeeded(): Promise<void> {
    try {
      const lastCheck = this.getLastCheckTimestamp();
      const now = Date.now();
      const elapsed = now - lastCheck;

      if (elapsed >= this.options.backgroundCheckInterval) {
        logger.info('ASSISTED_UPDATER', 'Background check needed', {
          lastCheck: new Date(lastCheck).toISOString(),
          elapsed: `${Math.floor(elapsed / 1000 / 60 / 60)}h`,
        });
        await this.checkForUpdates(false); // Silent background check
        this.setLastCheckTimestamp(now);
      }
    } catch (error) {
      logger.error('ASSISTED_UPDATER', 'Background check failed', error);
    }
  }

  /**
   * Get last check timestamp from file
   */
  private getLastCheckTimestamp(): number {
    try {
      if (fs.existsSync(this.lastCheckTimestampFile)) {
        const data = JSON.parse(fs.readFileSync(this.lastCheckTimestampFile, 'utf-8'));
        // Validate parsed data has expected structure
        if (data && typeof data === 'object' && typeof data.lastCheck === 'number') {
          return data.lastCheck;
        }
        // Invalid structure, return 0
        return 0;
      }
    } catch (error) {
      logger.warn('ASSISTED_UPDATER', 'Failed to read last check timestamp', error);
    }
    return 0; // Never checked
  }

  /**
   * Save last check timestamp to file
   */
  private setLastCheckTimestamp(timestamp: number): void {
    try {
      fs.writeFileSync(
        this.lastCheckTimestampFile,
        JSON.stringify({ lastCheck: timestamp }, null, 2)
      );
    } catch (error) {
      logger.error('ASSISTED_UPDATER', 'Failed to save last check timestamp', error);
    }
  }

  /**
   * Check for updates (interactive or background)
   * @param interactive - If true, shows "up to date" dialog when no update
   */
  public async checkForUpdates(interactive: boolean = true): Promise<void> {
    if (!this.options.enabled) {
      if (interactive) {
        await this.showDialog({
          type: 'info',
          title: 'Updates Disabled',
          message: 'Assisted updates are disabled.',
          buttons: ['OK'],
        });
      }
      return;
    }

    if (!this.options.manifestUrl) {
      if (interactive) {
        await this.showDialog({
          type: 'error',
          title: 'Update Check Failed',
          message: 'No update manifest URL configured.',
          buttons: ['OK'],
        });
      }
      return;
    }

    logger.info('ASSISTED_UPDATER', 'Checking for updates', {
      interactive,
      manifestUrl: this.options.manifestUrl,
    });

    try {
      // Fetch manifest with cache-buster
      const manifest = await this.fetchManifest(this.options.manifestUrl);

      // Get current version
      const currentVersion = this.getCurrentVersion();
      const latestVersion = manifest.latest.version;

      logger.info('ASSISTED_UPDATER', 'Version comparison', {
        current: currentVersion,
        latest: latestVersion,
      });

      // Compare versions
      if (this.isNewerVersion(latestVersion, currentVersion)) {
        // Update available
        await this.showUpdateAvailableDialog(currentVersion, manifest.latest, interactive);
      } else {
        // Up to date
        if (interactive) {
          await this.showDialog({
            type: 'info',
            title: 'No Updates Available',
            message: `You're up to date! Current version: ${currentVersion}`,
            buttons: ['OK'],
          });
        }
        logger.info('ASSISTED_UPDATER', 'No update available');
      }
    } catch (error) {
      logger.error('ASSISTED_UPDATER', 'Update check failed', error);
      if (interactive) {
        await this.showDialog({
          type: 'error',
          title: 'Update Check Failed',
          message: 'Could not check for updates. Please try again later.',
          detail: error instanceof Error ? error.message : String(error),
          buttons: ['OK'],
        });
      }
    }
  }

  /**
   * Fetch update manifest from URL with timeout and cache-buster
   */
  private async fetchManifest(manifestUrl: string): Promise<UpdateManifest> {
    // Handle file:// URLs for dev mode
    if (manifestUrl.startsWith('file://')) {
      const filePath = manifestUrl.replace('file://', '');
      const content = fs.readFileSync(filePath, 'utf-8');
      return this.validateManifest(JSON.parse(content));
    }

    // Validate HTTPS in production
    if (!manifestUrl.startsWith('https://')) {
      throw new Error('Manifest URL must use HTTPS in production');
    }

    // Add cache-buster query param
    const cacheBustedUrl = `${manifestUrl}?ts=${Date.now()}`;

    logger.info('ASSISTED_UPDATER', 'Fetching manifest', { url: cacheBustedUrl });

    // Fetch with 4s timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    try {
      const response = await fetch(cacheBustedUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': `Produtime/${app.getVersion()}`,
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const manifest = await response.json();
      return this.validateManifest(manifest);
    } catch (error) {
      clearTimeout(timeoutId);
      if ((error as Error).name === 'AbortError') {
        throw new Error('Update check timed out (4s)');
      }
      throw error;
    }
  }

  /**
   * Validate manifest structure and security
   */
  private validateManifest(manifest: any): UpdateManifest {
    if (!manifest || typeof manifest !== 'object') {
      throw new Error('Invalid manifest: not an object');
    }

    if (!manifest.latest || typeof manifest.latest !== 'object') {
      throw new Error('Invalid manifest: missing "latest" object');
    }

    const { version, url } = manifest.latest;

    if (!version || typeof version !== 'string') {
      throw new Error('Invalid manifest: missing or invalid "version"');
    }

    if (!url || typeof url !== 'string') {
      throw new Error('Invalid manifest: missing or invalid "url"');
    }

    // Validate version format (semantic versioning)
    if (!/^\d+\.\d+\.\d+/.test(version)) {
      throw new Error(`Invalid version format: ${version}`);
    }

    // Validate URL security (must be HTTPS in production)
    const isDevUrl = url.startsWith('http://localhost') || url.startsWith('https://example.com');
    if (!url.startsWith('https://') && !isDevUrl) {
      throw new Error('Download URL must use HTTPS');
    }

    return manifest as UpdateManifest;
  }

  /**
   * Get current app version, stripping build metadata after '+'
   */
  private getCurrentVersion(): string {
    const fullVersion = app.getVersion();
    // Strip build metadata: 1.7.2+build123 → 1.7.2
    return fullVersion.split('+')[0];
  }

  /**
   * Compare semantic versions (major.minor.patch)
   * @returns true if newVersion > currentVersion
   */
  private isNewerVersion(newVersion: string, currentVersion: string): boolean {
    try {
      const parseVersion = (v: string): number[] => {
        return v.split('.').map(n => parseInt(n, 10) || 0);
      };

      const [newMajor, newMinor, newPatch] = parseVersion(newVersion);
      const [curMajor, curMinor, curPatch] = parseVersion(currentVersion);

      if (newMajor !== curMajor) return newMajor > curMajor;
      if (newMinor !== curMinor) return newMinor > curMinor;
      return newPatch > curPatch;
    } catch (error) {
      logger.error('ASSISTED_UPDATER', 'Version comparison failed', error);
      return false;
    }
  }

  /**
   * Show update available dialog
   */
  private async showUpdateAvailableDialog(
    currentVersion: string,
    latest: UpdateManifest['latest'],
    interactive: boolean
  ): Promise<void> {
    logger.info('ASSISTED_UPDATER', 'Update available', {
      current: currentVersion,
      latest: latest.version,
      url: latest.url,
    });

    // Build dialog message
    const message = `Produtime ${latest.version} is available (you have ${currentVersion}).`;
    const detail = latest.mandatory
      ? 'This update is mandatory. Please download and install it.'
      : 'Would you like to download the update?';

    // Build buttons based on available actions
    const buttons: string[] = [];
    buttons.push('Download Update');
    if (latest.releaseNotesUrl) {
      buttons.push('Release Notes');
    }
    if (!latest.mandatory) {
      buttons.push('Later');
    }

    const response = await this.showDialog({
      type: 'info',
      title: 'Update Available',
      message,
      detail,
      buttons,
      defaultId: 0,
      cancelId: buttons.length - 1,
    });

    // Handle button clicks
    const buttonIndex = response.response;
    const buttonText = buttons[buttonIndex];

    if (buttonText === 'Download Update') {
      logger.info('ASSISTED_UPDATER', 'Opening download URL', { url: latest.url });
      await shell.openExternal(latest.url);
    } else if (buttonText === 'Release Notes' && latest.releaseNotesUrl) {
      logger.info('ASSISTED_UPDATER', 'Opening release notes', { url: latest.releaseNotesUrl });
      await shell.openExternal(latest.releaseNotesUrl);
    } else {
      logger.info('ASSISTED_UPDATER', 'User dismissed update dialog');
    }
  }

  /**
   * Show dialog (uses main window if available)
   */
  private async showDialog(options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      return await dialog.showMessageBox(this.mainWindow, options);
    } else {
      return await dialog.showMessageBox(options);
    }
  }

  /**
   * Cleanup on app quit
   */
  public cleanup(): void {
    this.stopBackgroundChecks();
    logger.info('ASSISTED_UPDATER', 'Cleanup complete');
  }
}
