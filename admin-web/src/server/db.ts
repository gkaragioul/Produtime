/**
 * Admin Console Database (Web Edition)
 * SQLite database for storing devices, policies, and audit logs
 * Uses DATABASE_PATH env var instead of Electron app.getPath()
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

export interface DeviceRecord {
  device_id: string;
  device_name: string;
  device_pubkey: string;
  paired_at: number;
  last_seen: number;
  status: 'online' | 'offline' | 'unknown';
  app_version: string;
  ip: string;
  policy_id?: string;
}

export interface PolicyRecord {
  policy_id: string;
  name: string;
  policy_json: string;
  updated_at: number;
}

export interface PendingPairRecord {
  request_id: string;
  device_id: string;
  device_name: string;
  device_pubkey: string;
  app_version: string;
  os_info: string;
  ip: string;
  pair_code: string;
  requested_at: number;
  expires_at: number;
}

export interface AuditLogRecord {
  id?: number;
  action: string;
  device_id?: string;
  details: string;
  timestamp: number;
  admin_user: string;
}

// App Categorization Types
export type AppCategory = 'productive' | 'neutral' | 'distracting';

export interface AppCategoryRecord {
  id: number;
  app_name: string;
  category: AppCategory;
  created_at: number;
  updated_at: number;
}

export interface AppUsageAggregate {
  app_name: string;
  total_seconds_today: number;
  total_seconds_7d: number;
  device_count: number;
  category: AppCategory;
}

export interface WeeklyInsightRecord {
  id: number;
  scope: 'team' | 'device';
  scope_id: string | null;
  date_range_start: string;
  date_range_end: string;
  type: string;
  severity: 'info' | 'warn' | 'crit';
  message: string;
  data_json: string;
  created_at: number;
}

export interface WeeklyReportRecord {
  id: number;
  week_start: string;
  week_end: string;
  report_json: string;
  narrative: string;
  generated_at: number;
  file_path: string | null;
}

export class AdminDatabase {
  private db: Database.Database;
  private dbPath: string;

  constructor(dbPathOverride?: string) {
    const dbPath = dbPathOverride || process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'admin-console.db');
    const dbDir = path.dirname(dbPath);

    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.dbPath = dbPath;
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initializeDatabase();
  }

  private initializeDatabase(): void {
    // Devices table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS devices (
        device_id TEXT PRIMARY KEY,
        device_name TEXT NOT NULL,
        device_pubkey TEXT NOT NULL,
        paired_at INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'unknown',
        app_version TEXT,
        ip TEXT,
        policy_id TEXT,
        FOREIGN KEY (policy_id) REFERENCES policies(policy_id)
      );
    `);

    // Policies table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS policies (
        policy_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        policy_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    // Device-Policy assignment table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS device_policy (
        device_id TEXT NOT NULL,
        policy_id TEXT NOT NULL,
        assigned_at INTEGER NOT NULL,
        PRIMARY KEY (device_id, policy_id),
        FOREIGN KEY (device_id) REFERENCES devices(device_id),
        FOREIGN KEY (policy_id) REFERENCES policies(policy_id)
      );
    `);

    // Pending pair requests table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pending_pairs (
        request_id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        device_name TEXT NOT NULL,
        device_pubkey TEXT NOT NULL,
        app_version TEXT,
        os_info TEXT,
        ip TEXT,
        pair_code TEXT NOT NULL,
        requested_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);

    // Audit log table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        device_id TEXT,
        details TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        admin_user TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);
    `);

    // Admin settings table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS admin_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // Admin keypair (single row)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS admin_keypair (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        public_key TEXT NOT NULL,
        private_key_encrypted TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);

    // Device stats cache (legacy - kept for compatibility)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS device_stats (
        device_id TEXT PRIMARY KEY,
        today_active_seconds INTEGER DEFAULT 0,
        today_idle_seconds INTEGER DEFAULT 0,
        last_updated INTEGER,
        FOREIGN KEY (device_id) REFERENCES devices(device_id)
      );
    `);

    // ============================================================
    // NEW TABLES FOR MANAGER-GRADE DASHBOARD
    // ============================================================

    // Device daily metrics - aggregated stats per device per day
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS device_daily_metrics (
        device_id TEXT NOT NULL,
        date_ymd TEXT NOT NULL,
        productive_seconds INTEGER DEFAULT 0,
        unproductive_seconds INTEGER DEFAULT 0,
        idle_seconds INTEGER DEFAULT 0,
        untracked_seconds INTEGER DEFAULT 0,
        active_seconds INTEGER DEFAULT 0,
        first_activity_ts INTEGER,
        last_activity_ts INTEGER,
        top_apps_json TEXT DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (device_id, date_ymd)
      );
      CREATE INDEX IF NOT EXISTS idx_device_daily_metrics_date ON device_daily_metrics(date_ymd);
    `);

    // Device status - real-time status tracking
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS device_status (
        device_id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'offline',
        last_seen_ts INTEGER NOT NULL,
        ip TEXT,
        app_version TEXT,
        policy_id TEXT,
        policy_hash TEXT,
        privacy_mode_effective INTEGER DEFAULT 0,
        title_sharing_effective INTEGER DEFAULT 0,
        tracking_running INTEGER DEFAULT 1,
        updated_at INTEGER NOT NULL
      );
    `);

    // Exceptions - alerts and issues requiring attention
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS exceptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        type TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'info',
        device_id TEXT NOT NULL,
        date_ymd TEXT NOT NULL,
        details_json TEXT NOT NULL DEFAULT '{}',
        resolved INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_exceptions_device ON exceptions(device_id);
      CREATE INDEX IF NOT EXISTS idx_exceptions_date ON exceptions(date_ymd);
      CREATE INDEX IF NOT EXISTS idx_exceptions_resolved ON exceptions(resolved);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_exceptions_unique ON exceptions(type, device_id, date_ymd) WHERE resolved = 0;
    `);

    // Heartbeat log - recent heartbeats for debugging
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS heartbeat_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        ts INTEGER NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_heartbeat_log_ts ON heartbeat_log(ts);
    `);

    // Command log - audit trail for device commands
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS command_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        command_id TEXT NOT NULL UNIQUE,
        device_id TEXT NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_command_log_device ON command_log(device_id);
    `);

    // ============================================================
    // APP CATEGORIZATION TABLES (Part 2)
    // ============================================================

    // App categories - global categorization of applications
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        app_name TEXT NOT NULL UNIQUE,
        category TEXT NOT NULL DEFAULT 'neutral',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_app_categories_name ON app_categories(app_name);
      CREATE INDEX IF NOT EXISTS idx_app_categories_category ON app_categories(category);
    `);

    // Device app overrides - per-device category overrides (Phase 2)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS device_app_overrides (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        app_name TEXT NOT NULL,
        category TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(device_id, app_name)
      );
      CREATE INDEX IF NOT EXISTS idx_device_app_overrides_device ON device_app_overrides(device_id);
    `);

    // App usage aggregates - aggregated app usage across all devices
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_usage_aggregates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        app_name TEXT NOT NULL,
        date_ymd TEXT NOT NULL,
        total_seconds INTEGER DEFAULT 0,
        device_count INTEGER DEFAULT 0,
        updated_at INTEGER NOT NULL,
        UNIQUE(app_name, date_ymd)
      );
      CREATE INDEX IF NOT EXISTS idx_app_usage_date ON app_usage_aggregates(date_ymd);
      CREATE INDEX IF NOT EXISTS idx_app_usage_app ON app_usage_aggregates(app_name);
    `);

    // ============================================================
    // WEEKLY INSIGHTS TABLES (Part 3)
    // ============================================================

    // Weekly insights - patterns and intelligence
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS weekly_insights (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL,
        scope_id TEXT,
        date_range_start TEXT NOT NULL,
        date_range_end TEXT NOT NULL,
        type TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'info',
        message TEXT NOT NULL,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_weekly_insights_scope ON weekly_insights(scope, scope_id);
      CREATE INDEX IF NOT EXISTS idx_weekly_insights_date ON weekly_insights(date_range_end);
    `);

    // Weekly reports - generated management reports
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS weekly_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        week_start TEXT NOT NULL,
        week_end TEXT NOT NULL,
        report_json TEXT NOT NULL,
        narrative TEXT NOT NULL,
        generated_at INTEGER NOT NULL,
        file_path TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_weekly_reports_week ON weekly_reports(week_end);
    `);

    console.log('Admin Console database initialized');
  }

  // ============================================================
  // Device Operations
  // ============================================================

  public getDevice(deviceId: string): DeviceRecord | null {
    return this.db.prepare('SELECT * FROM devices WHERE device_id = ?').get(deviceId) as DeviceRecord | null;
  }

  public getAllDevices(): DeviceRecord[] {
    return this.db.prepare('SELECT * FROM devices ORDER BY last_seen DESC').all() as DeviceRecord[];
  }

  public insertDevice(device: Omit<DeviceRecord, 'status'>): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO devices (device_id, device_name, device_pubkey, paired_at, last_seen, status, app_version, ip, policy_id)
      VALUES (?, ?, ?, ?, ?, 'online', ?, ?, ?)
    `).run(
      device.device_id,
      device.device_name,
      device.device_pubkey,
      device.paired_at,
      device.last_seen,
      device.app_version,
      device.ip,
      device.policy_id || null
    );
  }

  public updateDeviceStatus(deviceId: string, status: 'online' | 'offline', lastSeen?: number): void {
    if (lastSeen) {
      this.db.prepare('UPDATE devices SET status = ?, last_seen = ? WHERE device_id = ?').run(status, lastSeen, deviceId);
    } else {
      this.db.prepare('UPDATE devices SET status = ? WHERE device_id = ?').run(status, deviceId);
    }
  }

  public updateDeviceInfo(deviceId: string, info: Partial<DeviceRecord>): void {
    const updates: string[] = [];
    const values: any[] = [];

    if (info.app_version !== undefined) {
      updates.push('app_version = ?');
      values.push(info.app_version);
    }
    if (info.ip !== undefined) {
      updates.push('ip = ?');
      values.push(info.ip);
    }
    if (info.last_seen !== undefined) {
      updates.push('last_seen = ?');
      values.push(info.last_seen);
    }
    if (info.status !== undefined) {
      updates.push('status = ?');
      values.push(info.status);
    }
    if (info.policy_id !== undefined) {
      updates.push('policy_id = ?');
      values.push(info.policy_id);
    }

    if (updates.length > 0) {
      values.push(deviceId);
      this.db.prepare(`UPDATE devices SET ${updates.join(', ')} WHERE device_id = ?`).run(...values);
    }
  }

  public deleteDevice(deviceId: string): void {
    this.db.prepare('DELETE FROM device_policy WHERE device_id = ?').run(deviceId);
    this.db.prepare('DELETE FROM device_stats WHERE device_id = ?').run(deviceId);
    this.db.prepare('DELETE FROM devices WHERE device_id = ?').run(deviceId);
  }

  // ============================================================
  // Policy Operations
  // ============================================================

  public getPolicy(policyId: string): PolicyRecord | null {
    return this.db.prepare('SELECT * FROM policies WHERE policy_id = ?').get(policyId) as PolicyRecord | null;
  }

  public getAllPolicies(): PolicyRecord[] {
    return this.db.prepare('SELECT * FROM policies ORDER BY updated_at DESC').all() as PolicyRecord[];
  }

  public insertPolicy(policy: PolicyRecord): void {
    this.db.prepare(`
      INSERT INTO policies (policy_id, name, policy_json, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(policy.policy_id, policy.name, policy.policy_json, policy.updated_at);
  }

  public updatePolicy(policyId: string, name: string, policyJson: string): void {
    this.db.prepare(`
      UPDATE policies SET name = ?, policy_json = ?, updated_at = ? WHERE policy_id = ?
    `).run(name, policyJson, Date.now(), policyId);
  }

  public deletePolicy(policyId: string): void {
    this.db.prepare('UPDATE devices SET policy_id = NULL WHERE policy_id = ?').run(policyId);
    this.db.prepare('DELETE FROM device_policy WHERE policy_id = ?').run(policyId);
    this.db.prepare('DELETE FROM policies WHERE policy_id = ?').run(policyId);
  }

  public assignPolicyToDevice(deviceId: string, policyId: string): void {
    this.db.prepare('UPDATE devices SET policy_id = ? WHERE device_id = ?').run(policyId, deviceId);
    this.db.prepare(`
      INSERT OR REPLACE INTO device_policy (device_id, policy_id, assigned_at)
      VALUES (?, ?, ?)
    `).run(deviceId, policyId, Date.now());
  }

  // ============================================================
  // Pending Pair Operations
  // ============================================================

  public getPendingPair(requestId: string): PendingPairRecord | null {
    return this.db.prepare('SELECT * FROM pending_pairs WHERE request_id = ?').get(requestId) as PendingPairRecord | null;
  }

  public getPendingPairByCode(pairCode: string): PendingPairRecord | null {
    return this.db.prepare('SELECT * FROM pending_pairs WHERE pair_code = ? AND expires_at > ?').get(pairCode, Date.now()) as PendingPairRecord | null;
  }

  public getAllPendingPairs(): PendingPairRecord[] {
    return this.db.prepare('SELECT * FROM pending_pairs WHERE expires_at > ? ORDER BY requested_at DESC').all(Date.now()) as PendingPairRecord[];
  }

  public insertPendingPair(pair: PendingPairRecord): void {
    this.db.prepare(`
      INSERT INTO pending_pairs (request_id, device_id, device_name, device_pubkey, app_version, os_info, ip, pair_code, requested_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      pair.request_id,
      pair.device_id,
      pair.device_name,
      pair.device_pubkey,
      pair.app_version,
      pair.os_info,
      pair.ip,
      pair.pair_code,
      pair.requested_at,
      pair.expires_at
    );
  }

  public deletePendingPair(requestId: string): void {
    this.db.prepare('DELETE FROM pending_pairs WHERE request_id = ?').run(requestId);
  }

  public cleanupExpiredPairs(): void {
    this.db.prepare('DELETE FROM pending_pairs WHERE expires_at < ?').run(Date.now());
  }

  // ============================================================
  // Audit Log Operations
  // ============================================================

  public insertAuditLog(log: Omit<AuditLogRecord, 'id'>): void {
    this.db.prepare(`
      INSERT INTO audit_log (action, device_id, details, timestamp, admin_user)
      VALUES (?, ?, ?, ?, ?)
    `).run(log.action, log.device_id || null, log.details, log.timestamp, log.admin_user);
  }

  public getAuditLogs(limit: number = 100): AuditLogRecord[] {
    return this.db.prepare('SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?').all(limit) as AuditLogRecord[];
  }

  // ============================================================
  // Admin Settings Operations
  // ============================================================

  public getSetting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM admin_settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value || null;
  }

  public setSetting(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO admin_settings (key, value) VALUES (?, ?)').run(key, value);
  }

  // ============================================================
  // Admin Keypair Operations
  // ============================================================

  public getAdminKeypair(): { public_key: string; private_key_encrypted: string } | null {
    const row = this.db.prepare('SELECT public_key, private_key_encrypted FROM admin_keypair WHERE id = 1').get() as any;
    return row || null;
  }

  public setAdminKeypair(publicKey: string, privateKeyEncrypted: string): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO admin_keypair (id, public_key, private_key_encrypted, created_at)
      VALUES (1, ?, ?, ?)
    `).run(publicKey, privateKeyEncrypted, Date.now());
  }

  // ============================================================
  // Device Stats Operations
  // ============================================================

  public updateDeviceStats(deviceId: string, activeSeconds: number, idleSeconds: number): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO device_stats (device_id, today_active_seconds, today_idle_seconds, last_updated)
      VALUES (?, ?, ?, ?)
    `).run(deviceId, activeSeconds, idleSeconds, Date.now());
  }

  public getDeviceStats(deviceId: string): { today_active_seconds: number; today_idle_seconds: number } | null {
    return this.db.prepare('SELECT today_active_seconds, today_idle_seconds FROM device_stats WHERE device_id = ?').get(deviceId) as any;
  }

  // ============================================================
  // Device Daily Metrics Operations
  // ============================================================

  public upsertDeviceDailyMetrics(metrics: {
    device_id: string;
    date_ymd: string;
    productive_seconds: number;
    unproductive_seconds: number;
    idle_seconds: number;
    untracked_seconds: number;
    active_seconds: number;
    first_activity_ts: number | null;
    last_activity_ts: number | null;
    top_apps_json: string;
  }): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO device_daily_metrics 
        (device_id, date_ymd, productive_seconds, unproductive_seconds, idle_seconds, 
         untracked_seconds, active_seconds, first_activity_ts, last_activity_ts, 
         top_apps_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(device_id, date_ymd) DO UPDATE SET
        productive_seconds = excluded.productive_seconds,
        unproductive_seconds = excluded.unproductive_seconds,
        idle_seconds = excluded.idle_seconds,
        untracked_seconds = excluded.untracked_seconds,
        active_seconds = excluded.active_seconds,
        first_activity_ts = COALESCE(device_daily_metrics.first_activity_ts, excluded.first_activity_ts),
        last_activity_ts = excluded.last_activity_ts,
        top_apps_json = excluded.top_apps_json,
        updated_at = excluded.updated_at
    `).run(
      metrics.device_id,
      metrics.date_ymd,
      metrics.productive_seconds,
      metrics.unproductive_seconds,
      metrics.idle_seconds,
      metrics.untracked_seconds,
      metrics.active_seconds,
      metrics.first_activity_ts,
      metrics.last_activity_ts,
      metrics.top_apps_json,
      now,
      now
    );
  }

  public getDeviceDailyMetrics(deviceId: string, dateYmd: string): any | null {
    return this.db.prepare(
      'SELECT * FROM device_daily_metrics WHERE device_id = ? AND date_ymd = ?'
    ).get(deviceId, dateYmd);
  }

  public getDeviceDailyMetricsRange(deviceId: string, startDate: string, endDate: string): any[] {
    return this.db.prepare(
      'SELECT * FROM device_daily_metrics WHERE device_id = ? AND date_ymd BETWEEN ? AND ? ORDER BY date_ymd DESC'
    ).all(deviceId, startDate, endDate);
  }

  public getAllDevicesDailyMetrics(dateYmd: string): any[] {
    return this.db.prepare(
      'SELECT * FROM device_daily_metrics WHERE date_ymd = ?'
    ).all(dateYmd);
  }

  public getTeamDailyMetricsRange(startDate: string, endDate: string): any[] {
    return this.db.prepare(`
      SELECT date_ymd,
        SUM(productive_seconds) as productive_seconds,
        SUM(unproductive_seconds) as unproductive_seconds,
        SUM(idle_seconds) as idle_seconds,
        SUM(untracked_seconds) as untracked_seconds,
        SUM(active_seconds) as active_seconds
      FROM device_daily_metrics
      WHERE date_ymd BETWEEN ? AND ?
      GROUP BY date_ymd
      ORDER BY date_ymd ASC
    `).all(startDate, endDate);
  }

  // ============================================================
  // Device Status Operations
  // ============================================================

  public upsertDeviceStatus(status: {
    device_id: string;
    status: string;
    last_seen_ts: number;
    ip: string;
    app_version: string;
    policy_id: string | null;
    policy_hash: string | null;
    privacy_mode_effective: boolean;
    title_sharing_effective: boolean;
    tracking_running: boolean;
  }): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO device_status 
        (device_id, status, last_seen_ts, ip, app_version, policy_id, policy_hash,
         privacy_mode_effective, title_sharing_effective, tracking_running, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET
        status = excluded.status,
        last_seen_ts = excluded.last_seen_ts,
        ip = excluded.ip,
        app_version = excluded.app_version,
        policy_id = excluded.policy_id,
        policy_hash = excluded.policy_hash,
        privacy_mode_effective = excluded.privacy_mode_effective,
        title_sharing_effective = excluded.title_sharing_effective,
        tracking_running = excluded.tracking_running,
        updated_at = excluded.updated_at
    `).run(
      status.device_id,
      status.status,
      status.last_seen_ts,
      status.ip,
      status.app_version,
      status.policy_id,
      status.policy_hash,
      status.privacy_mode_effective ? 1 : 0,
      status.title_sharing_effective ? 1 : 0,
      status.tracking_running ? 1 : 0,
      now
    );
  }

  public getDeviceStatus(deviceId: string): any | null {
    return this.db.prepare('SELECT * FROM device_status WHERE device_id = ?').get(deviceId);
  }

  public getAllDeviceStatuses(): any[] {
    return this.db.prepare('SELECT * FROM device_status').all();
  }

  public getDeviceStatusCounts(): { online: number; idle: number; offline: number } {
    const result = this.db.prepare(`
      SELECT 
        SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END) as online,
        SUM(CASE WHEN status = 'idle' THEN 1 ELSE 0 END) as idle,
        SUM(CASE WHEN status = 'offline' THEN 1 ELSE 0 END) as offline
      FROM device_status
    `).get() as any;
    return {
      online: result?.online || 0,
      idle: result?.idle || 0,
      offline: result?.offline || 0,
    };
  }

  // ============================================================
  // Exceptions Operations
  // ============================================================

  public insertException(exception: {
    ts: number;
    type: string;
    severity: string;
    device_id: string;
    date_ymd: string;
    details_json: string;
  }): number | null {
    try {
      const result = this.db.prepare(`
        INSERT INTO exceptions (ts, type, severity, device_id, date_ymd, details_json, resolved)
        VALUES (?, ?, ?, ?, ?, ?, 0)
      `).run(
        exception.ts,
        exception.type,
        exception.severity,
        exception.device_id,
        exception.date_ymd,
        exception.details_json
      );
      return result.lastInsertRowid as number;
    } catch (err: any) {
      // Ignore unique constraint violations (duplicate exception)
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return null;
      }
      throw err;
    }
  }

  public getUnresolvedExceptions(limit: number = 50): any[] {
    return this.db.prepare(`
      SELECT e.*, d.device_name 
      FROM exceptions e
      LEFT JOIN devices d ON e.device_id = d.device_id
      WHERE e.resolved = 0
      ORDER BY e.ts DESC
      LIMIT ?
    `).all(limit);
  }

  public getExceptionsByDevice(deviceId: string, limit: number = 20): any[] {
    return this.db.prepare(`
      SELECT * FROM exceptions 
      WHERE device_id = ?
      ORDER BY ts DESC
      LIMIT ?
    `).all(deviceId, limit);
  }

  public resolveException(id: number): void {
    this.db.prepare('UPDATE exceptions SET resolved = 1 WHERE id = ?').run(id);
  }

  public getExceptionCounts(): Record<string, number> {
    const rows = this.db.prepare(`
      SELECT type, COUNT(*) as count
      FROM exceptions
      WHERE resolved = 0
      GROUP BY type
    `).all() as Array<{ type: string; count: number }>;
    
    const counts: Record<string, number> = {};
    for (const row of rows) {
      counts[row.type] = row.count;
    }
    return counts;
  }

  // ============================================================
  // Heartbeat Log Operations
  // ============================================================

  public insertHeartbeatLog(deviceId: string, payloadJson: string): void {
    this.db.prepare(`
      INSERT INTO heartbeat_log (device_id, ts, payload_json)
      VALUES (?, ?, ?)
    `).run(deviceId, Date.now(), payloadJson);
    
    // Cleanup old heartbeats (keep last 1000)
    this.db.prepare(`
      DELETE FROM heartbeat_log WHERE id NOT IN (
        SELECT id FROM heartbeat_log ORDER BY ts DESC LIMIT 1000
      )
    `).run();
  }

  public getRecentHeartbeats(limit: number = 100): any[] {
    return this.db.prepare(`
      SELECT h.*, d.device_name
      FROM heartbeat_log h
      LEFT JOIN devices d ON h.device_id = d.device_id
      ORDER BY h.ts DESC
      LIMIT ?
    `).all(limit);
  }

  // ============================================================
  // Command Log Operations
  // ============================================================

  public insertCommandLog(command: {
    command_id: string;
    device_id: string;
    type: string;
    payload_json: string;
  }): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO command_log (command_id, device_id, type, payload_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?)
    `).run(command.command_id, command.device_id, command.type, command.payload_json, now, now);
  }

  public updateCommandStatus(commandId: string, status: string): void {
    this.db.prepare(`
      UPDATE command_log SET status = ?, updated_at = ? WHERE command_id = ?
    `).run(status, Date.now(), commandId);
  }

  public getRecentCommands(limit: number = 100): any[] {
    return this.db.prepare(`
      SELECT c.*, d.device_name
      FROM command_log c
      LEFT JOIN devices d ON c.device_id = d.device_id
      ORDER BY c.created_at DESC
      LIMIT ?
    `).all(limit);
  }

  // ============================================================
  // Dashboard Aggregation Queries
  // ============================================================

  public getTeamTotalsForDate(dateYmd: string): {
    productive_seconds: number;
    unproductive_seconds: number;
    idle_seconds: number;
    untracked_seconds: number;
    active_seconds: number;
  } {
    const result = this.db.prepare(`
      SELECT 
        COALESCE(SUM(productive_seconds), 0) as productive_seconds,
        COALESCE(SUM(unproductive_seconds), 0) as unproductive_seconds,
        COALESCE(SUM(idle_seconds), 0) as idle_seconds,
        COALESCE(SUM(untracked_seconds), 0) as untracked_seconds,
        COALESCE(SUM(active_seconds), 0) as active_seconds
      FROM device_daily_metrics
      WHERE date_ymd = ?
    `).get(dateYmd) as any;
    return result || {
      productive_seconds: 0,
      unproductive_seconds: 0,
      idle_seconds: 0,
      untracked_seconds: 0,
      active_seconds: 0,
    };
  }

  public getTopAppsForDate(dateYmd: string, limit: number = 10): Array<{ app: string; seconds: number }> {
    // Aggregate top apps from all devices for the date
    const rows = this.db.prepare(`
      SELECT top_apps_json FROM device_daily_metrics WHERE date_ymd = ?
    `).all(dateYmd) as Array<{ top_apps_json: string }>;
    
    const appTotals = new Map<string, number>();
    for (const row of rows) {
      try {
        const apps = JSON.parse(row.top_apps_json) as Array<{ app: string; seconds: number }>;
        for (const app of apps) {
          appTotals.set(app.app, (appTotals.get(app.app) || 0) + app.seconds);
        }
      } catch {
        // Ignore parse errors
      }
    }
    
    return Array.from(appTotals.entries())
      .map(([app, seconds]) => ({ app, seconds }))
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, limit);
  }

  // ============================================================
  // App Categorization Operations
  // ============================================================

  public getAppCategory(appName: string): AppCategoryRecord | null {
    return this.db.prepare('SELECT * FROM app_categories WHERE app_name = ?').get(appName) as AppCategoryRecord | null;
  }

  public getAllAppCategories(): AppCategoryRecord[] {
    return this.db.prepare('SELECT * FROM app_categories ORDER BY app_name').all() as AppCategoryRecord[];
  }

  public setAppCategory(appName: string, category: AppCategory): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO app_categories (app_name, category, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(app_name) DO UPDATE SET
        category = excluded.category,
        updated_at = excluded.updated_at
    `).run(appName, category, now, now);
  }

  public setAppCategoriesBulk(apps: Array<{ appName: string; category: AppCategory }>): void {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO app_categories (app_name, category, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(app_name) DO UPDATE SET
        category = excluded.category,
        updated_at = excluded.updated_at
    `);
    
    const transaction = this.db.transaction((items: typeof apps) => {
      for (const item of items) {
        stmt.run(item.appName, item.category, now, now);
      }
    });
    
    transaction(apps);
  }

  public deleteAppCategory(appName: string): void {
    this.db.prepare('DELETE FROM app_categories WHERE app_name = ?').run(appName);
  }

  public getAppUsageAggregates(dateYmd: string): AppUsageAggregate[] {
    // Get all apps used today with their categories
    const todayApps = this.db.prepare(`
      SELECT 
        a.app_name,
        COALESCE(a.total_seconds, 0) as total_seconds_today,
        COALESCE(c.category, 'neutral') as category
      FROM app_usage_aggregates a
      LEFT JOIN app_categories c ON a.app_name = c.app_name
      WHERE a.date_ymd = ?
      ORDER BY a.total_seconds DESC
    `).all(dateYmd) as Array<{ app_name: string; total_seconds_today: number; category: AppCategory }>;
    
    // Get 7-day totals
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    const startDate = sevenDaysAgo.toISOString().split('T')[0];
    
    const weeklyTotals = this.db.prepare(`
      SELECT 
        app_name,
        SUM(total_seconds) as total_seconds_7d,
        COUNT(DISTINCT date_ymd) as device_count
      FROM app_usage_aggregates
      WHERE date_ymd BETWEEN ? AND ?
      GROUP BY app_name
    `).all(startDate, dateYmd) as Array<{ app_name: string; total_seconds_7d: number; device_count: number }>;
    
    const weeklyMap = new Map(weeklyTotals.map(w => [w.app_name, w]));
    
    return todayApps.map(app => ({
      app_name: app.app_name,
      total_seconds_today: app.total_seconds_today,
      total_seconds_7d: weeklyMap.get(app.app_name)?.total_seconds_7d || app.total_seconds_today,
      device_count: weeklyMap.get(app.app_name)?.device_count || 1,
      category: app.category,
    }));
  }

  public updateAppUsageAggregate(appName: string, dateYmd: string, seconds: number, deviceCount: number = 1): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO app_usage_aggregates (app_name, date_ymd, total_seconds, device_count, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(app_name, date_ymd) DO UPDATE SET
        total_seconds = app_usage_aggregates.total_seconds + excluded.total_seconds,
        device_count = MAX(app_usage_aggregates.device_count, excluded.device_count),
        updated_at = excluded.updated_at
    `).run(appName, dateYmd, seconds, deviceCount, now);
  }

  public aggregateAppUsageFromHeartbeats(dateYmd: string): void {
    // Aggregate app usage from device_daily_metrics top_apps_json
    const metrics = this.db.prepare(
      'SELECT top_apps_json FROM device_daily_metrics WHERE date_ymd = ?'
    ).all(dateYmd) as Array<{ top_apps_json: string }>;
    
    const appTotals = new Map<string, { seconds: number; devices: Set<string> }>();
    
    for (const metric of metrics) {
      try {
        const apps = JSON.parse(metric.top_apps_json || '[]') as Array<{ app: string; seconds: number }>;
        for (const app of apps) {
          const existing = appTotals.get(app.app) || { seconds: 0, devices: new Set() };
          existing.seconds += app.seconds;
          appTotals.set(app.app, existing);
        }
      } catch {
        // Ignore parse errors
      }
    }
    
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO app_usage_aggregates (app_name, date_ymd, total_seconds, device_count, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(app_name, date_ymd) DO UPDATE SET
        total_seconds = excluded.total_seconds,
        device_count = excluded.device_count,
        updated_at = excluded.updated_at
    `);
    
    const transaction = this.db.transaction(() => {
      for (const [appName, data] of appTotals) {
        stmt.run(appName, dateYmd, data.seconds, data.devices.size || 1, now);
      }
    });
    
    transaction();
  }

  public getProductivityMetrics(deviceId: string, dateYmd: string): {
    productiveSeconds: number;
    neutralSeconds: number;
    distractingSeconds: number;
    productivityScore: number;
  } {
    const metrics = this.getDeviceDailyMetrics(deviceId, dateYmd);
    if (!metrics) {
      return { productiveSeconds: 0, neutralSeconds: 0, distractingSeconds: 0, productivityScore: 0 };
    }
    
    // Parse top apps and categorize
    let productiveSeconds = 0;
    let neutralSeconds = 0;
    let distractingSeconds = 0;
    
    try {
      const apps = JSON.parse(metrics.top_apps_json || '[]') as Array<{ app: string; seconds: number }>;
      for (const app of apps) {
        const category = this.getAppCategory(app.app);
        switch (category?.category) {
          case 'productive':
            productiveSeconds += app.seconds;
            break;
          case 'distracting':
            distractingSeconds += app.seconds;
            break;
          default:
            neutralSeconds += app.seconds;
        }
      }
    } catch {
      // If no categorization, treat all active time as neutral
      neutralSeconds = metrics.active_seconds;
    }
    
    const totalCategorized = productiveSeconds + distractingSeconds;
    const productivityScore = totalCategorized > 0 
      ? productiveSeconds / totalCategorized 
      : 0.5; // Default to 50% if no categorized apps
    
    return { productiveSeconds, neutralSeconds, distractingSeconds, productivityScore };
  }

  // ============================================================
  // Weekly Insights Operations
  // ============================================================

  public insertWeeklyInsight(insight: Omit<WeeklyInsightRecord, 'id' | 'created_at'>): number {
    const result = this.db.prepare(`
      INSERT INTO weekly_insights (scope, scope_id, date_range_start, date_range_end, type, severity, message, data_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      insight.scope,
      insight.scope_id,
      insight.date_range_start,
      insight.date_range_end,
      insight.type,
      insight.severity,
      insight.message,
      insight.data_json,
      Date.now()
    );
    return result.lastInsertRowid as number;
  }

  public getWeeklyInsights(dateRangeEnd: string, scope?: 'team' | 'device', scopeId?: string): WeeklyInsightRecord[] {
    let query = 'SELECT * FROM weekly_insights WHERE date_range_end = ?';
    const params: any[] = [dateRangeEnd];
    
    if (scope) {
      query += ' AND scope = ?';
      params.push(scope);
    }
    if (scopeId) {
      query += ' AND scope_id = ?';
      params.push(scopeId);
    }
    
    query += ' ORDER BY severity DESC, created_at DESC';
    
    return this.db.prepare(query).all(...params) as WeeklyInsightRecord[];
  }

  public getRecentWeeklyInsights(limit: number = 20): WeeklyInsightRecord[] {
    return this.db.prepare(`
      SELECT * FROM weekly_insights 
      ORDER BY created_at DESC 
      LIMIT ?
    `).all(limit) as WeeklyInsightRecord[];
  }

  // ============================================================
  // Weekly Reports Operations
  // ============================================================

  public insertWeeklyReport(report: Omit<WeeklyReportRecord, 'id'>): number {
    const result = this.db.prepare(`
      INSERT INTO weekly_reports (week_start, week_end, report_json, narrative, generated_at, file_path)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      report.week_start,
      report.week_end,
      report.report_json,
      report.narrative,
      report.generated_at,
      report.file_path
    );
    return result.lastInsertRowid as number;
  }

  public getWeeklyReport(weekEnd: string): WeeklyReportRecord | null {
    return this.db.prepare('SELECT * FROM weekly_reports WHERE week_end = ?').get(weekEnd) as WeeklyReportRecord | null;
  }

  public getAllWeeklyReports(): WeeklyReportRecord[] {
    return this.db.prepare('SELECT * FROM weekly_reports ORDER BY week_end DESC').all() as WeeklyReportRecord[];
  }

  // ============================================================
  // Utility
  // ============================================================

  public close(): void {
    this.db.close();
  }
}
