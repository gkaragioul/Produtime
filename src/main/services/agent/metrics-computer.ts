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

export class MetricsComputer {
  private database: DatabaseManager;

  constructor(database: DatabaseManager) {
    this.database = database;
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
    
    return {
      productiveSeconds: 0,      // TODO: App categorization
      unproductiveSeconds: 0,    // TODO: App categorization
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
      
      // Sum by app name
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
      
      // Sort and take top 10
      return Array.from(appTotals.entries())
        .map(([app, seconds]) => ({ app, seconds }))
        .sort((a, b) => b.seconds - a.seconds)
        .slice(0, 10);
    } catch (err) {
      console.error('[MetricsComputer] Error computing top apps:', err);
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
      
      return {
        productiveSeconds: 0,      // TODO: App categorization
        unproductiveSeconds: 0,    // TODO: App categorization
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
