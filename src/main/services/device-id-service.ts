import * as crypto from 'crypto';
import * as os from 'os';
import { machineIdSync } from 'node-machine-id';

/**
 * Service for generating and managing device IDs
 * Device IDs are deterministic and based on hardware identifiers
 * Format: XXXXXXXX-XXXXXXXX-XXXXXXXX (3 groups of 8 alphanumeric chars)
 */
export class DeviceIdService {
  private static instance: DeviceIdService;
  private cachedDeviceId: string | null = null;

  private constructor() {}

  public static getInstance(): DeviceIdService {
    if (!DeviceIdService.instance) {
      DeviceIdService.instance = new DeviceIdService();
    }
    return DeviceIdService.instance;
  }

  /**
   * Get the unique device ID for this machine
   * The ID is deterministic and will be the same across app restarts
   * @returns Device ID in format XXXXXXXX-XXXXXXXX-XXXXXXXX
   */
  public getDeviceId(): string {
    if (this.cachedDeviceId) {
      return this.cachedDeviceId;
    }

    const fingerprint = this.generateDeviceFingerprint();
    this.cachedDeviceId = this.formatDeviceId(fingerprint);
    return this.cachedDeviceId;
  }

  /**
   * Check if the current device ID differs from a stored device ID
   * Used to detect hardware changes that require re-activation
   * @param storedDeviceId Previously stored device ID
   * @returns True if device has changed
   */
  public hasDeviceChanged(storedDeviceId: string | null | undefined): boolean {
    if (!storedDeviceId || storedDeviceId.trim() === '') {
      return true;
    }

    const currentDeviceId = this.getDeviceId();
    return currentDeviceId !== storedDeviceId;
  }

  /**
   * Generate a device fingerprint based on hardware identifiers
   * Uses machine ID as primary identifier with fallback to hostname
   * @returns SHA-256 hash of device identifiers
   */
  public generateDeviceFingerprint(): string {
    let machineId: string;

    try {
      // Try to get machine ID (most reliable cross-platform identifier)
      machineId = machineIdSync(true);
    } catch (error) {
      // Fallback to hostname + platform if machine ID fails
      console.warn('Failed to get machine ID, using fallback:', error);
      machineId = `${os.hostname()}-${os.platform()}-${os.arch()}`;
    }

    // Create a deterministic hash of the machine identifier
    const hash = crypto.createHash('sha256');
    hash.update(machineId);
    hash.update(os.platform()); // Add platform for extra uniqueness
    hash.update(os.arch()); // Add architecture

    return hash.digest('hex');
  }

  /**
   * Format a fingerprint hash into a user-friendly device ID
   * Converts hex hash to uppercase alphanumeric format with dashes
   * @param fingerprint SHA-256 hash
   * @returns Formatted device ID (XXXXXXXX-XXXXXXXX-XXXXXXXX)
   */
  private formatDeviceId(fingerprint: string): string {
    // Take first 30 characters of hex hash to ensure we have enough for 24 chars
    const hex = fingerprint.substring(0, 30);

    // Convert to uppercase alphanumeric (remove ambiguous chars)
    // Use a simple base32-like encoding for readability
    const base32Chars = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // Removed I, O for clarity
    let encoded = '';

    // Convert each hex character to base32
    for (let i = 0; i < hex.length; i++) {
      const nibble = parseInt(hex[i], 16);
      encoded += base32Chars[nibble % base32Chars.length];
    }

    // Ensure we have at least 24 characters
    while (encoded.length < 24) {
      encoded += base32Chars[0];
    }

    // Format as XXXXXXXX-XXXXXXXX-XXXXXXXX
    const part1 = encoded.substring(0, 8);
    const part2 = encoded.substring(8, 16);
    const part3 = encoded.substring(16, 24);

    return `${part1}-${part2}-${part3}`;
  }

  /**
   * Clear the cached device ID (useful for testing)
   * @internal
   */
  public clearCache(): void {
    this.cachedDeviceId = null;
  }
}
