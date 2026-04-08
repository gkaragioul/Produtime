/**
 * ProduTime Admin Console - Web Server
 * Standalone Express server replacing the Electron main process.
 * Serves REST API + static frontend + WebSocket for device communication + admin events.
 */

import express from 'express';
import cors from 'cors';
import * as http from 'http';
import * as path from 'path';
import * as crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { WebSocket } from 'ws';
import { AdminDatabase } from './db';
import { AdminServer } from './device-server';
import { DeviceDetailService } from './device-detail-service';

// ============================================================================
// Configuration
// ============================================================================

const PORT = parseInt(process.env.PORT || '17888', 10);
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const DATABASE_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'admin-console.db');

// ============================================================================
// Initialize services
// ============================================================================

const db = new AdminDatabase(DATABASE_PATH);
const deviceServer = new AdminServer(db, PORT);

// Ensure default admin password is set
if (!db.getSetting('admin_password_hash')) {
  const salt = crypto.randomBytes(16);
  crypto.scrypt(ADMIN_PASSWORD, salt, 64, (err, derivedKey) => {
    if (!err) {
      db.setSetting('admin_password_hash', salt.toString('hex') + ':' + derivedKey.toString('hex'));
      console.log('[AUTH] Default admin password hash stored');
    }
  });
}

// ============================================================================
// Express app
// ============================================================================

const app = express();
app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json());

// Health check — must be before static middleware
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '1.0.0-web' });
});

// Device info endpoint (used by ProduTime clients to discover this admin)
app.get('/info', (_req, res) => {
  res.json({
    name: 'ProduTime Admin Console',
    publicKey: deviceServer.getAdminPublicKey(),
    port: PORT,
  });
});

// Public update manifest — fetched by ProduTime assisted updater (no auth required)
app.get('/updates/latest.json', (_req, res) => {
  const raw = db.getSetting('update_manifest');
  if (!raw) {
    res.status(404).json({ error: 'No update manifest published yet' });
    return;
  }
  try {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(raw);
  } catch {
    res.status(500).json({ error: 'Failed to read manifest' });
  }
});

// Serve static frontend files
// __dirname = dist/server/server/, client is at dist/client/
const staticDir = path.join(__dirname, '../../client');
app.use(express.static(staticDir));

// ============================================================================
// Auth middleware
// ============================================================================

function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as { role: string };
    (req as any).user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ============================================================================
// Auth routes (no middleware)
// ============================================================================

app.post('/api/auth/login', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      res.status(400).json({ success: false, error: 'Password required' });
      return;
    }

    let storedHash = db.getSetting('admin_password_hash');
    if (!storedHash) {
      // First run - store default
      const salt = crypto.randomBytes(16);
      const hash = await new Promise<Buffer>((resolve, reject) => {
        crypto.scrypt(ADMIN_PASSWORD, salt, 64, (err, key) => err ? reject(err) : resolve(key));
      });
      storedHash = salt.toString('hex') + ':' + hash.toString('hex');
      db.setSetting('admin_password_hash', storedHash);
    }

    const [saltHex, hashHex] = storedHash.split(':');
    const salt = Buffer.from(saltHex, 'hex');
    const expectedHash = Buffer.from(hashHex, 'hex');
    const incomingHash = await new Promise<Buffer>((resolve, reject) => {
      crypto.scrypt(password, salt, 64, (err, key) => err ? reject(err) : resolve(key));
    });

    if (crypto.timingSafeEqual(expectedHash, incomingHash)) {
      const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '8h' });
      res.json({ success: true, token });
    } else {
      res.json({ success: false, error: 'Invalid password' });
    }
  } catch (error) {
    console.error('Auth login error:', error);
    res.status(500).json({ success: false, error: 'Authentication error' });
  }
});

app.get('/api/auth/check', authMiddleware, (_req, res) => {
  res.json({ authenticated: true });
});

app.post('/api/auth/logout', (_req, res) => {
  // JWT is stateless - client just deletes token
  res.json({ success: true });
});

