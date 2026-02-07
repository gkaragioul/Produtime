# ProduTime - Licensing System Guide

## Overview

ProduTime uses a sophisticated two-tier licensing system:

1. **Legacy System**: Basic activation with device binding
2. **Enhanced System (v1.8)**: Trial mode, offline grace period, tamper detection

This guide covers both systems and how they work together.

---

## System Architecture

### Components

```
ProduTime Client (Electron)
    ↓
Enhanced License Service (v1.8)
    ├── Trial Manager
    ├── Offline Grace Period
    ├── Tamper Detection
    └── Heartbeat Validation
    ↓
License Manager Server (Fastify)
    ├── Activation Endpoint
    ├── Validation Endpoint
    ├── Heartbeat Endpoint
    └── PostgreSQL Database
```

### Key Files

**Client**:
- `src/main/services/license-service.ts` - Legacy license service
- `src/main/services/licensing/EnhancedLicenseService.ts` - v1.8 service
- `src/main/services/licensing/machineFingerprint.ts` - Hardware ID
- `src/main/services/licensing/tamperDetection.ts` - Tamper detection
- `src/main/services/licensing/secureStore.ts` - Encrypted storage

**Server**:
- `licensing-server/api/src/routes/app.ts` - Activation/validation
- `licensing-server/api/src/utils/crypto.ts` - Ed25519 signatures
- `licensing-server/api/prisma/schema.prisma` - Database schema

---

## License Modes

### 1. Trial Mode

**Duration**: 7 days

**Activation**:
```typescript
// Automatic on first launch
const response = await window.api.startTrial();
// Returns: { success: true, expiryDate: "2026-01-22" }
```

**Behavior**:
- App fully functional for 7 days
- Works offline during trial
- No server contact required
- After expiry: Activation modal shown

**Database Storage**:
```sql
INSERT INTO license_activations 
(license_key, device_id, activation_code, plan, expiry_date, activated_at, last_validated_at)
VALUES ('TRIAL', '<device-id>', 'TRIAL-<date>', 'trial', '<7-days-later>', now, now);
```

### 2. Activated Mode

**Activation Process**:
1. User obtains license key from License Manager
2. User enters key in activation modal
3. Client sends activation request to server
4. Server verifies key and device
5. Server returns activation certificate
6. Client stores certificate encrypted

**License Key Format**:
```
<base64-payload>.<base64-signature>
```

**Payload Structure**:
```json
{
  "ver": 1,
  "lic": "LIC-2026-001",
  "prod": "PT",
  "act": "https://license.produtime.com",
  "exp": 1735689600,
  "iat": 1704153600,
  "plan": "pro",
  "seats": 1,
  "metadata": {}
}
```

**Activation Request**:
```typescript
const response = await window.api.activateLicense(licenseKey);
// Returns: { success: true, expiryDate: "2027-01-15" }
```

**Server Validation**:
1. Parse license key
2. Verify Ed25519 signature
3. Check key not revoked
4. Check license not expired
5. Check device binding
6. Create activation certificate
7. Return certificate to client

### 3. Locked Mode

**Triggers**:
- License expired
- License revoked
- Hardware changed (tamper detected)
- Grace period expired (offline too long)

**Behavior**:
- App shows licensing gate
- User cannot access dashboard
- User can retry activation
- User can start new trial

---

## Validation Flow

### Local Validation (Every 30 seconds)

```typescript
// Check if trial expired
if (mode === LicenseMode.TRIAL) {
  const trialEnd = new Date(trialStartDate);
  trialEnd.setDate(trialEnd.getDate() + 7);
  
  if (new Date() > trialEnd) {
    mode = LicenseMode.LOCKED;
  }
}

// Check if certificate expired
if (activationCert && activationCert.exp) {
  if (Date.now() / 1000 > activationCert.exp) {
    mode = LicenseMode.LOCKED;
  }
}
```

### Server Validation (Every 30 minutes)

```typescript
// Send heartbeat to server
POST /v1/heartbeat
{
  "deviceId": "<device-id>",
  "licenseId": "<license-id>",
  "lastSeen": "2026-01-15T14:30:00Z"
}

// Server response
{
  "status": "valid" | "revoked" | "expired",
  "nextCheckAt": "2026-01-15T15:00:00Z"
}
```

### Offline Grace Period (72 hours)

```typescript
// If server unreachable
if (lastServerContact < now - 72 hours) {
  // Grace period expired
  mode = LicenseMode.LOCKED;
} else {
  // Still in grace period
  mode = LicenseMode.ACTIVATED;
}
```

---

## Tamper Detection

### Machine Fingerprint

Hardware fingerprint includes:
- CPU model and serial
- Motherboard serial
- MAC address
- Windows product ID
- Hard drive serial

