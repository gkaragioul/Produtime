# ProduTime Complete Technical Guide

## For New Developers - January 2026

This document provides a comprehensive overview of the ProduTime ecosystem, including the main application, Admin Console, and Licensing Server.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture](#2-architecture)
3. [ProduTime Client App](#3-produtime-client-app)
4. [Admin Console](#4-admin-console)
5. [Licensing Server](#5-licensing-server)
6. [Communication Protocols](#6-communication-protocols)
7. [Database Schemas](#7-database-schemas)
8. [Security & Cryptography](#8-security--cryptography)
9. [Development Workflow](#9-development-workflow)
10. [Deployment](#10-deployment)

---

## 1. System Overview

### What is ProduTime?

ProduTime is an enterprise time-tracking and productivity monitoring solution consisting of three main components:

| Component | Purpose | Technology |
|-----------|---------|------------|
| **ProduTime Client** | Desktop app for end-users to track their activity | Electron + React + TypeScript |
| **Admin Console** | Desktop app for administrators to manage devices | Electron + React + TypeScript |
| **Licensing Server** | Cloud API for license management and validation | Node.js + Fastify + PostgreSQL |

### Key Features

- **Activity Tracking**: Monitors active windows and applications
- **Privacy Mode**: Sanitizes sensitive app titles (Slack, Teams, etc.)
- **PDF Reports**: Generates daily/weekly/monthly productivity reports
- **Licensing**: 7-day trial, device-specific activation, offline grace period
- **Admin Management**: Centralized policy management, device control
- **Auto-Updates**: Automatic updates via GitHub releases


---

## 2. Architecture

### High-Level System Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              PRODUTIME ECOSYSTEM                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────┐     ┌──────────────────────┐                      │
│  │  ProduTime Client    │     │   Admin Console      │                      │
│  │  (End-User Desktop)  │     │   (Admin Desktop)    │                      │
│  │                      │     │                      │                      │
│  │  • Activity Tracking │     │  • Device Management │                      │
│  │  • PDF Reports       │     │  • Policy Control    │                      │
│  │  • Privacy Mode      │     │  • Real-time Stats   │                      │
│  │  • Auto-Updates      │     │  • Pairing Inbox     │                      │
│  └──────────┬───────────┘     └──────────┬───────────┘                      │
│             │                            │                                   │
│             │  WebSocket (LAN/Cloud)     │                                   │
│             └────────────┬───────────────┘                                   │
│                          │                                                   │
│                          ▼                                                   │
│             ┌────────────────────────┐                                       │
│             │   Licensing Server     │                                       │
│             │   (Cloud - Railway)    │                                       │
│             │                        │                                       │
│             │  • License Activation  │                                       │
│             │  • Heartbeat Validation│                                       │
│             │  • Revocation Checks   │                                       │
│             │  • Admin Dashboard     │                                       │
│             └────────────────────────┘                                       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Technology Stack

| Layer | Technology | Version |
|-------|------------|---------|
| Desktop Framework | Electron | 37.10.0 |
| UI Framework | React | 19.1.1 |
| Language | TypeScript | 5.9.2 |
| Database (Client) | SQLite (better-sqlite3) | 12.2.0 |
| Database (Server) | PostgreSQL | Latest |
| ORM (Server) | Prisma | Latest |
| Web Framework (Server) | Fastify | Latest |
| Cryptography | TweetNaCl (Ed25519) | 1.0.3 |
| PDF Generation | jsPDF + html2canvas | 3.0.2 / 1.4.1 |
| Auto-Updates | electron-updater | 6.6.2 |


---

## 3. ProduTime Client App

### 3.1 Project Structure

```
src/
├── main/                              # Electron main process
│   ├── main.ts                       # App entry point
│   ├── ipc-handlers.ts               # IPC request handlers (2400+ lines)
│   ├── database.ts                   # SQLite database manager
│   ├── preload.ts                    # Preload script (IPC bridge)
│   ├── pdf-generator.ts              # PDF report generation
│   ├── auto-updater.ts               # Update management
│   ├── assisted-updater.ts           # Fallback updater
│   ├── system-tray.ts                # System tray integration
│   └── services/
│       ├── activity-tracker.ts       # Window activity monitoring
│       ├── license-service.ts        # Legacy license service
│       ├── auto-export-scheduler.ts  # Scheduled PDF exports
│       ├── email-service.ts          # Email notifications
│       ├── device-id-service.ts      # Hardware fingerprinting
│       ├── privacy-constants.ts      # Privacy app list
│       ├── licensing/
│       │   ├── EnhancedLicenseService.ts  # v1.8 licensing
│       │   ├── machineFingerprint.ts      # Hardware ID
│       │   ├── tamperDetection.ts         # Tamper detection
│       │   └── secureStore.ts             # Encrypted storage
│       └── agent/
│           ├── agent-service.ts      # Admin Console connection
│           ├── crypto.ts             # Ed25519 signatures
│           ├── discovery.ts          # mDNS discovery
│           └── metrics-computer.ts   # Stats computation
├── renderer/                          # React UI
│   ├── App.tsx                       # Main component
│   ├── index.tsx                     # React entry point
│   ├── styles.css                    # Global styles
│   ├── components/
│   │   ├── DailyPerformanceConsole.tsx  # Main dashboard
│   │   ├── SettingsTab.tsx              # Settings panel
│   │   ├── AdminLoginDialog.tsx         # Admin authentication
│   │   ├── PairingModal.tsx             # Admin Console pairing
│   │   ├── PolicyView.tsx               # Policy display
│   │   ├── ManagedBadge.tsx             # "Managed by" indicator
│   │   └── licensing/
│   │       └── LicensingGate.tsx        # License activation modal
│   └── services/
│       ├── ipc-service.ts            # IPC wrapper
│       ├── admin-auth-service.ts     # Admin authentication
│       ├── admin-timeout-service.ts  # Session timeout
│       └── pdf-report-service.ts     # Report generation
└── shared/
    ├── types.ts                      # Shared TypeScript types
    ├── licensing-config.ts           # License server config
    ├── admin-protocol.ts             # Admin Console protocol
    └── dashboard-types.ts            # Dashboard data types
```

### 3.2 Key Features

#### Activity Tracking

The activity tracker monitors the active window every 500ms using the `active-win` library:

```typescript
// src/main/services/activity-tracker.ts
class ActivityTracker {
  private pollInterval = 500; // ms
  
  async trackActivity() {
    const activeWindow = await activeWin();
    if (activeWindow) {
      const sanitizedTitle = this.sanitizeTitle(activeWindow);
      this.database.insertActivityLog({
        timestamp: new Date().toISOString(),
        app_name: activeWindow.owner.name,
        window_title: sanitizedTitle,
        duration: this.pollInterval / 1000,
      });
    }
  }
}
```

#### Privacy Mode

When enabled, sensitive app titles are replaced with just the app name:

```typescript
// Default privacy apps
const DEFAULT_PRIVACY_APPS = [
  'Slack', 'Microsoft Teams', 'Discord', 'WhatsApp',
  'Telegram', 'Signal', 'Zoom', 'Skype', 'Messages',
  'Mail', 'Outlook', 'Gmail', 'Messenger'
];

// Sanitization: "John Doe - Slack" → "Slack"
```

#### Licensing System (v1.8)

Three license modes:
- **TRIAL**: 7-day free trial, no server contact required
- **ACTIVATED**: Device-specific license binding with heartbeat validation
- **LOCKED**: License expired, revoked, or tampered

```typescript
// License validation intervals
LOCAL_CHECK_INTERVAL_MS = 30 * 1000;      // 30 seconds
SERVER_CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
GRACE_PERIOD_HOURS = 72;                   // Offline grace period
HEARTBEAT_INTERVAL_HOURS = 12;             // Server heartbeat
REVOCATION_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
```


### 3.3 IPC Communication

All communication between main and renderer processes uses typed IPC channels:

```typescript
// src/shared/types.ts
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
  START_TRIAL = 'license:startTrial',
  
  // Admin
  ADMIN_LOGIN = 'admin:login',
  
  // Agent (Admin Console)
  AGENT_GET_STATE = 'agent:getState',
  AGENT_START_PAIRING = 'agent:startPairing',
}

// Response wrapper
interface IPCResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
```

**Preload Script** exposes two APIs:
- `window.electronAPI`: Full IPC API for all features
- `window.api`: Enhanced licensing API (v1.8)

### 3.4 Build Commands

```bash
# Development
npm run build:main          # Compile TypeScript (main process)
npm run build:renderer      # Bundle React (webpack)
npm run build:safe          # Full safe build with validation
npm start                   # Run the app

# Production
npm run dist:x64            # Build Windows x64 installer
npm run package:produtime   # Package for distribution

# Testing
npm test                    # Run Jest tests
npm run test:watch          # Watch mode
npm run test:coverage       # Coverage report
```


---

## 4. Admin Console

### 4.1 Overview

The Admin Console is a separate Electron app that allows administrators to:
- Manage multiple ProduTime client devices
- Push policies (work schedules, privacy settings)
- View real-time activity statistics
- Lock/unlock devices remotely
- Generate reports across all devices

### 4.2 Project Structure

```
admin-console/
├── src/
│   ├── main/
│   │   ├── main.ts                   # App entry point
│   │   ├── preload.ts                # Preload script
│   │   ├── db.ts                     # SQLite database
│   │   ├── server.ts                 # WebSocket server (port 17888)
│   │   ├── licensing-service.ts      # Admin Console licensing
│   │   ├── registry-service.ts       # Windows Registry for trial
│   │   ├── dashboard-service.ts      # Dashboard data aggregation
│   │   ├── device-detail-service.ts  # Device detail views
│   │   └── performance-service.ts    # Performance metrics
│   ├── renderer/
│   │   ├── App.tsx                   # Main component
│   │   └── components/
│   │       ├── Dashboard.tsx         # Main dashboard
│   │       ├── DeviceList.tsx        # Device management
│   │       ├── DeviceDetail.tsx      # Device details
│   │       ├── PolicyManager.tsx     # Policy management
│   │       ├── PairingInbox.tsx      # Pairing requests
│   │       ├── LogViewer.tsx         # Server logs
│   │       ├── LicenseGate.tsx       # License activation
│   │       └── AppCategorization.tsx # App categorization
│   └── shared/
│       └── dashboard-types.ts        # Dashboard data types
├── package.json
├── tsconfig.json
└── webpack.config.js
```

### 4.3 Key Features

#### Device Pairing

1. Admin generates a 6-digit pair code
2. User enters code in ProduTime client
3. Admin approves/denies pairing request
4. Devices communicate via WebSocket

```typescript
// Pairing flow
Admin Console                    ProduTime Client
     │                                │
     │  Generate pair code            │
     │  (e.g., 123456)                │
     │                                │
     │                                │  User enters code
     │                                │
     │  ◄─── PAIR_REQUEST ────────────│
     │                                │
     │  Admin clicks "Approve"        │
     │                                │
     │  ──── PAIR_APPROVED ──────────►│
     │                                │
     │  ◄─── HEARTBEAT ───────────────│
     │  ◄─── STATS_SUMMARY ───────────│
```

#### Policy Management

Policies control client behavior:

```typescript
interface PolicyData {
  version: string;
  updatedAt: number;
  
  // Work schedule
  workScheduleStart: string;      // "09:00"
  workScheduleEnd: string;        // "17:00"
  workScheduleWeekly?: Record<string, DaySchedule>;
  
  // Tracking settings
  idleThreshold: number;          // seconds
  
  // Privacy settings
  privacyModeEnabled: boolean;
  privacyApps: string[];
  titleSharingEnabled: boolean;   // Default: false
  
  // Export settings
  autoExportEnabled: boolean;
  autoExportTime: string;         // "18:00"
}
```

#### Dashboard Metrics

The Admin Console aggregates metrics from all connected devices:

- **Team Summary**: Total active hours, average productivity
- **Device Status**: Online/offline, last seen, tracking status
- **Attention Groups**: Devices needing attention (offline, low activity)
- **Rankings**: Top performers by productivity score
- **Trends**: 7-day activity trends

### 4.4 Build Commands

```bash
cd admin-console

# Development
npm run build              # Build main + renderer
npm start                  # Run the app

# Production
npm run dist               # Build Windows installer
```

### 4.5 Server Port

The Admin Console runs a WebSocket server on **port 17888** by default.


---

## 5. Licensing Server

### 5.1 Overview

The Licensing Server is a Node.js/Fastify API deployed on Railway that handles:
- License key generation and management
- Device activation and validation
- Heartbeat checks for revocation detection
- Organization/tenant management
- Admin dashboard for license management

### 5.2 Project Structure

```
licensing-server/
├── api/
│   ├── src/
│   │   ├── index.ts              # Fastify server entry
│   │   ├── config.ts             # Configuration
│   │   ├── routes/
│   │   │   ├── app.ts            # Activation/validation endpoints
│   │   │   ├── licenses.ts       # License CRUD
│   │   │   ├── organizations.ts  # Organization management
│   │   │   └── auth.ts           # Admin authentication
│   │   ├── services/
│   │   │   ├── expiryChecker.ts  # License expiry checks
│   │   │   └── ...
│   │   ├── middleware/
│   │   │   └── rateLimit.ts      # Rate limiting
│   │   └── utils/
│   │       ├── crypto.ts         # Ed25519 signatures
│   │       └── licenseKey.ts     # Key generation
│   ├── prisma/
│   │   └── schema.prisma         # Database schema
│   └── public/
│       └── app.js                # Admin dashboard frontend
└── package.json
```

### 5.3 API Endpoints

#### Activation Endpoint

**POST** `/v1/activate`

```json
// Request
{
  "licenseKey": "PT1-<base64payload>.<base64signature>",
  "machineHash": "<device-fingerprint>",
  "appVersion": "1.8.8",
  "appType": "CLIENT"  // or "ADMIN"
}

// Response (Success)
{
  "activationCert": {
    "certPayload": {
      "licenseId": "LIC-2026-001",
      "machineHash": "abc123...",
      "plan": "pro",
      "expiresAt": "2027-01-15T00:00:00Z",
      "features": {
        "adminPanel": true,
        "exports": true,
        "advancedReports": true
      }
    },
    "certSignature": "<base64-signature>"
  },
  "serverTime": "2026-01-15T10:00:00Z",
  "nextCheckAt": "2026-01-15T22:00:00Z"
}
```

#### Heartbeat Endpoint

**POST** `/v1/heartbeat`

```json
// Request
{
  "licenseId": "LIC-2026-001",
  "machineHash": "<device-fingerprint>",
  "appVersion": "1.8.8",
  "lastCertHash": "<hash-of-current-cert>",
  "appType": "CLIENT"
}

// Response
{
  "status": "valid",  // or "REVOKED", "EXPIRED"
  "serverTime": "2026-01-15T14:30:00Z",
  "nextCheckAt": "2026-01-16T02:30:00Z",
  "signature": "<base64-signature>"
}
```

### 5.4 License Key Format

```
PT1-<base64-payload>.<base64-signature>
```

**Payload Structure:**
```json
{
  "ver": 1,
  "lic": "LIC-2026-001",
  "prod": "PT",
  "act": "https://license.produtime.com",
  "exp": 1735689600,      // Unix timestamp (seconds)
  "iat": 1704153600,      // Issued-at timestamp
  "plan": "pro",          // basic, pro, enterprise
  "seats": 5,
  "licenseType": "CLIENT" // or "ADMIN"
}
```

### 5.5 Database Schema (PostgreSQL)

```sql
-- Organizations
CREATE TABLE organizations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(50) DEFAULT 'ACTIVE',  -- ACTIVE, SUSPENDED, EXPIRED
  created_at TIMESTAMP DEFAULT NOW()
);

-- Licenses
CREATE TABLE licenses (
  id SERIAL PRIMARY KEY,
  organization_id INT REFERENCES organizations(id),
  customer_name VARCHAR(255) NOT NULL,
  plan VARCHAR(50) NOT NULL,
  license_type VARCHAR(50) DEFAULT 'CLIENT',  -- CLIENT or ADMIN
  seats INT DEFAULT 1,
  expiry_date TIMESTAMP,
  status VARCHAR(50) DEFAULT 'ACTIVE',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Machines (activated devices)
CREATE TABLE machines (
  id SERIAL PRIMARY KEY,
  license_id INT REFERENCES licenses(id),
  machine_hash VARCHAR(64) NOT NULL,
  app_type VARCHAR(50) DEFAULT 'CLIENT',
  status VARCHAR(50) DEFAULT 'ACTIVE',
  last_seen TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### 5.6 Deployment

The licensing server is deployed on Railway:

```bash
# Environment variables required
DATABASE_URL=postgresql://...
ED25519_PRIVATE_KEY=<base64-private-key>
ED25519_PUBLIC_KEY=<base64-public-key>
JWT_ACCESS_SECRET=<secret>
JWT_REFRESH_SECRET=<secret>
CORS_ORIGIN=*
```

**Important**: The licensing server is a git submodule. Commit/push separately:

```bash
git -C licensing-server/api add .
git -C licensing-server/api commit -m "Update"
git -C licensing-server/api push
```


---

## 6. Communication Protocols

### 6.1 Admin Protocol (Client ↔ Admin Console)

The Admin Protocol defines WebSocket communication between ProduTime clients and the Admin Console.

#### Message Types

| Type | Direction | Purpose |
|------|-----------|---------|
| `PAIR_REQUEST` | Client → Admin | Request pairing with pair code |
| `PAIR_APPROVED` | Admin → Client | Pairing approved |
| `PAIR_DENIED` | Admin → Client | Pairing denied |
| `HEARTBEAT` | Client → Admin | Periodic status update |
| `STATS_SUMMARY` | Client → Admin | Activity statistics |
| `POLICY_PUSH` | Admin → Client | Push new policy |
| `LOCK` | Admin → Client | Lock device |
| `UNLOCK` | Admin → Client | Unlock device |
| `EXPORT_REQUEST` | Admin → Client | Request report export |

#### Message Structure

```typescript
interface BaseMessage {
  type: AdminMessageType;
  ts: number;           // Unix timestamp (ms)
  nonce: string;        // Unique nonce for replay protection
  deviceId: string;     // Device identifier
  signature: string;    // Ed25519 signature
}

// Example: Heartbeat
interface HeartbeatPayload {
  appVersion: string;
  trackingStatus: 'active' | 'paused' | 'stopped';
  policyVersion: string;
  uptime: number;
  lastActivityAt: number;
}
```

#### Security

- All messages are signed with Ed25519
- Nonces prevent replay attacks
- Session tokens expire after 24 hours

### 6.2 Licensing Protocol (Client ↔ Server)

#### Activation Flow

```
ProduTime Client                    Licensing Server
      │                                   │
      │  POST /v1/activate                │
      │  {licenseKey, machineHash}        │
      │  ─────────────────────────────────►
      │                                   │
      │                                   │  Verify signature
      │                                   │  Check license valid
      │                                   │  Check seat limit
      │                                   │  Create machine record
      │                                   │
      │  {activationCert, serverTime}     │
      │  ◄─────────────────────────────────
      │                                   │
      │  Store cert encrypted             │
      │                                   │
```

#### Heartbeat Flow

```
ProduTime Client                    Licensing Server
      │                                   │
      │  POST /v1/heartbeat               │
      │  {licenseId, machineHash}         │
      │  ─────────────────────────────────►
      │                                   │
      │                                   │  Check license status
      │                                   │  Check organization status
      │                                   │  Update last_seen
      │                                   │
      │  {status, nextCheckAt}            │
      │  ◄─────────────────────────────────
      │                                   │
      │  If REVOKED/EXPIRED:              │
      │    Enter grace period             │
      │    Lock after 72 hours            │
      │                                   │
```

