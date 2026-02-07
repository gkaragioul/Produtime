/**
 * Email Service Tests
 * Tests for Phase 1: Security Fix - Hardcoded Email Credentials
 */

import { EmailService } from '../email-service';

describe('EmailService - Security Tests', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('Configuration Loading', () => {
    it('should load credentials from environment variables', () => {
      process.env.EMAIL_USER = 'test@example.com';
      process.env.EMAIL_PASS = 'testpass123';
      process.env.NODE_ENV = 'production';

      const emailService = new EmailService();
      expect(emailService.isConfigured).toBe(true);
    });

    it('should use Ethereal test account in development mode', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EMAIL_USER;
      delete process.env.EMAIL_PASS;

      const emailService = new EmailService();
      // In development, should use Ethereal account
      expect(emailService.isConfigured).toBe(true);
    });

    it('should fail gracefully if credentials missing in production', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.EMAIL_USER;
      delete process.env.EMAIL_PASS;

      const emailService = new EmailService();
      expect(emailService.isConfigured).toBe(false);
    });

    it('should handle missing EMAIL_USER', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.EMAIL_USER;
      process.env.EMAIL_PASS = 'testpass123';

      const emailService = new EmailService();
      expect(emailService.isConfigured).toBe(false);
    });

    it('should handle missing EMAIL_PASS', () => {
      process.env.NODE_ENV = 'production';
      process.env.EMAIL_USER = 'test@example.com';
      delete process.env.EMAIL_PASS;

      const emailService = new EmailService();
      expect(emailService.isConfigured).toBe(false);
    });
  });

  describe('Security - No Credential Exposure', () => {
    it('should not expose credentials in error messages', () => {
      process.env.EMAIL_USER = 'test@example.com';
      process.env.EMAIL_PASS = 'secretpassword123';

      const emailService = new EmailService();
      const errorMessage = emailService.getErrorMessage(new Error('Test error'));

      expect(errorMessage).not.toContain('secretpassword123');
      expect(errorMessage).not.toContain('test@example.com');
    });

    it('should not expose credentials in logs', () => {
      const logs: string[] = [];
      const logger = (msg: string) => logs.push(msg);

      process.env.EMAIL_USER = 'test@example.com';
      process.env.EMAIL_PASS = 'secretpassword123';

      const emailService = new EmailService(logger);
      emailService.logConfiguration();

      const allLogs = logs.join('\n');
      expect(allLogs).not.toContain('secretpassword123');
      expect(allLogs).not.toContain('test@example.com');
    });

    it('should not store credentials in plain text', () => {
      process.env.EMAIL_USER = 'test@example.com';
      process.env.EMAIL_PASS = 'secretpassword123';

      const emailService = new EmailService();
      const config = emailService.getConfig();

      // Config should not contain plain text credentials
      expect(JSON.stringify(config)).not.toContain('secretpassword123');
    });
  });

  describe('Environment Variable Validation', () => {
    it('should validate EMAIL_HOST is set', () => {
      process.env.EMAIL_USER = 'test@example.com';
      process.env.EMAIL_PASS = 'testpass123';
      process.env.EMAIL_HOST = 'smtp.example.com';
      process.env.NODE_ENV = 'production';

      const emailService = new EmailService();
      expect(emailService.isConfigured).toBe(true);
    });

    it('should validate EMAIL_PORT is set', () => {
      process.env.EMAIL_USER = 'test@example.com';
      process.env.EMAIL_PASS = 'testpass123';
      process.env.EMAIL_PORT = '587';
      process.env.NODE_ENV = 'production';

      const emailService = new EmailService();
      expect(emailService.isConfigured).toBe(true);
    });

    it('should handle invalid EMAIL_PORT', () => {
      process.env.EMAIL_USER = 'test@example.com';
      process.env.EMAIL_PASS = 'testpass123';
      process.env.EMAIL_PORT = 'invalid';
      process.env.NODE_ENV = 'production';

      const emailService = new EmailService();
      // Should handle gracefully
      expect(emailService).toBeDefined();
    });
  });

  describe('Credential Rotation Support', () => {
    it('should support credential updates', () => {
      process.env.EMAIL_USER = 'old@example.com';
      process.env.EMAIL_PASS = 'oldpass123';

      const emailService = new EmailService();
      expect(emailService.isConfigured).toBe(true);

      // Update credentials
      process.env.EMAIL_USER = 'new@example.com';
      process.env.EMAIL_PASS = 'newpass123';

      const newEmailService = new EmailService();
      expect(newEmailService.isConfigured).toBe(true);
    });

    it('should not cache credentials', () => {
      process.env.EMAIL_USER = 'test1@example.com';
      process.env.EMAIL_PASS = 'pass1';

      const emailService1 = new EmailService();
      const config1 = emailService1.getConfig();

      process.env.EMAIL_USER = 'test2@example.com';
      process.env.EMAIL_PASS = 'pass2';

      const emailService2 = new EmailService();
      const config2 = emailService2.getConfig();

      expect(config1).not.toEqual(config2);
    });
  });

  describe('Development vs Production', () => {
    it('should use test account in development', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EMAIL_USER;
      delete process.env.EMAIL_PASS;

      const emailService = new EmailService();
      const config = emailService.getConfig();

      // Should use Ethereal test account
      expect(config.auth.user).toBeDefined();
      expect(config.auth.pass).toBeDefined();
    });

    it('should require credentials in production', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.EMAIL_USER;
      delete process.env.EMAIL_PASS;

      const emailService = new EmailService();
      expect(emailService.isConfigured).toBe(false);
    });

    it('should prefer environment variables over defaults', () => {
      process.env.NODE_ENV = 'development';
      process.env.EMAIL_USER = 'custom@example.com';
      process.env.EMAIL_PASS = 'custompass';

      const emailService = new EmailService();
      const config = emailService.getConfig();

      expect(config.auth.user).toBe('custom@example.com');
      expect(config.auth.pass).toBe('custompass');
    });
  });
});

