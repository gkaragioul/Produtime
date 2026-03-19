/**
 * Web API Client
 * Drop-in replacement for Electron IPC (window.adminAuth + window.adminAPI)
 * Uses HTTP fetch + WebSocket for real-time events.
 */

const API_BASE = '';  // Same origin

// ============================================================================
// Token management
// ============================================================================

let authToken: string | null = localStorage.getItem('adminToken');

function setToken(token: string | null): void {
  authToken = token;
  if (token) {
    localStorage.setItem('adminToken', token);
  } else {
    localStorage.removeItem('adminToken');
  }
}

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  return headers;
}

async function apiFetch(path: string, options?: RequestInit): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...getHeaders(), ...(options?.headers || {}) },
  });
  if (res.status === 401) {
    setToken(null);
    throw new Error('Unauthorized');
  }
  return res.json();
}

async function apiGet(path: string): Promise<any> {
  return apiFetch(path);
}

async function apiPost(path: string, body?: any): Promise<any> {
  return apiFetch(path, {
    method: 'POST',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function apiPut(path: string, body?: any): Promise<any> {
  return apiFetch(path, {
    method: 'PUT',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function apiDelete(path: string): Promise<any> {
  return apiFetch(path, { method: 'DELETE' });
}

// ============================================================================
// WebSocket for real-time events
// ============================================================================

type EventCallback = (data: any) => void;
type UnsubscribeFn = () => void;

const eventListeners = new Map<string, Set<EventCallback>>();
let adminWs: WebSocket | null = null;
let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;

function connectAdminWs(): void {
  if (!authToken) return;
  if (adminWs && (adminWs.readyState === WebSocket.OPEN || adminWs.readyState === WebSocket.CONNECTING)) return;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/admin?token=${encodeURIComponent(authToken)}`;

  adminWs = new WebSocket(wsUrl);

  adminWs.onmessage = (evt) => {
    try {
      const { event, data } = JSON.parse(evt.data);
      const listeners = eventListeners.get(event);
      if (listeners) {
        for (const cb of listeners) {
          cb(data);
        }
      }
    } catch {}
  };

  adminWs.onclose = () => {
    adminWs = null;
    // Reconnect after 3 seconds if we still have a token
    if (authToken) {
      wsReconnectTimer = setTimeout(() => connectAdminWs(), 3000);
    }
  };

  adminWs.onerror = () => {
    adminWs?.close();
  };
}

function disconnectAdminWs(): void {
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
  }
  if (adminWs) {
    adminWs.close();
    adminWs = null;
  }
}

function onEvent(event: string, callback: EventCallback): UnsubscribeFn {
  if (!eventListeners.has(event)) {
    eventListeners.set(event, new Set());
  }
  eventListeners.get(event)!.add(callback);

  // Ensure WS is connected
  connectAdminWs();

  return () => {
    const listeners = eventListeners.get(event);
    if (listeners) {
      listeners.delete(callback);
      if (listeners.size === 0) {
        eventListeners.delete(event);
      }
    }
  };
}

// ============================================================================
// adminAuth — matches window.adminAuth interface
// ============================================================================

export const adminAuth = {
  login: async (password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const result = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      if (result.success && result.token) {
        setToken(result.token);
        connectAdminWs();
      }
      return { success: result.success, error: result.error };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },

  isAuthenticated: async (): Promise<{ authenticated: boolean }> => {
    if (!authToken) return { authenticated: false };
    try {
      return await apiGet('/api/auth/check');
    } catch {
      return { authenticated: false };
    }
  },

  logout: async (): Promise<{ success: boolean }> => {
    setToken(null);
    disconnectAdminWs();
    return { success: true };
  },
};

// ============================================================================
// adminAPI — matches window.adminAPI interface exactly
// ============================================================================

export const adminAPI = {
  // Device operations
  getAllDevices: () => apiGet('/api/devices'),
  getDevice: (deviceId: string) => apiGet(`/api/devices/${deviceId}`),
  deleteDevice: (deviceId: string) => apiDelete(`/api/devices/${deviceId}`),
  getConnectedDevices: () => apiGet('/api/devices/connected'),

  // Policy operations
  getAllPolicies: () => apiGet('/api/policies'),
  getPolicy: (policyId: string) => apiGet(`/api/policies/${policyId}`),
  createPolicy: (policy: any) => apiPost('/api/policies', policy),
  updatePolicy: (policyId: string, name: string, data: any) => apiPut(`/api/policies/${policyId}`, { name, data }),
  deletePolicy: (policyId: string) => apiDelete(`/api/policies/${policyId}`),
  assignPolicy: (deviceId: string, policyId: string) => apiPost('/api/policies/assign', { deviceId, policyId }),
  pushPolicy: (deviceId: string, policy: any) => apiPost('/api/policies/push', { deviceId, policy }),

  // Pairing operations
  generatePairCode: () => apiPost('/api/pairing/generate-code'),
  getCurrentPairCode: () => apiGet('/api/pairing/current-code'),
  getPendingPairs: () => apiGet('/api/pairing/pending'),
  approvePairing: (requestId: string) => apiPost('/api/pairing/approve', { requestId }),
  denyPairing: (requestId: string) => apiPost('/api/pairing/deny', { requestId }),

  // Device control
  lockDevice: (deviceId: string, reason: string, message: string) =>
    apiPost(`/api/devices/${deviceId}/lock`, { reason, message }),
  unlockDevice: (deviceId: string) =>
    apiPost(`/api/devices/${deviceId}/unlock`),
  requestExport: (deviceId: string, options: any) =>
    apiPost(`/api/devices/${deviceId}/export`, { options }),

  // Audit logs
  getAuditLogs: (limit?: number) => apiGet(`/api/audit-logs?limit=${limit || 100}`),

  // Server info
  getServerInfo: () => apiGet('/api/server/info'),

  // Device stats
  getDeviceStats: (deviceId: string) => apiGet(`/api/stats/${deviceId}`),

  // Event listeners (WebSocket-based)
  onDeviceConnected: (callback: (deviceId: string) => void): UnsubscribeFn =>
    onEvent('device:connected', callback),
  onDeviceDisconnected: (callback: (deviceId: string) => void): UnsubscribeFn =>
    onEvent('device:disconnected', callback),
  onPairRequest: (callback: (request: any) => void): UnsubscribeFn =>
    onEvent('pair:request', callback),
  onStatsReceived: (callback: (data: any) => void): UnsubscribeFn =>
    onEvent('stats:received', callback),
  onServerStarted: (callback: (info: any) => void): UnsubscribeFn =>
    onEvent('server:started', callback),
  onServerLog: (callback: (message: string) => void): UnsubscribeFn =>
    onEvent('server:log', callback),
  onExportResult: (callback: (data: { deviceId: string; result: any }) => void): UnsubscribeFn =>
    onEvent('export:result', callback),

  // Server logs
  getServerLogs: (count?: number) => apiGet(`/api/server/logs?count=${count || 100}`),

  // Dashboard API
  getDashboardSummary: (range: 'today' | '7d' | '30d') => apiGet(`/api/dashboard/summary?range=${range}`),
  getDashboardDevices: () => apiGet('/api/dashboard/devices'),
  getDeviceDetail: (deviceId: string, range: 'today' | '7d' | '30d') =>
    apiGet(`/api/dashboard/devices/${deviceId}?range=${range}`),
  getExceptions: (resolved?: boolean) => apiGet(`/api/dashboard/exceptions${resolved !== undefined ? `?resolved=${resolved}` : ''}`),
  resolveException: (id: number) => apiPost(`/api/dashboard/exceptions/${id}/resolve`),
  getExceptionCounts: () => apiGet('/api/dashboard/exception-counts'),
  getRecentHeartbeats: (limit?: number) => apiGet(`/api/dashboard/heartbeats?limit=${limit || 100}`),
  getRecentCommands: (limit?: number) => apiGet(`/api/dashboard/commands?limit=${limit || 100}`),

  // Enhanced Dashboard API
  getDashboardSummaryEnhanced: (range: 'today' | '7d' | '30d') =>
    apiGet(`/api/dashboard/summary-enhanced?range=${range}`),
  getDashboardDevicesEnhanced: () => apiGet('/api/dashboard/devices-enhanced'),
  getAttention: () => apiGet('/api/dashboard/attention'),
  getDashboardStory: () => apiGet('/api/dashboard/story'),
  getRankings: () => apiGet('/api/dashboard/rankings'),
  getTrends: (scope: 'team' | 'device', deviceId?: string, days?: number) =>
    apiGet(`/api/dashboard/trends?scope=${scope}${deviceId ? `&deviceId=${deviceId}` : ''}${days ? `&days=${days}` : ''}`),

  // Enhanced Device Detail
  getDeviceDetailEnhanced: (deviceId: string, range: 'today' | '7d' | '30d') =>
    apiGet(`/api/dashboard/device-detail-enhanced/${deviceId}?range=${range}`),

  // App Categorization API
  getAppUsageAggregates: () => apiGet('/api/apps/usage-aggregates'),
  getAppCategory: (appName: string) => apiGet(`/api/apps/category/${encodeURIComponent(appName)}`),
  setAppCategory: (appName: string, category: string) =>
    apiPost('/api/apps/category', { appName, category }),
  setAppCategoriesBulk: (apps: Array<{ appName: string; category: string }>) =>
    apiPost('/api/apps/categories-bulk', { apps }),
  getAllAppCategories: () => apiGet('/api/apps/categories'),

  // Analytics API
  getAnalyticsMetrics: (params: { deviceId?: string; startDate: string; endDate: string }) =>
    apiGet(`/api/analytics/metrics?startDate=${params.startDate}&endDate=${params.endDate}${params.deviceId ? `&deviceId=${params.deviceId}` : ''}`),

  // Weekly Insights API
  getWeeklyInsights: (weekEnd?: string) => apiGet(`/api/insights/weekly${weekEnd ? `?weekEnd=${weekEnd}` : ''}`),
  getWeeklyReports: () => apiGet('/api/reports'),
  getWeeklyReport: (weekEnd: string) => apiGet(`/api/reports/${weekEnd}`),
  generateWeeklyReport: () => apiPost('/api/reports/generate'),

  // Version
  getAppVersion: () => apiGet('/api/version').then(r => r.version),
};

// Auto-connect WebSocket if we have a token on load
if (authToken) {
  connectAdminWs();
}
