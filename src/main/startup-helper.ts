/**
 * Startup Helper
 *
 * Provides utilities to help users configure the app to start automatically
 * on Windows login. For portable apps, we can't automatically add to startup,
 * but we can create a shortcut that users can place in their Startup folder.
 */

import { app, dialog, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync, spawn } from 'child_process';
import * as os from 'os';

export class StartupHelper {
  private static readonly RUN_KEY_PATH =
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
  private static readonly RUN_VALUE_NAME = 'ProduTime';

  /**
   * Check if the app is likely running from the Windows Startup folder
   */
  public static isRunningFromStartup(): boolean {
    const exePath = app.getPath('exe').toLowerCase();
    const startupPath = path
      .join(
        app.getPath('appData'),
        'Microsoft\\Windows\\Start Menu\\Programs\\Startup'
      )
      .toLowerCase();

    return exePath.includes(startupPath);
  }

  /**
   * Get the Windows Startup folder path
   */
  public static getStartupFolderPath(): string {
    return path.join(
      app.getPath('appData'),
      'Microsoft\\Windows\\Start Menu\\Programs\\Startup'
    );
  }

  /**
   * Create a shortcut (.lnk) file for the current executable and
   * ensure the Windows Run registry key is set for auto-start.
   * Returns the path where the shortcut was created.
   */
  public static async createStartupShortcut(): Promise<string> {
    const exePath = app.getPath('exe');
    const startupFolder = this.getStartupFolderPath();
    const shortcutPath = path.join(startupFolder, 'ProduTime.lnk');

    // Ensure startup folder exists
    if (!fs.existsSync(startupFolder)) {
      fs.mkdirSync(startupFolder, { recursive: true });
    }

    // Create shortcut using PowerShell (for backward compatibility)
    // Write script to temp file to avoid command injection
    const psScript = `
      $WshShell = New-Object -ComObject WScript.Shell
      $Shortcut = $WshShell.CreateShortcut("${shortcutPath.replace(/\\/g, '\\\\')}")
      $Shortcut.TargetPath = "${exePath.replace(/\\/g, '\\\\')}"
      $Shortcut.WorkingDirectory = "${path.dirname(exePath).replace(/\\/g, '\\\\')}"
      $Shortcut.Description = "ProduTime - Activity Tracking"
      $Shortcut.Save()
    `;

    const tempScriptPath = path.join(os.tmpdir(), `produtime-shortcut-${Date.now()}.ps1`);

    try {
      // Write script to temp file instead of passing via command line
      fs.writeFileSync(tempScriptPath, psScript);

      // Execute script from file using spawn (safer than exec)
      await new Promise<void>((resolve, reject) => {
        const proc = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tempScriptPath], {
          stdio: 'pipe',
        });

        proc.on('error', (err) => {
          reject(new Error(`Failed to execute PowerShell: ${err.message}`));
        });

        proc.on('exit', (code) => {
          if (code !== 0) {
            reject(new Error(`PowerShell exited with code ${code}`));
          } else {
            resolve();
          }
        });
      });

