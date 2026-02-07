# ProduTime

A desktop time-tracking and productivity monitoring suite built with Electron, React, and TypeScript. Includes a main tracking app, an admin console for device management, a licensing server, and a cloud admin dashboard.

## Components

| Component | Path | Stack | Description |
|-----------|------|-------|-------------|
| **ProduTime App** | `/src` | Electron + React + TypeScript | Desktop app that tracks active windows, idle time, and generates productivity reports |
| **Admin Console** | `/admin-console` | Electron + React + TypeScript | Standalone desktop app for managing and monitoring ProduTime devices |
| **Licensing Server** | `/licensing-server` | Fastify + Prisma + PostgreSQL | Handles license activation, seat enforcement, heartbeat verification, and revocation |
| **Cloud Admin API** | `/cloud-admin-api` | Node.js + Fastify | Multi-tenant cloud backend for remote device management |
| **Cloud Admin Web** | `/cloud-admin-web` | Vite + React | Web dashboard frontend for the cloud admin API |

## Architecture

```
ProduTime App (Electron)
  Main Process
    SQLite (better-sqlite3, WAL mode)
    Activity Tracker (window titles, idle detection)
    PDF Report Generator (html2canvas + jsPDF)
    Auto Export Scheduler
    Licensing Client (Ed25519 signature verification)
    System Tray Integration
    Auto Updater (SHA256 verified downloads)
  Renderer Process
    React UI (Dashboard, Settings, Reports, License Activation)

Admin Console (Electron)
  WebSocket server for agent pairing
  Real-time device monitoring
  Policy deployment
  Audit logging

Licensing Server (Fastify)
  PostgreSQL (Prisma ORM)
  Ed25519 key signing
  Seat enforcement & machine binding
  Heartbeat & revocation checks
  JWT authentication
```

## Key Features

- **Activity Tracking** - Monitors active window titles, keyboard/mouse activity, and idle periods
- **Productivity Reports** - Generates PDF reports with daily/weekly/monthly breakdowns
- **Privacy Mode** - Sanitizes window titles for sensitive applications (configurable)
- **Auto Export** - Scheduled automatic report generation and export
- **Licensing** - 7-day trial with offline support, Ed25519 cryptographic license validation, seat enforcement, revocation detection with 72-hour grace period
- **Admin Console** - Centralized management with device pairing, policy deployment, and real-time monitoring
- **Auto Updates** - In-app updates with SHA256 checksum verification
- **Startup Integration** - Windows auto-start via registry and startup folder shortcuts

## Security

- **No hardcoded credentials** - Admin passwords are generated with `crypto.randomBytes` and stored as scrypt hashes with timing-safe comparison
- **Command injection prevention** - All shell commands use `spawn` with argument arrays instead of `exec` with string interpolation
- **Path traversal protection** - Report save paths validated against an allowlist of safe directories
- **AES-256-GCM encryption** - Secure fallback when Electron's safeStorage is unavailable (replaces insecure base64)
- **Random salts** - Registry encryption uses random salts with backward-compatible decryption
- **TOCTOU prevention** - Atomic `INSERT OR IGNORE` for lockout state initialization
- **HTTPS enforcement** - All license server communication uses HTTPS
- **Input validation** - Date parsing, time format validation, JSON structure checks throughout

## Development

### Prerequisites

- Node.js 18+
- npm 9+
- Windows 10+ (for activity tracking native modules)

### Setup

```bash
npm install
```

### Run

```bash
# Main app (development)
npm run dev

# Main app (production mode)
npm start

# Admin console
cd admin-console && npm run dev

# Licensing server
cd licensing-server/api && npm run dev
```

### Build

```bash
# Build main app
npm run build

# Build admin console
cd admin-console && npm run build

# Package for distribution
npm run package
```

### Test

```bash
# Run all tests
npm test

# Type checking
npx tsc --noEmit
```

## Database

SQLite with WAL mode via `better-sqlite3`. Schema is managed through versioned migrations in `database.ts` (currently at migration version 10). Performance indexes on `settings(key)`, `analytics(recorded_at)`, and `admin_login_attempts(attempted_at, success)`.

## License

Proprietary - See [LICENSE.txt](LICENSE.txt)
