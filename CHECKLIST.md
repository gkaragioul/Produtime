# Produtime Hardening Checklist

## Phase 0: Recon + Baseline Inventory [COMPLETED]
- [x] Create System Map (Client, Admin, Server relations)
- [x] Identify "Known Critical Flows" to protect
- [x] Check dependency health (audit)
- [x] Verify build scripts work (`npm run build:safe`)

## Phase 1: Static Quality Pass [COMPLETED]
- [x] Add CI commands (`typecheck`, `test:all`)
- [x] Run `typecheck` (Passed)
- [x] Audit `lint` settings

## Phase 2: Licensing/Trial Correctness [COMPLETED]
- [x] **Audit `EnhancedLicenseService` logic** (Trial, Activation, Grace Period)
- [x] Verify Fix: Time Drift Correction
- [x] Verify Fix: Grace Period Persistence
- [x] **Deliverable**: `docs-root/LICENSING_INTEGRITY_REPORT.md`

## Phase 3: Client Feature Checkup [COMPLETED]
- [x] Audit `ActivityTracker` (Idle detection, Privacy Mode)
- [x] Audit `PDFGenerator` (Data limits, Privacy sanitization)
- [x] **Deliverable**: `docs-root/CLIENT_CHECKUP_REPORT.md`

## Phase 4: Admin Console Checkup [COMPLETED]
- [x] Audit `AdminServer` (WebSocket Security, Pairing Protocol)
- [x] Verify Crypto Signatures for Admin Commands
- [x] **Deliverable**: `docs-root/ADMIN_CONSOLE_REPORT.md`

## Phase 5: Cross-Component "End-to-End" Logic [SKIPPED/IMPLICIT]
*(Covered by individual audits of shared protocols)*

## Phase 6: Final Diagnostics & Safety Guards [IN PROGRESS]
- [x] Clean up temporary test files
- [ ] Establish "Green Baseline" for future regressions (Known failings documented)

## Phase 7: Release Readiness
- [ ] Bump version to 1.8.9 (Hardened)
- [ ] Generate changelog
