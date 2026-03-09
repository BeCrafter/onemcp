/**
 * Logging infrastructure using pino
 */

import pino, { Logger as PinoLogger, LoggerOptions } from 'pino';
import { existsSync, mkdirSync } from 'fs';

/**
 * Log level type
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Logger configuration
 */
export interface LoggerConfig {
  /** Log level */
  level: LogLevel;
  /** Enable console output */
  console: boolean;
  /** Enable file output */
  file?: {
    /** File path */
    path: string;
    /** Enable rotation */
    rotate?: boolean;
  };
  /** Pretty print for development */
  pretty?: boolean;
  /** Include timestamps */
  timestamp?: boolean;
}

/**
 * Logger wrapper around pino
 */
export class Logger {
  private logger: PinoLogger;
  private config: LoggerConfig;

  constructor(config: LoggerConfig) {
    this.config = config;
    this.logger = this.createLogger();
  }

  /**
   * Create pino logger instance
   */
  private createLogger(): PinoLogger {
    const options: LoggerOptions = {
      level: this.config.level,
      timestamp: this.config.timestamp !== false ? pino.stdTimeFunctions.isoTime : false,
      formatters: {
        level: (label) => {
          return { level: label.toUpperCase() };
        },
      },
    };

    // Create targets for multiple outputs
    const targets: Array<{
      target: string;
      level: LogLevel;
      options: Record<string, unknown>;
    }> = [];

    // Console output
    if (this.config.console) {
      targets.push({
        target: this.config.pretty ? 'pino-pretty' : 'pino/file',
        level: this.config.level,
        options: this.config.pretty
          ? {
              colorize: true,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname',
            }
          : { destination: 1 }, // stdout
      });
    }

    // File output
    if (this.config.file) {
      // Ensure log directory exists
      const logDir = this.config.file.path.substring(0, this.config.file.path.lastIndexOf('/'));
      if (logDir && !existsSync(logDir)) {
        mkdirSync(logDir, { recursive: true });
      }

      targets.push({
        target: 'pino/file',
        level: this.config.level,
        options: {
          destination: this.config.file.path,
          mkdir: true,
        },
      });
    }

    // If multiple targets, use pino.transport
    // Note: pino.transport returns ThreadStream which is typed as 'any' in pino's own type definitions
    // This is a known limitation of the pino library's type system
    if (targets.length > 1) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any -- pino.transport returns ThreadStream (any) which is compatible
      return pino(options, pino.transport({ targets } as any));
    } else if (targets.length === 1) {
      const target = targets[0];
      if (target) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any -- pino.transport returns ThreadStream (any) which is compatible
        return pino(options, pino.transport(target as any));
      }
      // Fallback if somehow target is undefined even though length is 1
      return pino(options);
    } else {
      // No output configured, use default
      return pino(options);
    }
  }

  /**
   * Log debug message
   */
  debug(message: string, context?: Record<string, unknown>): void {
    if (context) {
      this.logger.debug(context, message);
    } else {
      this.logger.debug(message);
    }
  }

  /**
   * Log info message
   */
  info(message: string, context?: Record<string, unknown>): void {
    if (context) {
      this.logger.info(context, message);
    } else {
      this.logger.info(message);
    }
  }

  /**
   * Log warning message
   */
  warn(message: string, context?: Record<string, unknown>): void {
    if (context) {
      this.logger.warn(context, message);
    } else {
      this.logger.warn(message);
    }
  }

  /**
   * Log error message
   */
  error(message: string, context?: Record<string, unknown>): void {
    if (context) {
      this.logger.error(context, message);
    } else {
      this.logger.error(message);
    }
  }

  /**
   * Create child logger with additional context
   */
  child(bindings: Record<string, unknown>): Logger {
    const childLogger = new Logger(this.config);
    childLogger.logger = this.logger.child(bindings);
    return childLogger;
  }

  /**
   * Change log level at runtime
   */
  setLevel(level: LogLevel): void {
    this.config.level = level;
    this.logger.level = level;
  }

  /**
   * Get current log level
   */
  getLevel(): LogLevel {
    return this.config.level;
  }

  /**
   * Flush log buffers
   */
  async flush(): Promise<void> {
    return new Promise((resolve) => {
      this.logger.flush(() => resolve());
    });
  }

  /**
   * Get underlying pino logger (for advanced usage)
   */
  getPinoLogger(): PinoLogger {
    return this.logger;
  }
}

/**
 * Create a logger instance
 */
export function createLogger(config: LoggerConfig): Logger {
  return new Logger(config);
}
