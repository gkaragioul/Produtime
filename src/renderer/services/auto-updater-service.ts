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
