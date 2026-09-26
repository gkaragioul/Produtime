/**
 * Admin password configuration for the ProduTime web admin console.
 *
 * The server has no built-in default password: it refuses to start unless the
 * ADMIN_PASSWORD environment variable is set.
 */

// Fixed fallback used by older versions of this server. Rejected so that a
// deployment cannot keep running with the publicly known value.
const LEGACY_DEFAULT_ADMIN_PASSWORD = 'admin123';

export const MIN_ADMIN_PASSWORD_LENGTH = 12;

export function requireAdminPassword(env: NodeJS.ProcessEnv = process.env): string {
  const password = env.ADMIN_PASSWORD;
  if (!password || !password.trim()) {
    throw new Error(
      'ADMIN_PASSWORD is not set. Set the ADMIN_PASSWORD environment variable to a strong password ' +
        `(at least ${MIN_ADMIN_PASSWORD_LENGTH} characters) before starting the admin console.`
    );
  }
  if (password === LEGACY_DEFAULT_ADMIN_PASSWORD) {
    throw new Error('ADMIN_PASSWORD must not be the old default password. Choose a new, strong password.');
  }
  if (password.length < MIN_ADMIN_PASSWORD_LENGTH) {
    throw new Error(`ADMIN_PASSWORD must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters long.`);
  }
  return password;
}
