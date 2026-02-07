import * as nodemailer from 'nodemailer';
import { AdminLockoutState } from '../../shared/types';

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

export interface SecurityAlert {
  type: 'lockout' | 'failed_attempts' | 'unlock';
  timestamp: string;
  employeeName?: string;
  details: {
    failedAttempts: number;
    maxAttempts: number;
    lockoutDuration?: string;
    ipAddress?: string;
  };
}

export class EmailService {
  private static instance: EmailService;
  private transporter: nodemailer.Transporter | null = null;
  public isConfigured: boolean = false;
  private logger?: (msg: string) => void;

  constructor(logger?: (msg: string) => void) {
    this.logger = logger;
    this.configure();
  }

  public static getInstance(): EmailService {
    if (!EmailService.instance) {
      EmailService.instance = new EmailService();
    }
    return EmailService.instance;
  }

  /**
   * Configure email service with SMTP settings
   * Credentials are loaded from environment variables for security
   * Environment variables required:
   * - EMAIL_HOST: SMTP host (default: smtp.gmail.com)
   * - EMAIL_PORT: SMTP port (default: 587)
   * - EMAIL_SECURE: Use TLS (default: false)
   * - EMAIL_USER: Email account username
   * - EMAIL_PASS: Email account password or app password
   */
  public configure(config?: EmailConfig): void {
    try {
      // Load configuration from environment variables or use provided config
      const defaultConfig: EmailConfig = {
        host: process.env.EMAIL_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.EMAIL_PORT || '587', 10),
        secure: process.env.EMAIL_SECURE === 'true' || false,
        auth: {
          user: process.env.EMAIL_USER || '',
          pass: process.env.EMAIL_PASS || '',
        },
      };

      const emailConfig = config || defaultConfig;

      // Validate that credentials are provided
      if (!emailConfig.auth.user || !emailConfig.auth.pass) {
        if (process.env.NODE_ENV === 'development') {
          console.warn(
            'Email credentials not provided. Using Ethereal test account for development.'
          );
          // For development/testing, use a test account
          this.transporter = nodemailer.createTransport({
            host: 'smtp.ethereal.email',
            port: 587,
            secure: false,
            auth: {
              user: 'ethereal.user@ethereal.email',
              pass: 'ethereal.pass',
            },
          });
        } else {
          console.error(
            'Email credentials not configured. Set EMAIL_USER and EMAIL_PASS environment variables.'
          );
          this.isConfigured = false;
          return;
        }
      } else {
        this.transporter = nodemailer.createTransport({
          host: emailConfig.host,
          port: emailConfig.port,
          secure: emailConfig.secure,
          auth: emailConfig.auth,
        });
      }

      this.isConfigured = true;
      console.log('Email service configured successfully');
    } catch (error) {
      console.error('Failed to configure email service:', error);
      this.isConfigured = false;
    }
  }

  /**
   * Send security alert email
   */
  public async sendSecurityAlert(
    recipientEmail: string,
    alert: SecurityAlert
  ): Promise<boolean> {
    if (!this.isConfigured || !this.transporter) {
      console.warn('Email service not configured. Security alert not sent.');
      return false;
    }

    if (!recipientEmail || !this.isValidEmail(recipientEmail)) {
      console.warn('Invalid recipient email address. Security alert not sent.');
      return false;
    }

    try {
      const { subject, htmlBody, textBody } = this.generateAlertContent(alert);

      const mailOptions = {
        from: '"TimePort Security" <noreply@timeport.app>',
        to: recipientEmail,
        subject: subject,
        text: textBody,
        html: htmlBody,
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log('Security alert email sent:', info.messageId);

      // Log preview URL for development
      if (process.env.NODE_ENV === 'development') {
        console.log('Preview URL:', nodemailer.getTestMessageUrl(info));
      }

      return true;
    } catch (error) {
      console.error('Failed to send security alert email:', error);
      return false;
    }
  }

  /**
   * Generate email content based on alert type
   */
  private generateAlertContent(alert: SecurityAlert): {
    subject: string;
    htmlBody: string;
    textBody: string;
  } {
    const timestamp = new Date(alert.timestamp).toLocaleString();

    switch (alert.type) {
      case 'lockout':
        return {
          subject: `🔒 TimePort Security Alert: Admin Account Locked${alert.employeeName ? ` - ${alert.employeeName}` : ''}`,
          htmlBody: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #dc3545; color: white; padding: 20px; text-align: center;">
                <h1 style="margin: 0;">🔒 Security Alert</h1>
              </div>
              <div style="padding: 20px; background-color: #f8f9fa;">
                <h2 style="color: #dc3545;">Admin Account Locked</h2>
                ${alert.employeeName ? `<p><strong>Employee:</strong> ${alert.employeeName}</p>` : ''}
                <p><strong>Time:</strong> ${timestamp}</p>
                <p><strong>Reason:</strong> Too many failed login attempts</p>
                <p><strong>Failed Attempts:</strong> ${alert.details.failedAttempts}/${alert.details.maxAttempts}</p>
                ${alert.details.lockoutDuration ? `<p><strong>Lockout Duration:</strong> ${alert.details.lockoutDuration}</p>` : ''}
                ${alert.details.ipAddress ? `<p><strong>IP Address:</strong> ${alert.details.ipAddress}</p>` : '<p><strong>IP Address:</strong> Not available</p>'}

                <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; margin: 20px 0; border-radius: 5px;">
                  <h3 style="color: #856404; margin-top: 0;">What to do:</h3>
                  <ul style="color: #856404;">
                    <li>If this was you, wait for the lockout period to expire</li>
                    <li>If this was not you, investigate potential security breach</li>
                    <li>Consider changing the admin password</li>
                    <li>Review system access logs</li>
                  </ul>
                </div>

                <p style="font-size: 12px; color: #6c757d; margin-top: 30px;">
                  This is an automated security alert from TimePort. Do not reply to this email.
                </p>
              </div>
            </div>
          `,
          textBody: `
TIMEPORT SECURITY ALERT: Admin Account Locked${alert.employeeName ? ` - ${alert.employeeName}` : ''}

${alert.employeeName ? `Employee: ${alert.employeeName}\n` : ''}Time: ${timestamp}
Reason: Too many failed login attempts
Failed Attempts: ${alert.details.failedAttempts}/${alert.details.maxAttempts}
${alert.details.lockoutDuration ? `Lockout Duration: ${alert.details.lockoutDuration}\n` : ''}${alert.details.ipAddress ? `IP Address: ${alert.details.ipAddress}` : 'IP Address: Not available'}

What to do:
- If this was you, wait for the lockout period to expire
- If this was not you, investigate potential security breach
- Consider changing the admin password
- Review system access logs

This is an automated security alert from TimePort.
          `,
        };

      case 'failed_attempts':
        return {
          subject: `⚠️ TimePort Security Alert: Failed Login Attempts${alert.employeeName ? ` - ${alert.employeeName}` : ''}`,
          htmlBody: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #ffc107; color: #212529; padding: 20px; text-align: center;">
                <h1 style="margin: 0;">⚠️ Security Alert</h1>
              </div>
              <div style="padding: 20px; background-color: #f8f9fa;">
                <h2 style="color: #ffc107;">Failed Login Attempts Detected</h2>
                ${alert.employeeName ? `<p><strong>Employee:</strong> ${alert.employeeName}</p>` : ''}
                <p><strong>Time:</strong> ${timestamp}</p>
                <p><strong>Failed Attempts:</strong> ${alert.details.failedAttempts}/${alert.details.maxAttempts}</p>
                ${alert.details.ipAddress ? `<p><strong>IP Address:</strong> ${alert.details.ipAddress}</p>` : '<p><strong>IP Address:</strong> Not available</p>'}

                <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; margin: 20px 0; border-radius: 5px;">
                  <p style="color: #856404; margin: 0;">
                    <strong>Notice:</strong> Failed admin login attempts were detected${alert.employeeName ? ` for employee ${alert.employeeName}` : ''}. Review access logs and consider changing the admin password if this was not authorized.
                  </p>
                </div>

                <p style="font-size: 12px; color: #6c757d; margin-top: 30px;">
                  This is an automated security alert from TimePort. Do not reply to this email.
                </p>
              </div>
            </div>
          `,
          textBody: `
TIMEPORT SECURITY ALERT: Failed Login Attempts${alert.employeeName ? ` - ${alert.employeeName}` : ''}

${alert.employeeName ? `Employee: ${alert.employeeName}\n` : ''}Time: ${timestamp}
Failed Attempts: ${alert.details.failedAttempts}/${alert.details.maxAttempts}
${alert.details.ipAddress ? `IP Address: ${alert.details.ipAddress}` : 'IP Address: Not available'}

Notice: Failed admin login attempts were detected${alert.employeeName ? ` for employee ${alert.employeeName}` : ''}. Review access logs and consider changing the admin password if this was not authorized.

This is an automated security alert from TimePort.
          `,
        };

      case 'unlock':
        return {
          subject: '✅ TimePort Security Alert: Admin Account Unlocked',
          htmlBody: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #28a745; color: white; padding: 20px; text-align: center;">
                <h1 style="margin: 0;">✅ Security Alert</h1>
              </div>
              <div style="padding: 20px; background-color: #f8f9fa;">
                <h2 style="color: #28a745;">Admin Account Unlocked</h2>
                <p><strong>Time:</strong> ${timestamp}</p>
                <p>The admin account lockout has expired and the account is now accessible again.</p>

                <p style="font-size: 12px; color: #6c757d; margin-top: 30px;">
                  This is an automated security alert from TimePort. Do not reply to this email.
                </p>
              </div>
            </div>
          `,
          textBody: `
TIMEPORT SECURITY ALERT: Admin Account Unlocked

Time: ${timestamp}
The admin account lockout has expired and the account is now accessible again.

This is an automated security alert from TimePort.
          `,
        };

      default:
        return {
          subject: 'TimePort Security Alert',
          htmlBody: '<p>Unknown security alert type.</p>',
          textBody: 'Unknown security alert type.',
        };
    }
  }

  /**
   * Validate email address format
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Test email configuration
   */
  public async testConfiguration(): Promise<boolean> {
    if (!this.isConfigured || !this.transporter) {
      return false;
    }

    try {
      await this.transporter.verify();
      return true;
    } catch (error) {
      console.error('Email configuration test failed:', error);
      return false;
    }
  }

  /**
   * Check if email service is ready to send emails
   */
  public isReady(): boolean {
    return this.isConfigured && this.transporter !== null;
  }
  /**
   * Send notification email for automatic report failures
   */
  public async sendReportFailure(
    recipientEmail: string,
    args: { timestamp: string; errorMessage: string; retries: number }
  ): Promise<boolean> {
    if (!this.isConfigured || !this.transporter) {
      console.warn(
        'Email service not configured. Report failure alert not sent.'
      );
      return false;
    }
    if (!recipientEmail || !this.isValidEmail(recipientEmail)) {
      console.warn(
        'Invalid recipient email address. Report failure alert not sent.'
      );
      return false;
    }

    try {
      const timestamp = new Date(args.timestamp).toLocaleString();
      const subject = '⚠️ TimePort: Automatic Report Generation Failed';
      const textBody = `
TimePort Automatic Report Generation Failed

Time: ${timestamp}
Retries attempted: ${args.retries}
Error: ${args.errorMessage}

This is an automated notification from TimePort.`.trim();
      const htmlBody = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #ffc107; color: #212529; padding: 16px; text-align: center;">
            <h2 style="margin: 0;">⚠️ Automatic Report Generation Failed</h2>
          </div>
          <div style="padding: 16px; background-color: #f8f9fa;">
            <p><strong>Time:</strong> ${timestamp}</p>
            <p><strong>Retries attempted:</strong> ${args.retries}</p>
            <div style="background: #fff; border: 1px solid #eee; padding: 12px; border-radius: 6px;">
              <p style="margin: 0;"><strong>Error:</strong></p>
              <pre style="white-space: pre-wrap; margin: 8px 0 0;">${this.escapeHtml(args.errorMessage)}</pre>
            </div>
            <p style="font-size: 12px; color: #6c757d; margin-top: 20px;">This is an automated notification from TimePort.</p>
          </div>
        </div>
      `;

      const info = await this.transporter.sendMail({
        from: 'TimePort <noreply@timeport.app>',
        to: recipientEmail,
        subject,
        text: textBody,
        html: htmlBody,
      });
      console.log('Report failure email sent:', info.messageId);
      return true;
    } catch (error) {
      console.error('Failed to send report failure email:', error);
      return false;
    }
  }

  private escapeHtml(input: string): string {
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Get error message without exposing credentials
   */
  public getErrorMessage(error: Error): string {
    const message = error.message || 'Unknown error';
    // Remove any potential credential exposure
    return message
      .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[email]')
      .replace(/password|pass|secret|token|key/gi, '[redacted]');
  }

  /**
   * Log configuration without exposing credentials
   */
  public logConfiguration(): void {
    const config = this.getConfig();
    const safeConfig = {
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.auth.user ? '[configured]' : '[not configured]',
        pass: config.auth.pass ? '[configured]' : '[not configured]',
      },
    };
    const message = `Email Configuration: ${JSON.stringify(safeConfig)}`;
    if (this.logger) {
      this.logger(message);
    } else {
      console.log(message);
    }
  }

  /**
   * Get current email configuration
   */
  public getConfig(): EmailConfig {
    const host = process.env.EMAIL_HOST || 'smtp.gmail.com';
    const port = parseInt(process.env.EMAIL_PORT || '587', 10);
    const secure = process.env.EMAIL_SECURE === 'true' || false;

    const user = process.env.EMAIL_USER || '';
    const passRaw = process.env.EMAIL_PASS || '';

    // In test environments, avoid returning plaintext credentials to prevent exposure in snapshots/logs
    const envMode = process.env.NODE_ENV || 'test';
    const pass =
      envMode === 'development' ? passRaw : passRaw ? '***REDACTED***' : '';

    return {
      host,
      port,
      secure,
      auth: {
        user,
        pass,
      },
    };
  }
}

export default EmailService;
