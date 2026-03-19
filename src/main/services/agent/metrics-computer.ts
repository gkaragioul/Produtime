/**
 * Metrics Computer for Agent
 * Computes aggregated metrics for heartbeat payloads
 * 
 * COMPLIANCE: This is NOT spyware.
 * - Only aggregated stats are computed (no raw window titles)
 * - Untracked time is computed from gaps in activity logs
 * - All data is privacy-respecting
 */

import { DatabaseManager } from '../../database';
import {
  DailyMetricsSummary,
  PeriodMetricsSummary,
  TopAppEntry,
} from '../../../shared/dashboard-types';

// Gap threshold for untracked time detection (60 seconds)
const UNTRACKED_GAP_THRESHOLD_MS = 60000;

// App categorization type
type AppCategory = 'productive' | 'distracting' | 'neutral';

/**
 * Default app categorization patterns.
 * Each entry is a lowercase substring matched against the app_name.
 * Apps not matching any pattern are treated as neutral.
 */
const DEFAULT_PRODUCTIVE_PATTERNS: string[] = [
  // IDEs and editors
  'code', 'visual studio', 'vscode', 'intellij', 'webstorm', 'pycharm',
  'rider', 'phpstorm', 'rubymine', 'goland', 'clion', 'datagrip',
  'android studio', 'xcode', 'eclipse', 'netbeans', 'sublime', 'atom',
  'notepad++', 'vim', 'neovim', 'emacs', 'cursor',
  // Terminals and shells
  'terminal', 'powershell', 'cmd.exe', 'command prompt', 'iterm',
  'windows terminal', 'wt.exe', 'mintty', 'conemu', 'hyper',
  'git bash', 'wsl',
  // Microsoft Office
  'word', 'excel', 'powerpoint', 'outlook', 'onenote', 'access',
  'publisher', 'visio', 'project', 'teams',
  // Google Workspace (as app names)
  'google docs', 'google sheets', 'google slides',
  // Design and creative tools
  'figma', 'sketch', 'adobe', 'photoshop', 'illustrator', 'indesign',
  'premiere', 'after effects', 'blender',
  // Dev tools
  'postman', 'insomnia', 'docker', 'pgadmin', 'dbeaver',
  'sourcetree', 'gitkraken', 'fork',
  // Communication (work)
  'slack', 'zoom', 'microsoft teams',
  // Productivity
  'notion', 'obsidian', 'trello', 'jira', 'asana', 'linear',
  'confluence', 'clickup',
  // File management
  'explorer', 'finder',
];

const DEFAULT_DISTRACTING_PATTERNS: string[] = [
  // Gaming
  'steam', 'epic games', 'origin', 'battle.net', 'riot client',
  'xbox', 'gog galaxy',
  // Social media (standalone apps)
  'discord', 'telegram', 'whatsapp', 'facebook', 'instagram',
  'tiktok', 'twitter', 'reddit',
  // Entertainment
  'spotify', 'netflix', 'vlc', 'itunes', 'amazon music',
  'youtube music', 'plex', 'twitch',
];

export class MetricsComputer {
  private database: DatabaseManager;
  private categoryCache: Map<string, AppCategory> | null = null;
  private categoryCacheTs: number = 0;
  private static readonly CACHE_TTL_MS = 60000; // Refresh categories every 60s

  constructor(database: DatabaseManager) {
    this.database = database;
  }

  /**
   * Categorize an app as productive, distracting, or neutral.
   * First checks for admin-pushed categories (via effective_policy or settings),
   * then falls back to built-in default pattern matching.
   */
  private categorizeApp(appName: string): AppCategory {
    // Skip idle/system entries -- they are not categorized
    if (appName === 'System') {
      return 'neutral';
    }

    // Check admin-pushed categories first (cached)
    const overrides = this.getAdminCategories();
    if (overrides.has(appName)) {
      return overrides.get(appName)!;
    }

    // Fall back to default pattern matching
    const lowerName = appName.toLowerCase();

    for (const pattern of DEFAULT_PRODUCTIVE_PATTERNS) {
      if (lowerName.includes(pattern)) {
        return 'productive';
      }
    }

    for (const pattern of DEFAULT_DISTRACTING_PATTERNS) {
      if (lowerName.includes(pattern)) {
        return 'distracting';
      }
    }

    return 'neutral';
  }

