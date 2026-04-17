import { BrowserWindow, powerMonitor } from 'electron';
import { exec } from 'child_process';
// Safe runtime load to tolerate missing native binary during diagnostics
let activeWin: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  activeWin = require('active-win');
} catch (e) {
  activeWin = null;
  try {
    console.error('[ActivityTracker] active-win not available, disabling window tracking:', (e as any)?.message || e);
  } catch {}
}
import { DatabaseManager } from '../database';
import { DEFAULT_PRIVACY_APPS } from './privacy-constants';
import { SanitizationResult } from '../../shared/types';

export interface CurrentActivity {
  appName: string;
  windowTitle: string;
  startTime: Date;
  isIdle: boolean;
}

export interface ActivityTrackerOptions {
  pollInterval?: number; // ms
  idleThreshold?: number; // seconds
  enableLogging?: boolean;
  // Treat brief focus on our own app (Electron/TimePort) as noise
  selfLogSuppressMs?: number; // do not log self-app entries shorter than this
  selfAppNames?: string[]; // names considered "self"; defaults to ['Electron', 'TimePort']
  // Stabilization sampling to avoid transient mis-detections during fast switches
  stabilizationSamples?: number; // number of samples to take per tick (default 3)
  stabilizationWindowMs?: number; // spread samples over this window (default 250ms)
  ignoreTransientApps?: string[]; // processes commonly seen transiently (e.g., 'SearchHost.exe')
}

export class ActivityTracker {
  private mainWindow: BrowserWindow | null = null;
  private isTracking = false;
  private isPaused = false;
  private currentActivity: CurrentActivity | null = null;
  private trackingInterval: NodeJS.Timeout | null = null;
  // Re-entrancy guard for checkCurrentActivity. The poll interval can be as
  // low as 500ms while a single sampling pass (getActiveWindow → 3 samples
  // over 250ms + DB writes) can exceed that under load, so timer ticks can
  // overlap and corrupt currentActivity / pendingDetection state.
  private isCheckingActivity = false;
  private idleCheckInterval: NodeJS.Timeout | null = null;
  private lastActivityTime: Date = new Date();
  private readonly appStartTime: Date = new Date(); // When this tracker instance was created
  // Confirmation window to reduce mis-commits on fast switches
  private pendingDetection: { appName: string; windowTitle: string } | null =
    null;
  private detectionCount = 0;
  // Recent raw samples for diagnostics
  private recentSamples: Array<{
    ts: number;
    appName: string;
    windowTitle: string;
  }> = [];
  // Cooldown to prevent rapid idle/active switching
  private lastIdleEndTime: number = 0;
  private resumeCheckTimer: NodeJS.Timeout | null = null;
  // Bound handlers for powerMonitor events (so we can remove them on stop)
  private boundHandleSuspend: (() => void) | null = null;
  private boundHandleResume: (() => void) | null = null;
  private boundHandleLockScreen: (() => void) | null = null;
  private boundHandleUnlockScreen: (() => void) | null = null;

  constructor(
    private database: DatabaseManager,
    private options: ActivityTrackerOptions = {}
  ) {
    this.options = {
      pollInterval: 5000,
      idleThreshold: 300,
      enableLogging: false,
      selfLogSuppressMs: 900,
      selfAppNames: ['Electron', 'ProduTime', 'TimePort'],
      stabilizationSamples: 3,
      stabilizationWindowMs: 250,
      ignoreTransientApps: [
        'SearchHost.exe',
        'Task Switching',
        'TaskSwitch.exe',
        'LockApp.exe',
        'WinSwitchHost.exe',
      ],
      ...options,
    };
  }

  public setMainWindow(window: BrowserWindow) {
    this.mainWindow = window;
  }

