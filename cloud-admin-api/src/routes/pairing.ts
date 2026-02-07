/**
 * Pairing Routes
 * 
 * Implements:
 * - POST /api/v1/pairing/generate-code - Generate pair code (admin only)
 * - POST /api/v1/pairing/request - Submit pairing request (client app)
 * - POST /api/v1/pairing/approve/:requestId - Approve pairing (admin only)
 * - POST /api/v1/pairing/deny/:requestId - Deny pairing (admin only)
 * - GET /api/v1/pairing/pending - Get pending requests (admin only)
 * 
 * Requirements:
 * - 3.1: Generate 6-digit pair code valid for 5 minutes
 * - 3.3: Create pending pairing request with valid code
 * - 3.4: Rate limit pairing requests
 * - 3.5: CAPTCHA verification when enabled
 * - 3.6: Exchange cryptographic keys on approval
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PairingService, PairingError } from '../services/pairing-service';
import { 
  validateBody, 
  validateParams,
  pairRequestSchema,
  generatePairCodeSchema,
  PairRequest,
  GeneratePairCodeRequest 
} from '../middleware/validation';
import { z } from 'zod';

// ============================================================================
// Types
// ============================================================================

interface PairingRoutesOptions {
  pairingService: PairingService;
}

interface RequestIdParams {
  requestId: string;
}

// Schema for request ID parameter validation
const requestIdParamsSchema = z.object({
  requestId: z.string().uuid('Invalid request ID format'),
});

// ============================================================================
// Authorization Helpers
// ============================================================================

/**
 * Verify admin JWT authentication and extract tenant context
 * Returns the user payload if authenticated, null otherwise
 */
async function verifyAdminAuth(
  request: FastifyRequest
): Promise<{ userId: string; tenantId: string; email: string } | null> {
  try {
    await request.jwtVerify();
    const user = request.user as { userId?: string; tenantId?: string; email?: string };
    
    if (!user || !user.userId || !user.tenantId) {
      return null;
    }
    
    return {
      userId: user.userId,
      tenantId: user.tenantId,
      email: user.email || '',
    };
  } catch {
    return null;
  }
}

// ============================================================================
// Route Registration
// ============================================================================

/**
 * Register pairing routes
 */
