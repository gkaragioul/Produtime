# Code Signing ProduTime

The NSIS installer is built by `electron-builder`, which automatically signs
the output if the following environment variables are set at build time.
Without signing, Windows SmartScreen will warn users when they run the installer
for the first time. Users can still bypass the warning by clicking
"More info" → "Run anyway".

## How to enable signing

1. **Obtain a code signing certificate.**
   - **Standard OV certificate** (~$200-400/year): cheaper, but SmartScreen
     reputation has to build up over time. Early users will still see the
     warning. Providers: Sectigo, DigiCert, SSL.com, Certum.
   - **Extended Validation (EV) certificate** (~$400-700/year): immediate
     SmartScreen trust from day one. Recommended if you have many users.

2. **Export the certificate as a `.pfx` file with a password.**

3. **Set two environment variables before running the release script:**

   **PowerShell:**
   ```powershell
   $env:CSC_LINK = "C:\path\to\certificate.pfx"
   $env:CSC_KEY_PASSWORD = "your-pfx-password"
   .\scripts\release.ps1 -Version 1.0.9
   ```

   **Bash:**
   ```bash
   export CSC_LINK="C:/path/to/certificate.pfx"
   export CSC_KEY_PASSWORD="your-pfx-password"
   ./scripts/release.ps1 -Version 1.0.9
   ```

   That's it. `electron-builder` will detect the variables and sign the
   installer + the app EXE + the uninstaller automatically.

## Verifying signed output

After build, right-click the installer EXE → Properties → Digital Signatures.
You should see "George Karagioules" (or whatever the certificate's common name is)
with a valid timestamp.

## Without a certificate (current state)

The installer is built unsigned. When users first run it:
1. Windows SmartScreen shows "Windows protected your PC"
2. They click "More info"
3. They click "Run anyway"
4. Installer runs normally

Once installed, the app auto-updates via `electron-updater` which downloads
from GitHub and verifies the SHA512 checksum in `latest.yml` — so the update
flow doesn't trigger SmartScreen even without a signature.
