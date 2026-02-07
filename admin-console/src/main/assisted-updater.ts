/**
 * Admin Console Assisted Updater
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

import { app, dialog, shell, BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

interface UpdateManifest {
  product: string;
  channel: string;
  latest: {
    version: string;
    url: string;
    releaseNotesUrl?: string;
    mandatory?: boolean;
    minSupportedVersion?: string;
    sha256?: string;
  };
}

interface AssistedUpdaterOptions {
  enabled?: boolean;
  manifestUrl?: string;
  enableBackgroundChecks?: boolean;
  backgroundCheckInterval?: number;
}

export class AdminAssistedUpdater {
  private options: Required<AssistedUpdaterOptions>;
  private mainWindow: BrowserWindow | null = null;
  private backgroundCheckTimer: NodeJS.Timeout | null = null;
  private lastCheckTimestampFile: string;

  constructor(
    mainWindow: BrowserWindow | null,
    options: AssistedUpdaterOptions = {}
  ) {
    this.mainWindow = mainWindow;

    this.options = {
      enabled: options.enabled ?? true,
      manifestUrl: options.manifestUrl ?? 'https://raw.githubusercontent.com/georgekgr12/produtime-admin-releases/main/latest.json',
      enableBackgroundChecks: options.enableBackgroundChecks ?? true,
      backgroundCheckInterval: options.backgroundCheckInterval ?? 24 * 60 * 60 * 1000, // 24 hours
    };

    this.lastCheckTimestampFile = path.join(
      app.getPath('userData'),
      'admin-assisted-update-last-check.json'
    );

    console.log('[ADMIN_UPDATER] Initialized', {
      enabled: this.options.enabled,
      manifestUrl: this.options.manifestUrl,
      backgroundChecks: this.options.enableBackgroundChecks,
    });
  }

  public startBackgroundChecks(): void {
    if (!this.options.enabled || !this.options.enableBackgroundChecks) {
      console.log('[ADMIN_UPDATER] Background checks disabled');
      return;
    }

    if (!this.options.manifestUrl) {
      console.warn('[ADMIN_UPDATER] No manifest URL configured, background checks disabled');
      return;
    }

    // Check if we need to run a background check now
    this.checkIfBackgroundCheckNeeded();

    // Set up periodic checks (check every hour if background check is needed)
    this.backgroundCheckTimer = setInterval(() => {
      this.checkIfBackgroundCheckNeeded();
    }, 60 * 60 * 1000);

    console.log('[ADMIN_UPDATER] Background checks started');
  }

  public stopBackgroundChecks(): void {
    if (this.backgroundCheckTimer) {
      clearInterval(this.backgroundCheckTimer);
      this.backgroundCheckTimer = null;
      console.log('[ADMIN_UPDATER] Background checks stopped');
    }
  }

  private async checkIfBackgroundCheckNeeded(): Promise<void> {
    try {
      const lastCheck = this.getLastCheckTimestamp();
      const now = Date.now();
      const elapsed = now - lastCheck;

      if (elapsed >= this.options.backgroundCheckInterval) {
        console.log('[ADMIN_UPDATER] Background check needed', {
          lastCheck: new Date(lastCheck).toISOString(),
          elapsed: `${Math.floor(elapsed / 1000 / 60 / 60)}h`,
        });
        await this.checkForUpdates(false); // Silent background check
        this.setLastCheckTimestamp(now);
      }
    } catch (error) {
      console.error('[ADMIN_UPDATER] Background check failed', error);
    }
  }

  private getLastCheckTimestamp(): number {
    try {
      if (fs.existsSync(this.lastCheckTimestampFile)) {
        const data = JSON.parse(fs.readFileSync(this.lastCheckTimestampFile, 'utf-8'));
        return data.lastCheck || 0;
      }
    } catch (error) {
      console.warn('[ADMIN_UPDATER] Failed to read last check timestamp', error);
    }
    return 0;
  }

  private setLastCheckTimestamp(timestamp: number): void {
    try {
      fs.writeFileSync(
        this.lastCheckTimestampFile,
        JSON.stringify({ lastCheck: timestamp }, null, 2)
      );
    } catch (error) {
      console.error('[ADMIN_UPDATER] Failed to save last check timestamp', error);
    }
  }

  public async checkForUpdates(interactive: boolean = true): Promise<{ updateAvailable: boolean; version?: string }> {
    if (!this.options.enabled) {
      if (interactive) {
        await this.showDialog({
          type: 'info',
          title: 'Updates Disabled',
          message: 'Assisted updates are disabled.',
          buttons: ['OK'],
        });
      }
      return { updateAvailable: false };
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
      return { updateAvailable: false };
    }

    console.log('[ADMIN_UPDATER] Checking for updates', {
      interactive,
      manifestUrl: this.options.manifestUrl,
    });

    try {
      const manifest = await this.fetchManifest(this.options.manifestUrl);
      const currentVersion = this.getCurrentVersion();
      const latestVersion = manifest.latest.version;

      console.log('[ADMIN_UPDATER] Version comparison', {
        current: currentVersion,
        latest: latestVersion,
      });

      if (this.isNewerVersion(latestVersion, currentVersion)) {
        await this.showUpdateAvailableDialog(currentVersion, manifest.latest, interactive);
        return { updateAvailable: true, version: latestVersion };
      } else {
        if (interactive) {
          await this.showDialog({
            type: 'info',
            title: 'No Updates Available',
            message: `You're up to date! Current version: ${currentVersion}`,
            buttons: ['OK'],
          });
        }
        console.log('[ADMIN_UPDATER] No update available');
        return { updateAvailable: false };
      }
    } catch (error) {
      console.error('[ADMIN_UPDATER] Update check failed', error);
      if (interactive) {
        await this.showDialog({
          type: 'error',
          title: 'Update Check Failed',
          message: 'Could not check for updates. Please try again later.',
          detail: error instanceof Error ? error.message : String(error),
          buttons: ['OK'],
        });
      }
      return { updateAvailable: false };
    }
  }

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

    console.log('[ADMIN_UPDATER] Fetching manifest', { url: cacheBustedUrl });

    // Fetch with 4s timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    try {
      const response = await fetch(cacheBustedUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': `ProduTime-AdminConsole/${app.getVersion()}`,
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

    if (!/^\d+\.\d+\.\d+/.test(version)) {
      throw new Error(`Invalid version format: ${version}`);
    }

    const isDevUrl = url.startsWith('http://localhost') || url.startsWith('https://example.com');
    if (!url.startsWith('https://') && !isDevUrl) {
      throw new Error('Download URL must use HTTPS');
    }

    return manifest as UpdateManifest;
  }

  private getCurrentVersion(): string {
    const fullVersion = app.getVersion();
    return fullVersion.split('+')[0];
  }

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
      console.error('[ADMIN_UPDATER] Version comparison failed', error);
      return false;
    }
  }

  private async showUpdateAvailableDialog(
    currentVersion: string,
    latest: UpdateManifest['latest'],
    interactive: boolean
  ): Promise<void> {
    console.log('[ADMIN_UPDATER] Update available', {
      current: currentVersion,
      latest: latest.version,
      url: latest.url,
    });

    const message = `ProduTime Admin Console ${latest.version} is available (you have ${currentVersion}).`;
    const detail = latest.mandatory
      ? 'This update is mandatory. Please download and install it.'
      : 'Would you like to download the update?';

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

    const buttonIndex = response.response;
    const buttonText = buttons[buttonIndex];

    if (buttonText === 'Download Update') {
      console.log('[ADMIN_UPDATER] Opening download URL', { url: latest.url });
      await shell.openExternal(latest.url);
    } else if (buttonText === 'Release Notes' && latest.releaseNotesUrl) {
      console.log('[ADMIN_UPDATER] Opening release notes', { url: latest.releaseNotesUrl });
      await shell.openExternal(latest.releaseNotesUrl);
    } else {
      console.log('[ADMIN_UPDATER] User dismissed update dialog');
    }
  }

  private async showDialog(options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      return await dialog.showMessageBox(this.mainWindow, options);
    } else {
      return await dialog.showMessageBox(options);
    }
  }

  public cleanup(): void {
    this.stopBackgroundChecks();
    console.log('[ADMIN_UPDATER] Cleanup complete');
  }
}
