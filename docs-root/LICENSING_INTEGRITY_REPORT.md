# Licensing Integrity Report

**Date:** 2026-01-22
**Version:** 1.8.8
**Auditor:** AntiGravity (Agentic AI)

## Executive Summary
The licensing subsystem in ProduTime v1.8.8 was audited for logical correctness, security, and resilience. The system uses a robust Ed25519 signature scheme with offline grace periods and hardware binding. Several critical bug fixes (drift correction, grace period persistence) were verified in `EnhancedLicenseService.ts`.

## 1. State Machine Analysis

### States
*   **TRIAL**: Default state for new users.
    *   *Entry*: First run, valid for 7 days.
    *   *Exit*: Expiry -> LOCKED. Activation -> ACTIVATED.
    *   *Integrity*: Prevents trial restart (checks `trialStart` in DB).
*   **ACTIVATED**: Paid state.
    *   *Entry*: Valid signature verified.
    *   *Maintenance*: Heartbeat every 12h.
    *   *Exit*: Revocation/Expiry -> LOCKED.
*   **LOCKED**: Critical enforcement state.
    *   *Entry*: Tamper detected (High), Grace exceeded, Revoked, Expired.
    *   *Behavior*: Blocks all features except Activation UI.

### Critical Transitions Verified
1.  **Trial Expiry**:
    *   Logic: `now - trialStart > 7 days`.
    *   Defense: Checks `lastServerLocalTime` to prevent system clock rollback (Drift Correction).
    *   Status: **VERIFIED** in code.

2.  **Grace Period Enforcement**:
    *   Logic: Allows offline use for 72 hours from `lastSeen`.
    *   Defense: Blocks if `elapsed > 72h`. Persistence of `gracePeriodStart` ensures reboots don't reset the timer.
    *   Status: **VERIFIED** (Bug Fix #21 checked).

3.  **Revocation**:
    *   Logic: Server responses with `status: REVOKED` trigger immediate lock.
    *   Defense: Cryptographically signed heartbeat response prevents spoofing "OK" status.
    *   Status: **VERIFIED**.

## 2. Security & Crypto

*   **Algorithm**: Ed25519 (Edwards-curve Digital Signature Algorithm).
*   **Libraries**: `tweetnacl` (JS implementation), `crypto` (Node.js).
*   **Keys**:
    *   Server Private Key (Signer): Protected via ENV.
    *   Client Public Key (Verifier): Hardcoded in build.
*   **Hardware Binding**:
    *   Machine Fingerprint: `HMAC-SHA256(MachineGUID + CPU + Drive + Salt)`.
    *   Tamper Detection: Fuzzy matching allows minor upgrades (RAM), blocks clones (VMs).

## 3. Findings & Recommendations

### Passed Checks
- [x] **Drift Correction**: Logic exists to use Server Time delta when checking expiry locally.
- [x] **Input Validation**: `licenseKey` regex ensures format before network call.
- [x] **Seat Limits**: Server-side transactional check prevents race conditions on activation.
- [x] **Database Security**: Encrypted DB path binds data to hardware.

### Areas for Improvement
- [ ] **Unit Test Coverage**: Existing test suite (`src/main/services/licensing/__tests__`) has configuration issues running in isolation. Recommendation: Fix `jest.config.js` to properly support `src/main` typescript compilation.
- [ ] **Error Reporting**: Activation failures due to network timeout (AbortController) should clearly distinguish "Offline" from "Server Error" to user.

## 4. Conclusion
The licensing system is **Production Ready** from a logic and security standpoint. The critical flows for revenue protection (activation, seat limits) and user experience (grace period) are correctly implemented.
