# ProduTime - Comprehensive Technical Documentation

## Table of Contents
1. [Project Overview](#project-overview)
2. [Architecture](#architecture)
3. [Key Features](#key-features)
4. [Database Schema](#database-schema)
5. [IPC Communication](#ipc-communication)
6. [Licensing System](#licensing-system)
7. [Activity Tracking](#activity-tracking)
8. [PDF Report Generation](#pdf-report-generation)
9. [Auto-Update System](#auto-update-system)
10. [Privacy Mode](#privacy-mode)
11. [System Tray Integration](#system-tray-integration)
12. [Auto-Export Scheduler](#auto-export-scheduler)
13. [Admin Authentication](#admin-authentication)
14. [Work Schedule Configuration](#work-schedule-configuration)
15. [Dependencies](#dependencies)

---

## Project Overview

**ProduTime** is an Electron-based time tracking application that monitors user activity and generates productivity reports. The application is built with:
- **Frontend**: React 19 + TypeScript
- **Backend**: Electron main process with Node.js
- **Database**: SQLite (better-sqlite3) with WAL mode
- **Build Tool**: Webpack + TypeScript
- **Licensing**: Custom Ed25519-based licensing system with server validation
- **Version**: 1.8.8

### Key Characteristics
- **Cross-platform**: Windows, macOS, Linux support
- **Offline-capable**: Works without internet connection (with grace period)
- **Privacy-focused**: Privacy mode sanitizes sensitive app window titles
- **Secure**: Hardware-specific database encryption, admin authentication with lockout
- **Automated**: Auto-export scheduler, auto-updater, background activity tracking

---

## Architecture

### High-Level Structure

```
ProduTime (Electron App)
├── Main Process (Node.js)
│   ├── Database Manager (SQLite)
│   ├── IPC Handlers (Request/Response)
│   ├── Services
│   │   ├── Activity Tracker (active-win)
│   │   ├── License Service (v1.8 Enhanced)
│   │   ├── Auto-Export Scheduler
│   │   ├── Email Service
│   │   ├── Device ID Service
│   │   └── Privacy Service
│   ├── PDF Generator (jsPDF + html2canvas)
│   ├── Auto-Updater (electron-updater + assisted fallback)
│   ├── System Tray Manager
│   └── Report Scheduler
├── Renderer Process (React)
│   ├── Activity Dashboard
│   ├── Settings Tab
│   ├── Admin Login Dialog
│   ├── License Activation Modal
│   └── Services
│       ├── IPC Service
│       ├── Admin Auth Service
│       ├── Admin Timeout Service
│       ├── PDF Report Service
│       └── Auto-Updater Service
└── Licensing Server (Separate Node.js/Fastify)
    ├── License Management API
    ├── Activation/Validation Endpoints
    ├── Admin Dashboard
    └── PostgreSQL Database
```

### Process Communication

**Main ↔ Renderer**: IPC (Electron ipcMain/ipcRenderer)
- Preload script exposes `window.electronAPI` and `window.api`
- Request/Response pattern with typed channels
- Event listeners for async updates (activity changed, update status, etc.)

**App ↔ Licensing Server**: HTTPS REST API
- Activation endpoint: `/v1/activate`
- Validation endpoint: `/v1/validate`
- Heartbeat endpoint: `/v1/heartbeat`
- Ed25519 signature verification

---

## Key Features

### 1. Activity Tracking
- **Real-time monitoring** of active window and application
- **Idle detection** using system power monitor
- **Stabilization sampling** to reduce transient mis-detections
- **Privacy-aware** sanitization of sensitive app titles
- **Database persistence** with timestamp, app name, window title, duration

### 2. Licensing System (v1.8)
- **Trial mode**: 7-day free trial
- **Activation**: Device-specific license binding
- **Offline grace period**: 72 hours without server contact
- **Heartbeat validation**: 12-hour check interval
- **Tamper detection**: Hardware fingerprint verification
- **Revocation support**: Server can revoke licenses

### 3. PDF Report Generation
- **Multiple formats**: Daily, Weekly, Monthly, Custom date ranges
- **Rich analytics**: Productivity metrics, hourly distribution, app breakdown
- **Charts**: Daily hours, hourly distribution, activity breakdown
- **Session details**: Start/end times, app usage, breaks
- **Privacy-aware**: Sanitizes sensitive app titles in reports

### 4. Auto-Update System
- **Dual mechanism**: electron-updater (primary) + assisted updater (fallback)
- **GitHub releases**: Fetches from GitHub API
- **Fallback URL**: Uses License Manager as backup source
- **Progress tracking**: Download progress with retry logic
- **Background checks**: 24-hour check interval

### 5. Admin Authentication
- **Password-protected settings**: Admin login required for sensitive changes
- **Lockout mechanism**: 5 failed attempts → 15-minute lockout
- **Session timeout**: 30-minute inactivity timeout
- **Activity detection**: Monitors admin activity to extend session
- **Audit logging**: Tracks login attempts

### 6. Privacy Mode
- **Sensitive app detection**: Slack, Teams, Discord, Gmail, etc.
- **Window title sanitization**: Replaces with app name only
- **Per-app configuration**: Customizable privacy app list
- **Report integration**: Privacy-aware PDF generation

---

## Database Schema

### Core Tables

**activity_logs**
```sql
CREATE TABLE activity_logs (
  id INTEGER PRIMARY KEY,
  timestamp TEXT NOT NULL,
  app_name TEXT NOT NULL,
  window_title TEXT NOT NULL,
  duration INTEGER NOT NULL
);
```

**settings**
```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

**analytics**
```sql
CREATE TABLE analytics (
  id INTEGER PRIMARY KEY,
  metric_name TEXT NOT NULL,
  metric_value REAL NOT NULL,
  recorded_at TEXT NOT NULL
);
```

**admin_lockout**
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

**admin_login_attempts**
```sql
CREATE TABLE admin_login_attempts (
  id INTEGER PRIMARY KEY,
  ip_address TEXT,
  attempted_at TEXT NOT NULL,
  success BOOLEAN NOT NULL
);
```

**license_activations**
```sql
CREATE TABLE license_activations (
  id INTEGER PRIMARY KEY,
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
```

### Key Settings

| Key | Type | Purpose |
|-----|------|---------|
| `work_schedule_start` | string (HH:MM) | Daily work start time |
| `work_schedule_end` | string (HH:MM) | Daily work end time |
| `work_schedule_weekly` | JSON | Per-weekday schedule |
| `export_folder` | string | PDF export destination |
| `auto_export_enabled` | boolean | Enable auto-export |
| `auto_export_time` | string (HH:MM) | Daily export time |
| `idle_threshold` | integer | Idle detection threshold (seconds) |
| `employee_name` | string | User name for reports |
| `admin_alert_email` | string | Admin notification email |
| `privacy_mode_enabled` | boolean | Enable privacy mode |
| `privacy_apps` | JSON | List of privacy-sensitive apps |

---

## IPC Communication

### Channel Architecture

All IPC communication uses typed channels defined in `src/shared/types.ts`:

```typescript
enum IPCChannels {
  // Activity
  GET_ACTIVITY_LOGS = 'activity:getLogs',
  INSERT_ACTIVITY_LOG = 'activity:insertLog',
  
  // Settings
  GET_SETTING = 'settings:get',
  SET_SETTING = 'settings:set',
  
  // Reports
  GENERATE_REPORT = 'reports:generate',
  
  // License
  ACTIVATE_LICENSE = 'license:activate',
  VALIDATE_ACTIVATION = 'license:validate',
  
  // Admin
  ADMIN_LOGIN = 'admin:login',
  
  // System Tray
  SHOW_TRAY_NOTIFICATION = 'tray:showNotification',
  
  // Auto-Updater
  CHECK_FOR_UPDATES = 'updater:checkForUpdates',
  
  // ... and more
}
```

### Request/Response Pattern

```typescript
interface IPCResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
```

### Event Listeners (Main → Renderer)

```typescript
// Activity changed
onActivityChanged: (callback: (activity: any) => void) => () => void

// Update status changed
onUpdateStatusChanged: (callback: (status: UpdateState) => void) => () => void

// License lockout
onLicenseLockout: (callback: (status: ActivationStatus) => void) => () => void

// Tray notifications
onTrayNotificationClicked: (callback: (notificationId: string) => void) => () => void
```

### Preload Script

The preload script (`src/main/preload.ts`) exposes two APIs:
- `window.electronAPI`: Full IPC API for all features
- `window.api`: Enhanced licensing API (v1.8)

---

## Licensing System

### Architecture

**Two-tier licensing system**:
1. **Legacy system**: Basic activation with device binding
2. **Enhanced system (v1.8)**: Trial mode, offline grace period, tamper detection

### License Payload Structure

```typescript
interface LicensePayload {
  ver?: number;              // Version
  lic?: string;              // License ID
  prod?: string;             // Product code (e.g., 'PT')
  act?: string;              // Activation URL
  exp?: number | null;       // Expiry timestamp (seconds)
  iat?: number;              // Issued-at timestamp (seconds)
  plan: 'basic' | 'pro' | 'enterprise' | 'trial';
  seats?: number;
  metadata?: Record<string, any>;
  beacon?: string;           // Beacon URL for server recovery
}
```

### Activation Flow

1. **User enters license key** in activation modal
2. **Client sends activation request** to License Manager server
3. **Server verifies** license key signature and device binding
4. **Server returns activation certificate** (signed JWT)
5. **Client stores certificate** encrypted in database
6. **Client validates** certificate on startup and periodically

### Validation Intervals

- **Local check**: Every 30 seconds (catch trial expiry)
- **Server check**: Every 30 minutes (detect revocation)
- **Grace period**: 72 hours offline before blocking
- **Heartbeat**: 12-hour validation interval

### Trial Mode

- **Duration**: 7 days
- **Activation**: Automatic on first launch
- **Expiry**: Blocks app after 7 days unless activated
- **Offline**: Works offline during trial period

---

## Activity Tracking

### Tracking Mechanism

**Main process** (`src/main/services/activity-tracker.ts`):
1. Polls active window every 500ms using `active-win` library
2. Detects app name and window title
3. Applies privacy sanitization if enabled
4. Detects idle state using system power monitor
5. Stores activity logs in database

### Idle Detection

- **Threshold**: Configurable (default 300 seconds)
- **Mechanism**: System power monitor + user input detection
- **Cooldown**: Prevents rapid idle/active switching

### Privacy Sanitization

Default privacy apps:
- Communication: Slack, Teams, Discord, WhatsApp, Telegram, Signal, Zoom, Skype
- Email: Outlook, Gmail, Mail
- Messaging: Messages, Messenger, WeChat, LINE, Viber

When privacy mode enabled:
- Window title replaced with app name only
- Prevents sensitive conversation details in reports

### Activity Log Structure

```typescript
interface ActivityLog {
  id?: number;
  timestamp: string;        // ISO 8601
  app_name: string;         // e.g., "Visual Studio Code"
  window_title: string;     // e.g., "main.ts - ProduTime"
  duration: number;         // seconds
}
```

---

## PDF Report Generation

### Report Types

- **Daily**: Single day report
- **Weekly**: 7-day report
- **Monthly**: 30-day report
- **Custom**: User-specified date range

### Report Contents

1. **Summary**
   - Total hours tracked
   - Total sessions
   - Average session length
   - Most active day/hour

2. **Charts**
   - Daily hours (bar chart)
   - Hourly distribution (line chart)
   - Activity breakdown (pie chart)

3. **Details**
   - Session-by-session breakdown
   - App usage per session
   - Break times

4. **Productivity Metrics**
   - Productivity score
   - Focus score
   - Distraction time
   - Context switches

### Generation Process

1. **Fetch data** from database for date range
2. **Calculate metrics** (hours, sessions, averages)
3. **Generate charts** using chart-generator utility
4. **Render HTML** with activity data
5. **Convert to PDF** using html2canvas + jsPDF
6. **Save to export folder** or email

### Privacy Integration

- Sanitizes app names/titles if privacy mode enabled
- Removes sensitive conversation details
- Maintains accurate time tracking

---

## Auto-Update System

### Dual Update Mechanism

**Primary**: electron-updater
- Fetches from GitHub releases
- Automatic download and install
- Supports staged rollouts

**Fallback**: Assisted updater
- Uses License Manager as backup source
- Manual download and install
- Fallback when GitHub unavailable

### Update Flow

1. **Check for updates** (24-hour interval)
2. **Compare versions** with latest release
3. **Download** if newer version available
4. **Verify checksum** (SHA256)
5. **Install** on next app restart
6. **Notify user** of update status

### Configuration

```typescript
const UPDATE_CHECK_CONFIG = {
  API_TIMEOUT_MS: 30000,           // 30 seconds
  DOWNLOAD_TIMEOUT_MS: 600000,     // 10 minutes
  PROGRESS_TIMEOUT_MS: 60000,      // 60 seconds
  MAX_RETRIES: 3,
  RETRY_DELAYS_MS: [1000, 2000, 5000],
  BACKGROUND_CHECK_INTERVAL_MS: 24 * 60 * 60 * 1000,
  STARTUP_CHECK_DELAY_MS: 30000,
};
```

### Update Status Events

```typescript
enum UpdateStatus {
  CHECKING = 'checking-for-update',
  AVAILABLE = 'update-available',
  NOT_AVAILABLE = 'update-not-available',
  DOWNLOADING = 'download-progress',
  DOWNLOADED = 'update-downloaded',
  ERROR = 'error',
}
```

---

## Privacy Mode

### Feature Overview

Privacy mode sanitizes window titles for sensitive applications to protect user privacy in reports and screenshots.

### Implementation

**Privacy Constants** (`src/main/services/privacy-constants.ts`):
```typescript
export const DEFAULT_PRIVACY_APPS: string[] = [
  'Slack', 'Microsoft Teams', 'Discord', 'WhatsApp',
  'Telegram', 'Signal', 'Zoom', 'Skype', 'Messages',
  'Mail', 'Outlook', 'Gmail', 'Messenger', 'WeChat',
  'LINE', 'Viber'
];
```

### Sanitization Process

1. **Check if privacy mode enabled** in settings
2. **Get privacy apps list** from database
3. **For each activity log**:
   - Check if app name matches privacy app
   - If match: replace window title with app name only
   - If no match: keep original title

### Integration Points

- **Activity tracking**: Sanitizes on insert
- **PDF reports**: Sanitizes before rendering
- **Auto-export**: Sanitizes exported data
- **Dashboard**: Sanitizes displayed activities

### Configuration

Users can:
- Enable/disable privacy mode
- Add/remove apps from privacy list
- View which apps are privacy-protected

---

## System Tray Integration

### Tray Features

1. **Quick access** to app from system tray
2. **Status indicator** (tracking active/inactive)
3. **Notifications** for events (export complete, update available)
4. **Context menu** with actions (show/hide, quit, etc.)

### Tray State

```typescript
interface TrayState {
  isVisible: boolean;
  isTrackingActive: boolean;
  lastActivity?: string;
  unreadNotifications: number;
}
```

### Notification Types

```typescript
enum TrayNotificationType {
  INFO = 'info',
  SUCCESS = 'success',
  WARNING = 'warning',
  ERROR = 'error',
}
```

### Tray Menu Actions

- **Show/Hide**: Toggle window visibility
- **Start/Stop**: Control activity tracking
- **Settings**: Open settings tab
- **Reports**: Generate report
- **Quit**: Exit application

---

## Auto-Export Scheduler

### Purpose

Automatically generates and exports PDF reports at scheduled times.

### Configuration

- **Enabled**: Toggle auto-export on/off
- **Time**: Daily export time (HH:MM format)
- **Folder**: Export destination folder
- **Email**: Optional email notification

### Execution Flow

1. **Calculate next run time** based on configured time
2. **Wait until scheduled time**
3. **Generate report** for previous day
4. **Save to export folder**
5. **Send email notification** (if configured)
6. **Reschedule** for next day

### Error Handling

- **Retry logic**: Up to 3 attempts with backoff
- **Admin notification**: Email on repeated failures
- **Graceful degradation**: Continues even if email fails

### Privacy Integration

- Sanitizes activity logs if privacy mode enabled
- Removes sensitive app titles from exported reports

---

## Admin Authentication

### Purpose

Protects sensitive settings (work schedule, export folder, admin password) from unauthorized changes.

### Authentication Flow

1. **User clicks "Settings"** tab
2. **Admin login dialog** appears
3. **User enters password**
4. **Main process validates** against stored hash
5. **On success**: Session token created, timeout started
6. **On failure**: Attempt counter incremented

### Lockout Mechanism

- **Failed attempts**: 5 attempts trigger lockout
- **Lockout duration**: 15 minutes
- **Tracking**: IP address and timestamp logged
- **Reset**: Admin can manually reset lockout

### Session Management

- **Timeout**: 30 minutes of inactivity
- **Activity detection**: Monitors mouse/keyboard in settings
- **Warning**: 5-minute warning before timeout
- **Extension**: Activity extends session

### Implementation

**Renderer services**:
- `AdminAuthService`: Login and session management
- `AdminTimeoutService`: Timeout tracking
- `AdminActivityDetector`: Activity monitoring

**Main process**:
- Password hashing (bcrypt)
- Lockout state management
- Audit logging

---

## Work Schedule Configuration

### Purpose

Define working hours for accurate productivity tracking and report generation.

### Schedule Types

**1. Flat Schedule** (Legacy)
```typescript
{
  work_schedule_start: "09:00",
  work_schedule_end: "17:00"
}
```

**2. Weekly Schedule** (New)
```typescript
{
  work_schedule_weekly: {
    monday: { start: "09:00", end: "17:00", nonWorking: false },
    tuesday: { start: "09:00", end: "17:00", nonWorking: false },
    // ... etc
    saturday: { start: "00:00", end: "00:00", nonWorking: true },
    sunday: { start: "00:00", end: "00:00", nonWorking: true }
  }
}
```

### Features

- **Per-weekday configuration**: Different hours for each day
- **Non-working days**: Mark weekends/holidays
- **Overnight shifts**: Support for shifts crossing midnight
- **Backward compatibility**: Flat schedule still supported

### Usage in Reports

- **Scheduled hours**: Calculate expected work hours
- **Efficiency**: Compare actual vs. scheduled hours
- **Productivity**: Adjust metrics based on schedule
- **Alerts**: Warn if tracking outside scheduled hours

### API

```typescript
interface WorkScheduleForDay {
  start: string;           // HH:MM
  end: string;             // HH:MM
  nonWorking: boolean;
  overnight: boolean;
  source: 'weekly' | 'flat' | 'default';
}

// Get schedule for specific date
getWorkScheduleForDay(dateISO: string): Promise<WorkScheduleForDay>
```

---

## Dependencies

### Core Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `electron` | ^37.10.0 | Desktop app framework |
| `react` | ^19.1.1 | UI framework |
| `typescript` | ^5.9.2 | Type safety |
| `better-sqlite3` | ^12.2.0 | Database |
| `electron-updater` | ^6.6.2 | Auto-updates |
| `jspdf` | ^3.0.2 | PDF generation |
| `html2canvas` | ^1.4.1 | HTML to image |
| `active-win` | ^8.2.1 | Active window detection |
| `tweetnacl` | ^1.0.3 | Ed25519 signatures |
| `nodemailer` | ^7.0.5 | Email notifications |
| `node-machine-id` | ^1.1.12 | Device fingerprinting |

### Dev Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `webpack` | ^5.101.3 | Module bundler |
| `jest` | ^29.7.0 | Testing framework |
| `eslint` | ^9.34.0 | Code linting |
| `prettier` | ^3.6.2 | Code formatting |
| `ts-jest` | ^29.4.1 | TypeScript testing |
| `electron-builder` | ^26.0.12 | App packaging |

### Licensing Server Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `fastify` | Latest | Web framework |
| `prisma` | Latest | ORM |
| `postgresql` | Latest | Database |
| `tweetnacl` | ^1.0.3 | Ed25519 signatures |
| `bcrypt` | Latest | Password hashing |
| `jsonwebtoken` | Latest | JWT auth |

---

## Development Workflow

### Build Process

```bash
# Development build
npm run build:safe

# Production build
npm run dist:x64

# Watch mode
npm run build:renderer -- --watch
```

### Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage
```

### Linting & Formatting

```bash
# Lint
npm run lint

# Fix linting issues
npm run lint:fix

# Format code
npm run format
```

### Running Locally

```bash
# Start development app
npm start

# Start with silent mode
npm run start:silent

# Test local build
npm run test:produtime
```

---

## Key Files Reference

### Main Process
- `src/main/main.ts` - App entry point
- `src/main/ipc-handlers.ts` - IPC request handlers
- `src/main/database.ts` - Database manager
- `src/main/services/activity-tracker.ts` - Activity tracking
- `src/main/services/license-service.ts` - License management
- `src/main/pdf-generator.ts` - PDF generation
- `src/main/auto-updater.ts` - Update management
- `src/main/system-tray.ts` - Tray integration

### Renderer Process
- `src/renderer/App.tsx` - Main React component
- `src/renderer/components/ActivityDashboard.tsx` - Dashboard UI
- `src/renderer/components/SettingsTab.tsx` - Settings UI
- `src/renderer/services/ipc-service.ts` - IPC wrapper
- `src/renderer/services/admin-auth-service.ts` - Admin auth

### Shared
- `src/shared/types.ts` - Type definitions
- `src/shared/licensing-config.ts` - Licensing config

### Licensing Server
- `licensing-server/api/src/index.ts` - Server entry
- `licensing-server/api/src/routes/app.ts` - Activation/validation
- `licensing-server/api/src/routes/licenses.ts` - License management
- `licensing-server/api/prisma/schema.prisma` - Database schema

---

## Troubleshooting Guide

### Common Issues

**1. Database locked error**
- Cause: Multiple processes accessing database
- Solution: Ensure only one app instance running

**2. License validation fails**
- Cause: Server unreachable or invalid key
- Solution: Check internet connection, verify license key

**3. Activity tracking not working**
- Cause: active-win library not available
- Solution: Rebuild native modules: `npm rebuild`

**4. PDF generation fails**
- Cause: Missing fonts or rendering issues
- Solution: Check export folder permissions

**5. Auto-update fails**
- Cause: GitHub API rate limit or network issue
- Solution: Check internet connection, try manual update

---

## Security Considerations

1. **Database encryption**: Hardware-specific encryption key
2. **License verification**: Ed25519 signature verification
3. **Admin authentication**: Bcrypt password hashing
4. **Session management**: Timeout and activity detection
5. **Privacy mode**: Sanitizes sensitive data
6. **Audit logging**: Tracks admin actions
7. **Tamper detection**: Hardware fingerprint verification

---

## Performance Optimization

1. **Activity tracking**: Stabilization sampling reduces false positives
2. **Database**: WAL mode for better concurrency
3. **PDF generation**: Async processing with progress tracking
4. **Auto-updater**: Background checks with configurable intervals
5. **IPC**: Batched updates to reduce overhead

---

## Future Enhancements

1. **Multi-device sync**: Sync data across devices
2. **Cloud backup**: Automatic backup to cloud storage
3. **Team analytics**: Aggregate team productivity metrics
4. **Advanced reporting**: Custom report templates
5. **Mobile app**: Companion mobile app for reports
6. **API**: Public API for integrations

---

## Contact & Support

For questions or issues:
- GitHub: https://github.com/georgekgr12/timeport
- Issues: https://github.com/georgekgr12/timeport/issues

---

**Last Updated**: January 2026
**Version**: 1.8.8
