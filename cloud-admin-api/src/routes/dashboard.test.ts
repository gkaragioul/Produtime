/**
 * Dashboard Routes Tests
 * 
 * Tests for:
 * - GET /api/v1/dashboard/story
 * - GET /api/v1/dashboard/attention
 * - GET /api/v1/dashboard/devices
 * - GET /api/v1/dashboard/trends
 * - GET /api/v1/dashboard/rankings
 * 
 * Requirements:
 * - 5.1: REST API endpoints for dashboard data retrieval
 * - 5.2: Require valid JWT token for dashboard data requests
 * - 5.3: Return only data belonging to the authenticated tenant
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';
import { dashboardRoutes } from './dashboard';
import { DashboardService } from '../services/dashboard-service';
import {
  DashboardStory,
  AttentionResponse,
  DeviceListItemEnhanced,
  TrendsResponse,
  RankingsResponse,
} from '../services/dashboard-types';

// ============================================================================
// Mock Data
// ============================================================================

const mockTenantId = 'tenant-123';
const mockUserId = 'user-456';

const mockDashboardStory: DashboardStory = {
  mode: 'NORMAL',
  healthScore: 85,
  healthLabel: 'healthy',
  managerSentence: 'Healthy: no tracking or attendance issues detected.',
  bullets: ['3 devices online, 0 idle, 1 offline.', 'Team progress: 75% of expected work completed.'],
  progress: {
    expectedSecondsSoFarTeam: 28800,
    activeSecondsTeam: 21600,
    progressPctTeam: 0.75,
  },
  expected: {
    workStart: '09:00',
    workEnd: '18:00',
    expectedTotalSeconds: 32400,
    expectedSoFarSeconds: 28800,
    mixedPolicies: false,
  },
  highlights: {
    criticalCount: 0,
    atRiskCount: 1,
    onTrackCount: 3,
    online: 3,
    idle: 0,
    offline: 1,
  },
  hasHistory7d: true,
  hasTopAppsToday: true,
};

const mockAttentionResponse: AttentionResponse = {
  groups: [
    {
      type: 'offline',
      label: 'Offline During Hours',
      severity: 'crit',
      count: 1,
      deviceIds: ['device-1'],
      preview: [{ deviceId: 'device-1', deviceName: 'Device 1', value: '30m ago' }],
      top: [{ deviceId: 'device-1', deviceName: 'Device 1', valueLabel: '30m ago', valueNumber: 1800 }],
    },
  ],
  totalCount: 1,
};

const mockDeviceList: DeviceListItemEnhanced[] = [
  {
    deviceId: 'device-1',
    deviceName: 'Device 1',
    status: 'online',
    lastSeenTs: Date.now(),
    appVersion: '1.0.0',
    today: {
      productiveSeconds: 0,
      unproductiveSeconds: 0,
      idleSeconds: 300,
      untrackedSeconds: 0,
      activeSeconds: 7200,
      firstActivityTs: Date.now() - 7200000,
      lastActivityTs: Date.now(),
    },
    topAppsToday: [{ app: 'VS Code', seconds: 3600 }],
    policy: { id: null, name: null, compliant: true },
    expected: { expectedSoFarSeconds: 14400, expectedTotalSeconds: 32400 },
    performance: {
      expectedSecondsSoFar: 14400,
      expectedTotalSeconds: 32400,
      progressPct: 0.5,
      startDelaySeconds: 0,
      untrackedPct: 0,
      idlePct: 0.02,
      risk: { score: 10, label: 'on_track', reasons: [] },
    },
    deltas: {
      avgActiveSeconds7d: 7000,
      avgIdleSeconds7d: 300,
      avgUntrackedSeconds7d: 100,
      deltaActivePct: 0.03,
      deltaIdlePct: 0,
      deltaUntrackedPct: -1,
    },
    trackingRunning: true,
  },
];

const mockTrendsResponse: TrendsResponse = {
  points: [
    { date: '2026-01-06', activeSeconds: 25000, idleSeconds: 1000, untrackedSeconds: 500 },
    { date: '2026-01-07', activeSeconds: 26000, idleSeconds: 900, untrackedSeconds: 400 },
  ],
  deltas: { activePct: 0.04, idlePct: -0.1, untrackedPct: -0.2 },
};

const mockRankingsResponse: RankingsResponse = {
  mostActive: [{ deviceId: 'device-1', deviceName: 'Device 1', value: 7200, deltaPct: 0.03 }],
  mostUntracked: [],
  biggestImprovement: [{ deviceId: 'device-1', deviceName: 'Device 1', value: 7200, deltaPct: 0.1 }],
  biggestRegression: [],
};

// ============================================================================
// Mock Dashboard Service
// ============================================================================

function createMockDashboardService(): DashboardService {
  return {
    getDashboardStory: vi.fn().mockResolvedValue(mockDashboardStory),
    getAttentionGroups: vi.fn().mockResolvedValue(mockAttentionResponse),
    getDevicesListEnhanced: vi.fn().mockResolvedValue(mockDeviceList),
    getTrends: vi.fn().mockResolvedValue(mockTrendsResponse),
    getRankings: vi.fn().mockResolvedValue(mockRankingsResponse),
    ingestHeartbeat: vi.fn().mockResolvedValue(undefined),
    setWebSocketManager: vi.fn(),
  } as unknown as DashboardService;
}

// ============================================================================
// Test Setup
// ============================================================================

async function buildTestServer(dashboardService: DashboardService): Promise<FastifyInstance> {
  const server = Fastify();

  await server.register(jwt, {
    secret: 'test-secret',
  });

  await server.register(dashboardRoutes, {
    dashboardService,
    prefix: '/api/v1/dashboard',
  });

  return server;
}

function generateValidToken(server: FastifyInstance, tenantId: string = mockTenantId): string {
  return server.jwt.sign({ userId: mockUserId, tenantId });
}

// ============================================================================
// Tests
// ============================================================================

describe('Dashboard Routes', () => {
  let server: FastifyInstance;
  let dashboardService: DashboardService;

  beforeEach(async () => {
    dashboardService = createMockDashboardService();
    server = await buildTestServer(dashboardService);
  });

  describe('GET /api/v1/dashboard/story', () => {
    it('should return dashboard story for authenticated tenant', async () => {
      const token = generateValidToken(server);

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/dashboard/story',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.mode).toBe('NORMAL');
      expect(body.healthScore).toBe(85);
      expect(body.healthLabel).toBe('healthy');
      expect(dashboardService.getDashboardStory).toHaveBeenCalledWith(mockTenantId);
    });

    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/dashboard/story',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('UNAUTHORIZED');
    });

    it('should return 401 with invalid token', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/dashboard/story',
        headers: { authorization: 'Bearer invalid-token' },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/dashboard/attention', () => {
    it('should return attention groups for authenticated tenant', async () => {
      const token = generateValidToken(server);

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/dashboard/attention',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.groups).toHaveLength(1);
      expect(body.totalCount).toBe(1);
      expect(dashboardService.getAttentionGroups).toHaveBeenCalledWith(mockTenantId);
    });

    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/dashboard/attention',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/dashboard/devices', () => {
    it('should return device list for authenticated tenant', async () => {
      const token = generateValidToken(server);

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/dashboard/devices',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.devices).toHaveLength(1);
      expect(body.devices[0].deviceId).toBe('device-1');
      expect(dashboardService.getDevicesListEnhanced).toHaveBeenCalledWith(mockTenantId);
    });

    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/dashboard/devices',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/dashboard/trends', () => {
    it('should return trends for authenticated tenant with default params', async () => {
      const token = generateValidToken(server);

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/dashboard/trends',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.points).toHaveLength(2);
      expect(dashboardService.getTrends).toHaveBeenCalledWith(mockTenantId, 'team', undefined, 7);
    });

    it('should accept custom days parameter', async () => {
      const token = generateValidToken(server);

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/dashboard/trends?days=14',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      expect(dashboardService.getTrends).toHaveBeenCalledWith(mockTenantId, 'team', undefined, 14);
    });

    it('should accept device scope with deviceId', async () => {
      const token = generateValidToken(server);

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/dashboard/trends?scope=device&deviceId=device-1',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      expect(dashboardService.getTrends).toHaveBeenCalledWith(mockTenantId, 'device', 'device-1', 7);
    });

    it('should return 400 when device scope without deviceId', async () => {
      const token = generateValidToken(server);

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/dashboard/trends?scope=device',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('VALIDATION_ERROR');
    });

    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/dashboard/trends',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/dashboard/rankings', () => {
    it('should return rankings for authenticated tenant', async () => {
      const token = generateValidToken(server);

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/dashboard/rankings',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.mostActive).toHaveLength(1);
      expect(body.biggestImprovement).toHaveLength(1);
      expect(dashboardService.getRankings).toHaveBeenCalledWith(mockTenantId);
    });

    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/dashboard/rankings',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('Tenant Isolation (Requirement 5.3)', () => {
    it('should only call service with authenticated tenant ID', async () => {
      const tenantA = 'tenant-a';
      const tenantB = 'tenant-b';

      const tokenA = server.jwt.sign({ userId: 'user-a', tenantId: tenantA });
      const tokenB = server.jwt.sign({ userId: 'user-b', tenantId: tenantB });

      // Request with tenant A token
      await server.inject({
        method: 'GET',
        url: '/api/v1/dashboard/story',
        headers: { authorization: `Bearer ${tokenA}` },
      });

      expect(dashboardService.getDashboardStory).toHaveBeenCalledWith(tenantA);

      // Request with tenant B token
      await server.inject({
        method: 'GET',
        url: '/api/v1/dashboard/story',
        headers: { authorization: `Bearer ${tokenB}` },
      });

      expect(dashboardService.getDashboardStory).toHaveBeenCalledWith(tenantB);
    });
  });
});
