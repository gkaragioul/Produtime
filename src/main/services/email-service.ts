import * as nodemailer from 'nodemailer';

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
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
  /**
   * Configure from database settings (preferred over env vars)
   */
  public configureFromDatabase(getSetting: (key: string) => string | null): void {
    const host = getSetting('email_smtp_host');
    const port = getSetting('email_smtp_port');
    const user = getSetting('email_smtp_user');
    const pass = getSetting('email_smtp_pass');
    const secure = getSetting('email_smtp_secure');

    if (host && user && pass) {
      this.configure({
        host,
        port: parseInt(port || '587', 10),
        secure: secure === 'true',
        auth: { user, pass },
      });
    } else {
      // Fall back to env vars
      this.configure();
    }
  }

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
   * Send a short test email so the SMTP settings can be checked.
   */
  public async sendTestEmail(recipientEmail: string): Promise<boolean> {
    if (!this.isConfigured || !this.transporter) {
      console.warn('Email service not configured. Test email not sent.');
      return false;
    }

    if (!recipientEmail || !this.isValidEmail(recipientEmail)) {
      console.warn('Invalid recipient email address. Test email not sent.');
      return false;
    }

    try {
      const info = await this.transporter.sendMail({
        from: 'TimePort <noreply@timeport.app>',
        to: recipientEmail,
        subject: 'ProduTime test email',
        text: 'This is a test email from ProduTime. Your email settings work.',
        html: '<p>This is a test email from ProduTime. Your email settings work.</p>',
      });
      console.log('Test email sent:', info.messageId);
      return true;
    } catch (error) {
      console.error('Failed to send test email:', error);
      return false;
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
