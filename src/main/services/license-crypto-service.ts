import * as nacl from 'tweetnacl';
import { LicensePayload, SignedLicense } from '../../shared/types';

/**
 * Service for cryptographic operations related to license management
 * Uses Ed25519 signatures for license verification
 */
export class LicenseCryptoService {
  private static instance: LicenseCryptoService;

  private constructor() {}

  public static getInstance(): LicenseCryptoService {
    if (!LicenseCryptoService.instance) {
      LicenseCryptoService.instance = new LicenseCryptoService();
    }
    return LicenseCryptoService.instance;
  }

  private decodeBase64Flexible(input: string): Uint8Array {
    // Try strict base64 first
    try {
      return new Uint8Array(Buffer.from(input, 'base64'));
    } catch (err) {
      // Intentional fallback - try next format
    }

    // Try base64url by normalizing to base64 and adding padding
    try {
      let s = input.replace(/-/g, '+').replace(/_/g, '/');
      const pad = s.length % 4;
      if (pad) s += '='.repeat(4 - pad);
      return new Uint8Array(Buffer.from(s, 'base64'));
    } catch (err) {
      // Intentional fallback - try next format
    }

    // As a last attempt (Node 16+), try explicit base64url
    try {
      // @ts-ignore Node may support 'base64url' encoding
      return new Uint8Array(Buffer.from(input, 'base64url'));
    } catch (err) {
      // All formats failed - will throw error below
    }

    throw new Error('Invalid base64/base64url input');
  }

  /**
   * Generate a new Ed25519 key pair for signing licenses
   * This should only be done once by the vendor and the private key kept secure
   * @returns Base64-encoded public and private keys
   */
  public generateKeyPair(): { publicKey: string; privateKey: string } {
    const keyPair = nacl.sign.keyPair();

    return {
      publicKey: Buffer.from(keyPair.publicKey).toString('base64'),
      privateKey: Buffer.from(keyPair.secretKey).toString('base64'),
    };
  }

