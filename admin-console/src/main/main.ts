/**
 * ProduTime Admin Console - Main Process
 * Electron main process for the Admin Console application
 * 
 * CRITICAL FIX: Added licensing gate - blocks access until license is validated
 */

import { app, BrowserWindow, ipcMain, Menu, dialog } from 'electron';
import * as path from 'path';
import { AdminDatabase } from './db';
import { AdminServer } from './server';
import { AdminLicensingService } from './licensing-service';
import { AdminAssistedUpdater } from './assisted-updater';

let mainWindow: BrowserWindow | null = null;
let db: AdminDatabase | null = null;
let server: AdminServer | null = null;
let licensingService: AdminLicensingService | null = null;
let assistedUpdater: AdminAssistedUpdater | null = null;

// Ed25519 public key for license verification (same as main app and server)
const LICENSING_PUBLIC_KEY = 'yBpM6mVTBbG9j8SmQlQFvRWlL8TfOwHuzWEO7zhHzgw=';

// Get the correct icon path for both dev and production
function getIconPath(): string {
  if (app.isPackaged) {
    // In production, icon is in resources folder
    return path.join(process.resourcesPath, 'assets', 'PTAdminIcon.png');
  }
  // In development, use the main assets folder
  return path.join(__dirname, '../../../assets/PTAdminIcon.png');
}

function createWindow(): void {
  const iconPath = getIconPath();

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    title: 'ProduTime Admin Console',
    icon: iconPath,
  });

  // Show window maximized when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow?.maximize();
    mainWindow?.show();
    mainWindow?.focus();
    console.log('Admin Console window shown, maximized, and focused');
  });

  // Load the renderer
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:3001');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Create menu
  const menu = Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Check for Updates',
          click: () => {
            assistedUpdater?.checkForUpdates(true);
          },
        },
        { type: 'separator' },
        {
          label: 'Activate License',
          click: () => {
            // Send event to renderer to open activation modal
            mainWindow?.webContents.send('open-activation');
          },
        },
        { type: 'separator' },
        {
          label: 'About',
          click: () => {
            dialog.showMessageBox(mainWindow!, {
              type: 'info',
              title: 'About ProduTime Admin Console',
              message: `ProduTime Admin Console`,
              detail: `Version: ${app.getVersion()}\n\nCentralized management for ProduTime devices.`,
              buttons: ['OK'],
            });
          },
        },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

function initializeServices(): void {
  // Initialize database
  db = new AdminDatabase();

  // CRITICAL FIX: Initialize licensing service
  licensingService = new AdminLicensingService(db, LICENSING_PUBLIC_KEY);

  // Initialize server
  server = new AdminServer(db);

  // Set up server event handlers
  server.onDeviceConnected = (deviceId) => {
    console.log('[MAIN] onDeviceConnected callback fired for:', deviceId);
    mainWindow?.webContents.send('device:connected', deviceId);
    console.log('[MAIN] Sent device:connected event to renderer');
  };

  server.onDeviceDisconnected = (deviceId) => {
    console.log('[MAIN] onDeviceDisconnected callback fired for:', deviceId);
    mainWindow?.webContents.send('device:disconnected', deviceId);
  };

  server.onPairRequest = (request) => {
    console.log('[MAIN] onPairRequest callback fired:', request);
    mainWindow?.webContents.send('pair:request', request);
  };

  server.onStatsReceived = (deviceId, stats) => {
    mainWindow?.webContents.send('stats:received', { deviceId, stats });
  };

  server.onLog = (message) => {
    // Send to renderer if window exists
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('server:log', message);
    }
  };

  // Start server
  server.start().then(() => {
    console.log('Admin Console server started');
    mainWindow?.webContents.send('server:started', {
      port: server!.getPort(),
      publicKey: server!.getAdminPublicKey(),
    });
  }).catch((error) => {
    console.error('Failed to start server:', error);
  });
}

