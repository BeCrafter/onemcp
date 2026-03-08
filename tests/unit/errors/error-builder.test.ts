import { describe, it, expect } from 'vitest';
import { ErrorBuilder } from '../../../src/errors/error-builder.js';
import { ErrorCode } from '../../../src/types/jsonrpc.js';
import type { RequestContext } from '../../../src/types/context.js';

describe('ErrorBuilder', () => {
  const mockContext: RequestContext = {
    requestId: 'req-123',
    correlationId: 'corr-456',
    sessionId: 'session-789',
    agentId: 'agent-001',
    timestamp: new Date('2024-01-01T00:00:00Z'),
  };

  describe('buildErrorResponse', () => {
    it('should build a basic error response', () => {
      const response = ErrorBuilder.buildErrorResponse({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Test error',
        requestId: 'test-123',
      });

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe('test-123');
      expect(response.error.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(response.error.message).toBe('Test error');
    });

    it('should include context details when provided', () => {
      const response = ErrorBuilder.buildErrorResponse({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Test error',
        requestId: 'test-123',
        context: mockContext,
      });

      expect(response.error.data?.correlationId).toBe('corr-456');
      expect(response.error.data?.requestId).toBe('req-123');
      expect(response.error.data?.sessionId).toBe('session-789');
    });

    it('should include service name when provided', () => {
      const response = ErrorBuilder.buildErrorResponse({
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: 'Service error',
        requestId: 'test-123',
        serviceName: 'test-service',
      });

      expect(response.error.data?.serviceName).toBe('test-service');
    });

    it('should include tool name when provided', () => {
      const response = ErrorBuilder.buildErrorResponse({
        code: ErrorCode.TOOL_NOT_FOUND,
        message: 'Tool error',
        requestId: 'test-123',
        toolName: 'test-tool',
      });

      expect(response.error.data?.toolName).toBe('test-tool');
    });

    it('should include stack trace when includeStack is true', () => {
      const response = ErrorBuilder.buildErrorResponse({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Test error',
        requestId: 'test-123',
        stack: 'Error: Test\n  at test.js:1:1',
        includeStack: true,
      });

      expect(response.error.data?.stack).toBe('Error: Test\n  at test.js:1:1');
    });

    it('should not include stack trace when includeStack is false', () => {
      const response = ErrorBuilder.buildErrorResponse({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Test error',
        requestId: 'test-123',
        stack: 'Error: Test\n  at test.js:1:1',
        includeStack: false,
      });

      expect(response.error.data?.stack).toBeUndefined();
    });

    it('should remove empty data object', () => {
      const response = ErrorBuilder.buildErrorResponse({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Test error',
        requestId: 'test-123',
      });

      expect(response.error.data).toBeUndefined();
    });
  });

  describe('parseError', () => {
    it('should create a parse error with default message', () => {
      const response = ErrorBuilder.parseError();

      expect(response.error.code).toBe(ErrorCode.PARSE_ERROR);
      expect(response.error.message).toBe('Parse error');
      expect(response.id).toBeNull();
    });

    it('should create a parse error with custom message', () => {
      const response = ErrorBuilder.parseError('Invalid JSON');

      expect(response.error.code).toBe(ErrorCode.PARSE_ERROR);
      expect(response.error.message).toBe('Invalid JSON');
    });

    it('should include details when provided', () => {
      const details = { position: 10, character: '{' };
      const response = ErrorBuilder.parseError('Invalid JSON', details);

      expect(response.error.data?.details).toEqual(details);
    });
  });

  describe('invalidRequest', () => {
    it('should create an invalid request error', () => {
      const response = ErrorBuilder.invalidRequest('Missing method', 'req-123');

      expect(response.error.code).toBe(ErrorCode.INVALID_REQUEST);
      expect(response.error.message).toBe('Missing method');
      expect(response.id).toBe('req-123');
    });
  });

  describe('methodNotFound', () => {
    it('should create a method not found error', () => {
      const response = ErrorBuilder.methodNotFound('unknown/method', 'req-123');

      expect(response.error.code).toBe(ErrorCode.METHOD_NOT_FOUND);
      expect(response.error.message).toContain('unknown/method');
      expect(response.error.data?.details).toEqual({ method: 'unknown/method' });
    });
  });

  describe('invalidParams', () => {
    it('should create an invalid params error', () => {
      const response = ErrorBuilder.invalidParams(
        'Missing required parameter',
        'req-123',
        mockContext
      );

      expect(response.error.code).toBe(ErrorCode.INVALID_PARAMS);
      expect(response.error.message).toBe('Missing required parameter');
    });
  });

  describe('internalError', () => {
    it('should create an internal error', () => {
      const error = new Error('Something went wrong');
      const response = ErrorBuilder.internalError('Internal error', 'req-123', mockContext, error);

      expect(response.error.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(response.error.message).toBe('Internal error');
      expect(response.error.data?.details).toEqual({
        name: 'Error',
        message: 'Something went wrong',
      });
    });
  });

  describe('toolNotFound', () => {
    it('should create a tool not found error', () => {
      const response = ErrorBuilder.toolNotFound('my-tool', 'req-123', mockContext);

      expect(response.error.code).toBe(ErrorCode.TOOL_NOT_FOUND);
      expect(response.error.message).toContain('my-tool');
      expect(response.error.data?.toolName).toBe('my-tool');
    });
  });

  describe('toolDisabled', () => {
    it('should create a tool disabled error', () => {
      const response = ErrorBuilder.toolDisabled('my-tool', 'req-123', mockContext);

      expect(response.error.code).toBe(ErrorCode.TOOL_DISABLED);
      expect(response.error.message).toContain('my-tool');
      expect(response.error.data?.toolName).toBe('my-tool');
    });
  });

  describe('serviceUnavailable', () => {
    it('should create a service unavailable error', () => {
      const response = ErrorBuilder.serviceUnavailable('my-service', 'req-123', mockContext);

      expect(response.error.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
      expect(response.error.message).toContain('my-service');
      expect(response.error.data?.serviceName).toBe('my-service');
    });

    it('should include additional details', () => {
      const details = { reason: 'Connection refused' };
      const response = ErrorBuilder.serviceUnavailable(
        'my-service',
        'req-123',
        mockContext,
        details
      );

      expect(response.error.data?.details).toEqual(details);
    });
  });

  describe('serviceUnhealthy', () => {
    it('should create a service unhealthy error', () => {
      const response = ErrorBuilder.serviceUnhealthy('my-service', 'req-123', mockContext);

      expect(response.error.code).toBe(ErrorCode.SERVICE_UNHEALTHY);
      expect(response.error.message).toContain('my-service');
      expect(response.error.data?.serviceName).toBe('my-service');
    });
  });

  describe('connectionPoolExhausted', () => {
    it('should create a connection pool exhausted error', () => {
      const response = ErrorBuilder.connectionPoolExhausted('my-service', 'req-123', mockContext);

      expect(response.error.code).toBe(ErrorCode.CONNECTION_POOL_EXHAUSTED);
      expect(response.error.message).toContain('my-service');
      expect(response.error.data?.serviceName).toBe('my-service');
    });
  });

  describe('timeout', () => {
    it('should create a timeout error', () => {
      const response = ErrorBuilder.timeout('Operation timed out', 'req-123', mockContext, 5000);

      expect(response.error.code).toBe(ErrorCode.TIMEOUT);
      expect(response.error.message).toBe('Operation timed out');
      expect(response.error.data?.details).toEqual({ timeoutMs: 5000 });
    });
  });

  describe('validationError', () => {
    it('should create a validation error', () => {
      const validationErrors = [
        { field: 'name', message: 'Required' },
        { field: 'age', message: 'Must be positive' },
      ];
      const response = ErrorBuilder.validationError(
        'Validation failed',
        'req-123',
        mockContext,
        validationErrors
      );

      expect(response.error.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(response.error.message).toBe('Validation failed');
      expect(response.error.data?.details).toEqual(validationErrors);
    });
  });

  describe('configurationError', () => {
    it('should create a configuration error', () => {
      const response = ErrorBuilder.configurationError(
        'Invalid configuration',
        'req-123',
        mockContext
      );

      expect(response.error.code).toBe(ErrorCode.CONFIGURATION_ERROR);
      expect(response.error.message).toBe('Invalid configuration');
    });
  });

  describe('sessionError', () => {
    it('should create a session error', () => {
      const response = ErrorBuilder.sessionError('Session expired', 'req-123', mockContext);

      expect(response.error.code).toBe(ErrorCode.SESSION_ERROR);
      expect(response.error.message).toBe('Session expired');
    });
  });
});
