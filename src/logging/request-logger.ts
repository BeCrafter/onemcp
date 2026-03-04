/**
 * Request logging functionality
 */

import { Logger } from './logger.js';
import { DataMasker } from './data-masker.js';

/**
 * Request log context
 */
export interface RequestLogContext {
  /** Request ID */
  requestId: string;
  /** Correlation ID */
  correlationId: string;
  /** Session ID (optional) */
  sessionId?: string;
  /** Agent ID (optional) */
  agentId?: string;
  /** Tool name */
  toolName?: string;
  /** Service name */
  serviceName?: string;
  /** Additional context */
  [key: string]: unknown;
}

/**
 * Request logger configuration
 */
export interface RequestLoggerConfig {
  /** Enable input logging */
  logInput: boolean;
  /** Enable output logging */
  logOutput: boolean;
  /** Enable timing logging */
  logTiming: boolean;
}

/**
 * Request logger for tracking tool calls and service operations
 */
export class RequestLogger {
  private logger: Logger;
  private masker: DataMasker;
  private config: RequestLoggerConfig;

  constructor(logger: Logger, masker: DataMasker, config: RequestLoggerConfig) {
    this.logger = logger;
    this.masker = masker;
    this.config = config;
  }

  /**
   * Log request received
   */
  logRequestReceived(context: RequestLogContext, input?: unknown): void {
    const logContext: Record<string, unknown> = {
      ...context,
      event: 'request_received',
      timestamp: new Date().toISOString(),
    };

    if (this.config.logInput && input !== undefined) {
      logContext['input'] = this.masker.maskObject(input);
    }

    this.logger.info('Request received', logContext);
  }

  /**
   * Log request routed
   */
  logRequestRouted(
    context: RequestLogContext,
    routingInfo: {
      poolId: string;
      connectionId: string;
      reason: string;
    }
  ): void {
    const logContext: Record<string, unknown> = {
      ...context,
      event: 'request_routed',
      timestamp: new Date().toISOString(),
      routing: routingInfo,
    };

    this.logger.debug('Request routed', logContext);
  }

  /**
   * Log request completed
   */
  logRequestCompleted(
    context: RequestLogContext,
    result: {
      status: 'success' | 'error' | 'timeout';
      duration: number;
      output?: unknown;
      error?: {
        code: number;
        message: string;
        stack?: string;
      };
    }
  ): void {
    const logContext: Record<string, unknown> = {
      ...context,
      event: 'request_completed',
      timestamp: new Date().toISOString(),
      status: result.status,
    };

    if (this.config.logTiming) {
      logContext['duration'] = result.duration;
    }

    if (this.config.logOutput && result.output !== undefined) {
      logContext['output'] = this.masker.maskObject(result.output);
    }

    if (result.error) {
      logContext['error'] = {
        code: result.error.code,
        message: this.masker.maskString(result.error.message),
        ...(result.error.stack && { stack: result.error.stack }),
      };
    }

    if (result.status === 'error') {
      this.logger.error('Request failed', logContext);
    } else if (result.status === 'timeout') {
      this.logger.warn('Request timeout', logContext);
    } else {
      this.logger.info('Request completed', logContext);
    }
  }

  /**
   * Log service lifecycle event
   */
  logServiceEvent(
    event: 'registered' | 'unregistered' | 'connected' | 'disconnected' | 'error',
    serviceName: string,
    details?: Record<string, unknown>
  ): void {
    const logContext: Record<string, unknown> = {
      event: `service_${event}`,
      serviceName,
      timestamp: new Date().toISOString(),
      ...details,
    };

    if (event === 'error') {
      this.logger.error(`Service ${event}`, logContext);
    } else {
      this.logger.info(`Service ${event}`, logContext);
    }
  }

  /**
   * Log connection pool event
   */
  logPoolEvent(
    event: 'acquired' | 'released' | 'created' | 'closed' | 'exhausted',
    poolId: string,
    details?: Record<string, unknown>
  ): void {
    const logContext: Record<string, unknown> = {
      event: `pool_${event}`,
      poolId,
      timestamp: new Date().toISOString(),
      ...details,
    };

    if (event === 'exhausted') {
      this.logger.warn(`Connection pool ${event}`, logContext);
    } else {
      this.logger.debug(`Connection pool ${event}`, logContext);
    }
  }

  /**
   * Log health check event
   */
  logHealthCheck(
    serviceName: string,
    result: {
      healthy: boolean;
      duration: number;
      error?: string;
    }
  ): void {
    const logContext: Record<string, unknown> = {
      event: 'health_check',
      serviceName,
      healthy: result.healthy,
      duration: result.duration,
      timestamp: new Date().toISOString(),
      ...(result.error && { error: result.error }),
    };

    if (result.healthy) {
      this.logger.debug('Health check passed', logContext);
    } else {
      this.logger.warn('Health check failed', logContext);
    }
  }

  /**
   * Log tool state change
   */
  logToolStateChange(
    toolName: string,
    enabled: boolean,
    reason?: string
  ): void {
    const logContext: Record<string, unknown> = {
      event: 'tool_state_changed',
      toolName,
      enabled,
      timestamp: new Date().toISOString(),
      ...(reason && { reason }),
    };

    this.logger.info('Tool state changed', logContext);
  }

  /**
   * Log configuration change
   */
  logConfigChange(
    changeType: 'loaded' | 'saved' | 'reloaded' | 'validated',
    details?: Record<string, unknown>
  ): void {
    const logContext: Record<string, unknown> = {
      event: `config_${changeType}`,
      timestamp: new Date().toISOString(),
      ...details,
    };

    this.logger.info(`Configuration ${changeType}`, logContext);
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<RequestLoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * Create a request logger instance
 */
export function createRequestLogger(
  logger: Logger,
  masker: DataMasker,
  config: RequestLoggerConfig
): RequestLogger {
  return new RequestLogger(logger, masker, config);
}
