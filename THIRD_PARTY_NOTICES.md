# ProduTime Third-Party Notices

ProduTime includes third-party open-source components. Those components are
owned by their respective authors and remain under their own licenses.

This notice summarizes the direct runtime dependencies declared by ProduTime.
Transitive dependency details are recorded in `package-lock.json`.

| Component | Version in lockfile | License |
|---|---:|---|
| @journeyapps/sqlcipher | 5.3.1 | BSD-3-Clause |
| active-win | 8.2.1 | MIT |
| better-sqlite3 | 12.6.2 | MIT |
| electron-updater | 6.8.3 | MIT |
| events | 3.3.0 | MIT |
| html2canvas | 1.4.1 | MIT |
| javascript-obfuscator | 4.2.2 | BSD-2-Clause |
| jspdf | 3.0.4 | MIT |
| node-machine-id | 1.1.12 | MIT |
| nodemailer | 7.0.13 | MIT-0 |
| react | 19.2.4 | MIT |
| react-dom | 19.2.4 | MIT |
| tweetnacl | 1.0.3 | Unlicense |
| tweetnacl-util | 0.15.1 | Unlicense |
| webpack-obfuscator | 3.6.0 | BSD-2-Clause |
| ws | 8.19.0 | MIT |

Electron distributions also include Electron, Chromium, Node.js, and related
third-party notices. Keep the license/notice files generated or bundled by
Electron and electron-builder with binary distributions.

## License Text Availability

The canonical license text for each npm dependency can be found in the
dependency package under `node_modules/<package>/LICENSE*` after `npm install`.

For redistribution, keep this file, `LICENSE.txt`, and any Electron/Chromium
notices together with ProduTime binaries.