  public async startTracking(): Promise<void> {
    if (this.isTracking && !this.isPaused) {
      console.log('Activity tracking is already running');
      return;
    }

    console.log('Starting activity tracking...');
    this.isTracking = true;
    this.isPaused = false;
    this.lastActivityTime = new Date();

    this.trackingInterval = setInterval(() => {
      if (!this.isPaused) this.checkCurrentActivity();
    }, this.options.pollInterval);

    this.idleCheckInterval = setInterval(() => {
      this.checkIdleStatus(); // Always run idle check, it handles paused state internally
    }, 1000);

    // Register power/lock event handlers so sleep and lock-screen periods are
    // captured as idle time even when the 5-minute threshold hasn't been reached.
    this.boundHandleSuspend = () => this.handlePowerSuspend();
    this.boundHandleResume = () => this.handlePowerResume();
    this.boundHandleLockScreen = () => this.handlePowerSuspend(); // same logic as suspend
    this.boundHandleUnlockScreen = () => this.handlePowerResume(); // same logic as resume
    powerMonitor.on('suspend', this.boundHandleSuspend);
    powerMonitor.on('resume', this.boundHandleResume);
    powerMonitor.on('lock-screen', this.boundHandleLockScreen);
    powerMonitor.on('unlock-screen', this.boundHandleUnlockScreen);

    await this.checkCurrentActivity();
    console.log('✅ Activity tracking started successfully');
  }

  public async stopTracking(): Promise<void> {
    if (!this.isTracking) return;
    this.isTracking = false;
    this.isPaused = false;

    if (this.trackingInterval) clearInterval(this.trackingInterval);
    if (this.idleCheckInterval) clearInterval(this.idleCheckInterval);
    if (this.resumeCheckTimer) clearTimeout(this.resumeCheckTimer);
    this.trackingInterval = null;
    this.idleCheckInterval = null;
    this.resumeCheckTimer = null;

    // Remove power/lock event handlers
    if (this.boundHandleSuspend) powerMonitor.removeListener('suspend', this.boundHandleSuspend);
    if (this.boundHandleResume) powerMonitor.removeListener('resume', this.boundHandleResume);
    if (this.boundHandleLockScreen) powerMonitor.removeListener('lock-screen', this.boundHandleLockScreen);
    if (this.boundHandleUnlockScreen) powerMonitor.removeListener('unlock-screen', this.boundHandleUnlockScreen);
    this.boundHandleSuspend = null;
    this.boundHandleResume = null;
    this.boundHandleLockScreen = null;
    this.boundHandleUnlockScreen = null;

    if (this.currentActivity) {
      await this.logCurrentActivity();
    }
    this.currentActivity = null;
    // Notify renderer immediately so UI reflects stopped state
    this.notifyActivityChange();
  }

  public isTrackingActive(): boolean {
    return this.isTracking && !this.isPaused;
  }

  public isPausedState(): boolean {
    return this.isPaused;
  }

  public async pauseTracking(): Promise<void> {
    if (!this.isTracking || this.isPaused) return;
    // Log the current active activity to preserve its duration
    if (this.currentActivity && !this.currentActivity.isIdle) {
      await this.logCurrentActivity();
    }
    // Reset any pending detection so no in-flight commit overrides paused state
    this.pendingDetection = null;
    this.detectionCount = 0;

    this.isPaused = true;
    this.lastActivityTime = new Date();
    // Switch to paused synthetic idle activity
    this.currentActivity = {
      appName: 'System',
      windowTitle: 'Paused',
      startTime: new Date(),
      isIdle: true,
    };
    this.notifyActivityChange();
  }

  public async resumeTracking(): Promise<void> {
    if (!this.isTracking || !this.isPaused) return;
    // Log paused block
    if (this.currentActivity && this.currentActivity.isIdle) {
      await this.logCurrentActivity();
    }
    this.isPaused = false;
    this.lastActivityTime = new Date();

    // Clear current activity to null first to ensure clean state transition
    this.currentActivity = null;
    this.notifyActivityChange();

    // BUG FIX #3: Remove setTimeout to eliminate race condition
    // Call checkCurrentActivity synchronously to immediately detect the current window
    await this.checkCurrentActivity();
  }

  public getCurrentActivity(): CurrentActivity | null {
    if (!this.currentActivity) {
      return null;
    }
    // Apply privacy sanitization before returning
    const sanitized = this.sanitizeWindowTitle(
      this.currentActivity.appName,
      this.currentActivity.windowTitle
    );
    if (sanitized.wasSanitized) {
      return {
        ...this.currentActivity,
        windowTitle: sanitized.windowTitle
      };
    }
    return this.currentActivity;
  }

  public updateIdleThreshold(seconds: number) {
    this.options.idleThreshold = seconds;
  }

  public setEnableLogging(enabled: boolean) {
    this.options.enableLogging = enabled;
  }

