/**
 * Dashboard Routes
 * 
 * Implements:
 * - GET /api/v1/dashboard/story - Get dashboard story for tenant
 * - GET /api/v1/dashboard/attention - Get attention groups for tenant
 * - GET /api/v1/dashboard/devices - Get device list for tenant
 * - GET /api/v1/dashboard/trends - Get 7-day trends for tenant
 * - GET /api/v1/dashboard/rankings - Get rankings for tenant
 * 
 * Requirements:
 * - 5.1: Expose REST API endpoints for dashboard data retrieval
 * - 5.2: Require valid JWT token for dashboard data requests
 * - 5.3: Return only data belonging to the authenticated tenant
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { DashboardService } from '../services/dashboard-service';
import { z } from 'zod';
import { validateQuery } from '../middleware/validation';

// ============================================================================
// Types
// ============================================================================

interface DashboardRoutesOptions {
  dashboardService: DashboardService;
}

interface TrendsQuery {
  days?: number;
  scope?: 'team' | 'device';
  deviceId?: string;
}

// Schema for trends query parameters
const trendsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(30).optional().default(7),
  scope: z.enum(['team', 'device']).optional().default('team'),
  deviceId: z.string().max(100).optional(),
}).refine(
  (data) => data.scope !== 'device' || data.deviceId,
  { message: 'deviceId is required when scope is "device"' }
);

// ============================================================================
// Authorization Helper
// ============================================================================

/**
 * Verify tenant admin authorization and extract tenant ID
 * Returns the tenant ID from the JWT token
 */
function getTenantIdFromAuth(request: FastifyRequest): string | null {
  const user = request.user as { userId?: string; tenantId?: string } | undefined;
  
  if (!user || !user.tenantId) {
    return null;
  }
  
  return user.tenantId;
}

/**
 * Pre-handler to verify JWT authentication
 */
async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify();
    
    const tenantId = getTenantIdFromAuth(request);
    if (!tenantId) {
      return reply.status(401).send({
        error: 'UNAUTHORIZED',
        message: 'Invalid or expired token',
      });
    }
  } catch (error) {
    return reply.status(401).send({
      error: 'UNAUTHORIZED',
      message: 'Invalid or expired token',
    });
  }
}

// ============================================================================
// Route Registration
// ============================================================================

/**
 * Register dashboard routes
 */
export async function dashboardRoutes(
  fastify: FastifyInstance,
  options: DashboardRoutesOptions
): Promise<void> {
  const { dashboardService } = options;

  /**
   * GET /api/v1/dashboard/story
   * 
   * Get dashboard story (Today's narrative) for the authenticated tenant.
   * Returns health score, manager sentence, bullets, and progress info.
   * 
   * Requirements: 5.1, 5.2, 5.3
   */
  fastify.get(
    '/story',
    {
      preHandler: requireAuth,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = getTenantIdFromAuth(request);
      
      if (!tenantId) {
        return reply.status(401).send({
          error: 'UNAUTHORIZED',
          message: 'Invalid or expired token',
        });
      }

      try {
        const story = await dashboardService.getDashboardStory(tenantId);
        return reply.status(200).send(story);
      } catch (error) {
        request.log.error({ error, tenantId }, 'Failed to get dashboard story');
        return reply.status(500).send({
          error: 'SERVER_ERROR',
          message: 'Failed to retrieve dashboard story',
        });
      }
    }
  );

  /**
   * GET /api/v1/dashboard/attention
   * 
   * Get attention groups (categorized exceptions) for the authenticated tenant.
   * Returns groups with top offenders for each attention type.
   * 
   * Requirements: 5.1, 5.2, 5.3
   */
  fastify.get(
    '/attention',
    {
      preHandler: requireAuth,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = getTenantIdFromAuth(request);
      
      if (!tenantId) {
        return reply.status(401).send({
          error: 'UNAUTHORIZED',
          message: 'Invalid or expired token',
        });
      }

      try {
        const attention = await dashboardService.getAttentionGroups(tenantId);
        return reply.status(200).send(attention);
      } catch (error) {
        request.log.error({ error, tenantId }, 'Failed to get attention groups');
        return reply.status(500).send({
          error: 'SERVER_ERROR',
          message: 'Failed to retrieve attention groups',
        });
      }
    }
  );

  /**
   * GET /api/v1/dashboard/devices
   * 
   * Get enhanced device list for the authenticated tenant.
   * Returns devices with performance metrics, deltas, and risk scores.
   * 
   * Requirements: 5.1, 5.2, 5.3
   */
  fastify.get(
    '/devices',
    {
      preHandler: requireAuth,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = getTenantIdFromAuth(request);
      
      if (!tenantId) {
        return reply.status(401).send({
          error: 'UNAUTHORIZED',
          message: 'Invalid or expired token',
        });
      }

      try {
        const devices = await dashboardService.getDevicesListEnhanced(tenantId);
        return reply.status(200).send({ devices });
      } catch (error) {
        request.log.error({ error, tenantId }, 'Failed to get device list');
        return reply.status(500).send({
          error: 'SERVER_ERROR',
          message: 'Failed to retrieve device list',
        });
      }
    }
  );

  /**
   * GET /api/v1/dashboard/trends
   * 
   * Get trends data for the authenticated tenant.
   * Returns time series data for active, idle, and untracked seconds.
   * 
   * Query parameters:
   * - days: Number of days (1-30, default 7)
   * - scope: 'team' or 'device' (default 'team')
   * - deviceId: Required when scope is 'device'
   * 
   * Requirements: 5.1, 5.2, 5.3
   */
  fastify.get<{ Querystring: TrendsQuery }>(
    '/trends',
    {
      preHandler: [
        requireAuth,
        validateQuery(trendsQuerySchema),
      ],
    },
    async (request: FastifyRequest<{ Querystring: TrendsQuery }>, reply: FastifyReply) => {
      const tenantId = getTenantIdFromAuth(request);
      
      if (!tenantId) {
        return reply.status(401).send({
          error: 'UNAUTHORIZED',
          message: 'Invalid or expired token',
        });
      }

      const { days = 7, scope = 'team', deviceId } = request.query;

      try {
        const trends = await dashboardService.getTrends(tenantId, scope, deviceId, days);
        return reply.status(200).send(trends);
      } catch (error) {
        request.log.error({ error, tenantId }, 'Failed to get trends');
        return reply.status(500).send({
          error: 'SERVER_ERROR',
          message: 'Failed to retrieve trends',
        });
      }
    }
  );

  /**
   * GET /api/v1/dashboard/rankings
   * 
   * Get rankings for the authenticated tenant.
   * Returns most active, most untracked, biggest improvement, and biggest regression.
   * 
   * Requirements: 5.1, 5.2, 5.3
   */
  fastify.get(
    '/rankings',
    {
      preHandler: requireAuth,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = getTenantIdFromAuth(request);
      
      if (!tenantId) {
        return reply.status(401).send({
          error: 'UNAUTHORIZED',
          message: 'Invalid or expired token',
        });
      }

      try {
        const rankings = await dashboardService.getRankings(tenantId);
        return reply.status(200).send(rankings);
      } catch (error) {
        request.log.error({ error, tenantId }, 'Failed to get rankings');
        return reply.status(500).send({
          error: 'SERVER_ERROR',
          message: 'Failed to retrieve rankings',
        });
      }
    }
  );
}

export default dashboardRoutes;