// ============================================================================
// All API routes below require auth
// ============================================================================

app.use('/api', authMiddleware);

// --- Device routes ---
app.get('/api/devices', (_req, res) => {
  res.json(db.getAllDevices());
});

app.get('/api/devices/connected', (_req, res) => {
  res.json(deviceServer.getConnectedDevices());
});

app.get('/api/devices/:id', (req, res) => {
  const device = db.getDevice(req.params.id);
  res.json(device || null);
});

app.delete('/api/devices/:id', (req, res) => {
  db.deleteDevice(req.params.id);
  res.json({ success: true });
});

// --- Policy routes ---
app.get('/api/policies', (_req, res) => {
  res.json(db.getAllPolicies());
});

app.get('/api/policies/:id', (req, res) => {
  res.json(db.getPolicy(req.params.id) || null);
});

app.post('/api/policies', (req, res) => {
  const policyId = crypto.randomUUID();
  db.insertPolicy({
    policy_id: policyId,
    name: req.body.name,
    policy_json: JSON.stringify(req.body.data),
    updated_at: Date.now(),
  });
  res.json({ success: true, policyId });
});

app.put('/api/policies/:id', (req, res) => {
  const policyId = req.params.id;
  db.updatePolicy(policyId, req.body.name, JSON.stringify(req.body.data));

  // Push updated policy to all assigned online devices
  pushPolicyToAssignedDevices(policyId);

  res.json({ success: true });
});

app.delete('/api/policies/:id', (req, res) => {
  db.deletePolicy(req.params.id);
  res.json({ success: true });
});

app.post('/api/policies/assign', (req, res) => {
  db.assignPolicyToDevice(req.body.deviceId, req.body.policyId);
  res.json({ success: true });
});

app.post('/api/policies/push', (req, res) => {
  const success = deviceServer.pushPolicy(req.body.deviceId, req.body.policy);
  res.json({ success });
});

// --- Pairing routes ---
app.post('/api/pairing/generate-code', (_req, res) => {
  const code = deviceServer.generatePairCode();
  res.json({ code, expiresAt: Date.now() + 300000 });
});

app.get('/api/pairing/current-code', (_req, res) => {
  res.json(deviceServer.getCurrentPairCode() || null);
});

app.get('/api/pairing/pending', (_req, res) => {
  res.json(db.getAllPendingPairs());
});

app.post('/api/pairing/approve', (req, res) => {
  const success = deviceServer.approvePairing(req.body.requestId);
  res.json({ success });
});

app.post('/api/pairing/deny', (req, res) => {
  const success = deviceServer.denyPairing(req.body.requestId);
  res.json({ success });
});

// --- Device control routes ---
app.post('/api/devices/:id/lock', (req, res) => {
  console.log(`[API] Lock request for device ${req.params.id}, connected: [${deviceServer.getConnectedDevices().join(', ')}]`);
  const success = deviceServer.lockDevice(req.params.id, req.body.reason, req.body.message);
  console.log(`[API] Lock result: ${success}`);
  res.json({ success });
});

app.post('/api/devices/:id/unlock', (req, res) => {
  const success = deviceServer.unlockDevice(req.params.id);
  res.json({ success });
});

app.post('/api/devices/:id/export', (req, res) => {
  const success = deviceServer.requestExport(req.params.id, req.body.options);
  res.json({ success });
});

// --- Audit log routes ---
app.get('/api/audit-logs', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 100;
  res.json(db.getAuditLogs(limit));
});

// --- Server info ---
app.get('/api/server/info', (_req, res) => {
  res.json({
    port: deviceServer.getPort(),
    publicKey: deviceServer.getAdminPublicKey(),
    connectedDevices: deviceServer.getConnectedDevices().length,
  });
});

// --- Server logs ---
app.get('/api/server/logs', (req, res) => {
  const count = parseInt(req.query.count as string) || 100;
  res.json(deviceServer.getLogs(count));
});