  public setPollInterval(ms: number) {
    const MIN_POLL_MS = 100;
    const MAX_POLL_MS = 60_000;
    const n = Number(ms);
    const bounded =
      Number.isFinite(n) ? Math.max(MIN_POLL_MS, Math.min(MAX_POLL_MS, Math.floor(n))) : this.options.pollInterval;
    this.options.pollInterval = bounded;
    if (this.trackingInterval) {
      clearInterval(this.trackingInterval);
      this.trackingInterval = setInterval(() => {
        if (!this.isPaused) this.checkCurrentActivity();
      }, this.options.pollInterval);
    }
  }

  public getDiagnostics() {
    return {
      recentSamples: this.recentSamples.slice(-20),
      pendingDetection: this.pendingDetection,
      detectionCount: this.detectionCount,
      options: this.options,
    };
  }

  public getTrackingStats() {
    return {
      isTracking: this.isTracking,
      currentActivity: this.currentActivity,
      idleThreshold: this.options.idleThreshold,
      pollInterval: this.options.pollInterval,
    };
  }

  /**
   * Sanitizes window title for privacy-sensitive applications.
   * When privacy mode is enabled and the app matches a privacy app,
   * the window title is replaced with just the app name.
   */
  /**
   * Browser app names that should have site extraction applied
   */
  private static readonly BROWSER_APPS = [
    'google chrome', 'chrome', 'firefox', 'mozilla firefox',
    'microsoft edge', 'edge', 'opera', 'brave browser', 'brave',
    'safari', 'vivaldi', 'arc',
  ];

  /**
   * Known site title → domain mappings for common sites
   */
  private static readonly SITE_MAPPINGS: Record<string, string> = {
    // Social
    'facebook': 'facebook.com', 'instagram': 'instagram.com',
    'twitter': 'twitter.com', 'x': 'x.com',
    'linkedin': 'linkedin.com', 'reddit': 'reddit.com',
    'pinterest': 'pinterest.com', 'tumblr': 'tumblr.com',
    'mastodon': 'mastodon.social', 'bluesky': 'bsky.app',
    // Messaging
    'whatsapp': 'whatsapp.com', 'whatsapp web': 'whatsapp.com',
    'telegram': 'telegram.org', 'slack': 'slack.com',
    'discord': 'discord.com', 'messenger': 'messenger.com',
    'signal': 'signal.org', 'teams': 'teams.microsoft.com',
    'microsoft teams': 'teams.microsoft.com',
    'zoom': 'zoom.us',
    // Video / audio
    'youtube': 'youtube.com', 'netflix': 'netflix.com',
    'spotify': 'spotify.com', 'twitch': 'twitch.tv',
    'tiktok': 'tiktok.com', 'vimeo': 'vimeo.com',
    'soundcloud': 'soundcloud.com', 'disney+': 'disneyplus.com',
    'hbo max': 'hbomax.com', 'prime video': 'primevideo.com',
    'apple music': 'music.apple.com',
    // Email
    'gmail': 'gmail.com', 'google mail': 'gmail.com',
    'outlook': 'outlook.com', 'outlook.com': 'outlook.com',
    'yahoo mail': 'yahoo.com', 'proton mail': 'proton.me',
    // Google workspace
    'google docs': 'docs.google.com', 'google sheets': 'sheets.google.com',
    'google slides': 'slides.google.com', 'google forms': 'forms.google.com',
    'google drive': 'drive.google.com', 'google calendar': 'calendar.google.com',
    'google meet': 'meet.google.com', 'google maps': 'maps.google.com',
    'google keep': 'keep.google.com', 'google photos': 'photos.google.com',
    'google translate': 'translate.google.com',
    'google search': 'google.com', 'google': 'google.com',
    // Dev / work tools
    'github': 'github.com', 'gitlab': 'gitlab.com',
    'bitbucket': 'bitbucket.org', 'stack overflow': 'stackoverflow.com',
    'stackoverflow': 'stackoverflow.com',
    'notion': 'notion.so', 'figma': 'figma.com',
    'trello': 'trello.com', 'jira': 'atlassian.net',
    'confluence': 'atlassian.net', 'asana': 'asana.com',
    'linear': 'linear.app', 'monday.com': 'monday.com',
    'clickup': 'clickup.com', 'airtable': 'airtable.com',
    'miro': 'miro.com', 'canva': 'canva.com',
    'dropbox': 'dropbox.com', 'onedrive': 'onedrive.live.com',
    'vscode': 'vscode.dev', 'codepen': 'codepen.io',
    'replit': 'replit.com', 'codesandbox': 'codesandbox.io',
    'vercel': 'vercel.com', 'netlify': 'netlify.com',
    'cloudflare': 'cloudflare.com', 'aws': 'aws.amazon.com',
    'azure': 'azure.microsoft.com', 'gcp': 'cloud.google.com',
    'railway': 'railway.app', 'render': 'render.com',
    'heroku': 'heroku.com', 'docker': 'docker.com',
    'npm': 'npmjs.com', 'pypi': 'pypi.org',
    // AI
    'chatgpt': 'chatgpt.com', 'openai': 'openai.com',
    'claude': 'claude.ai', 'anthropic': 'anthropic.com',
    'gemini': 'gemini.google.com', 'perplexity': 'perplexity.ai',
    'copilot': 'copilot.microsoft.com', 'mistral': 'mistral.ai',
    // Shopping
    'amazon': 'amazon.com', 'ebay': 'ebay.com',
    'etsy': 'etsy.com', 'aliexpress': 'aliexpress.com',
    'walmart': 'walmart.com', 'target': 'target.com',
    'shopify': 'shopify.com',
    // News
    'bbc': 'bbc.com', 'cnn': 'cnn.com',
    'new york times': 'nytimes.com', 'the guardian': 'theguardian.com',
    'wsj': 'wsj.com', 'bloomberg': 'bloomberg.com',
    'wikipedia': 'wikipedia.org',
    // Misc
    'chrome web store': 'chrome.google.com',
    'new tab': 'newtab',
  };

