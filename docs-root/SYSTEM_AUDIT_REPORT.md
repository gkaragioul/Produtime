# ProduTime System Audit Report

**Date:** January 14, 2026  
**Auditor:** Senior Full-Stack Engineer + QA Lead  
**Scope:** Main App, Admin Console, Cloud Admin API, Cloud Admin Web

---

## A) SYSTEM MAP

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PRODUTIME ECOSYSTEM                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────┐         WebSocket (17888)        ┌──────────────────┐ │
│  │   MAIN APP       │◄────────────────────────────────►│  ADMIN CONSOLE   │ │
│  │   (Electron)     │         Ed25519 Signed           │   (Electron)     │ │
│  │                  │                                   │                  │ │
│  │  src/            │                                   │  admin-console/  │ │
│  │  ├─ main/        │                                   │  ├─ main/        │ │
│  │  │  └─ agent-    │                                   │  │  └─ server.ts │ │
│  │  │     service   │                                   │  │  └─ db.ts     │ │
│  │  └─ renderer/    │                                   │  └─ renderer/    │ │
│  │                  │                                   │                  │ │
│  │  SQLite DB       │                                   │  SQLite DB       │ │
│  │  (produtime.db)  │                                   │  (admin.db)      │ │
│  └──────────────────┘                                   └──────────────────┘ │
│           │                                                      │           │
│           │ WSS (Cloud)                              WSS (Cloud) │           │
│           │                                                      │           │
│           ▼                                                      ▼           │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                        CLOUD ADMIN API                                 │  │
│  │                        (Fastify + Prisma)                              │  │
│  │                                                                        │  │
│  │  cloud-admin-api/                                                      │  │
│  │  ├─ src/routes/     (auth, pairing, dashboard, tenants, websocket)    │  │
│  │  ├─ src/services/   (auth, pairing, dashboard, tenant, ws-manager)    │  │
│  │  └─ prisma/         (PostgreSQL schema)                               │  │
│  │                                                                        │  │
│  │  PostgreSQL DB (multi-tenant)                                          │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                      │                                       │
│                                      │ REST API                              │
│                                      ▼                                       │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                        CLOUD ADMIN WEB                                 │  │
│  │                        (React SPA)                                     │  │
│  │                                                                        │  │
│  │  cloud-admin-web/                                                      │  │
│  │  ├─ src/pages/      (Login, Dashboard, Pairing)                       │  │
│  │  ├─ src/components/ (Dashboard panels, Sidebar)                       │  │
│  │  └─ src/services/   (api.ts)                                          │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Entrypoints

| Component | Entrypoint | Port | Protocol |
|-----------|------------|------|----------|
| Main App (UI) | `src/renderer/index.tsx` | N/A | Electron IPC |
| Main App (Backend) | `src/main/main.ts` | N/A | Electron Main |
| Admin Console (UI) | `admin-console/src/renderer/App.tsx` | N/A | Electron IPC |
| Admin Console (Server) | `admin-console/src/main/server.ts` | 17888 | HTTP + WS |
| Cloud Admin API | `cloud-admin-api/src/index.ts` | 3000 | HTTP + WSS |
| Cloud Admin Web | `cloud-admin-web/src/main.tsx` | 5173 | HTTP |

### Database Layers

| Component | Database | ORM/Driver | Location |
|-----------|----------|------------|----------|
| Main App | SQLite | better-sqlite3 | `%APPDATA%/produtime/produtime.db` |
| Admin Console | SQLite | better-sqlite3 | `%APPDATA%/produtime-admin-console/admin-console.db` |
| Cloud Admin API | PostgreSQL | Prisma | Cloud-hosted |

### Communication Paths

1. **Main App ↔ Admin Console (Local)**
   - Protocol: WebSocket on port 17888
   - Discovery: mDNS (`_produtime-admin._tcp`)
   - Auth: Ed25519 signatures + session tokens
   - Messages: Signed JSON (admin-protocol.ts)

2. **Main App ↔ Cloud Admin API**
   - Protocol: WSS (WebSocket Secure)
   - Auth: Ed25519 signatures + tenant ID + session token
   - Endpoint: Stored in `agent_pairing.cloud_ws_endpoint`

