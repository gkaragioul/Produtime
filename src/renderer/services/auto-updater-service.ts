/**
 * Auto-updater service (renderer side)
 * Triggers the assisted updater on the main process via IPC.
 * The main process handles all UI (dialogs, browser open).
 */
export class AutoUpdaterService {
  private static instance: AutoUpdaterService;

  private constructor() {}

  public static getInstance(): AutoUpdaterService {
    if (!AutoUpdaterService.instance) {
      AutoUpdaterService.instance = new AutoUpdaterService();
    }
    return AutoUpdaterService.instance;
  }

  public async checkForUpdates(): Promise<void> {
    const response = await window.electronAPI.checkForUpdates();
    if (!response.success) {
      throw new Error(response.error || 'Failed to check for updates');
    }
  }
}