```typescript
// Generate fingerprint
const fingerprint = getMachineFingerprint();
// Returns: "abc123def456ghi789"

// Store with license
db.setSetting('machine_fingerprint', fingerprint);
```

### Tamper Flags

Detected changes:
- CPU changed
- Motherboard changed
- MAC address changed
- Windows product ID changed
- Hard drive changed

```typescript
interface TamperFlag {
  type: 'cpu' | 'motherboard' | 'mac' | 'product_id' | 'drive';
  oldValue: string;
  newValue: string;
  detectedAt: string;
}
```

### Tamper Response

```typescript
// On tamper detection
if (detectTamper()) {
  // Store tamper flags
  storeTamperFlags(flags);
  
  // Require reactivation
  mode = LicenseMode.LOCKED;
  
  // Show message
  showDialog('Hardware changed. Please reactivate license.');
}
```

---

## Encryption & Security

### License Key Encryption

License keys stored encrypted in database:

```typescript
// Encrypt
const encrypted = encryptionService.encrypt(licenseKey);
db.setSetting('license_key', encrypted);

// Decrypt
const decrypted = encryptionService.decrypt(encrypted);
```

### Activation Certificate Encryption

Certificates stored encrypted:

```typescript
// Store
const encrypted = encryptionService.encrypt(JSON.stringify(cert));
db.setSetting('activation_cert', encrypted);

// Retrieve
const decrypted = encryptionService.decrypt(encrypted);
const cert = JSON.parse(decrypted);
```

### Ed25519 Signature Verification

All licenses signed with Ed25519:

```typescript
// Verify signature
const isValid = verifySignature(
  payload,
  signature,
  publicKey
);

if (!isValid) {
  throw new Error('Invalid license signature');
}
```

### Public Key

```typescript
// Embedded in app
export const ED25519_PUBLIC_KEY = 
  "yBpM6mVTBbG9j8SmQlQFvRWlL8TfOwHuzWEO7zhHzgw=";
```

---

## Server API

### Activation Endpoint

**POST** `/v1/activate`

**Request**:
```json
{
  "licenseKey": "<base64-payload>.<base64-signature>",
  "machineHash": "<device-fingerprint>",
  "appVersion": "1.8.8"
}
```

**Response (Success)**:
```json
{
  "status": "activated",
  "activationCert": {
    "licenseId": "LIC-2026-001",
    "deviceId": "abc123def456",
    "plan": "pro",
    "expiryDate": "2027-01-15",
    "issuedAt": "2026-01-15T10:00:00Z",
    "nextCheckAt": "2026-01-15T10:30:00Z"
  }
}
```

**Response (Error)**:
```json
{
  "error": "License key not found" | "License expired" | "Device already activated"
}
```

### Validation Endpoint

**POST** `/v1/validate`

**Request**:
```json
{
  "deviceId": "<device-id>",
  "licenseId": "<license-id>",
  "activationCode": "<activation-code>"
}
```

**Response**:
```json
{
  "status": "valid" | "revoked" | "expired",
  "nextCheckAt": "2026-01-15T15:00:00Z"
}
```

### Heartbeat Endpoint

**POST** `/v1/heartbeat`

**Request**:
```json
{
  "deviceId": "<device-id>",
  "licenseId": "<license-id>",
  "lastSeen": "2026-01-15T14:30:00Z"
}
```

**Response**:
```json
{
  "status": "ok",
  "nextCheckAt": "2026-01-15T15:00:00Z"
}
```

---

## Database Schema (Server)

### Licenses Table

