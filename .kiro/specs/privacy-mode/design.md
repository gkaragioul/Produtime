# Design Document: Privacy Mode

## Overview

Privacy Mode is a feature that sanitizes window titles for messaging and communication applications to protect user privacy and support GDPR compliance. When enabled, applications like Slack, Teams, and Discord will only log the application name instead of the full window title (which often contains contact names, conversation titles, or message previews).

## Architecture

The feature integrates into the existing activity tracking pipeline:

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  active-win     │────▶│ Activity Tracker │────▶│    Database     │
│  (window info)  │     │  (sanitization)  │     │ (activity_logs) │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │ Privacy Settings │
                        │ - privacy_mode   │
                        │ - privacy_apps   │
                        └──────────────────┘
```

The sanitization occurs in the Activity Tracker before writing to the database, ensuring sensitive data never reaches persistent storage.

## Components and Interfaces

### 1. Privacy Settings (Database)

Two new settings stored in the `settings` table:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `privacy_mode_enabled` | string ("true"/"false") | "false" | Master toggle for privacy mode |
| `privacy_apps` | JSON string | See default list | List of app names to sanitize |

### 2. Activity Tracker Modifications

Add a `sanitizeWindowTitle` method to `ActivityTracker`:

```typescript
interface SanitizationResult {
  appName: string;
  windowTitle: string;
  wasSanitized: boolean;
}

private sanitizeWindowTitle(appName: string, windowTitle: string): SanitizationResult {
  const privacyEnabled = this.database.getSetting('privacy_mode_enabled') === 'true';
  
  if (!privacyEnabled) {
    return { appName, windowTitle, wasSanitized: false };
  }
  
  const privacyApps = this.getPrivacyApps();
  const isPrivacyApp = privacyApps.some(app => 
    appName.toLowerCase().includes(app.toLowerCase())
  );
  
  if (isPrivacyApp) {
    return { appName, windowTitle: appName, wasSanitized: true };
  }
  
  return { appName, windowTitle, wasSanitized: false };
}

private getPrivacyApps(): string[] {
  const setting = this.database.getSetting('privacy_apps');
  if (setting) {
    try {
      return JSON.parse(setting);
    } catch {
      return DEFAULT_PRIVACY_APPS;
    }
  }
  return DEFAULT_PRIVACY_APPS;
}
```

### 3. Default Privacy Apps List

```typescript
const DEFAULT_PRIVACY_APPS = [
  'Slack',
  'Microsoft Teams',
  'Teams',
  'Discord',
  'WhatsApp',
  'Telegram',
  'Signal',
  'Zoom',
  'Skype',
  'Messages',
  'Mail',
  'Outlook',
  'Gmail',
  'Messenger',
  'WeChat',
  'LINE',
  'Viber',
];
```

### 4. Settings UI Component

Add a new "Privacy" section to the Settings tab:

```tsx
<div className="settings-section">
  <h3>Privacy</h3>
  <div className="setting-row">
    <label>
      <input
        type="checkbox"
        checked={privacyModeEnabled}
        onChange={handlePrivacyModeToggle}
      />
      Privacy Mode for Messaging Apps
    </label>
    <p className="setting-description">
      When enabled, messaging apps (Slack, Teams, Discord, etc.) will only 
      show the app name instead of conversation details in activity logs.
    </p>
  </div>
  {privacyModeEnabled && (
    <div className="privacy-apps-list">
      <p>Protected applications:</p>
      <ul>{privacyApps.map(app => <li key={app}>{app}</li>)}</ul>
    </div>
  )}
</div>
```

## Data Models

No new database tables required. Uses existing `settings` table:

```sql
-- Existing table structure
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- New entries
INSERT INTO settings (key, value) VALUES ('privacy_mode_enabled', 'false');
INSERT INTO settings (key, value) VALUES ('privacy_apps', '["Slack","Microsoft Teams",...]');
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Privacy Mode Setting Persistence

*For any* privacy mode toggle action (enable or disable), the database setting `privacy_mode_enabled` should reflect the new state immediately after the action.

**Validates: Requirements 1.2, 1.3**

### Property 2: Window Title Sanitization Logic

*For any* application name and window title combination:
- If privacy mode is enabled AND the app name matches a privacy app, the logged window title should equal the app name
- If privacy mode is disabled OR the app name does not match a privacy app, the logged window title should equal the original window title

**Validates: Requirements 3.1, 3.2, 3.3**

### Property 3: Existing Data Immutability

*For any* existing activity log in the database, enabling or disabling privacy mode should not modify the log's `window_title` field.

**Validates: Requirements 4.1, 4.2**

### Property 4: Immediate Setting Application

*For any* change to the privacy mode setting, the very next activity log written should use the new setting value (sanitized if enabled, full title if disabled).

**Validates: Requirements 5.1**

## Error Handling

1. **Invalid privacy_apps JSON**: Fall back to `DEFAULT_PRIVACY_APPS`
2. **Missing settings**: Use defaults (`privacy_mode_enabled` = "false")
3. **Database read errors**: Log error and continue with privacy mode disabled (fail-open for usability)

## Testing Strategy

### Unit Tests
- Test `sanitizeWindowTitle` with various app/title combinations
- Test privacy apps list parsing with valid/invalid JSON
- Test default values when settings are missing

### Property-Based Tests
- **Property 1**: Generate random toggle sequences, verify database state matches last action
- **Property 2**: Generate random (appName, windowTitle, privacyEnabled, privacyApps) tuples, verify sanitization logic
- **Property 3**: Create logs, toggle privacy mode, verify logs unchanged
- **Property 4**: Toggle setting, write log, verify correct sanitization applied

### Integration Tests
- End-to-end test: Enable privacy mode in UI, verify Slack activity is sanitized
- Verify setting persists across app restart
