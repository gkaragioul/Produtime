# ProduTime

Source-available proprietary freeware for local-first desktop time tracking and
productivity reporting on Windows.

ProduTime is developed by [George Karagioules](https://www.georgekaragioules.com)
and released as freeware. It is free to use, requires no activation key, and
does not require a subscription. The source may be visible for transparency, but
ProduTime is not open-source software and is not released under an open-source
license.

<p align="center">
  <a href="#build-from-source"><strong>Build from source</strong></a>
</p>

<p align="center">
  <img src="assets/readme/produtime-main.png" alt="ProduTime desktop dashboard showing current activity, active time, idle time and productivity metrics" width="920">
</p>

## What It Does

ProduTime runs locally on a Windows desktop and helps users understand how time
is spent during the work day.

- Activity tracking for active windows, keyboard/mouse activity, and idle time
- Daily productivity summaries and schedule progress
- PDF reports for daily, weekly, monthly, and custom ranges
- Privacy mode for sensitive app/window titles
- Optional local/admin management features for controlled environments
- Optional update checks through GitHub Releases

## Screenshots

<p align="center">
  <img src="assets/readme/produtime-top-apps.png" alt="ProduTime top apps and detailed activity report" width="30%">
  <img src="assets/readme/produtime-dashboard.png" alt="ProduTime focus summary dashboard on Windows" width="30%">
  <img src="assets/readme/produtime-admin-console.png" alt="ProduTime admin console dashboard" width="30%">
</p>

## Download

No prebuilt installers are published for this repository at the moment. To use
ProduTime, build it from source as described in
[Build From Source](#build-from-source).

> ProduTime is proprietary freeware: free to install and use, but not open
> source. You may not modify, sublicense, sell, commercialize, or redistribute
> modified versions except where expressly permitted by the license or
> applicable law.

## Privacy Summary

ProduTime stores activity records, settings, reports, and local app data on the
user's device by default. It does not send telemetry, activity records, or usage
analytics to George Karagioules.

Network activity only happens when a user or administrator uses a networked
feature, such as update checks, admin-console pairing, external links, or
configured email/report delivery. See [PRIVACY.md](PRIVACY.md).

## Monitoring Other People

ProduTime records which applications and window titles are active, keyboard and
mouse activity, and idle time. If you use it to monitor employees or anyone
other than yourself, you must inform them and obtain their informed consent,
and you are responsible for complying with the privacy, employment and
data-protection laws that apply where you and they are (for example the GDPR in
the EU). Do not use ProduTime for covert monitoring.

## Admin Password

ProduTime and the Admin Console have no built-in default admin password. The
first time someone opens the admin login, a random password is generated and
shown once in a separate window; store it in a password manager. Installs that
still use the old default password of earlier versions are switched to a new
random password (shown once) at their next admin login. The optional web admin
console (`admin-web/`) refuses to start unless the `ADMIN_PASSWORD` environment
variable is set to a password of at least 12 characters.

## Known Limitations

- Security alerts and failure notifications are sent with the sender address
  `noreply@timeport.app` (from the project's former name), whatever SMTP account
  you configure. Some mail servers may reject or flag these messages.

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

## Disclaimer

ProduTime is provided "as is", without warranty of any kind, express or
implied. Use it at your own risk; the author is not liable for any damages,
data loss or legal consequences arising from its use. See the "No Warranty"
section of [LICENSE.txt](LICENSE.txt) for the full terms.

## License

ProduTime is proprietary freeware. See [LICENSE.txt](LICENSE.txt).

Third-party notices are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Third-party dependencies, Electron/Chromium/Node components, and any files that
clearly state a separate license remain under their own license terms.

Copyright (c) 2026 George Karagioules. All rights reserved.
