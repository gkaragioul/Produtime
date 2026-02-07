# ProduTime - Database Schema Reference

## Overview

ProduTime uses SQLite with WAL (Write-Ahead Logging) mode for better concurrency. The database is hardware-encrypted and stored at:
- **Windows**: `%APPDATA%/produtime/produtime_<hash>.db`
- **macOS**: `~/Library/Application Support/produtime/produtime_<hash>.db`
- **Linux**: `~/.config/produtime/produtime_<hash>.db`

The `<hash>` suffix makes the database hardware-specific, preventing unauthorized access.

## Core Tables

### 1. activity_logs

Stores user activity tracking data.

```sql
CREATE TABLE activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  app_name TEXT NOT NULL,
  window_title TEXT NOT NULL,
  duration INTEGER NOT NULL
);

CREATE INDEX idx_activity_logs_timestamp ON activity_logs(timestamp);
```

**Fields**:
- `id`: Unique identifier
- `timestamp`: ISO 8601 timestamp (e.g., "2026-01-15T14:30:00Z")
- `app_name`: Application name (e.g., "Visual Studio Code")
- `window_title`: Window title (sanitized if privacy mode enabled)
- `duration`: Duration in seconds

**Example**:
```json
{
  "id": 1,
  "timestamp": "2026-01-15T14:30:00Z",
  "app_name": "Visual Studio Code",
  "window_title": "main.ts - ProduTime",
  "duration": 300
}
```

**Queries**:
```typescript
// Get logs for date range
db.prepare(`
  SELECT * FROM activity_logs 
  WHERE timestamp BETWEEN ? AND ?
  ORDER BY timestamp DESC
`).all(startDate, endDate);

// Get logs with limit
db.prepare(`
  SELECT * FROM activity_logs 
  ORDER BY timestamp DESC 
  LIMIT ? OFFSET ?
`).all(limit, offset);
```

---

### 2. settings

Key-value store for application configuration.

```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

**Fields**:
- `key`: Setting identifier (unique)
- `value`: Setting value (stored as string, parsed as needed)

**Common Settings**:

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `work_schedule_start` | string (HH:MM) | "09:00" | Daily work start time |
| `work_schedule_end` | string (HH:MM) | "17:00" | Daily work end time |
| `work_schedule_weekly` | JSON | null | Per-weekday schedule |
| `export_folder` | string | "%USERPROFILE%/Documents" | PDF export location |
| `auto_export_enabled` | boolean | "true" | Enable auto-export |
| `auto_export_time` | string (HH:MM) | "18:00" | Daily export time |
| `idle_threshold` | integer | "300" | Idle detection threshold (seconds) |
| `employee_name` | string | "" | User name for reports |
| `admin_alert_email` | string | "" | Admin notification email |
| `privacy_mode_enabled` | boolean | "false" | Enable privacy mode |
| `privacy_apps` | JSON | DEFAULT_PRIVACY_APPS | Privacy-sensitive apps |
| `activation_server_url` | string | null | License server URL |
| `validation_server_url` | string | null | Validation server URL |

**Example**:
```json
{
  "key": "work_schedule_start",
  "value": "09:00"
}
```

**Queries**:
```typescript
// Get single setting
db.prepare('SELECT value FROM settings WHERE key = ?').get(key);

// Get all settings
db.prepare('SELECT * FROM settings').all();

// Set setting
db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);

// Delete setting
db.prepare('DELETE FROM settings WHERE key = ?').run(key);
```

---

### 3. analytics

Stores application metrics and analytics data.

```sql
CREATE TABLE analytics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  metric_name TEXT NOT NULL,
  metric_value REAL NOT NULL,
  recorded_at TEXT NOT NULL
);

CREATE INDEX idx_analytics_metric_name ON analytics(metric_name);
CREATE INDEX idx_analytics_recorded_at ON analytics(recorded_at);
```

**Fields**:
- `id`: Unique identifier
- `metric_name`: Metric identifier (e.g., "daily_hours", "session_count")
- `metric_value`: Numeric value
- `recorded_at`: ISO 8601 timestamp

**Common Metrics**:
- `daily_hours`: Total hours tracked per day
- `session_count`: Number of sessions per day
- `average_session_length`: Average session duration
- `idle_time`: Total idle time
- `productivity_score`: Calculated productivity metric

**Example**:
```json
{
  "id": 1,
  "metric_name": "daily_hours",
  "metric_value": 8.5,
  "recorded_at": "2026-01-15T23:59:59Z"
}
```

**Queries**:
```typescript
// Get metric for date range
db.prepare(`
  SELECT * FROM analytics 
  WHERE metric_name = ? AND recorded_at BETWEEN ? AND ?
  ORDER BY recorded_at DESC
`).all(metricName, startDate, endDate);

