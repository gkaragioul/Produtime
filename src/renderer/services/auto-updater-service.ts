import { UpdateState, UpdateStatus } from '../../shared/types';

export class AutoUpdaterService {
  private static instance: AutoUpdaterService;
  private currentState: UpdateState = { status: UpdateStatus.NOT_AVAILABLE };
  private statusChangeListeners: ((status: UpdateState) => void)[] = [];
  private cleanupListener: (() => void) | null = null;

  private constructor() {
    if (!window.electronAPI) {
      throw new Error(
        'Electron API not available. Make sure preload script is loaded.'
      );
    }
    this.initializeEventListener();
  }

  public static getInstance(): AutoUpdaterService {
    if (!AutoUpdaterService.instance) {
      AutoUpdaterService.instance = new AutoUpdaterService();
    }
    return AutoUpdaterService.instance;
  }

  private initializeEventListener(): void {
    // Set up listener for update status changes from main process
    try {
      const api: any = (window as any).electronAPI;
      if (!api || typeof api.onUpdateStatusChanged !== 'function') {
        // In tests or non-Electron environments, this may not be present.
        // Use a no-op cleanup to keep the app stable.
        console.warn(
          'AutoUpdaterService: onUpdateStatusChanged not available; using no-op listener.'
        );
        this.cleanupListener = () => {};
        return;
      }
      this.cleanupListener = api.onUpdateStatusChanged(
        (status: UpdateState) => {
          this.currentState = status;
          this.notifyListeners(status);
        }
      );
    } catch (err) {
      console.warn(
        'AutoUpdaterService: failed to initialize update status listener; falling back to no-op.',
        err
      );
      this.cleanupListener = () => {};
    }
  }

  private notifyListeners(status: UpdateState): void {
    this.statusChangeListeners.forEach((listener) => {
      try {
        listener(status);
      } catch (error) {
        console.error('Error in update status listener:', error);
      }
    });
  }

  // Public API methods
  public async checkForUpdates(): Promise<void> {
    try {
      const response = await window.electronAPI.checkForUpdates();
      if (!response.success) {
        throw new Error(response.error || 'Failed to check for updates');
      }
    } catch (error) {
      console.error(
        'Auto-updater Service - Error checking for updates:',
        error
      );
      throw error;
    }
  }

  public async downloadUpdate(): Promise<void> {
    try {
      const response = await window.electronAPI.downloadUpdate();
      if (!response.success) {
        throw new Error(response.error || 'Failed to download update');
      }
    } catch (error) {
      console.error('Auto-updater Service - Error downloading update:', error);
      throw error;
    }
  }

  public async installUpdate(): Promise<void> {
    try {
      const response = await window.electronAPI.installUpdate();
      if (!response.success) {
        throw new Error(response.error || 'Failed to install update');
      }
    } catch (error) {
      console.error('Auto-updater Service - Error installing update:', error);
      throw error;
    }
  }

  public async getUpdateStatus(): Promise<UpdateState> {
    try {
      const response = await window.electronAPI.getUpdateStatus();
      if (!response.success) {
        throw new Error(response.error || 'Failed to get update status');
      }
      this.currentState = response.data || {
        status: UpdateStatus.NOT_AVAILABLE,
      };
      return this.currentState;
    } catch (error) {
      console.error(
        'Auto-updater Service - Error getting update status:',
        error
      );
      throw error;
    }
  }

  // State management
  public getCurrentState(): UpdateState {
    return { ...this.currentState };
  }

  public isUpdateAvailable(): boolean {
    return this.currentState.status === UpdateStatus.AVAILABLE;
  }

  public isUpdateDownloaded(): boolean {
    return this.currentState.status === UpdateStatus.DOWNLOADED;
  }

  public isUpdateInProgress(): boolean {
    return (
      this.currentState.status === UpdateStatus.CHECKING ||
      this.currentState.status === UpdateStatus.DOWNLOADING
    );
  }

  // Event listeners
  public addStatusChangeListener(
    listener: (status: UpdateState) => void
  ): () => void {
    this.statusChangeListeners.push(listener);

    // Return cleanup function
    return () => {
      const index = this.statusChangeListeners.indexOf(listener);
      if (index > -1) {
        this.statusChangeListeners.splice(index, 1);
      }
    };
  }

  // Utility methods
  public getStatusText(): string {
    switch (this.currentState.status) {
      case UpdateStatus.CHECKING:
        return 'Checking for updates...';
      case UpdateStatus.AVAILABLE:
        return `Update available: v${this.currentState.info?.version}`;
      case UpdateStatus.NOT_AVAILABLE:
        return 'No updates available';
      case UpdateStatus.DOWNLOADING:
        const percent = this.currentState.progress?.percent || 0;
        return `Downloading update: ${Math.round(percent)}%`;
      case UpdateStatus.DOWNLOADED:
        return 'Update downloaded and ready to install';
      case UpdateStatus.ERROR:
        return `Update error: ${this.currentState.error}`;
      default:
        return 'Unknown status';
    }
  }

  public getProgressPercent(): number {
    return this.currentState.progress?.percent || 0;
  }

  public formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  public getDownloadInfo(): string {
    const progress = this.currentState.progress;
    if (!progress) return '';

    const transferred = this.formatBytes(progress.transferred);
    const total = this.formatBytes(progress.total);
    const speed = this.formatBytes(progress.bytesPerSecond);

    return `${transferred} / ${total} (${speed}/s)`;
  }

  // New methods for enhanced functionality
  public async getLastCheckTime(): Promise<Date | null> {
    try {
      const response = await window.electronAPI.getLastUpdateCheckTime();
      if (!response.success || !response.data) {
        return null;
      }
      return new Date(response.data);
    } catch (error) {
      console.error(
        'Auto-updater Service - Error getting last check time:',
        error
      );
      return null;
    }
  }

  public async openUpdateLogs(): Promise<void> {
    try {
      const response = await window.electronAPI.openUpdateLogs();
      if (!response.success) {
        throw new Error(response.error || 'Failed to open update logs');
      }
    } catch (error) {
      console.error('Auto-updater Service - Error opening update logs:', error);
      throw error;
    }
  }

  public formatLastCheckTime(date: Date | null): string {
    if (!date) return 'Never';

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60)
      return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24)
      return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;

    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  }

  // Cleanup
  public cleanup(): void {
    if (this.cleanupListener) {
      this.cleanupListener();
      this.cleanupListener = null;
    }
    this.statusChangeListeners = [];
  }
}
