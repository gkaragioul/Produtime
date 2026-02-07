# ProduTime - Developer Onboarding Guide

**Version**: 1.8.8 | **Last Updated**: January 2026

---

## Quick Overview

ProduTime is an Electron-based time tracking application that monitors user activity and generates productivity reports.

**Tech Stack**:
- **Frontend**: React 19 + TypeScript
- **Backend**: Electron main process (Node.js)
- **Database**: SQLite (better-sqlite3) with WAL mode
- **Build**: Webpack + TypeScript + electron-builder
- **Licensing**: Custom Ed25519-based system with server validation

---

## Getting Started

```bash
# Clone and install
git clone https://github.com/georgekgr12/timeport.git
cd timeport
npm install

# Build
npm run build:safe

# Run
npm start
```

---

## Project Structure

```
src/
├── main/                          # Electron main process
│   ├── main.ts                   # App entry point
│   ├── ipc-handlers.ts           # IPC request handlers (2000+ lines)
│   ├── database.ts               # SQLite database manager
│   ├── preload.ts                # Preload script (IPC bridge)
│   ├── services/
│   │   ├── activity-tracker.ts   # Window activity monitoring
│   │   ├── license-service.ts    # License validation
│   │   ├── auto-export-scheduler.ts
│   │   ├── privacy-constants.ts
│   │   └── licensing/
│   │       └── EnhancedLicenseService.ts  # v1.8 licensing
│   ├── pdf-generator.ts          # PDF report generation
│   ├── auto-updater.ts           # electron-updater integration
│   ├── assisted-updater.ts       # Fallback updater (GitHub releases)
│   └── system-tray.ts            # System tray integration
├── renderer/                      # React UI
│   ├── App.tsx                   # Main component with routing
│   ├── components/
│   │   ├── ActivityDashboard.tsx # Main dashboard (1400+ lines)
│   │   ├── SettingsTab.tsx       # Settings panel
│   │   ├── AdminLoginDialog.tsx  # Admin authentication
│   │   └── licensing/
│   │       └── LicensingGate.tsx # License activation modal
│   └── services/
│       ├── admin-auth-service.ts
│       └── pdf-report-service.ts
├── shared/
│   ├── types.ts                  # Shared TypeScript types
│   └── licensing-config.ts       # License server URLs
└── types/                         # Additional type definitions

licensing-server/                  # Separate licensing server (Railway)
├── api/
│   ├── src/
│   │   ├── index.ts              # Fastify server
│   │   ├── routes/
│   │   │   ├── app.ts            # Activation/validation endpoints
│   │   │   ├── licenses.ts       # License CRUD
│   │   │   └── auth.ts           # Admin authentication
│   │   └── utils/
│   │       └── crypto.ts         # Ed25519 signatures
│   └── prisma/
│       └── schema.prisma         # PostgreSQL schema
└── admin/                         # Admin dashboard (React)
```

---

## Key Features

### 1. Activity Tracking
- Polls active window every 500ms using `active-win` library
- Detects idle state via system power monitor
- Privacy mode sanitizes sensitive app titles (Slack, Teams, etc.)
- Stores in SQLite: `activity_logs` table

### 2. Licensing System (v1.8)
- **Trial**: 7-day free trial, works offline
- **Activation**: Device-specific binding via hardware fingerprint
- **Validation**: Local (30s) + Server (30min) checks
- **Grace Period**: 72 hours offline before lockout
- **Signature**: Ed25519 verification

### 3. PDF Reports
- Daily/Weekly/Monthly/Custom date ranges
- Charts: hourly distribution, app breakdown
- Privacy-aware: sanitizes titles if enabled
- Auto-export scheduler at configurable time

### 4. Auto-Update
- **Primary**: electron-updater from GitHub releases
- **Fallback**: Assisted updater from `latest.json` manifest
- Background checks every 24 hours

### 5. Admin Authentication
- Password-protected settings
- Lockout: 5 failed attempts → 15 min lockout
- Session timeout: 30 min inactivity

### 6. Privacy Mode
- Sanitizes window titles for: Slack, Teams, Discord, WhatsApp, Telegram, Signal, Zoom, Skype, Outlook, Gmail, etc.
- Configurable app list in settings

---

## Database Schema

**Location**: `%APPDATA%/produtime/produtime_<hash>.db`

