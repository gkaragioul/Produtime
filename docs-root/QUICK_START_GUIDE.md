# ProduTime - Quick Start Guide for New Developers

## Getting Started (5 minutes)

### 1. Clone and Install
```bash
git clone https://github.com/georgekgr12/timeport.git
cd timeport
npm install
```

### 2. Build the Project
```bash
npm run build:safe
```

### 3. Run the App
```bash
npm start
```

## Project Structure Quick Reference

```
src/
├── main/                          # Electron main process
│   ├── main.ts                   # App entry point
│   ├── ipc-handlers.ts           # IPC request handlers
│   ├── database.ts               # SQLite database manager
│   ├── preload.ts                # Preload script (IPC bridge)
│   ├── services/
│   │   ├── activity-tracker.ts   # Window activity monitoring
│   │   ├── license-service.ts    # License validation
│   │   ├── auto-export-scheduler.ts
│   │   ├── privacy-constants.ts
│   │   └── licensing/
│   │       └── EnhancedLicenseService.ts
│   ├── pdf-generator.ts          # PDF report generation
│   ├── auto-updater.ts           # Update management
│   ├── system-tray.ts            # System tray integration
│   └── report-scheduler.ts       # Scheduled exports
├── renderer/                      # React UI
│   ├── App.tsx                   # Main component
│   ├── components/
│   │   ├── ActivityDashboard.tsx
│   │   ├── SettingsTab.tsx
│   │   ├── AdminLoginDialog.tsx
│   │   └── licensing/
│   │       └── LicensingGate.tsx
│   └── services/
│       ├── ipc-service.ts        # IPC wrapper
│       ├── admin-auth-service.ts
│       └── pdf-report-service.ts
├── shared/
│   ├── types.ts                  # Shared type definitions
│   └── licensing-config.ts       # Licensing configuration
└── types/                         # Additional types

licensing-server/                  # Separate licensing server
├── api/
│   ├── src/
│   │   ├── index.ts              # Fastify server
│   │   ├── routes/
│   │   │   ├── app.ts            # Activation/validation
│   │   │   ├── licenses.ts       # License management
│   │   │   └── auth.ts           # Admin auth
│   │   └── utils/
│   │       ├── crypto.ts         # Ed25519 signatures
│   │       └── licenseKey.ts
│   └── prisma/
│       └── schema.prisma         # Database schema
└── admin/                         # Admin dashboard
```

## Key Concepts

### 1. IPC Communication
- **Main ↔ Renderer**: Electron IPC with typed channels
- **Preload script**: Exposes `window.electronAPI` and `window.api`
- **Pattern**: Request/Response with `IPCResponse<T>` wrapper

Example:
```typescript
// Renderer
const response = await window.electronAPI.getActivityLogs({ limit: 100 });

// Main (ipc-handlers.ts)
ipcMain.handle('activity:getLogs', async (event, request) => {
  return { success: true, data: logs };
});
```

### 2. Database
- **Type**: SQLite with WAL mode
- **Location**: `%APPDATA%/produtime/produtime.db` (Windows)
- **Encryption**: Hardware-specific encryption key
- **Manager**: `DatabaseManager` class handles all DB operations

### 3. Activity Tracking
- **Mechanism**: Polls active window every 500ms
- **Library**: `active-win` (native module)
- **Privacy**: Sanitizes sensitive app titles
- **Storage**: Persisted in `activity_logs` table

### 4. Licensing (v1.8)
- **Trial**: 7 days free
- **Activation**: Device-specific binding
- **Offline**: 72-hour grace period
- **Validation**: Local (30s) + Server (30min)
- **Signature**: Ed25519 verification

### 5. Admin Authentication
- **Purpose**: Protect settings from unauthorized changes
- **Lockout**: 5 failed attempts → 15 min lockout
- **Timeout**: 30 min inactivity → logout
- **Storage**: Bcrypt hashed password in database

## Common Development Tasks

### Add a New IPC Handler

1. **Define type** in `src/shared/types.ts`:
```typescript
export interface MyRequest {
  param1: string;
}

export interface MyResponse {
  result: string;
}
```

2. **Add channel** to `IPCChannels` enum:
```typescript
MY_FEATURE = 'myfeature:action'
```

3. **Implement handler** in `src/main/ipc-handlers.ts`:
```typescript
ipcMain.handle(IPCChannels.MY_FEATURE, async (event, request: MyRequest) => {
  try {
    const result = await this.doSomething(request.param1);
    return { success: true, data: { result } };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
```

