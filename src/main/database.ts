import Database from 'better-sqlite3';
import * as path from 'path';
import { app } from 'electron';
import * as fs from 'fs';
import {
  ActivityLog,
  Setting,
  Analytics,
  Migration,
  AdminLockoutState,
} from '../shared/types';
import { EncryptionKeyService } from './services/encryption-key-service';
import { DEFAULT_PRIVACY_APPS } from './services/privacy-constants';

export class DatabaseManager {
  private db: Database.Database;
  private dbPath: string;
  private effectiveDbPath: string;

  /**
   * Get encrypted database path based on hardware fingerprint
   * This makes the database file hardware-specific
   */
  private getEncryptedDatabasePath(): string {
    const encryptionKey = EncryptionKeyService.getInstance().getEncryptionKey();
    const crypto = require('crypto');

    // Create a hash of the original path + encryption key
    // This creates a unique database file per machine
    const hash = crypto
      .createHash('sha256')
      .update(this.dbPath + encryptionKey)
      .digest('hex')
      .substring(0, 16);

    const dir = path.dirname(this.dbPath);
    const ext = path.extname(this.dbPath);
    const base = path.basename(this.dbPath, ext);

    // Create encrypted database path: produtime_a1b2c3d4.db
    return path.join(dir, `${base}_${hash}${ext}`);
  }

  constructor() {
    const appDataRoot = app.getPath('appData');

    // In test environment, use a flat test DB path (no encryption) that matches tests
    if ((process.env.NODE_ENV || '').toLowerCase() === 'test') {
      try {
        if (!fs.existsSync(appDataRoot))
          fs.mkdirSync(appDataRoot, { recursive: true });
      } catch (err) {
        // BUG FIX #12: Log errors instead of silently swallowing them
        console.warn('Failed to create test app data directory:', err);
      }
      this.dbPath = path.join(appDataRoot, 'timeport.db');
    } else {
      // Store database in app data directory with backward compatibility
      // Prefer legacy %APPDATA%/atlianflow/timeport.db if it exists; otherwise use %APPDATA%/produtime/produtime.db
      const legacyDir = path.join(appDataRoot, 'atlianflow');
      const legacyDb = path.join(legacyDir, 'timeport.db');
      const newDir = path.join(appDataRoot, 'produtime');
      const newDb = path.join(newDir, 'produtime.db');
      if (fs.existsSync(legacyDb)) {
        this.dbPath = legacyDb; // Backward-compat: continue using existing legacy database
      } else {
        try {
          if (!fs.existsSync(newDir)) fs.mkdirSync(newDir, { recursive: true });
        } catch (err) {
          // BUG FIX #12: Log errors instead of silently swallowing them
          console.warn('Failed to create produtime data directory:', err);
        }
        this.dbPath = newDb;
      }
    }

    try {
      // Use encrypted database path in production; plain path in tests
      const finalDbPath =
        (process.env.NODE_ENV || '').toLowerCase() === 'test'
          ? this.dbPath
          : this.getEncryptedDatabasePath();
      this.effectiveDbPath = finalDbPath;
      this.db = new Database(finalDbPath);

      this.db.pragma('journal_mode = WAL'); // Enable WAL mode for better concurrency
      this.initializeDatabase();
    } catch (error) {
      throw new Error(`Failed to initialize database: ${error}`);
    }
  }

  private initializeDatabase(): void {
    try {
      // Run migrations
      this.runMigrations();
      console.log('Database initialized successfully');
    } catch (error) {
      throw new Error(`Database initialization failed: ${error}`);
    }
  }

