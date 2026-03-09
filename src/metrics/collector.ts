/**
 * MetricsCollector - Collects and aggregates system metrics
 *
 * Requirements:
 * - 34.1: Track tool call counts and execution times
 * - 34.2: Track connection pool statistics
 * - 34.3: Track error rates and types
 * - 34.4: Provide API to query collected metrics
 * - 34.5: Support configurable collection interval and retention period
 */

import {
  ToolCallMetrics,
  ConnectionPoolMetrics,
  ErrorMetrics,
  ServiceMetrics,
  SessionMetrics,
  SystemMetrics,
  MetricsQueryOptions,
  MetricsConfig,
} from '../types/metrics.js';

/**
 * Tool call record for tracking
 */
interface ToolCallRecord {
  toolName: string;
  serviceName: string;
  executionTime: number;
  success: boolean;
  timestamp: Date;
  sessionId?: string;
}

/**
 * Error record for tracking
 */
interface ErrorRecord {
  errorCode: number;
  errorType: string;
  timestamp: Date;
  serviceName?: string;
  sessionId?: string;
}

/**
 * Session activity record
 */
interface SessionActivity {
  sessionId: string;
  agentId?: string;
  requests: number;
  successfulRequests: number;
  failedRequests: number;
  totalResponseTime: number;
  createdAt: Date;
  lastActivity: Date;
}

/**
 * MetricsCollector class
 */
export class MetricsCollector {
  private config: MetricsConfig;
  private startTime: Date;
  private toolCallRecords: ToolCallRecord[] = [];
  private errorRecords: ErrorRecord[] = [];
  private sessionActivities: Map<string, SessionActivity> = new Map();
  private connectionPoolSnapshots: Map<string, ConnectionPoolMetrics> = new Map();
  private cleanupInterval?: NodeJS.Timeout;

  constructor(config: MetricsConfig) {
    this.config = config;
    this.startTime = new Date();

    if (this.config.enabled) {
      this.startCleanupInterval();
    }
  }

  /**
   * Record a tool call
   */
  recordToolCall(
    toolName: string,
    serviceName: string,
    executionTime: number,
    success: boolean,
    sessionId?: string
  ): void {
    if (!this.config.enabled) return;

    const record: ToolCallRecord = {
      toolName,
      serviceName,
      executionTime,
      success,
      timestamp: new Date(),
      ...(sessionId !== undefined && { sessionId }),
    };

    this.toolCallRecords.push(record);

    // Update session activity
    if (sessionId) {
      this.updateSessionActivity(sessionId, executionTime, success);
    }
  }

  /**
   * Record an error
   */
  recordError(
    errorCode: number,
    errorType: string,
    serviceName?: string,
    sessionId?: string
  ): void {
    if (!this.config.enabled) return;

    const record: ErrorRecord = {
      errorCode,
      errorType,
      timestamp: new Date(),
      ...(serviceName !== undefined && { serviceName }),
      ...(sessionId !== undefined && { sessionId }),
    };

    this.errorRecords.push(record);

    // Update session activity for failed request
    if (sessionId) {
      this.updateSessionActivity(sessionId, 0, false);
    }
  }

  /**
   * Update connection pool snapshot
   */
  updateConnectionPoolMetrics(metrics: ConnectionPoolMetrics): void {
    if (!this.config.enabled) return;

    this.connectionPoolSnapshots.set(metrics.serviceName, metrics);
  }

  /**
   * Register a new session
   */
  registerSession(sessionId: string, agentId?: string): void {
    if (!this.config.enabled) return;

    if (!this.sessionActivities.has(sessionId)) {
      const activity: SessionActivity = {
        sessionId,
        requests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        totalResponseTime: 0,
        createdAt: new Date(),
        lastActivity: new Date(),
      };
      if (agentId !== undefined) {
        activity.agentId = agentId;
      }
      this.sessionActivities.set(sessionId, activity);
    }
  }

  /**
   * Unregister a session
   */
  unregisterSession(sessionId: string): void {
    this.sessionActivities.delete(sessionId);
  }

  /**
   * Get system-wide metrics
   */
  getSystemMetrics(): SystemMetrics {
    const now = new Date();
    const uptime = now.getTime() - this.startTime.getTime();

    // Calculate total requests
    const totalRequests = this.toolCallRecords.length;
    const successfulRequests = this.toolCallRecords.filter((r) => r.success).length;
    const failedRequests = totalRequests - successfulRequests;

    // Calculate average response time
    const totalResponseTime = this.toolCallRecords.reduce((sum, r) => sum + r.executionTime, 0);
    const avgResponseTime = totalRequests > 0 ? totalResponseTime / totalRequests : 0;

    // Aggregate service metrics
    const services = this.aggregateServiceMetrics();

    // Aggregate session metrics
    const sessions = this.aggregateSessionMetrics();

    // Aggregate error metrics
    const errors = this.aggregateErrorMetrics();

    return {
      uptime,
      totalRequests,
      successfulRequests,
      failedRequests,
      avgResponseTime,
      services,
      sessions,
      errors,
    };
  }