3. **Cloud Admin Web ↔ Cloud Admin API**
   - Protocol: HTTPS REST + WSS
   - Auth: JWT (access + refresh tokens)
   - Rate limiting: Redis-backed

### Auth/Session Flow

**Local Pairing:**
1. Admin Console generates 6-digit pair code (5 min expiry)
2. User enters code in Main App
3. Main App sends HTTP POST `/pair/request` with Ed25519 public key
4. Admin approves → WebSocket PAIR_APPROVED with admin public key
5. Both sides store keys, session token established
6. Heartbeats every 10s, stats every 60s

**Cloud Pairing:**
1. Cloud Admin generates pair code via API
2. User enters code in Main App
3. Main App polls `/api/v1/pairing/status/{requestId}`
4. Admin approves → Response includes `wsEndpoint`, `tenantId`, `sessionToken`
5. Main App connects to cloud WSS endpoint
6. Exponential backoff retry (max 10 attempts, 1s-60s delay)
7. Fallback to local admin if cloud unavailable

---

## B) FEATURE INVENTORY & PARITY MATRIX

| Feature | Main App | Admin Console | Cloud API | Cloud Web | Status | Notes |
|---------|----------|---------------|-----------|-----------|--------|-------|
| **Activity Tracking** |
| Window tracking | ✅ | - | - | - | OK | Core feature |
| Idle detection | ✅ | - | - | - | OK | Configurable threshold |
| Privacy mode | ✅ | ✅ (policy) | ✅ | ✅ | OK | Per-app privacy |
| Title sharing toggle | ✅ | ✅ (policy) | ✅ | ✅ | OK | Default: OFF |
| **Pairing** |
| Local pairing | ✅ | ✅ | - | - | OK | mDNS discovery |
| Cloud pairing | ✅ | - | ✅ | ✅ | OK | Polling-based |
| Pair code generation | - | ✅ | ✅ | ✅ | OK | 6-digit, 5 min expiry |
| Pair approval/denial | - | ✅ | ✅ | ✅ | OK | |
| **Dashboard** |
| Team totals | - | ✅ | ✅ | ✅ | OK | |
| Device status | - | ✅ | ✅ | ✅ | OK | online/idle/offline |
| Health score | - | ✅ | ✅ | ✅ | OK | 0-100 |
| Attention groups | - | ✅ | ✅ | ✅ | OK | 7 exception types |
| Rankings | - | ✅ | ✅ | ✅ | OK | Most active, etc. |
| 7-day trends | - | ✅ | ✅ | ✅ | OK | |
| Top apps | - | ✅ | ✅ | ✅ | OK | |
| **Policy Management** |
| Work schedule | ✅ | ✅ | ⚠️ | ⚠️ | PARTIAL | Cloud lacks full policy push |
| Idle threshold | ✅ | ✅ | ⚠️ | ⚠️ | PARTIAL | |
| Privacy apps list | ✅ | ✅ | ⚠️ | ⚠️ | PARTIAL | |
| Policy push | - | ✅ | ❌ | ❌ | MISSING | Cloud needs implementation |
| **Device Management** |
| Device list | - | ✅ | ✅ | ✅ | OK | |
| Device detail | - | ✅ | ✅ | ⚠️ | PARTIAL | Web detail page incomplete |
| Lock/unlock | - | ✅ | ❌ | ❌ | MISSING | Cloud needs implementation |
| Unpair | - | ✅ | ❌ | ❌ | MISSING | Cloud needs implementation |
| **Reporting** |
| PDF export | ✅ | ✅ (request) | ❌ | ❌ | MISSING | Cloud lacks export |
| Weekly reports | - | ✅ | ❌ | ❌ | MISSING | |
| **Auth** |
| Admin password | ✅ | - | - | - | OK | Local only |
| JWT auth | - | - | ✅ | ✅ | OK | |
| Rate limiting | - | - | ✅ | - | OK | Redis-backed |
| Lockout | ✅ | - | ✅ | - | OK | |
| **Observability** |
| Audit log | - | ✅ | ✅ | ⚠️ | PARTIAL | Web lacks audit view |
| Server logs | - | ✅ | ✅ | - | OK | |
| Heartbeat log | - | ✅ | ⚠️ | - | PARTIAL | Cloud lacks persistence |

