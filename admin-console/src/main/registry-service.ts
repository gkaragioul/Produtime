/**
 * Admin Console Registry Service
 * Stores trial data in Windows Registry to prevent trial reset by deleting database
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as crypto from 'crypto';

const execAsync = promisify(exec);

export class AdminRegistryService {
  private static instance: AdminRegistryService;
  
  // Registry path for Admin Console trial data (separate from main app)
  private readonly REGISTRY_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\ProduTimeAdmin';
  private readonly TRIAL_KEY = 'AdminTrialData';

  private constructor() {}

  public static getInstance(): AdminRegistryService {
    if (!AdminRegistryService.instance) {
      AdminRegistryService.instance = new AdminRegistryService();
    }
    return AdminRegistryService.instance;
  }

  /**
   * Initialize registry key if it doesn't exist
   */
  private async ensureRegistryPath(): Promise<void> {
    try {
      await execAsync(`reg query "${this.REGISTRY_PATH}" /v ${this.TRIAL_KEY}`);
    } catch (error) {
      // Key doesn't exist, create the registry path
      try {
        await execAsync(`reg add "${this.REGISTRY_PATH}" /f`);
      } catch (err) {
        console.error('[AdminRegistry] Failed to create registry path:', err);
      }
    }
  }

  /**
   * Store trial data in registry (encrypted)
   */
  public async setTrialData(data: {
    machineHash: string;
    startedAt: string;
    expiresAt: string;
  }): Promise<void> {
    try {
      await this.ensureRegistryPath();

      const encrypted = this.encryptData(JSON.stringify(data));
      const command = `reg add "${this.REGISTRY_PATH}" /v ${this.TRIAL_KEY} /t REG_SZ /d "${encrypted}" /f`;
      await execAsync(command);
      
      console.log('[AdminRegistry] Trial data stored in registry');
    } catch (error) {
      console.error('[AdminRegistry] Failed to set trial data:', error);
      throw error;
    }
  }

  /**
   * Get trial data from registry
   */
  public async getTrialData(): Promise<{
    machineHash: string;
    startedAt: string;
    expiresAt: string;
  } | null> {
    try {
      await this.ensureRegistryPath();

      const command = `reg query "${this.REGISTRY_PATH}" /v ${this.TRIAL_KEY}`;
      const { stdout } = await execAsync(command);

      const match = stdout.match(/AdminTrialData\s+REG_SZ\s+(.+)/);
      if (!match || !match[1]) {
        return null;
      }

      const encrypted = match[1].trim();
      const decrypted = this.decryptData(encrypted);
      
      return JSON.parse(decrypted);
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if trial has been used on this machine
   */
  public async hasTrialBeenUsed(): Promise<boolean> {
    const trialData = await this.getTrialData();
    return trialData !== null;
  }

  /**
   * Get trial start date if trial was used
   */
  public async getTrialStartDate(): Promise<string | null> {
    const trialData = await this.getTrialData();
    return trialData?.startedAt || null;
  }

  /**
   * Encrypt data using AES-256
   */
  private encryptData(data: string): string {
    const algorithm = 'aes-256-cbc';
    // Use different key than main app for separation
    const key = crypto.scryptSync('ProduTimeAdmin-Registry-Encryption-Key-v1', 'salt', 32);
    const iv = crypto.randomBytes(16);

    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return iv.toString('hex') + ':' + encrypted;
  }

  /**
   * Decrypt data using AES-256
   */
  private decryptData(encryptedData: string): string {
    const algorithm = 'aes-256-cbc';
    const key = crypto.scryptSync('ProduTimeAdmin-Registry-Encryption-Key-v1', 'salt', 32);

    const parts = encryptedData.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];

    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}
