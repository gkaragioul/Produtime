import {
  Tray,
  Menu,
  BrowserWindow,
  nativeImage,
  Notification,
  app,
} from 'electron';
import * as path from 'path';
import {
  TrayNotification,
  TrayNotificationType,
  TrayState,
  TrayMenuAction,
} from '../shared/types';

export class SystemTrayManager {
  private tray: Tray | null = null;
  private mainWindow: BrowserWindow | null = null;
  private currentState: TrayState = {
    isVisible: true,
    isTrackingActive: false,
    unreadNotifications: 0,
  };
  private notifications: Map<string, Notification> = new Map();
  
  // Managed state for tray menu (Requirement 3.8, 9.3)
  private isManaged: boolean = false;
  private managedByName: string | null = null;
  private isCloudConnection: boolean = false;

  constructor(mainWindow: BrowserWindow) {
    console.log('SystemTrayManager constructor called');
    this.mainWindow = mainWindow;
    this.initializeTray();
  }

  private initializeTray(): void {
    try {
      console.log('Starting tray initialization...');

      // Load ProduTime logo icon
      const trayIcon = this.loadTrayIcon();
      console.log('Loaded tray icon');

      // Set template image for macOS
      if (process.platform === 'darwin') {
        trayIcon.setTemplateImage(true);
        console.log('Set template image for macOS');
      }

      console.log('Creating Tray instance...');
      this.tray = new Tray(trayIcon);
      console.log('Tray instance created');

      this.tray.setToolTip('ProduTime - Activity Tracker');
      console.log('Set tray tooltip');

      // Set up event listeners
      this.setupTrayEventListeners();
      console.log('Set up tray event listeners');

      // Create initial context menu
      this.updateTrayMenu();
      console.log('Updated tray menu');

      console.log('System tray initialized successfully');
    } catch (error) {
      console.error('Error initializing system tray:', error);
    }
  }

  private loadTrayIcon(): Electron.NativeImage {
    try {
      // Try multiple paths for the ProduTime logo (try ICO first, then PNG)
      const possiblePaths = [
        // Production paths (packaged app) - ICO format
        path.join(process.resourcesPath, 'assets', 'icon.ico'),
        path.join(process.resourcesPath, 'assets', 'icon.png'),
        // Development paths - ICO format
        path.join(__dirname, '..', '..', 'assets', 'icon.ico'),
        path.join(__dirname, '..', '..', 'assets', 'icon.png'),
        // Alternative production paths
        path.join(__dirname, '..', 'assets', 'icon.ico'),
        path.join(__dirname, '..', 'assets', 'icon.png'),
      ];

      for (const iconPath of possiblePaths) {
        console.log(`Trying icon path: ${iconPath}`);
        if (require('fs').existsSync(iconPath)) {
          console.log(`Found icon at: ${iconPath}`);
          const icon = nativeImage.createFromPath(iconPath);
          if (!icon.isEmpty()) {
            console.log(`Successfully loaded icon from: ${iconPath}`);
            // For ICO files, don't resize - they already contain multiple sizes
            // For PNG files, resize to 16x16
            if (iconPath.endsWith('.ico')) {
              return icon;
            } else {
              return icon.resize({ width: 16, height: 16 });
            }
          }
        }
      }

      console.warn('ProduTime icon not found in any path, using fallback');
      return this.createFallbackIcon();
    } catch (error) {
      console.error('Error loading tray icon:', error);
      return this.createFallbackIcon();
    }
  }

  private createFallbackIcon(): Electron.NativeImage {
    // Fallback: Create a simple "PT" icon using bitmap
    const width = 16;
    const height = 16;
    const bgraBlue: [number, number, number, number] = [255, 123, 0, 255]; // B,G,R,A for #007bff
    const bgraWhite: [number, number, number, number] = [255, 255, 255, 255];

    const buffer = Buffer.alloc(width * height * 4, 0);

    const setPixel = (
      x: number,
      y: number,
      color: [number, number, number, number]
    ) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const idx = (y * width + x) * 4;
      buffer[idx + 0] = color[0]; // B
      buffer[idx + 1] = color[1]; // G
      buffer[idx + 2] = color[2]; // R
      buffer[idx + 3] = color[3]; // A
    };

