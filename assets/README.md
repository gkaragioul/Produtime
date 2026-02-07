# TimePort Assets

This directory contains static assets used by the TimePort application.

## Current Assets

### 🖼️ Icons

#### `tray-icon.ico`
- **Purpose**: System tray icon for Windows
- **Format**: ICO (Windows Icon)
- **Size**: 16x16 pixels (standard tray icon size)
- **Usage**: Fallback icon for system tray when bitmap generation fails
- **Status**: Currently used as fallback; primary icon is generated programmatically

## Asset Guidelines

### Icon Standards
- **System Tray Icons**: 16x16 pixels, ICO format for Windows
- **Application Icons**: Multiple sizes (16, 32, 48, 64, 128, 256 pixels)
- **File Formats**: ICO for Windows, PNG for cross-platform

### Naming Conventions
- Use descriptive names: `tray-icon.ico`, `app-icon-64.png`
- Include size in filename when multiple sizes exist
- Use lowercase with hyphens for separation

### Organization
```
assets/
├── icons/          # Application and system icons
├── images/         # UI images and graphics
├── fonts/          # Custom fonts (if any)
└── templates/      # Document templates (for future PDF features)
```

## Future Asset Planning

### Story 2: Activity Tracking
- Activity type icons
- Status indicator icons
- Chart/graph assets

### Story 3: Settings & Configuration
- Settings category icons
- UI element graphics

### Story 4: PDF Reports
- Report templates
- Company logos/branding
- Chart styling assets

## Technical Notes

### Current Implementation
- Primary tray icon is generated programmatically using bitmap creation
- ICO file serves as fallback for compatibility
- Cross-platform icon support implemented in SystemTrayManager

### Asset Loading
- Assets loaded via Node.js path resolution
- Fallback mechanisms in place for missing assets
- Error handling for asset loading failures

---

_Last Updated: August 29, 2025_
_Assets Version: 1.0_
