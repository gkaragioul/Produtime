# ProduTime Entitlements-Based Licensing Implementation

## Overview

This document describes the production-grade entitlements-based licensing system implemented for ProduTime. The system licenses both the ProduTime Client (Electron app) and the Admin Panel (local webapp) with feature-based access control, seat enforcement, and reliability hardening.

## Architecture

### Components

1. **Shared Licensing Library** (`src/shared/licensing/`)
   - `entitlements.ts`: Feature definitions and plan mappings
   - `verification.ts`: Shared verification logic (Ed25519, drift correction, tamper classification)

2. **Client Licensing** (`src/main/services/licensing/`)
   - `EnhancedLicenseService.ts`: Main license state machine with entitlements support
   - Supporting services: `machineFingerprint.ts`, `secureStore.ts`, `tamperDetection.ts`

3. **Admin Panel Licensing** (`admin-console/src/main/`)
   - `licensing-service.ts`: Admin-specific license validation
   - `licensing-routes.ts`: HTTP endpoints for license status and feature checks

4. **Server** (`licensing-server/api/`)
   - Updated routes: `routes/app.ts` with seat enforcement and feature inclusion
   - Updated certificate generation: `utils/activationCert.ts` with features
   - Updated database: `prisma/schema.prisma` with features JSONB field

## Features & Plans

### Feature Definitions

```typescript
interface LicenseFeatures {
  adminPanel?: boolean;        // Admin console access
  managedMode?: boolean;       // Managed device mode
  exports?: boolean;           // PDF/report exports
  advancedReports?: boolean;   // Advanced analytics
  customBranding?: boolean;    // Custom branding
  apiAccess?: boolean;         // API access
}
```

### Plan Feature Mapping

| Feature | Trial | Basic | Pro | Enterprise |
|---------|-------|-------|-----|------------|
| adminPanel | ✗ | ✗ | ✓ | ✓ |
| managedMode | ✗ | ✗ | ✓ | ✓ |
| exports | ✓ | ✓ | ✓ | ✓ |
| advancedReports | ✗ | ✗ | ✓ | ✓ |
| customBranding | ✗ | ✗ | ✗ | ✓ |
| apiAccess | ✗ | ✗ | ✗ | ✓ |

## Activation Certificate Payload

### Structure

```typescript
interface ActivationCertPayload {
  certVersion: number;           // 1
  licenseId: string;             // "LIC-2026-001"
  plan: string;                  // "pro"
  seats: number;                 // 5
  machineHash: string;           // Hardware fingerprint
  issuedAt: string;              // ISO timestamp
  expiresAt: string | null;      // ISO timestamp or null
  features: LicenseFeatures;     // Feature flags
  serverTime?: string;           // For drift correction
  policyProfileId?: string;      // Future: policy binding
}
```

### Signature

All certificates signed with Ed25519 private key. Client verifies using embedded public key.

## Server-Side Seat Enforcement

### Activation Endpoint (`POST /v1/activate`)

**Validation Steps**:
1. Parse and verify license key signature
2. Check key exists and not revoked
3. Check license status is ACTIVE
4. Check license not expired
5. **NEW**: Enforce seat limit
   - Count active machines for license
   - If count >= seats AND machineHash not already active → reject with 403 SEAT_LIMIT
6. Create/update machine record
7. Generate signed activation certificate with features
8. Store activation record
9. Audit log activation

**Error Codes**:
- `INVALID_KEY_FORMAT`: License key format invalid
- `LICENSE_NOT_FOUND`: Key hash not found
- `LICENSE_REVOKED`: Key revoked
- `LICENSE_EXPIRED`: License expired
- `DEVICE_ALREADY_ACTIVE`: Machine already activated on different license
- `SEAT_LIMIT`: Seat limit reached

### Heartbeat Endpoint (`POST /v1/heartbeat`)

**Response**:
```json
{
  "status": "OK" | "REVOKED" | "EXPIRED",
  "nextCheckAt": "2026-01-15T15:00:00Z",
  "serverTime": "2026-01-15T14:30:00Z",
  "features": { "adminPanel": true, ... },
  "signature": "<ed25519-signature>"
}
```