// --- Device stats ---
app.get('/api/stats/:deviceId', (req, res) => {
  res.json(db.getDeviceStats(req.params.deviceId) || null);
});

// --- Dashboard routes ---
app.get('/api/dashboard/summary', (req, res) => {
  const range = (req.query.range as 'today' | '7d' | '30d') || 'today';
  const dashboardService = deviceServer.getDashboardService();
  res.json(dashboardService.getDashboardSummary(range));
});

app.get('/api/dashboard/devices', (_req, res) => {
  const dashboardService = deviceServer.getDashboardService();
  res.json(dashboardService.getDevicesList());
});

app.get('/api/dashboard/devices/:id', (req, res) => {
  const range = (req.query.range as 'today' | '7d' | '30d') || 'today';
  const dashboardService = deviceServer.getDashboardService();
  res.json(dashboardService.getDeviceDetail(req.params.id, range));
});

app.get('/api/dashboard/exceptions', (req, res) => {
  res.json(db.getUnresolvedExceptions(100));
});

app.post('/api/dashboard/exceptions/:id/resolve', (req, res) => {
  const dashboardService = deviceServer.getDashboardService();
  dashboardService.resolveException(parseInt(req.params.id));
  res.json({ success: true });
});

app.get('/api/dashboard/exception-counts', (_req, res) => {
  const dashboardService = deviceServer.getDashboardService();
  res.json(dashboardService.getExceptionCounts());
});

app.get('/api/dashboard/heartbeats', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 100;
  res.json(db.getRecentHeartbeats(limit));
});

app.get('/api/dashboard/commands', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 100;
  res.json(db.getRecentCommands(limit));
});

// Enhanced Dashboard API
app.get('/api/dashboard/summary-enhanced', (req, res) => {
  const range = (req.query.range as 'today' | '7d' | '30d') || 'today';
  const dashboardService = deviceServer.getDashboardService();
  res.json(dashboardService.getDashboardSummaryEnhanced(range));
});

app.get('/api/dashboard/devices-enhanced', (_req, res) => {
  const dashboardService = deviceServer.getDashboardService();
  res.json(dashboardService.getDevicesListEnhanced());
});

app.get('/api/dashboard/attention', (_req, res) => {
  const dashboardService = deviceServer.getDashboardService();
  res.json(dashboardService.getAttentionGroups());
});

app.get('/api/dashboard/story', (_req, res) => {
  const dashboardService = deviceServer.getDashboardService();
  res.json(dashboardService.getDashboardStory());
});

app.get('/api/dashboard/rankings', (_req, res) => {
  const dashboardService = deviceServer.getDashboardService();
  res.json(dashboardService.getRankings());
});

app.get('/api/dashboard/trends', (req, res) => {
  const scope = (req.query.scope as 'team' | 'device') || 'team';
  const deviceId = req.query.deviceId as string | undefined;
  const days = parseInt(req.query.days as string) || 7;
  const dashboardService = deviceServer.getDashboardService();
  res.json(dashboardService.getTrends(scope, deviceId, days));
});

// Enhanced Device Detail
app.get('/api/dashboard/device-detail-enhanced/:id', (req, res) => {
  const range = (req.query.range as 'today' | '7d' | '30d') || '7d';
  const detailService = new DeviceDetailService(db);
  res.json(detailService.getDeviceDetail(req.params.id, range));
});

// --- App Categorization routes ---
app.get('/api/apps/usage-aggregates', (_req, res) => {
  const todayYmd = new Date().toISOString().split('T')[0];
  db.aggregateAppUsageFromHeartbeats(todayYmd);
  res.json(db.getAppUsageAggregates(todayYmd));
});

app.get('/api/apps/categories', (_req, res) => {
  res.json(db.getAllAppCategories());
});

app.get('/api/apps/category/:appName', (req, res) => {
  res.json(db.getAppCategory(req.params.appName) || null);
});

app.post('/api/apps/category', (req, res) => {
  db.setAppCategory(req.body.appName, req.body.category);
  pushCategoriesToAllDevices();
  res.json({ success: true });
});

