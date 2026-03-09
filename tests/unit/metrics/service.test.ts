/**
 * Unit tests for MetricsService
 *
 * Requirements:
 * - 34.4: Provide API to query collected metrics
 * - 38.9: Support metrics aggregation by service, tool, session
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MetricsService } from '../../../src/metrics/service.js';
import type { MetricsConfig } from '../../../src/types/index.js';

describe('MetricsService', () => {
  let service: MetricsService;
  const config: MetricsConfig = {
    enabled: true,
    collectionInterval: 1000,
    retentionPeriod: 5000,
  };

  beforeEach(() => {
    service = new MetricsService(config);
  });

  afterEach(() => {
    service.stop();
  });

  describe('Recording', () => {
    it('should record tool calls', () => {
      service.recordToolCall('read_file', 'filesystem', 100, true);

      const metrics = service.getSystemMetrics();
      expect(metrics.totalRequests).toBe(1);
    });

    it('should record errors', () => {
      service.recordError(-32001, 'TOOL_NOT_FOUND', 'filesystem');

      const metrics = service.getSystemMetrics();
      expect(metrics.errors).toHaveLength(1);
    });

    it('should register sessions', () => {
      service.registerSession('session1', 'agent1');

      const metrics = service.getSystemMetrics();
      expect(metrics.sessions).toHaveLength(1);
    });
  });

  describe('Aggregation by Service', () => {
    beforeEach(() => {
      service.recordToolCall('read_file', 'filesystem', 100, true);
      service.recordToolCall('write_file', 'filesystem', 150, true);
      service.recordToolCall('search', 'github', 200, true);
    });

    it('should get metrics for specific service', () => {
      const fsMetrics = service.getServiceMetrics('filesystem');
      expect(fsMetrics).toBeDefined();
      expect(fsMetrics!.serviceName).toBe('filesystem');
      expect(fsMetrics!.toolCalls).toHaveLength(2);
    });

    it('should get all service metrics', () => {
      const allServices = service.getAllServiceMetrics();
      expect(allServices).toHaveLength(2);
    });

    it('should aggregate metrics by service', () => {
      const byService = service.getMetricsByService();
      expect(byService.size).toBe(2);
      expect(byService.has('filesystem')).toBe(true);
      expect(byService.has('github')).toBe(true);
    });
  });

  describe('Aggregation by Tool', () => {
    beforeEach(() => {
      service.recordToolCall('read_file', 'filesystem', 100, true);
      service.recordToolCall('read_file', 'filesystem', 150, true);
      service.recordToolCall('write_file', 'filesystem', 200, true);
    });

    it('should get metrics for specific tool', () => {
      const toolMetrics = service.getToolMetrics('read_file');
      expect(toolMetrics).toHaveLength(1);
      expect(toolMetrics[0]?.callCount).toBe(2);
    });

    it('should get metrics for tool in specific service', () => {
      const toolMetrics = service.getToolMetrics('read_file', 'filesystem');
      expect(toolMetrics).toHaveLength(1);
      expect(toolMetrics[0]?.serviceName).toBe('filesystem');
    });

    it('should aggregate metrics by tool', () => {
      const byTool = service.getMetricsByTool();
      expect(byTool.size).toBe(2);
      expect(byTool.has('read_file')).toBe(true);
      expect(byTool.has('write_file')).toBe(true);
      expect(byTool.get('read_file')).toHaveLength(1);
    });
  });

  describe('Aggregation by Session', () => {
    beforeEach(() => {
      service.registerSession('session1', 'agent1');
      service.registerSession('session2', 'agent2');
      service.recordToolCall('read_file', 'filesystem', 100, true, 'session1');
      service.recordToolCall('write_file', 'filesystem', 150, true, 'session1');
      service.recordToolCall('search', 'github', 200, true, 'session2');
    });

    it('should get metrics for specific session', () => {
      const sessionMetrics = service.getSessionMetrics('session1');
      expect(sessionMetrics).toBeDefined();
      expect(sessionMetrics!.sessionId).toBe('session1');
      expect(sessionMetrics!.totalRequests).toBe(2);
    });

    it('should get all session metrics', () => {
      const allSessions = service.getAllSessionMetrics();
      expect(allSessions).toHaveLength(2);
    });

    it('should aggregate metrics by session', () => {
      const bySession = service.getMetricsBySession();
      expect(bySession.size).toBe(2);
      expect(bySession.has('session1')).toBe(true);
      expect(bySession.has('session2')).toBe(true);
    });
  });

  describe('Top Tools', () => {
    beforeEach(() => {
      // Tool A: 5 calls, 1 error, avg 100ms
      for (let i = 0; i < 5; i++) {
        service.recordToolCall('tool_a', 'service1', 100, i < 4);
      }

      // Tool B: 3 calls, 2 errors, avg 200ms
      for (let i = 0; i < 3; i++) {
        service.recordToolCall('tool_b', 'service1', 200, i < 1);
      }

      // Tool C: 10 calls, 0 errors, avg 50ms
      for (let i = 0; i < 10; i++) {
        service.recordToolCall('tool_c', 'service2', 50, true);
      }
    });

    it('should get top tools by call count', () => {
      const topTools = service.getTopToolsByCallCount(2);
      expect(topTools).toHaveLength(2);
      expect(topTools[0]?.toolName).toBe('tool_c');
      expect(topTools[0]?.callCount).toBe(10);
      expect(topTools[1]?.toolName).toBe('tool_a');
      expect(topTools[1]?.callCount).toBe(5);
    });

    it('should get top tools by error rate', () => {
      const topTools = service.getTopToolsByErrorRate(2);
      expect(topTools).toHaveLength(2);
      // tool_b has 2/3 = 66.7% error rate
      // tool_a has 1/5 = 20% error rate
      expect(topTools[0]?.toolName).toBe('tool_b');
      expect(topTools[1]?.toolName).toBe('tool_a');
    });

    it('should get top tools by execution time', () => {
      const topTools = service.getTopToolsByExecutionTime(2);
      expect(topTools).toHaveLength(2);
      expect(topTools[0]?.toolName).toBe('tool_b');
      expect(topTools[0]?.avgExecutionTime).toBe(200);
      expect(topTools[1]?.toolName).toBe('tool_a');
      expect(topTools[1]?.avgExecutionTime).toBe(100);
    });
  });

  describe('Summary', () => {
    beforeEach(() => {
      service.registerSession('session1', 'agent1');
      service.recordToolCall('read_file', 'filesystem', 100, true, 'session1');
      service.recordToolCall('write_file', 'filesystem', 150, false, 'session1');
      service.recordToolCall('search', 'github', 200, true, 'session1');
    });

    it('should get summary statistics', () => {
      const summary = service.getSummary();

      expect(summary.totalServices).toBe(2);
      expect(summary.totalTools).toBe(3);
      expect(summary.totalSessions).toBe(1);
      expect(summary.totalRequests).toBe(3);
      expect(summary.successRate).toBeCloseTo(66.67, 1);
      expect(summary.avgResponseTime).toBeCloseTo(150, 0);
      expect(summary.uptime).toBeGreaterThanOrEqual(0);
    });

    it('should handle empty summary', () => {
      const emptyService = new MetricsService(config);
      const summary = emptyService.getSummary();

      expect(summary.totalServices).toBe(0);
      expect(summary.totalTools).toBe(0);
      expect(summary.totalSessions).toBe(0);
      expect(summary.totalRequests).toBe(0);
      expect(summary.successRate).toBe(0);
      expect(summary.avgResponseTime).toBe(0);

      emptyService.stop();
    });
  });

  describe('Query', () => {
    beforeEach(() => {
      service.recordToolCall('read_file', 'filesystem', 100, true, 'session1');
      service.recordToolCall('write_file', 'filesystem', 150, true, 'session1');
      service.recordToolCall('search', 'github', 200, true, 'session2');
    });

    it('should query by service', () => {
      const metrics = service.queryMetrics({ serviceName: 'filesystem' });
      expect(metrics.totalRequests).toBe(2);
    });

    it('should query by tool', () => {
      const metrics = service.queryMetrics({ toolName: 'read_file' });
      expect(metrics.totalRequests).toBe(1);
    });

    it('should query by session', () => {
      const metrics = service.queryMetrics({ sessionId: 'session1' });
      expect(metrics.totalRequests).toBe(2);
    });
  });

  describe('Reset', () => {
    it('should reset all metrics', () => {
      service.recordToolCall('read_file', 'filesystem', 100, true);
      service.reset();

      const metrics = service.getSystemMetrics();
      expect(metrics.totalRequests).toBe(0);
    });
  });

  describe('Collector Access', () => {
    it('should provide access to underlying collector', () => {
      const collector = service.getCollector();
      expect(collector).toBeDefined();
    });
  });
});
