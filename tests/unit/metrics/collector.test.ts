/**
 * Unit tests for MetricsCollector
 *
 * Requirements:
 * - 34.1: Track tool call counts and execution times
 * - 34.2: Track connection pool statistics
 * - 34.3: Track error rates and types
 * - 34.4: Provide API to query collected metrics
 * - 34.5: Support configurable collection interval and retention period
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MetricsCollector } from '../../../src/metrics/collector.js';
import type { MetricsConfig, ConnectionPoolMetrics } from '../../../src/types/index.js';

describe('MetricsCollector', () => {
  let collector: MetricsCollector;
  const config: MetricsConfig = {
    enabled: true,
    collectionInterval: 1000,
    retentionPeriod: 5000,
  };

  beforeEach(() => {
    collector = new MetricsCollector(config);
  });

  afterEach(() => {
    collector.stop();
  });

  describe('Tool Call Tracking', () => {
    it('should record tool calls', () => {
      collector.recordToolCall('read_file', 'filesystem', 100, true);
      collector.recordToolCall('write_file', 'filesystem', 150, true);

      const metrics = collector.getSystemMetrics();
      expect(metrics.totalRequests).toBe(2);
      expect(metrics.successfulRequests).toBe(2);
      expect(metrics.failedRequests).toBe(0);
    });

    it('should track execution times', () => {
      collector.recordToolCall('read_file', 'filesystem', 100, true);
      collector.recordToolCall('read_file', 'filesystem', 200, true);
      collector.recordToolCall('read_file', 'filesystem', 150, true);

      const serviceMetrics = collector.getServiceMetrics('filesystem');
      expect(serviceMetrics).toBeDefined();

      const toolMetrics = serviceMetrics!.toolCalls.find((t) => t.toolName === 'read_file');
      expect(toolMetrics).toBeDefined();
      expect(toolMetrics!.callCount).toBe(3);
      expect(toolMetrics!.minExecutionTime).toBe(100);
      expect(toolMetrics!.maxExecutionTime).toBe(200);
      expect(toolMetrics!.avgExecutionTime).toBe(150);
      expect(toolMetrics!.totalExecutionTime).toBe(450);
    });

    it('should track successful and failed calls', () => {
      collector.recordToolCall('read_file', 'filesystem', 100, true);
      collector.recordToolCall('read_file', 'filesystem', 150, false);
      collector.recordToolCall('read_file', 'filesystem', 120, true);

      const serviceMetrics = collector.getServiceMetrics('filesystem');
      const toolMetrics = serviceMetrics!.toolCalls.find((t) => t.toolName === 'read_file');

      expect(toolMetrics!.callCount).toBe(3);
      expect(toolMetrics!.errorCount).toBe(1);
    });

    it('should track last called timestamp', () => {
      const before = new Date();
      collector.recordToolCall('read_file', 'filesystem', 100, true);
      const after = new Date();

      const serviceMetrics = collector.getServiceMetrics('filesystem');
      const toolMetrics = serviceMetrics!.toolCalls.find((t) => t.toolName === 'read_file');

      expect(toolMetrics!.lastCalled).toBeDefined();
      expect(toolMetrics!.lastCalled!.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(toolMetrics!.lastCalled!.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should aggregate metrics by service', () => {
      collector.recordToolCall('read_file', 'filesystem', 100, true);
      collector.recordToolCall('write_file', 'filesystem', 150, true);
      collector.recordToolCall('search', 'github', 200, true);

      const metrics = collector.getSystemMetrics();
      expect(metrics.services).toHaveLength(2);

      const fsMetrics = metrics.services.find((s) => s.serviceName === 'filesystem');
      const ghMetrics = metrics.services.find((s) => s.serviceName === 'github');

      expect(fsMetrics).toBeDefined();
      expect(fsMetrics!.toolCalls).toHaveLength(2);
      expect(ghMetrics).toBeDefined();
      expect(ghMetrics!.toolCalls).toHaveLength(1);
    });

    it('should aggregate metrics by tool', () => {
      collector.recordToolCall('read_file', 'filesystem', 100, true);
      collector.recordToolCall('read_file', 'filesystem', 150, true);

      const toolMetrics = collector.getToolMetrics('read_file');
      expect(toolMetrics).toHaveLength(1);
      expect(toolMetrics[0]?.callCount).toBe(2);
    });
  });

  describe('Error Tracking', () => {
    it('should record errors', () => {
      collector.recordError(-32001, 'TOOL_NOT_FOUND', 'filesystem');
      collector.recordError(-32002, 'TOOL_DISABLED', 'github');

      const metrics = collector.getSystemMetrics();
      expect(metrics.errors).toHaveLength(2);
    });

    it('should aggregate errors by type', () => {
      collector.recordError(-32001, 'TOOL_NOT_FOUND', 'filesystem');
      collector.recordError(-32001, 'TOOL_NOT_FOUND', 'github');
      collector.recordError(-32002, 'TOOL_DISABLED', 'filesystem');

      const metrics = collector.getSystemMetrics();
      expect(metrics.errors).toHaveLength(2);

      const notFoundError = metrics.errors.find((e) => e.errorType === 'TOOL_NOT_FOUND');
      const disabledError = metrics.errors.find((e) => e.errorType === 'TOOL_DISABLED');

      expect(notFoundError).toBeDefined();
      expect(notFoundError!.count).toBe(2);
      expect(disabledError).toBeDefined();
      expect(disabledError!.count).toBe(1);
    });

    it('should track last occurred timestamp', () => {
      const before = new Date();
      collector.recordError(-32001, 'TOOL_NOT_FOUND', 'filesystem');
      const after = new Date();

      const metrics = collector.getSystemMetrics();
      const error = metrics.errors.find((e) => e.errorType === 'TOOL_NOT_FOUND');

      expect(error!.lastOccurred).toBeDefined();
      expect(error!.lastOccurred!.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(error!.lastOccurred!.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('Connection Pool Tracking', () => {
    it('should update connection pool metrics', () => {
      // First record a tool call to create the service
      collector.recordToolCall('read_file', 'filesystem', 100, true);

      const poolMetrics: ConnectionPoolMetrics = {
        serviceName: 'filesystem',
        totalConnections: 5,
        idleConnections: 2,
        busyConnections: 3,
        waitingRequests: 1,
        totalAcquired: 10,
        totalReleased: 7,
        totalCreated: 5,
        totalClosed: 0,
      };

      collector.updateConnectionPoolMetrics(poolMetrics);

      const serviceMetrics = collector.getServiceMetrics('filesystem');
      expect(serviceMetrics).toBeDefined();
      expect(serviceMetrics!.connectionPool).toEqual(poolMetrics);
    });

    it('should update connection pool metrics for multiple services', () => {
      // First record tool calls to create the services
      collector.recordToolCall('read_file', 'filesystem', 100, true);
      collector.recordToolCall('search', 'github', 100, true);

      const fsPoolMetrics: ConnectionPoolMetrics = {
        serviceName: 'filesystem',
        totalConnections: 5,
        idleConnections: 2,
        busyConnections: 3,
        waitingRequests: 0,
        totalAcquired: 10,
        totalReleased: 7,
        totalCreated: 5,
        totalClosed: 0,
      };

      const ghPoolMetrics: ConnectionPoolMetrics = {
        serviceName: 'github',
        totalConnections: 3,
        idleConnections: 1,
        busyConnections: 2,
        waitingRequests: 0,
        totalAcquired: 8,
        totalReleased: 6,
        totalCreated: 3,
        totalClosed: 0,
      };

      collector.updateConnectionPoolMetrics(fsPoolMetrics);
      collector.updateConnectionPoolMetrics(ghPoolMetrics);

      const fsMetrics = collector.getServiceMetrics('filesystem');
      const ghMetrics = collector.getServiceMetrics('github');

      expect(fsMetrics!.connectionPool).toEqual(fsPoolMetrics);
      expect(ghMetrics!.connectionPool).toEqual(ghPoolMetrics);
    });
  });

  describe('Session Tracking', () => {
    it('should register sessions', () => {
      collector.registerSession('session1', 'agent1');
      collector.registerSession('session2', 'agent2');

      const metrics = collector.getSystemMetrics();
      expect(metrics.sessions).toHaveLength(2);
    });

    it('should track session activity', () => {
      collector.registerSession('session1', 'agent1');
      collector.recordToolCall('read_file', 'filesystem', 100, true, 'session1');
      collector.recordToolCall('write_file', 'filesystem', 150, true, 'session1');

      const sessionMetrics = collector.getSessionMetrics('session1');
      expect(sessionMetrics).toBeDefined();
      expect(sessionMetrics!.totalRequests).toBe(2);
      expect(sessionMetrics!.successfulRequests).toBe(2);
      expect(sessionMetrics!.failedRequests).toBe(0);
    });

    it('should track session failures', () => {
      collector.registerSession('session1', 'agent1');
      collector.recordToolCall('read_file', 'filesystem', 100, true, 'session1');
      collector.recordToolCall('write_file', 'filesystem', 150, false, 'session1');

      const sessionMetrics = collector.getSessionMetrics('session1');
      expect(sessionMetrics!.totalRequests).toBe(2);
      expect(sessionMetrics!.successfulRequests).toBe(1);
      expect(sessionMetrics!.failedRequests).toBe(1);
    });

    it('should calculate average response time per session', () => {
      collector.registerSession('session1', 'agent1');
      collector.recordToolCall('read_file', 'filesystem', 100, true, 'session1');
      collector.recordToolCall('write_file', 'filesystem', 200, true, 'session1');

      const sessionMetrics = collector.getSessionMetrics('session1');
      expect(sessionMetrics!.avgResponseTime).toBe(150);
    });

    it('should unregister sessions', () => {
      collector.registerSession('session1', 'agent1');
      collector.registerSession('session2', 'agent2');

      collector.unregisterSession('session1');

      const metrics = collector.getSystemMetrics();
      expect(metrics.sessions).toHaveLength(1);
      expect(metrics.sessions[0]?.sessionId).toBe('session2');
    });
  });

  describe('Query Metrics', () => {
    beforeEach(() => {
      // Set up test data
      collector.recordToolCall('read_file', 'filesystem', 100, true, 'session1');
      collector.recordToolCall('write_file', 'filesystem', 150, true, 'session1');
      collector.recordToolCall('search', 'github', 200, true, 'session2');
      collector.recordError(-32001, 'TOOL_NOT_FOUND', 'filesystem', 'session1');
    });

    it('should query metrics by service', () => {
      const metrics = collector.queryMetrics({ serviceName: 'filesystem' });
      expect(metrics.totalRequests).toBe(2);
      expect(metrics.services).toHaveLength(1);
      expect(metrics.services[0]?.serviceName).toBe('filesystem');
    });

    it('should query metrics by tool', () => {
      const metrics = collector.queryMetrics({ toolName: 'read_file' });
      expect(metrics.totalRequests).toBe(1);
    });

    it('should query metrics by session', () => {
      const metrics = collector.queryMetrics({ sessionId: 'session1' });
      expect(metrics.totalRequests).toBe(2);
      expect(metrics.sessions).toHaveLength(1);
      expect(metrics.sessions[0]?.sessionId).toBe('session1');
    });

    it('should query metrics by time range', async () => {
      // Create a fresh collector for this test
      const freshCollector = new MetricsCollector(config);

      // Record initial data
      freshCollector.recordToolCall('read_file', 'filesystem', 100, true);

      // Wait a bit to ensure time difference
      await new Promise((resolve) => setTimeout(resolve, 100));

      const startTime = new Date();

      // Wait a bit more
      await new Promise((resolve) => setTimeout(resolve, 100));

      freshCollector.recordToolCall('delete_file', 'filesystem', 120, true);

      const metrics = freshCollector.queryMetrics({ startTime });
      // Should only include the new call (after startTime)
      expect(metrics.totalRequests).toBe(1);

      freshCollector.stop();
    });

    it('should combine multiple filters', () => {
      const metrics = collector.queryMetrics({
        serviceName: 'filesystem',
        sessionId: 'session1',
      });
      expect(metrics.totalRequests).toBe(2);
      expect(metrics.services).toHaveLength(1);
      expect(metrics.sessions).toHaveLength(1);
    });
  });

  describe('System Metrics', () => {
    it('should calculate uptime', () => {
      const metrics = collector.getSystemMetrics();
      expect(metrics.uptime).toBeGreaterThanOrEqual(0);
    });

    it('should calculate average response time', () => {
      collector.recordToolCall('read_file', 'filesystem', 100, true);
      collector.recordToolCall('write_file', 'filesystem', 200, true);

      const metrics = collector.getSystemMetrics();
      expect(metrics.avgResponseTime).toBe(150);
    });

    it('should handle empty metrics', () => {
      const metrics = collector.getSystemMetrics();
      expect(metrics.totalRequests).toBe(0);
      expect(metrics.successfulRequests).toBe(0);
      expect(metrics.failedRequests).toBe(0);
      expect(metrics.avgResponseTime).toBe(0);
      expect(metrics.services).toHaveLength(0);
      expect(metrics.sessions).toHaveLength(0);
      expect(metrics.errors).toHaveLength(0);
    });
  });

  describe('Reset', () => {
    it('should reset all metrics', () => {
      collector.recordToolCall('read_file', 'filesystem', 100, true);
      collector.recordError(-32001, 'TOOL_NOT_FOUND', 'filesystem');
      collector.registerSession('session1', 'agent1');

      collector.reset();

      const metrics = collector.getSystemMetrics();
      expect(metrics.totalRequests).toBe(0);
      expect(metrics.services).toHaveLength(0);
      expect(metrics.sessions).toHaveLength(0);
      expect(metrics.errors).toHaveLength(0);
    });
  });

  describe('Disabled Metrics', () => {
    it('should not collect metrics when disabled', () => {
      const disabledCollector = new MetricsCollector({
        enabled: false,
        collectionInterval: 1000,
        retentionPeriod: 5000,
      });

      disabledCollector.recordToolCall('read_file', 'filesystem', 100, true);
      disabledCollector.recordError(-32001, 'TOOL_NOT_FOUND', 'filesystem');

      const metrics = disabledCollector.getSystemMetrics();
      expect(metrics.totalRequests).toBe(0);
      expect(metrics.errors).toHaveLength(0);

      disabledCollector.stop();
    });
  });

  describe('Retention Period', () => {
    it('should clean up old records', async () => {
      const shortRetentionCollector = new MetricsCollector({
        enabled: true,
        collectionInterval: 50,
        retentionPeriod: 100,
      });

      shortRetentionCollector.recordToolCall('read_file', 'filesystem', 100, true);

      // Wait for retention period to pass plus collection interval
      // Need to wait: retentionPeriod (100ms) + collectionInterval (50ms) + buffer (200ms)
      await new Promise((resolve) => setTimeout(resolve, 350));

      const metrics = shortRetentionCollector.getSystemMetrics();
      // Records should be cleaned up
      expect(metrics.totalRequests).toBe(0);

      shortRetentionCollector.stop();
    });
  });
});
