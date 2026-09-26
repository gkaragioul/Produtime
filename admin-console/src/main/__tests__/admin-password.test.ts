import {
  GENERATED_ADMIN_PASSWORD_LENGTH,
  LEGACY_DEFAULT_ADMIN_PASSWORD,
  generateAdminPassword,
  isLegacyDefaultAdminPassword,
} from '../admin-password';

describe('Admin Console admin password helpers', () => {
  it('generates distinct random passwords of the expected length and alphabet', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const password = generateAdminPassword();
      expect(password).toHaveLength(GENERATED_ADMIN_PASSWORD_LENGTH);
      expect(password).toMatch(/^[A-HJ-NP-Za-km-z2-9]+$/);
      expect(isLegacyDefaultAdminPassword(password)).toBe(false);
      seen.add(password);
    }
    expect(seen.size).toBe(50);
  });

  it('refuses to generate short passwords', () => {
    expect(() => generateAdminPassword(6)).toThrow();
  });

  it('recognises only the exact legacy default password', () => {
    expect(isLegacyDefaultAdminPassword(LEGACY_DEFAULT_ADMIN_PASSWORD)).toBe(true);
    expect(isLegacyDefaultAdminPassword(' admin123')).toBe(false);
    expect(isLegacyDefaultAdminPassword(null)).toBe(false);
  });
});
