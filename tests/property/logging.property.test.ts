/**
 * Property-based tests for logging system
 * Feature: onemcp-system
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import {
  createLogger,
  createDataMasker,
  createRequestLogger,
  createAuditLogger,
  DEFAULT_SENSITIVE_PATTERNS,
} from '../../src/logging/index.js';
import { AuditLogEntry } from '../../src/types/audit.js';

describe('Property 16: Log contains correlation ID', () => {
  it('should include correlation ID in all log entries for any request', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          requestId: fc.uuid(),
          correlationId: fc.uuid(),
          sessionId: fc.option(fc.uuid()),
          agentId: fc.option(fc.string({ minLength: 1, maxLength: 50 })),
          toolName: fc.string({ minLength: 1, maxLength: 100 }),
          serviceName: fc.string({ minLength: 1, maxLength: 50 }),
        }),
        async (context) => {
          // Capture log output
          const logs: any[] = [];
          const logger = createLogger({
            level: 'info',
            console: false,
            pretty: false,
          });

          // Override logger methods to capture output
          const originalInfo = logger.info.bind(logger);
          logger.info = (message: string, ctx?: Record<string, unknown>) => {
            logs.push({ level: 'info', message, context: ctx });
            originalInfo(message, ctx);
          };

          const masker = createDataMasker({
            enabled: false,
            patterns: [],
          });

          const requestLogger = createRequestLogger(logger, masker, {
            logInput: false,
            logOutput: false,
            logTiming: true,
          });

          // Log a request
          requestLogger.logRequestReceived(context);

          // Verify correlation ID is present
          expect(logs.length).toBeGreaterThan(0);
          const log = logs[0];
          expect(log.context).toBeDefined();
          expect(log.context.correlationId).toBe(context.correlationId);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should include correlation ID in audit log entries', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          requestId: fc.uuid(),
          correlationId: fc.uuid(),
          sessionId: fc.option(fc.uuid()),
          agentId: fc.option(fc.string()),
          toolName: fc.string({ minLength: 1 }),
          serviceName: fc.string({ minLength: 1 }),
          connectionId: fc.uuid(),
          receivedAt: fc.date(),
          routedAt: fc.date(),
          completedAt: fc.date(),
          duration: fc.integer({ min: 1, max: 10000 }),
          status: fc.constantFrom('success', 'error', 'timeout'),
          routingDecision: fc.record({
            poolId: fc.uuid(),
            connectionId: fc.uuid(),
            reason: fc.string(),
          }),
        }),
        async (entry) => {
          // Capture log output
          const logs: any[] = [];
          const logger = createLogger({
            level: 'info',
            console: false,
            pretty: false,
          });

          const originalInfo = logger.info.bind(logger);
          const originalError = logger.error.bind(logger);
          const originalWarn = logger.warn.bind(logger);

          logger.info = (message: string, ctx?: Record<string, unknown>) => {
            logs.push({ level: 'info', message, context: ctx });
            originalInfo(message, ctx);
          };

          logger.error = (message: string, ctx?: Record<string, unknown>) => {
            logs.push({ level: 'error', message, context: ctx });
            originalError(message, ctx);
          };

          logger.warn = (message: string, ctx?: Record<string, unknown>) => {
            logs.push({ level: 'warn', message, context: ctx });
            originalWarn(message, ctx);
          };

          const masker = createDataMasker({
            enabled: false,
            patterns: [],
          });

          const auditLogger = createAuditLogger(logger, masker, {
            enabled: true,
            level: 'standard',
            logInput: false,
            logOutput: false,
          });

          // Log audit entry
          auditLogger.logAuditEntry(entry as AuditLogEntry);

          // Verify correlation ID is present
          expect(logs.length).toBeGreaterThan(0);
          const log = logs[0];
          expect(log.context).toBeDefined();
          expect(log.context.correlationId).toBe(entry.correlationId);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Data Masking Properties', () => {
  it('should mask all sensitive fields in any object', () => {
    fc.assert(
      fc.property(
        fc.record({
          password: fc.string(),
          username: fc.string(),
          token: fc.string(),
          apiKey: fc.string(),
          normalField: fc.string(),
        }),
        (obj) => {
          const masker = createDataMasker({
            enabled: true,
            patterns: DEFAULT_SENSITIVE_PATTERNS,
          });

          const masked = masker.maskObject(obj) as any;

          // Sensitive fields should be masked
          expect(masked.password).toBe('***MASKED***');
          expect(masked.token).toBe('***MASKED***');
          expect(masked.apiKey).toBe('***MASKED***');

          // Normal fields should not be masked
          expect(masked.normalField).toBe(obj.normalField);
          expect(masked.username).toBe(obj.username);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should mask nested sensitive fields', () => {
    fc.assert(
      fc.property(
        fc.record({
          user: fc.record({
            name: fc.string({ minLength: 1 }),
            password: fc.string({ minLength: 1 }),
            credentials: fc.record({
              apiKey: fc.string({ minLength: 1 }),
              secret: fc.string({ minLength: 1 }),
            }),
          }),
        }),
        (obj) => {
          const masker = createDataMasker({
            enabled: true,
            patterns: DEFAULT_SENSITIVE_PATTERNS,
          });

          const masked = masker.maskObject(obj) as any;

          // Check nested masking
          expect(masked.user.name).toBe(obj.user.name);
          expect(masked.user.password).toBe('***MASKED***');
          expect(masked.user.credentials.apiKey).toBe('***MASKED***');
          expect(masked.user.credentials.secret).toBe('***MASKED***');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should not mask when disabled', () => {
    fc.assert(
      fc.property(
        fc.record({
          password: fc.string(),
          token: fc.string(),
          normalField: fc.string(),
        }),
        (obj) => {
          const masker = createDataMasker({
            enabled: false,
            patterns: DEFAULT_SENSITIVE_PATTERNS,
          });

          const masked = masker.maskObject(obj);

          // Nothing should be masked when disabled
          expect(masked).toEqual(obj);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Audit Log Query Properties', () => {
  it('should filter by session ID correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            requestId: fc.uuid(),
            correlationId: fc.uuid(),
            sessionId: fc.option(fc.uuid()),
            agentId: fc.option(fc.string()),
            toolName: fc.string({ minLength: 1 }),
            serviceName: fc.string({ minLength: 1 }),
            connectionId: fc.uuid(),
            receivedAt: fc.date(),
            routedAt: fc.date(),
            completedAt: fc.date(),
            duration: fc.integer({ min: 1, max: 10000 }),
            status: fc.constantFrom('success', 'error', 'timeout'),
            routingDecision: fc.record({
              poolId: fc.uuid(),
              connectionId: fc.uuid(),
              reason: fc.string(),
            }),
          }),
          { minLength: 5, maxLength: 20 }
        ),
        fc.uuid(),
        async (entries, targetSessionId) => {
          const logger = createLogger({
            level: 'info',
            console: false,
          });

          const masker = createDataMasker({
            enabled: false,
            patterns: [],
          });

          const auditLogger = createAuditLogger(logger, masker, {
            enabled: true,
            level: 'standard',
            logInput: false,
            logOutput: false,
          });

          // Log all entries
          for (const entry of entries) {
            auditLogger.logAuditEntry(entry as AuditLogEntry);
          }

          // Query by session ID
          const results = auditLogger.queryLogs({ sessionId: targetSessionId });

          // All results should have the target session ID
          for (const result of results) {
            expect(result.sessionId).toBe(targetSessionId);
          }

          // Count should match
          const expectedCount = entries.filter((e) => e.sessionId === targetSessionId).length;
          expect(results.length).toBe(expectedCount);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should filter by status correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            requestId: fc.uuid(),
            correlationId: fc.uuid(),
            sessionId: fc.option(fc.uuid()),
            agentId: fc.option(fc.string()),
            toolName: fc.string({ minLength: 1 }),
            serviceName: fc.string({ minLength: 1 }),
            connectionId: fc.uuid(),
            receivedAt: fc.date(),
            routedAt: fc.date(),
            completedAt: fc.date(),
            duration: fc.integer({ min: 1, max: 10000 }),
            status: fc.constantFrom('success', 'error', 'timeout'),
            routingDecision: fc.record({
              poolId: fc.uuid(),
              connectionId: fc.uuid(),
              reason: fc.string(),
            }),
          }),
          { minLength: 5, maxLength: 20 }
        ),
        fc.constantFrom('success', 'error', 'timeout'),
        async (entries, targetStatus) => {
          const logger = createLogger({
            level: 'info',
            console: false,
          });

          const masker = createDataMasker({
            enabled: false,
            patterns: [],
          });

          const auditLogger = createAuditLogger(logger, masker, {
            enabled: true,
            level: 'standard',
            logInput: false,
            logOutput: false,
          });

          // Log all entries
          for (const entry of entries) {
            auditLogger.logAuditEntry(entry as AuditLogEntry);
          }

          // Query by status
          const results = auditLogger.queryLogs({ status: targetStatus });

          // All results should have the target status
          for (const result of results) {
            expect(result.status).toBe(targetStatus);
          }

          // Count should match
          const expectedCount = entries.filter((e) => e.status === targetStatus).length;
          expect(results.length).toBe(expectedCount);
        }
      ),
      { numRuns: 50 }
    );
  });
});

describe('Log Export Properties', () => {
  it('should export to JSON format correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            requestId: fc.uuid(),
            correlationId: fc.uuid(),
            sessionId: fc.option(fc.uuid()),
            agentId: fc.option(fc.string()),
            toolName: fc.string({ minLength: 1 }),
            serviceName: fc.string({ minLength: 1 }),
            connectionId: fc.uuid(),
            receivedAt: fc.date(),
            routedAt: fc.date(),
            completedAt: fc.date(),
            duration: fc.integer({ min: 1, max: 10000 }),
            status: fc.constantFrom('success', 'error', 'timeout'),
            routingDecision: fc.record({
              poolId: fc.uuid(),
              connectionId: fc.uuid(),
              reason: fc.string(),
            }),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        async (entries) => {
          const logger = createLogger({
            level: 'info',
            console: false,
          });

          const masker = createDataMasker({
            enabled: false,
            patterns: [],
          });

          const auditLogger = createAuditLogger(logger, masker, {
            enabled: true,
            level: 'standard',
            logInput: false,
            logOutput: false,
          });

          // Log all entries
          for (const entry of entries) {
            auditLogger.logAuditEntry(entry as AuditLogEntry);
          }

          // Export to JSON
          const exported = auditLogger.exportLogs(undefined, 'json');

          // Should be valid JSON
          const parsed = JSON.parse(exported);
          expect(Array.isArray(parsed)).toBe(true);
          expect(parsed.length).toBe(entries.length);

          // Verify all entries are present
          for (let i = 0; i < entries.length; i++) {
            expect(parsed[i].requestId).toBe(entries[i].requestId);
            expect(parsed[i].correlationId).toBe(entries[i].correlationId);
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});
