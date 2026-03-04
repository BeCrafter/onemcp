/**
 * MetricsService - High-level API for metrics collection and querying
 * 
 * Requirements:
 * - 34.4: Provide API to query collected metrics
 * - 38.9: Support metrics aggregation by service, tool, session
 */

import { MetricsCollector } from './collector.js';
import type {
  SystemMetrics,
  ServiceMetrics,
  ToolCallMetrics,
  SessionMetrics,
  MetricsQueryOptions,
  MetricsConfig,
  ConnectionPoolMetrics,
} from '../types/metrics.js';

/**
 * MetricsService provides a high-level API for metrics operations
 */
export class MetricsService {
  private collector: MetricsCollector;

  constructor(config: MetricsConfig) {
    this.collector = new MetricsCollector(config);
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
    this.collector.recordToolCall(toolName, serviceName, executionTime, success, sessionId);
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
    this.collector.recordError(errorCode, errorType, serviceName, sessionId);
  }

  /**
   * Update connection pool metrics
   */
  updateConnectionPoolMetrics(metrics: ConnectionPoolMetrics): void {
    this.collector.updateConnectionPoolMetrics(metrics);
  }

  /**
   * Register a new session
   */
  registerSession(sessionId: string, agentId?: string): void {
    this.collector.registerSession(sessionId, agentId);
  }

  /**
   * Unregister a session
   */
  unregisterSession(sessionId: string): void {
    this.collector.unregisterSession(sessionId);
  }

  /**
   * Get system-wide metrics
   */
  getSystemMetrics(): SystemMetrics {
    return this.collector.getSystemMetrics();
  }

  /**
   * Get metrics for a specific service
   */
  getServiceMetrics(serviceName: string): ServiceMetrics | undefined {
    return this.collector.getServiceMetrics(serviceName);
  }

  /**
   * Get metrics for all services
   */
  getAllServiceMetrics(): ServiceMetrics[] {
    return this.collector.getSystemMetrics().services;
  }

  /**
   * Get metrics for a specific tool
   * 
   * @param toolName - The tool name to query
   * @param serviceName - Optional service name to filter by
   * @returns Array of tool metrics (one per service if serviceName not specified)
   */
  getToolMetrics(toolName: string, serviceName?: string): ToolCallMetrics[] {
    return this.collector.getToolMetrics(toolName, serviceName);
  }

  /**
   * Get metrics for a specific session
   */
  getSessionMetrics(sessionId: string): SessionMetrics | undefined {
    return this.collector.getSessionMetrics(sessionId);
  }

  /**
   * Get metrics for all sessions
   */
  getAllSessionMetrics(): SessionMetrics[] {
    return this.collector.getSystemMetrics().sessions;
  }

  /**
   * Query metrics with filters
   * 
   * Supports filtering by:
   * - serviceName: Filter by specific service
   * - toolName: Filter by specific tool
   * - sessionId: Filter by specific session
   * - startTime: Filter records after this time
   * - endTime: Filter records before this time
   */
  queryMetrics(options: MetricsQueryOptions): SystemMetrics {
    return this.collector.queryMetrics(options);
  }

  /**
   * Get metrics aggregated by service
   */
  getMetricsByService(): Map<string, ServiceMetrics> {
    const services = this.collector.getSystemMetrics().services;
    const map = new Map<string, ServiceMetrics>();
    
    for (const service of services) {
      map.set(service.serviceName, service);
    }
    
    return map;
  }

  /**
   * Get metrics aggregated by tool
   */
  getMetricsByTool(): Map<string, ToolCallMetrics[]> {
    const services = this.collector.getSystemMetrics().services;
    const map = new Map<string, ToolCallMetrics[]>();
    
    for (const service of services) {
      for (const tool of service.toolCalls) {
        if (!map.has(tool.toolName)) {
          map.set(tool.toolName, []);
        }
        map.get(tool.toolName)!.push(tool);
      }
    }
    
    return map;
  }

  /**
   * Get metrics aggregated by session
   */
  getMetricsBySession(): Map<string, SessionMetrics> {
    const sessions = this.collector.getSystemMetrics().sessions;
    const map = new Map<string, SessionMetrics>();
    
    for (const session of sessions) {
      map.set(session.sessionId, session);
    }
    
    return map;
  }

  /**
   * Get top N tools by call count
   */
  getTopToolsByCallCount(limit: number = 10): ToolCallMetrics[] {
    const allTools: ToolCallMetrics[] = [];
    const services = this.collector.getSystemMetrics().services;
    
    for (const service of services) {
      allTools.push(...service.toolCalls);
    }
    
    return allTools
      .sort((a, b) => b.callCount - a.callCount)
      .slice(0, limit);
  }

  /**
   * Get top N tools by error rate
   */
  getTopToolsByErrorRate(limit: number = 10): ToolCallMetrics[] {
    const allTools: ToolCallMetrics[] = [];
    const services = this.collector.getSystemMetrics().services;
    
    for (const service of services) {
      allTools.push(...service.toolCalls);
    }
    
    return allTools
      .filter((t) => t.callCount > 0)
      .sort((a, b) => {
        const errorRateA = a.errorCount / a.callCount;
        const errorRateB = b.errorCount / b.callCount;
        return errorRateB - errorRateA;
      })
      .slice(0, limit);
  }

  /**
   * Get top N tools by average execution time
   */
  getTopToolsByExecutionTime(limit: number = 10): ToolCallMetrics[] {
    const allTools: ToolCallMetrics[] = [];
    const services = this.collector.getSystemMetrics().services;
    
    for (const service of services) {
      allTools.push(...service.toolCalls);
    }
    
    return allTools
      .sort((a, b) => b.avgExecutionTime - a.avgExecutionTime)
      .slice(0, limit);
  }

  /**
   * Get summary statistics
   */
  getSummary(): {
    totalServices: number;
    totalTools: number;
    totalSessions: number;
    totalRequests: number;
    successRate: number;
    avgResponseTime: number;
    uptime: number;
  } {
    const metrics = this.collector.getSystemMetrics();
    
    const totalTools = metrics.services.reduce(
      (sum, s) => sum + s.toolCalls.length,
      0
    );
    
    const successRate =
      metrics.totalRequests > 0
        ? (metrics.successfulRequests / metrics.totalRequests) * 100
        : 0;
    
    return {
      totalServices: metrics.services.length,
      totalTools,
      totalSessions: metrics.sessions.length,
      totalRequests: metrics.totalRequests,
      successRate,
      avgResponseTime: metrics.avgResponseTime,
      uptime: metrics.uptime,
    };
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.collector.reset();
  }

  /**
   * Stop the metrics service
   */
  stop(): void {
    this.collector.stop();
  }

  /**
   * Get the underlying collector (for advanced use cases)
   */
  getCollector(): MetricsCollector {
    return this.collector;
  }
}
