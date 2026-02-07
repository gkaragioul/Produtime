/**
 * Agent Crypto Service
 * Ed25519 signing/verification and nonce management for Admin Console protocol
 */

import * as nacl from 'tweetnacl';
import * as crypto from 'crypto';
import { BaseMessage, AdminMessageType, NONCE_EXPIRY_MS } from '../../../shared/admin-protocol';

/**
 * LRU-based nonce store for replay protection
 */
class NonceStore {
  private nonces: Map<string, number> = new Map();
  private maxSize: number;
  private expiryMs: number;

  constructor(maxSize: number = 10000, expiryMs: number = NONCE_EXPIRY_MS) {
    this.maxSize = maxSize;
    this.expiryMs = expiryMs;
  }

  /**
   * Check if nonce has been seen before
   * Returns true if nonce is valid (not seen), false if replay detected
   */
  public checkAndStore(nonce: string, timestamp: number): boolean {
    const now = Date.now();
    
    // Clean expired nonces periodically
    if (this.nonces.size > this.maxSize * 0.9) {
      this.cleanup(now);
    }

    // Check if nonce already exists
    if (this.nonces.has(nonce)) {
      return false; // Replay detected
    }

    // Check if timestamp is within acceptable window
    if (Math.abs(now - timestamp) > this.expiryMs) {
      return false; // Message too old or from future
    }

    // Store nonce
    this.nonces.set(nonce, timestamp);
    return true;
  }

  private cleanup(now: number): void {
    const expiredBefore = now - this.expiryMs;
    for (const [nonce, ts] of this.nonces.entries()) {
      if (ts < expiredBefore) {
        this.nonces.delete(nonce);
      }
    }
  }

  public clear(): void {
    this.nonces.clear();
  }
}

/**
 * Agent Crypto Service - handles Ed25519 operations
 */
export class AgentCryptoService {
  private static instance: AgentCryptoService;
  private nonceStore: NonceStore;

  private constructor() {
    this.nonceStore = new NonceStore();
  }

  public static getInstance(): AgentCryptoService {
    if (!AgentCryptoService.instance) {
      AgentCryptoService.instance = new AgentCryptoService();
    }
    return AgentCryptoService.instance;
  }

  /**
   * Generate a new Ed25519 key pair
   */
  public generateKeyPair(): { publicKey: string; privateKey: string } {
    const keyPair = nacl.sign.keyPair();
    return {
      publicKey: Buffer.from(keyPair.publicKey).toString('base64'),
      privateKey: Buffer.from(keyPair.secretKey).toString('base64'),
    };
  }

