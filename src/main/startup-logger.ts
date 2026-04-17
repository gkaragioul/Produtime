/**
 * Startup Logger - Captures startup and crash logs BEFORE Electron is ready
 * This logger writes to a predictable location so users can find logs even if the app won't start
 *
 * Log files are automatically cleaned up after 2 weeks
 */

import * as fs from "fs";
import * as path from "path";

// Determine log directory - must work before Electron app is ready.
// Windows-only app: APPDATA is always set; /var/local is a last-ditch
// fallback for dev on WSL without APPDATA.
const DATA_ROOT = process.env.APPDATA || '/var/local';
const LOG_DIR = path.join(DATA_ROOT, 'produtime', 'logs');

// Ensure log directory exists immediately
try {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
} catch (e) {
  // Cannot create log directory - filesystem issue
  console.error('Failed to create log directory:', e);
}

// Generate log filename with timestamp
const SESSION_START = new Date();
const TIMESTAMP = SESSION_START.toISOString().replace(/[:.]/g, '-').slice(0, 19);
const LOG_FILE = path.join(LOG_DIR, `produtime-${TIMESTAMP}.log`);
const CRASH_FILE = path.join(LOG_DIR, `crash-${TIMESTAMP}.log`);

// Log retention period: 14 days (2 weeks)
const LOG_RETENTION_DAYS = 14;
const LOG_RETENTION_MS = LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;

class StartupLogger {
  private static instance: StartupLogger;
  private logFile: string;
  private crashFile: string;
  private initialized: boolean = false;

  private constructor() {
    this.logFile = LOG_FILE;
    this.crashFile = CRASH_FILE;
    this.initialize();
  }

  public static getInstance(): StartupLogger {
    if (!StartupLogger.instance) {
      StartupLogger.instance = new StartupLogger();
    }
    return StartupLogger.instance;
  }

  private initialize(): void {
    if (this.initialized) return;

    try {
      // Write session header
      const header = [
        '='.repeat(80),
        `ProduTime Startup Log`,
        `Session Started: ${SESSION_START.toISOString()}`,
        `Log File: ${this.logFile}`,
        `Platform: ${process.platform} ${process.arch}`,
        `Node Version: ${process.version}`,
        `Electron Version: ${process.versions.electron || 'N/A'}`,
        `Process ID: ${process.pid}`,
        `Executable: ${process.execPath}`,
        `Working Directory: ${process.cwd()}`,
        '='.repeat(80),
        ''
      ].join('\n');

      fs.writeFileSync(this.logFile, header);
      this.initialized = true;

      // Clean up old logs on startup
      this.cleanupOldLogs();

    } catch (e) {
      console.error('Failed to initialize startup logger:', e);
    }
  }

  /**
   * Write a log entry with timestamp and level
   */
  public log(level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG' | 'CRASH', message: string, data?: any): void {
    const timestamp = new Date().toISOString();
    let logLine = `[${timestamp}] [${level.padEnd(5)}] ${message}`;

    if (data !== undefined) {
      try {
        const dataStr = typeof data === 'object'
          ? JSON.stringify(data, this.errorReplacer, 2)
          : String(data);
        logLine += `\n${dataStr}`;
      } catch (e) {
        logLine += `\n[Unable to serialize data]`;
      }
    }

    logLine += '\n';

    try {
      fs.appendFileSync(this.logFile, logLine);

      // Also write crashes to dedicated crash file
      if (level === 'CRASH' || level === 'ERROR') {
        fs.appendFileSync(this.crashFile, logLine);
      }
    } catch (e) {
      // Silent fail - can't log the logging failure
    }

    // Also output to console
    if (level === 'ERROR' || level === 'CRASH') {
      console.error(logLine);
    } else {
      console.log(logLine);
    }
  }

  /**
   * JSON replacer that handles Error objects
   */
  private errorReplacer(key: string, value: any): any {
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack
      };
    }
    return value;
  }

  public info(message: string, data?: any): void {
    this.log('INFO', message, data);
  }

  public warn(message: string, data?: any): void {
    this.log('WARN', message, data);
  }

  public error(message: string, data?: any): void {
    this.log('ERROR', message, data);
  }

  public debug(message: string, data?: any): void {
    this.log('DEBUG', message, data);
  }

  public crash(message: string, error?: any): void {
    this.log('CRASH', message, error);
  }

  /**
   * Log a section separator for readability
   */
  public section(title: string): void {
    const line = '='.repeat(80);
    const content = `\n${line}\n  ${title}\n${line}\n`;
    try {
      fs.appendFileSync(this.logFile, content);
    } catch (e) {
      // Silent fail
    }
  }

  /**
   * Get the path to the current log file
   */
  public getLogFile(): string {
    return this.logFile;
  }

  /**
   * Get the path to the crash log file
   */
  public getCrashFile(): string {
    return this.crashFile;
  }

  /**
   * Get the logs directory path
   */
  public getLogsDir(): string {
    return LOG_DIR;
  }

  /**
   * Clean up log files older than 2 weeks
   */
  public cleanupOldLogs(): void {
    try {
      const now = Date.now();
      const files = fs.readdirSync(LOG_DIR);
      let deletedCount = 0;

      for (const file of files) {
        // Only process .log files
        if (!file.endsWith('.log')) continue;

        const filePath = path.join(LOG_DIR, file);

        try {
          const stats = fs.statSync(filePath);
          const fileAge = now - stats.mtimeMs;

          if (fileAge > LOG_RETENTION_MS) {
            fs.unlinkSync(filePath);
            deletedCount++;
          }
        } catch (e) {
          // Skip files that can't be accessed
        }
      }

      if (deletedCount > 0) {
        this.info(`Cleaned up ${deletedCount} old log file(s) older than ${LOG_RETENTION_DAYS} days`);
      }

    } catch (e) {
      // Don't fail startup if cleanup fails
      console.error('Failed to cleanup old logs:', e);
    }
  }

  /**
   * Write final session info when app exits
   */
  public logShutdown(reason: string = 'normal'): void {
    const duration = Date.now() - SESSION_START.getTime();
    const durationStr = this.formatDuration(duration);

    this.section('SESSION END');
    this.info(`Application shutdown: ${reason}`);
    this.info(`Session duration: ${durationStr}`);
    this.info(`Session ended: ${new Date().toISOString()}`);
  }

  /**
   * Format milliseconds to human readable duration
   */
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
}

// Export singleton instance
export const startupLogger = StartupLogger.getInstance();

// Export the logs directory path for external use
export const LOGS_DIRECTORY = LOG_DIR;

// Setup global error handlers immediately
process.on('uncaughtException', (error: Error) => {
  startupLogger.crash('UNCAUGHT EXCEPTION', error);
});

process.on('unhandledRejection', (reason: any) => {
  startupLogger.crash('UNHANDLED PROMISE REJECTION', reason);
});