| Table | Purpose |
|-------|---------|
| `activity_logs` | User activity (timestamp, app, title, duration) |
| `settings` | Key-value configuration |
| `analytics` | Productivity metrics |
| `admin_lockout` | Admin lockout state |
| `admin_login_attempts` | Audit log |
| `license_activations` | License data |
| `license_state` | v1.8 license state |

**Key Settings**:
- `work_schedule_start/end` - Work hours
- `work_schedule_weekly` - Per-day schedule (JSON)
- `idle_threshold` - Idle detection (seconds)
- `privacy_mode_enabled` - Privacy toggle
- `privacy_apps` - Privacy app list (JSON)
- `auto_export_enabled/time` - Auto-export config

---

## IPC Communication

**Pattern**: Request/Response with typed channels

```typescript
// Renderer → Main
const response = await window.electronAPI.getActivityLogs({ limit: 100 });

// Main handler (ipc-handlers.ts)
ipcMain.handle('activity:getLogs', async (event, request) => {
  return { success: true, data: logs };
});
```

**Key Channels** (defined in `src/shared/types.ts`):
- `activity:*` - Activity logs CRUD
- `settings:*` - Settings CRUD
- `reports:*` - PDF generation
- `license:*` - License management
- `admin:*` - Admin authentication
- `tray:*` - System tray
- `updater:*` - Auto-update

**Event Listeners** (Main → Renderer):
- `onActivityChanged` - Real-time activity updates
- `onUpdateStatusChanged` - Update progress
- `onLicenseLockout` - License revocation

---

## Common Development Tasks

### Add New IPC Handler

1. Define types in `src/shared/types.ts`
2. Add channel to `IPCChannels` enum
3. Implement handler in `src/main/ipc-handlers.ts`
4. Expose in `src/main/preload.ts`
5. Use in renderer via `window.electronAPI`

### Add New Setting

1. Add default in `database.ts` migrations
2. Add getter/setter if needed
3. Expose via IPC
4. Add UI in `SettingsTab.tsx`

### Modify Activity Dashboard

Main file: `src/renderer/components/ActivityDashboard.tsx`
- `fetchTodaysLogs()` - Fetches all logs for current day
- `metrics` useMemo - Calculates active/idle time
- `displayActivities` - Filtered activity list

---

## Build & Release

```bash
# Development build
npm run build:safe

# Production build with installer
npm run dist:x64

# Output: build-output/ProduTime-Setup-x.x.x-x64.exe
```

### Release Process

1. Update version in `package.json`
2. Build: `npm run build:safe`
3. Update `latest.json` with new version, SHA256, file size
4. Push to GitHub releases repo
5. Upload installer + `ProduTime-Setup-Latest-x64.exe`

---

## Testing

```bash
npm test                    # Run all tests
npm run test:watch         # Watch mode
npm run test:coverage      # Coverage report
```

Test files: `src/**/__tests__/*.test.ts`

---

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `electron` ^37.10.0 | Desktop framework |
| `react` ^19.1.1 | UI framework |
| `better-sqlite3` ^12.2.0 | SQLite database |
| `active-win` ^8.2.1 | Active window detection |
| `electron-updater` ^6.6.2 | Auto-updates |
| `jspdf` ^3.0.2 | PDF generation |
| `tweetnacl` ^1.0.3 | Ed25519 signatures |
| `node-machine-id` ^1.1.12 | Device fingerprinting |

---

## Environment Variables

```bash
# Development
NODE_ENV=development

# Production (licensing)
ED25519_PUBLIC_KEY=<public-key>
LICENSE_SERVER_URL=https://produtime-licensing-server-production.up.railway.app
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Database locked | Ensure single app instance |
| Active window not detected | `npm rebuild` |
| License validation fails | Check internet, verify key |
| PDF generation fails | Check export folder permissions |

---

## Additional Documentation

- `TECHNICAL_DOCUMENTATION.md` - Detailed architecture
- `DATABASE_SCHEMA_REFERENCE.md` - Full schema docs
- `LICENSING_SYSTEM_GUIDE.md` - Licensing deep-dive
- `QUICK_START_GUIDE.md` - Quick reference

---

## Contact

- GitHub: https://github.com/georgekgr12/timeport
- Releases: https://github.com/georgekgr12/produtime-releases
