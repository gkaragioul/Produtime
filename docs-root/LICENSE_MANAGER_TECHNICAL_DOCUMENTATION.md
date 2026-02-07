# ProduTime License Manager - Technical Documentation

## Executive Summary

ProduTime uses a sophisticated two-tier licensing system with client-side and server-side components. The system supports trial periods, device-specific activation, offline grace periods, tamper detection, and real-time revocation checks.

## System Architecture

### High-Level Overview

Client (Electron) ↔ EnhancedLicenseService ↔ License Manager Server (Fastify)
                                    ↓
                            PostgreSQL Database

### Key Components

**Client-Side**:
- EnhancedLicenseService: Main license state machine
- LicenseCryptoService: Ed25519 signature verification
- SecureStore: Encrypted certificate storage
- MachineFingerprint: Hardware identification
- TamperDetection: Hardware change monitoring

**Server-Side**:
- Fastify API: REST endpoints for activation/validation
- PostgreSQL: License and machine records
- Audit Logging: All activation/validation events

## License Modes

### 1. TRIAL Mode
- Duration: 7 days
- Fully functional, no server contact required
- Works offline
- Automatic activation on first run

### 2. ACTIVATED Mode
- License key successfully validated
- Device-specific binding (machine hash)
- Activation certificate stored encrypted
- Server heartbeat every 12 hours
- 72-hour offline grace period
- Real-time revocation detection (5-minute checks)

### 3. LOCKED Mode
- Trial expired
- License revoked/expired
- Hardware changed (tamper detected)
- Grace period exceeded
- User must activate or start new trial

## Activation Flow

1. User enters license key
2. Client sends activation request with machine hash
3. Server validates key, checks revocation, verifies device binding
4. Server creates/updates machine record
5. Server generates signed activation certificate
6. Server stores activation record
7. Client stores certificate encrypted
8. Client transitions to ACTIVATED mode

## Heartbeat & Validation

- Interval: Every 12 hours
- Revocation Check: Every 5 minutes (faster)
- Grace Period: 72 hours offline before lockout
- Server checks license status and reports revocation/expiration
- Client verifies signature and updates state

## Offline Grace Period

- Allows 72 hours of offline work
- Grace period resets on server contact
- After 72 hours: app locks on next startup

## Tamper Detection

Hardware fingerprint includes:
- CPU model and serial
- Motherboard serial
- MAC address
- Windows product ID
- Hard drive serial

On tamper detection:
- Trial mode: Immediate lockout
- Activated mode: Force heartbeat, check server response

## Encryption & Security

- License keys: Encrypted in database
- Activation certificates: Encrypted with hardware-specific key
- Ed25519 signatures: All licenses and responses signed
- Public key: Embedded in app binary

## Database Schema (Client)

license_state table:
- id (PRIMARY KEY, always 1)
- mode (trial/activated/locked)
- trialStart (ISO date)
- lastSeen (ISO date)
- lastServerTime (ISO date)
- nextCheckAt (ISO date)
- activationCertEncrypted (BLOB)
- tamperFlags (JSON)

## Database Schema (Server)

- licenses: License records
- license_keys: License key hashes & revocation status
- machines: Device activation records
- activations: Activation certificates & timestamps
- audit_logs: All activation/validation events

## Configuration

Client: src/shared/licensing-config.ts
- ED25519_PUBLIC_KEY
- LICENSE_SERVER_URL
- HEARTBEAT_INTERVAL_MS (12 hours)
- GRACE_PERIOD_MS (72 hours)
- TRIAL_PERIOD_DAYS (7)
- REVOCATION_CHECK_INTERVAL_MS (5 minutes)

Server: licensing-server/api/src/config.ts
- DATABASE_URL
- ED25519_PRIVATE_KEY
- ED25519_PUBLIC_KEY
- JWT secrets
- CORS origin

## Error Handling

Invalid License Key → 400 Bad Request
License Expired → 403 Forbidden
Device Already Activated → 403 Forbidden
Network Error → Continue with grace period
Tamper Detected → Lock (trial) or force heartbeat (activated)

## Monitoring & Logging

All license events logged:
- Client: Console and file logs
- Server: Audit logs table with action, license ID, machine hash, IP, timestamp

## Best Practices

1. Always verify signatures
2. Encrypt sensitive data
3. Implement grace period
4. Monitor revocations
5. Log audit trail
6. Handle errors gracefully
7. Test offline scenarios
8. Rotate keys regularly
9. Validate on startup
10. Broadcast lockout immediately

## Performance

- Heartbeat: Async, non-blocking, 12-hour interval
- Revocation checks: Lightweight, 5-minute interval
- Tamper detection: Runs once on startup
- Encryption: Hardware-specific key, minimal overhead
- Database: Single license_state record, efficient queries

## Security

- Ed25519 signatures: Industry-standard cryptography
- Hardware fingerprinting: Device-specific binding
- Encrypted storage: Sensitive data encrypted at rest
- Grace period: Prevents lockout during network issues
- Tamper detection: Prevents license theft via VM cloning
- Revocation support: Real-time license invalidation
- Audit logging: Complete activation/validation history

Last Updated: January 2026
Version: 1.8.8
