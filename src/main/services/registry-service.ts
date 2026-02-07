import { spawn } from 'child_process';
import * as crypto from 'crypto';

/**
 * Service for storing trial data in Windows Registry
 * This prevents users from resetting trials by deleting the database
 */
export class RegistryService {
  /**
   * Execute registry command safely using spawn (prevents command injection)
   */
  private static async execRegCommand(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('reg', args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to execute registry command: ${err.message}`));
      });

      proc.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`Registry command failed: ${stderr}`));
        } else {
          resolve(stdout);
        }
      });
    });
  }

  private static instance: RegistryService;

  // Registry path for trial data (hidden in Windows system area)
  private readonly REGISTRY_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\ProduTime';
  private readonly TRIAL_KEY = 'TrialData';

  private constructor() {}

  public static getInstance(): RegistryService {
    if (!RegistryService.instance) {
      RegistryService.instance = new RegistryService();
    }
    return RegistryService.instance;
  }

  /**
   * Initialize registry key if it doesn't exist
   */
  private async ensureRegistryPath(): Promise<void> {
    try {
      // Try to read the key, if it fails, create it
      // Use spawn-based safe execution instead of exec
      await RegistryService.execRegCommand([
        'query',
        this.REGISTRY_PATH,
        '/v',
        this.TRIAL_KEY,
      ]);
    } catch (error) {
      // Key doesn't exist, create the registry path
      try {
        await RegistryService.execRegCommand(['add', this.REGISTRY_PATH, '/f']);
      } catch (err) {
        console.error('Failed to create registry path:', err);
      }
    }
  }

  /**
   * Store trial data in registry
   * Data is encrypted to prevent easy tampering
   */
  public async setTrialData(data: {
    deviceId: string;
    startedAt: string;
    expiresAt: string;
  }): Promise<void> {
    try {
      await this.ensureRegistryPath();

      // Encrypt the data to make it harder to tamper with
      const encrypted = this.encryptData(JSON.stringify(data));

      // Store in registry as REG_SZ (string)
      // Use spawn-based safe execution instead of exec to prevent command injection
      await RegistryService.execRegCommand([
        'add',
        this.REGISTRY_PATH,
        '/v',
        this.TRIAL_KEY,
        '/t',
        'REG_SZ',
        '/d',
        encrypted,
        '/f',
      ]);
    } catch (error) {
      console.error('Failed to set trial data in registry:', error);
      throw error;
    }
  }

  /**
   * Get trial data from registry
   */
  public async getTrialData(): Promise<{
    deviceId: string;
    startedAt: string;
    expiresAt: string;
  } | null> {
    try {
      await this.ensureRegistryPath();

      // Use spawn-based safe execution instead of exec
      const stdout = await RegistryService.execRegCommand([
        'query',
        this.REGISTRY_PATH,
        '/v',
        this.TRIAL_KEY,
      ]);

      // Parse registry output - use flexible whitespace matching and handle \r\n
      const match = stdout.match(/TrialData\s+REG_SZ\s+(.+?)[\r\n]/);
      if (!match || !match[1]) {
        return null;
      }

      const encrypted = match[1].trim();
      const decrypted = this.decryptData(encrypted);

      return JSON.parse(decrypted);
    } catch (error) {
      // Key doesn't exist or error reading
      return null;
    }
  }

  /**
   * Check if trial has been used
   */
  public async hasTrialBeenUsed(): Promise<boolean> {
    const trialData = await this.getTrialData();
    return trialData !== null;
  }

  /**
   * Delete trial data (for testing only)
   */
  public async deleteTrialData(): Promise<void> {
    try {
      // Use spawn-based safe execution instead of exec
      await RegistryService.execRegCommand([
        'delete',
        this.REGISTRY_PATH,
        '/v',
        this.TRIAL_KEY,
        '/f',
      ]);
    } catch (error) {
      // Key doesn't exist, ignore
    }
  }

  /**
   * Encrypt data using AES-256
   * Uses random salt for new encryptions (stored with encrypted data for decryption)
   */
  private encryptData(data: string): string {
    const algorithm = 'aes-256-cbc';
    // Use random salt for new encryptions instead of hardcoded salt
    const salt = crypto.randomBytes(16);
    const key = crypto.scryptSync('ProduTime-Registry-Encryption-Key-v1', salt, 32);
    const iv = crypto.randomBytes(16);

    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    // Prepend salt and IV to encrypted data for decryption
    // Format: salt:iv:encrypted
    return salt.toString('hex') + ':' + iv.toString('hex') + ':' + encrypted;
  }

  /**
   * Decrypt data using AES-256
   * Supports both old format (hardcoded salt) and new format (random salt)
   */
  private decryptData(encryptedData: string): string {
    const algorithm = 'aes-256-cbc';
    const parts = encryptedData.split(':');

    let salt: Buffer;
    let iv: Buffer;
    let encrypted: string;

    if (parts.length === 3) {
      // New format: salt:iv:encrypted
      salt = Buffer.from(parts[0], 'hex');
      iv = Buffer.from(parts[1], 'hex');
      encrypted = parts[2];
    } else if (parts.length === 2) {
      // Old format: iv:encrypted (with hardcoded salt for backward compatibility)
      salt = Buffer.from('salt');
      iv = Buffer.from(parts[0], 'hex');
      encrypted = parts[1];
    } else {
      throw new Error('Invalid encrypted data format');
    }

    const key = crypto.scryptSync('ProduTime-Registry-Encryption-Key-v1', salt, 32);
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}