**NEW**: Response includes features snapshot and is signed.

## Client Hardening

### EnhancedLicenseService Enhancements

1. **Entitlement Gating**
   ```typescript
   public hasFeature(featureName: string): boolean
   public requireFeature(featureName: string): void // throws if not allowed
   ```

2. **Time Skew Mitigation**
   - Store `lastServerTime` and `lastServerLocalTime` from heartbeat
   - Use `computeDriftedNow()` for all time-based checks
   - Prevents false expiry if local clock changes

3. **Network Failure Handling**
   - Revocation check backoff: 5m → 7.5m → 11.25m → ... (capped at 1h)
   - Only hard-lock if grace period exceeded
   - Reset backoff on successful heartbeat

4. **Tamper Detection Severity**
   - **LOW** (MAC/productId change): Force heartbeat soon, no lock
   - **MEDIUM** (drive change): Warning + force heartbeat
   - **HIGH** (3+ components): Lock trial OR force heartbeat for activated

5. **UI Broadcast Updates**
   - Broadcast license state to renderer
   - Include features, warnings, mode
   - Immediate lockout on revocation

### Database Schema Update

```sql
ALTER TABLE license_state ADD COLUMN lastServerLocalTime INTEGER;
```

## Admin Panel Licensing

### AdminLicensingService

Validates license locally using activation certificate:

```typescript
public async init(): Promise<AdminLicenseStatus>
public getStatus(): AdminLicenseStatus
public isAdminPanelLicensed(): boolean
public hasFeature(featureName: string): boolean
```

### Licensing Routes

**GET /license/status**
```json
{
  "licensed": true,
  "features": { "adminPanel": true, ... },
  "licenseId": "LIC-2026-001",
  "expiresAt": "2027-01-15T00:00:00Z",
  "seatsUsed": 1,
  "seatsTotal": 5
}
```

**GET /license/check/:feature**
```json
{
  "feature": "exports",
  "allowed": true
}
```

**POST /license/validate**
```json
{
  "valid": true,
  "licenseId": "LIC-2026-001",
  "expiresAt": "2027-01-15T00:00:00Z"
}
```

### Admin Panel Boot Behavior

1. Load activation certificate from encrypted storage
2. Validate certificate signature and machine hash
3. Check `adminPanel` feature enabled
4. Check license not expired (drift-corrected)
5. Check grace period not exceeded
6. If any check fails: show licensing screen
7. If all pass: render dashboard

## Reliability Improvements

### Time Skew Handling

```typescript
function computeDriftedNow(
  lastServerTime: string | null,
  lastServerLocalTime: number | null
): Date {
  if (!lastServerTime || !lastServerLocalTime) return new Date();
  
  const serverTime = new Date(lastServerTime).getTime();
  const drift = Date.now() - lastServerLocalTime;
  return new Date(serverTime + drift);
}
```

**Benefits**:
- Prevents false expiry if local clock rolls back
- Prevents false grace period expiry if clock advances
- Uses server time as source of truth

### Revocation Check Backoff

```typescript
// On failure: increase backoff
backoff = Math.min(backoff * 1.5, MAX_BACKOFF_MS);

// On success: reset backoff
backoff = 5 * 60 * 1000;
```

**Benefits**:
- Reduces server load during network issues
- Prevents lockout on single network failure
- Exponential backoff prevents thundering herd

### Tamper Severity Classification

```typescript
function classifyTamper(
  oldFingerprint: string | null,
  newFingerprint: string,
  flags: TamperFlag[]
): TamperSeverity {
  if (flags.length === 0) return TamperSeverity.NONE;
  if (flags.length === 1) {
    if (flag.type === 'mac' || flag.type === 'productId') {
      return TamperSeverity.LOW;
    }
    return TamperSeverity.MEDIUM;
  }
  if (flags.length === 2) return TamperSeverity.MEDIUM;
  return TamperSeverity.HIGH;
}
```