  /**
   * Extract site/domain from a browser window title.
   * Chrome titles: "Page Title - Site Name - Google Chrome"
   * Returns the site name or domain if found.
   */
  private extractSiteFromBrowserTitle(windowTitle: string, appName: string): string | null {
    // Remove the browser suffix (e.g. " - Google Chrome", " — Mozilla Firefox")
    const browserSuffixes = [
      / - Google Chrome$/i, / — Google Chrome$/i,
      / - Mozilla Firefox$/i, / — Mozilla Firefox$/i,
      / - Microsoft Edge$/i, / — Microsoft Edge$/i,
      / - Opera$/i, / — Opera$/i,
      / - Brave$/i, / — Brave$/i,
      / - Vivaldi$/i, / — Vivaldi$/i,
      / - Arc$/i, / — Arc$/i,
      / - Safari$/i, / — Safari$/i,
    ];

    let title = windowTitle;
    for (const suffix of browserSuffixes) {
      title = title.replace(suffix, '');
    }

    // Handle new-tab / empty cases
    if (!title || title.toLowerCase() === appName.toLowerCase() || title.trim() === '') {
      return 'new-tab';
    }

    // Strip notification counts like "(1) ", "(23) " from the beginning
    title = title.replace(/^\(\d+\)\s*/, '').trim();

    // If the entire title is a URL or domain, extract the host
    const urlMatch = title.match(/https?:\/\/([^\/\s]+)/);
    if (urlMatch) return this.getParentDomain(urlMatch[1]);

    // Split by common separators: " - ", " — ", " | ", " · "
    const parts = title.split(/\s[-—|·]\s/);

    // Try each part from the end (site name is usually at the end)
    for (let i = parts.length - 1; i >= 0; i--) {
      const candidate = parts[i].trim().replace(/^\(\d+\)\s*/, '');
      if (!candidate) continue;
      const key = candidate.toLowerCase();

      // Known site match
      if (ActivityTracker.SITE_MAPPINGS[key]) {
        return ActivityTracker.SITE_MAPPINGS[key];
      }

      // Fuzzy match against known sites (for titles like "X: The Everything App")
      for (const [siteKey, domain] of Object.entries(ActivityTracker.SITE_MAPPINGS)) {
        if (key.includes(siteKey) && siteKey.length > 3) return domain;
      }

      // Looks like a domain (contains a dot, no spaces)
      if (candidate.includes('.') && !candidate.includes(' ')) {
        return this.getParentDomain(candidate.toLowerCase());
      }
    }

    // Last resort: take the last segment as the site name
    const lastPart = parts[parts.length - 1].trim().replace(/^\(\d+\)\s*/, '');
    if (lastPart && lastPart.length < 40) {
      // Limit length to avoid storing full article titles
      return lastPart;
    }

    return 'other';
  }

