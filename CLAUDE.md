# ProduTime - Claude Code Context

## Project Overview
ProduTime is a free, local-only desktop time tracking app built with Electron + React + TypeScript.
- **Author:** George Karagioules
- **Repo:** https://github.com/georgekgr12/produtime
- **Admin Console:** Separate Electron app in `admin-console/` for managing devices on LAN

## Tech Stack
- **Main process:** TypeScript compiled via `tsc` → `dist/main/`
- **Renderer:** React + TypeScript bundled via Webpack → `dist/renderer/`
- **Database:** better-sqlite3 (SQLite with WAL mode)
- **Desktop:** Electron (v37 in package.json)
- **Admin Console:** Electron + React + WebSocket server on port 17888

## Build & Run

### Important: VS Code sets `ELECTRON_RUN_AS_NODE=1`
When launching from a VS Code terminal, you MUST unset this variable first:
```bash
unset ELECTRON_RUN_AS_NODE && "node_modules/electron/dist/electron.exe" .
```
Without this, Electron runs as plain Node.js and `require('electron')` returns a path string instead of the API.

### Install
```bash
npm install --ignore-scripts        # Skip native rebuilds if no Visual Studio
node node_modules/electron/install.js  # Download correct Electron binary
npx @electron/rebuild --force --only better-sqlite3 --module-dir node_modules/better-sqlite3  # Rebuild native module for Electron
```

### Build
```bash
npm run build:main      # TypeScript → dist/main/
npm run build:renderer  # Webpack → dist/renderer/
```

### Run
```bash
unset ELECTRON_RUN_AS_NODE && "node_modules/electron/dist/electron.exe" .
```

## Project Structure
- `src/main/` — Electron main process (database, IPC, system tray, etc.)
- `src/renderer/` — React frontend (components, services)
- `src/shared/` — Shared types
- `src/main/database.ts` — SQLite database with migration system
- `src/main/services/activity-tracker.ts` — Window tracking with active-win + PowerShell fallback
- `src/main/services/agent/` — Admin Console agent (WebSocket, crypto, discovery, metrics)
- `src/main/services/email-service.ts` — Email alerts (configurable via UI or env vars)
- `src/renderer/services/daily-insight-engine.ts` — Daily progress/insight logic
- `src/renderer/components/PolicyView.tsx` — Settings view (read-only + email config)
- `assets/` — Icons, images
- `admin-console/` — Admin Console Electron app
- `_archived/` — Archived files

## Database
- Location: `%APPDATA%/produtime/produtime.db` (or legacy `%APPDATA%/atlianflow/timeport.db`)
- Uses hardware-fingerprint-based encrypted path in production
- Migration system in `database.ts` — each migration runs inside `db.transaction()`, so migration SQL must NOT contain `BEGIN TRANSACTION`/`COMMIT`

## Admin Login (ProduTime App)
- Default password: `admin123` (set on first run in `src/main/ipc-handlers.ts`)
- Password is hashed with scrypt and stored in the `settings` table as `admin_password_hash`
- Session expires after 1 hour of inactivity
- Account lockout: 5 failed attempts → locked for 15 minutes

## Admin Console Login
- Default password: `admin123` (set on first run)
- Password stored in `admin_settings` table in admin console DB
- Session expires after 8 hours or app restart

## Settings Architecture
- **Settings tab** uses `PolicyView` component — read-only, no auth required
- When **not managed**: reads from `settings` table (local config)
- When **managed**: reads from `agentGetEffectivePolicy()` (admin policy), updates in real-time via `onAgentPolicyUpdated` WebSocket event
- Admin policy push (`POLICY_PUSH`) writes to both `effective_policy` and `settings` tables so the entire app respects admin changes
- Policy flow: Admin Console → WebSocket → `agent-service.ts:handlePolicyPush()` → `applyPolicy()` → DB + event broadcast → PolicyView updates