4. **Expose in preload** (`src/main/preload.ts`):
```typescript
myFeature: (request: MyRequest): Promise<IPCResponse<MyResponse>> =>
  ipcRenderer.invoke(IPCChannels.MY_FEATURE, request),
```

5. **Use in renderer**:
```typescript
const response = await window.electronAPI.myFeature({ param1: 'value' });
```

### Add a New Setting

1. **Define key** in database initialization
2. **Add getter/setter** in `DatabaseManager`
3. **Expose via IPC** if needed
4. **Add UI** in `SettingsTab.tsx`

### Generate a PDF Report

```typescript
const response = await window.electronAPI.generateReport({
  options: {
    type: ReportType.DAILY,
    format: ReportFormat.PDF,
    dateRange: {
      startDate: '2026-01-01',
      endDate: '2026-01-02'
    },
    includeCharts: true,
    includeSummary: true,
    includeDetails: true
  }
});
```

### Enable Privacy Mode

```typescript
// Set privacy mode
await window.electronAPI.setSetting({
  key: 'privacy_mode_enabled',
  value: 'true'
});

// Set privacy apps
await window.electronAPI.setSetting({
  key: 'privacy_apps',
  value: JSON.stringify(['Slack', 'Teams', 'Discord'])
});
```

## Testing

### Run Tests
```bash
npm test                    # Run all tests
npm run test:watch        # Watch mode
npm run test:coverage     # Coverage report
```

### Test Structure
- Unit tests: `src/**/__tests__/*.test.ts`
- Integration tests: `src/**/__tests__/*.integration.test.ts`
- Test utilities: `src/test/`

### Example Test
```typescript
describe('ActivityTracker', () => {
  it('should track active window', async () => {
    const tracker = new ActivityTracker(db);
    tracker.start();
    await sleep(1000);
    const logs = db.getActivityLogs();
    expect(logs.length).toBeGreaterThan(0);
  });
});
```

## Debugging

### Enable Debug Logging
```bash
# Set debug environment variable
set DEBUG=produtime:*
npm start
```

### Check Logs
- **Main process**: Console output
- **Renderer process**: DevTools (Ctrl+Shift+I)
- **Database**: Check `%APPDATA%/produtime/produtime.db`

### Common Debug Points
- `src/main/main.ts`: App initialization
- `src/main/ipc-handlers.ts`: IPC request handling
- `src/renderer/App.tsx`: React component lifecycle
- `src/main/services/activity-tracker.ts`: Activity tracking

## Build & Package

### Development Build
```bash
npm run build:safe
```

### Production Build
```bash
npm run dist:x64
```

### Package for Distribution
```bash
npm run package:produtime
```

## Environment Variables

### Development
```bash
NODE_ENV=development
DEBUG=produtime:*
```

### Production
```bash
NODE_ENV=production
ED25519_PUBLIC_KEY=<your-public-key>
LICENSE_SERVER_URL=https://your-license-server.com
```

## Useful Commands

```bash
npm run lint              # Check code style
npm run lint:fix         # Fix linting issues
npm run format           # Format code with Prettier
npm run clean            # Clean build artifacts
npm run rebuild          # Rebuild native modules
npm run deps:check       # Check for outdated deps
npm run deps:update      # Update dependencies
```

## Troubleshooting

### "Module not found" errors
```bash
npm install
npm rebuild
```

### Database locked
- Ensure only one app instance running
- Check for stale processes: `tasklist | findstr ProduTime`

### Active window not detected
```bash
npm rebuild
# Rebuild native modules
```

### License validation fails
- Check internet connection
- Verify license key format
- Check server URL in settings

### PDF generation fails
- Check export folder permissions
- Ensure fonts are available
- Check disk space

## Next Steps

1. **Read TECHNICAL_DOCUMENTATION.md** for detailed architecture
2. **Explore src/main/main.ts** to understand app initialization
3. **Check src/renderer/App.tsx** for UI structure
4. **Review src/shared/types.ts** for data models
5. **Run tests** to verify setup: `npm test`

## Resources

- **Electron Docs**: https://www.electronjs.org/docs
- **React Docs**: https://react.dev
- **TypeScript Docs**: https://www.typescriptlang.org/docs
- **SQLite Docs**: https://www.sqlite.org/docs.html
- **GitHub Repo**: https://github.com/georgekgr12/timeport

---

**Happy coding! 🚀**