    // Fill background blue
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        setPixel(x, y, bgraBlue);
      }
    }

    // Draw 'T': top bar and vertical stem
    // Top bar
    for (let x = 2; x < width - 2; x++) {
      setPixel(x, 3, bgraWhite);
      setPixel(x, 4, bgraWhite);
    }
    // Vertical stem centered
    const stemX = Math.floor(width / 2);
    for (let y = 5; y < height - 2; y++) {
      setPixel(stemX - 1, y, bgraWhite);
      setPixel(stemX, y, bgraWhite);
      setPixel(stemX + 1, y, bgraWhite);
    }

    return nativeImage.createFromBitmap(buffer, {
      width,
      height,
      scaleFactor: 1,
    });
  }

  private getTrayIconPath(): string {
    // For development, try to use a built-in Electron icon or create a simple one
    const platform = process.platform;

    // Try to use the app icon first, fallback to a simple approach
    try {
      // Use a simple 16x16 icon data URL for development
      const iconPath = path.join(
        __dirname,
        '..',
        '..',
        'assets',
        'tray-icon.png'
      );

      // Check if file exists, if not, we'll create a simple icon programmatically
      return iconPath;
    } catch (error) {
      console.warn('Could not load tray icon, using fallback');
      // Return a fallback path - Electron will handle missing icons gracefully
      return path.join(__dirname, '..', '..', 'assets', 'tray-icon.png');
    }
  }

  private setupTrayEventListeners(): void {
    if (!this.tray) return;

    // Double-click to show/hide main window
    this.tray.on('double-click', () => {
      this.toggleMainWindow();
    });

    // Right-click to show context menu (handled automatically by Electron)
    this.tray.on('right-click', () => {
      this.updateTrayMenu();
    });

    // Handle balloon click (Windows)
    this.tray.on('balloon-click', () => {
      this.showMainWindow();
    });
  }

  private updateTrayMenu(): void {
    if (!this.tray) return;

    // Build menu template with managed status indicator (Requirement 3.8, 9.3)
    const menuTemplate: any[] = [];

    // Add "Managed by" indicator if paired
    if (this.isManaged && this.managedByName) {
      menuTemplate.push({
        label: `Managed by ${this.managedByName}`,
        enabled: false,
        icon: this.isCloudConnection ? undefined : undefined, // Could add icons here
      });
      menuTemplate.push({ type: 'separator' });
    }

    // Standard menu items
    menuTemplate.push({
      label: this.currentState.isVisible
        ? 'Hide ProduTime'
        : 'Show ProduTime',
      click: () => this.toggleMainWindow(),
    });
    menuTemplate.push({ type: 'separator' });
    menuTemplate.push({
      label: 'Quit ProduTime',
      click: () => this.quitApplication(),
    });

    const contextMenu = Menu.buildFromTemplate(menuTemplate);
    this.tray.setContextMenu(contextMenu);
  }

  public showNotification(notification: TrayNotification): void {
    try {
      if (!Notification.isSupported()) {
        console.warn('Notifications are not supported on this system');
        return;
      }

      const notificationId = `notification_${Date.now()}`;

      const electronNotification = new Notification({
        title: notification.title,
        body: notification.body,
        icon: this.getTrayIconPath(),
        silent: notification.type === TrayNotificationType.INFO,
        urgency: this.getNotificationUrgency(notification.type),
      });

      // Store notification reference
      this.notifications.set(notificationId, electronNotification);

      // Set up notification event listeners
      electronNotification.on('click', () => {
        this.handleNotificationClick(notificationId);
      });

      electronNotification.on('close', () => {
        this.notifications.delete(notificationId);
      });

      // Show notification
      electronNotification.show();

      // Auto-remove after duration if specified
      if (notification.duration && notification.duration > 0) {
        setTimeout(() => {
          if (this.notifications.has(notificationId)) {
            electronNotification.close();
            this.notifications.delete(notificationId);
          }
        }, notification.duration);
      }

      // Update unread count
      this.currentState.unreadNotifications++;
      this.updateTrayTooltip();
    } catch (error) {
      console.error('Error showing tray notification:', error);
    }
  }

  private getNotificationUrgency(
    type: TrayNotificationType
  ): 'normal' | 'critical' | 'low' {
    switch (type) {
      case TrayNotificationType.ERROR:
        return 'critical';
      case TrayNotificationType.WARNING:
        return 'normal';
      case TrayNotificationType.SUCCESS:
      case TrayNotificationType.INFO:
      default:
        return 'low';
    }
  }

  private handleNotificationClick(notificationId: string): void {
    // Show main window when notification is clicked
    this.showMainWindow();

    // Clear unread notifications
    this.currentState.unreadNotifications = Math.max(
      0,
      this.currentState.unreadNotifications - 1
    );
    this.updateTrayTooltip();

    // Notify renderer process
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(
        'tray:notificationClicked',
        notificationId
      );
    }
  }

  private showMainWindow(): void {
    if (this.mainWindow) {
      if (this.mainWindow.isMinimized()) {
        this.mainWindow.restore();
      }
      this.mainWindow.show();
      this.mainWindow.focus();
      this.currentState.isVisible = true;
      this.updateTrayMenu();
    }
  }

  private hideMainWindow(): void {
    if (this.mainWindow) {
      this.mainWindow.hide();
      this.currentState.isVisible = false;
      this.updateTrayMenu();
    }
  }

  private toggleMainWindow(): void {
    if (this.currentState.isVisible) {
      this.hideMainWindow();
    } else {
      this.showMainWindow();
    }
  }

  private updateTrayTooltip(): void {
    if (!this.tray) return;

    // Show managed status in tooltip (Requirement 3.8, 9.3)
    let tooltip = 'ProduTime - Activity Tracker';
    if (this.isManaged && this.managedByName) {
      tooltip = `ProduTime - Managed by ${this.managedByName}`;
      if (this.isCloudConnection) {
        tooltip += ' (Cloud)';
      }
    }
    this.tray.setToolTip(tooltip);
  }

  public updateState(newState: Partial<TrayState>): void {
    // Story 1 scope: Only update visibility state
    if (newState.isVisible !== undefined) {
      this.currentState.isVisible = newState.isVisible;
      this.updateTrayMenu();
    }
  }

  /**
   * Update managed status for tray display
   * Requirement 3.8, 9.3: Display "Managed by [Company Name]" indicator
   */
  public updateManagedStatus(isManaged: boolean, managedByName: string | null, isCloudConnection: boolean = false): void {
    this.isManaged = isManaged;
    this.managedByName = managedByName;
    this.isCloudConnection = isCloudConnection;
    this.updateTrayMenu();
    this.updateTrayTooltip();
  }

  public getCurrentState(): TrayState {
    return { ...this.currentState };
  }

  private quitApplication(): void {
    // Clean up notifications
    this.notifications.forEach((notification) => notification.close());
    this.notifications.clear();

    // Quit the application
    app.quit();
  }

  public cleanup(): void {
    // Clean up notifications
    this.notifications.forEach((notification) => notification.close());
    this.notifications.clear();

    // Destroy tray
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }

    this.mainWindow = null;
    console.log('System tray cleaned up');
  }

  // Utility methods for external use
  public isInitialized(): boolean {
    return this.tray !== null;
  }

  // Story 1 scope: Basic utility methods only
  // Advanced tracking and notification methods will be added in future stories
}