  /**
   * Generate a cryptographically secure nonce
   */
  public generateNonce(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Create the canonical string to sign for a message
   */
  private createSignableString(
    type: AdminMessageType,
    ts: number,
    nonce: string,
    deviceId: string,
    payload: any
  ): string {
    return JSON.stringify({ type, ts, nonce, deviceId, payload });
  }

  /**
   * Sign a message with the device's private key
   */
  public signMessage(
    type: AdminMessageType,
    ts: number,
    nonce: string,
    deviceId: string,
    payload: any,
    privateKeyBase64: string
  ): string {
    const signable = this.createSignableString(type, ts, nonce, deviceId, payload);
    const messageBytes = new Uint8Array(Buffer.from(signable, 'utf-8'));
    const privateKey = new Uint8Array(Buffer.from(privateKeyBase64, 'base64'));

    if (privateKey.length !== nacl.sign.secretKeyLength) {
      throw new Error('Invalid private key length');
    }

    const signature = nacl.sign.detached(messageBytes, privateKey);
    return Buffer.from(signature).toString('base64');
  }

  /**
   * Verify a message signature
   */
  public verifySignature(
    type: AdminMessageType,
    ts: number,
    nonce: string,
    deviceId: string,
    payload: any,
    signatureBase64: string,
    publicKeyBase64: string
  ): boolean {
    try {
      const signable = this.createSignableString(type, ts, nonce, deviceId, payload);
      const messageBytes = new Uint8Array(Buffer.from(signable, 'utf-8'));
      const signature = this.decodeBase64Flexible(signatureBase64);
      const publicKey = this.decodeBase64Flexible(publicKeyBase64);

      if (publicKey.length !== nacl.sign.publicKeyLength) {
        return false;
      }

      if (signature.length !== nacl.sign.signatureLength) {
        return false;
      }

      return nacl.sign.detached.verify(messageBytes, signature, publicKey);
    } catch (error) {
      console.error('Signature verification error:', error);
      return false;
    }
  }

  /**
   * Verify a complete message including replay protection
   */
  public verifyMessage(message: BaseMessage, publicKeyBase64: string): boolean {
    // First verify signature
    const { type, ts, nonce, deviceId, signature, ...rest } = message;
    const payload = (rest as any).payload;

    if (!this.verifySignature(type, ts, nonce, deviceId, payload, signature, publicKeyBase64)) {
      console.warn('Message signature verification failed');
      return false;
    }

    // Then check nonce for replay protection
    if (!this.nonceStore.checkAndStore(nonce, ts)) {
      console.warn('Message replay detected or timestamp out of range');
      return false;
    }

    return true;
  }

  /**
   * Create a signed message
   */
  public createSignedMessage<T>(
    type: AdminMessageType,
    deviceId: string,
    payload: T,
    privateKeyBase64: string
  ): BaseMessage & { payload: T } {
    const ts = Date.now();
    const nonce = this.generateNonce();
    const signature = this.signMessage(type, ts, nonce, deviceId, payload, privateKeyBase64);

    return {
      type,
      ts,
      nonce,
      deviceId,
      signature,
      payload,
    } as BaseMessage & { payload: T };
  }

  /**
   * Encrypt data with a password (for storing private key)
   */
  public encryptWithPassword(data: string, password: string): string {
    const salt = crypto.randomBytes(16);
    const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    
    let encrypted = cipher.update(data, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const authTag = cipher.getAuthTag();

    // Format: salt:iv:authTag:encrypted
    return [
      salt.toString('base64'),
      iv.toString('base64'),
      authTag.toString('base64'),
      encrypted,
    ].join(':');
  }

  /**
   * Decrypt data with a password
   */
  public decryptWithPassword(encryptedData: string, password: string): string {
    const parts = encryptedData.split(':');
    if (parts.length !== 4) {
      throw new Error('Invalid encrypted data format');
    }

    const [saltB64, ivB64, authTagB64, encrypted] = parts;
    const salt = Buffer.from(saltB64, 'base64');
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(authTagB64, 'base64');
    const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /**
   * Generate a 6-digit pairing code
   */
  public generatePairCode(): string {
    const bytes = crypto.randomBytes(3);
    const num = bytes.readUIntBE(0, 3) % 1000000;
    return num.toString().padStart(6, '0');
  }

  /**
   * Hash a policy for version comparison
   */
  public hashPolicy(policy: any): string {
    const json = JSON.stringify(policy);
    return crypto.createHash('sha256').update(json).digest('hex').substring(0, 16);
  }

  /**
   * Decode base64 with flexible handling (standard and URL-safe)
   */
  private decodeBase64Flexible(input: string): Uint8Array {
    try {
      return new Uint8Array(Buffer.from(input, 'base64'));
    } catch {
      // Try base64url
      let s = input.replace(/-/g, '+').replace(/_/g, '/');
      const pad = s.length % 4;
      if (pad) s += '='.repeat(4 - pad);
      return new Uint8Array(Buffer.from(s, 'base64'));
    }
  }

  /**
   * Clear nonce store (for testing)
   */
  public clearNonceStore(): void {
    this.nonceStore.clear();
  }
}

export default AgentCryptoService.getInstance();