  private runMigrations(): void {
    // Create migrations table if it doesn't exist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        version INTEGER PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const migrations: Migration[] = [
      {
        version: 1,
        description: 'Create initial tables',
        up: `
          CREATE TABLE IF NOT EXISTS activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME NOT NULL,
            app_name TEXT NOT NULL,
            window_title TEXT NOT NULL,
            duration INTEGER NOT NULL DEFAULT 0
          );

          CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS analytics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            metric_name TEXT NOT NULL,
            metric_value INTEGER NOT NULL,
            recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );

          CREATE INDEX IF NOT EXISTS idx_activity_logs_timestamp ON activity_logs(timestamp);
          CREATE INDEX IF NOT EXISTS idx_analytics_metric_name ON analytics(metric_name);
        `,
      },
      {
        version: 2,
        description: 'Insert default settings',
        up: `
          INSERT OR IGNORE INTO settings (key, value) VALUES
            ('work_schedule_start', '09:00'),
            ('work_schedule_end', '17:00'),
            ('export_folder', ''),
            ('idle_threshold', '300'),
            ('employee_name', '');
        `,
      },
      {
        version: 3,
        description: 'Add admin authentication tables',
        up: `
          CREATE TABLE IF NOT EXISTS admin_login_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ip_address TEXT,
            attempted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            success BOOLEAN NOT NULL DEFAULT 0
          );

          CREATE TABLE IF NOT EXISTS admin_lockout_state (
            id INTEGER PRIMARY KEY,
            is_locked BOOLEAN NOT NULL DEFAULT 0,
            locked_until DATETIME,
            failed_attempts_count INTEGER NOT NULL DEFAULT 0,
            last_attempt_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );

          CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_attempted_at ON admin_login_attempts(attempted_at);
          CREATE INDEX IF NOT EXISTS idx_admin_lockout_state_locked_until ON admin_lockout_state(locked_until);

          INSERT OR IGNORE INTO settings (key, value) VALUES
            ('admin_alert_email', '');

          INSERT OR IGNORE INTO admin_lockout_state (id, is_locked, failed_attempts_count) VALUES (1, 0, 0);
        `,
      },
      {
        version: 4,
        description: 'Add timestamps to settings table',
        up: `
          -- Add created_at and updated_at columns to settings if they don't exist
          PRAGMA foreign_keys=off;
          CREATE TABLE IF NOT EXISTS settings_new (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
          INSERT INTO settings_new (key, value)
            SELECT key, value FROM settings;
          DROP TABLE settings;
          ALTER TABLE settings_new RENAME TO settings;
          PRAGMA foreign_keys=on;
        `,
      },
      {
        version: 5,
        description: 'Add license activation table',
        up: `
          CREATE TABLE IF NOT EXISTS license_activations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            license_key TEXT NOT NULL,
            device_id TEXT NOT NULL,
            activation_code TEXT,
            plan TEXT NOT NULL,
            expiry_date TEXT,
            activated_at TEXT NOT NULL,
            last_validated_at TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );

          CREATE INDEX IF NOT EXISTS idx_license_activations_device_id ON license_activations(device_id);
          CREATE INDEX IF NOT EXISTS idx_license_activations_license_key ON license_activations(license_key);
        `,
      },
      {
        version: 6,
        description: 'Add license_state table for v1.8 licensing',
        up: `
          CREATE TABLE IF NOT EXISTS license_state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            mode TEXT NOT NULL CHECK (mode IN ('trial', 'activated', 'locked')),
            trialStart TEXT NULL,
            lastSeen TEXT NULL,
            lastServerTime TEXT NULL,
            nextCheckAt TEXT NULL,
            activationCertEncrypted BLOB NULL,
            tamperFlags TEXT NULL,
            createdAt TEXT NOT NULL DEFAULT (datetime('now')),
            updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
          );

          -- Trigger to update updatedAt
          CREATE TRIGGER IF NOT EXISTS license_state_updated_at
          AFTER UPDATE ON license_state
          BEGIN
            UPDATE license_state SET updatedAt = datetime('now') WHERE id = NEW.id;
          END;
        `,
      },
      {
        version: 7,
        description: 'Add default privacy settings',
        up: `
          INSERT OR IGNORE INTO settings (key, value) VALUES
            ('privacy_mode_enabled', 'true'),
            ('privacy_apps', '${JSON.stringify(DEFAULT_PRIVACY_APPS).replace(/'/g, "''")}');
        `,
      },
      {
        version: 8,
        description: 'Add Admin Console agent tables',
        up: `
          -- Agent pairing state (single row, id=1)
          CREATE TABLE IF NOT EXISTS agent_pairing (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            paired INTEGER NOT NULL DEFAULT 0,
            admin_host TEXT,
            admin_name TEXT,
            admin_pubkey TEXT,
            device_pubkey TEXT,
            device_privkey_encrypted TEXT,
            paired_at INTEGER,
            last_connected_at INTEGER,
            session_token TEXT
          );

          -- Effective policy from admin (overrides local settings)
          CREATE TABLE IF NOT EXISTS effective_policy (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            source TEXT NOT NULL DEFAULT 'admin'
          );

          CREATE INDEX IF NOT EXISTS idx_effective_policy_source ON effective_policy(source);

          -- Initialize empty pairing state
          INSERT OR IGNORE INTO agent_pairing (id, paired) VALUES (1, 0);

          -- Add title sharing setting (default off for privacy)
          INSERT OR IGNORE INTO settings (key, value) VALUES
            ('title_sharing_enabled', 'false');
        `,
      },
      {
        version: 9,
        description: 'Add cloud WebSocket endpoint to agent_pairing',
        up: `
          -- Add cloud_ws_endpoint column for cloud-based admin console connection
          -- This stores the WSS endpoint URL received after cloud pairing approval
          ALTER TABLE agent_pairing ADD COLUMN cloud_ws_endpoint TEXT;

          -- Add tenant_id column for multi-tenant cloud support
          ALTER TABLE agent_pairing ADD COLUMN tenant_id TEXT;

          -- Add tenant_name column for display purposes (company name)
          ALTER TABLE agent_pairing ADD COLUMN tenant_name TEXT;
        `,
      },
      {
        version: 10,
        description: 'Add missing performance indexes',
        up: `
          -- Index on settings(key) for common setting lookups
          -- This significantly speeds up getSetting() calls which are frequent
          CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(key);

          -- Index on analytics(recorded_at) for date range queries
          -- This improves performance of analytics queries filtered by date
          CREATE INDEX IF NOT EXISTS idx_analytics_recorded_at ON analytics(recorded_at);

          -- Composite index for admin login attempts by date and success status
          -- Helps with queries counting failed attempts in time windows
          CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_date_success ON admin_login_attempts(attempted_at, success);
        `,
      },
    ];