### Legend
- ✅ = Implemented and working
- ⚠️ = Partial implementation or needs verification
- ❌ = Missing/Not implemented
- `-` = Not applicable for this component

---

## C) CONTRACT REPORT

### Protocol Files Comparison

**Files:**
- `src/shared/admin-protocol.ts` (Main App - SOURCE OF TRUTH)
- `admin-console/src/shared/admin-protocol.ts` (Admin Console - COPY)

**Drift Analysis:**

| Field/Type | Main App | Admin Console | Status |
|------------|----------|---------------|--------|
| `AdminMessageType` | 16 types | 16 types | ✅ ALIGNED |
| `BaseMessage` | 5 fields | 5 fields | ✅ ALIGNED |
| `PairApprovedPayload.wsEndpoint` | ✅ Present | ❌ MISSING | ⚠️ DRIFT |
| `PairApprovedPayload.tenantId` | ✅ Present | ❌ MISSING | ⚠️ DRIFT |
| `PairApprovedPayload.tenantName` | ✅ Present | ❌ MISSING | ⚠️ DRIFT |
| `AgentPairingState.cloudWsEndpoint` | ✅ Present | ❌ MISSING | ⚠️ DRIFT |
| `AgentPairingState.tenantId` | ✅ Present | ❌ MISSING | ⚠️ DRIFT |
| `AgentPairingState.tenantName` | ✅ Present | ❌ MISSING | ⚠️ DRIFT |
| Cloud constants | ✅ Present | ❌ MISSING | ⚠️ DRIFT |

**CRITICAL:** Admin Console protocol file is missing cloud pairing fields. This is a contract mismatch that could cause issues if Admin Console tries to handle cloud-paired devices.

### Dashboard Types Comparison

**Files:**
- `admin-console/src/shared/dashboard-types.ts` (Admin Console - MOST COMPLETE)
- `cloud-admin-api/src/services/dashboard-types.ts` (Cloud API)
- `cloud-admin-web/src/types/dashboard.ts` (Cloud Web)

| Type | Admin Console | Cloud API | Cloud Web | Status |
|------|---------------|-----------|-----------|--------|
| `DailyMetricsSummary` | ✅ | ✅ | ✅ | ✅ ALIGNED |
| `DeviceStatusType` | ✅ | ✅ | ✅ | ✅ ALIGNED |
| `RiskLabel` | ✅ | ✅ | ✅ | ✅ ALIGNED |
| `HealthLabel` | ✅ | ✅ | ✅ | ✅ ALIGNED |
| `DashboardMode` | ✅ | ✅ | ✅ | ✅ ALIGNED |
| `AttentionType` | ✅ | ✅ | ✅ | ✅ ALIGNED |
| `AttentionSeverity` | `ExceptionSeverity` | `AttentionSeverity` | `ExceptionSeverity` | ⚠️ NAMING |
| `DeviceListItemEnhanced.trackingRunning` | ❌ | ✅ | ❌ | ⚠️ DRIFT |
| Helper functions | ✅ Full | ✅ Full | ✅ Partial | ⚠️ PARTIAL |

### API Endpoints (Cloud Admin API)

| Endpoint | Method | Request Shape | Response Shape | Validation |
|----------|--------|---------------|----------------|------------|
| `/api/v1/auth/login` | POST | `{email, password}` | `{accessToken, refreshToken, user}` | ✅ Zod |
| `/api/v1/auth/refresh` | POST | `{refreshToken}` | `{accessToken, refreshToken}` | ✅ Zod |
| `/api/v1/pairing/code` | POST | `{}` | `{code, expiresAt}` | ✅ Zod |
| `/api/v1/pairing/request` | POST | `{pairCode, deviceId, ...}` | `{requestId}` | ✅ Zod |
| `/api/v1/pairing/status/:id` | GET | - | `{status, wsEndpoint?, ...}` | ⚠️ Partial |
| `/api/v1/pairing/approve/:id` | POST | `{}` | `{success}` | ✅ Zod |
| `/api/v1/pairing/deny/:id` | POST | `{reason?}` | `{success}` | ✅ Zod |
| `/api/v1/dashboard/summary` | GET | `?range=today|7d` | `DashboardSummaryEnhanced` | ⚠️ No Zod |
| `/api/v1/dashboard/devices` | GET | - | `DeviceListItemEnhanced[]` | ⚠️ No Zod |
| `/api/v1/tenants` | GET | - | `Tenant[]` | ✅ Zod |

