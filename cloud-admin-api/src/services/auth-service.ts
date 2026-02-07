/**
 * Authentication Service
 * Handles user authentication, JWT token management, and session handling.
 * 
 * Requirements:
 * - 2.1: Email and password credentials required for login
 * - 2.2: Passwords hashed with bcrypt (12 rounds minimum)
 * - 2.3: JWT access tokens (15 min expiry) and refresh tokens (14 day expiry)
 * - 2.4: Account locking after 5 failed attempts in 15 minutes
 * - 2.5: CAPTCHA verification when CAPTCHA_ENABLED is true
 * - 2.7: Safe error responses without leaking token details
 */

import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { config } from '../config';

// ============================================================================
// Types
// ============================================================================

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: string;
    email: string;
    tenantId: string;
    tenantName: string;
  };
}

export interface TokenPayload {
  userId: string;
  tenantId: string;
  email: string;
  iat: number;
  exp: number;
}

export interface AdminUser {
  id: string;
  tenantId: string;
  email: string;
  passwordHash: string;
  lockedUntil: Date | null;
  failedAttempts: number;
  tenant?: {
    id: string;
    name: string;
  };
}

export interface Session {
  id: string;
  userId: string;
  tenantId: string;
  refreshToken: string;
  expiresAt: Date;
}

// ============================================================================
// Database Interface (to be injected)
// ============================================================================

export interface AuthDatabase {
  findAdminByEmail(email: string): Promise<AdminUser | null>;
  findAdminById(userId: string): Promise<AdminUser | null>;
  updateAdminLoginSuccess(userId: string): Promise<void>;
  updateAdminFailedAttempt(userId: string, failedAttempts: number, lockedUntil: Date | null): Promise<void>;
  createSession(session: Omit<Session, 'id'>): Promise<Session>;
  findSessionByRefreshToken(refreshToken: string): Promise<Session | null>;
  deleteSession(sessionId: string): Promise<void>;
  deleteSessionsByUserId(userId: string): Promise<void>;
  recordFailedLogin(email: string, ip: string): Promise<void>;
  countRecentFailedLogins(email: string, sinceMinutes: number): Promise<number>;
}

// ============================================================================
// JWT Interface (to be injected from Fastify)
// ============================================================================

export interface JwtSigner {
  sign(payload: object, options?: { expiresIn: string | number }): string;
  verify(token: string): TokenPayload;
}

// ============================================================================
// CAPTCHA Interface
// ============================================================================

export interface CaptchaVerifier {
  verify(token: string): Promise<boolean>;
}

// ============================================================================
// Constants
// ============================================================================

const BCRYPT_ROUNDS = config.bcryptRounds;
const ACCESS_TOKEN_EXPIRY_SECONDS = 15 * 60; // 15 minutes
const REFRESH_TOKEN_EXPIRY_DAYS = 14;
const ACCOUNT_LOCK_THRESHOLD = 5;
const ACCOUNT_LOCK_WINDOW_MINUTES = 15;
const ACCOUNT_LOCK_DURATION_MINUTES = 30;

// ============================================================================
// Auth Service Class
// ============================================================================

export class AuthService {
  constructor(
    private db: AuthDatabase,
    private jwt: JwtSigner,
    private captchaVerifier?: CaptchaVerifier
  ) {}

  /**
   * Authenticate user with email and password
   * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5
   */
  async login(
    email: string,
    password: string,
    ip: string,
    captchaToken?: string
  ): Promise<AuthResult> {
    // Requirement 2.5: CAPTCHA verification when enabled
    if (config.captchaEnabled) {
      if (!captchaToken) {
        throw new AuthError('CAPTCHA_REQUIRED', 'CAPTCHA verification required');
      }
      if (this.captchaVerifier) {
        const captchaValid = await this.captchaVerifier.verify(captchaToken);
        if (!captchaValid) {
          throw new AuthError('CAPTCHA_INVALID', 'CAPTCHA verification failed');
        }
      }
    }

    // Requirement 2.1: Find user by email
    const user = await this.db.findAdminByEmail(email);
    
    // Use constant-time comparison to prevent timing attacks
    if (!user) {
      // Record failed attempt even for non-existent users (prevents enumeration)
      await this.db.recordFailedLogin(email, ip);
      // Perform dummy bcrypt compare to maintain constant timing
      await bcrypt.compare(password, '$2b$12$dummy.hash.for.timing.attack.prevention');
      throw new AuthError('INVALID_CREDENTIALS', 'Invalid email or password');
    }

    // Requirement 2.4: Check if account is locked
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AuthError('ACCOUNT_LOCKED', 'Account is temporarily locked');
    }

    // Requirement 2.2: Verify password with bcrypt
    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    
    if (!passwordValid) {
      await this.handleFailedLogin(user, email, ip);
      throw new AuthError('INVALID_CREDENTIALS', 'Invalid email or password');
    }

    // Reset failed attempts on successful login
    await this.db.updateAdminLoginSuccess(user.id);