  /**
   * Extract the parent domain from a hostname.
   * e.g. "mail.google.com" → "google.com", "www.reddit.com" → "reddit.com"
   */
  private getParentDomain(hostname: string): string {
    // Strip www. and any leading subdomains except for known multi-part TLDs
    const clean = hostname.replace(/^www\./i, '');
    const parts = clean.split('.');
    if (parts.length <= 2) return clean;
    // Keep known service subdomains (mail.google.com should become google.com for privacy)
    // But preserve the main domain pattern
    return parts.slice(-2).join('.');
  }

  public sanitizeWindowTitle(appName: string, windowTitle: string): SanitizationResult {
    // Privacy mode is always on for managed deployments

    // For browsers: extract site name into window_title
    const isBrowser = ActivityTracker.BROWSER_APPS.some(b => appName.toLowerCase().includes(b));
    if (isBrowser) {
      const site = this.extractSiteFromBrowserTitle(windowTitle, appName);
      if (site) {
        // Keep app_name as-is for Top Apps aggregation
        // Put site in window_title for Recent Activity display
        return { appName, windowTitle: site, wasSanitized: true };
      }
    }

    // For System/Idle and System/Paused: preserve window title so idle detection works
    if (appName === 'System' && (windowTitle === 'Idle' || windowTitle === 'Paused')) {
      return { appName, windowTitle, wasSanitized: false };
    }

    // For non-browser apps or when site can't be extracted: strip window title
    return { appName, windowTitle: appName, wasSanitized: true };
  }

  /**
   * Gets the list of privacy-sensitive applications from settings.
   * Falls back to DEFAULT_PRIVACY_APPS if setting is missing or invalid.
   */
  public getPrivacyApps(): string[] {
    const setting = this.database.getSetting('privacy_apps');
    if (setting) {
      try {
        return JSON.parse(setting);
      } catch {
        return DEFAULT_PRIVACY_APPS;
      }
    }
    return DEFAULT_PRIVACY_APPS;
  }

  // Flush the current in-progress block into the database so reports include up-to-the-moment data.
  // Tracking continues seamlessly by resetting the start time to now.
  public async snapshotNow(): Promise<void> {
    try {
      if (!this.currentActivity) return;
      const duration = Math.floor(
        (Date.now() - this.currentActivity.startTime.getTime()) / 1000
      );
      if (duration >= 1) {
        // Apply privacy sanitization before database insert
        const sanitized = this.sanitizeWindowTitle(
          this.currentActivity.appName,
          this.currentActivity.windowTitle
        );

        this.database.insertActivityLog({
          timestamp: this.currentActivity.startTime.toISOString(),
          app_name: sanitized.appName,
          window_title: sanitized.windowTitle,
          duration,
        });
        // Reset start time so we don't double-count after the snapshot
        this.currentActivity.startTime = new Date();
        this.lastActivityTime = new Date();
        if (this.options.enableLogging) {
          console.log(
            '[ActivityTracker] Snapshot logged current block and reset start time'
          );
        }
      }
    } catch (err) {
      console.error('ActivityTracker snapshot failed:', err);
    }
  }

