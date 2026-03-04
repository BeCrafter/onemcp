/**
 * Metrics types for the MCP Router System
 */

/**
 * Tool call metrics
 */
export interface ToolCallMetrics {
  toolName: string;
  serviceName: string;
  callCount: number;
  totalExecutionTime: number; // milliseconds
  minExecutionTime: number;
  maxExecutionTime: number;
  avgExecutionTime: number;
  errorCount: number;
  lastCalled?: Date;
}

/**
 * Connection pool metrics
 */
export interface ConnectionPoolMetrics {
  serviceName: string;
  totalConnections: number;
  idleConnections: number;
  busyConnections: number;
  waitingRequests: number;
  totalAcquired: number;
  totalReleased: number;
  totalCreated: number;
  totalClosed: number;
}

/**
 * Error metrics
 */
export interface ErrorMetrics {
  errorCode: number;
  errorType: string;
  count: number;
  lastOccurred?: Date;
}

/**
 * Service-level metrics aggregation
 */
export interface ServiceMetrics {
  serviceName: string;
  toolCalls: ToolCallMetrics[];
  connectionPool: ConnectionPoolMetrics;
  errors: ErrorMetrics[];
}

/**
 * Session-level metrics aggregation
 */
export interface SessionMetrics {
  sessionId: string;
  agentId?: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgResponseTime: number;
  createdAt: Date;
  lastActivity: Date;
}

/**
 * System-wide metrics
 */
export interface SystemMetrics {
  uptime: number; // milliseconds
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgResponseTime: number;
  services: ServiceMetrics[];
  sessions: SessionMetrics[];
  errors: ErrorMetrics[];
}

/**
 * Metrics query options
 */
export interface MetricsQueryOptions {
  serviceName?: string;
  toolName?: string;
  sessionId?: string;
  startTime?: Date;
  endTime?: Date;
}

/**
 * Metrics configuration
 */
export interface MetricsConfig {
  enabled: boolean;
  collectionInterval: number; // milliseconds
  retentionPeriod: number; // milliseconds
}
