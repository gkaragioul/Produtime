import { UpdateState, UpdateStatus } from '../../shared/types';

export class AutoUpdaterService {
  private static instance: AutoUpdaterService;
  private currentState: UpdateState = { status: UpdateStatus.NOT_AVAILABLE };
  private statusChangeListeners: ((status: UpdateState) => void)[] = [];
  private cleanupListener: (() => void) | null = null;

  private constructor() {
    this.initializeEventListener();
  }

  public static getInstance(): AutoUpdaterService {
    if (!AutoUpdaterService.instance) {
      AutoUpdaterService.instance = new AutoUpdaterService();
    }
    return AutoUpdaterService.instance;
  }

  private initializeEventListener(): void {
    try {
      const api: any = (window as any).electronAPI;
      if (!api || typeof api.onUpdateStatusChanged !== 'function') {
        this.cleanupListener = () => {};
        return;
      }
      this.cleanupListener = api.onUpdateStatusChanged(
        (status: UpdateState) => {
          this.currentState = status;
          this.statusChangeListeners.forEach((l) => {
            try { l(status); } catch (e) { console.error('Update listener error:', e); }
          });
        }
      );
    } catch {
      this.cleanupListener = () => {};
    }
  }

  public async checkForUpdates(): Promise<void> {
    const response = await window.electronAPI.checkForUpdates();
    if (!response.success) throw new Error(response.error || 'Failed to check for updates');
  }

  public async downloadUpdate(): Promise<void> {
    const response = await window.electronAPI.downloadUpdate();
    if (!response.success) throw new Error(response.error || 'Failed to download update');
  }

  public async installUpdate(): Promise<void> {
    const response = await window.electronAPI.installUpdate();
    if (!response.success) throw new Error(response.error || 'Failed to install update');
  }

  /**
   * Fetch the current updater state from the main process and seed the
   * local cache. Call on mount so a renderer refresh doesn't leave the
   * progress bar blank when the main process already knows an update is
   * DOWNLOADED / AVAILABLE.
   */
  public async syncCurrentState(): Promise<UpdateState | null> {
    try {
      const response = await window.electronAPI.getUpdateStatus();
      if (response?.success && response.data) {
        this.currentState = response.data;
        this.statusChangeListeners.forEach((l) => {
          try { l(response.data!); } catch (e) { console.error('Update listener error:', e); }
        });
        return response.data;
      }
    } catch (e) {
      console.warn('syncCurrentState failed:', e);
    }
    return null;
  }

  /**
   * Escape hatch for corrupt installs of the current version — opens the
   * GitHub releases page so the user can download a fresh installer.
   */
  public async openReleasesPage(): Promise<void> {
    const api: any = (window as any).electronAPI;
    if (!api || typeof api.openReleasesPage !== 'function') {
      throw new Error('openReleasesPage IPC is not available in this renderer');
    }
    const response = await api.openReleasesPage();
    if (!response.success) throw new Error(response.error || 'Failed to open releases page');
  }

  public getCurrentState(): UpdateState {
    return { ...this.currentState };
  }

  public addStatusChangeListener(listener: (status: UpdateState) => void): () => void {
    this.statusChangeListeners.push(listener);
    return () => {
      const idx = this.statusChangeListeners.indexOf(listener);
      if (idx > -1) this.statusChangeListeners.splice(idx, 1);
    };
  }

  public cleanup(): void {
    if (this.cleanupListener) {
      this.cleanupListener();
      this.cleanupListener = null;
    }
    this.statusChangeListeners = [];
  }
}