export async function pairingRoutes(
  fastify: FastifyInstance,
  options: PairingRoutesOptions
): Promise<void> {
  const { pairingService } = options;

  /**
   * POST /api/v1/pairing/generate-code
   * 
   * Generate a new pair code for the authenticated admin's tenant.
   * Requires admin JWT authentication.
   * 
   * Requirement: 3.1
   */
  fastify.post<{ Body: GeneratePairCodeRequest }>(
    '/generate-code',
    {
      preHandler: [
        validateBody(generatePairCodeSchema),
        async (request: FastifyRequest, reply: FastifyReply) => {
          const user = await verifyAdminAuth(request);
          if (!user) {
            return reply.status(401).send({
              error: 'UNAUTHORIZED',
              message: 'Authentication required',
            });
          }
          // Store user in request for handler access
          (request as any).adminUser = user;
        },
      ],
    },
    async (request: FastifyRequest<{ Body: GeneratePairCodeRequest }>, reply: FastifyReply) => {
      const user = (request as any).adminUser as { userId: string; tenantId: string };

      try {
        const result = await pairingService.generatePairCode(user.tenantId);

        return reply.status(201).send({
          code: result.code,
          expiresAt: result.expiresAt,
          tenantId: result.tenantId,
        });
      } catch (error) {
        if (error instanceof PairingError) {
          return handlePairingError(error, reply);
        }
        throw error;
      }
    }
  );

  /**
   * POST /api/v1/pairing/request
   * 
   * Submit a pairing request with a pair code.
   * This endpoint is called by client apps (no JWT auth required).
   * Rate limited and optionally requires CAPTCHA.
   * 
   * Requirements: 3.3, 3.4, 3.5
   */
  fastify.post<{ Body: PairRequest }>(
    '/request',
    {
      preHandler: validateBody(pairRequestSchema),
    },
    async (request: FastifyRequest<{ Body: PairRequest }>, reply: FastifyReply) => {
      const body = request.body;
      const ip = request.ip || 'unknown';

      try {
        const result = await pairingService.submitPairRequest({
          pairCode: body.pairCode,
          deviceId: body.deviceId,
          deviceName: body.deviceName,
          devicePubKey: body.devicePubKey,
          appVersion: body.appVersion,
          osInfo: body.osInfo,
          ip,
          captchaToken: body.captchaToken,
        });

        return reply.status(201).send({
          requestId: result.requestId,
          status: result.status,
          expiresAt: result.expiresAt,
        });
      } catch (error) {
        if (error instanceof PairingError) {
          return handlePairingError(error, reply);
        }
        throw error;
      }
    }
  );

  /**
   * POST /api/v1/pairing/approve/:requestId
   * 
   * Approve a pending pairing request.
   * Requires admin JWT authentication.
   * 
   * Requirement: 3.6
   */
  fastify.post<{ Params: RequestIdParams }>(
    '/approve/:requestId',
    {
      preHandler: [
        validateParams(requestIdParamsSchema),
        async (request: FastifyRequest, reply: FastifyReply) => {
          const user = await verifyAdminAuth(request);
          if (!user) {
            return reply.status(401).send({
              error: 'UNAUTHORIZED',
              message: 'Authentication required',
            });
          }
          (request as any).adminUser = user;
        },
      ],
    },
    async (request: FastifyRequest<{ Params: RequestIdParams }>, reply: FastifyReply) => {
      const { requestId } = request.params;
      const user = (request as any).adminUser as { userId: string; tenantId: string };

      try {
        const result = await pairingService.approvePairing(requestId, user.userId);

        return reply.status(200).send({
          success: result.success,
          wsEndpoint: result.wsEndpoint,
          adminPubKey: result.adminPubKey,
          sessionToken: result.sessionToken,
        });
      } catch (error) {
        if (error instanceof PairingError) {
          return handlePairingError(error, reply);
        }
        throw error;
      }
    }
  );

  /**
   * POST /api/v1/pairing/deny/:requestId
   * 
   * Deny a pending pairing request.
   * Requires admin JWT authentication.
   * 
   * Requirement: 3.6
   */
  fastify.post<{ Params: RequestIdParams }>(
    '/deny/:requestId',
    {
      preHandler: [
        validateParams(requestIdParamsSchema),
        async (request: FastifyRequest, reply: FastifyReply) => {
          const user = await verifyAdminAuth(request);
          if (!user) {
            return reply.status(401).send({
              error: 'UNAUTHORIZED',
              message: 'Authentication required',
            });
          }
          (request as any).adminUser = user;
        },
      ],
    },
    async (request: FastifyRequest<{ Params: RequestIdParams }>, reply: FastifyReply) => {
      const { requestId } = request.params;
      const user = (request as any).adminUser as { userId: string; tenantId: string };

      try {
        await pairingService.denyPairing(requestId, user.userId);

        return reply.status(200).send({
          success: true,
          message: 'Pairing request denied',
        });
      } catch (error) {
        if (error instanceof PairingError) {
          return handlePairingError(error, reply);
        }
        throw error;
      }
    }
  );

  /**
   * GET /api/v1/pairing/pending
   * 
   * Get all pending pairing requests for the authenticated admin's tenant.
   * Requires admin JWT authentication.
   * 
   * Requirement: 3.3
   */
  fastify.get(
    '/pending',
    {
      preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
        const user = await verifyAdminAuth(request);
        if (!user) {
          return reply.status(401).send({
            error: 'UNAUTHORIZED',
            message: 'Authentication required',
          });
        }
        (request as any).adminUser = user;
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).adminUser as { userId: string; tenantId: string };

      try {
        const requests = await pairingService.getPendingRequests(user.tenantId);

        return reply.status(200).send({
          requests,
          count: requests.length,
        });
      } catch (error) {
        if (error instanceof PairingError) {
          return handlePairingError(error, reply);
        }
        throw error;
      }
    }
  );
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Map PairingError codes to HTTP responses
 * Requirement 3.9: Uniform error for invalid/expired codes
 */
function handlePairingError(error: PairingError, reply: FastifyReply): FastifyReply {
  switch (error.code) {
    case 'INVALID_PAIR_CODE':
    case 'PAIR_CODE_EXPIRED':
      // Requirement 3.9: Return identical error for invalid/expired codes
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Invalid or expired pair code',
      });

    case 'REQUEST_NOT_FOUND':
      return reply.status(404).send({
        error: 'NOT_FOUND',
        message: 'Pairing request not found',
      });

    case 'REQUEST_ALREADY_RESOLVED':
      return reply.status(409).send({
        error: 'CONFLICT',
        message: 'Pairing request already resolved',
      });

    case 'REQUEST_EXPIRED':
      return reply.status(410).send({
        error: 'GONE',
        message: 'Pairing request has expired',
      });

    case 'TENANT_NOT_FOUND':
      return reply.status(404).send({
        error: 'NOT_FOUND',
        message: 'Tenant not found',
      });

    case 'DEVICE_ALREADY_PAIRED':
      return reply.status(409).send({
        error: 'CONFLICT',
        message: 'Device is already paired',
      });

    case 'CAPTCHA_REQUIRED':
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: 'CAPTCHA verification required',
      });

    case 'CAPTCHA_INVALID':
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: 'CAPTCHA verification failed',
      });

    default:
      return reply.status(500).send({
        error: 'SERVER_ERROR',
        message: 'An unexpected error occurred',
      });
  }
}

export default pairingRoutes;
