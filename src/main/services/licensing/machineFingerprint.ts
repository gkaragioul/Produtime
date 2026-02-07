import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { Logger } from '../../logger';
import * as os from 'os';

// Salt for machine fingerprint hashing
// Can be rotated in future versions via app update
const MACHINE_SALT = 'ProduTime-2026-Machine-Salt-v1';

const logger = Logger.getInstance();

/**
 * Generate a stable machine fingerprint for Windows
 * Uses hardware identifiers that persist across reinstalls
 */
export function getMachineFingerprint(): string {
  try {
    logger.info('FINGERPRINT', 'Generating machine fingerprint');

    // 1. Get Machine GUID from Windows registry
    let machineGuid = '';
    try {
      const regOutput = execSync(
        'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
        { encoding: 'utf8', windowsHide: true }
      );
      const match = regOutput.match(/MachineGuid\s+REG_SZ\s+(.+)/);
      machineGuid = match?.[1]?.trim() || '';
      logger.info('FINGERPRINT', 'Machine GUID retrieved', {
        preview: machineGuid.substring(0, 8) + '...',
      });
    } catch (error) {
      logger.error('FINGERPRINT', 'Failed to get Machine GUID', { error });
    }

    // 2. Get CPU information
    let cpuModel = '';
    try {
      const cpuOutput = execSync('wmic cpu get name', {
        encoding: 'utf8',
        windowsHide: true,
      });
      const lines = cpuOutput.split('\n').filter((l) => l.trim() && l.trim() !== 'Name');
      cpuModel = lines[0]?.trim() || '';
      logger.info('FINGERPRINT', 'CPU model retrieved', {
        preview: cpuModel.substring(0, 20) + '...',
      });
    } catch (error) {
      logger.error('FINGERPRINT', 'Failed to get CPU model', { error });
    }

    // 3. Get system drive serial number (best-effort)
    let driveSerial = '';
    try {
      const driveOutput = execSync('wmic diskdrive get serialnumber', {
        encoding: 'utf8',
        windowsHide: true,
      });
      const lines = driveOutput
        .split('\n')
        .filter((l) => l.trim() && l.trim() !== 'SerialNumber');
      driveSerial = lines[0]?.trim() || '';
      logger.info('FINGERPRINT', 'Drive serial retrieved', {
        available: !!driveSerial,
      });
    } catch (error) {
      logger.warn('FINGERPRINT', 'Failed to get drive serial (non-critical)', { error });
    }

    // 4. Concatenate identifiers with separators
    const raw = `${machineGuid}|${cpuModel}|${driveSerial}`;

    // 5. Hash with salt: SHA-256(SALT + raw)
    const hash = createHash('sha256')
      .update(MACHINE_SALT + raw)
      .digest('hex');

    logger.info('FINGERPRINT', 'Machine fingerprint generated', {
      hash: hash.substring(0, 16) + '...',
    });

    return hash;
  } catch (error) {
    logger.error('FINGERPRINT', 'Failed to generate machine fingerprint', { error });

    // Fallback: hostname-based hash (less stable but better than nothing)
    const hostname = os.hostname();
    const fallbackHash = createHash('sha256')
      .update(MACHINE_SALT + hostname)
      .digest('hex');

    logger.warn('FINGERPRINT', 'Using fallback fingerprint based on hostname', {
      hostname,
      hash: fallbackHash.substring(0, 16) + '...',
    });

    return fallbackHash;
  }
}

/**
 * Validate that we can generate a fingerprint
 * Used in diagnostics
 */
export function canGenerateFingerprint(): boolean {
  try {
    const fingerprint = getMachineFingerprint();
    return fingerprint.length === 64; // SHA-256 hex is 64 chars
  } catch (error) {
    return false;
  }
}