app.post('/api/apps/categories-bulk', (req, res) => {
  db.setAppCategoriesBulk(req.body.apps);
  pushCategoriesToAllDevices();
  res.json({ success: true });
});

// --- Weekly Insights & Reports ---
app.get('/api/insights/weekly', (req, res) => {
  const weekEnd = (req.query.weekEnd as string) || new Date().toISOString().split('T')[0];
  res.json(db.getWeeklyInsights(weekEnd));
});

app.get('/api/reports', (_req, res) => {
  res.json(db.getAllWeeklyReports());
});

app.get('/api/reports/:weekEnd', (req, res) => {
  res.json(db.getWeeklyReport(req.params.weekEnd) || null);
});

app.post('/api/reports/generate', (_req, res) => {
  try {
    const result = generateWeeklyReport();
    res.json(result);
  } catch (err: any) {
    res.json({ success: false, message: err.message || 'Report generation failed' });
  }
});

// --- Analytics ---
app.get('/api/analytics/metrics', (req, res) => {
  const deviceId = req.query.deviceId as string | undefined;
  const startDate = req.query.startDate as string;
  const endDate = req.query.endDate as string;

  if (!startDate || !endDate) {
    res.status(400).json({ error: 'startDate and endDate required' });
    return;
  }

  if (deviceId) {
    res.json(db.getDeviceDailyMetricsRange(deviceId, startDate, endDate));
    return;
  }

  // Team view
  const teamTotals = db.getTeamDailyMetricsRange(startDate, endDate);
  const devices = db.getAllDevices();
  const dateAppsMap = new Map<string, Map<string, number>>();
  const dateDetailedAppsMap = new Map<string, Map<string, number>>();
  for (const device of devices) {
    const deviceMetrics = db.getDeviceDailyMetricsRange(device.device_id, startDate, endDate);
    for (const m of deviceMetrics) {
      if (m.top_apps_json) {
        try {
          const apps = JSON.parse(m.top_apps_json);
          if (!dateAppsMap.has(m.date_ymd)) dateAppsMap.set(m.date_ymd, new Map());
          const dayMap = dateAppsMap.get(m.date_ymd)!;
          for (const a of apps) {
            dayMap.set(a.app, (dayMap.get(a.app) || 0) + (a.seconds || 0));
          }
        } catch (err) {
          console.warn(`[ANALYTICS] Failed to parse top_apps_json for device ${device.device_id} on ${m.date_ymd}:`, err);
        }
      }
      if (m.detailed_apps_json) {
        try {
          const apps = JSON.parse(m.detailed_apps_json);
          if (!dateDetailedAppsMap.has(m.date_ymd)) dateDetailedAppsMap.set(m.date_ymd, new Map());
          const dayMap = dateDetailedAppsMap.get(m.date_ymd)!;
          for (const a of apps) {
            dayMap.set(a.app, (dayMap.get(a.app) || 0) + (a.seconds || 0));
          }
        } catch (err) {
          console.warn(`[ANALYTICS] Failed to parse detailed_apps_json for device ${device.device_id} on ${m.date_ymd}:`, err);
        }
      }
    }
  }

  res.json(teamTotals.map((row: any) => ({
    ...row,
    top_apps_json: dateAppsMap.has(row.date_ymd)
      ? JSON.stringify(
          Array.from(dateAppsMap.get(row.date_ymd)!.entries())
            .map(([a, seconds]) => ({ app: a, seconds }))
            .sort((a, b) => b.seconds - a.seconds)
            .slice(0, 20)
        )
      : undefined,
    detailed_apps_json: dateDetailedAppsMap.has(row.date_ymd)
      ? JSON.stringify(
          Array.from(dateDetailedAppsMap.get(row.date_ymd)!.entries())
            .map(([a, seconds]) => ({ app: a, seconds }))
            .sort((a, b) => b.seconds - a.seconds)
            .slice(0, 30)
        )
      : undefined,
  })));
});