  private async checkCurrentActivity(): Promise<void> {
    // Re-entrancy guard: skip if a prior tick is still sampling/writing.
    // Drops a tick rather than letting two concurrent passes mutate
    // currentActivity, pendingDetection and commit overlapping log rows.
    if (this.isCheckingActivity) return;
    this.isCheckingActivity = true;
    try {
      // If we're currently idle, don't check for activity changes to prevent flashing
      // The idle detection system will handle ending idle when appropriate
      if (
        this.currentActivity?.isIdle === true &&
        this.currentActivity?.windowTitle === 'Idle'
      ) {
        return;
      }

      const before = Date.now();
      const activeWindow = await this.getActiveWindow();
      const after = Date.now();
      if (!activeWindow) return;

      const { appName, windowTitle } = activeWindow;
      const isSelfApp = (this.options.selfAppNames || []).includes(appName);
      const now = new Date();
      const suppressMs = this.options.selfLogSuppressMs ?? 0;
      const justSwitchedAway =
        !!this.currentActivity &&
        !this.currentActivity.isIdle &&
        now.getTime() - this.lastActivityTime.getTime() < suppressMs;

      // Track raw sample for diagnostics (keep last 20)
      this.recentSamples.push({ ts: Date.now(), appName, windowTitle });
      if (this.recentSamples.length > 20) this.recentSamples.shift();

      // Debug: detailed sampling of what active-win returns
      if (this.options.enableLogging) {
        console.log(
          `active-win: app="${appName}" title="${windowTitle}" self=${isSelfApp} dt=${after - before}ms justAway=${justSwitchedAway}`
        );
      }

      if (isSelfApp && justSwitchedAway) {
        // Skip updating to self app; keep current activity until real app confirms
        return;
      }

      // Two-consecutive-tick confirmation before committing a switch
      const incoming = { appName, windowTitle };
      if (
        this.pendingDetection &&
        this.pendingDetection.appName === incoming.appName &&
        this.pendingDetection.windowTitle === incoming.windowTitle
      ) {
        this.detectionCount += 1;
      } else {
        this.pendingDetection = incoming;
        this.detectionCount = 1;
      }

      // Special handling for self-app when coming out of idle
      const isSelfAppFromIdle =
        isSelfApp &&
        this.currentActivity?.isIdle === true &&
        this.currentActivity?.windowTitle === 'Idle';

      // Require many more confirmations when switching from idle to self-app to prevent flashing
      const requiredConfirmations = isSelfAppFromIdle ? 15 : 2;
      const canCommit =
        this.detectionCount >= requiredConfirmations ||
        (this.currentActivity?.isIdle === true &&
          this.detectionCount >= 1 &&
          !isSelfAppFromIdle);

      if (canCommit) {
        // Only commit if the confirmed window differs from the current one
        if (this.hasActivityChanged(appName, windowTitle)) {
          if (this.currentActivity && !this.currentActivity.isIdle) {
            await this.logCurrentActivity();
          }
          this.currentActivity = {
            appName,
            windowTitle,
            startTime: new Date(),
            isIdle: false,
          };
          this.lastActivityTime = now;
          this.notifyActivityChange();
        }
        // Reset confirmation so the next change must confirm again
        this.pendingDetection = null;
        this.detectionCount = 0;
      }
    } catch (err) {
      console.error('Activity check failed:', err);
    } finally {
      this.isCheckingActivity = false;
    }
  }

  private hasActivityChanged(appName: string, windowTitle: string): boolean {
    if (!this.currentActivity) return true;
    return (
      this.currentActivity.appName !== appName ||
      this.currentActivity.windowTitle !== windowTitle ||
      this.currentActivity.isIdle === true
    );
  }

  private async logCurrentActivity(): Promise<void> {
    if (!this.currentActivity) return;
    try {
      const duration = Math.floor(
        (Date.now() - this.currentActivity.startTime.getTime()) / 1000
      );
      if (duration >= 1) {
        // Apply privacy sanitization before database insert
        const sanitized = this.sanitizeWindowTitle(
          this.currentActivity.appName,
          this.currentActivity.windowTitle
        );

        this.database.insertActivityLog({
          timestamp: this.currentActivity.startTime.toISOString(),
          app_name: sanitized.appName,
          window_title: sanitized.windowTitle,
          duration,
        });
      }
    } catch (err) {
      console.error('Failed to log activity:', err);
    }
  }

  private checkIdleStatus(): void {
    if (!this.isTracking) return;

    // During pause, maintain paused state and don't transition to system idle
    if (this.isPaused) {
      // Ensure current activity stays as "Paused" during pause
      if (
        !this.currentActivity ||
        this.currentActivity.windowTitle !== 'Paused'
      ) {
        this.currentActivity = {
          appName: 'System',
          windowTitle: 'Paused',
          startTime: this.currentActivity?.startTime || new Date(),
          isIdle: true,
        };
        this.notifyActivityChange();
      }
      return;
    }

    const idleSeconds = powerMonitor.getSystemIdleTime();
    const idleThreshold = this.options.idleThreshold || 300;
    const shouldBeIdle = idleSeconds >= idleThreshold;

    if (!this.currentActivity) return;

    if (shouldBeIdle && !this.currentActivity.isIdle) {
      // Reduced cooldown from 10s to 3s to detect short breaks more accurately
      const timeSinceIdleEnd = Date.now() - this.lastIdleEndTime;
      if (timeSinceIdleEnd > 3000) {
        // 3 second cooldown
        this.handleIdleStart();
      }
    } else if (
      !shouldBeIdle &&
      this.currentActivity.isIdle &&
      this.currentActivity.windowTitle === 'Idle'
    ) {
      // More lenient threshold - end idle if system has been active for less than 5 seconds
      // This catches brief interactions that were previously missed
      if (idleSeconds < 5) {
        this.handleIdleEnd();
      }
    }
  }

