/**
 * Admin password helpers for the ProduTime Admin Console.
 *
 * The Admin Console has no built-in default password. On first use a random
 * password is generated and shown once; consoles that still use the fixed
 * first-run password of older versions are moved to a random password on
 * their next successful login.
 */
import * as crypto from 'crypto';

// Fixed first-run password used by older Admin Console versions. Kept only so
// that consoles still using it can be detected and rotated; it is never stored.
export const LEGACY_DEFAULT_ADMIN_PASSWORD = 'admin123';

// No look-alike characters (0/O, 1/l/I) so the password is easy to copy by hand.
const PASSWORD_ALPHABET = [
  'ABCDEFGHJKLMNPQRSTUVWXYZ', // upper case without I and O
  'abcdefghijkmnopqrstuvwxyz', // lower case without l
  '23456789', // digits without 0 and 1
].join('');

export const GENERATED_ADMIN_PASSWORD_LENGTH = 16;

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

export function isLegacyDefaultAdminPassword(
  password: string | null | undefined
): boolean {
  return password === LEGACY_DEFAULT_ADMIN_PASSWORD;
}