// --- Version ---
app.get('/api/version', (_req, res) => {
  res.json({ version: '1.0.0-web' });
});

// --- Update manifest management (auth required) ---
app.get('/api/updates/manifest', (_req, res) => {
  const raw = db.getSetting('update_manifest');
  res.json(raw ? JSON.parse(raw) : null);
});

app.post('/api/updates/publish', (req, res) => {
  const { version, url, releaseNotesUrl, releaseNotes, sha256, mandatory } = req.body;
  if (!version || !url) {
    res.status(400).json({ error: 'version and url are required' });
    return;
  }
  if (!/^\d+\.\d+\.\d+/.test(version)) {
    res.status(400).json({ error: 'version must be in semver format (e.g. 0.5.2)' });
    return;
  }
  if (!url.startsWith('https://')) {
    res.status(400).json({ error: 'url must use HTTPS' });
    return;
  }
  const manifest = {
    product: 'ProduTime',
    channel: 'stable',
    publishedAt: new Date().toISOString(),
    latest: {
      version,
      url,
      ...(releaseNotesUrl && { releaseNotesUrl }),
      ...(releaseNotes && { releaseNotes }),
      ...(sha256 && { sha256 }),
      ...(mandatory !== undefined && { mandatory: Boolean(mandatory) }),
    },
  };
  db.setSetting('update_manifest', JSON.stringify(manifest, null, 2));
  console.log(`[UPDATES] Manifest published: v${version} → ${url}`);
  res.json({ success: true, manifest });
});

// ============================================================================
// SPA fallback — serve index.html for all non-API routes
// ============================================================================

app.get('*', (_req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

// ============================================================================
// Helpers
// ============================================================================

/**
 * Push a specific policy to all devices assigned to it that are currently online.
 * Called after policy edits so changes reach devices immediately.
 */
function pushPolicyToAssignedDevices(policyId: string): void {
  const policyRecord = db.getPolicy(policyId);
  if (!policyRecord) return;

  const allDevices = db.getAllDevices();
  const connectedIds = deviceServer.getConnectedDevices();

  let pushed = 0;
  for (const device of allDevices) {
    if (device.policy_id !== policyId || !connectedIds.includes(device.device_id)) continue;

    try {
      const policyData = JSON.parse(policyRecord.policy_json);
      policyData.version = policyData.version || policyRecord.policy_id;
      policyData.updatedAt = policyData.updatedAt || policyRecord.updated_at;
      deviceServer.pushPolicy(device.device_id, policyData);
      pushed++;
    } catch (err) {
      console.error(`Failed to push updated policy to device ${device.device_id}:`, err);
    }
  }
  console.log(`[POLICY] Pushed policy ${policyId} to ${pushed} online device(s)`);
}

function pushCategoriesToAllDevices(): void {
  const allDevices = db.getAllDevices();
  const connectedIds = deviceServer.getConnectedDevices();

  for (const device of allDevices) {
    if (!device.policy_id || !connectedIds.includes(device.device_id)) continue;

    const policyRecord = db.getPolicy(device.policy_id);
    if (!policyRecord) continue;

    try {
      const policyData = JSON.parse(policyRecord.policy_json);
      policyData.version = policyData.version || policyRecord.policy_id;
      policyData.updatedAt = policyData.updatedAt || policyRecord.updated_at;
      deviceServer.pushPolicy(device.device_id, policyData);
    } catch (err) {
      console.error(`Failed to push categories to device ${device.device_id}:`, err);
    }
  }
}

function generateWeeklyReport(): { success: boolean; weekEnd?: string; message?: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayOfWeek = today.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayOffset);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const endDate = sunday <= today ? sunday : today;

  const startDateStr = monday.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];

  const teamDaily = db.getTeamDailyMetricsRange(startDateStr, endDateStr);
  const devices = db.getAllDevices();
  const perDeviceData: any[] = [];

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
        const apps = JSON.parse(m.top_apps_json || '[]');
        for (const a of apps) appTotals.set(a.app, (appTotals.get(a.app) || 0) + a.seconds);
      } catch (err) {
        console.warn(`[REPORT] Failed to parse top_apps_json for device ${device.device_id}:`, err);
      }
    }

    perDeviceData.push({
      device_id: device.device_id,
      device_name: device.device_name,
      active_seconds: active,
      idle_seconds: idle,
      untracked_seconds: untracked,
      productive_seconds: productive,
      unproductive_seconds: unproductive,
      top_apps: Array.from(appTotals.entries())
        .map(([a, seconds]) => ({ app: a, seconds }))
        .sort((a, b) => b.seconds - a.seconds)
        .slice(0, 10),
    });
  }

  const teamTotals = {
    active_seconds: teamDaily.reduce((s, d) => s + (d.active_seconds || 0), 0),
    idle_seconds: teamDaily.reduce((s, d) => s + (d.idle_seconds || 0), 0),
    untracked_seconds: teamDaily.reduce((s, d) => s + (d.untracked_seconds || 0), 0),
    productive_seconds: teamDaily.reduce((s, d) => s + (d.productive_seconds || 0), 0),
    unproductive_seconds: teamDaily.reduce((s, d) => s + (d.unproductive_seconds || 0), 0),
  };

  const reportJson = { week_start: startDateStr, week_end: endDateStr, team_totals: teamTotals, daily_breakdown: teamDaily, per_device: perDeviceData };
  const activeHours = (teamTotals.active_seconds / 3600).toFixed(1);
  const deviceCount = perDeviceData.filter(d => d.active_seconds > 0).length;
  const topPerformer = perDeviceData.length > 0
    ? perDeviceData.reduce((best, d) => d.active_seconds > best.active_seconds ? d : best, perDeviceData[0])
    : null;

  let narrative = `Team logged ${activeHours} hours of active time across ${deviceCount} device${deviceCount !== 1 ? 's' : ''} from ${startDateStr} to ${endDateStr}.`;
  if (topPerformer && topPerformer.active_seconds > 0) {
    narrative += ` Top performer: ${topPerformer.device_name} with ${(topPerformer.active_seconds / 3600).toFixed(1)} hours.`;
  }

  db.insertWeeklyReport({
    week_start: startDateStr,
    week_end: endDateStr,
    report_json: JSON.stringify(reportJson),
    narrative,
    generated_at: Date.now(),
    file_path: null,
  });

  return { success: true, weekEnd: endDateStr };
}