    // Get current migration version
    const currentVersion = this.getCurrentMigrationVersion();

    // Apply pending migrations, each in its own transaction for atomicity
    for (const migration of migrations) {
      if (migration.version > currentVersion) {
        const runMigration = this.db.transaction(() => {
          this.db.exec(migration.up);
          this.db
            .prepare(
              'INSERT INTO migrations (version, description) VALUES (?, ?)'
            )
            .run(migration.version, migration.description);
        });
        try {
          runMigration();
          console.log(
            `Applied migration ${migration.version}: ${migration.description}`
          );
        } catch (error) {
          throw new Error(`Migration ${migration.version} failed: ${error}`);
        }
      }
    }
  }

  private getCurrentMigrationVersion(): number {
    try {
      const result = this.db
        .prepare('SELECT MAX(version) as version FROM migrations')
        .get() as { version: number | null };
      return result.version || 0;
    } catch (err) {
      // BUG FIX #12: Log migration version check errors
      console.warn('Failed to get current migration version:', err);
      return 0;
    }
  }

  // Activity Logs CRUD operations
  public insertActivityLog(log: Omit<ActivityLog, 'id'>): number {
    const stmt = this.db.prepare(`
      INSERT INTO activity_logs (timestamp, app_name, window_title, duration)
      VALUES (?, ?, ?, ?)
    `);
    const result = stmt.run(
      log.timestamp,
      log.app_name,
      log.window_title,
      log.duration
    );
    return result.lastInsertRowid as number;
  }

  public getActivityLogs(limit?: number, offset?: number): ActivityLog[] {
    // Order by timestamp (descending) then by ID to handle clock changes gracefully
    // This ensures deterministic ordering even if system time is adjusted
    let query = 'SELECT * FROM activity_logs ORDER BY timestamp DESC, id DESC';
    const params: any[] = [];

    if (limit) {
      query += ' LIMIT ?';
      params.push(limit);

      if (offset) {
        query += ' OFFSET ?';
        params.push(offset);
      }
    }

    return this.db.prepare(query).all(...params) as ActivityLog[];
  }

  public getActivityLogsByDateRange(
    startDate: string,
    endDate: string,
    limit?: number
  ): ActivityLog[] {
    // Use SQLite date() with 'localtime' to correctly compare ISO timestamps stored in UTC
    // WARNING: For large date ranges (e.g., monthly reports), this can return tens of thousands of rows
    // Consider using getActivityLogsByDateRangeAggregated() for reports to avoid memory issues
    let query = "SELECT * FROM activity_logs WHERE date(timestamp, 'localtime') BETWEEN date(?, 'localtime') AND date(?, 'localtime') ORDER BY timestamp DESC";
    const params: any[] = [startDate, endDate];

    if (limit) {
      query += ' LIMIT ?';
      params.push(limit);
    }

    return this.db.prepare(query).all(...params) as ActivityLog[];
  }

  /**
   * Get aggregated activity data by date range for efficient report generation
   * Returns pre-aggregated data grouped by app and date to avoid memory issues
   */
  public getActivityLogsByDateRangeAggregated(
    startDate: string,
    endDate: string
  ): Array<{
    date: string;
    app_name: string;
    window_title_sample: string;
    total_duration: number;
    entry_count: number;
  }> {
    return this.db
      .prepare(
        `SELECT
          date(timestamp, 'localtime') as date,
          app_name,
          window_title as window_title_sample,
          SUM(duration) as total_duration,
          COUNT(*) as entry_count
        FROM activity_logs
        WHERE date(timestamp, 'localtime') BETWEEN date(?, 'localtime') AND date(?, 'localtime')
        GROUP BY date(timestamp, 'localtime'), app_name, window_title
        ORDER BY date DESC, total_duration DESC`
      )
      .all(startDate, endDate) as Array<{
        date: string;
        app_name: string;
        window_title_sample: string;
        total_duration: number;
        entry_count: number;
      }>;
  }

  /**
   * Get summary statistics for a date range without loading all individual logs
   * Much more memory-efficient for monthly reports
   */
  public getActivitySummaryByDateRange(
    startDate: string,
    endDate: string
  ): {
    total_active_seconds: number;
    total_idle_seconds: number;
    total_entries: number;
    date_range_days: number;
  } {
    const result = this.db
      .prepare(
        `SELECT
          SUM(CASE WHEN app_name = 'System' AND (window_title = 'Idle' OR window_title = 'Paused')
              THEN duration ELSE 0 END) as total_idle_seconds,
          SUM(CASE WHEN NOT (app_name = 'System' AND (window_title = 'Idle' OR window_title = 'Paused'))
              THEN duration ELSE 0 END) as total_active_seconds,
          COUNT(*) as total_entries
        FROM activity_logs
        WHERE date(timestamp, 'localtime') BETWEEN date(?, 'localtime') AND date(?, 'localtime')`
      )
      .get(startDate, endDate) as {
        total_active_seconds: number;
        total_idle_seconds: number;
        total_entries: number;
      };

    // Calculate date range in days
    const start = new Date(startDate);
    const end = new Date(endDate);
    const date_range_days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    return {
      ...result,
      date_range_days,
    };
  }

  public getAnalyticsByDateRange(
    startDate: string,
    endDate: string
  ): Analytics[] {
    // Same local-date comparison for analytics timeline entries
    return this.db
      .prepare(
        "SELECT * FROM analytics WHERE date(recorded_at, 'localtime') BETWEEN date(?, 'localtime') AND date(?, 'localtime') ORDER BY recorded_at DESC"
      )
      .all(startDate, endDate) as Analytics[];
  }

  // Settings CRUD operations
  public getSetting(key: string): string | null {
    const result = this.db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return result?.value || null;
  }

  public setSetting(key: string, value: string): void {
    this.db
      .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run(key, value);
  }

  public getAllSettings(): Setting[] {
    return this.db.prepare('SELECT * FROM settings').all() as Setting[];
  }

  // Analytics CRUD operations
  public insertAnalytics(
    metric: Omit<Analytics, 'id' | 'recorded_at'>
  ): number {
    // Ensure locally consistent timestamp with millisecond precision for deterministic ordering in tests
    const now = new Date();
    const pad2 = (n: number) => String(n).padStart(2, '0');
    const y = now.getFullYear();
    const m = pad2(now.getMonth() + 1);
    const d = pad2(now.getDate());
    const hh = pad2(now.getHours());
    const mm = pad2(now.getMinutes());
    const ss = pad2(now.getSeconds());
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    const recordedAt = `${y}-${m}-${d} ${hh}:${mm}:${ss}.${ms}`;

    const stmt = this.db.prepare(`
      INSERT INTO analytics (metric_name, metric_value, recorded_at)
      VALUES (?, ?, ?)
    `);
    const result = stmt.run(
      metric.metric_name,
      metric.metric_value,
      recordedAt
    );
    return result.lastInsertRowid as number;
  }

  public getAnalytics(metricName?: string): Analytics[] {
    if (metricName) {
      return this.db
        .prepare(
          'SELECT * FROM analytics WHERE metric_name = ? ORDER BY recorded_at DESC'
        )
        .all(metricName) as Analytics[];
    }
    return this.db
      .prepare('SELECT * FROM analytics ORDER BY recorded_at DESC')
      .all() as Analytics[];
  }

  // Admin Authentication operations
  public recordLoginAttempt(
    ipAddress: string | null,
    success: boolean
  ): number {
    const stmt = this.db.prepare(`
      INSERT INTO admin_login_attempts (ip_address, success, attempted_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `);
    const result = stmt.run(ipAddress, success ? 1 : 0);
    return result.lastInsertRowid as number;
  }

  public getRecentFailedAttempts(minutesBack: number = 60): number {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM admin_login_attempts
      WHERE success = 0
      AND attempted_at > datetime('now', '-' || ? || ' minutes')
    `);
    const result = stmt.get(minutesBack) as { count: number };
    return result.count;
  }

  public getLockoutState(): AdminLockoutState {
    // Use INSERT OR IGNORE to atomically create the record if it doesn't exist
    // This prevents TOCTOU (Time-of-Check-Time-of-Use) race conditions
    const now = new Date().toISOString();
    const insertOrIgnore = this.db.prepare(`
      INSERT OR IGNORE INTO admin_lockout_state (id, is_locked, failed_attempts_count, created_at, updated_at)
      VALUES (1, 0, 0, ?, ?)
    `);
    insertOrIgnore.run(now, now);

    // Now retrieve the record (guaranteed to exist)
    const stmt = this.db.prepare(`
      SELECT * FROM admin_lockout_state WHERE id = 1
    `);
    const result = stmt.get() as AdminLockoutState | undefined;

    if (!result) {
      // This should never happen after INSERT OR IGNORE, but handle gracefully
      throw new Error('Failed to initialize admin lockout state');
    }

    return {
      ...result,
      is_locked: Boolean(result.is_locked),
    };
  }

  public updateLockoutState(state: Partial<AdminLockoutState>): void {
    const updates: string[] = [];
    const values: any[] = [];

    if (state.is_locked !== undefined) {
      updates.push('is_locked = ?');
      values.push(state.is_locked ? 1 : 0);
    }

    if (state.locked_until !== undefined) {
      updates.push('locked_until = ?');
      values.push(state.locked_until);
    }

    if (state.failed_attempts_count !== undefined) {
      updates.push('failed_attempts_count = ?');
      values.push(state.failed_attempts_count);
    }

    if (state.last_attempt_at !== undefined) {
      updates.push('last_attempt_at = ?');
      values.push(state.last_attempt_at);
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(1); // for WHERE clause

    const stmt = this.db.prepare(`
      UPDATE admin_lockout_state
      SET ${updates.join(', ')}
      WHERE id = ?
    `);
    stmt.run(...values);
  }

  public isAdminLockedOut(): boolean {
    const lockoutState = this.getLockoutState();

    if (!lockoutState.is_locked) {
      return false;
    }

    if (!lockoutState.locked_until) {
      return false;
    }

    const now = new Date();
    const lockedUntil = new Date(lockoutState.locked_until);

    if (now >= lockedUntil) {
      // Lockout period has expired, unlock
      this.updateLockoutState({
        is_locked: false,
        locked_until: null,
        failed_attempts_count: 0,
      });
      return false;
    }

    return true;
  }

  // Utility methods
  public clearAllData(): void {
    try {
      const transaction = this.db.transaction(() => {
        this.db.exec('DELETE FROM activity_logs');
        this.db.exec('DELETE FROM analytics');
        // Don't delete settings as they contain configuration
        // Don't delete admin_login_attempts and admin_lockout_state for security audit trail
      });
      transaction();
    } catch (error) {
      console.error('Error clearing all data:', error);
      throw new Error(`Failed to clear all data: ${error}`);
    }
  }

  // Enhanced settings management with better error handling
  public setSettingWithValidation(key: string, value: string): void {
    try {
      // Validate setting key and value before saving
      this.validateSettingValue(key, value);

      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO settings (key, value)
        VALUES (?, ?)
      `);
      stmt.run(key, value);
    } catch (error) {
      console.error(`Error setting ${key}:`, error);
      throw new Error(`Failed to save setting ${key}: ${error}`);
    }
  }

  public bulkUpdateSettings(settings: Record<string, string>): void {
    try {
      const transaction = this.db.transaction(() => {
        const stmt = this.db.prepare(`
          INSERT OR REPLACE INTO settings (key, value)
          VALUES (?, ?)
        `);

        for (const [key, value] of Object.entries(settings)) {
          this.validateSettingValue(key, value);
          stmt.run(key, value);
        }
      });
      transaction();
    } catch (error) {
      console.error('Error bulk updating settings:', error);
      throw new Error(`Failed to bulk update settings: ${error}`);
    }
  }

  private validateSettingValue(key: string, value: string): void {
    // Basic validation for critical settings
    switch (key) {
      case 'work_schedule_start':
      case 'work_schedule_end':
        if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(value)) {
          throw new Error(`Invalid time format for ${key}: ${value}`);
        }
        break;
      case 'idle_threshold':
        const idleTime = parseInt(value);
        if (isNaN(idleTime) || idleTime < 30 || idleTime > 3600) {
          throw new Error(
            `Invalid idle threshold: ${value}. Must be between 30 and 3600 seconds.`
          );
        }
        break;
      case 'admin_lockout_threshold':
        const threshold = parseInt(value);
        if (isNaN(threshold) || threshold < 3 || threshold > 20) {
          throw new Error(
            `Invalid lockout threshold: ${value}. Must be between 3 and 20 attempts.`
          );
        }
        break;
      case 'admin_lockout_duration_minutes':
        const duration = parseInt(value);
        if (isNaN(duration) || duration < 5 || duration > 1440) {
          throw new Error(
            `Invalid lockout duration: ${value}. Must be between 5 and 1440 minutes.`
          );
        }
        break;
      case 'admin_alert_email':
        if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          throw new Error(`Invalid email format: ${value}`);
        }
        break;

      case 'work_schedule_weekly':
        try {
          const obj = JSON.parse(value);
          if (typeof obj !== 'object' || obj === null) {
            throw new Error('Invalid weekly schedule');
          }
        } catch (e) {
          throw new Error(`Invalid JSON for work_schedule_weekly: ${e}`);
        }
        break;
      case 'employee_name':
        // BUG FIX #7: Allow empty employee names - this field is optional
        // Only validate length if a name is provided
        if (value && value.trim().length > 100) {
          throw new Error('Employee name too long (max 100 characters)');
        }
        break;
    }
  }

  // License Activation CRUD operations
  public saveLicenseActivation(
    activation: Omit<
      import('../shared/types').LicenseActivation,
      'id' | 'created_at' | 'updated_at'
    >
  ): number {
    const stmt = this.db.prepare(`
      INSERT INTO license_activations (
        license_key, device_id, activation_code, plan, expiry_date,
        activated_at, last_validated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      activation.license_key,
      activation.device_id,
      activation.activation_code,
      activation.plan,
      activation.expiry_date,
      activation.activated_at,
      activation.last_validated_at
    );
    return result.lastInsertRowid as number;
  }

  public getLicenseActivation(
    deviceId: string
  ): import('../shared/types').LicenseActivation | null {
    const stmt = this.db.prepare(`
      SELECT * FROM license_activations
      WHERE device_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `);
    return stmt.get(deviceId) as
      | import('../shared/types').LicenseActivation
      | null;
  }

  public updateLicenseValidation(deviceId: string): void {
    const stmt = this.db.prepare(`
      UPDATE license_activations
      SET last_validated_at = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE device_id = ?
    `);
    stmt.run(new Date().toISOString(), deviceId);
  }

  public deleteLicenseActivation(deviceId: string): void {
    const stmt = this.db.prepare(`
      DELETE FROM license_activations
      WHERE device_id = ?
    `);
    stmt.run(deviceId);
  }

  public getAllLicenseActivations(): import('../shared/types').LicenseActivation[] {
    const stmt = this.db.prepare(`
      SELECT * FROM license_activations
      ORDER BY created_at DESC
    `);
    return stmt.all() as import('../shared/types').LicenseActivation[];
  }

  /**
   * Generic execute method for licensing system (v1.8)
   * Executes a SQL statement with parameters
   */
  public execute(sql: string, params?: any[]): void {
    const stmt = this.db.prepare(sql);
    if (params) {
      stmt.run(...params);
    } else {
      stmt.run();
    }
  }

  /**
   * Generic get method for licensing system (v1.8)
   * Returns a single row from a query
   */
  public get<T = any>(sql: string, params?: any[]): T | null {
    const stmt = this.db.prepare(sql);
    if (params) {
      return (stmt.get(...params) as T) || null;
    } else {
      return (stmt.get() as T) || null;
    }
  }

  public close(): void {
    // BUG FIX #4: Add explicit null check and set db to null after close
    // This prevents null pointer errors when close() is called multiple times
    if (!this.db) {
      console.log('  ℹ️ Database already closed or not initialized');
      return;
    }

    try {
      // Checkpoint WAL to ensure all data is written to main database file
      // This prevents -wal and -shm files from remaining locked
      console.log('  → Checkpointing WAL...');
      this.db.pragma('wal_checkpoint(TRUNCATE)');
      console.log('  ✅ WAL checkpointed');
    } catch (error) {
      console.error('  ⚠️ Error checkpointing WAL:', error);
      // Continue with close even if checkpoint fails
    }

    try {
      console.log('  → Closing database connection...');
      this.db.close();
      console.log('  ✅ Database connection closed');
    } catch (error) {
      console.error('  ❌ Error closing database:', error);
      // BUG FIX #4: Don't throw error on close failure - log and continue gracefully
    } finally {
      // BUG FIX #4: Set db to null to prevent future access attempts
      this.db = null as any;
    }
  }

  public getDbPath(): string {
    return this.effectiveDbPath || this.dbPath;
  }

  // Health check
  public isHealthy(): boolean {
    try {
      this.db.prepare('SELECT 1').get();
      return true;
    } catch {
      return false;
    }
  }
}
