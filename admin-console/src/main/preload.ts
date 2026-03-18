/**
 * Admin Console Preload Script (Freeware Edition)
 * No licensing API — all features available.
 */

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('adminAPI', {
  // Device operations
  getAllDevices: () => ipcRenderer.invoke('devices:getAll'),
  getDevice: (deviceId: string) => ipcRenderer.invoke('devices:get', deviceId),
  deleteDevice: (deviceId: string) => ipcRenderer.invoke('devices:delete', deviceId),
  getConnectedDevices: () => ipcRenderer.invoke('devices:getConnected'),

  // Policy operations
  getAllPolicies: () => ipcRenderer.invoke('policies:getAll'),
  getPolicy: (policyId: string) => ipcRenderer.invoke('policies:get', policyId),
  createPolicy: (policy: any) => ipcRenderer.invoke('policies:create', policy),
  updatePolicy: (policyId: string, name: string, data: any) =>
    ipcRenderer.invoke('policies:update', policyId, name, data),
  deletePolicy: (policyId: string) => ipcRenderer.invoke('policies:delete', policyId),
  assignPolicy: (deviceId: string, policyId: string) =>
    ipcRenderer.invoke('policies:assign', deviceId, policyId),
  pushPolicy: (deviceId: string, policy: any) =>
    ipcRenderer.invoke('policies:push', deviceId, policy),

  // Pairing operations
  generatePairCode: () => ipcRenderer.invoke('pairing:generateCode'),
  getCurrentPairCode: () => ipcRenderer.invoke('pairing:getCurrentCode'),
  getPendingPairs: () => ipcRenderer.invoke('pairing:getPending'),
  approvePairing: (requestId: string) => ipcRenderer.invoke('pairing:approve', requestId),
  denyPairing: (requestId: string) => ipcRenderer.invoke('pairing:deny', requestId),

  // Device control
  lockDevice: (deviceId: string, reason: string, message: string) =>
    ipcRenderer.invoke('device:lock', deviceId, reason, message),
  unlockDevice: (deviceId: string) => ipcRenderer.invoke('device:unlock', deviceId),
  requestExport: (deviceId: string, options: any) =>
    ipcRenderer.invoke('device:requestExport', deviceId, options),

  // Audit logs
  getAuditLogs: (limit?: number) => ipcRenderer.invoke('audit:getLogs', limit),

  // Server info
  getServerInfo: () => ipcRenderer.invoke('server:getInfo'),

  // Device stats
  getDeviceStats: (deviceId: string) => ipcRenderer.invoke('stats:getDevice', deviceId),

  // Event listeners
  onDeviceConnected: (callback: (deviceId: string) => void) => {
    const listener = (_: any, deviceId: string) => callback(deviceId);
    ipcRenderer.on('device:connected', listener);
    return () => ipcRenderer.removeListener('device:connected', listener);
  },

  onDeviceDisconnected: (callback: (deviceId: string) => void) => {
    const listener = (_: any, deviceId: string) => callback(deviceId);
    ipcRenderer.on('device:disconnected', listener);
    return () => ipcRenderer.removeListener('device:disconnected', listener);
  },

  onPairRequest: (callback: (request: any) => void) => {
    const listener = (_: any, request: any) => callback(request);
    ipcRenderer.on('pair:request', listener);
    return () => ipcRenderer.removeListener('pair:request', listener);
  },

  onStatsReceived: (callback: (data: { deviceId: string; stats: any }) => void) => {
    const listener = (_: any, data: any) => callback(data);
    ipcRenderer.on('stats:received', listener);
    return () => ipcRenderer.removeListener('stats:received', listener);
  },

  onServerStarted: (callback: (info: { port: number; publicKey: string }) => void) => {
    const listener = (_: any, info: any) => callback(info);
    ipcRenderer.on('server:started', listener);
    return () => ipcRenderer.removeListener('server:started', listener);
  },

  onServerLog: (callback: (message: string) => void) => {
    const listener = (_: any, message: string) => callback(message);
    ipcRenderer.on('server:log', listener);
    return () => ipcRenderer.removeListener('server:log', listener);
  },

  // Server logs
  getServerLogs: (count?: number) => ipcRenderer.invoke('server:getLogs', count),

  // Dashboard API
  getDashboardSummary: (range: 'today' | '7d') => ipcRenderer.invoke('dashboard:getSummary', range),
  getDashboardDevices: () => ipcRenderer.invoke('dashboard:getDevices'),
  getDeviceDetail: (deviceId: string, range: 'today' | '7d') =>
    ipcRenderer.invoke('dashboard:getDeviceDetail', deviceId, range),
  getExceptions: (resolved?: boolean) => ipcRenderer.invoke('dashboard:getExceptions', resolved),
  resolveException: (id: number) => ipcRenderer.invoke('dashboard:resolveException', id),
  getExceptionCounts: () => ipcRenderer.invoke('dashboard:getExceptionCounts'),
  getRecentHeartbeats: (limit?: number) => ipcRenderer.invoke('dashboard:getRecentHeartbeats', limit),
  getRecentCommands: (limit?: number) => ipcRenderer.invoke('dashboard:getRecentCommands', limit),

  // Enhanced Dashboard API (Performance Model)
  getDashboardSummaryEnhanced: (range: 'today' | '7d') => ipcRenderer.invoke('dashboard:getSummaryEnhanced', range),
  getDashboardDevicesEnhanced: () => ipcRenderer.invoke('dashboard:getDevicesEnhanced'),
  getAttention: () => ipcRenderer.invoke('dashboard:getAttention'),
  getDashboardStory: () => ipcRenderer.invoke('dashboard:getStory'),
  getRankings: () => ipcRenderer.invoke('dashboard:getRankings'),
  getTrends: (scope: 'team' | 'device', deviceId?: string, days?: number) =>
    ipcRenderer.invoke('dashboard:getTrends', scope, deviceId, days),

  // Enhanced Device Detail
  getDeviceDetailEnhanced: (deviceId: string, range: 'today' | '7d' | '30d') =>
    ipcRenderer.invoke('dashboard:getDeviceDetailEnhanced', deviceId, range),

  // App Categorization API
  getAppUsageAggregates: () => ipcRenderer.invoke('apps:getUsageAggregates'),
  getAppCategory: (appName: string) => ipcRenderer.invoke('apps:getCategory', appName),
  setAppCategory: (appName: string, category: string) =>
    ipcRenderer.invoke('apps:setCategory', appName, category),
  setAppCategoriesBulk: (apps: Array<{ appName: string; category: string }>) =>
    ipcRenderer.invoke('apps:setCategoriesBulk', apps),
  getAllAppCategories: () => ipcRenderer.invoke('apps:getAllCategories'),

  // Weekly Insights API
  getWeeklyInsights: (weekEnd?: string) => ipcRenderer.invoke('insights:getWeekly', weekEnd),
  getWeeklyReports: () => ipcRenderer.invoke('reports:getAll'),
  getWeeklyReport: (weekEnd: string) => ipcRenderer.invoke('reports:get', weekEnd),
  generateWeeklyReport: () => ipcRenderer.invoke('reports:generate'),

  // Version
  getAppVersion: () => ipcRenderer.invoke('updater:getVersion'),
});

console.log('Admin Console preload script loaded (freeware)');