function registerIpcHandlers(): void {
  // ============================================================
  // CRITICAL FIX: Licensing IPC Handlers
  // ============================================================

  ipcMain.handle('licensing:getStatus', async () => {
    return licensingService?.getStatus() || { licensed: false, reason: 'Service not initialized' };
  });

  ipcMain.handle('licensing:activate', async (_, licenseKey: string) => {
    if (!licensingService) {
      return { success: false, error: 'Service not initialized' };
    }
    return licensingService.activateWithKey(licenseKey);
  });

  ipcMain.handle('licensing:deactivate', async () => {
    licensingService?.deactivate();
    return { success: true };
  });

  ipcMain.handle('licensing:getMachineHash', async () => {
    return licensingService?.getMachineHash() || '';
  });

  ipcMain.handle('licensing:startTrial', async () => {
    if (!licensingService) {
      return { success: false, error: 'Service not initialized' };
    }
    return await licensingService.startTrial();
  });

  // Device handlers
  ipcMain.handle('devices:getAll', () => {
    return db?.getAllDevices() || [];
  });

  ipcMain.handle('devices:get', (_, deviceId: string) => {
    return db?.getDevice(deviceId) || null;
  });

  ipcMain.handle('devices:delete', (_, deviceId: string) => {
    db?.deleteDevice(deviceId);
    return { success: true };
  });

  ipcMain.handle('devices:getConnected', () => {
    const connected = server?.getConnectedDevices() || [];
    console.log('[MAIN] devices:getConnected called, returning:', connected);
    return connected;
  });

  // Policy handlers
  ipcMain.handle('policies:getAll', () => {
    return db?.getAllPolicies() || [];
  });

  ipcMain.handle('policies:get', (_, policyId: string) => {
    return db?.getPolicy(policyId) || null;
  });

  ipcMain.handle('policies:create', (_, policy: any) => {
    const policyId = require('crypto').randomUUID();
    db?.insertPolicy({
      policy_id: policyId,
      name: policy.name,
      policy_json: JSON.stringify(policy.data),
      updated_at: Date.now(),
    });
    return { success: true, policyId };
  });

  ipcMain.handle('policies:update', (_, policyId: string, name: string, data: any) => {
    db?.updatePolicy(policyId, name, JSON.stringify(data));
    return { success: true };
  });

  ipcMain.handle('policies:delete', (_, policyId: string) => {
    db?.deletePolicy(policyId);
    return { success: true };
  });

  ipcMain.handle('policies:assign', (_, deviceId: string, policyId: string) => {
    db?.assignPolicyToDevice(deviceId, policyId);
    return { success: true };
  });

  ipcMain.handle('policies:push', (_, deviceId: string, policy: any) => {
    const success = server?.pushPolicy(deviceId, policy) || false;
    return { success };
  });

  // Pairing handlers
  ipcMain.handle('pairing:generateCode', () => {
    const code = server?.generatePairCode();
    return { code, expiresAt: Date.now() + 300000 };
  });

  ipcMain.handle('pairing:getCurrentCode', () => {
    return server?.getCurrentPairCode() || null;
  });

  ipcMain.handle('pairing:getPending', () => {
    return db?.getAllPendingPairs() || [];
  });

  ipcMain.handle('pairing:approve', (_, requestId: string) => {
    console.log('[MAIN] pairing:approve called for requestId:', requestId);
    const success = server?.approvePairing(requestId) || false;
    console.log('[MAIN] approvePairing returned:', success);

    // After approval, log the connected devices
    const connected = server?.getConnectedDevices() || [];
    console.log('[MAIN] Connected devices after approval:', connected);

    return { success };
  });

  ipcMain.handle('pairing:deny', (_, requestId: string) => {
    const success = server?.denyPairing(requestId) || false;
    return { success };
  });

  // Device control handlers
  ipcMain.handle('device:lock', (_, deviceId: string, reason: string, message: string) => {
    const success = server?.lockDevice(deviceId, reason, message) || false;
    return { success };
  });

  ipcMain.handle('device:unlock', (_, deviceId: string) => {
    const success = server?.unlockDevice(deviceId) || false;
    return { success };
  });

  ipcMain.handle('device:requestExport', (_, deviceId: string, options: any) => {
    const success = server?.requestExport(deviceId, options) || false;
    return { success };
  });

  // Audit log handlers
  ipcMain.handle('audit:getLogs', (_, limit?: number) => {
    return db?.getAuditLogs(limit) || [];
  });

  // Server info
  ipcMain.handle('server:getInfo', () => {
    return {
      port: server?.getPort() || 0,
      publicKey: server?.getAdminPublicKey() || '',
      connectedDevices: server?.getConnectedDevices().length || 0,
    };
  });

  // Device stats
  ipcMain.handle('stats:getDevice', (_, deviceId: string) => {
    return db?.getDeviceStats(deviceId) || null;
  });

  // Server logs
  ipcMain.handle('server:getLogs', (_, count?: number) => {
    return server?.getLogs(count) || [];
  });

  // ============================================================
  // Dashboard API Handlers
  // ============================================================

  ipcMain.handle('dashboard:getSummary', (_, range: 'today' | '7d') => {
    const dashboardService = server?.getDashboardService();
    return dashboardService?.getDashboardSummary(range) || null;
  });

  ipcMain.handle('dashboard:getDevices', () => {
    const dashboardService = server?.getDashboardService();
    return dashboardService?.getDevicesList() || [];
  });

  ipcMain.handle('dashboard:getDeviceDetail', (_, deviceId: string, range: 'today' | '7d') => {
    const dashboardService = server?.getDashboardService();
    return dashboardService?.getDeviceDetail(deviceId, range) || null;
  });

  ipcMain.handle('dashboard:getExceptions', (_, resolved?: boolean) => {
    if (resolved === false) {
      return db?.getUnresolvedExceptions(100) || [];
    }
    return db?.getUnresolvedExceptions(100) || [];
  });

  ipcMain.handle('dashboard:resolveException', (_, id: number) => {
    const dashboardService = server?.getDashboardService();
    dashboardService?.resolveException(id);
    return { success: true };
  });

  ipcMain.handle('dashboard:getExceptionCounts', () => {
    const dashboardService = server?.getDashboardService();
    return dashboardService?.getExceptionCounts() || {};
  });

  ipcMain.handle('dashboard:getRecentHeartbeats', (_, limit?: number) => {
    return db?.getRecentHeartbeats(limit || 100) || [];
  });

  ipcMain.handle('dashboard:getRecentCommands', (_, limit?: number) => {
    return db?.getRecentCommands(limit || 100) || [];
  });

  // Enhanced Dashboard API (Performance Model)
  ipcMain.handle('dashboard:getSummaryEnhanced', (_, range: 'today' | '7d') => {
    const dashboardService = server?.getDashboardService();
    return dashboardService?.getDashboardSummaryEnhanced(range) || null;
  });

  ipcMain.handle('dashboard:getDevicesEnhanced', () => {
    const dashboardService = server?.getDashboardService();
    return dashboardService?.getDevicesListEnhanced() || [];
  });

  ipcMain.handle('dashboard:getAttention', () => {
    const dashboardService = server?.getDashboardService();
    return dashboardService?.getAttentionGroups() || { groups: [], totalCount: 0 };
  });

  ipcMain.handle('dashboard:getStory', () => {
    const dashboardService = server?.getDashboardService();
    return dashboardService?.getDashboardStory() || null;
  });

  ipcMain.handle('dashboard:getRankings', () => {
    const dashboardService = server?.getDashboardService();
    return dashboardService?.getRankings() || null;
  });

  ipcMain.handle('dashboard:getTrends', (_, scope: 'team' | 'device', deviceId?: string, days?: number) => {
    const dashboardService = server?.getDashboardService();
    return dashboardService?.getTrends(scope, deviceId, days || 7) || null;
  });

  // Enhanced Device Detail (for DeviceDetailPage)
  ipcMain.handle('dashboard:getDeviceDetailEnhanced', (_, deviceId: string, range: 'today' | '7d' | '30d') => {
    const { DeviceDetailService } = require('./device-detail-service');
    const detailService = new DeviceDetailService(db);
    return detailService.getDeviceDetail(deviceId, range);
  });

  // ============================================================
  // App Categorization IPC Handlers
  // ============================================================

  ipcMain.handle('apps:getUsageAggregates', () => {
    const todayYmd = new Date().toISOString().split('T')[0];
    // First aggregate from heartbeats
    db?.aggregateAppUsageFromHeartbeats(todayYmd);
    return db?.getAppUsageAggregates(todayYmd) || [];
  });

  ipcMain.handle('apps:getCategory', (_, appName: string) => {
    return db?.getAppCategory(appName) || null;
  });

  ipcMain.handle('apps:setCategory', (_, appName: string, category: string) => {
    db?.setAppCategory(appName, category as any);
    return { success: true };
  });

  ipcMain.handle('apps:setCategoriesBulk', (_, apps: Array<{ appName: string; category: string }>) => {
    db?.setAppCategoriesBulk(apps as any);
    return { success: true };
  });

  ipcMain.handle('apps:getAllCategories', () => {
    return db?.getAllAppCategories() || [];
  });

  // ============================================================
  // Weekly Insights IPC Handlers
  // ============================================================

  ipcMain.handle('insights:getWeekly', (_, weekEnd?: string) => {
    const endDate = weekEnd || new Date().toISOString().split('T')[0];
    return db?.getWeeklyInsights(endDate) || [];
  });

  ipcMain.handle('reports:getAll', () => {
    return db?.getAllWeeklyReports() || [];
  });

  ipcMain.handle('reports:get', (_, weekEnd: string) => {
    return db?.getWeeklyReport(weekEnd) || null;
  });

  ipcMain.handle('reports:generate', async () => {
    // TODO: Implement weekly report generation
    return { success: false, message: 'Not implemented yet' };
  });

  // ============================================================
  // Assisted Updater IPC Handlers
  // ============================================================

  ipcMain.handle('updater:checkForUpdates', async () => {
    return assistedUpdater?.checkForUpdates(true) || { updateAvailable: false };
  });

  ipcMain.handle('updater:getVersion', () => {
    return app.getVersion();
  });
}

// App lifecycle
app.whenReady().then(async () => {
  initializeServices();
  registerIpcHandlers();

  // CRITICAL FIX: Initialize licensing service before showing window
  if (licensingService) {
    await licensingService.init();
    console.log('[MAIN] Licensing service initialized');
    const status = licensingService.getStatus();
    console.log('[MAIN] License status:', status.licensed ? 'LICENSED' : 'NOT LICENSED', status.reason || '');
  }

  createWindow();

  // Initialize assisted updater after window is created
  if (mainWindow) {
    assistedUpdater = new AdminAssistedUpdater(mainWindow);
    assistedUpdater.startBackgroundChecks();
    console.log('[MAIN] Assisted updater initialized');
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  // CRITICAL FIX: Stop heartbeat on quit
  licensingService?.stopHeartbeat();
  assistedUpdater?.cleanup();
  server?.stop();
  db?.close();
});
