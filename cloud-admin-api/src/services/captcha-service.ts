/**
 * CAPTCHA Verification Service
 * Supports Cloudflare Turnstile and Google reCAPTCHA v3.
 * 
 * Requirements:
 * - 2.5: CAPTCHA verification when CAPTCHA_ENABLED is true
 * - 3.5: CAPTCHA verification on pairing when CAPTCHA_ENABLED is true
 */

import { config } from '../config';

// ============================================================================
// Types
// ============================================================================

export interface CaptchaVerifier {
  verify(token: string, ip?: string): Promise<boolean>;
}

interface TurnstileResponse {
  success: boolean;
  'error-codes'?: string[];
  challenge_ts?: string;
  hostname?: string;
}

interface RecaptchaResponse {
  success: boolean;
  score?: number;
  action?: string;
  challenge_ts?: string;
  hostname?: string;
  'error-codes'?: string[];
}

// ============================================================================
// Cloudflare Turnstile Verifier
// ============================================================================

export class TurnstileVerifier implements CaptchaVerifier {
  private secretKey: string;
  private verifyUrl = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

  constructor(secretKey?: string) {
    this.secretKey = secretKey || config.captchaSecret;
  }

  async verify(token: string, ip?: string): Promise<boolean> {
    if (!this.secretKey) {
      console.warn('CAPTCHA secret key not configured');
      return false;
    }

    try {
      const formData = new URLSearchParams();
      formData.append('secret', this.secretKey);
      formData.append('response', token);
      if (ip) {
        formData.append('remoteip', ip);
      }

      const response = await fetch(this.verifyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      });

      if (!response.ok) {
        console.error('Turnstile verification request failed:', response.status);
        return false;
      }

      const result: TurnstileResponse = await response.json();
      return result.success === true;
    } catch (error) {
      console.error('Turnstile verification error:', error);
      return false;
    }
  }
}

// ============================================================================
// Google reCAPTCHA v3 Verifier
// ============================================================================

export class RecaptchaVerifier implements CaptchaVerifier {
  private secretKey: string;
  private verifyUrl = 'https://www.google.com/recaptcha/api/siteverify';
  private minScore: number;

  constructor(secretKey?: string, minScore = 0.5) {
    this.secretKey = secretKey || config.captchaSecret;
    this.minScore = minScore;
  }

  async verify(token: string, ip?: string): Promise<boolean> {
    if (!this.secretKey) {
      console.warn('CAPTCHA secret key not configured');
      return false;
    }

    try {
      const formData = new URLSearchParams();
      formData.append('secret', this.secretKey);
      formData.append('response', token);
      if (ip) {
        formData.append('remoteip', ip);
      }

      const response = await fetch(this.verifyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      });

      if (!response.ok) {
        console.error('reCAPTCHA verification request failed:', response.status);
        return false;
      }

      const result: RecaptchaResponse = await response.json();
      
      // reCAPTCHA v3 returns a score between 0.0 and 1.0
      // Higher scores indicate more likely human interaction
      if (!result.success) {
        return false;
      }

      // If score is provided (v3), check against minimum threshold
      if (result.score !== undefined) {
        return result.score >= this.minScore;
      }

      return result.success;
    } catch (error) {
      console.error('reCAPTCHA verification error:', error);
      return false;
    }
  }
}

// ============================================================================
// No-Op Verifier (for testing or when CAPTCHA is disabled)
// ============================================================================

export class NoOpCaptchaVerifier implements CaptchaVerifier {
  async verify(_token: string): Promise<boolean> {
    return true;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export type CaptchaProvider = 'turnstile' | 'recaptcha' | 'none';

export function createCaptchaVerifier(provider?: CaptchaProvider): CaptchaVerifier {
  const captchaProvider = provider || (process.env.CAPTCHA_PROVIDER as CaptchaProvider) || 'turnstile';

  if (!config.captchaEnabled) {
    return new NoOpCaptchaVerifier();
  }

  switch (captchaProvider) {
    case 'turnstile':
      return new TurnstileVerifier();
    case 'recaptcha':
      return new RecaptchaVerifier();
    case 'none':
      return new NoOpCaptchaVerifier();
    default:
      return new TurnstileVerifier();
  }
}

// ============================================================================
// Exports
// ============================================================================

export { config };
