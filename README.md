<h1 align="center">ProduTime</h1>

<p align="center">
  <strong>Free desktop time tracking and productivity monitoring app for World of Travel.</strong><br>
  <em>Electron, React, TypeScript, cloud admin controls, productivity reports, privacy mode, and silent update workflows.</em>
</p>

<p align="center">
  <a href="#what-it-does">What It Does</a> •
  <a href="#download">Download</a> •
  <a href="#tech-stack">Tech Stack</a> •
  <a href="#build-from-source">Build</a> •
  <a href="#project-structure">Project Structure</a> •
  <a href="#license">License</a>
</p>
## What it does

ProduTime runs silently in the background and tracks how time is spent across applications throughout the work day. It generates daily productivity reports and can be managed remotely via the cloud Admin Console.

- **Activity tracking** — monitors active windows, keyboard/mouse activity, and idle periods
- **Daily insights** — progress against work schedule, focus quality, top apps
- **PDF reports** — daily, weekly, and monthly productivity breakdowns
- **Privacy mode** — sanitises window titles for sensitive applications
- **Auto-updates** — in-app updates with download progress, silent install and restart
- **Admin Console** — cloud-based centralised management, policy deployment, real-time monitoring

---

## Download

Get the latest installer from the [Releases page](https://github.com/wotbyalice/WOT-Produtime-Releases/releases/latest).

> ProduTime is freeware. Free to use. Not for resale or redistribution.

---

## Tech stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron |
| UI | React + TypeScript |
| Database | SQLite (better-sqlite3, WAL mode) |
| Bundler | Webpack |
| Installer | NSIS via electron-builder |
| Admin comms | WebSocket (Ed25519 signed messages) |
| Updates | electron-updater → GitHub Releases |

---

## Build from source

### Prerequisites

- Node.js 18+
- Windows 10+ (native modules require Windows for activity tracking)

### Install

```bash
npm install
npx @electron/rebuild --force --only better-sqlite3
```

### Build

```bash
npm run build:main      # TypeScript → dist/main/
npm run build:renderer  # Webpack → dist/renderer/
```

### Run (development)

```bash
unset ELECTRON_RUN_AS_NODE && node_modules/electron/dist/electron.exe .
```

### Package installer

```bash
npm run dist:x64
```

Output: `build-output/ProduTime-Setup-<version>-x64.exe`

---

## Project structure

```
src/
  main/           Electron main process (database, IPC, tray, updater, agent)
  renderer/       React frontend (dashboard, settings, reports)
  shared/         Shared TypeScript types
assets/           Icons and images
admin-console/    Local LAN Admin Console (separate Electron app)
cloud-admin-web/  Cloud admin web dashboard (Vite + React)
scripts/          Build, release, and maintenance scripts
```

---

## License

Freeware — see [LICENSE.txt](LICENSE.txt).
Developed by George Karagioules · [www.georgekaragioules.com](https://www.georgekaragioules.com)
© 2026 George Karagioules. All rights reserved.