      // Also configure the Windows Run registry key so auto-start
      // can be managed and inspected via the registry.
      await this.setRegistryAutoStart(true);
      return shortcutPath;
    } catch (error) {
      throw new Error(`Failed to create startup shortcut: ${error}`);
    } finally {
      // Clean up temp file
      try {
        if (fs.existsSync(tempScriptPath)) {
          fs.unlinkSync(tempScriptPath);
        }
      } catch (cleanupError) {
        console.warn('Failed to clean up temp PowerShell script:', cleanupError);
      }
    }
  }

  /**
   * Remove the startup shortcut if it exists and clear the
   * Windows Run registry key used for auto-start.
   */
  public static async removeStartupShortcut(): Promise<boolean> {
    const startupFolder = this.getStartupFolderPath();
    const shortcutPath = path.join(startupFolder, 'ProduTime.lnk');

    let removed = false;

    if (fs.existsSync(shortcutPath)) {
      try {
        fs.unlinkSync(shortcutPath);
        removed = true;
      } catch (error) {
        throw new Error(`Failed to remove startup shortcut: ${error}`);
      }
    }

    // Always try to remove the registry auto-start entry as well
    try {
      await this.setRegistryAutoStart(false);
    } catch (error) {
      console.warn(
        'StartupHelper: Failed to remove registry auto-start entry (may already be missing):',
        error
      );
    }

    return removed;
  }

  /**
   * Check if auto-start is enabled either via registry or shortcut.
   */
  public static hasStartupShortcut(): boolean {
    if (this.hasRegistryAutoStart()) {
      return true;
    }

    const startupFolder = this.getStartupFolderPath();
    const shortcutPath = path.join(startupFolder, 'ProduTime.lnk');
    return fs.existsSync(shortcutPath);
  }

  /**
   * Check if auto-start is enabled via the Windows Run registry key.
   * This is the primary source of truth for the settings toggle.
   */
  private static hasRegistryAutoStart(): boolean {
    if (process.platform !== 'win32') {
      return false;
    }

    try {
      // Use spawnSync to avoid command injection - pass arguments as array
      const result = spawnSync('reg', [
        'query',
        StartupHelper.RUN_KEY_PATH,
        '/v',
        StartupHelper.RUN_VALUE_NAME,
      ], { stdio: ['pipe', 'pipe', 'pipe'] });

      if (result.status !== 0) {
        return false;
      }

      const output = result.stdout.toString();
      return output
        .toLowerCase()
        .includes(StartupHelper.RUN_VALUE_NAME.toLowerCase());
    } catch {
      return false;
    }
  }

  /**
   * Enable or disable auto-start using the Windows Run registry key.
   */
  private static async setRegistryAutoStart(enable: boolean): Promise<void> {
    if (process.platform !== 'win32') {
      return;
    }

    const exePath = app.getPath('exe');

    if (enable) {
      // Use spawn to avoid command injection - pass arguments as array
      await new Promise<void>((resolve, reject) => {
        const proc = spawn('reg', [
          'add',
          StartupHelper.RUN_KEY_PATH,
          '/v',
          StartupHelper.RUN_VALUE_NAME,
          '/t',
          'REG_SZ',
          '/d',
          `"${exePath}"`,
          '/f',
        ], { stdio: 'pipe' });

        proc.on('error', (err) => {
          reject(new Error(`Failed to execute registry command: ${err.message}`));
        });

        proc.on('exit', (code) => {
          if (code !== 0) {
            reject(new Error(`Registry command failed with code ${code}`));
          } else {
            resolve();
          }
        });
      });
    } else {
      try {
        // Use spawn to avoid command injection - pass arguments as array
        await new Promise<void>((resolve, reject) => {
          const proc = spawn('reg', [
            'delete',
            StartupHelper.RUN_KEY_PATH,
            '/v',
            StartupHelper.RUN_VALUE_NAME,
            '/f',
          ], { stdio: 'pipe' });

          proc.on('error', (err) => {
            reject(new Error(`Failed to execute registry command: ${err.message}`));
          });

          proc.on('exit', (code) => {
            if (code !== 0) {
              reject(new Error(`Registry command failed with code ${code}`));
            } else {
              resolve();
            }
          });
        });
      } catch (error) {
        console.warn(
          'StartupHelper: Failed to delete registry auto-start entry (may already be missing):',
          error
        );
      }
    }
  }

  /**
   * Open the Windows Startup folder in File Explorer
   */
  public static async openStartupFolder(): Promise<void> {
    const startupFolder = this.getStartupFolderPath();

    // Ensure folder exists
    if (!fs.existsSync(startupFolder)) {
      fs.mkdirSync(startupFolder, { recursive: true });
    }

    try {
      // Use Electron's shell.openPath() instead of executing explorer command
      // This is safer and more reliable
      await shell.openPath(startupFolder);
    } catch (error) {
      throw new Error(`Failed to open startup folder: ${error}`);
    }
  }

  /**
   * Show a dialog to help users set up auto-start
   */
  public static async showSetupDialog(): Promise<
    'enable' | 'disable' | 'cancel'
  > {
    const hasShortcut = this.hasStartupShortcut();

    const result = await dialog.showMessageBox({
      type: 'question',
      title: 'Auto-Start on Login',
      message: hasShortcut
        ? 'ProduTime is currently set to start automatically when you log in.'
        : 'Would you like ProduTime to start automatically when you log in?',
      detail: hasShortcut
        ? 'This helps ensure your work hours are tracked from the moment you start your workday.\n\nWould you like to disable auto-start?'
        : 'This helps ensure your work hours are tracked from the moment you start your workday.\n\nA shortcut will be created in your Windows Startup folder.',
      buttons: hasShortcut
        ? ['Disable Auto-Start', 'Keep Enabled', 'Cancel']
        : ['Enable Auto-Start', 'Not Now', 'Cancel'],
      defaultId: hasShortcut ? 1 : 0,
      cancelId: 2,
    });

    if (result.response === 2) {
      return 'cancel';
    }

    if (hasShortcut) {
      return result.response === 0 ? 'disable' : 'cancel';
    } else {
      return result.response === 0 ? 'enable' : 'cancel';
    }
  }

  /**
   * Configure auto-start based on user preference
   */
  public static async configure(enable: boolean): Promise<boolean> {
    try {
      if (enable) {
        const shortcutPath = await this.createStartupShortcut();
        await dialog.showMessageBox({
          type: 'info',
          title: 'Auto-Start Enabled',
          message: 'ProduTime will now start automatically when you log in.',
          detail: `Shortcut created at:\n${shortcutPath}\n\nYou can remove it anytime from Settings.`,
          buttons: ['OK'],
        });
        return true;
      } else {
        const removed = await this.removeStartupShortcut();
        if (removed) {
          await dialog.showMessageBox({
            type: 'info',
            title: 'Auto-Start Disabled',
            message: 'ProduTime will no longer start automatically.',
            detail: 'You can re-enable this anytime from Settings.',
            buttons: ['OK'],
          });
        }
        return removed;
      }
    } catch (error) {
      await dialog.showMessageBox({
        type: 'error',
        title: 'Error',
        message: 'Failed to configure auto-start',
        detail: error instanceof Error ? error.message : String(error),
        buttons: ['OK'],
      });
      return false;
    }
  }
}
