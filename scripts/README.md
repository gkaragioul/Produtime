# TimePort Utility Scripts

This directory contains utility scripts for maintaining and monitoring the TimePort application.

## Available Scripts

### 🔍 `monitor-duplicates.sh`
**Purpose**: Monitors the workspace for duplicate files that indicate sync conflicts or backup issues.

**Usage**:
```bash
./scripts/monitor-duplicates.sh
```

**Features**:
- Scans for files with `_conf(X)` pattern (sync conflicts)
- Checks Git repository integrity
- Logs results to `duplicate-monitor.log`
- Exits with error code if issues found

**When to Use**:
- After workspace changes
- Before important commits
- Weekly maintenance checks
- When experiencing file sync issues

### 💾 `manual-backup.sh`
**Purpose**: Creates comprehensive manual backups of the TimePort workspace.

**Usage**:
```bash
./scripts/manual-backup.sh
```

**Features**:
- Backs up source code (excludes node_modules, build artifacts)
- Backs up configuration files
- Backs up documentation
- Creates separate database backup
- Creates Git bundle for complete history
- Generates backup manifest with metadata

**Backup Contents**:
- Source code (`src/`)
- Configuration files (`package.json`, `tsconfig.json`, etc.)
- Documentation (`Docs/`)
- Database files (copied to `data_backup/`)
- Git bundle with complete history
- Backup manifest with timestamp and metadata

**When to Use**:
- Before major changes or refactoring
- Before Story transitions
- Weekly development backups
- Before production deployments

## Log Files

### `duplicate-monitor.log`
- **Auto-generated** by `monitor-duplicates.sh`
- Contains scan results and timestamps
- **Automatically cleaned** on script runs
- Review for historical duplicate file patterns

## Usage Guidelines

### Permissions
Make sure scripts are executable:
```bash
chmod +x scripts/*.sh
```

### Regular Maintenance
- Run `monitor-duplicates.sh` weekly
- Create manual backups before major changes
- Review and clean old log files monthly

### Integration
- Scripts can be integrated into CI/CD pipelines
- Consider adding to pre-commit hooks for critical checks
- Use in automated maintenance workflows

## Script Development

### Adding New Scripts
1. Create script in `scripts/` directory
2. Make executable with `chmod +x`
3. Add documentation to this README
4. Test thoroughly before committing

### Best Practices
- Include error handling and logging
- Provide clear success/failure indicators
- Use consistent naming conventions
- Document all parameters and options

---

## PowerShell Build & Deployment Scripts (Windows)

### 📦 `deploy-to-local.ps1`
**Purpose**: Deploys built apps from the workspace to local Windows test folders.

**Usage**:
```powershell
npm run deploy:local
```

**What it does**:
- Copies `desktop-export/win-unpacked` → `C:\Users\{username}\Documents\PT-Test\`
- Copies `license-manager/release-vps/win-unpacked` → `C:\Users\{username}\Documents\PT-LicenseManager-Test\`

**When to use**: After building apps with `npm run dist:x64`, before testing locally.

---

### 🚀 `launch-local-produtime.ps1`
**Purpose**: Launches ProduTime from local Windows path with diagnostic logging enabled.

**Usage**:
```powershell
npm run test:produtime
```

**What it does**:
- Stops any running ProduTime processes
- Sets environment variables for verbose logging
- Launches with `--disable-gpu`, `--enable-logging`, `--v=1` flags

**Logs location**: `C:\Users\{username}\AppData\Roaming\ProduTime\logs\`

---

### 🚀 `launch-local-license-manager.ps1`
**Purpose**: Launches License Manager from local Windows path with diagnostic logging enabled.

**Usage**:
```powershell
npm run test:license-manager
```

**Logs location**: `C:\Users\{username}\AppData\Roaming\ProduTime License Manager\logs\`

---

### 📦 `package-for-distribution.ps1`
**Purpose**: Creates distribution .zip files from freshly built apps.

**Usage**:
```powershell
npm run package:all
```

**Output**: Creates .zip files on Desktop ready for distribution.

---

### 📦 `package-existing-installs.ps1`
**Purpose**: Creates distribution .zip files from existing local installations (workaround for build issues).

**Usage**:
```powershell
npm run package:existing
```

**When to use**: When you have working local installations and want to create distribution packages without rebuilding from source.

**Note**: If packaging fails with "file is being used by another process", close all apps and wait 5-10 seconds before retrying.

---

## Important Notes for Windows Development

### Parallels Shared Folder Issue
Always test and run apps from local Windows paths (`C:\Users\...`), not from Parallels shared folders (`C:\Mac\Home\...`). Electron apps crash when run from network shares.

### File Locks
If packaging fails due to file locks, ensure all ProduTime and License Manager windows are closed and wait a few seconds before retrying.

---

_Last Updated: November 13, 2025_
_Scripts Version: 2.0_