    // Requirement 2.3: Generate tokens
    const tokens = await this.generateTokens(user);

    return tokens;
  }

  /**
   * Refresh access token using refresh token
   * Requirement 2.3
   */
  async refresh(refreshToken: string): Promise<AuthResult> {
    const session = await this.db.findSessionByRefreshToken(refreshToken);
    
    if (!session) {
      throw new AuthError('INVALID_TOKEN', 'Invalid refresh token');
    }

    if (session.expiresAt < new Date()) {
      await this.db.deleteSession(session.id);
      throw new AuthError('TOKEN_EXPIRED', 'Refresh token has expired');
    }

    const user = await this.db.findAdminById(session.userId);
    
    if (!user) {
      await this.db.deleteSession(session.id);
      throw new AuthError('USER_NOT_FOUND', 'User not found');
    }

    // Delete old session
    await this.db.deleteSession(session.id);

    // Generate new tokens
    return this.generateTokens(user);
  }

  /**
   * Logout user by invalidating refresh token
   * Requirement 2.3
   */
  async logout(userId: string): Promise<void> {
    await this.db.deleteSessionsByUserId(userId);
  }

  /**
   * Validate JWT access token
   * Requirement 2.7: Safe error responses
   */
  validateToken(token: string): TokenPayload {
    try {
      return this.jwt.verify(token);
    } catch (error) {
      // Requirement 2.7: Don't leak token details in error
      throw new AuthError('INVALID_TOKEN', 'Invalid or expired token');
    }
  }

  /**
   * Check if account is currently locked
   * Requirement 2.4
   */
  async checkAccountLock(email: string): Promise<boolean> {
    const user = await this.db.findAdminByEmail(email);
    if (!user) return false;
    return user.lockedUntil !== null && user.lockedUntil > new Date();
  }

  /**
   * Hash a password using bcrypt
   * Requirement 2.2: Minimum 12 rounds
   */
  static async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
  }

  /**
   * Verify a password against a hash
   * Requirement 2.2
   */
  static async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Get bcrypt rounds from a hash
   * Useful for property testing
   */
  static getBcryptRounds(hash: string): number {
    const match = hash.match(/^\$2[aby]?\$(\d+)\$/);
    return match ? parseInt(match[1], 10) : 0;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Handle failed login attempt
   * Requirement 2.4: Lock after 5 failures in 15 minutes
   */
  private async handleFailedLogin(user: AdminUser, email: string, ip: string): Promise<void> {
    await this.db.recordFailedLogin(email, ip);
    
    const recentFailures = await this.db.countRecentFailedLogins(
      email,
      ACCOUNT_LOCK_WINDOW_MINUTES
    );

    if (recentFailures >= ACCOUNT_LOCK_THRESHOLD) {
      // Lock account for 30 minutes
      const lockedUntil = new Date(Date.now() + ACCOUNT_LOCK_DURATION_MINUTES * 60 * 1000);
      await this.db.updateAdminFailedAttempt(user.id, recentFailures, lockedUntil);
    } else {
      await this.db.updateAdminFailedAttempt(user.id, recentFailures, null);
    }
  }

  /**
   * Generate access and refresh tokens
   * Requirement 2.3: 15 min access, 14 day refresh
   */
  private async generateTokens(user: AdminUser): Promise<AuthResult> {
    const tenantName = user.tenant?.name || 'Unknown';

    // Generate access token (15 minutes)
    const accessToken = this.jwt.sign(
      {
        userId: user.id,
        tenantId: user.tenantId,
        email: user.email,
      },
      { expiresIn: ACCESS_TOKEN_EXPIRY_SECONDS }
    );

    // Generate refresh token (random bytes, stored in DB)
    const refreshToken = randomBytes(32).toString('hex');
    const refreshExpiresAt = new Date(
      Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000
    );

    // Store refresh token in database
    await this.db.createSession({
      userId: user.id,
      tenantId: user.tenantId,
      refreshToken,
      expiresAt: refreshExpiresAt,
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TOKEN_EXPIRY_SECONDS,
      user: {
        id: user.id,
        email: user.email,
        tenantId: user.tenantId,
        tenantName,
      },
    };
  }
}

// ============================================================================
// Auth Error Class
// ============================================================================

export type AuthErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_LOCKED'
  | 'INVALID_TOKEN'
  | 'TOKEN_EXPIRED'
  | 'USER_NOT_FOUND'
  | 'CAPTCHA_REQUIRED'
  | 'CAPTCHA_INVALID';

export class AuthError extends Error {
  constructor(
    public code: AuthErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

// ============================================================================
// Exports for testing
// ============================================================================

export const AUTH_CONSTANTS = {
  BCRYPT_ROUNDS,
  ACCESS_TOKEN_EXPIRY_SECONDS,
  REFRESH_TOKEN_EXPIRY_DAYS,
  ACCOUNT_LOCK_THRESHOLD,
  ACCOUNT_LOCK_WINDOW_MINUTES,
  ACCOUNT_LOCK_DURATION_MINUTES,
};
