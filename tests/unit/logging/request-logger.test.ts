/**
 * Unit tests for RequestLogger
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createLogger,
  createDataMasker,
  createRequestLogger,
} from '../../../src/logging/index.js';

describe('RequestLogger', () => {
  let logger: ReturnType<typeof createLogger>;
  let masker: ReturnType<typeof createDataMasker>;
  let requestLogger: ReturnType<typeof createRequestLogger>;
  let logs: any[];

  beforeEach(() => {
    logs = [];

    logger = createLogger({
      level: 'debug',
      console: false,
    });

    // Capture log output
    const originalInfo = logger.info.bind(logger);
    const originalError = logger.error.bind(logger);
    const originalWarn = logger.warn.bind(logger);
    const originalDebug = logger.debug.bind(logger);

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

    logger.debug = (message: string, ctx?: Record<string, unknown>) => {
      logs.push({ level: 'debug', message, context: ctx });
      originalDebug(message, ctx);
    };

    masker = createDataMasker({
      enabled: true,
      patterns: ['password', 'token'],
    });

    requestLogger = createRequestLogger(logger, masker, {
      logInput: true,
      logOutput: true,
      logTiming: true,
    });
  });

  describe('Request Logging', () => {
    it('should log request received', () => {
      const context = {
        requestId: 'req-123',
        correlationId: 'corr-456',
        toolName: 'test-tool',
        serviceName: 'test-service',
      };

      requestLogger.logRequestReceived(context, { param: 'value' });

      expect(logs.length).toBe(1);
      expect(logs[0].level).toBe('info');
      expect(logs[0].message).toContain('Request received');
      expect(logs[0].context.requestId).toBe('req-123');
      expect(logs[0].context.correlationId).toBe('corr-456');
      expect(logs[0].context.event).toBe('request_received');
    });

    it('should log request routed', () => {
      const context = {
        requestId: 'req-123',
        correlationId: 'corr-456',
        toolName: 'test-tool',
        serviceName: 'test-service',
      };

      const routingInfo = {
        poolId: 'pool-1',
        connectionId: 'conn-1',
        reason: 'available connection',
      };

      requestLogger.logRequestRouted(context, routingInfo);

      expect(logs.length).toBe(1);
      expect(logs[0].level).toBe('debug');
      expect(logs[0].message).toContain('Request routed');
      expect(logs[0].context.routing).toEqual(routingInfo);
    });

    it('should log successful request completion', () => {
      const context = {
        requestId: 'req-123',
        correlationId: 'corr-456',
        toolName: 'test-tool',
        serviceName: 'test-service',
      };

      requestLogger.logRequestCompleted(context, {
        status: 'success',
        duration: 150,
        output: { result: 'success' },
      });

      expect(logs.length).toBe(1);
      expect(logs[0].level).toBe('info');
      expect(logs[0].message).toContain('Request completed');
      expect(logs[0].context.status).toBe('success');
      expect(logs[0].context.duration).toBe(150);
    });

    it('should log failed request', () => {
      const context = {
        requestId: 'req-123',
        correlationId: 'corr-456',
        toolName: 'test-tool',
        serviceName: 'test-service',
      };

      requestLogger.logRequestCompleted(context, {
        status: 'error',
        duration: 100,
        error: {
          code: -32001,
          message: 'Tool not found',
        },
      });

      expect(logs.length).toBe(1);
      expect(logs[0].level).toBe('error');
      expect(logs[0].message).toContain('Request failed');
      expect(logs[0].context.status).toBe('error');
      expect(logs[0].context.error).toBeDefined();
    });

    it('should log timeout', () => {
      const context = {
        requestId: 'req-123',
        correlationId: 'corr-456',
        toolName: 'test-tool',
        serviceName: 'test-service',
      };

      requestLogger.logRequestCompleted(context, {
        status: 'timeout',
        duration: 30000,
      });

      expect(logs.length).toBe(1);
      expect(logs[0].level).toBe('warn');
      expect(logs[0].message).toContain('Request timeout');
      expect(logs[0].context.status).toBe('timeout');
    });
  });

  describe('Service Lifecycle Logging', () => {
    it('should log service registered', () => {
      requestLogger.logServiceEvent('registered', 'test-service', {
        transport: 'stdio',
      });

      expect(logs.length).toBe(1);
      expect(logs[0].level).toBe('info');
      expect(logs[0].message).toContain('Service registered');
      expect(logs[0].context.serviceName).toBe('test-service');
      expect(logs[0].context.event).toBe('service_registered');
    });

    it('should log service error', () => {
      requestLogger.logServiceEvent('error', 'test-service', {
        error: 'Connection failed',
      });

      expect(logs.length).toBe(1);
      expect(logs[0].level).toBe('error');
      expect(logs[0].message).toContain('Service error');
    });
  });

  describe('Connection Pool Logging', () => {
    it('should log connection acquired', () => {
      requestLogger.logPoolEvent('acquired', 'pool-1', {
        connectionId: 'conn-1',
      });

      expect(logs.length).toBe(1);
      expect(logs[0].level).toBe('debug');
      expect(logs[0].message).toContain('Connection pool acquired');
      expect(logs[0].context.poolId).toBe('pool-1');
    });

    it('should log pool exhausted', () => {
      requestLogger.logPoolEvent('exhausted', 'pool-1', {
        maxConnections: 5,
      });

      expect(logs.length).toBe(1);
      expect(logs[0].level).toBe('warn');
      expect(logs[0].message).toContain('Connection pool exhausted');
    });
  });

  describe('Health Check Logging', () => {
    it('should log successful health check', () => {
      requestLogger.logHealthCheck('test-service', {
        healthy: true,
        duration: 50,
      });

      expect(logs.length).toBe(1);
      expect(logs[0].level).toBe('debug');
      expect(logs[0].message).toContain('Health check passed');
      expect(logs[0].context.healthy).toBe(true);
    });

    it('should log failed health check', () => {
      requestLogger.logHealthCheck('test-service', {
        healthy: false,
        duration: 100,
        error: 'Connection timeout',
      });

      expect(logs.length).toBe(1);
      expect(logs[0].level).toBe('warn');
      expect(logs[0].message).toContain('Health check failed');
      expect(logs[0].context.healthy).toBe(false);
      expect(logs[0].context.error).toBe('Connection timeout');
    });
  });

  describe('Tool State Logging', () => {
    it('should log tool enabled', () => {
      requestLogger.logToolStateChange('test-tool', true, 'Manual enable');

      expect(logs.length).toBe(1);
      expect(logs[0].level).toBe('info');
      expect(logs[0].message).toContain('Tool state changed');
      expect(logs[0].context.toolName).toBe('test-tool');
      expect(logs[0].context.enabled).toBe(true);
      expect(logs[0].context.reason).toBe('Manual enable');
    });

    it('should log tool disabled', () => {
      requestLogger.logToolStateChange('test-tool', false);

      expect(logs.length).toBe(1);
      expect(logs[0].context.enabled).toBe(false);
    });
  });

  describe('Configuration Logging', () => {
    it('should log configuration loaded', () => {
      requestLogger.logConfigChange('loaded', {
        source: 'file',
      });

      expect(logs.length).toBe(1);
      expect(logs[0].level).toBe('info');
      expect(logs[0].message).toContain('Configuration loaded');
      expect(logs[0].context.event).toBe('config_loaded');
    });

    it('should log configuration reloaded', () => {
      requestLogger.logConfigChange('reloaded', {
        reason: 'File changed',
      });

      expect(logs.length).toBe(1);
      expect(logs[0].message).toContain('Configuration reloaded');
    });
  });

  describe('Data Masking', () => {
    it('should mask sensitive input data', () => {
      const context = {
        requestId: 'req-123',
        correlationId: 'corr-456',
        toolName: 'test-tool',
        serviceName: 'test-service',
      };

      requestLogger.logRequestReceived(context, {
        username: 'john',
        password: 'secret123',
      });

      expect(logs[0].context.input).toBeDefined();
      expect(logs[0].context.input.username).toBe('john');
      expect(logs[0].context.input.password).toBe('***MASKED***');
    });

    it('should mask sensitive output data', () => {
      const context = {
        requestId: 'req-123',
        correlationId: 'corr-456',
        toolName: 'test-tool',
        serviceName: 'test-service',
      };

      requestLogger.logRequestCompleted(context, {
        status: 'success',
        duration: 100,
        output: {
          token: 'abc-def-ghi',
          data: 'result',
        },
      });

      expect(logs[0].context.output).toBeDefined();
      expect(logs[0].context.output.token).toBe('***MASKED***');
      expect(logs[0].context.output.data).toBe('result');
    });
  });

  describe('Configuration Updates', () => {
    it('should update logging configuration', () => {
      requestLogger.updateConfig({
        logInput: false,
        logOutput: false,
      });

      const context = {
        requestId: 'req-123',
        correlationId: 'corr-456',
        toolName: 'test-tool',
        serviceName: 'test-service',
      };

      requestLogger.logRequestReceived(context, { param: 'value' });

      // Input should not be logged
      expect(logs[0].context.input).toBeUndefined();
    });
  });
});
