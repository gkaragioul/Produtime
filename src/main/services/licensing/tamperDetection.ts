import { Logger } from '../../logger';
import { DatabaseManager } from '../../database';
import { app } from 'electron';

const logger = Logger.getInstance();

export enum TamperFlag {
  CLOCK_ROLLBACK = 'CLOCK_ROLLBACK',
  CERT_CORRUPTED = 'CERT_CORRUPTED',
  DEVTOOLS_OPEN = 'DEVTOOLS_OPEN',
  DEV_MODE = 'DEV_MODE',
}

export interface TamperDetectionResult {
  isTampered: boolean;
  flags: TamperFlag[];
  severity: 'none' | 'low' | 'medium' | 'high';
}

/**
 * Detect various tampering attempts
 */
export function detectTamper(db: DatabaseManager): TamperDetectionResult {
  const flags: TamperFlag[] = [];

  // Check if running in development mode
  if (process.defaultApp || process.env.NODE_ENV === 'development') {
    flags.push(TamperFlag.DEV_MODE);
    logger.info('TAMPER', 'Running in development mode - tamper checks relaxed');
    return {
      isTampered: false, // Don't lock in dev mode
      flags,
      severity: 'none',
    };
  }

  // Check clock rollback
  try {
    const state = db.get<{ lastSeen: string; lastServerTime: string }>(
      'SELECT lastSeen, lastServerTime FROM license_state WHERE id = 1'
    );

    if (state?.lastSeen) {
      const lastSeen = new Date(state.lastSeen);
      const now = new Date();

      if (now < lastSeen) {
        const diffMs = lastSeen.getTime() - now.getTime();
        const diffMinutes = Math.floor(diffMs / 1000 / 60);

        if (diffMinutes > 5) {
          // More than 5 minutes rollback is suspicious
          flags.push(TamperFlag.CLOCK_ROLLBACK);
          logger.warn('TAMPER', 'Clock rollback detected', {
            lastSeen: lastSeen.toISOString(),
            now: now.toISOString(),
            diffMinutes,
          });
        }
      }
    }

    // Check server time vs local time (if available)
    if (state?.lastServerTime) {
      const serverTime = new Date(state.lastServerTime);
      const now = new Date();
      const drift = Math.abs(now.getTime() - serverTime.getTime());
      const driftHours = drift / 1000 / 60 / 60;

      if (driftHours > 24) {
        logger.warn('TAMPER', 'Large clock drift detected', {
          driftHours,
          serverTime: serverTime.toISOString(),
          localTime: now.toISOString(),
        });
        // Note: Large drift could be legitimate (timezone changes, etc.)
        // So we don't flag as tamper, just log it
      }
    }
  } catch (error) {
    logger.error('TAMPER', 'Error checking clock rollback', { error });
  }

  // Determine severity
  let severity: 'none' | 'low' | 'medium' | 'high' = 'none';
  if (flags.includes(TamperFlag.CLOCK_ROLLBACK)) {
    severity = 'high';
  } else if (flags.includes(TamperFlag.CERT_CORRUPTED)) {
    severity = 'high';
  } else if (flags.includes(TamperFlag.DEVTOOLS_OPEN)) {
    severity = 'low';
  } else if (flags.length > 0) {
    // BUG FIX #16: Add medium severity for other cases
    severity = 'medium';
  }

  const isTampered = flags.length > 0 && severity !== 'none';

  if (isTampered) {
    logger.warn('TAMPER', 'Tampering detected', { flags, severity });
  }

  return { isTampered, flags, severity };
}

/**
 * Update lastSeen timestamp
 * Call this periodically to maintain rollback detection
 */
export function updateLastSeen(db: DatabaseManager): void {
  try {
    db.execute('UPDATE license_state SET lastSeen = ?, updatedAt = ? WHERE id = 1', [
      new Date().toISOString(),
      new Date().toISOString(),
    ]);
  } catch (error) {
    logger.error('TAMPER', 'Failed to update lastSeen', { error });
  }
}

/**
 * Store tamper flags in database
 */
export function storeTamperFlags(db: DatabaseManager, flags: TamperFlag[]): void {
  try {
    const flagsJson = JSON.stringify(flags);
    db.execute('UPDATE license_state SET tamperFlags = ?, updatedAt = ? WHERE id = 1', [
      flagsJson,
      new Date().toISOString(),
    ]);
    logger.info('TAMPER', 'Tamper flags stored', { flags });
  } catch (error) {
    logger.error('TAMPER', 'Failed to store tamper flags', { error });
  }
}

/**
 * Get stored tamper flags
 */
export function getTamperFlags(db: DatabaseManager): TamperFlag[] {
  try {
    const row = db.get<{ tamperFlags: string }>(
      'SELECT tamperFlags FROM license_state WHERE id = 1'
    );
    if (!row?.tamperFlags) return [];
    return JSON.parse(row.tamperFlags) as TamperFlag[];
  } catch (error) {
    logger.error('TAMPER', 'Failed to get tamper flags', { error });
    return [];
  }
}

/**
 * Clear tamper flags (after successful verification)
 */
export function clearTamperFlags(db: DatabaseManager): void {
  try {
    db.execute('UPDATE license_state SET tamperFlags = NULL, updatedAt = ? WHERE id = 1', [
      new Date().toISOString(),
    ]);
    logger.info('TAMPER', 'Tamper flags cleared');
  } catch (error) {
    logger.error('TAMPER', 'Failed to clear tamper flags', { error });
  }
}
