/**
 * ProduTime Admin Console - Main Process (Freeware Edition)
 * No licensing, no update checks, all features available.
 */

import { app, BrowserWindow, ipcMain, Menu, dialog } from 'electron';
import * as path from 'path';
import { AdminDatabase } from './db';
import { AdminServer } from './server';

let mainWindow: BrowserWindow | null = null;
let db: AdminDatabase | null = null;
let server: AdminServer | null = null;

// Get the correct icon path for both dev and production
function getIconPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'assets', 'PTAdminIcon.png');
  }
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

  mainWindow.once('ready-to-show', () => {
    mainWindow?.maximize();
    mainWindow?.show();
    mainWindow?.focus();
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:3001');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Freeware menu — no licensing or update items
  const menu = Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [{ role: 'quit' }],
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
          label: 'About',
          click: () => {
            dialog.showMessageBox(mainWindow!, {
              type: 'info',
              title: 'About ProduTime Admin Console',
              message: 'ProduTime Admin Console',
              detail: `Version: ${app.getVersion()}\n\nFree local network management for ProduTime devices.`,
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
  db = new AdminDatabase();
  server = new AdminServer(db);

  server.onDeviceConnected = (deviceId) => {
    mainWindow?.webContents.send('device:connected', deviceId);
  };

  server.onDeviceDisconnected = (deviceId) => {
    mainWindow?.webContents.send('device:disconnected', deviceId);
  };

  server.onPairRequest = (request) => {
    mainWindow?.webContents.send('pair:request', request);
  };

  server.onStatsReceived = (deviceId, stats) => {
    mainWindow?.webContents.send('stats:received', { deviceId, stats });
  };

  server.onLog = (message) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('server:log', message);
    }
  };

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
    return server?.getConnectedDevices() || [];
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
    const success = server?.approvePairing(requestId) || false;
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

  // Dashboard API Handlers
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

  // Enhanced Device Detail
  ipcMain.handle('dashboard:getDeviceDetailEnhanced', (_, deviceId: string, range: 'today' | '7d' | '30d') => {
    const { DeviceDetailService } = require('./device-detail-service');
    const detailService = new DeviceDetailService(db);
    return detailService.getDeviceDetail(deviceId, range);
  });

  // App Categorization IPC Handlers
  ipcMain.handle('apps:getUsageAggregates', () => {
    const todayYmd = new Date().toISOString().split('T')[0];
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

  // Weekly Insights IPC Handlers
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
    return { success: false, message: 'Not implemented yet' };
  });

  // Version
  ipcMain.handle('updater:getVersion', () => {
    return app.getVersion();
  });
}

// App lifecycle
app.whenReady().then(async () => {
  initializeServices();
  registerIpcHandlers();
  createWindow();

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
  server?.stop();
  db?.close();
});
