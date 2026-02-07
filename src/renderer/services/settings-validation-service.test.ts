import { SettingsValidationService } from './settings-validation-service';

describe('SettingsValidationService - auto export settings', () => {
  const svc = SettingsValidationService.getInstance();

  test('auto_export_time accepts valid HH:MM values', () => {
    expect(svc.validateSetting('auto_export_time', '00:00').isValid).toBe(true);
    expect(svc.validateSetting('auto_export_time', '07:45').isValid).toBe(true);
    expect(svc.validateSetting('auto_export_time', '18:00').isValid).toBe(true);
    expect(svc.validateSetting('auto_export_time', '23:59').isValid).toBe(true);
  });

  test('auto_export_time rejects invalid values', () => {
    expect(svc.validateSetting('auto_export_time', '24:00').isValid).toBe(
      false
    );
    expect(svc.validateSetting('auto_export_time', '18:60').isValid).toBe(
      false
    );
    expect(svc.validateSetting('auto_export_time', 'abc').isValid).toBe(false);
    expect(svc.validateSetting('auto_export_time', '').isValid).toBe(true); // optional
  });

  test('auto_export_enabled accepts true/false', () => {
    expect(svc.validateSetting('auto_export_enabled', 'true').isValid).toBe(
      true
    );
    expect(svc.validateSetting('auto_export_enabled', 'false').isValid).toBe(
      true
    );
    expect(svc.validateSetting('auto_export_enabled', '').isValid).toBe(true); // optional
  });

  test('auto_export_enabled rejects other values', () => {
    const res = svc.validateSetting('auto_export_enabled', 'yes');
    expect(res.isValid).toBe(false);
  });
});

// Admin alert email validation
describe('SettingsValidationService - admin alert email', () => {
  const svc = SettingsValidationService.getInstance();

  test('accepts valid emails', () => {
    expect(
      svc.validateSetting('admin_alert_email', 'admin@example.com').isValid
    ).toBe(true);
    expect(
      svc.validateSetting(
        'admin_alert_email',
        'first.last+alerts@sub.domain.co'
      ).isValid
    ).toBe(true);
    expect(svc.validateSetting('admin_alert_email', '').isValid).toBe(true); // optional
  });

  test('rejects invalid emails', () => {
    expect(
      svc.validateSetting('admin_alert_email', 'not-an-email').isValid
    ).toBe(false);
    expect(
      svc.validateSetting('admin_alert_email', 'missing-at.com').isValid
    ).toBe(false);
    expect(
      svc.validateSetting('admin_alert_email', 'user@domain').isValid
    ).toBe(false);
  });
});