// ============================================================================
// Admin events WebSocket (for frontend real-time updates)
// ============================================================================

const adminEventClients: Set<WebSocket> = new Set();

function broadcastAdminEvent(event: string, data: any): void {
  const message = JSON.stringify({ event, data });
  for (const ws of adminEventClients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  }
}

// Wire device server events to broadcast to admin UI
deviceServer.onDeviceConnected = (deviceId) => {
  broadcastAdminEvent('device:connected', deviceId);
};

deviceServer.onDeviceDisconnected = (deviceId) => {
  broadcastAdminEvent('device:disconnected', deviceId);
};

deviceServer.onPairRequest = (request) => {
  broadcastAdminEvent('pair:request', request);
};

deviceServer.onStatsReceived = (deviceId, stats) => {
  broadcastAdminEvent('stats:received', { deviceId, stats });
};

deviceServer.onExportResult = (deviceId, result) => {
  broadcastAdminEvent('export:result', { deviceId, result });
};

deviceServer.onLog = (message) => {
  broadcastAdminEvent('server:log', message);
};

// ============================================================================
// Start server
// ============================================================================

// We need to use the device server's underlying HTTP server so device WebSocket
// connections work. But we also need Express routes. Solution: mount Express as
// request handler on the device server's HTTP server, and add admin WS endpoint.

// The AdminServer creates its own http server internally. We'll override that
// by starting the Express app on a separate port won't work cleanly. Instead,
// let's start Express on the PORT and have the device server use a different
// approach. Actually, let's create a single HTTP server, mount Express, and
// pass it to the AdminServer's WebSocket server.

