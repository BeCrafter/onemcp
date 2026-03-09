/**
 * Unit tests for AuditLogger
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createLogger, createDataMasker, createAuditLogger } from '../../../src/logging/index.js';
import { AuditLogEntry } from '../../../src/types/audit.js';

describe('AuditLogger', () => {
  let logger: ReturnType<typeof createLogger>;
  let masker: ReturnType<typeof createDataMasker>;
  let auditLogger: ReturnType<typeof createAuditLogger>;

  beforeEach(() => {
    logger = createLogger({
      level: 'info',
      console: false,
    });

    masker = createDataMasker({
      enabled: true,
      patterns: ['password', 'token'],
    });

    auditLogger = createAuditLogger(logger, masker, {
      enabled: true,
      level: 'standard',
      logInput: true,
      logOutput: true,
    });
  });

  const createTestEntry = (overrides?: Partial<AuditLogEntry>): AuditLogEntry => {
    const now = new Date();
    return {
      requestId: 'req-123',
      correlationId: 'corr-456',
      sessionId: 'session-789',
      agentId: 'agent-001',
      toolName: 'test-tool',
      serviceName: 'test-service',
      connectionId: 'conn-1',
      receivedAt: now,
      routedAt: new Date(now.getTime() + 10),
      completedAt: new Date(now.getTime() + 100),
      duration: 100,
      status: 'success',
      routingDecision: {
        poolId: 'pool-1',
        connectionId: 'conn-1',
        reason: 'available',
      },
      ...overrides,
    };
  };

  describe('Audit Entry Logging', () => {
    it('should log successful audit entry', () => {
      const entry = createTestEntry();

      expect(() => auditLogger.logAuditEntry(entry)).not.toThrow();
    });

    it('should log failed audit entry', () => {
      const entry = createTestEntry({
        status: 'error',
        error: {
          code: -32001,
          message: 'Tool not found',
        },
      });

      expect(() => auditLogger.logAuditEntry(entry)).not.toThrow();
    });

    it('should log timeout audit entry', () => {
      const entry = createTestEntry({
        status: 'timeout',
      });

      expect(() => auditLogger.logAuditEntry(entry)).not.toThrow();
    });

    it('should not log when disabled', () => {
      const disabledLogger = createAuditLogger(logger, masker, {
        enabled: false,
        level: 'standard',
        logInput: false,
        logOutput: false,
      });

      const entry = createTestEntry();
      disabledLogger.logAuditEntry(entry);

      // Should not throw, but also should not store
      const results = disabledLogger.queryLogs({});
      expect(results.length).toBe(0);
    });
  });

  describe('Audit Log Querying', () => {
    beforeEach(() => {
      // Add some test entries
      auditLogger.logAuditEntry(
        createTestEntry({
          requestId: 'req-1',
          sessionId: 'session-1',
          toolName: 'tool-1',
          serviceName: 'service-1',
          status: 'success',
        })
      );

      auditLogger.logAuditEntry(
        createTestEntry({
          requestId: 'req-2',
          sessionId: 'session-1',
          toolName: 'tool-2',
          serviceName: 'service-2',
          status: 'error',
        })
      );

      auditLogger.logAuditEntry(
        createTestEntry({
          requestId: 'req-3',
          sessionId: 'session-2',
          toolName: 'tool-1',
          serviceName: 'service-1',
          status: 'success',
        })
      );
    });

    it('should query all logs without filter', () => {
      const results = auditLogger.queryLogs({});
      expect(results.length).toBe(3);
    });

    it('should filter by session ID', () => {
      const results = auditLogger.queryLogs({ sessionId: 'session-1' });
      expect(results.length).toBe(2);
      expect(results.every((r) => r.sessionId === 'session-1')).toBe(true);
    });

    it('should filter by request ID', () => {
      const results = auditLogger.queryLogs({ requestId: 'req-2' });
      expect(results.length).toBe(1);
      expect(results[0]?.requestId).toBe('req-2');
    });

    it('should filter by tool name', () => {
      const results = auditLogger.queryLogs({ toolName: 'tool-1' });
      expect(results.length).toBe(2);
      expect(results.every((r) => r.toolName === 'tool-1')).toBe(true);
    });

    it('should filter by service name', () => {
      const results = auditLogger.queryLogs({ serviceName: 'service-1' });
      expect(results.length).toBe(2);
      expect(results.every((r) => r.serviceName === 'service-1')).toBe(true);
    });

    it('should filter by status', () => {
      const results = auditLogger.queryLogs({ status: 'error' });
      expect(results.length).toBe(1);
      expect(results[0]?.status).toBe('error');
    });

    it('should filter by time range', () => {
      const now = new Date();
      const results = auditLogger.queryLogs({
        timeRange: {
          start: new Date(now.getTime() - 1000),
          end: new Date(now.getTime() + 1000),
        },
      });
      expect(results.length).toBe(3);
    });

    it('should combine multiple filters', () => {
      const results = auditLogger.queryLogs({
        sessionId: 'session-1',
        status: 'success',
      });
      expect(results.length).toBe(1);
      expect(results[0]?.requestId).toBe('req-1');
    });
  });

  describe('Audit Log Export', () => {
    beforeEach(() => {
      auditLogger.logAuditEntry(
        createTestEntry({
          requestId: 'req-1',
          toolName: 'tool-1',
        })
      );

      auditLogger.logAuditEntry(
        createTestEntry({
          requestId: 'req-2',
          toolName: 'tool-2',
        })
      );
    });

    it('should export to JSON format', () => {
      const exported = auditLogger.exportLogs(undefined, 'json');

      expect(() => JSON.parse(exported)).not.toThrow();
      const parsed = JSON.parse(exported);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(2);
    });

    it('should export to CSV format', () => {
      const exported = auditLogger.exportLogs(undefined, 'csv');

      const lines = exported.split('\n');
      expect(lines.length).toBe(3); // Header + 2 entries
      expect(lines[0]).toContain('requestId');
      expect(lines[0]).toContain('correlationId');
    });

    it('should export filtered logs', () => {
      const exported = auditLogger.exportLogs({ requestId: 'req-1' }, 'json');

      const parsed = JSON.parse(exported);
      expect(parsed.length).toBe(1);
      expect(parsed[0].requestId).toBe('req-1');
    });

    it('should handle empty export', () => {
      auditLogger.clearLogs();
      const exported = auditLogger.exportLogs(undefined, 'csv');

      expect(exported).toBe('');
    });
  });

  describe('Data Masking in Audit Logs', () => {
    it('should mask sensitive input data', () => {
      const entry = createTestEntry({
        input: {
          username: 'john',
          password: 'secret123',
        },
      });

      auditLogger.logAuditEntry(entry);

      const results = auditLogger.queryLogs({ requestId: entry.requestId });
      expect(results[0]?.input).toBeDefined();
      expect((results[0]?.input as any)?.password).toBe('***MASKED***');
    });

    it('should mask sensitive output data', () => {
      const entry = createTestEntry({
        output: {
          token: 'abc-def-ghi',
          data: 'result',
        },
      });

      auditLogger.logAuditEntry(entry);

      const results = auditLogger.queryLogs({ requestId: entry.requestId });
      expect(results[0]?.output).toBeDefined();
      expect((results[0]?.output as any)?.token).toBe('***MASKED***');
      expect((results[0]?.output as any)?.data).toBe('result');
    });

    it('should mask error messages', () => {
      const entry = createTestEntry({
        status: 'error',
        error: {
          code: -32001,
          message: 'Authentication failed: invalid password',
        },
      });

      auditLogger.logAuditEntry(entry);

      const results = auditLogger.queryLogs({ requestId: entry.requestId });
      expect(results[0]?.error).toBeDefined();
      expect(results[0]?.error?.message).toContain('***MASKED***');
    });

    it('should not log input when disabled', () => {
      const noInputLogger = createAuditLogger(logger, masker, {
        enabled: true,
        level: 'standard',
        logInput: false,
        logOutput: true,
      });

      const entry = createTestEntry({
        input: { data: 'test' },
      });

      noInputLogger.logAuditEntry(entry);

      const results = noInputLogger.queryLogs({ requestId: entry.requestId });

      expect(results[0]?.input).toBeUndefined();
    });
  });

  describe('Clear Logs', () => {
    it('should clear all audit logs', () => {
      auditLogger.logAuditEntry(createTestEntry());
      auditLogger.logAuditEntry(createTestEntry());

      let results = auditLogger.queryLogs({});
      expect(results.length).toBe(2);

      auditLogger.clearLogs();

      results = auditLogger.queryLogs({});
      expect(results.length).toBe(0);
    });
  });
});
