/**
 * Licensing Configuration (v1.8)
 *
 * IMPORTANT: Before deploying to production:
 * 1. Generate Ed25519 keypair using the server's keygen.ts script
 * 2. Replace ED25519_PUBLIC_KEY with your actual public key
 * 3. Deploy the server with the private key in environment variables
 * 4. Update LICENSE_SERVER_URL with your Railway deployment URL
 */

// Ed25519 Public Key for verifying license signatures
// Generated: 2026-01-09
export const ED25519_PUBLIC_KEY = process.env.ED25519_PUBLIC_KEY || "yBpM6mVTBbG9j8SmQlQFvRWlL8TfOwHuzWEO7zhHzgw=";

// License Server URL
export const LICENSE_SERVER_URL = process.env.LICENSE_SERVER_URL || "https://produtime-licensing-server-production.up.railway.app";

// Heartbeat interval (milliseconds)
export const HEARTBEAT_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours

// Grace period for offline operation (milliseconds)
export const GRACE_PERIOD_MS = 72 * 60 * 60 * 1000; // 72 hours

// Trial period (days)
export const TRIAL_PERIOD_DAYS = 7;
