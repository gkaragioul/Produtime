# Changelog

## [1.9.0] - 2026-02-08 - "Security Hardened Release"

### Security
- **Admin Authentication**: Removed hardcoded `admin123` password. Admin passwords are now generated with `crypto.randomBytes(12)` and stored as scrypt hashes with timing-safe comparison via `crypto.timingSafeEqual`.
- **Command Injection Prevention**: Replaced all `exec`/`execAsync` calls in `startup-helper.ts` and `registry-service.ts` with `spawn` using argument arrays.
- **Path Traversal Protection**: `pdf-generator.ts` `saveReport()` now validates target paths against an allowlist (Home, Downloads, Documents, Reports).
- **Encryption Upgrade**: `secureStore.ts` fallback encryption upgraded from insecure base64 to AES-256-GCM with proper IV and auth tags.
- **Registry Encryption**: `registry-service.ts` now uses random salts instead of hardcoded `'salt'`, with backward-compatible decryption for existing data.
- **TOCTOU Fix**: `database.ts` `getLockoutState()` uses atomic `INSERT OR IGNORE` to prevent race conditions.
- **HTTPS Enforcement**: License manager URLs switched from `http://146.190.233.122:3000` to `https://license.produtime.com` with environment variable override support.

### Performance
- **Database Indexes**: Added `idx_settings_key`, `idx_analytics_recorded_at`, and `idx_admin_login_attempts_date_success` (migration v10).

### Stability
- **Memory Leak Fix**: Heartbeat timer in `main.ts` is now stored and cleaned up on app shutdown.
- **Revocation Timer Cleanup**: `EnhancedLicenseService` revocation check interval is tracked and cleared on shutdown.
- **Null Safety**: Added window existence checks before `dialog.showMessageBox` in `auto-updater.ts`; added `pdfGenerator` null check in `ipc-handlers.ts`.
- **Empty Catch Blocks**: Fixed all empty `catch {}` blocks across main process files with proper error logging.

### Validation
- **Date Input**: `dateISO` parsing in `ipc-handlers.ts` validates against `NaN` before use.
- **Time Format**: `toMin()` helper validates `HH:MM` parts are valid numbers.
- **JSON Structure**: `auto-export-scheduler.ts` validates parsed privacy apps array; `assisted-updater.ts` validates timestamp file structure.

### Testing
- **Seat Enforcement**: 14 new test cases covering seat limits, re-activation, and organization limits.
- **Activity Tracker**: 50+ new test cases for initialization, tracking, idle detection, and edge cases.
- **Admin Gating**: 25+ new test cases for feature gating and license validation.
- **Revocation & Grace Period**: Expanded coverage for offline tolerance and revocation detection.
- **Time Skew**: Expanded coverage for clock manipulation detection.
- **Cross-Tab Timeout**: Re-enabled previously skipped test suite.

---

## [1.8.9] - 2026-01-22 - "Hardened Production Release"

### Security & Integrity
- **Licensing**: Verified Ed25519 signature enforcement for Activation and Heartbeats.
- **Drift Correction**: Confirmed logic to detect system time manipulation (blocking trial restart cheats).
- **Grace Period**: Validated offline tolerance (72 hours) and persistence logic to prevent reset hacks.
- **Admin Console**: Audited WebSocket pairing protocol for proper cryptographic identity enforcement.

### Privacy
- **Activity Tracking**: Audited "Privacy Mode" implementation. Window titles for flagged apps (e.g., "Slack") are sanitized at the source before database write.
- **Reports**: Confirmed PDF generator respected privacy settings during historical data processing.

### Quality Assurance
- **Type Safety**: Introduced strict `typecheck` CI command for Main, Admin, and Server processes.
- **Testing**: Added `test:all` script including scenario simulator.
- **Audits**: Completed full static analysis and manual code review of critical flows (`docs-root/LICENSING_INTEGRITY_REPORT.md`, `CLIENT_CHECKUP_REPORT.md`, `ADMIN_CONSOLE_REPORT.md`).

### Fixes
- **Stability**: Verified large report data limits (truncation at 10k rows) to prevent memory crashes.

---
## [1.8.8] - 2025-01-14
- Initial "End-to-End" feature set.
- Added Enhanced License Service.
- Added Admin Console WebSocket server.
