import {
  GENERATED_ADMIN_PASSWORD_LENGTH,
  LEGACY_DEFAULT_ADMIN_PASSWORD,
  generateAdminPassword,
  hashAdminPassword,
  isLegacyDefaultAdminPassword,
  verifyAdminPassword,
} from '../admin-password';

describe('admin password helpers', () => {
  it('generates random passwords of the expected length and alphabet', () => {
    const a = generateAdminPassword();
    const b = generateAdminPassword();
    expect(a).toHaveLength(GENERATED_ADMIN_PASSWORD_LENGTH);
    expect(a).toMatch(/^[A-HJ-NP-Za-km-z2-9]+$/);
    expect(a).not.toEqual(b);
  });

  it('never generates the legacy default password', () => {
    for (let i = 0; i < 50; i++) {
      expect(isLegacyDefaultAdminPassword(generateAdminPassword())).toBe(false);
    }
  });

  it('refuses to generate short passwords', () => {
    expect(() => generateAdminPassword(8)).toThrow();
  });

  it('hashes with a random salt and verifies only the right password', () => {
    const password = generateAdminPassword();
    const first = hashAdminPassword(password);
    const second = hashAdminPassword(password);
    expect(first).toMatch(/^[0-9a-f]{32}:[0-9a-f]{64}$/);
    expect(first).not.toEqual(second);
    expect(verifyAdminPassword(password, first)).toBe(true);
    expect(verifyAdminPassword(password, second)).toBe(true);
    expect(verifyAdminPassword(`${password}x`, first)).toBe(false);
    expect(verifyAdminPassword(LEGACY_DEFAULT_ADMIN_PASSWORD, first)).toBe(false);
  });

  it('rejects empty passwords and malformed stored hashes', () => {
    expect(() => hashAdminPassword('')).toThrow();
    expect(verifyAdminPassword('anything', 'not-a-hash')).toBe(false);
    expect(verifyAdminPassword('anything', '')).toBe(false);
  });

  it('recognises only the exact legacy default password', () => {
    expect(isLegacyDefaultAdminPassword(LEGACY_DEFAULT_ADMIN_PASSWORD)).toBe(true);
    expect(isLegacyDefaultAdminPassword('Admin123')).toBe(false);
    expect(isLegacyDefaultAdminPassword('')).toBe(false);
    expect(isLegacyDefaultAdminPassword(undefined)).toBe(false);
  });
});