  private async handleIdleStart(): Promise<void> {
    if (!this.currentActivity) return;

    if (!this.currentActivity.isIdle) {
      await this.logCurrentActivity();
    }

    // Calculate when idle actually started based on system idle time.
    // Cap to app start time so overnight/shutdown idle doesn't bleed in.
    const idleSeconds = powerMonitor.getSystemIdleTime();
    const rawIdleStart = Date.now() - idleSeconds * 1000;
    const idleStartTime = new Date(Math.max(rawIdleStart, this.appStartTime.getTime()));

    this.currentActivity = {
      appName: 'System',
      windowTitle: this.isPaused ? 'Paused' : 'Idle',
      startTime: idleStartTime,
      isIdle: true,
    };

    this.notifyActivityChange();
  }

  private async handleIdleEnd(): Promise<void> {
    if (this.currentActivity && this.currentActivity.isIdle) {
      await this.logCurrentActivity();
    }
    this.lastActivityTime = new Date();
    this.lastIdleEndTime = Date.now();

    // Immediately detect new activity instead of waiting
    // This prevents UI flashing and provides faster response
    this.currentActivity = null;
    await this.checkCurrentActivity();

    // If no activity detected (shouldn't happen), wait briefly and try again
    if (!this.currentActivity) {
      if (this.resumeCheckTimer) clearTimeout(this.resumeCheckTimer);
      this.resumeCheckTimer = setTimeout(async () => {
        this.resumeCheckTimer = null;
        try {
          const idleSeconds = powerMonitor.getSystemIdleTime();
          if (idleSeconds < 3) { // More lenient than === 0
            await this.checkCurrentActivity();
          } else {
            // User went idle again, restart idle detection
            this.handleIdleStart();
          }
        } catch (err) {
          console.error('Error in activity resume check:', err);
        }
      }, 500); // Reduced from 2 seconds to 500ms
    }
  }

  /**
   * Called on system suspend or screen lock.
   * Forces immediate idle start (bypassing the threshold) so that
   * sleep/lock periods are recorded as idle time.
   */
  private handlePowerSuspend(): void {
    if (!this.isTracking || this.isPaused) return;
    if (this.currentActivity?.isIdle) return; // already idle, nothing to do
    console.log('⏸️ System suspend/lock detected — forcing idle start');
    this.handleIdleStart();
  }

  /**
   * Called on system resume or screen unlock.
   * Triggers an immediate idle-status check so the idle period is
   * ended promptly instead of waiting up to 1 second for the next tick.
   */
  private handlePowerResume(): void {
    if (!this.isTracking) return;
    console.log('▶️ System resume/unlock detected — checking idle status');
    // Small delay to let the OS settle and report accurate idle time
    setTimeout(() => this.checkIdleStatus(), 500);
  }