**Benefits**:
- MAC address changes don't lock app (common in VMs)
- Single component changes trigger revalidation, not lockout
- Only major hardware swaps (3+ components) lock immediately

## Testing

### Test Files

1. **entitlements.test.ts**: Feature definitions and plan mappings
2. **verification.test.ts**: Ed25519, drift correction, tamper classification
3. **seat-enforcement.test.ts**: Server-side seat limit enforcement
4. **revocation-and-grace.test.ts**: Revocation detection and grace period
5. **time-skew.test.ts**: Time drift correction
6. **admin-gating.test.ts**: Admin panel feature gating

### Test Scenarios

Run simulation:
```bash
npx ts-node scripts/simulate-license-scenarios.ts
```

Scenarios:
1. Valid activation certificate
2. Expired certificate
3. Time drift correction
4. Seat limit enforcement
5. Grace period enforcement
6. Tamper severity classification
7. Feature gating
8. Revocation detection

## Backward Compatibility

### Older Certificates (Without Features)

If certificate lacks `features` field:
1. Use plan-based defaults from `PLAN_FEATURES`
2. Merge with any cert features
3. Admin panel requires re-activation to get features

```typescript
function mergeFeatures(
  certFeatures: LicenseFeatures | undefined,
  planFeatures: LicenseFeatures
): LicenseFeatures {
  if (!certFeatures) return planFeatures;
  return { ...planFeatures, ...certFeatures };
}
```

## Deployment Checklist

- [ ] Update Prisma schema and run migration
- [ ] Deploy licensing server with updated routes
- [ ] Update client with EnhancedLicenseService changes
- [ ] Update admin panel with licensing service
- [ ] Run all tests
- [ ] Test seat enforcement with multiple machines
- [ ] Test revocation detection
- [ ] Test time drift scenarios
- [ ] Test admin panel gating
- [ ] Verify backward compatibility with existing licenses

## Troubleshooting

### License Validation Fails

**Symptoms**: "License validation failed" error

**Causes**:
1. Invalid license key format
2. License expired
3. Device already activated
4. Server unreachable
5. Certificate signature invalid

**Solutions**:
- Verify license key format (should contain dot separator)
- Check license expiry date
- Verify device not already activated
- Check internet connection
- Verify public key matches server

### Seat Limit Reached

**Symptoms**: "License seat limit reached" error

**Causes**:
1. All seats already activated
2. License has only 1 seat

**Solutions**:
- Deactivate unused machine
- Purchase additional seats
- Contact support for license transfer

### Admin Panel Shows Licensing Screen

**Symptoms**: Admin panel won't load dashboard

**Causes**:
1. No license activated
2. Admin panel feature not enabled
3. License expired
4. Grace period exceeded

**Solutions**:
- Activate license on client machine
- Verify license plan includes admin panel
- Check license expiry date
- Connect to internet to refresh grace period

### Time Skew Issues

**Symptoms**: License expires unexpectedly or grace period not enforced

**Causes**:
1. Local clock significantly off from server
2. Drift correction not applied

**Solutions**:
- Sync system clock with NTP
- Check server time endpoint
- Verify drift-corrected time in logs

## Security Considerations

1. **Ed25519 Signatures**: Industry-standard cryptography
2. **Hardware Fingerprinting**: Device-specific binding prevents license theft
3. **Encrypted Storage**: Certificates encrypted with hardware-specific key
4. **Grace Period**: Prevents lockout during network issues
5. **Tamper Detection**: Prevents license theft via VM cloning
6. **Revocation Support**: Real-time license invalidation
7. **Audit Logging**: Complete activation/validation history
8. **Time Drift Mitigation**: Prevents clock-based attacks

## Future Enhancements

1. **Policy Profiles**: Bind licenses to management policies
2. **Usage Tracking**: Track feature usage per license
3. **Dynamic Features**: Update features without re-activation
4. **Team Licensing**: Multi-user license management
5. **Offline Activation**: QR code-based offline activation
6. **License Transfer**: Move license between machines

---

**Last Updated**: January 2026
**Version**: 1.8.8