// Get latest metric value
db.prepare(`
  SELECT * FROM analytics 
  WHERE metric_name = ? 
  ORDER BY recorded_at DESC 
  LIMIT 1
`).get(metricName);
```

---

### 4. admin_lockout

Tracks admin authentication lockout state.

```sql
CREATE TABLE admin_lockout (
  id INTEGER PRIMARY KEY,
  is_locked BOOLEAN DEFAULT 0,
  locked_until TEXT,
  failed_attempts_count INTEGER DEFAULT 0,
  last_attempt_at TEXT,
  created_at TEXT,
  updated_at TEXT
);
```

**Fields**:
- `id`: Always 1 (singleton table)
- `is_locked`: Whether account is currently locked
- `locked_until`: ISO 8601 timestamp when lockout expires
- `failed_attempts_count`: Number of failed login attempts
- `last_attempt_at`: Timestamp of last login attempt
- `created_at`: When lockout record was created
- `updated_at`: When lockout record was last updated

**Lockout Rules**:
- Lockout triggered after 5 failed attempts
- Lockout duration: 15 minutes
- Counter resets on successful login
- Counter resets after lockout expires

**Example**:
```json
{
  "id": 1,
  "is_locked": true,
  "locked_until": "2026-01-15T14:45:00Z",
  "failed_attempts_count": 5,
  "last_attempt_at": "2026-01-15T14:30:00Z",
  "created_at": "2026-01-15T14:00:00Z",
  "updated_at": "2026-01-15T14:30:00Z"
}
```

**Queries**:
```typescript
// Get lockout state
db.prepare('SELECT * FROM admin_lockout WHERE id = 1').get();

// Update lockout
db.prepare(`
  UPDATE admin_lockout 
  SET is_locked = ?, locked_until = ?, failed_attempts_count = ?, updated_at = ?
  WHERE id = 1
`).run(isLocked, lockedUntil, count, now);

// Increment failed attempts
db.prepare(`
  UPDATE admin_lockout 
  SET failed_attempts_count = failed_attempts_count + 1, 
      last_attempt_at = ?,
      updated_at = ?
  WHERE id = 1
`).run(now, now);
```

---

### 5. admin_login_attempts

Audit log of admin login attempts.

```sql
CREATE TABLE admin_login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_address TEXT,
  attempted_at TEXT NOT NULL,
  success BOOLEAN NOT NULL
);

CREATE INDEX idx_admin_login_attempts_attempted_at ON admin_login_attempts(attempted_at);
```

**Fields**:
- `id`: Unique identifier
- `ip_address`: IP address of login attempt (null for localhost)
- `attempted_at`: ISO 8601 timestamp
- `success`: Whether login was successful

**Example**:
```json
{
  "id": 1,
  "ip_address": "127.0.0.1",
  "attempted_at": "2026-01-15T14:30:00Z",
  "success": false
}
```

**Queries**:
```typescript
// Log login attempt
db.prepare(`
  INSERT INTO admin_login_attempts (ip_address, attempted_at, success)
  VALUES (?, ?, ?)
`).run(ipAddress, now, success);

// Get recent attempts
db.prepare(`
  SELECT * FROM admin_login_attempts 
  ORDER BY attempted_at DESC 
  LIMIT 100
`).all();
```

---

### 6. license_activations

Stores license activation information.

```sql
CREATE TABLE license_activations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_key TEXT NOT NULL,
  device_id TEXT NOT NULL,
  activation_code TEXT NOT NULL,
  plan TEXT NOT NULL,
  expiry_date TEXT,
  activated_at TEXT NOT NULL,
  last_validated_at TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT
);

CREATE UNIQUE INDEX idx_license_activations_device_id ON license_activations(device_id);
```

**Fields**:
- `id`: Unique identifier
- `license_key`: Encrypted license key
- `device_id`: Hardware device identifier
- `activation_code`: Server-provided activation code
- `plan`: License plan (basic, pro, enterprise, trial)
- `expiry_date`: License expiry date (null for perpetual)
- `activated_at`: When license was activated
- `last_validated_at`: Last server validation timestamp
- `created_at`: Record creation timestamp
- `updated_at`: Record update timestamp

**Example**:
```json
{
  "id": 1,
  "license_key": "<encrypted>",
  "device_id": "abc123def456",
  "activation_code": "ACT-2026-01-15-ABC123",
  "plan": "pro",
  "expiry_date": "2027-01-15",
  "activated_at": "2026-01-15T10:00:00Z",
  "last_validated_at": "2026-01-15T14:30:00Z",
  "created_at": "2026-01-15T10:00:00Z",
  "updated_at": "2026-01-15T14:30:00Z"
}
```

**Queries**:
```typescript
// Get activation
db.prepare('SELECT * FROM license_activations WHERE device_id = ?').get(deviceId);