  /**
   * Load admin-pushed app categories from the effective_policy or settings table.
   * Categories are stored as JSON under the key 'app_categories'.
   * Expected format: { "AppName": "productive"|"distracting"|"neutral", ... }
   * Results are cached for CACHE_TTL_MS to avoid repeated DB reads.
   */
  private getAdminCategories(): Map<string, AppCategory> {
    const now = Date.now();
    if (this.categoryCache && (now - this.categoryCacheTs) < MetricsComputer.CACHE_TTL_MS) {
      return this.categoryCache;
    }

    this.categoryCache = new Map();
    this.categoryCacheTs = now;

    try {
      // Check effective_policy table first (admin-pushed takes priority)
      const policyRow = this.database.get<{ value: string }>(
        'SELECT value FROM effective_policy WHERE key = ?',
        ['app_categories']
      );

      const raw = policyRow?.value || this.database.getSetting('app_categories');

      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null) {
          for (const [app, cat] of Object.entries(parsed)) {
            if (cat === 'productive' || cat === 'distracting' || cat === 'neutral') {
              this.categoryCache.set(app, cat as AppCategory);
            }
          }
        }
      }
    } catch (err) {
      console.error('[MetricsComputer] Error loading admin app categories:', err);
    }

    return this.categoryCache;
  }

  /**
   * Compute productive and unproductive seconds from a list of activity logs.
   * Logs are clipped to the given time range.
   */
  private computeCategorizedSeconds(
    logs: any[],
    rangeStart: number,
    rangeEnd: number
  ): { productiveSeconds: number; unproductiveSeconds: number } {
    let productiveSeconds = 0;
    let unproductiveSeconds = 0;

    for (const log of logs) {
      if (this.isIdleLog(log)) {
        continue;
      }

      const logTs = new Date(log.timestamp).getTime();
      const logEnd = logTs + (log.duration * 1000);

      // Clip to range
      const effectiveStart = Math.max(logTs, rangeStart);
      const effectiveEnd = Math.min(logEnd, rangeEnd);
      const effectiveDuration = Math.max(0, (effectiveEnd - effectiveStart) / 1000);

      const category = this.categorizeApp(log.app_name);
      if (category === 'productive') {
        productiveSeconds += effectiveDuration;
      } else if (category === 'distracting') {
        unproductiveSeconds += effectiveDuration;
      }
    }

    return {
      productiveSeconds: Math.round(productiveSeconds),
      unproductiveSeconds: Math.round(unproductiveSeconds),
    };
  }

  /**
   * Compute today's metrics summary
   */
  public computeTodayMetrics(): DailyMetricsSummary {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    
    // Get start of today in local time
    const startOfDay = new Date(today);
    startOfDay.setHours(0, 0, 0, 0);
    const startOfDayTs = startOfDay.getTime();
    
    return this.computeMetricsForRange(todayStr, todayStr, startOfDayTs);
  }

  /**
   * Compute last 15 minutes metrics
   */
  public computeLast15mMetrics(): PeriodMetricsSummary {
    const now = Date.now();
    const fifteenMinutesAgo = now - 15 * 60 * 1000;
    
    // Get activity logs for last 15 minutes
    const logs = this.getActivityLogsInRange(fifteenMinutesAgo, now);
    
    let activeSeconds = 0;
    let idleSeconds = 0;
    
    for (const log of logs) {
      const logTs = new Date(log.timestamp).getTime();
      const logEnd = logTs + (log.duration * 1000);
      
      // Clip to our range
      const effectiveStart = Math.max(logTs, fifteenMinutesAgo);
      const effectiveEnd = Math.min(logEnd, now);
      const effectiveDuration = Math.max(0, (effectiveEnd - effectiveStart) / 1000);
      
      if (this.isIdleLog(log)) {
        idleSeconds += effectiveDuration;
      } else {
        activeSeconds += effectiveDuration;
      }
    }
    
    // Compute untracked time (gaps in coverage)
    const untrackedSeconds = this.computeUntrackedTime(logs, fifteenMinutesAgo, now);

    // Compute productive/unproductive from app categorization
    const { productiveSeconds, unproductiveSeconds } =
      this.computeCategorizedSeconds(logs, fifteenMinutesAgo, now);

    return {
      productiveSeconds,
      unproductiveSeconds,
      idleSeconds: Math.round(idleSeconds),
      untrackedSeconds: Math.round(untrackedSeconds),
      activeSeconds: Math.round(activeSeconds),
    };
  }

  /**
   * Compute top apps for today (limit 10)
   */
  public computeTopAppsToday(): TopAppEntry[] {
    const today = new Date().toISOString().split('T')[0];

    try {
      const aggregated = this.database.getActivityLogsByDateRangeAggregated(today, today);

      // Sum by app name (aggregated for top apps)
      const appTotals = new Map<string, number>();
      for (const entry of aggregated) {
        // Skip idle entries
        if (entry.app_name === 'System' &&
            (entry.window_title_sample === 'Idle' || entry.window_title_sample === 'Paused')) {
          continue;
        }

        const current = appTotals.get(entry.app_name) || 0;
        appTotals.set(entry.app_name, current + entry.total_duration);
      }

      // Sort and take top 10, including category
      return Array.from(appTotals.entries())
        .map(([app, seconds]) => {
          const cat = this.categorizeApp(app);
          const category: 'productive' | 'unproductive' | 'neutral' =
            cat === 'distracting' ? 'unproductive' : cat;
          return { app, seconds, category };
        })
        .sort((a, b) => b.seconds - a.seconds)
        .slice(0, 10);
    } catch (err) {
      console.error('[MetricsComputer] Error computing top apps:', err);
      return [];
    }
  }

  // Browser app names for site extraction
  private static readonly BROWSER_APPS = ['chrome', 'firefox', 'edge', 'opera', 'brave', 'vivaldi', 'arc', 'safari'];

  // Known site name to domain mappings
  private static readonly SITE_DOMAINS: Record<string, string> = {
    'facebook': 'facebook.com', 'instagram': 'instagram.com',
    'twitter': 'twitter.com', 'x': 'x.com',
    'youtube': 'youtube.com', 'reddit': 'reddit.com',
    'linkedin': 'linkedin.com', 'whatsapp': 'web.whatsapp.com',
    'telegram': 'web.telegram.org', 'slack': 'slack.com',
    'gmail': 'gmail.com', 'google mail': 'gmail.com',
    'google docs': 'docs.google.com', 'google sheets': 'sheets.google.com',
    'google drive': 'drive.google.com', 'google calendar': 'calendar.google.com',
    'google meet': 'meet.google.com', 'google maps': 'maps.google.com',
    'outlook': 'outlook.com', 'github': 'github.com',
    'stack overflow': 'stackoverflow.com', 'stackoverflow': 'stackoverflow.com',
    'notion': 'notion.so', 'figma': 'figma.com',
    'trello': 'trello.com', 'jira': 'jira.atlassian.com',
    'amazon': 'amazon.com', 'netflix': 'netflix.com', 'spotify': 'spotify.com',
    'twitch': 'twitch.tv', 'tiktok': 'tiktok.com', 'discord': 'discord.com',
    'chatgpt': 'chatgpt.com', 'claude': 'claude.ai',
    'pinterest': 'pinterest.com', 'messenger': 'messenger.com',
  };

  /**
   * Normalize a window_title to a site name for browsers.
   * If already a domain (contains dot, no spaces), keep it.
   * If a known site name, map to domain.
   * Otherwise return null (skip — it's a page title we can't resolve).
   */
  private normalizeSiteName(windowTitle: string): string | null {
    if (!windowTitle) return null;
    const title = windowTitle.trim();

    // Already a domain (e.g., "facebook.com", "chatgpt.com")
    if (title.includes('.') && !title.includes(' ')) {
      return title.toLowerCase();
    }

    // Check known mappings (case-insensitive)
    const key = title.toLowerCase();
    if (MetricsComputer.SITE_DOMAINS[key]) {
      return MetricsComputer.SITE_DOMAINS[key];
    }

    // Unknown page title — can't resolve to a site
    return null;
  }

  /**
   * Compute detailed site/app breakdown for analytics.
   * For browsers, groups by site domain. For other apps, aggregates by app name.
   * Entries that can't be resolved to a site name are grouped under the browser name.
   */
  public computeDetailedAppsToday(): TopAppEntry[] {
    const today = new Date().toISOString().split('T')[0];

    try {
      const aggregated = this.database.getActivityLogsByDateRangeAggregated(today, today);
      const isBrowser = (appName: string) =>
        MetricsComputer.BROWSER_APPS.some(b => appName.toLowerCase().includes(b));

      const detailTotals = new Map<string, number>();
      for (const entry of aggregated) {
        if (entry.app_name === 'System' &&
            (entry.window_title_sample === 'Idle' || entry.window_title_sample === 'Paused')) {
          continue;
        }

        let key = entry.app_name;

        if (isBrowser(entry.app_name) &&
            entry.window_title_sample &&
            entry.window_title_sample !== entry.app_name) {
          // Try to normalize to a site domain
          const site = this.normalizeSiteName(entry.window_title_sample);
          if (site) {
            key = `${entry.app_name} · ${site}`;
          } else {
            // Can't resolve — group under "Other Sites"
            key = `${entry.app_name} · Other Sites`;
          }
        } else if (!isBrowser(entry.app_name) &&
                   entry.window_title_sample &&
                   entry.window_title_sample !== entry.app_name) {
          // Non-browser apps: just use app name (no detail)
          key = entry.app_name;
        }

        const current = detailTotals.get(key) || 0;
        detailTotals.set(key, current + entry.total_duration);
      }

      return Array.from(detailTotals.entries())
        .map(([app, seconds]) => {
          const baseApp = app.split(' · ')[0];
          const cat = this.categorizeApp(baseApp);
          const category: 'productive' | 'unproductive' | 'neutral' =
            cat === 'distracting' ? 'unproductive' : cat;
          return { app, seconds, category };
        })
        .sort((a, b) => b.seconds - a.seconds)
        .slice(0, 20);
    } catch (err) {
      console.error('[MetricsComputer] Error computing detailed apps:', err);
      return [];
    }
  }

  /**
   * Compute metrics for a date range
   */
  private computeMetricsForRange(
    startDate: string,
    endDate: string,
    rangeStartTs: number
  ): DailyMetricsSummary {
    try {
      const summary = this.database.getActivitySummaryByDateRange(startDate, endDate);
      
      // Get first and last activity timestamps
      const logs = this.database.getActivityLogsByDateRange(startDate, endDate, 1000);
      
      let firstActivityTs: number | null = null;
      let lastActivityTs: number | null = null;
      
      if (logs.length > 0) {
        // Logs are ordered DESC, so last in array is first activity
        const firstLog = logs[logs.length - 1];
        const lastLog = logs[0];
        
        firstActivityTs = new Date(firstLog.timestamp).getTime();
        lastActivityTs = new Date(lastLog.timestamp).getTime() + (lastLog.duration * 1000);
      }
      
      // Compute untracked time
      const now = Date.now();
      const rangeEnd = Math.min(now, new Date(endDate + 'T23:59:59').getTime());
      const untrackedSeconds = this.computeUntrackedTimeFromSummary(
        summary.total_active_seconds + summary.total_idle_seconds,
        rangeStartTs,
        rangeEnd,
        firstActivityTs
      );

      // Compute productive/unproductive from app categorization
      // Use the full logs we already fetched for timestamp computation
      const { productiveSeconds, unproductiveSeconds } =
        this.computeCategorizedSeconds(logs, rangeStartTs, rangeEnd);

      return {
        productiveSeconds,
        unproductiveSeconds,
        idleSeconds: summary.total_idle_seconds || 0,
        untrackedSeconds,
        activeSeconds: summary.total_active_seconds || 0,
        firstActivityTs,
        lastActivityTs,
      };
    } catch (err) {
      console.error('[MetricsComputer] Error computing metrics:', err);
      return {
        productiveSeconds: 0,
        unproductiveSeconds: 0,
        idleSeconds: 0,
        untrackedSeconds: 0,
        activeSeconds: 0,
        firstActivityTs: null,
        lastActivityTs: null,
      };
    }
  }

  /**
   * Get activity logs in a timestamp range
   */
  private getActivityLogsInRange(startTs: number, endTs: number): any[] {
    const startDate = new Date(startTs).toISOString().split('T')[0];
    const endDate = new Date(endTs).toISOString().split('T')[0];
    
    const logs = this.database.getActivityLogsByDateRange(startDate, endDate, 1000);
    
    // Filter to exact timestamp range
    return logs.filter(log => {
      const logTs = new Date(log.timestamp).getTime();
      const logEnd = logTs + (log.duration * 1000);
      return logEnd >= startTs && logTs <= endTs;
    });
  }

  /**
   * Check if a log entry represents idle time
   */
  private isIdleLog(log: any): boolean {
    return log.app_name === 'System' && 
           (log.window_title === 'Idle' || log.window_title === 'Paused');
  }

  /**
   * Compute untracked time from gaps in activity logs
   * Uses coverage timeline approach: any gap > 60s counts as untracked
   */
  private computeUntrackedTime(logs: any[], rangeStart: number, rangeEnd: number): number {
    if (logs.length === 0) {
      // If no logs, all time since range start is untracked
      return Math.max(0, (rangeEnd - rangeStart) / 1000);
    }
    
    // Build coverage intervals
    const intervals: Array<{ start: number; end: number }> = [];
    
    for (const log of logs) {
      const logTs = new Date(log.timestamp).getTime();
      const logEnd = logTs + (log.duration * 1000);
      intervals.push({ start: logTs, end: logEnd });
    }
    
    // Sort by start time
    intervals.sort((a, b) => a.start - b.start);
    
    // Merge overlapping intervals
    const merged: Array<{ start: number; end: number }> = [];
    for (const interval of intervals) {
      if (merged.length === 0) {
        merged.push(interval);
      } else {
        const last = merged[merged.length - 1];
        if (interval.start <= last.end + UNTRACKED_GAP_THRESHOLD_MS) {
          // Merge (allow small gaps)
          last.end = Math.max(last.end, interval.end);
        } else {
          merged.push(interval);
        }
      }
    }
    
    // Calculate gaps
    let untrackedMs = 0;
    
    // Gap before first interval
    if (merged.length > 0 && merged[0].start > rangeStart + UNTRACKED_GAP_THRESHOLD_MS) {
      untrackedMs += merged[0].start - rangeStart;
    }
    
    // Gaps between intervals
    for (let i = 1; i < merged.length; i++) {
      const gap = merged[i].start - merged[i - 1].end;
      if (gap > UNTRACKED_GAP_THRESHOLD_MS) {
        untrackedMs += gap;
      }
    }
    
    // Gap after last interval (only if significant)
    if (merged.length > 0) {
      const lastEnd = merged[merged.length - 1].end;
      const gapAfter = rangeEnd - lastEnd;
      if (gapAfter > UNTRACKED_GAP_THRESHOLD_MS) {
        untrackedMs += gapAfter;
      }
    }
    
    return Math.round(untrackedMs / 1000);
  }

  /**
   * Compute untracked time from summary data
   * Simpler approach when we don't have individual logs
   */
  private computeUntrackedTimeFromSummary(
    totalTrackedSeconds: number,
    rangeStartTs: number,
    rangeEndTs: number,
    firstActivityTs: number | null
  ): number {
    // If no activity yet, compute from range start
    const effectiveStart = firstActivityTs || rangeStartTs;
    const now = Date.now();
    const effectiveEnd = Math.min(rangeEndTs, now);
    
    // Total time since first activity (or range start)
    const totalElapsedSeconds = Math.max(0, (effectiveEnd - effectiveStart) / 1000);
    
    // Untracked = elapsed - tracked
    const untrackedSeconds = Math.max(0, totalElapsedSeconds - totalTrackedSeconds);
    
    return Math.round(untrackedSeconds);
  }
}
