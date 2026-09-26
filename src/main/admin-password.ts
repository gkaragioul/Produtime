/**
 * Admin password helpers for the ProduTime desktop app.
 *
 * ProduTime has no built-in default admin password. On first use a random
 * password is generated, stored only as a salted scrypt hash, and shown once
 * to the person at the machine. Installs that still use the fixed first-run
 * password of older versions are moved to a random password on their next
 * successful admin login.
 */
import * as crypto from 'crypto';

// Fixed first-run password used by ProduTime up to v1.1.27. Kept only so that
// installs still using it can be detected and rotated; it is never stored.
export const LEGACY_DEFAULT_ADMIN_PASSWORD = 'admin123';

// No look-alike characters (0/O, 1/l/I) so the password is easy to copy by hand.
const PASSWORD_ALPHABET = [
  'ABCDEFGHJKLMNPQRSTUVWXYZ', // upper case without I and O
  'abcdefghijkmnopqrstuvwxyz', // lower case without l
  '23456789', // digits without 0 and 1
].join('');

export const GENERATED_ADMIN_PASSWORD_LENGTH = 16;

// Matches the stored format used by the admin login handler: "<salt hex>:<scrypt(32) hex>".
const SCRYPT_KEY_LENGTH = 32;

export function generateAdminPassword(
  length: number = GENERATED_ADMIN_PASSWORD_LENGTH
): string {
  if (!Number.isInteger(length) || length < 12) {
    throw new Error('Generated admin passwords must be at least 12 characters');
  }
  let password = '';
  for (let i = 0; i < length; i++) {
    password += PASSWORD_ALPHABET[crypto.randomInt(PASSWORD_ALPHABET.length)];
  }
  return password;
}

export function hashAdminPassword(password: string): string {
  if (!password) {
    throw new Error('Admin password must not be empty');
  }
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, SCRYPT_KEY_LENGTH);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

export function verifyAdminPassword(password: string, stored: string): boolean {
  const parts = String(stored || '').split(':');
  if (parts.length !== 2) return false;
  const salt = Buffer.from(parts[0], 'hex');
  const expected = Buffer.from(parts[1], 'hex');
  const actual = crypto.scryptSync(password || '', salt, SCRYPT_KEY_LENGTH);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function isLegacyDefaultAdminPassword(
  password: string | null | undefined
): boolean {
  return password === LEGACY_DEFAULT_ADMIN_PASSWORD;
}
