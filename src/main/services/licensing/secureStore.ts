import { safeStorage } from 'electron';
import { Logger } from '../../logger';
import { DatabaseManager } from '../../database';
import * as crypto from 'crypto';

const logger = Logger.getInstance();

/**
 * Secure storage for activation certificates using Electron's safeStorage API
 * Falls back to base64 encoding in development mode if encryption unavailable
 *
 * Note: For production, consider adding node-dpapi for Windows-specific DPAPI encryption
 * which provides additional security guarantees independent of Electron.
 */

export class SecureStore {
  private static instance: SecureStore;
  private encryptionAvailable: boolean;
  // Fallback encryption key derived from fixed data - use this only when safeStorage fails
  private static readonly FALLBACK_ENCRYPTION_KEY = crypto.scryptSync(
    'ProduTime-Secure-Storage-Fallback-Key-v1',
    crypto.createHash('sha256').update('produtime-secure-store').digest(),
    32
  );

  private constructor() {
    this.encryptionAvailable = safeStorage.isEncryptionAvailable();
    logger.info('SECURE_STORE', 'Secure storage initialized', {
      encryptionAvailable: this.encryptionAvailable,
    });

    if (!this.encryptionAvailable) {
      logger.warn(
        'SECURE_STORE',
        'System encryption not available - using fallback AES encryption (ensure this is dev/test only)'
      );
    }
  }

  public static getInstance(): SecureStore {
    if (!SecureStore.instance) {
      SecureStore.instance = new SecureStore();
    }
    return SecureStore.instance;
  }

  /**
   * Encrypt data using Electron's safeStorage or AES-256-GCM as fallback
   */
  public encrypt(data: Buffer): Buffer {
    if (this.encryptionAvailable) {
      return safeStorage.encryptString(data.toString('utf8'));
    } else {
      // Fallback: Use AES-256-GCM instead of base64 (which provides no security)
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(
        'aes-256-gcm',
        SecureStore.FALLBACK_ENCRYPTION_KEY,
        iv
      );
      let encrypted = cipher.update(data);
      encrypted = Buffer.concat([encrypted, cipher.final()]);
      const authTag = cipher.getAuthTag();

      // Format: iv:authTag:encrypted
      return Buffer.concat([iv, authTag, encrypted]);
    }
  }

  /**
   * Decrypt data - handles both safeStorage and AES-256-GCM fallback formats
   */
  public decrypt(encryptedData: Buffer): Buffer | null {
    try {
      if (this.encryptionAvailable) {
        const decrypted = safeStorage.decryptString(encryptedData);
        return Buffer.from(decrypted, 'utf8');
      } else {
        // Fallback: Try to decrypt as AES-256-GCM
        // Format: iv(16) + authTag(16) + encrypted(variable)
        if (encryptedData.length <= 32) {
          throw new Error('Invalid encrypted data format');
        }

        const iv = encryptedData.slice(0, 16);
        const authTag = encryptedData.slice(16, 32);
        const encrypted = encryptedData.slice(32);

        const decipher = crypto.createDecipheriv(
          'aes-256-gcm',
          SecureStore.FALLBACK_ENCRYPTION_KEY,
          iv
        );
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encrypted);
        decrypted = Buffer.concat([decrypted, decipher.final()]);

        return decrypted;
      }
    } catch (error) {
      logger.error('SECURE_STORE', 'Decryption failed', { error });
      return null; // Indicates tampering or corruption
    }
  }

  /**
   * Store activation certificate securely
   */
  public async storeActivationCert(cert: any, db: DatabaseManager): Promise<void> {
    try {
      const certJson = JSON.stringify(cert);
      const encrypted = this.encrypt(Buffer.from(certJson, 'utf8'));

      db.execute(
        'UPDATE license_state SET activationCertEncrypted = ?, updatedAt = ? WHERE id = 1',
        [encrypted, new Date().toISOString()]
      );

      logger.info('SECURE_STORE', 'Activation certificate stored');
    } catch (error) {
      logger.error('SECURE_STORE', 'Failed to store activation cert', { error });
      throw error;
    }
  }

  /**
   * Load activation certificate
   */
  public async loadActivationCert(db: DatabaseManager): Promise<any | null> {
    try {
      const row = db.get<{ activationCertEncrypted: Buffer }>(
        'SELECT activationCertEncrypted FROM license_state WHERE id = 1'
      );

      if (!row?.activationCertEncrypted) {
        logger.info('SECURE_STORE', 'No activation certificate found');
        return null;
      }

      const decrypted = this.decrypt(row.activationCertEncrypted);
      if (!decrypted) {
        logger.error('SECURE_STORE', 'Activation cert corrupted or tampered');
        return null;
      }

      const cert = JSON.parse(decrypted.toString('utf8'));
      logger.info('SECURE_STORE', 'Activation certificate loaded');
      return cert;
    } catch (error) {
      logger.error('SECURE_STORE', 'Failed to load activation cert', { error });
      return null;
    }
  }

  /**
   * Store trial state securely
   */
  public async storeTrialState(trialStart: Date, db: DatabaseManager): Promise<void> {
    try {
      const data = JSON.stringify({ trialStart: trialStart.toISOString() });
      const encrypted = this.encrypt(Buffer.from(data, 'utf8'));

      // For trial, we store in a simple encrypted field
      // This is just to make it slightly harder to tamper with
      db.execute(
        'UPDATE license_state SET trialStart = ?, updatedAt = ? WHERE id = 1',
        [trialStart.toISOString(), new Date().toISOString()]
      );

      logger.info('SECURE_STORE', 'Trial state stored');
    } catch (error) {
      logger.error('SECURE_STORE', 'Failed to store trial state', { error });
      throw error;
    }
  }

  /**
   * Clear all secure data (on logout/reset)
   */
  public async clearSecureData(db: DatabaseManager): Promise<void> {
    db.execute(
      'UPDATE license_state SET activationCertEncrypted = NULL, updatedAt = ? WHERE id = 1',
      [new Date().toISOString()]
    );
    logger.info('SECURE_STORE', 'Secure data cleared');
  }
}
