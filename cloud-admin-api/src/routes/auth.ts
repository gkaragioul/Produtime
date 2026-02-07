/**
 * Authentication Routes
 * 
 * Implements:
 * - POST /api/v1/auth/login - User login with email/password
 * - POST /api/v1/auth/refresh - Refresh access token
 * - POST /api/v1/auth/logout - Logout and invalidate tokens
 * 
 * Requirements:
 * - 2.1: Email and password credentials required for login
 * - 2.2: Passwords hashed with bcrypt (12 rounds minimum)
 * - 2.3: JWT access tokens (15 min expiry) and refresh tokens (14 day expiry)
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { AuthService, AuthError } from '../services/auth-service';
import { 
  validateBody, 
  loginSchema, 
  refreshTokenSchema,
  LoginRequest,
  RefreshTokenRequest 
} from '../middleware/validation';

// ============================================================================
// Types
// ============================================================================

interface AuthRoutesOptions {
  authService: AuthService;
}

interface LoginBody {
  email: string;
  password: string;
  captchaToken?: string;
}

interface RefreshBody {
  refreshToken: string;
}

// ============================================================================
// Route Registration
// ============================================================================

/**
 * Register authentication routes
 */
export async function authRoutes(
  fastify: FastifyInstance,
  options: AuthRoutesOptions
): Promise<void> {
  const { authService } = options;

  /**
   * POST /api/v1/auth/login
   * 
   * Authenticate user with email and password.
   * Returns JWT access token and refresh token on success.
   * 
   * Requirements: 2.1, 2.2, 2.3
   */
  fastify.post<{ Body: LoginRequest }>(
    '/login',
    {
      preHandler: validateBody(loginSchema),
    },
    async (request: FastifyRequest<{ Body: LoginRequest }>, reply: FastifyReply) => {
      const { email, password, captchaToken } = request.body;
      const ip = request.ip || 'unknown';

      try {
        const result = await authService.login(email, password, ip, captchaToken);

        return reply.status(200).send({
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresIn: result.expiresIn,
          user: result.user,
        });
      } catch (error) {
        if (error instanceof AuthError) {
          return handleAuthError(error, reply);
        }
        throw error;
      }
    }
  );

  /**
   * POST /api/v1/auth/refresh
   * 
   * Refresh access token using a valid refresh token.
   * Returns new JWT access token and refresh token.
   * 
   * Requirement: 2.3
   */
  fastify.post<{ Body: RefreshTokenRequest }>(
    '/refresh',
    {
      preHandler: validateBody(refreshTokenSchema),
    },
    async (request: FastifyRequest<{ Body: RefreshTokenRequest }>, reply: FastifyReply) => {
      const { refreshToken } = request.body;

      try {
        const result = await authService.refresh(refreshToken);

        return reply.status(200).send({
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresIn: result.expiresIn,
          user: result.user,
        });
      } catch (error) {
        if (error instanceof AuthError) {
          return handleAuthError(error, reply);
        }
        throw error;
      }
    }
  );

  /**
   * POST /api/v1/auth/logout
   * 
   * Logout user by invalidating all refresh tokens.
   * Requires valid JWT access token.
   * 
   * Requirement: 2.3
   */
  fastify.post(
    '/logout',
    {
      preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          await request.jwtVerify();
        } catch (error) {
          return reply.status(401).send({
            error: 'UNAUTHORIZED',
            message: 'Invalid or expired token',
          });
        }
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as { userId: string };

      try {
        await authService.logout(user.userId);

        return reply.status(200).send({
          success: true,
          message: 'Logged out successfully',
        });
      } catch (error) {
        if (error instanceof AuthError) {
          return handleAuthError(error, reply);
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
 * Map AuthError codes to HTTP responses
 * Requirement 2.7: Safe error responses without leaking token details
 */
function handleAuthError(error: AuthError, reply: FastifyReply): FastifyReply {
  switch (error.code) {
    case 'INVALID_CREDENTIALS':
      return reply.status(401).send({
        error: 'UNAUTHORIZED',
        message: 'Invalid email or password',
      });

    case 'ACCOUNT_LOCKED':
      return reply.status(403).send({
        error: 'FORBIDDEN',
        message: 'Account is temporarily locked. Please try again later.',
      });

    case 'INVALID_TOKEN':
    case 'TOKEN_EXPIRED':
      return reply.status(401).send({
        error: 'UNAUTHORIZED',
        message: 'Invalid or expired token',
      });

    case 'USER_NOT_FOUND':
      return reply.status(401).send({
        error: 'UNAUTHORIZED',
        message: 'Invalid or expired token',
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

export default authRoutes;
