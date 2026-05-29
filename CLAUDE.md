# ProduTime Agent Context

## Project Overview

ProduTime is a free proprietary Windows desktop time tracking and productivity
reporting app built with Electron, React, and TypeScript.

- Platform: Windows
- Author: George Karagioules
- Source/release repo: https://github.com/gkaragioul/Produtime
- License model: proprietary freeware, not open source
- Activation model: freeware edition, no subscription, trial, or license key
- Admin Console: optional management app in `admin-console/`

## Tech Stack

- Main process: TypeScript compiled via `tsc` to `dist/main/`
- Renderer: React + TypeScript bundled via Webpack to `dist/renderer/`
- Database: SQLite / SQLCipher
- Desktop shell: Electron
- Installer: NSIS via electron-builder
- Updates: electron-updater with GitHub Releases

## Build And Run

### Install

```bash
npm install --ignore-scripts
node node_modules/electron/install.js
npx @electron/rebuild --force --only better-sqlite3 --module-dir node_modules/better-sqlite3
```

### Build

```bash
npm run build:main
npm run build:renderer
```

### Run

```bash
unset ELECTRON_RUN_AS_NODE && "node_modules/electron/dist/electron.exe" .
```

## Compliance Notes

- Public docs must not describe ProduTime as paid, subscription-based,
  trial-gated, open source, or restricted to a specific customer.
- Keep `LICENSE.txt`, `LICENSE_EULA.txt`, `PRIVACY.md`, and
  `THIRD_PARTY_NOTICES.md` aligned before release.
- Binary distributions must include the license, privacy notice, and
  third-party notices.
- The app About dialog should say "License: Freeware" and should not show
  activation, trial, customer-specific, or subscription language.

## Release Workflow

Release scripts publish ProduTime installers to:

```text
gkaragioul/Produtime
```

Before release:

1. Confirm `package.json` version.
2. Run the build/typecheck path available on the current machine.
3. Verify `LICENSE.txt`, `LICENSE_EULA.txt`, `PRIVACY.md`, and
   `THIRD_PARTY_NOTICES.md` ship with the packaged app.
4. Confirm update URLs point to `https://github.com/gkaragioul/Produtime`.

Do not publish installer releases without explicit user confirmation.
