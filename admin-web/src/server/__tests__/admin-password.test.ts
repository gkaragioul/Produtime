import { MIN_ADMIN_PASSWORD_LENGTH, requireAdminPassword } from '../admin-password';

describe('requireAdminPassword', () => {
  it('refuses to start when ADMIN_PASSWORD is missing or blank', () => {
    expect(() => requireAdminPassword({})).toThrow(/ADMIN_PASSWORD is not set/);
    expect(() => requireAdminPassword({ ADMIN_PASSWORD: '' })).toThrow(/ADMIN_PASSWORD is not set/);
    expect(() => requireAdminPassword({ ADMIN_PASSWORD: '   ' })).toThrow(/ADMIN_PASSWORD is not set/);
  });

  it('refuses the old built-in default', () => {
    expect(() => requireAdminPassword({ ADMIN_PASSWORD: 'admin123' })).toThrow(/old default/);
  });

  it('refuses passwords shorter than the minimum length', () => {
    const short = 'x'.repeat(MIN_ADMIN_PASSWORD_LENGTH - 1);
    expect(() => requireAdminPassword({ ADMIN_PASSWORD: short })).toThrow(/at least/);
  });

  it('returns the configured password when it is acceptable', () => {
    const password = 'correct horse battery staple';
    expect(requireAdminPassword({ ADMIN_PASSWORD: password })).toBe(password);
  });
});
