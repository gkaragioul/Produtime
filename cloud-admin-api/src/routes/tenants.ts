/**
 * Tenant Routes
 * 
 * Implements:
 * - POST /api/v1/tenants - Create new tenant (operator only)
 * - GET /api/v1/tenants/:tenantId - Get tenant details
 * 
 * Requirements:
 * - 1.4: Validate tenant context before processing
 * - 10.1: Generate unique API credentials
 * - 10.2: Create initial admin user for tenant
 * - 10.4: Generate unique WebSocket endpoint URL
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { TenantService, TenantError } from '../services/tenant-service';
import { 
  validateBody, 
  validateParams,
  tenantCreateSchema,
  TenantCreateRequest 
} from '../middleware/validation';
import { z } from 'zod';

// ============================================================================
// Types
// ============================================================================

interface TenantRoutesOptions {
  tenantService: TenantService;
  operatorApiKey?: string;
}

interface TenantIdParams {
  tenantId: string;
}

// Schema for tenant ID parameter validation
const tenantIdParamsSchema = z.object({
  tenantId: z.string().uuid('Invalid tenant ID format'),
});

// ============================================================================
// Authorization Helpers
// ============================================================================

/**
 * Verify operator API key for tenant creation
 * Operators are system-level administrators who can create tenants
 */
function verifyOperatorAuth(
  request: FastifyRequest, 
  operatorApiKey: string | undefined
): boolean {
  if (!operatorApiKey) {
    // If no operator key is configured, deny all operator operations
    return false;
  }
  
  const authHeader = request.headers['x-operator-key'];
  if (!authHeader || typeof authHeader !== 'string') {
    return false;
  }
  
  // Constant-time comparison to prevent timing attacks
  if (authHeader.length !== operatorApiKey.length) {
    return false;
  }
  
  let result = 0;
  for (let i = 0; i < authHeader.length; i++) {
    result |= authHeader.charCodeAt(i) ^ operatorApiKey.charCodeAt(i);
  }
  
  return result === 0;
}

/**
 * Verify tenant admin authorization
 * Checks if the authenticated user belongs to the requested tenant
 */
function verifyTenantAdminAuth(
  request: FastifyRequest,
  tenantId: string
): boolean {
  const user = request.user as { userId?: string; tenantId?: string } | undefined;
  
  if (!user || !user.tenantId) {
    return false;
  }
  
  return user.tenantId === tenantId;
}

// ============================================================================
// Route Registration
// ============================================================================

/**
 * Register tenant routes
 */
export async function tenantRoutes(
  fastify: FastifyInstance,
  options: TenantRoutesOptions
): Promise<void> {
  const { tenantService, operatorApiKey } = options;

  /**
   * POST /api/v1/tenants
   * 
   * Create a new tenant with admin user.
   * Requires operator API key authentication.
   * 
   * Requirements: 10.1, 10.2, 10.4
   */
  fastify.post<{ Body: TenantCreateRequest }>(
    '/',
    {
      preHandler: [
        // Validate request body
        validateBody(tenantCreateSchema),
        // Verify operator authorization
        async (request: FastifyRequest, reply: FastifyReply) => {
          if (!verifyOperatorAuth(request, operatorApiKey)) {
            return reply.status(403).send({
              error: 'FORBIDDEN',
              message: 'Operator authorization required',
            });
          }
        },
      ],
    },
    async (request: FastifyRequest<{ Body: TenantCreateRequest }>, reply: FastifyReply) => {
      const { name, adminEmail } = request.body;

      try {
        const result = await tenantService.createTenant(name, adminEmail);

        return reply.status(201).send({
          tenantId: result.tenantId,
          name: result.name,
          wsEndpoint: result.wsEndpoint,
          apiKey: result.apiKey,
          adminUser: {
            id: result.adminUser.id,
            email: result.adminUser.email,
            temporaryPassword: result.adminUser.temporaryPassword,
          },
        });
      } catch (error) {
        if (error instanceof TenantError) {
          return handleTenantError(error, reply);
        }
        throw error;
      }
    }
  );

  /**
   * GET /api/v1/tenants/:tenantId
   * 
   * Get tenant details.
   * Requires operator API key OR tenant admin JWT authentication.
   * 
   * Requirement: 1.4
   */
  fastify.get<{ Params: TenantIdParams }>(
    '/:tenantId',
    {
      preHandler: [
        // Validate params
        validateParams(tenantIdParamsSchema),
        // Verify authorization (operator OR tenant admin)
        async (request: FastifyRequest<{ Params: TenantIdParams }>, reply: FastifyReply) => {
          const { tenantId } = request.params;
          
          // Check operator auth first
          if (verifyOperatorAuth(request, operatorApiKey)) {
            return; // Operator is authorized
          }
          
          // Try JWT auth for tenant admin
          try {
            await request.jwtVerify();
            
            if (verifyTenantAdminAuth(request, tenantId)) {
              return; // Tenant admin is authorized
            }
          } catch {
            // JWT verification failed, continue to deny
          }
          
          // Neither operator nor tenant admin
          return reply.status(403).send({
            error: 'FORBIDDEN',
            message: 'Access denied',
          });
        },
      ],
    },
    async (request: FastifyRequest<{ Params: TenantIdParams }>, reply: FastifyReply) => {
      const { tenantId } = request.params;

      try {
        const tenant = await tenantService.getTenant(tenantId);

        if (!tenant) {
          return reply.status(404).send({
            error: 'NOT_FOUND',
            message: 'Tenant not found',
          });
        }

        // Return tenant details (without sensitive API key for non-operators)
        const isOperator = verifyOperatorAuth(request, operatorApiKey);
        
        const response: any = {
          id: tenant.id,
          name: tenant.name,
          wsEndpoint: tenant.wsEndpoint,
          createdAt: tenant.createdAt,
          settings: tenant.settings,
        };
        
        // Only include API key for operators
        if (isOperator) {
          response.apiKey = tenant.apiKey;
        }

        return reply.status(200).send(response);
      } catch (error) {
        if (error instanceof TenantError) {
          return handleTenantError(error, reply);
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
 * Map TenantError codes to HTTP responses
 */
function handleTenantError(error: TenantError, reply: FastifyReply): FastifyReply {
  switch (error.code) {
    case 'TENANT_NOT_FOUND':
      return reply.status(404).send({
        error: 'NOT_FOUND',
        message: 'Tenant not found',
      });

    case 'TENANT_EXISTS':
      return reply.status(409).send({
        error: 'CONFLICT',
        message: 'Tenant already exists',
      });

    case 'ADMIN_EXISTS':
      return reply.status(409).send({
        error: 'CONFLICT',
        message: 'Admin user already exists',
      });

    case 'INVALID_TENANT_ID':
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Invalid tenant ID',
      });

    case 'CREATION_FAILED':
      return reply.status(500).send({
        error: 'SERVER_ERROR',
        message: 'Failed to create tenant',
      });

    default:
      return reply.status(500).send({
        error: 'SERVER_ERROR',
        message: 'An unexpected error occurred',
      });
  }
}

export default tenantRoutes;