  /**
   * Get metrics for a specific service
   */
  getServiceMetrics(serviceName: string): ServiceMetrics | undefined {
    const services = this.aggregateServiceMetrics();
    return services.find((s) => s.serviceName === serviceName);
  }

  /**
   * Get metrics for a specific tool
   */
  getToolMetrics(toolName: string, serviceName?: string): ToolCallMetrics[] {
    const serviceMetrics = serviceName
      ? [this.getServiceMetrics(serviceName)].filter(Boolean)
      : this.aggregateServiceMetrics();

    const toolMetrics: ToolCallMetrics[] = [];

    for (const service of serviceMetrics) {
      if (service) {
        const tool = service.toolCalls.find((t) => t.toolName === toolName);
        if (tool) {
          toolMetrics.push(tool);
        }
      }
    }

    return toolMetrics;
  }

  /**
   * Get metrics for a specific session
   */
  getSessionMetrics(sessionId: string): SessionMetrics | undefined {
    const activity = this.sessionActivities.get(sessionId);
    if (!activity) return undefined;

    const metrics: SessionMetrics = {
      sessionId: activity.sessionId,
      totalRequests: activity.requests,
      successfulRequests: activity.successfulRequests,
      failedRequests: activity.failedRequests,
      avgResponseTime: activity.requests > 0 ? activity.totalResponseTime / activity.requests : 0,
      createdAt: activity.createdAt,
      lastActivity: activity.lastActivity,
    };

    if (activity.agentId !== undefined) {
      metrics.agentId = activity.agentId;
    }

    return metrics;
  }

  /**
   * Query metrics with filters
   */
  queryMetrics(options: MetricsQueryOptions): SystemMetrics {
    // Filter tool call records
    let filteredRecords = this.toolCallRecords;

    if (options.serviceName) {
      filteredRecords = filteredRecords.filter((r) => r.serviceName === options.serviceName);
    }

    if (options.toolName) {
      filteredRecords = filteredRecords.filter((r) => r.toolName === options.toolName);
    }

    if (options.sessionId) {
      filteredRecords = filteredRecords.filter((r) => r.sessionId === options.sessionId);
    }

    if (options.startTime) {
      const startTime = options.startTime;
      filteredRecords = filteredRecords.filter((r) => r.timestamp >= startTime);
    }

    if (options.endTime) {
      const endTime = options.endTime;
      filteredRecords = filteredRecords.filter((r) => r.timestamp <= endTime);
    }

    // Create a temporary collector with filtered data
    const tempCollector = new MetricsCollector(this.config);
    tempCollector.toolCallRecords = filteredRecords;
    tempCollector.startTime = this.startTime;

    // Copy relevant connection pool snapshots
    if (options.serviceName) {
      const snapshot = this.connectionPoolSnapshots.get(options.serviceName);
      if (snapshot) {
        tempCollector.connectionPoolSnapshots.set(options.serviceName, snapshot);
      }
    } else {
      tempCollector.connectionPoolSnapshots = new Map(this.connectionPoolSnapshots);
    }

    // Copy relevant session activities
    if (options.sessionId) {
      const activity = this.sessionActivities.get(options.sessionId);
      if (activity) {
        tempCollector.sessionActivities.set(options.sessionId, activity);
      }
    } else {
      tempCollector.sessionActivities = new Map(this.sessionActivities);
    }

    // Filter error records
    let filteredErrors = this.errorRecords;
    if (options.serviceName) {
      filteredErrors = filteredErrors.filter((e) => e.serviceName === options.serviceName);
    }
    if (options.sessionId) {
      filteredErrors = filteredErrors.filter((e) => e.sessionId === options.sessionId);
    }
    if (options.startTime) {
      const startTime = options.startTime;
      filteredErrors = filteredErrors.filter((e) => e.timestamp >= startTime);
    }
    if (options.endTime) {
      const endTime = options.endTime;
      filteredErrors = filteredErrors.filter((e) => e.timestamp <= endTime);
    }
    tempCollector.errorRecords = filteredErrors;

    return tempCollector.getSystemMetrics();
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.toolCallRecords = [];
    this.errorRecords = [];
    this.sessionActivities.clear();
    this.connectionPoolSnapshots.clear();
    this.startTime = new Date();
  }

  /**
   * Stop the metrics collector
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      delete this.cleanupInterval;
    }
  }

  /**
   * Update session activity
   */
  private updateSessionActivity(sessionId: string, responseTime: number, success: boolean): void {
    let activity = this.sessionActivities.get(sessionId);

    if (!activity) {
      activity = {
        sessionId,
        requests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        totalResponseTime: 0,
        createdAt: new Date(),
        lastActivity: new Date(),
      };
      this.sessionActivities.set(sessionId, activity);
    }

    activity.requests++;
    activity.totalResponseTime += responseTime;
    activity.lastActivity = new Date();

    if (success) {
      activity.successfulRequests++;
    } else {
      activity.failedRequests++;
    }
  }

