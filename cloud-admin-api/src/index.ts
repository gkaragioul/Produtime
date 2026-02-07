import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import dotenv from 'dotenv';
import { registerErrorHandler } from './middleware/error-handler';
import { authRoutes } from './routes/auth';
import { tenantRoutes } from './routes/tenants';
import { pairingRoutes } from './routes/pairing';
import { dashboardRoutes } from './routes/dashboard';
import { AuthService, AuthDatabase, JwtSigner } from './services/auth-service';
import { TenantService, TenantDatabase } from './services/tenant-service';
import { PairingService, PairingDatabase, TenantInfo, StoredPairCode, StoredPairRequest, StoredDevice } from './services/pairing-service';
import { DashboardService } from './services/dashboard-service';
import { createCaptchaVerifier } from './services/captcha-service';
import { WebSocketManager, WebSocketDatabase, DeviceRecord } from './services/ws-manager';
import { CleanupService, CleanupDatabase, CleanupLogger } from './services/cleanup-service';
import { websocketRoutes } from './routes/websocket';
import { config } from './config';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const server = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
  // Generate request IDs for error tracking
  genReqId: () => `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
});

// ============================================================================
// Mock Database (to be replaced with Prisma implementation)
// ============================================================================

/**
 * Temporary mock database for development
 * TODO: Replace with Prisma client implementation
 */
const mockDatabase: AuthDatabase = {
  findAdminByEmail: async () => null,
  findAdminById: async () => null,
  updateAdminLoginSuccess: async () => {},
  updateAdminFailedAttempt: async () => {},
  createSession: async (session) => ({ id: `session-${Date.now()}`, ...session }),
  findSessionByRefreshToken: async () => null,
  deleteSession: async () => {},
  deleteSessionsByUserId: async () => {},
  recordFailedLogin: async () => {},
  countRecentFailedLogins: async () => 0,
};

/**
 * Temporary mock tenant database for development
 * TODO: Replace with Prisma client implementation
 */
const mockTenantDatabase: TenantDatabase = {
  createTenant: async (tenant) => ({
    id: tenant.id,
    name: tenant.name,
    wsEndpoint: tenant.wsEndpoint,
    apiKey: tenant.apiKey,
    createdAt: new Date(),
    updatedAt: new Date(),
    settings: tenant.settings ? JSON.parse(tenant.settings) : null,
  }),
  findTenantById: async () => null,
  findTenantByApiKey: async () => null,
  findTenantByWsEndpoint: async () => null,
  updateTenant: async (tenantId, updates) => ({
    id: tenantId,
    name: updates.name || 'Test Tenant',
    wsEndpoint: 'ws://localhost:3000/ws/tenant/' + tenantId,
    apiKey: 'mock-api-key',
    createdAt: new Date(),
    updatedAt: new Date(),
    settings: updates.settings ? JSON.parse(updates.settings) : null,
  }),
  createAdminUser: async (admin) => ({
    id: admin.id,
    email: admin.email,
  }),
  findAdminByEmail: async () => null,
  countTenants: async () => 0,
  getAllTenantIds: async () => [],
  getAllApiKeys: async () => [],
  getAllWsEndpoints: async () => [],
};

/**
 * Temporary mock pairing database for development
 * TODO: Replace with Prisma client implementation
 */
const mockPairingDatabase: PairingDatabase = {
  createPairCode: async (pairCode) => ({
    id: pairCode.id,
    tenantId: pairCode.tenantId,
    code: pairCode.code,
    expiresAt: pairCode.expiresAt,
    usedAt: null,
    createdAt: new Date(),
  }),
  findPairCode: async () => null,
  findPairCodeByCode: async () => null,
  markPairCodeUsed: async () => {},
  createPairRequest: async (request) => ({
    id: request.id,
    tenantId: request.tenantId,
    deviceId: request.deviceId,
    deviceName: request.deviceName,
    devicePubKey: request.devicePubKey,
    appVersion: request.appVersion,
    osInfo: request.osInfo,
    ip: request.ip,
    status: 'pending' as const,
    createdAt: new Date(),
    expiresAt: request.expiresAt,
    resolvedAt: null,
    resolvedBy: null,
  }),
  findPairRequestById: async () => null,
  findPendingRequests: async () => [],
  updatePairRequestStatus: async (requestId, status, resolvedBy) => ({
    id: requestId,
    tenantId: 'mock-tenant',
    deviceId: 'mock-device',
    deviceName: 'Mock Device',
    devicePubKey: 'mock-pub-key',
    appVersion: '1.0.0',
    osInfo: 'Mock OS',
    ip: '127.0.0.1',
    status,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    resolvedAt: new Date(),
    resolvedBy,
  }),
  createDevice: async (device) => ({
    id: device.id,
    tenantId: device.tenantId,
    deviceId: device.deviceId,
    deviceName: device.deviceName,
    devicePubKey: device.devicePubKey,
    pairedAt: new Date(),
    status: 'offline',
    appVersion: device.appVersion,
    ip: device.ip,
    revoked: false,
  }),
  findDeviceByDeviceId: async () => null,
  findTenantById: async () => null,
};

/**
 * Temporary mock WebSocket database for development
 * TODO: Replace with Prisma client implementation
 */
const mockWsDatabase: WebSocketDatabase = {
  findDeviceByDeviceId: async () => null,
  updateDeviceStatus: async () => {},
  findTenantById: async () => null,
};

/**
 * Create Prisma-backed cleanup database
 * Requirements: 8.1, 8.2, 8.3
 */
const createCleanupDatabase = (prisma: PrismaClient): CleanupDatabase => ({
  deleteOldSessions: async (olderThan: Date) => {
    const result = await prisma.session.deleteMany({
      where: { createdAt: { lt: olderThan } },
    });
    return result.count;
  },

  deleteOldPairCodes: async (olderThan: Date) => {
    const result = await prisma.pairCode.deleteMany({
      where: { createdAt: { lt: olderThan } },
    });
    return result.count;
  },

  deleteOldFailedLogins: async (olderThan: Date) => {
    const result = await prisma.failedLogin.deleteMany({
      where: { createdAt: { lt: olderThan } },
    });
    return result.count;
  },

  archiveOldDailyMetrics: async (olderThan: Date) => {
    // Get all devices with their latest metric date
    const latestMetrics = await prisma.dailyMetrics.groupBy({
      by: ['tenantId', 'deviceId'],
      _max: { dateYmd: true },
    });

    // Build a list of (tenantId, deviceId, latestDateYmd) to preserve
    const latestByDevice = new Map<string, string>();
    for (const metric of latestMetrics) {
      const key = `${metric.tenantId}:${metric.deviceId}`;
      if (metric._max.dateYmd) {
        latestByDevice.set(key, metric._max.dateYmd);
      }
    }

    // Delete old metrics that are not the latest for their device
    let deletedCount = 0;
    const oldMetrics = await prisma.dailyMetrics.findMany({
      where: { createdAt: { lt: olderThan } },
      select: { id: true, tenantId: true, deviceId: true, dateYmd: true },
    });

    const idsToDelete: string[] = [];
    for (const metric of oldMetrics) {
      const key = `${metric.tenantId}:${metric.deviceId}`;
      const latestDate = latestByDevice.get(key);
      // Only delete if this is not the latest metric for this device
      if (latestDate && metric.dateYmd !== latestDate) {
        idsToDelete.push(metric.id);
      }
    }

    if (idsToDelete.length > 0) {
      const result = await prisma.dailyMetrics.deleteMany({
        where: { id: { in: idsToDelete } },
      });
      deletedCount = result.count;
    }

    return deletedCount;
  },

  countOldSessions: async (olderThan: Date) => {
    return prisma.session.count({
      where: { createdAt: { lt: olderThan } },
    });
  },

  countOldPairCodes: async (olderThan: Date) => {
    return prisma.pairCode.count({
      where: { createdAt: { lt: olderThan } },
    });
  },

  countOldFailedLogins: async (olderThan: Date) => {
    return prisma.failedLogin.count({
      where: { createdAt: { lt: olderThan } },
    });
  },
});

async function start() {
  // Register global error handler (Requirements 7.1, 7.2, 7.3, 7.4, 7.5)
  registerErrorHandler(server);

  // Register plugins
  await server.register(cors, {
    origin: process.env.CORS_ORIGIN || true,
    credentials: true,
  });

  await server.register(jwt, {
    secret: process.env.JWT_SECRET || 'development-secret-change-in-production',
  });

  await server.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  await server.register(websocket);

  // Health check endpoint
  server.get('/health', async () => {
    return { status: 'ok', timestamp: Date.now() };
  });

  // ============================================================================
  // Create Services
  // ============================================================================

  // Create JWT signer adapter for AuthService
  const jwtSigner: JwtSigner = {
    sign: (payload: object, options?: { expiresIn: string | number }) => {
      return server.jwt.sign(payload, options);
    },
    verify: (token: string) => {
      return server.jwt.verify(token) as any;
    },
  };

  // Create CAPTCHA verifier if enabled
  const captchaVerifier = config.captchaEnabled
    ? createCaptchaVerifier()
    : undefined;

  // Create auth service
  const authService = new AuthService(mockDatabase, jwtSigner, captchaVerifier);

  // Create tenant service
  const tenantService = new TenantService(mockTenantDatabase);

  // Create pairing service
  const pairingService = new PairingService(mockPairingDatabase, captchaVerifier);

  // Create Prisma client for dashboard service
  const prisma = new PrismaClient();

  // Create WebSocket manager (Requirements 4.1, 4.2, 4.3, 4.6, 4.7, 12.4)
  const wsManager = new WebSocketManager(mockWsDatabase);
  wsManager.start();

  // Create dashboard service (Requirements 5.1, 5.2, 5.3, 5.4, 5.5)
  const dashboardService = new DashboardService(prisma, wsManager);

  // Create cleanup service logger adapter (Requirements 8.5)
  const cleanupLogger: CleanupLogger = {
    info: (message, data) => server.log.info({ ...data }, message),
    error: (message, data) => server.log.error({ ...data }, message),
    warn: (message, data) => server.log.warn({ ...data }, message),
  };

  // Create cleanup service (Requirements 8.1, 8.2, 8.3, 8.5, 8.6)
  const cleanupDatabase = createCleanupDatabase(prisma);
  const cleanupService = new CleanupService(cleanupDatabase, cleanupLogger, {
    retentionDays: 30,
    scheduledHour: 3, // Run at 03:00 local time
    runOnStartup: true,
  });

  // Token verification function for WebSocket auth
  const verifyToken = async (token: string): Promise<{ userId: string; tenantId: string } | null> => {
    try {
      const payload = server.jwt.verify(token) as { userId: string; tenantId: string };
      return payload;
    } catch {
      return null;
    }
  };

  // ============================================================================
  // Register Routes
  // ============================================================================

  // Auth routes (Requirements 2.1, 2.2, 2.3)
  await server.register(authRoutes, {
    authService,
    prefix: '/api/v1/auth',
  });

  // Tenant routes (Requirements 1.4, 10.1, 10.2, 10.4)
  await server.register(tenantRoutes, {
    tenantService,
    operatorApiKey: process.env.OPERATOR_API_KEY,
    prefix: '/api/v1/tenants',
  });

  // Pairing routes (Requirements 3.1, 3.3, 3.4, 3.5, 3.6)
  await server.register(pairingRoutes, {
    pairingService,
    prefix: '/api/v1/pairing',
  });

  // WebSocket routes (Requirements 4.1, 4.3, 12.4)
  await server.register(websocketRoutes, {
    wsManager,
    verifyToken,
    prefix: '/ws',
  });

  // Dashboard routes (Requirements 5.1, 5.2, 5.3)
  await server.register(dashboardRoutes, {
    dashboardService,
    prefix: '/api/v1/dashboard',
  });

  // Start server
  const port = parseInt(process.env.PORT || '3000', 10);
  const host = process.env.HOST || '0.0.0.0';

  try {
    await server.listen({ port, host });
    server.log.info(`Cloud Admin API running on ${host}:${port}`);

    // Start cleanup service (Requirements 8.1: Run at startup and daily at 03:00)
    await cleanupService.start();
    server.log.info('Cleanup service started');
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }

  // Graceful shutdown handler
  const shutdown = async () => {
    server.log.info('Shutting down...');
    cleanupService.stop();
    wsManager.stop();
    await prisma.$disconnect();
    await server.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start();

export { server };
