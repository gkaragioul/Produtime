/**
 * Structured Logger with Correlation ID Support
 * Provides consistent logging across all components
 */

import * as crypto from 'crypto';

// ============================================================================
// TYPES
// ============================================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  correlationId?: string;
  component?: string;
  deviceId?: string;
  tenantId?: string;
  action?: string;
  [key: string]: unknown;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context: LogContext;
}

// ============================================================================
// CORRELATION ID MANAGEMENT
// ============================================================================

let currentCorrelationId: string | null = null;

/**
 * Generate a new correlation ID
 */
export function generateCorrelationId(): string {
  return crypto.randomUUID();
}

/**
 * Set the current correlation ID for the request/operation
 */
export function setCorrelationId(id: string): void {
  currentCorrelationId = id;
}

/**
 * Get the current correlation ID
 */
export function getCorrelationId(): string | null {
  return currentCorrelationId;
}

/**
 * Clear the current correlation ID
 */
export function clearCorrelationId(): void {
  currentCorrelationId = null;
}

/**
 * Run a function with a specific correlation ID
 */
export function withCorrelationId<T>(id: string, fn: () => T): T {
  const previousId = currentCorrelationId;
  currentCorrelationId = id;
  try {
    return fn();
  } finally {
    currentCorrelationId = previousId;
  }
}

// ============================================================================
// STRUCTURED LOGGER
// ============================================================================

export class StructuredLogger {
  private component: string;
  private minLevel: LogLevel;
  private static levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(component: string, minLevel: LogLevel = 'info') {
    this.component = component;
    this.minLevel = minLevel;
  }

  /**
   * Create a child logger with additional context
   */
  child(additionalContext: Partial<LogContext>): StructuredLogger {
    const child = new StructuredLogger(this.component, this.minLevel);
    child.component = additionalContext.component || this.component;
    return child;
  }

  /**
   * Log a message at the specified level
   */
  private log(level: LogLevel, message: string, context: LogContext = {}): void {
    if (StructuredLogger.levelPriority[level] < StructuredLogger.levelPriority[this.minLevel]) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: {
        correlationId: currentCorrelationId || undefined,
        component: this.component,
        ...context,
      },
    };

    // Format for console output
    const contextStr = Object.entries(entry.context)
      .filter(([_, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join(' ');

    const formattedMessage = `[${entry.timestamp}] [${level.toUpperCase()}] [${this.component}] ${message} ${contextStr}`;

    switch (level) {
      case 'debug':
        console.debug(formattedMessage);
        break;
      case 'info':
        console.log(formattedMessage);
        break;
      case 'warn':
        console.warn(formattedMessage);
        break;
      case 'error':
        console.error(formattedMessage);
        break;
    }
  }

  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: LogContext): void {
    this.log('error', message, context);
  }

  /**
   * Log the start of an operation
   */
  startOperation(operation: string, context?: LogContext): string {
    const correlationId = generateCorrelationId();
    setCorrelationId(correlationId);
    this.info(`Starting ${operation}`, { action: operation, ...context });
    return correlationId;
  }

  /**
   * Log the end of an operation
   */
  endOperation(operation: string, success: boolean, context?: LogContext): void {
    this.info(`Completed ${operation}`, { 
      action: operation, 
      success, 
      ...context 
    });
    clearCorrelationId();
  }

  /**
   * Log an error with stack trace
   */
  logError(error: Error, context?: LogContext): void {
    this.error(error.message, {
      errorName: error.name,
      stack: error.stack,
      ...context,
    });
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a logger for a specific component
 */
export function createLogger(component: string, minLevel?: LogLevel): StructuredLogger {
  return new StructuredLogger(component, minLevel);
}

// Pre-configured loggers for common components
export const loggers = {
  agent: createLogger('AGENT'),
  server: createLogger('SERVER'),
  dashboard: createLogger('DASHBOARD'),
  pairing: createLogger('PAIRING'),
  database: createLogger('DATABASE'),
  websocket: createLogger('WEBSOCKET'),
};