  /**
   * Aggregate service metrics
   */
  private aggregateServiceMetrics(): ServiceMetrics[] {
    const serviceMap = new Map<string, ServiceMetrics>();

    // Group tool calls by service
    for (const record of this.toolCallRecords) {
      if (!serviceMap.has(record.serviceName)) {
        serviceMap.set(record.serviceName, {
          serviceName: record.serviceName,
          toolCalls: [],
          connectionPool: this.connectionPoolSnapshots.get(record.serviceName) || {
            serviceName: record.serviceName,
            totalConnections: 0,
            idleConnections: 0,
            busyConnections: 0,
            waitingRequests: 0,
            totalAcquired: 0,
            totalReleased: 0,
            totalCreated: 0,
            totalClosed: 0,
          },
          errors: [],
        });
      }
    }

    // Aggregate tool call metrics
    for (const [serviceName, serviceMetrics] of serviceMap) {
      const serviceRecords = this.toolCallRecords.filter((r) => r.serviceName === serviceName);

      // Group by tool name
      const toolMap = new Map<string, ToolCallRecord[]>();
      for (const record of serviceRecords) {
        let toolRecords = toolMap.get(record.toolName);
        if (!toolRecords) {
          toolRecords = [];
          toolMap.set(record.toolName, toolRecords);
        }
        toolRecords.push(record);
      }

      // Calculate metrics for each tool
      for (const [toolName, records] of toolMap) {
        const executionTimes = records.map((r) => r.executionTime);
        const errorCount = records.filter((r) => !r.success).length;
        const lastRecord = records[records.length - 1];

        const toolMetrics: ToolCallMetrics = {
          toolName,
          serviceName,
          callCount: records.length,
          totalExecutionTime: executionTimes.reduce((sum, t) => sum + t, 0),
          minExecutionTime: Math.min(...executionTimes),
          maxExecutionTime: Math.max(...executionTimes),
          avgExecutionTime: executionTimes.reduce((sum, t) => sum + t, 0) / executionTimes.length,
          errorCount,
        };

        if (lastRecord !== undefined) {
          toolMetrics.lastCalled = lastRecord.timestamp;
        }

        serviceMetrics.toolCalls.push(toolMetrics);
      }

      // Aggregate errors for this service
      const serviceErrors = this.errorRecords.filter((e) => e.serviceName === serviceName);
      serviceMetrics.errors = this.aggregateErrorMetricsForRecords(serviceErrors);
    }

    return Array.from(serviceMap.values());
  }

  /**
   * Aggregate session metrics
   */
  private aggregateSessionMetrics(): SessionMetrics[] {
    const sessions: SessionMetrics[] = [];

    for (const activity of this.sessionActivities.values()) {
      const metrics: SessionMetrics = {
        sessionId: activity.sessionId,
        totalRequests: activity.requests,
        successfulRequests: activity.successfulRequests,
        failedRequests: activity.failedRequests,
        avgResponseTime: activity.requests > 0 ? activity.totalResponseTime / activity.requests : 0,
        createdAt: activity.createdAt,
        lastActivity: activity.lastActivity,
      };

      if (activity.agentId !== undefined) {
        metrics.agentId = activity.agentId;
      }

      sessions.push(metrics);
    }

    return sessions;
  }

  /**
   * Aggregate error metrics
   */
  private aggregateErrorMetrics(): ErrorMetrics[] {
    return this.aggregateErrorMetricsForRecords(this.errorRecords);
  }

  /**
   * Aggregate error metrics for a set of error records
   */
  private aggregateErrorMetricsForRecords(records: ErrorRecord[]): ErrorMetrics[] {
    const errorMap = new Map<string, ErrorMetrics>();

    for (const record of records) {
      const key = `${record.errorCode}-${record.errorType}`;

      let metrics = errorMap.get(key);
      if (!metrics) {
        metrics = {
          errorCode: record.errorCode,
          errorType: record.errorType,
          count: 0,
        };
        errorMap.set(key, metrics);
      }

      metrics.count++;
      metrics.lastOccurred = record.timestamp;
    }

    return Array.from(errorMap.values());
  }

  /**
   * Start cleanup interval to remove old records
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldRecords();
    }, this.config.collectionInterval);
  }

  /**
   * Clean up old records based on retention period
   */
  private cleanupOldRecords(): void {
    const now = new Date();
    const cutoffTime = new Date(now.getTime() - this.config.retentionPeriod);

    // Remove old tool call records
    this.toolCallRecords = this.toolCallRecords.filter((r) => r.timestamp >= cutoffTime);

    // Remove old error records
    this.errorRecords = this.errorRecords.filter((e) => e.timestamp >= cutoffTime);
  }
}