```sql
CREATE TABLE licenses (
  id SERIAL PRIMARY KEY,
  customer_name VARCHAR(255) NOT NULL,
  plan VARCHAR(50) NOT NULL,
  seats INT DEFAULT 1,
  expiry_date TIMESTAMP,
  status VARCHAR(50) DEFAULT 'ACTIVE',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### License Keys Table

```sql
CREATE TABLE license_keys (
  id SERIAL PRIMARY KEY,
  license_id INT REFERENCES licenses(id),
  key_hash VARCHAR(64) UNIQUE NOT NULL,
  issued_for_machine_hash VARCHAR(64),
  revoked_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### Machines Table

```sql
CREATE TABLE machines (
  id SERIAL PRIMARY KEY,
  license_id INT REFERENCES licenses(id),
  machine_hash VARCHAR(64) NOT NULL,
  status VARCHAR(50) DEFAULT 'ACTIVE',
  last_seen TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Activations Table

```sql
CREATE TABLE activations (
  id SERIAL PRIMARY KEY,
  license_id INT REFERENCES licenses(id),
  machine_id INT REFERENCES machines(id),
  activation_code VARCHAR(255) UNIQUE NOT NULL,
  activated_at TIMESTAMP DEFAULT NOW(),
  last_validated_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## Configuration

### Client Configuration

**File**: `src/shared/licensing-config.ts`

```typescript
// Ed25519 Public Key
export const ED25519_PUBLIC_KEY = 
  process.env.ED25519_PUBLIC_KEY || 
  "yBpM6mVTBbG9j8SmQlQFvRWlL8TfOwHuzWEO7zhHzgw=";

// License Server URL
export const LICENSE_SERVER_URL = 
  process.env.LICENSE_SERVER_URL || 
  "https://produtime-licensing-server-production.up.railway.app";

// Heartbeat interval
export const HEARTBEAT_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours

// Grace period
export const GRACE_PERIOD_MS = 72 * 60 * 60 * 1000; // 72 hours

// Trial period
export const TRIAL_PERIOD_DAYS = 7;
```

### Server Configuration

**File**: `licensing-server/api/src/config.ts`

```typescript
export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000'),
  
  database: {
    url: process.env.DATABASE_URL,
  },
  
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
  },
  
  crypto: {
    privateKey: process.env.ED25519_PRIVATE_KEY,
    publicKey: process.env.ED25519_PUBLIC_KEY,
  },
  
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
  },
};
```

---

## Troubleshooting

### License Validation Fails

**Symptoms**: "License validation failed" error

**Causes**:
1. Invalid license key format
2. License expired
3. Device already activated
4. Server unreachable

**Solutions**:
```typescript
// Check license key format
if (!licenseKey.includes('.')) {
  throw new Error('Invalid license key format');
}

// Check expiry
if (new Date(expiryDate) < new Date()) {
  throw new Error('License expired');
}

// Check server connectivity
try {
  await fetch(LICENSE_SERVER_URL);
} catch (e) {
  console.error('Server unreachable:', e);
}
```

### Hardware Changed Error

**Symptoms**: "Hardware changed. Please reactivate license."

**Causes**:
1. CPU changed
2. Motherboard changed
3. MAC address changed
4. Hard drive changed

**Solutions**:
1. Reactivate license with new hardware
2. Contact support for license transfer
3. Check if hardware detection is accurate

### Grace Period Expired

**Symptoms**: "License locked. Please connect to internet."

**Causes**:
1. No internet connection for 72+ hours
2. Server unreachable

**Solutions**:
1. Connect to internet
2. Check firewall/proxy settings
3. Verify server URL in settings

### Trial Expired

**Symptoms**: "Trial period expired. Please activate license."

**Causes**:
1. 7 days have passed since trial start
2. Trial not activated

**Solutions**:
1. Activate with license key
2. Start new trial (if available)
3. Contact support

---

## Development & Testing

### Generate Test License

```bash
# Generate keypair
npm run license:keypair

# Generate test license
npm run license:generate

# Activate license
npm run license:activate
```

### Test Activation Flow

```typescript
// 1. Start trial
const trialResponse = await window.api.startTrial();
console.log('Trial started:', trialResponse);

// 2. Get device ID
const deviceId = await window.electronAPI.getDeviceId();
console.log('Device ID:', deviceId);

// 3. Activate license
const activateResponse = await window.api.activateLicense(licenseKey);
console.log('License activated:', activateResponse);

// 4. Check status
const status = await window.api.getLicenseStatus();
console.log('License status:', status);
```

### Mock Server for Testing

```typescript
// Mock activation endpoint
jest.mock('fetch', () => ({
  __esModule: true,
  default: jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        status: 'activated',
        activationCert: { /* ... */ }
      })
    })
  )
}));
```

---

## Deployment

### Server Deployment

1. **Generate keypair**:
```bash
npm run license:keypair
```

2. **Set environment variables**:
```bash
ED25519_PRIVATE_KEY=<private-key>
ED25519_PUBLIC_KEY=<public-key>
DATABASE_URL=postgresql://...
JWT_ACCESS_SECRET=<secret>
JWT_REFRESH_SECRET=<secret>
```

3. **Deploy to Railway/Heroku**:
```bash
npm run package:license-manager
```

### Client Deployment

1. **Update public key** in `src/shared/licensing-config.ts`
2. **Update server URL** in `src/shared/licensing-config.ts`
3. **Build and package**:
```bash
npm run package:produtime
```

---

## Best Practices

1. **Always verify signatures**: Never trust unsigned licenses
2. **Encrypt sensitive data**: Use encryption for keys and certificates
3. **Implement grace period**: Allow offline operation for 72 hours
4. **Monitor revocations**: Check server regularly for revoked licenses
5. **Log audit trail**: Track all activation/validation events
6. **Handle errors gracefully**: Show user-friendly error messages
7. **Test offline scenarios**: Ensure app works without internet
8. **Rotate keys regularly**: Change public/private keys periodically

---

**Last Updated**: January 2026