### WebSocket Messages

| Message Type | Direction | Payload | Validation |
|--------------|-----------|---------|------------|
| `IDENTIFY` | Agent → Admin | `{deviceName, devicePubKey, isPairing, tenantId?}` | ❌ None |
| `HEARTBEAT` | Agent → Admin | `HeartbeatPayload + enhanced` | ❌ None |
| `PAIR_APPROVED` | Admin → Agent | `PairApprovedPayload` | ❌ None |
| `PAIR_DENIED` | Admin → Agent | `{reason}` | ❌ None |
| `POLICY_PUSH` | Admin → Agent | `{policy, force}` | ❌ None |
| `STATS_SUMMARY` | Agent → Admin | `StatsSummaryPayload` | ❌ None |

**CRITICAL:** No runtime validation on WebSocket messages. All messages are trusted after signature verification.

---

## D) RED FLAGS & RISKS

### Critical Issues

1. **Protocol Drift (HIGH)**
   - Admin Console's `admin-protocol.ts` is missing cloud pairing fields
   - Risk: Cloud-paired devices may not work correctly with local Admin Console
   - Fix: Sync protocol files or create shared package

2. **No Runtime Validation on WebSocket (HIGH)**
   - All WebSocket messages are parsed as JSON without schema validation
   - Risk: Malformed messages could crash handlers or cause undefined behavior
   - Fix: Add Zod validation at message boundaries

3. **Duplicate Type Definitions (MEDIUM)**
   - Dashboard types duplicated across 4 files
   - Risk: Types drift over time, causing runtime errors
   - Fix: Create shared types package or single source of truth

### Security Concerns

4. **Private Key Storage (MEDIUM)**
   - Admin Console encrypts private key with hostname-derived key
   - Risk: Hostname is predictable, key derivation is weak
   - Fix: Use OS keychain (Keytar) or stronger KDF

5. **Session Token Handling (LOW)**
   - Session tokens stored in SQLite without encryption
   - Risk: Token theft if database is accessed
   - Fix: Encrypt sensitive fields or use secure storage

### Reliability Concerns

6. **No Correlation IDs (MEDIUM)**
   - No trace IDs flow through the system
   - Risk: Difficult to debug issues across components
   - Fix: Add correlation ID to all messages and logs

7. **Stale Connection Cleanup (LOW)**
   - 60-second threshold for stale connections
   - Risk: Devices may appear online when actually disconnected
   - Fix: Reduce threshold or add ping/pong

8. **Cloud Fallback Logic (LOW)**
   - Falls back to local admin after 10 cloud reconnect attempts
   - Risk: May connect to wrong admin if multiple available
   - Fix: Add explicit fallback configuration

### Code Quality Issues

9. **Large Files (LOW)**
   - `agent-service.ts`: 1645 lines
   - `server.ts`: 1137 lines
   - `db.ts`: 1197 lines
   - Risk: Difficult to maintain and test
   - Fix: Split into smaller modules

10. **Missing Error Boundaries (MEDIUM)**
    - React components lack error boundaries
    - Risk: Unhandled errors crash entire UI
    - Fix: Add error boundaries to key components

---

## E) RECOMMENDED FIXES

### Priority 1: Contract Enforcement

1. **Sync Protocol Files**
   - Copy cloud pairing fields to `admin-console/src/shared/admin-protocol.ts`
   - Add `wsEndpoint`, `tenantId`, `tenantName` to `PairApprovedPayload`
   - Add cloud fields to `AgentPairingState`
   - Add cloud constants

