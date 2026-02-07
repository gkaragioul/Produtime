import {
  TrayNotification,
  TrayNotificationType,
  TrayState,
} from '../../shared/types';

export class SystemTrayService {
  private static instance: SystemTrayService;
  private currentState: TrayState = {
    isVisible: true,
    isTrackingActive: false,
    unreadNotifications: 0,
  };
  private notificationCleanup: (() => void) | null = null;
  private actionCleanup: (() => void) | null = null;

  private constructor() {
    if (!window.electronAPI) {
      throw new Error(
        'Electron API not available. Make sure preload script is loaded.'
      );
    }
    this.initializeEventListeners();
  }

  public static getInstance(): SystemTrayService {
    if (!SystemTrayService.instance) {
      SystemTrayService.instance = new SystemTrayService();
    }
    return SystemTrayService.instance;
  }

  private initializeEventListeners(): void {
    // Set up listeners for tray events from main process
    this.notificationCleanup = window.electronAPI.onTrayNotificationClicked(
      (notificationId: string) => {
        console.log('Tray notification clicked:', notificationId);
        // Handle notification click - could show specific content or clear notification
      }
    );

    this.actionCleanup = window.electronAPI.onTrayActionTriggered(
      (actionId: string) => {
        console.log('Tray action triggered:', actionId);
        this.handleTrayAction(actionId);
      }
    );
  }

  private handleTrayAction(actionId: string): void {
    switch (actionId) {
      case 'start-tracking':
        this.handleStartTracking();
        break;
      case 'stop-tracking':
        this.handleStopTracking();
        break;
      case 'generate-daily-report':
        this.handleGenerateReport('daily');
        break;
      case 'generate-weekly-report':
        this.handleGenerateReport('weekly');
        break;
      case 'generate-monthly-report':
        this.handleGenerateReport('monthly');
        break;
      case 'show-settings':
        this.handleShowSettings();
        break;
      case 'show-about':
        this.handleShowAbout();
        break;
      default:
        console.log('Unknown tray action:', actionId);
    }
  }

  private handleStartTracking(): void {
    // Implement start tracking logic
    this.updateTrayState({ isTrackingActive: true });
    this.showNotification({
      title: 'ProduTime',
      body: 'Activity tracking started',
      type: TrayNotificationType.SUCCESS,
      duration: 3000,
    });
  }

  private handleStopTracking(): void {
    // Implement stop tracking logic
    this.updateTrayState({ isTrackingActive: false });
    this.showNotification({
      title: 'ProduTime',
      body: 'Activity tracking stopped',
      type: TrayNotificationType.INFO,
      duration: 3000,
    });
  }

  private handleGenerateReport(type: string): void {
    this.showNotification({
      title: 'ProduTime',
      body: `Generating ${type} report...`,
      type: TrayNotificationType.INFO,
      duration: 2000,
    });

    // Here you would integrate with the PDF report service
    // For now, just show a completion notification after a delay
    setTimeout(() => {
      this.showNotification({
        title: 'Report Generated',
        body: `${type.charAt(0).toUpperCase() + type.slice(1)} report has been generated successfully`,
        type: TrayNotificationType.SUCCESS,
        duration: 5000,
      });
    }, 2000);
  }

  private handleShowSettings(): void {
    // Show settings - could trigger a modal or navigate to settings page
    console.log('Show settings requested from tray');
  }

  private handleShowAbout(): void {
    // Show about dialog
    console.log('Show about requested from tray');
  }

  // Public API methods
  public async showNotification(notification: TrayNotification): Promise<void> {
    try {
      const response =
        await window.electronAPI.showTrayNotification(notification);
      if (!response.success) {
        throw new Error(response.error || 'Failed to show tray notification');
      }
    } catch (error) {
      console.error('System Tray Service - Error showing notification:', error);
      throw error;
    }
  }

  public async updateTrayState(state: Partial<TrayState>): Promise<void> {
    try {
      const response = await window.electronAPI.updateTrayState(state);
      if (!response.success) {
        throw new Error(response.error || 'Failed to update tray state');
      }

      // Update local state
      this.currentState = { ...this.currentState, ...state };
    } catch (error) {
      console.error('System Tray Service - Error updating tray state:', error);
      throw error;
    }
  }

  public async getTrayState(): Promise<TrayState> {
    try {
      const response = await window.electronAPI.getTrayState();
      if (!response.success) {
        throw new Error(response.error || 'Failed to get tray state');
      }

      this.currentState = response.data || this.currentState;
      return this.currentState;
    } catch (error) {
      console.error('System Tray Service - Error getting tray state:', error);
      throw error;
    }
  }

  public async toggleWindowVisibility(): Promise<void> {
    try {
      const response = await window.electronAPI.toggleWindowVisibility();
      if (!response.success) {
        throw new Error(response.error || 'Failed to toggle window visibility');
      }
    } catch (error) {
      console.error(
        'System Tray Service - Error toggling window visibility:',
        error
      );
      throw error;
    }
  }

  public async quitApplication(): Promise<void> {
    try {
      const response = await window.electronAPI.quitApplication();
      if (!response.success) {
        throw new Error(response.error || 'Failed to quit application');
      }
    } catch (error) {
      console.error('System Tray Service - Error quitting application:', error);
      throw error;
    }
  }

  // State management
  public getCurrentState(): TrayState {
    return { ...this.currentState };
  }

  public isTrackingActive(): boolean {
    return this.currentState.isTrackingActive;
  }

  public isWindowVisible(): boolean {
    return this.currentState.isVisible;
  }

  public getUnreadNotifications(): number {
    return this.currentState.unreadNotifications;
  }

  // Utility methods for common notifications
  public showSuccessNotification(
    title: string,
    body: string,
    duration = 3000
  ): Promise<void> {
    return this.showNotification({
      title,
      body,
      type: TrayNotificationType.SUCCESS,
      duration,
    });
  }

  public showErrorNotification(
    title: string,
    body: string,
    duration = 5000
  ): Promise<void> {
    return this.showNotification({
      title,
      body,
      type: TrayNotificationType.ERROR,
      duration,
    });
  }

  public showInfoNotification(
    title: string,
    body: string,
    duration = 3000
  ): Promise<void> {
    return this.showNotification({
      title,
      body,
      type: TrayNotificationType.INFO,
      duration,
    });
  }

  public showWarningNotification(
    title: string,
    body: string,
    duration = 4000
  ): Promise<void> {
    return this.showNotification({
      title,
      body,
      type: TrayNotificationType.WARNING,
      duration,
    });
  }

  // Activity tracking helpers
  public async startTracking(): Promise<void> {
    await this.updateTrayState({ isTrackingActive: true });
    await this.showSuccessNotification(
      'ProduTime',
      'Activity tracking started'
    );
  }

  public async stopTracking(): Promise<void> {
    await this.updateTrayState({ isTrackingActive: false });
    await this.showInfoNotification('ProduTime', 'Activity tracking stopped');
  }

  public async setLastActivity(activity: string): Promise<void> {
    await this.updateTrayState({ lastActivity: activity });
  }

  // Cleanup
  public cleanup(): void {
    if (this.notificationCleanup) {
      this.notificationCleanup();
      this.notificationCleanup = null;
    }

    if (this.actionCleanup) {
      this.actionCleanup();
      this.actionCleanup = null;
    }
  }
}