  private notifyActivityChange(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      // Apply privacy sanitization to current activity before sending to renderer
      let activityToSend = this.currentActivity;
      if (this.currentActivity) {
        const sanitized = this.sanitizeWindowTitle(
          this.currentActivity.appName,
          this.currentActivity.windowTitle
        );
        if (sanitized.wasSanitized) {
          activityToSend = {
            ...this.currentActivity,
            windowTitle: sanitized.windowTitle
          };
        }
      }
      this.mainWindow.webContents.send(
        'activity:changed',
        activityToSend
      );
    }
  }

  private async getActiveWindow(): Promise<{
    appName: string;
    windowTitle: string;
  } | null> {
    if (this.isPaused) {
      return { appName: 'System', windowTitle: 'Paused' };
    }
    if (!activeWin) {
      // Fallback to platform-specific methods when active-win native module is unavailable.
      // Windows-only app: no macOS fallback. Linux path kept for dev on WSL.
      if (process.platform === 'win32') {
        return this.getActiveWindowWindows();
      }
      return this.getActiveWindowLinux();
    }
    try {
      // Take 3 samples to balance accuracy vs speed (reduced from 5)
      const samples = this.options.stabilizationSamples ?? 3;
      const windowMs = this.options.stabilizationWindowMs ?? 250;
      const delay = samples > 1 ? Math.floor(windowMs / (samples - 1)) : 0;

      const reads: Array<{ appName: string; windowTitle: string; timestamp: number }> = [];
      for (let i = 0; i < samples; i++) {
        const result = await activeWin();
        if (result) {
          let appName = result.owner?.name || 'Unknown';
          const windowTitle = result.title || 'Unknown Window';
          if (/^electron$/i.test(appName)) appName = 'ProduTime';
          if (/^code(?:\.exe)?$/i.test(appName)) appName = 'Visual Studio Code';
          if (/^chrome(?:\.exe)?$/i.test(appName)) appName = 'Google Chrome';
          reads.push({ appName, windowTitle, timestamp: Date.now() });
        }
        if (delay > 0 && i < samples - 1) {
          await new Promise((r) => setTimeout(r, delay));
        }
      }

      if (reads.length === 0) return null;

      // Improved selection logic with recency weight
      const counts = new Map<string, number>();
      for (const r of reads) {
        counts.set(r.appName, (counts.get(r.appName) || 0) + 1);
      }

      // Find max count
      let maxCount = 0;
      for (const count of counts.values()) {
        if (count > maxCount) maxCount = count;
      }

      // Get all apps with max count
      const candidates = Array.from(counts.entries())
        .filter(([_, count]) => count === maxCount)
        .map(([name]) => name);

      let selected = reads[reads.length - 1];

      // If there's a tie, prefer the most recent non-transient app
      if (candidates.length > 1) {
        const transient = this.options.ignoreTransientApps || [];
        const nonTransientCandidates = candidates.filter(name => !transient.includes(name));

        if (nonTransientCandidates.length > 0) {
          // Find the most recent occurrence of non-transient candidates
          for (let i = reads.length - 1; i >= 0; i--) {
            if (nonTransientCandidates.includes(reads[i].appName)) {
              selected = reads[i];
              break;
            }
          }
        } else {
          // All are transient, use most recent
          selected = reads[reads.length - 1];
        }
      } else {
        // Single winner
        selected = reads.find(r => r.appName === candidates[0])!;
      }

      // Avoid transient system helpers unless they're the only option
      const transient = this.options.ignoreTransientApps || [];
      if (transient.includes(selected.appName) && reads.length > 1) {
        const alt = reads.find((r) => !transient.includes(r.appName));
        if (alt) selected = alt;
      }

      return { appName: selected.appName, windowTitle: selected.windowTitle };
    } catch (error) {
      console.error('Error getting active window:', error);
      return null;
    }
  }

  // Legacy fallback methods retained for reference but unused with active-win
  private async getActiveWindowWindows(): Promise<{
    appName: string;
    windowTitle: string;
  } | null> {
    return new Promise((resolve) => {
      const command = `
        Add-Type @"\n  using System;\n  using System.Runtime.InteropServices;\n  using System.Text;\n  public class Win32 {\n    [DllImport("user32.dll")]\n    public static extern IntPtr GetForegroundWindow();\n    [DllImport("user32.dll")]\n    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);\n    [DllImport("user32.dll", SetLastError=true)]\n    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);\n  }\n"@\n        $hwnd = [Win32]::GetForegroundWindow()\n        $title = New-Object System.Text.StringBuilder 256\n        [Win32]::GetWindowText($hwnd, $title, $title.Capacity) | Out-Null\n        $processId = 0\n        [Win32]::GetWindowThreadProcessId($hwnd, [ref]$processId) | Out-Null\n        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue\n        if ($process) {\n          Write-Output "$($process.ProcessName)|$($title.ToString())"\n        }\n      `;

      exec(`powershell -Command "${command}"`, (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        const output = stdout.trim();
        if (output && output.includes('|')) {
          const [appName, windowTitle] = output.split('|', 2);
          resolve({
            appName: appName || 'Unknown',
            windowTitle: windowTitle || 'Unknown Window',
          });
        } else {
          resolve(null);
        }
      });
    });
  }

  private async getActiveWindowLinux(): Promise<{
    appName: string;
    windowTitle: string;
  } | null> {
    return new Promise((resolve) => {
      exec('xdotool getactivewindow getwindowname', (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        const windowTitle = stdout.trim();
        exec('xdotool getactivewindow getwindowpid', (pidError, pidStdout) => {
          if (pidError) {
            resolve({
              appName: 'Unknown',
              windowTitle: windowTitle || 'Unknown Window',
            });
            return;
          }
          const pid = pidStdout.trim();
          exec(`ps -p ${pid} -o comm=`, (commError, commStdout) => {
            const appName = commError ? 'Unknown' : commStdout.trim();
            resolve({ appName, windowTitle: windowTitle || 'Unknown Window' });
          });
        });
      });
    });
  }
}