// Create activation
db.prepare(`
  INSERT INTO license_activations 
  (license_key, device_id, activation_code, plan, expiry_date, activated_at, last_validated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`).run(key, deviceId, code, plan, expiry, now, now);

// Update validation time
db.prepare(`
  UPDATE license_activations 
  SET last_validated_at = ?, updated_at = ?
  WHERE device_id = ?
`).run(now, now, deviceId);
```

---

## Database Initialization

The database is initialized with migrations in `src/main/database.ts`:

```typescript
private runMigrations(): void {
  const migrations: Migration[] = [
    {
      version: 1,
      description: 'Create activity_logs table',
      up: `CREATE TABLE IF NOT EXISTS activity_logs (...)`,
    },
    {
      version: 2,
      description: 'Create settings table',
      up: `CREATE TABLE IF NOT EXISTS settings (...)`,
    },
    // ... more migrations
  ];

  for (const migration of migrations) {
    this.db.exec(migration.up);
  }
}
```

## Performance Considerations

### Indexes

Indexes are created on frequently queried columns:
- `activity_logs.timestamp`: For date range queries
- `analytics.metric_name`: For metric lookups
- `analytics.recorded_at`: For time-based queries
- `admin_login_attempts.attempted_at`: For audit queries

### WAL Mode

WAL (Write-Ahead Logging) is enabled for better concurrency:
```typescript
this.db.pragma('journal_mode = WAL');
```

Benefits:
- Multiple readers can access database while writes are in progress
- Faster writes
- Better crash recovery

### Query Optimization

Common query patterns:
```typescript
// Efficient: Uses index on timestamp
db.prepare(`
  SELECT * FROM activity_logs 
  WHERE timestamp BETWEEN ? AND ?
`).all(start, end);

// Efficient: Uses index on metric_name
db.prepare(`
  SELECT * FROM analytics 
  WHERE metric_name = ?
`).all(name);

// Inefficient: Full table scan
db.prepare(`
  SELECT * FROM activity_logs 
  WHERE app_name LIKE ?
`).all('%code%');
```

## Data Retention

### Activity Logs
- **Retention**: Indefinite (user can clear manually)
- **Cleanup**: Manual via "Clear All Data" button
- **Size**: ~1KB per log entry

### Analytics
- **Retention**: Indefinite
- **Cleanup**: Manual via "Clear All Data" button
- **Size**: ~100 bytes per metric

### Admin Logs
- **Retention**: 90 days (recommended)
- **Cleanup**: Manual or via maintenance script
- **Size**: ~200 bytes per attempt

## Backup & Recovery

### Backup Location
- Automatic backups: `%APPDATA%/produtime/backups/`
- Manual backup: Copy `produtime_<hash>.db` file

### Recovery
```typescript
// Restore from backup
fs.copyFileSync(backupPath, dbPath);
db.close();
db = new Database(dbPath);
```

### Integrity Check
```typescript
// Check database integrity
const result = db.prepare('PRAGMA integrity_check').get();
if (result.integrity_check !== 'ok') {
  console.error('Database corruption detected');
}
```

## Migration Guide

### Adding a New Table

1. Create migration in `database.ts`:
```typescript
{
  version: 7,
  description: 'Create new_table',
  up: `CREATE TABLE IF NOT EXISTS new_table (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  )`,
}
```

2. Run migration:
```bash
npm run build
npm start
```

### Adding a New Column

```typescript
{
  version: 8,
  description: 'Add column to activity_logs',
  up: `ALTER TABLE activity_logs ADD COLUMN category TEXT DEFAULT 'general'`,
}
```

### Removing a Column

SQLite doesn't support DROP COLUMN directly. Use:
```typescript
{
  version: 9,
  description: 'Remove column from activity_logs',
  up: `
    ALTER TABLE activity_logs RENAME TO activity_logs_old;
    CREATE TABLE activity_logs (id INTEGER PRIMARY KEY, ...);
    INSERT INTO activity_logs SELECT id, ... FROM activity_logs_old;
    DROP TABLE activity_logs_old;
  `,
}
```

## Troubleshooting

### Database Locked
```
Error: database is locked
```
**Cause**: Multiple processes accessing database
**Solution**: Ensure only one app instance running

### Corruption
```
Error: database disk image is malformed
```
**Cause**: Unexpected shutdown or disk error
**Solution**: Restore from backup or clear data

### Migration Failed
```
Error: migration version X failed
```
**Cause**: Migration script error
**Solution**: Check migration SQL syntax, rollback if needed

---

**Last Updated**: January 2026
