# Licensing System - Quick Reference

## TL;DR - What Happens When Apps Open on New PC

### Main App (ProduTime Client)

```
┌─────────────────────────────────────────────────────────┐
│ User launches ProduTime                                  │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ App checks: Is there a valid license?                   │
│ ├─ YES → Load app with features                         │
│ └─ NO → Show licensing gate                             │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ User sees two options:                                  │
│ ├─ [Start 7-Day Free Trial]                             │
│ └─ [I Have a License Key]                               │
└─────────────────────────────────────────────────────────┘
                          ↓
        ┌─────────────────┴─────────────────┐
        ↓                                   ↓
   ┌─────────────┐              ┌──────────────────┐
   │ Trial Mode  │              │ Activation Mode  │
   ├─────────────┤              ├──────────────────┤
   │ 7 days      │              │ Enter license    │
   │ All features│              │ Contact server   │
   │ Free        │              │ Get certificate  │
   │ Then locked │              │ Store locally    │
   └─────────────┘              └──────────────────┘
        ↓                                   ↓
   ┌─────────────┐              ┌──────────────────┐
   │ App Runs    │              │ App Runs         │
   │ 7 days      │              │ Features based   │
   │             │              │ on plan          │
   └─────────────┘              └──────────────────┘
```

### Admin Console

```
┌─────────────────────────────────────────────────────────┐
│ User launches Admin Console                             │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ Admin Console starts immediately                        │
│ NO licensing gate                                       │
│ NO activation required                                  │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ Full UI available:                                      │
│ ├─ Dashboard                                            │
│ ├─ Devices                                              │
│ ├─ Policies                                             │
│ ├─ Pairing                                              │
│ └─ Server Logs                                          │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ Optional: Get licensed via pairing with Main App        │
│ ├─ Main App sends certificate                           │
│ ├─ Admin Console stores it                              │
│ └─ Features unlock based on plan                        │
└─────────────────────────────────────────────────────────┘
```

---

## Key Differences

| Aspect | Main App | Admin Console |
|--------|----------|---------------|
| **First Launch** | Shows licensing gate | Shows full UI |
| **Licensing Required** | YES | NO (optional) |
| **Activation** | Manual (trial or key) | Automatic (via pairing) |
| **Server Communication** | Every 12 hours (heartbeat) | Never |
| **Grace Period** | 72 hours if revoked | N/A (local only) |
| **Network Dependency** | Required for activation | Not required |
| **Feature Gating** | Based on license plan | Based on certificate |

---

## User Flows

### Scenario 1: Employee on Day 1

```
1. Install ProduTime
2. See licensing gate
3. Click "Start 7-Day Free Trial"
4. App unlocks, can use all features
5. Pair with Admin Console (optional)
```

### Scenario 2: Employee on Day 8 (Trial Expired)

```
1. ProduTime shows licensing gate again
2. Employee enters license key
3. ProduTime contacts licensing server
4. Server returns certificate with features
5. ProduTime unlocks with licensed features
```

### Scenario 3: Admin Sets Up Office

```
1. Install Admin Console
2. Full UI loads immediately
3. Generate pairing code
4. Employees pair their ProduTime
5. Admin approves pairings
6. Admin can see all devices
```

### Scenario 4: License Gets Revoked

```
1. Admin revokes license in licensing server
2. ProduTime sends heartbeat (next 12 hours)
3. Server returns: "REVOKED"
4. ProduTime enters grace period (72 hours)
5. Shows warning to user
6. After 72 hours: ProduTime locks
```

---

## Feature Availability

### Main App - By Plan

```
Trial (7 days)
├─ Activity tracking ✓
├─ Daily reports ✓
├─ Exports ✓
├─ Admin panel ✗
├─ Managed mode ✗
├─ Advanced reports ✗
├─ Custom branding ✗
└─ API access ✗

Basic
├─ Activity tracking ✓
├─ Daily reports ✓
├─ Exports ✓
├─ Admin panel ✗
├─ Managed mode ✗
├─ Advanced reports ✗
├─ Custom branding ✗
└─ API access ✗

Pro
├─ Activity tracking ✓
├─ Daily reports ✓
├─ Exports ✓
├─ Admin panel ✓
├─ Managed mode ✓
├─ Advanced reports ✓
├─ Custom branding ✗
└─ API access ✗

Enterprise
├─ Activity tracking ✓
├─ Daily reports ✓
├─ Exports ✓
├─ Admin panel ✓
├─ Managed mode ✓
├─ Advanced reports ✓
├─ Custom branding ✓
└─ API access ✓
```

### Admin Console - By License

```
No License
├─ Dashboard ✓
├─ Devices ✓
├─ Policies ✓
├─ Pairing ✓
├─ Admin panel feature ✗
└─ Managed mode ✗

Pro or Enterprise
├─ Dashboard ✓
├─ Devices ✓
├─ Policies ✓
├─ Pairing ✓
├─ Admin panel feature ✓
└─ Managed mode ✓
```

---

## Important Details

### Heartbeat (Main App Only)

```
Every 12 hours:
  - App sends: licenseId, machineHash, appVersion
  - Server responds: status, features, nextCheckAt
  - If REVOKED: Grace period starts (72 hours)
  - If EXPIRED: Grace period starts (72 hours)
  - If OK: Continue normally
```

### Seat Limit

```
1 License = 1 Machine

If user tries to activate on 2nd machine:
  - Server detects: License already active elsewhere
  - Server returns: "SEAT_LIMIT"
  - App shows: "License already in use"
  - User must: Revoke on first machine or use different key
```

### Time Drift Protection

```
If system clock is wrong:
  - App detects drift from server time
  - App applies correction
  - If drift > 30 min: Log warning
  - If drift extreme: May lock app
```

### Network Failure

```
If no internet:
  - App uses exponential backoff
  - 5m → 7.5m → 11.25m → ... → 1h
  - App continues running (grace period)
  - When internet returns: Immediate heartbeat
```

---

## Admin Console Licensing (Special)

Admin Console is different:

1. **No licensing gate** - Opens immediately
2. **No server calls** - All local validation
3. **Optional licensing** - Works without certificate
4. **Gets licensed via**:
   - Pairing with Main App (Main App sends certificate)
   - Manual certificate import
   - API endpoint call

---

## Troubleshooting

### "License key not found"
- Check key is correct
- Check key hasn't been revoked
- Check key is for correct plan

### "License already in use"
- License is active on another machine
- Revoke on first machine or use different key

### "License expired"
- License expiration date has passed
- Renew license or purchase new one
- Grace period: 72 hours remaining

### "No internet connection"
- App continues running (grace period)
- Heartbeat will retry with backoff
- When internet returns: Automatic sync

### "Time is wrong"
- Check system clock
- App will correct automatically
- If extreme: May lock app

---

## Summary

**Main App**: Requires activation (trial or license key), communicates with server every 12 hours, features based on plan

**Admin Console**: No activation required, no server communication, optional licensing via pairing

**Both**: Support feature gating, seat limits, revocation, grace periods, and offline operation

See `LICENSING_FLOW_GUIDE.md` for complete detailed flows.
