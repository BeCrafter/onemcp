/**
 * Audit logging functionality
 */

import { Logger } from './logger.js';
import { DataMasker } from './data-masker.js';
import { AuditLogEntry, ExecutionStatus } from '../types/audit.js';

/**
 * Audit log level
 */
export type AuditLevel = 'minimal' | 'standard' | 'verbose';

/**
 * Audit logger configuration
 */
export interface AuditLoggerConfig {
  /** Enable audit logging */
  enabled: boolean;
  /** Audit log level */
  level: AuditLevel;
  /** Log input parameters */
  logInput: boolean;
  /** Log output results */
  logOutput: boolean;
  /** Retention policy */
  retention?: {
    /** Retention days */
    days: number;
    /** Maximum size */
    maxSize: string;
  };
}

/**
 * Audit log filter criteria
 */
export interface AuditLogFilter {
  /** Filter by session ID */
  sessionId?: string;
  /** Filter by agent ID */
  agentId?: string;
  /** Filter by request ID */
  requestId?: string;
  /** Filter by tool name */
  toolName?: string;
  /** Filter by service name */
  serviceName?: string;
  /** Filter by time range */
  timeRange?: {
    start: Date;
    end: Date;
  };
  /** Filter by execution status */
  status?: ExecutionStatus;
}

/**
 * Audit logger for detailed request tracking
 */
export class AuditLogger {
  private logger: Logger;
  private masker: DataMasker;
  private config: AuditLoggerConfig;
  private auditEntries: AuditLogEntry[] = [];

  constructor(logger: Logger, masker: DataMasker, config: AuditLoggerConfig) {
    this.logger = logger;
    this.masker = masker;
    this.config = config;
  }

  /**
   * Log an audit entry
   */
  logAuditEntry(entry: AuditLogEntry): void {
    if (!this.config.enabled) {
      return;
    }

    // Create a copy to avoid mutation
    const auditEntry: AuditLogEntry = { ...entry };

    // Apply data masking
    if (auditEntry.input && !this.config.logInput) {
      delete auditEntry.input;
    } else if (auditEntry.input) {
      auditEntry.input = this.masker.maskObject(auditEntry.input);
    }

    if (auditEntry.output && !this.config.logOutput) {
      delete auditEntry.output;
    } else if (auditEntry.output) {
      auditEntry.output = this.masker.maskObject(auditEntry.output);
    }

    // Mask error messages
    if (auditEntry.error) {
      auditEntry.error.message = this.masker.maskString(auditEntry.error.message);
    }

    // Log based on level
    const logContext = this.formatAuditEntry(auditEntry);

    if (auditEntry.status === 'error') {
      this.logger.error('Audit: Request failed', logContext);
    } else if (auditEntry.status === 'timeout') {
      this.logger.warn('Audit: Request timeout', logContext);
    } else {
      this.logger.info('Audit: Request completed', logContext);
    }

    // Store in memory (for querying)
    this.auditEntries.push(auditEntry);

    // Apply retention policy
    this.applyRetention();
  }

  /**
   * Format audit entry based on level
   */
  private formatAuditEntry(entry: AuditLogEntry): Record<string, unknown> {
    const base = {
      audit: true,
      requestId: entry.requestId,
      correlationId: entry.correlationId,
      toolName: entry.toolName,
      serviceName: entry.serviceName,
      status: entry.status,
      duration: entry.duration,
    };

    if (this.config.level === 'minimal') {
      return base;
    }

    const standard = {
      ...base,
      sessionId: entry.sessionId,
      agentId: entry.agentId,
      connectionId: entry.connectionId,
      receivedAt: entry.receivedAt.toISOString(),
      completedAt: entry.completedAt.toISOString(),
      ...(entry.error && { error: entry.error }),
    };

    if (this.config.level === 'standard') {
      return standard;
    }

    // Verbose
    const result: Record<string, unknown> = {
      ...standard,
      routedAt: entry.routedAt.toISOString(),
      routingDecision: entry.routingDecision,
    };

    if (entry.input !== undefined) {
      result['input'] = entry.input;
    }
    if (entry.output !== undefined) {
      result['output'] = entry.output;
    }

    return result;
  }

  /**
   * Query audit logs
   */
  queryLogs(filter: AuditLogFilter): AuditLogEntry[] {
    let results = [...this.auditEntries];

    if (filter.sessionId) {
      results = results.filter((entry) => entry.sessionId === filter.sessionId);
    }

    if (filter.agentId) {
      results = results.filter((entry) => entry.agentId === filter.agentId);
    }

    if (filter.requestId) {
      results = results.filter((entry) => entry.requestId === filter.requestId);
    }

    if (filter.toolName) {
      results = results.filter((entry) => entry.toolName === filter.toolName);
    }

    if (filter.serviceName) {
      results = results.filter((entry) => entry.serviceName === filter.serviceName);
    }

    if (filter.status) {
      results = results.filter((entry) => entry.status === filter.status);
    }

    if (filter.timeRange) {
      results = results.filter(
        (entry) =>
          entry.receivedAt >= filter.timeRange!.start && entry.receivedAt <= filter.timeRange!.end
      );
    }

    return results;
  }

  /**
   * Export audit logs
   */
  exportLogs(filter?: AuditLogFilter, format: 'json' | 'csv' = 'json'): string {
    const logs = filter ? this.queryLogs(filter) : this.auditEntries;

    if (format === 'json') {
      return JSON.stringify(logs, null, 2);
    }

    // CSV format
    if (logs.length === 0) {
      return '';
    }

    const headers = [
      'requestId',
      'correlationId',
      'sessionId',
      'agentId',
      'toolName',
      'serviceName',
      'status',
      'duration',
      'receivedAt',
      'completedAt',
    ];

    const rows = logs.map((entry) => [
      entry.requestId,
      entry.correlationId,
      entry.sessionId || '',
      entry.agentId || '',
      entry.toolName,
      entry.serviceName,
      entry.status,
      entry.duration.toString(),
      entry.receivedAt.toISOString(),
      entry.completedAt.toISOString(),
    ]);

    return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
  }

  /**
   * Clear audit logs
   */
  clearLogs(): void {
    this.auditEntries = [];
  }

  /**
   * Apply retention policy
   */
  private applyRetention(): void {
    if (!this.config.retention) {
      return;
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.retention.days);

    this.auditEntries = this.auditEntries.filter((entry) => entry.receivedAt >= cutoffDate);

    // Note: maxSize enforcement would require tracking actual size
    // For now, we just keep entries within the time window
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<AuditLoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get audit statistics
   */
  getStatistics(): {
    totalRequests: number;
    successCount: number;
    errorCount: number;
    timeoutCount: number;
    averageDuration: number;
  } {
    const total = this.auditEntries.length;
    const success = this.auditEntries.filter((e) => e.status === 'success').length;
    const error = this.auditEntries.filter((e) => e.status === 'error').length;
    const timeout = this.auditEntries.filter((e) => e.status === 'timeout').length;
    const avgDuration =
      total > 0 ? this.auditEntries.reduce((sum, e) => sum + e.duration, 0) / total : 0;

    return {
      totalRequests: total,
      successCount: success,
      errorCount: error,
      timeoutCount: timeout,
      averageDuration: avgDuration,
    };
  }
}

/**
 * Create an audit logger instance
 */
export function createAuditLogger(
  logger: Logger,
  masker: DataMasker,
  config: AuditLoggerConfig
): AuditLogger {
  return new AuditLogger(logger, masker, config);
}
