/**
 * ProduTime Admin Console - Main Process (Freeware Edition)
 * No licensing, no update checks, all features available.
 */

import { app, BrowserWindow, ipcMain, Menu, dialog } from 'electron';
import * as path from 'path';
import * as crypto from 'crypto';
import { AdminDatabase } from './db';
import { AdminServer } from './server';

let mainWindow: BrowserWindow | null = null;
let db: AdminDatabase | null = null;
let server: AdminServer | null = null;

// Authentication state (in-memory, resets on app restart)
let isAdminAuthenticated = false;
let authExpiry: number | null = null;

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

  server.onExportResult = (deviceId, result) => {
    mainWindow?.webContents.send('export:result', { deviceId, result });
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

function hashPassword(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/**
 * Re-push policy (with updated app categories) to all connected devices that have an assigned policy.
 */
function pushCategoriesToAllDevices(): void {
  if (!db || !server) return;

  const allDevices = db.getAllDevices();
  const connectedIds = server.getConnectedDevices();

  for (const device of allDevices) {
    if (!device.policy_id || !connectedIds.includes(device.device_id)) continue;

    const policyRecord = db.getPolicy(device.policy_id);
    if (!policyRecord) continue;

    try {
      const policyData = JSON.parse(policyRecord.policy_json);
      policyData.version = policyData.version || policyRecord.policy_id;
      policyData.updatedAt = policyData.updatedAt || policyRecord.updated_at;
      server.pushPolicy(device.device_id, policyData);
    } catch (err) {
      console.error(`Failed to push categories to device ${device.device_id}:`, err);
    }
  }
}

function registerIpcHandlers(): void {
  // Authentication handlers
  ipcMain.handle('auth:login', async (_, password: string) => {
    try {
      let storedHash = db?.getSetting('admin_password_hash') ?? null;

      // First run: hash default password and store it
      if (!storedHash) {
        const salt = crypto.randomBytes(16);
        const hash = await hashPassword('admin123', salt);
        storedHash = salt.toString('hex') + ':' + hash.toString('hex');
        db?.setSetting('admin_password_hash', storedHash);
      }

      // Verify the incoming password
      const [saltHex, hashHex] = storedHash.split(':');
      const salt = Buffer.from(saltHex, 'hex');
      const expectedHash = Buffer.from(hashHex, 'hex');
      const incomingHash = await hashPassword(password, salt);

      // Constant-time comparison
      if (crypto.timingSafeEqual(expectedHash, incomingHash)) {
        isAdminAuthenticated = true;
        authExpiry = Date.now() + 8 * 60 * 60 * 1000; // 8 hours
        return { success: true };
      } else {
        return { success: false, error: 'Invalid password' };
      }
    } catch (error) {
      console.error('Auth login error:', error);
      return { success: false, error: 'Authentication error' };
    }
  });

  ipcMain.handle('auth:isAuthenticated', () => {
    if (isAdminAuthenticated && authExpiry && Date.now() < authExpiry) {
      return { authenticated: true };
    }
    // Expired or not authenticated
    isAdminAuthenticated = false;
    authExpiry = null;
    return { authenticated: false };
  });

  ipcMain.handle('auth:logout', () => {
    isAdminAuthenticated = false;
    authExpiry = null;
    return { success: true };
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
    pushCategoriesToAllDevices();
    return { success: true };
  });

  ipcMain.handle('apps:setCategoriesBulk', (_, apps: Array<{ appName: string; category: string }>) => {
    db?.setAppCategoriesBulk(apps as any);
    pushCategoriesToAllDevices();
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
    try {
      if (!db) {
        return { success: false, message: 'Database not initialized' };
      }

      // 1. Calculate week range: Monday of this week to Sunday (or today if mid-week)
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon, ...
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const monday = new Date(today);
      monday.setDate(today.getDate() + mondayOffset);

      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);

      const endDate = sunday <= today ? sunday : today;

      const startDateStr = monday.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];

      // 2. Get team daily metrics for the range
      const teamDaily = db.getTeamDailyMetricsRange(startDateStr, endDateStr);

      // 3. Get all devices and per-device metrics
      const devices = db.getAllDevices();
      const perDeviceData: Array<{
        device_id: string;
        device_name: string;
        active_seconds: number;
        idle_seconds: number;
        untracked_seconds: number;
        productive_seconds: number;
        unproductive_seconds: number;
        top_apps: Array<{ app: string; seconds: number }>;
      }> = [];

      for (const device of devices) {
        const deviceMetrics = db.getDeviceDailyMetricsRange(device.device_id, startDateStr, endDateStr);
        let active = 0, idle = 0, untracked = 0, productive = 0, unproductive = 0;
        const appTotals = new Map<string, number>();

        for (const m of deviceMetrics) {
          active += m.active_seconds || 0;
          idle += m.idle_seconds || 0;
          untracked += m.untracked_seconds || 0;
          productive += m.productive_seconds || 0;
          unproductive += m.unproductive_seconds || 0;

          try {
            const apps = JSON.parse(m.top_apps_json || '[]') as Array<{ app: string; seconds: number }>;
            for (const a of apps) {
              appTotals.set(a.app, (appTotals.get(a.app) || 0) + a.seconds);
            }
          } catch {
            // Ignore parse errors
          }
        }

        const topApps = Array.from(appTotals.entries())
          .map(([app, seconds]) => ({ app, seconds }))
          .sort((a, b) => b.seconds - a.seconds)
          .slice(0, 10);

        perDeviceData.push({
          device_id: device.device_id,
          device_name: device.device_name,
          active_seconds: active,
          idle_seconds: idle,
          untracked_seconds: untracked,
          productive_seconds: productive,
          unproductive_seconds: unproductive,
          top_apps: topApps,
        });
      }

      // 4. Build report JSON
      const teamTotals = {
        active_seconds: teamDaily.reduce((s, d) => s + (d.active_seconds || 0), 0),
        idle_seconds: teamDaily.reduce((s, d) => s + (d.idle_seconds || 0), 0),
        untracked_seconds: teamDaily.reduce((s, d) => s + (d.untracked_seconds || 0), 0),
        productive_seconds: teamDaily.reduce((s, d) => s + (d.productive_seconds || 0), 0),
        unproductive_seconds: teamDaily.reduce((s, d) => s + (d.unproductive_seconds || 0), 0),
      };

      const reportJson = {
        week_start: startDateStr,
        week_end: endDateStr,
        team_totals: teamTotals,
        daily_breakdown: teamDaily,
        per_device: perDeviceData,
      };

      // 5. Generate narrative
      const activeHours = (teamTotals.active_seconds / 3600).toFixed(1);
      const deviceCount = perDeviceData.filter(d => d.active_seconds > 0).length;
      const topPerformer = perDeviceData.length > 0
        ? perDeviceData.reduce((best, d) => d.active_seconds > best.active_seconds ? d : best, perDeviceData[0])
        : null;

      let narrative = `Team logged ${activeHours} hours of active time across ${deviceCount} device${deviceCount !== 1 ? 's' : ''} from ${startDateStr} to ${endDateStr}.`;
      if (topPerformer && topPerformer.active_seconds > 0) {
        const topHours = (topPerformer.active_seconds / 3600).toFixed(1);
        narrative += ` Top performer: ${topPerformer.device_name} with ${topHours} hours.`;
      }

      // 6. Save to DB
      db.insertWeeklyReport({
        week_start: startDateStr,
        week_end: endDateStr,
        report_json: JSON.stringify(reportJson),
        narrative,
        generated_at: Date.now(),
        file_path: null,
      });

      // 7. Return success
      return { success: true, weekEnd: endDateStr };
    } catch (err: any) {
      console.error('Failed to generate weekly report:', err);
      return { success: false, message: err.message || 'Report generation failed' };
    }
  });

  // Analytics API
  ipcMain.handle('analytics:getMetrics', (_, params: { deviceId?: string; startDate: string; endDate: string }) => {
    if (!db) return [];
    if (params.deviceId) {
      return db.getDeviceDailyMetricsRange(params.deviceId, params.startDate, params.endDate);
    }
    // For team view: return aggregated totals + merge top_apps from all devices
    const teamTotals = db.getTeamDailyMetricsRange(params.startDate, params.endDate);
    const devices = db.getAllDevices();
    // Collect all top_apps_json across devices for each date
    const dateAppsMap = new Map<string, Map<string, number>>();
    for (const device of devices) {
      const deviceMetrics = db.getDeviceDailyMetricsRange(device.device_id, params.startDate, params.endDate);
      for (const m of deviceMetrics) {
        if (m.top_apps_json) {
          try {
            const apps = JSON.parse(m.top_apps_json);
            if (!dateAppsMap.has(m.date_ymd)) dateAppsMap.set(m.date_ymd, new Map());
            const dayMap = dateAppsMap.get(m.date_ymd)!;
            for (const a of apps) {
              dayMap.set(a.app, (dayMap.get(a.app) || 0) + (a.seconds || 0));
            }
          } catch {}
        }
      }
    }
    // Attach aggregated top_apps_json to team totals
    return teamTotals.map((row: any) => ({
      ...row,
      top_apps_json: dateAppsMap.has(row.date_ymd)
        ? JSON.stringify(Array.from(dateAppsMap.get(row.date_ymd)!.entries()).map(([app, seconds]) => ({ app, seconds })).sort((a, b) => b.seconds - a.seconds).slice(0, 20))
        : undefined,
    }));
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