  /**
   * Sign a license payload with the vendor's private key
   * @param payload License payload to sign
   * @param privateKeyBase64 Base64-encoded Ed25519 private key
   * @returns Signed license with payload and signature
   */
  public signLicense(
    payload: LicensePayload,
    privateKeyBase64: string
  ): SignedLicense {
    try {
      // Serialize payload to canonical JSON
      const payloadJson = JSON.stringify(payload);
      const payloadBytes = new Uint8Array(Buffer.from(payloadJson, 'utf-8'));

      // Decode private key
      const privateKey = new Uint8Array(
        Buffer.from(privateKeyBase64, 'base64')
      );

      if (privateKey.length !== nacl.sign.secretKeyLength) {
        throw new Error('Invalid private key length');
      }

      // Sign the payload
      const signature = nacl.sign.detached(payloadBytes, privateKey);

      return {
        payload: Buffer.from(payloadBytes).toString('base64'),
        signature: Buffer.from(signature).toString('base64'),
      };
    } catch (error) {
      throw new Error(
        `Failed to sign license: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Verify a signed license using the vendor's public key
   * @param signedLicense Signed license to verify
   * @param publicKeyBase64 Base64-encoded Ed25519 public key
   * @returns True if signature is valid
   */
  public verifyLicense(
    signedLicense: SignedLicense,
    publicKeyBase64: string
  ): boolean {
    try {
      // Decode payload and signature (support base64 and base64url)
      const payloadBytes = this.decodeBase64Flexible(signedLicense.payload);
      const signatureBytes = this.decodeBase64Flexible(signedLicense.signature);
      const publicKey = new Uint8Array(Buffer.from(publicKeyBase64, 'base64'));

      if (publicKey.length !== nacl.sign.publicKeyLength) {
        return false;
      }

      if (signatureBytes.length !== nacl.sign.signatureLength) {
        return false;
      }

      // Verify the signature
      return nacl.sign.detached.verify(payloadBytes, signatureBytes, publicKey);
    } catch (error) {
      // Any error in verification means invalid license
      return false;
    }
  }

  /**
   * Parse a license payload from a signed license
   * @param signedLicense Signed license
   * @returns Parsed license payload
   */
  public parseLicensePayload(signedLicense: SignedLicense): LicensePayload {
    try {
      const payloadBytes = this.decodeBase64Flexible(signedLicense.payload);
      const payloadJson = Buffer.from(payloadBytes).toString('utf-8');
      return JSON.parse(payloadJson) as LicensePayload;
    } catch (error) {
      throw new Error(
        `Failed to parse license payload: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Format a signed license as a license key string
   * Format: <base64-payload>.<base64-signature>
   * @param signedLicense Signed license
   * @returns License key string
   */
  public formatLicenseKey(signedLicense: SignedLicense): string {
    return `${signedLicense.payload}.${signedLicense.signature}`;
  }

  /**
   * Parse a license key string into a signed license
   * @param licenseKey License key string
   * @returns Signed license
   */
  public parseLicenseKey(licenseKey: string): SignedLicense {
    if (!licenseKey || typeof licenseKey !== 'string') {
      throw new Error('Invalid license key: must be a non-empty string');
    }

    const parts = licenseKey.split('.');

    if (parts.length !== 2) {
      throw new Error(
        'Invalid license key format: must be <payload>.<signature>'
      );
    }

    return {
      payload: parts[0],
      signature: parts[1],
    };
  }

  /**
   * Generate an activation code for a device
   * Activation code is a signed combination of license ID and device ID
   * @param licenseId License identifier
   * @param deviceId Device identifier
   * @param privateKeyBase64 Vendor's private key
   * @returns Base64-encoded activation code
   */
  public generateActivationCode(
    licenseId: string,
    deviceId: string,
    privateKeyBase64: string
  ): string {
    try {
      const activationData = JSON.stringify({
        licenseId,
        deviceId,
        activatedAt: new Date().toISOString(),
      });

      const dataBytes = new Uint8Array(Buffer.from(activationData, 'utf-8'));
      const privateKey = new Uint8Array(
        Buffer.from(privateKeyBase64, 'base64')
      );

      if (privateKey.length !== nacl.sign.secretKeyLength) {
        throw new Error('Invalid private key length');
      }

      const signature = nacl.sign.detached(dataBytes, privateKey);

      // Return combined data and signature
      const activationCode = {
        data: Buffer.from(dataBytes).toString('base64'),
        signature: Buffer.from(signature).toString('base64'),
      };

      return Buffer.from(JSON.stringify(activationCode)).toString('base64');
    } catch (error) {
      throw new Error(
        `Failed to generate activation code: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Verify an activation code
   * @param activationCodeBase64 Base64-encoded activation code
   * @param expectedLicenseId Expected license ID
   * @param expectedDeviceId Expected device ID
   * @param publicKeyBase64 Vendor's public key
   * @returns True if activation code is valid
   */
  public verifyActivationCode(
    activationCodeBase64: string,
    expectedLicenseId: string,
    expectedDeviceId: string,
    publicKeyBase64: string
  ): boolean {
    try {
      // Decode activation code (outer container may be base64 or base64url)
      const outerBytes = this.decodeBase64Flexible(activationCodeBase64);
      const activationCodeJson = Buffer.from(outerBytes).toString('utf-8');
      const activationCode = JSON.parse(activationCodeJson);

      // Data and signature may be base64 or base64url
      const dataBytes = this.decodeBase64Flexible(activationCode.data);
      const signatureBytes = this.decodeBase64Flexible(
        activationCode.signature
      );
      const publicKey = new Uint8Array(Buffer.from(publicKeyBase64, 'base64'));

      // Verify signature
      if (!nacl.sign.detached.verify(dataBytes, signatureBytes, publicKey)) {
        return false;
      }

      // Parse and verify data
      const data = JSON.parse(Buffer.from(dataBytes).toString('utf-8'));

      return (
        data.licenseId === expectedLicenseId &&
        data.deviceId === expectedDeviceId
      );
    } catch (error) {
      return false;
    }
  }

  /**
   * Verify a payload with signature (for v1.8 enhanced licensing)
   * @param payload The payload object to verify
   * @param signatureBase64 Base64-encoded signature
   * @param publicKeyBase64 Base64-encoded public key
   * @returns True if signature is valid
   */
  public verifyPayloadSignature(
    payload: any,
    signatureBase64: string,
    publicKeyBase64: string
  ): boolean {
    try {
      // Canonical JSON encoding
      const payloadJson = JSON.stringify(payload, Object.keys(payload).sort());
      const payloadBytes = new Uint8Array(Buffer.from(payloadJson, 'utf-8'));
      const signatureBytes = this.decodeBase64Flexible(signatureBase64);
      const publicKey = new Uint8Array(Buffer.from(publicKeyBase64, 'base64'));

      if (publicKey.length !== nacl.sign.publicKeyLength) {
        return false;
      }

      if (signatureBytes.length !== nacl.sign.signatureLength) {
        return false;
      }

      return nacl.sign.detached.verify(payloadBytes, signatureBytes, publicKey);
    } catch (error) {
      return false;
    }
  }

  /**
   * Hash a payload (for challenge-response in v1.8)
   * @param payload The payload to hash
   * @returns SHA-256 hash as hex string
   */
  public hashPayload(payload: any): string {
    const crypto = require('crypto');
    const payloadJson = JSON.stringify(payload, Object.keys(payload).sort());
    return crypto.createHash('sha256').update(payloadJson, 'utf-8').digest('hex');
  }
}