## Activity Tracking
- Primary: `active-win` native module (requires VS Build Tools to compile)
- Fallback: PowerShell Win32 API (`GetForegroundWindow`) on Windows, `osascript` on macOS, `xdotool` on Linux
- Falls back automatically when `active-win` is unavailable

## App Categorization
- `metrics-computer.ts` categorizes apps as productive/neutral/distracting
- Default patterns for common apps (IDEs = productive, social media = distracting)
- Admin can override via policy push (stored in `effective_policy` or `settings` as `app_categories` JSON)
- Categories cached for 60 seconds

## Email Alerts
- Configurable via UI in Settings → Email Alerts section
- Stored in database settings: `email_smtp_host`, `email_smtp_port`, `email_smtp_user`, `email_smtp_pass`, `email_smtp_secure`
- Recipient in `admin_alert_email` setting
- Falls back to `EMAIL_USER`/`EMAIL_PASS` env vars if DB not configured
- IPC handlers: `email:getConfig`, `email:saveConfig`, `email:test`

## Admin Console Architecture
- Standalone Electron app with embedded HTTP + WebSocket server
- Port 17888 (mDNS discovery on LAN)
- Ed25519 signed messages (tweetnacl) with replay protection
- Private key encrypted with AES-256-GCM using machine-specific key derivation (hostname + username + CPU model + homedir)
- Database: `%APPDATA%/produtime-admin-console/admin-console.db`
- Dashboard exception detection reads work schedule from assigned policy (not hardcoded)

## Known Issues / Fixes Applied
- **Migration 4 nested transaction bug:** Fixed by removing redundant `BEGIN TRANSACTION`/`COMMIT`
- **Admin password was randomly generated and never shown:** Fixed to use default `admin123`
- **Activity tracking failed without VS Build Tools:** Added PowerShell fallback for Windows
- **Admin Console had no authentication:** Added login gate with `admin123` default password
- **Private key encryption was weak (hostname only):** Now uses multi-factor machine ID
- **Dashboard late-start detection hardcoded to 09:00:** Now reads from device's assigned policy
- **App categorization metrics were hardcoded to 0:** Implemented pattern-based + admin-override categorization
- **Admin account lockout was disabled:** Re-enabled with 5 attempts / 15 min lockout
- **Email alerts required env vars:** Added DB-based config with UI in Settings tab
- **App categorization not pushed to devices:** Wired end-to-end — admin console now includes categories in policy push, agent stores in `effective_policy`
- **WebSocket race condition:** `connect()` had a race where old socket close events nulled `this.ws` after new socket was assigned. Fixed by storing `this.ws` only on `open` event and guarding close/error handlers.
- **Weekly report generation was stubbed:** Implemented — aggregates team + per-device metrics for the week, generates narrative, saves to DB
- **Mixed policies detection was hardcoded false:** Now checks actual `policy_id` across devices
- **Dashboard crashed on partial API failure:** Replaced `Promise.all` with `Promise.allSettled` for graceful degradation
- **Policy push gave no feedback for offline devices:** Now shows info banner saying policy will apply when device reconnects
- **Lock/unlock had no error handling:** Wrapped in try-catch with user-facing error messages
- **Admin console bundle.js loaded twice:** Removed duplicate `<script>` tag from index.html (HtmlWebpackPlugin already injects it)
- **Email alerts required env vars:** Added DB-based config with UI in Settings tab
- **Daily insight engine assumes 100% active time:** `computeExpectedWindow()` expects linear 100% productivity from shift start — no allowance for breaks/idle. Fresh installs instantly show "Off Schedule". (NOT YET FIXED)

## Remaining Known Issues
- Local network pairing removed — cloud-only via Railway (`wot-produtime-production.up.railway.app`)
- Assisted updater checks Railway manifest every 24h, opens download in browser (no silent install)
- Licensing is stubbed (always activated)
- Daily insight engine assumes 100% active time (no break allowance)
