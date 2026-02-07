import * as crypto from 'crypto';
import { machineIdSync } from 'node-machine-id';

/**
 * Service for generating hardware-based encryption keys
 * Uses machine ID to create deterministic encryption key
 */
export class EncryptionKeyService {
  private static instance: EncryptionKeyService;
  private encryptionKey: string | null = null;

  private constructor() {}

  public static getInstance(): EncryptionKeyService {
    if (!EncryptionKeyService.instance) {
      EncryptionKeyService.instance = new EncryptionKeyService();
    }
    return EncryptionKeyService.instance;
  }

  /**
   * Get or generate hardware-based encryption key
   * This key is deterministic based on machine hardware
   */
  public getEncryptionKey(): string {
    if (this.encryptionKey) {
      return this.encryptionKey;
    }

    // Get machine ID (hardware-based, persistent)
    const machineId = machineIdSync(true);

    // Create deterministic encryption key from machine ID
    // Use PBKDF2 to derive a strong key
    const salt = 'ProduTime-DB-Encryption-Salt-v1';
    const iterations = 100000;
    const keyLength = 32; // 256 bits

    const key = crypto.pbkdf2Sync(
      machineId,
      salt,
      iterations,
      keyLength,
      'sha256'
    );

    this.encryptionKey = key.toString('hex');
    return this.encryptionKey;
  }

  /**
   * Clear cached encryption key (for testing)
   */
  public clearCache(): void {
    this.encryptionKey = null;
  }
}
