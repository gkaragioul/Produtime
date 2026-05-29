# ProduTime

Free proprietary desktop time tracking and productivity reporting software for
Windows.

ProduTime is developed by [George Karagioules](https://www.georgekaragioules.com)
and released as freeware. It is free to use, requires no activation key, and
does not require a subscription. The source may be visible for transparency, but
ProduTime is not open-source software.

## What It Does

ProduTime runs locally on a Windows desktop and helps users understand how time
is spent during the work day.

- Activity tracking for active windows, keyboard/mouse activity, and idle time
- Daily productivity summaries and schedule progress
- PDF reports for daily, weekly, monthly, and custom ranges
- Privacy mode for sensitive app/window titles
- Optional local/admin management features for controlled environments
- Optional update checks through GitHub Releases

## Download

Get the latest installer from the
[Releases page](https://github.com/gkaragioul/Produtime/releases/latest).

> ProduTime is freeware: free to use, not for resale, and not for modified
> redistribution under the ProduTime name.

## Privacy Summary

ProduTime stores activity records, settings, reports, and local app data on the
user's device by default. It does not send telemetry, activity records, or usage
analytics to George Karagioules.

Network activity only happens when a user or administrator uses a networked
feature, such as update checks, admin-console pairing, external links, or
configured email/report delivery. See [PRIVACY.md](PRIVACY.md).

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron |
| UI | React + TypeScript |
| Local database | SQLite / SQLCipher |
| Bundler | Webpack |
| Installer | NSIS via electron-builder |
| Updates | electron-updater + GitHub Releases |

## Build From Source

### Prerequisites

- Node.js 18+
- npm 8+
- Windows 10+ for native activity-tracking behavior

### Install

```bash
npm install
npx @electron/rebuild --force --only better-sqlite3
```

### Build

```bash
npm run build:main
npm run build:renderer
```

### Run

```bash
npm start
```

### Package Installer

```bash
npm run dist:x64
```

Output:

```text
build-output/ProduTime-Setup.exe
```

## Project Structure

```text
src/
  main/           Electron main process, database, IPC, tray, updater
  renderer/       React UI
  shared/         Shared TypeScript types
assets/           Icons and images
admin-console/    Optional ProduTime Admin Console
admin-web/        Optional web admin console
scripts/          Build and maintenance scripts
```

## License

ProduTime is proprietary freeware. See [LICENSE.txt](LICENSE.txt).

Third-party notices are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Copyright (c) 2026 George Karagioules. All rights reserved.
