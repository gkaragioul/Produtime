# ProduTime Licensing Flow - Complete User Journey

## Overview

The licensing system works differently for the **Main App (ProduTime Client)** and the **Admin Console**. Here's exactly what happens when both open on a new PC.

---

## MAIN APP (ProduTime Client) - User Flow

### Scenario 1: First Time Opening on New PC

```
User launches ProduTime Client
    ↓
App checks database for license_state table
    ├─ Table exists → Load existing state
    └─ Table doesn't exist → Create new table
    ↓
App checks: Is there an existing license state?
    ├─ YES → Load it
    └─ NO → Create initial state (LOCKED mode)
    ↓
App detects tampering (checks if license files were modified)
    ├─ High severity tampering detected → LOCK app immediately
    └─ No tampering → Continue
    ↓
App loads current mode from database
    ├─ TRIAL mode → Check if 7 days have passed
    │   ├─ YES → Lock app
    │   └─ NO → Allow app to run
    ├─ ACTIVATED mode → Check if license is still valid
    │   ├─ YES → Allow app to run
    │   └─ NO → Lock app
    └─ LOCKED mode → Show licensing gate
    ↓
LicensingGate Component Renders
```

### What User Sees (LOCKED Mode)

```
┌─────────────────────────────────────────┐
│         ProduTime Logo                  │
│                                         │
│    Welcome to ProduTime                 │
│    Get started with a 7-day free       │
│    trial or activate with a license key│
│                                         │
│  [Start 7-Day Free Trial]               │
│  [I Have a License Key]                 │
└─────────────────────────────────────────┘
```

### User Choice 1: Start Trial

```
User clicks "Start 7-Day Free Trial"
    ↓
App calls: window.api.startTrial()
    ↓
Backend:
  - Creates license_state record with mode='trial'
  - Sets trialStart = now
  - Stores in SQLite database
    ↓
App refreshes license status
    ↓
LicensingGate calls onActivated()
    ↓
Main app UI loads and runs normally
    ↓
User can use all features for 7 days
    ↓
After 7 days:
  - App detects trial expired
  - Locks app again
  - Shows licensing gate
  - User must enter license key or trial ends
```

### User Choice 2: Enter License Key

```
User clicks "I Have a License Key"
    ↓
LicensingGate shows activation form
    ↓
User enters license key (e.g., PT1-XXXXXXXXXXXXXXXX...)
    ↓
User clicks "Activate"
    ↓
App calls: window.api.activateLicense(licenseKey)
    ↓
Backend:
  1. Sends activation request to licensing server:
     POST /v1/activate
     {
       licenseKey: "PT1-...",
       machineHash: "abc123...",
       appVersion: "1.8.8"
     }
    ↓
  2. Licensing Server:
     - Verifies license key signature
     - Checks if license is active
     - Checks if license has expired
     - Checks seat limit (1 license = 1 machine)
     - Returns activation certificate with features
    ↓
  3. App receives certificate:
     {
       certPayload: {
         licenseId: "lic_123",
         plan: "Pro",
         features: {
           adminPanel: true,
           managedMode: true,
           exports: true,
           advancedReports: true,
           customBranding: false,
           apiAccess: false
         },
         expiresAt: "2027-01-14T00:00:00Z",
         serverTime: "2026-01-14T12:00:00Z"
       },
       certSignature: "..."
     }
    ↓
  4. App verifies certificate signature using Ed25519
    ↓
  5. App stores certificate in encrypted form in database
    ↓
  6. App updates license_state:
     - mode = 'activated'
     - activationCert = encrypted_cert
     - features = { adminPanel: true, ... }
    ↓
LicensingGate calls onActivated()
    ↓
Main app UI loads with features enabled based on plan
    ↓
User can now use all licensed features
```

### Ongoing: Heartbeat Checks

```
Every 12 hours:
    ↓
App sends heartbeat to licensing server:
    POST /v1/heartbeat
    {
      licenseId: "lic_123",
      machineHash: "abc123...",
      appVersion: "1.8.8"
    }
    ↓
Licensing Server:
  - Checks if license is still active
  - Checks if license is revoked
  - Checks if license expired
  - Returns status + features
    ↓
App receives response:
  {
    status: "OK" | "REVOKED" | "EXPIRED",
    features: { ... },
    nextCheckAt: "2026-01-14T12:00:00Z"
  }
    ↓
If status = "OK":
  - App continues running normally
  - Updates next heartbeat time
    ↓
If status = "REVOKED" or "EXPIRED":
  - App enters grace period (72 hours)
  - Shows warning to user
  - After 72 hours: app locks
```