2. **Add Zod Validation**
   - Create `src/shared/validation/` with Zod schemas
   - Validate all WebSocket messages at boundaries
   - Validate all API responses

### Priority 2: Observability

3. **Add Correlation IDs**
   - Generate UUID at request start
   - Pass through all service calls
   - Include in all log messages

4. **Structured Logging**
   - Replace console.log with structured logger
   - Include timestamp, level, correlationId, component

### Priority 3: Testing

5. **End-to-End Tests**
   - Test pairing flow (local and cloud)
   - Test heartbeat/stats flow
   - Test policy push
   - Test error scenarios

6. **Integration Tests**
   - Test database operations
   - Test WebSocket message handling
   - Test API endpoints

---

*Report generated: January 14, 2026*


---

## F) IMPLEMENTED FIXES

### 1. Protocol Sync (COMPLETED)

**Files Modified:**
- `admin-console/src/shared/admin-protocol.ts`

**Changes:**
- Added `wsEndpoint`, `tenantId`, `tenantName` to `PairApprovedPayload`
- Added cloud fields to `AgentPairingState`
- Added cloud connection constants

### 2. Runtime Validation (COMPLETED)

**Files Created:**
- `src/shared/validation/protocol-schemas.ts` - Lightweight validation without external dependencies

**Features:**
- `validateBaseMessage()` - Validates message structure
- `validateHeartbeatPayload()` - Validates heartbeat data
- `validatePairRequestPayload()` - Validates pairing requests
- `validatePairApprovedPayload()` - Validates approval with cloud fields
- `validateProtocolMessage()` - Full message validation
- `withValidation()` - Wrapper for message handlers

### 3. Structured Logging (COMPLETED)

**Files Created:**
- `src/shared/logging/structured-logger.ts`

**Features:**
- Correlation ID generation and tracking
- Log levels: debug, info, warn, error
- Structured context (component, deviceId, tenantId, action)
- `startOperation()` / `endOperation()` for tracing
- Pre-configured loggers for common components

### 4. Test Suite (COMPLETED)

**Files Created:**
- `src/main/services/agent/__tests__/protocol-validation.test.ts` (17 tests)
- `src/main/services/agent/__tests__/agent-integration.test.ts` (33 tests)

---

## G) TEST COMMANDS

### Run All Tests
```bash
npm test
```

### Run Protocol Validation Tests
```bash
npm test -- --testPathPattern="protocol-validation"
```

### Run Agent Integration Tests
```bash
npm test -- --testPathPattern="agent-integration"
```

### Run All Agent Tests
```bash
npm test -- --testPathPattern="agent"
```

### Run Tests with Coverage
```bash
npm run test:coverage
```

---

## H) REMAINING RISKS

### High Priority
1. **WebSocket messages not validated at runtime** - Validation schemas created but not yet integrated into server.ts and agent-service.ts handlers
2. **No E2E tests with actual WebSocket connections** - Would require test harness with mock server

### Medium Priority
3. **Cloud API lacks policy push endpoint** - Feature gap
4. **Cloud API lacks device lock/unlock** - Feature gap
5. **No audit log viewer in Cloud Web** - UI gap

### Low Priority
6. **Large file sizes** - Refactoring recommended but not critical
7. **Missing error boundaries in React** - UI resilience

---

## I) SUMMARY

### Audit Findings
- **4 packages** identified: Main App, Admin Console, Cloud Admin API, Cloud Admin Web
- **Protocol drift** found and fixed in admin-console protocol file
- **50 tests** added for validation and integration
- **Validation layer** created for runtime contract enforcement
- **Structured logging** infrastructure added

### Contract Status
- Main App ↔ Admin Console: **ALIGNED** (after fix)
- Dashboard types: **MOSTLY ALIGNED** (minor naming differences)
- Cloud API endpoints: **PARTIAL** (missing policy/lock features)

### Test Coverage
- Protocol validation: 17 tests ✅
- Agent integration: 33 tests ✅
- All tests passing

---

*Audit completed: January 14, 2026*