// Since AdminServer creates its own HTTP server, we need to modify the approach.
// The cleanest way: start the device server (which handles /pair/request, /health, /info,
// and WebSocket upgrades for devices), and separately start Express for the admin API.
// But this requires two ports which is awkward on Railway.

// Better approach: Don't start the device server's built-in HTTP server.
// Instead, create a single HTTP server from Express, and route WebSocket upgrades
// for devices through it, while also handling admin API and admin WS.

// Let's directly use the httpServer from Express:

const httpServer = http.createServer(app);

// We need to handle WS upgrades. The device server's WSS needs to be attached.
// We'll create a new WSS for admin events, and re-use the device WSS.

import { WebSocketServer } from 'ws';

// Admin events WebSocket server (for frontend)
const adminWss = new WebSocketServer({ noServer: true });
adminWss.on('connection', (ws, req) => {
  // Verify JWT from query string
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const token = url.searchParams.get('token');
  if (!token) {
    ws.close(4001, 'Missing token');
    return;
  }
  try {
    jwt.verify(token, JWT_SECRET);
  } catch {
    ws.close(4001, 'Invalid token');
    return;
  }

  adminEventClients.add(ws);

  // Send initial server info
  ws.send(JSON.stringify({
    event: 'server:started',
    data: {
      port: PORT,
      publicKey: deviceServer.getAdminPublicKey(),
    },
  }));

  ws.on('close', () => {
    adminEventClients.delete(ws);
  });
});

// Handle upgrade requests - route to admin WS or device WS
httpServer.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url || '', `http://${request.headers.host}`);

  if (url.pathname === '/ws/admin') {
    // Admin UI WebSocket
    adminWss.handleUpgrade(request, socket, head, (ws) => {
      adminWss.emit('connection', ws, request);
    });
  } else {
    // Device WebSocket (default path) — handled by AdminServer's WSS
    // We need to access the WSS from AdminServer. Let's call it directly.
    (deviceServer as any).wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
      (deviceServer as any).wss.emit('connection', ws, request);
    });
  }
});

// Override the AdminServer's start to NOT listen on its own, since we control the httpServer
// We still need to initialize it (keypair, mDNS for LAN, dashboard service, etc.)

async function startServer(): Promise<void> {
  console.log(`[SERVER] Starting ProduTime Admin Web on port ${PORT}`);
  console.log(`[SERVER] Database: ${DATABASE_PATH}`);
  console.log(`[SERVER] Static files: ${staticDir}`);

  // Start the device server's internal logic (exceptions engine).
  // Skip mDNS in cloud/Railway — it uses UDP multicast which doesn't work in containers.
  if (!process.env.RAILWAY_PUBLIC_DOMAIN) {
    try {
      (deviceServer as any).startMdnsAdvertising();
    } catch (err) {
      console.log('[SERVER] mDNS advertising skipped:', err);
    }
  } else {
    console.log('[SERVER] Cloud mode detected — skipping mDNS advertising');
  }

  // Start exceptions engine
  deviceServer.getDashboardService().startExceptionsEngine();

  // Start our unified HTTP server
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] ProduTime Admin Web listening on http://0.0.0.0:${PORT}`);
    console.log(`[SERVER] Admin UI:    http://localhost:${PORT}`);
    console.log(`[SERVER] Admin WS:    ws://localhost:${PORT}/ws/admin`);
    console.log(`[SERVER] Device WS:   ws://localhost:${PORT}`);
    console.log(`[SERVER] Health:      http://localhost:${PORT}/health`);

    broadcastAdminEvent('server:started', {
      port: PORT,
      publicKey: deviceServer.getAdminPublicKey(),
    });
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[SERVER] SIGTERM received, shutting down...');
  deviceServer.getDashboardService().stopExceptionsEngine();
  httpServer.close();
  db.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[SERVER] SIGINT received, shutting down...');
  deviceServer.getDashboardService().stopExceptionsEngine();
  httpServer.close();
  db.close();
  process.exit(0);
});