### Network Failure Handling

```
If heartbeat fails (no internet):
    ↓
App uses exponential backoff:
  - 1st attempt: 5 minutes
  - 2nd attempt: 7.5 minutes
  - 3rd attempt: 11.25 minutes
  - ... up to 1 hour max
    ↓
App continues running (grace period)
    ↓
When internet returns:
  - App immediately sends heartbeat
  - If license is valid: continue
  - If license is revoked: lock app
```

### Time Drift Handling

```
If system clock is wrong (e.g., user sets time back):
    ↓
App detects drift between server time and local time
    ↓
App applies drift correction:
  - Uses server time from last heartbeat
  - Calculates offset
  - Applies offset to all time checks
    ↓
If drift > 30 minutes:
  - App logs warning
  - Continues with corrected time
    ↓
If drift is extreme:
  - App may lock as security measure
```

---

## ADMIN CONSOLE - User Flow

### Scenario: First Time Opening on New PC

```
User launches Admin Console
    ↓
Admin Console initializes:
  1. Creates SQLite database (if not exists)
  2. Creates tables for devices, policies, etc.
  3. Starts local server on port 17888
  4. Loads UI
    ↓
Admin Console does NOT have licensing gate
    ↓
Admin Console shows full UI immediately
    ├─ Dashboard
    ├─ Devices
    ├─ Policies
    ├─ Pairing
    └─ Server Logs
```

### Admin Console Licensing (Local Validation)

```
Admin Console licensing is DIFFERENT from Main App:

1. NO activation required
2. NO licensing server calls
3. Local validation only

When Admin Console starts:
    ↓
AdminLicensingService initializes:
  - Checks if activation certificate exists in database
  - If exists: validates certificate locally
  - If not exists: sets status to "not licensed"
    ↓
Admin Console features:
  - Dashboard: Always available
  - Device management: Always available
  - Policy management: Always available
  - Pairing: Always available
    ↓
Feature gating (if certificate exists):
  - adminPanel feature: Check certificate
  - managedMode feature: Check certificate
  - Other features: Check certificate
    ↓
If feature is NOT allowed:
  - UI shows feature as disabled
  - User cannot access that feature
```

### How Admin Console Gets Licensed

```
Admin Console gets licensed through:

Option 1: Pairing with Main App
  - Main App sends activation certificate to Admin Console
  - Admin Console stores certificate
  - Admin Console validates certificate locally
  - Features are now enabled
    ↓
Option 2: Manual certificate import
  - Admin manually imports certificate file
  - Admin Console validates and stores it
  - Features are now enabled
    ↓
Option 3: API endpoint
  - External system calls: POST /license/validate
  - Provides certificate
  - Admin Console validates and stores it
  - Features are now enabled
```

---

## Feature Gating Matrix

### Main App Features (Based on License Plan)

| Feature | Trial | Basic | Pro | Enterprise |
|---------|-------|-------|-----|------------|
| Activity tracking | ✓ | ✓ | ✓ | ✓ |
| Daily reports | ✓ | ✓ | ✓ | ✓ |
| Exports | ✓ | ✓ | ✓ | ✓ |
| Admin panel access | ✗ | ✗ | ✓ | ✓ |
| Managed mode | ✗ | ✗ | ✓ | ✓ |
| Advanced reports | ✗ | ✗ | ✓ | ✓ |
| Custom branding | ✗ | ✗ | ✗ | ✓ |
| API access | ✗ | ✗ | ✗ | ✓ |

### Admin Console Features (Based on License Plan)

| Feature | No License | Pro | Enterprise |
|---------|-----------|-----|-----------|
| Dashboard | ✓ | ✓ | ✓ |
| Device list | ✓ | ✓ | ✓ |
| Device detail | ✓ | ✓ | ✓ |
| Policy management | ✓ | ✓ | ✓ |
| Pairing | ✓ | ✓ | ✓ |
| Admin panel feature | ✗ | ✓ | ✓ |
| Managed mode | ✗ | ✓ | ✓ |

