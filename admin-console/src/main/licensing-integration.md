# Admin Console Licensing Integration Guide

## Overview

This guide shows how to integrate the licensing service into the Admin Console server.

## Integration Steps

### 1. Update `admin-console/src/main/main.ts`

Add licensing service initialization:

```typescript
import { AdminLicensingService } from './licensing-service';
import { licensingRoutes } from './licensing-routes';

let licensingService: AdminLicensingService | null = null;

async function initializeServices(): void {
  // ... existing code ...

  // Initialize licensing service
  licensingService = new AdminLicensingService(db, ED25519_PUBLIC_KEY);
  const licenseStatus = await licensingService.init();
  
  if (!licenseStatus.licensed) {
    console.warn('[ADMIN] License not valid:', licenseStatus.reason);
    // Admin panel will show licensing screen
  } else {
    console.log('[ADMIN] License valid:', licenseStatus.licenseId);
  }

  // Register licensing routes
  await licensingRoutes(server.fastify, licensingService);
}
```

### 2. Update `admin-console/src/main/server.ts`

Add licensing routes registration:

```typescript
import { licensingRoutes } from './licensing-routes';

export class AdminServer {
  // ... existing code ...

  async start(): Promise<void> {
    // ... existing routes ...

    // Register licensing routes
    if (this.licensingService) {
      await licensingRoutes(this.httpServer, this.licensingService);
    }

    // ... rest of startup ...
  }
}
```

### 3. Update Admin UI (`admin-console/src/renderer/App.tsx`)

Add licensing gate:

```typescript
import { useEffect, useState } from 'react';

export function App() {
  const [licensed, setLicensed] = useState<boolean | null>(null);
  const [licenseStatus, setLicenseStatus] = useState<any>(null);

  useEffect(() => {
    // Check license status on startup
    fetch('http://localhost:9000/license/status')
      .then(res => res.json())
      .then(status => {
        setLicensed(status.licensed);
        setLicenseStatus(status);
      })
      .catch(err => {
        console.error('Failed to check license:', err);
        setLicensed(false);
      });
  }, []);

  if (licensed === null) {
    return <div>Loading...</div>;
  }

  if (!licensed) {
    return (
      <div className="licensing-screen">
        <h1>Admin Console License Required</h1>
        <p>{licenseStatus?.reason || 'No license activated'}</p>
        <p>Please activate a license on the ProduTime client machine.</p>
      </div>
    );
  }

  // Render normal dashboard
  return (
    <div className="admin-dashboard">
      {/* ... existing dashboard code ... */}
    </div>
  );
}
```

### 4. Add License Status Display

Add to admin dashboard header:

```typescript
function AdminHeader() {
  const [licenseInfo, setLicenseInfo] = useState<any>(null);

  useEffect(() => {
    fetch('http://localhost:9000/license/status')
      .then(res => res.json())
      .then(setLicenseInfo)
      .catch(console.error);
  }, []);

  return (
    <header className="admin-header">
      <h1>ProduTime Admin Console</h1>
      {licenseInfo && (
        <div className="license-info">
          <span>License: {licenseInfo.licenseId}</span>
          {licenseInfo.expiresAt && (
            <span>Expires: {new Date(licenseInfo.expiresAt).toLocaleDateString()}</span>
          )}
          <span>Seats: {licenseInfo.seatsUsed}/{licenseInfo.seatsTotal}</span>
        </div>
      )}
    </header>
  );
}
```

### 5. Add Feature Gating

Gate features based on license:

```typescript
function FeatureGate({ feature, children }: { feature: string; children: React.ReactNode }) {
  const [allowed, setAllowed] = useState<boolean>(false);

  useEffect(() => {
    fetch(`http://localhost:9000/license/check/${feature}`)
      .then(res => res.json())
      .then(data => setAllowed(data.allowed))
      .catch(() => setAllowed(false));
  }, [feature]);

  if (!allowed) {
    return (
      <div className="feature-locked">
        <p>This feature is not included in your license plan.</p>
        <p>Upgrade to Pro or Enterprise to unlock this feature.</p>
      </div>
    );
  }

  return <>{children}</>;
}

// Usage:
<FeatureGate feature="customBranding">
  <BrandingSettings />
</FeatureGate>
```

## Environment Variables

Add to `.env` or `.env.local`:

```bash
# Admin Console
ADMIN_PORT=9000
ADMIN_HOST=localhost

# Licensing
ED25519_PUBLIC_KEY=yBpM6mVTBbG9j8SmQlQFvRWlL8TfOwHuzWEO7zhHzgw=
LICENSE_SERVER_URL=https://produtime-licensing-server-production.up.railway.app
```

## Testing

### Test License Status Endpoint

```bash
curl http://localhost:9000/license/status
```

Expected response:
```json
{
  "licensed": true,
  "features": {
    "adminPanel": true,
    "exports": true,
    "advancedReports": true
  },
  "licenseId": "LIC-2026-001",
  "expiresAt": "2027-01-15T00:00:00Z",
  "seatsUsed": 1,
  "seatsTotal": 5
}
```

### Test Feature Check

```bash
curl http://localhost:9000/license/check/customBranding
```

Expected response:
```json
{
  "feature": "customBranding",
  "allowed": false
}
```

### Test License Validation

```bash
curl -X POST http://localhost:9000/license/validate
```

Expected response:
```json
{
  "valid": true,
  "licenseId": "LIC-2026-001",
  "expiresAt": "2027-01-15T00:00:00Z"
}
```

## Error Handling

### No License Activated

```json
{
  "licensed": false,
  "reason": "No license activated"
}
```

### Admin Panel Feature Not Enabled

```json
{
  "licensed": false,
  "reason": "Admin panel feature not included in license"
}
```

### License Expired

```json
{
  "licensed": false,
  "reason": "License has expired"
}
```

### Grace Period Exceeded

```json
{
  "licensed": false,
  "reason": "License grace period exceeded - please connect to internet"
}
```

## Troubleshooting

### Admin Panel Shows Licensing Screen

**Cause**: License not activated or admin panel feature not enabled

**Solution**:
1. Activate license on ProduTime client machine
2. Verify license plan includes admin panel (Pro or Enterprise)
3. Restart admin console

### License Status Endpoint Returns 500

**Cause**: Licensing service not initialized

**Solution**:
1. Check admin console logs for initialization errors
2. Verify ED25519_PUBLIC_KEY environment variable set
3. Verify activation certificate exists on client machine

### Feature Check Always Returns false

**Cause**: License not valid or feature not enabled

**Solution**:
1. Check license status endpoint
2. Verify license plan includes feature
3. Check license expiry date

## Security Notes

1. **Local Validation Only**: Admin panel validates license locally using encrypted certificate
2. **No Server Contact Required**: Admin panel works offline (within grace period)
3. **Machine Binding**: Admin panel bound to same machine as client
4. **Signature Verification**: All certificates verified with Ed25519 public key
5. **Encrypted Storage**: Certificates encrypted with hardware-specific key

## Performance

- License status check: < 1ms (local validation)
- Feature check: < 1ms (local validation)
- License validation: < 1ms (local validation)
- No network calls required (uses cached certificate)

## Future Enhancements

1. Real-time license status updates via WebSocket
2. License usage tracking
3. Feature usage analytics
4. License renewal reminders
5. Multi-license support

---

**Last Updated**: January 2026
**Version**: 1.8.8
