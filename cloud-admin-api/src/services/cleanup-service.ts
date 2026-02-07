/**
 * Cleanup Service
 * Handles automatic cleanup of old data to maintain database performance and compliance.
 * 
 * Requirements:
 * - 8.1: Run cleanup jobs at startup and daily at 03:00 local time
 * - 8.2: Delete records older than 30 days (sessions, pair codes, failed logins)
 * - 8.3: Archive daily metrics while keeping only latest device status
 * - 8.5: Log cleanup counts without logging sensitive details
 * - 8.6: Cleanup job shall be idempotent and safe to run multiple times
 */

// ============================================================================
// Types
// ============================================================================

export interface CleanupResult {
  deletedSessions: number;
  deletedPairCodes: number;
  deletedFailedLogins: number;
  archivedMetrics: number;
  timestamp: Date;
}

export interface CleanupConfig {
  /** Number of days after which records are considered old (default: 30) */
  retentionDays: number;
  /** Hour of day to run scheduled cleanup (0-23, default: 3 for 03:00) */
  scheduledHour: number;
  /** Whether to run cleanup on startup (default: true) */
  runOnStartup: boolean;
}

// ============================================================================
// Database Interface (to be injected)
// ============================================================================

export interface CleanupDatabase {
  /**
   * Delete sessions older than the specified date
   * Returns the count of deleted records
   */
  deleteOldSessions(olderThan: Date): Promise<number>;
  
  /**
   * Delete pair codes older than the specified date
   * Returns the count of deleted records
   */
  deleteOldPairCodes(olderThan: Date): Promise<number>;
  
  /**
   * Delete failed login records older than the specified date
   * Returns the count of deleted records
   */
  deleteOldFailedLogins(olderThan: Date): Promise<number>;
  
  /**
   * Archive old daily metrics while preserving the latest status for each device
   * Returns the count of archived/deleted records
   */
  archiveOldDailyMetrics(olderThan: Date): Promise<number>;
  
  /**
   * Get count of sessions older than the specified date
   */
  countOldSessions(olderThan: Date): Promise<number>;
  
  /**
   * Get count of pair codes older than the specified date
   */
  countOldPairCodes(olderThan: Date): Promise<number>;
  
  /**
   * Get count of failed logins older than the specified date
   */
  countOldFailedLogins(olderThan: Date): Promise<number>;
}

// ============================================================================
// Logger Interface
// ============================================================================

export interface CleanupLogger {
  info(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: CleanupConfig = {
  retentionDays: 30,
  scheduledHour: 3, // 03:00
  runOnStartup: true,
};

// ============================================================================
// Cleanup Service Class
// ============================================================================

export class CleanupService {
  private config: CleanupConfig;
  private scheduledTimer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  constructor(
    private db: CleanupDatabase,
    private logger: CleanupLogger,
    config?: Partial<CleanupConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Calculate the cutoff date for old records
   * Records older than this date should be deleted
   */
  getCutoffDate(retentionDays: number = this.config.retentionDays): Date {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    cutoff.setHours(0, 0, 0, 0); // Start of day
    return cutoff;
  }

  /**
   * Run the cleanup job
   * Requirements: 8.2, 8.3, 8.5, 8.6
   * 
   * This method is idempotent - running it multiple times produces the same result.
   */
  async runCleanup(): Promise<CleanupResult> {
    // Prevent concurrent cleanup runs
    if (this.isRunning) {
      this.logger.warn('Cleanup already in progress, skipping');
      return {
        deletedSessions: 0,
        deletedPairCodes: 0,
        deletedFailedLogins: 0,
        archivedMetrics: 0,
        timestamp: new Date(),
      };
    }

    this.isRunning = true;
    const startTime = Date.now();
    const cutoffDate = this.getCutoffDate();

    this.logger.info('Starting cleanup job', {
      cutoffDate: cutoffDate.toISOString(),
      retentionDays: this.config.retentionDays,
    });

    try {
      // Requirement 8.2: Delete sessions older than 30 days
      const deletedSessions = await this.db.deleteOldSessions(cutoffDate);

      // Requirement 8.2: Delete pair codes older than 30 days
      const deletedPairCodes = await this.db.deleteOldPairCodes(cutoffDate);

      // Requirement 8.2: Delete failed logins older than 30 days
      const deletedFailedLogins = await this.db.deleteOldFailedLogins(cutoffDate);

      // Requirement 8.3: Archive old daily metrics
      const archivedMetrics = await this.db.archiveOldDailyMetrics(cutoffDate);

      const result: CleanupResult = {
        deletedSessions,
        deletedPairCodes,
        deletedFailedLogins,
        archivedMetrics,
        timestamp: new Date(),
      };

      const duration = Date.now() - startTime;

      // Requirement 8.5: Log cleanup counts without logging sensitive details
      this.logger.info('Cleanup job completed', {
        deletedSessions,
        deletedPairCodes,
        deletedFailedLogins,
        archivedMetrics,
        durationMs: duration,
      });

      return result;
    } catch (error) {
      this.logger.error('Cleanup job failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Start the cleanup service
   * Requirements: 8.1
   * 
   * - Runs cleanup on startup if configured
   * - Schedules daily cleanup at the configured hour
   */
  async start(): Promise<void> {
    // Requirement 8.1: Run at startup
    if (this.config.runOnStartup) {
      this.logger.info('Running cleanup on startup');
      try {
        await this.runCleanup();
      } catch (error) {
        // Log but don't fail startup
        this.logger.error('Startup cleanup failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Requirement 8.1: Schedule daily cleanup at 03:00
    this.scheduleDaily();
  }

  /**
   * Stop the cleanup service
   * Cancels any scheduled cleanup jobs
   */
  stop(): void {
    if (this.scheduledTimer) {
      clearTimeout(this.scheduledTimer);
      this.scheduledTimer = null;
      this.logger.info('Cleanup service stopped');
    }
  }

  /**
   * Schedule the next daily cleanup
   * Requirement 8.1: Run daily at 03:00 local time
   */
  private scheduleDaily(): void {
    const now = new Date();
    const nextRun = new Date();
    
    // Set to the scheduled hour today
    nextRun.setHours(this.config.scheduledHour, 0, 0, 0);
    
    // If we've already passed the scheduled time today, schedule for tomorrow
    if (nextRun <= now) {
      nextRun.setDate(nextRun.getDate() + 1);
    }

    const msUntilNextRun = nextRun.getTime() - now.getTime();

    this.logger.info('Scheduling next cleanup', {
      nextRun: nextRun.toISOString(),
      msUntilNextRun,
    });

    this.scheduledTimer = setTimeout(async () => {
      try {
        await this.runCleanup();
      } catch (error) {
        this.logger.error('Scheduled cleanup failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
      // Schedule the next run
      this.scheduleDaily();
    }, msUntilNextRun);
  }

  /**
   * Get the current configuration
   */
  getConfig(): CleanupConfig {
    return { ...this.config };
  }

  /**
   * Check if cleanup is currently running
   */
  isCleanupRunning(): boolean {
    return this.isRunning;
  }
}

// ============================================================================
// Cleanup Error Class
// ============================================================================

export type CleanupErrorCode =
  | 'CLEANUP_IN_PROGRESS'
  | 'DATABASE_ERROR'
  | 'INVALID_CONFIG';

export class CleanupError extends Error {
  constructor(
    public code: CleanupErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'CleanupError';
  }
}

// ============================================================================
// Exports for testing
// ============================================================================

export const CLEANUP_CONSTANTS = {
  DEFAULT_RETENTION_DAYS: 30,
  DEFAULT_SCHEDULED_HOUR: 3,
};