---

## Complete Scenario: New Office Setup

### Day 1: Admin Sets Up

```
1. Admin installs Admin Console on their PC
   ↓
2. Admin Console starts immediately (no licensing required)
   ↓
3. Admin sees dashboard, devices, policies, pairing
   ↓
4. Admin generates pairing code
   ↓
5. Admin waits for employees to pair their devices
```

### Day 1: Employee Gets ProduTime

```
1. Employee installs ProduTime Client
   ↓
2. ProduTime shows licensing gate (LOCKED mode)
   ↓
3. Employee chooses: "Start 7-Day Free Trial"
   ↓
4. ProduTime enters TRIAL mode
   ↓
5. Employee can use all features for 7 days
   ↓
6. Employee pairs with Admin Console using pairing code
   ↓
7. Admin approves pairing
   ↓
8. Admin Console can now see employee's device
```

### Day 8: Employee Needs License

```
1. Employee's 7-day trial expires
   ↓
2. ProduTime shows licensing gate again
   ↓
3. Employee enters license key (provided by admin)
   ↓
4. ProduTime activates license
   ↓
5. ProduTime contacts licensing server
   ↓
6. Licensing server returns certificate with features
   ↓
7. ProduTime stores certificate
   ↓
8. ProduTime enters ACTIVATED mode
   ↓
9. Employee can now use licensed features
   ↓
10. Admin Console can see employee's license status
```

### Ongoing: Daily Operations

```
Every 12 hours:
  - ProduTime sends heartbeat to licensing server
  - Licensing server confirms license is valid
  - ProduTime continues running
    ↓
Admin Console:
  - Continuously monitors connected devices
  - Shows device status in real-time
  - Can push policies to devices
  - Can see activity data
    ↓
If license is revoked:
  - Licensing server returns REVOKED status
  - ProduTime enters grace period (72 hours)
  - After 72 hours: ProduTime locks
  - Admin Console shows device as unlicensed
```

---

## Error Scenarios

### Scenario 1: Invalid License Key

```
User enters invalid license key
    ↓
App sends to licensing server
    ↓
Server returns: "Invalid license key"
    ↓
App shows error: "License key not found"
    ↓
User must enter valid key or start trial
```

### Scenario 2: License Seat Limit Exceeded

```
User tries to activate on 2nd machine with same license
    ↓
App sends activation request
    ↓
Server checks: License already active on different machine
    ↓
Server returns: "SEAT_LIMIT - License already in use"
    ↓
App shows error: "This license is already in use on another device"
    ↓
User must:
  - Use different license key, OR
  - Revoke license on first machine
```

### Scenario 3: License Expired

```
User's license expiration date passes
    ↓
App sends heartbeat
    ↓
Server returns: "EXPIRED"
    ↓
App enters grace period (72 hours)
    ↓
App shows warning: "License expired, 72 hours remaining"
    ↓
After 72 hours:
  - App locks
  - Shows licensing gate
  - User must renew license
```

### Scenario 4: No Internet Connection

```
App tries to send heartbeat
    ↓
Network request fails
    ↓
App uses exponential backoff (5m → 7.5m → 11.25m → ... → 1h)
    ↓
App continues running (grace period)
    ↓
When internet returns:
  - App immediately sends heartbeat
  - If license valid: continue
  - If license revoked: lock app
```

---

## Summary

### Main App (ProduTime Client)
- **First Run**: Shows licensing gate (LOCKED)
- **User Choice**: Start trial OR enter license key
- **Trial**: 7 days, all features
- **Licensed**: Features based on plan
- **Heartbeat**: Every 12 hours to licensing server
- **Grace Period**: 72 hours if license revoked
- **Network Failure**: Continues with exponential backoff

### Admin Console
- **First Run**: Shows full UI immediately (no licensing gate)
- **Licensing**: Optional, local validation only
- **Features**: All available without license
- **Feature Gating**: Based on certificate if present
- **No Heartbeat**: No server communication needed
- **No Grace Period**: Local validation only

### Licensing Server
- **Activation**: Verifies key, checks seat limit, returns certificate
- **Heartbeat**: Confirms license status, returns features
- **Revocation**: Marks license as revoked
- **Audit**: Logs all actions for compliance

---

This is the complete flow. Both apps work independently but can be paired for better management.
