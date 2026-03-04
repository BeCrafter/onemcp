import { describe, it, expect } from 'vitest';
import { ErrorPropagation } from '../../../src/errors/error-propagation.js';
import {
  McpRouterError,
  ToolNotFoundError,
  ServiceUnavailableError,
} from '../../../src/errors/custom-errors.js';
import { ErrorCode, JsonRpcError } from '../../../src/types/jsonrpc.js';
import type { RequestContext } from '../../../src/types/context.js';

describe('ErrorPropagation', () => {
  const mockContext: RequestContext = {
    requestId: 'req-123',
    correlationId: 'corr-456',
    sessionId: 'session-789',
    agentId: 'agent-001',
    timestamp: new Date('2024-01-01T00:00:00Z'),
  };

  describe('propagateError', () => {
    it('should propagate standard Error as internal error', () => {
      const error = new Error('Something went wrong');
      const response = ErrorPropagation.propagateError({
        error,
        requestId: 'req-123',
        context: mockContext,
        serviceName: 'test-service',
      });

      expect(response.error.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(response.error.message).toBe('Something went wrong');
      expect(response.error.data?.serviceName).toBe('test-service');
      expect(response.error.data?.correlationId).toBe('corr-456');
    });

    it('should propagate McpRouterError with correct code', () => {
      const error = new ToolNotFoundError('my-tool');
      const response = ErrorPropagation.propagateError({
        error,
        requestId: 'req-123',
        context: mockContext,
      });

      expect(response.error.code).toBe(ErrorCode.TOOL_NOT_FOUND);
      expect(response.error.message).toContain('my-tool');
      expect(response.error.data?.correlationId).toBe('corr-456');
    });

    it('should propagate JSON-RPC error with added context', () => {
      const jsonRpcError: JsonRpcError = {
        code: -32000,
        message: 'Backend error',
        data: { originalData: 'test' },
      };

      const response = ErrorPropagation.propagateError({
        error: jsonRpcError,
        requestId: 'req-123',
        context: mockContext,
        serviceName: 'backend-service',
      });

      expect(response.error.code).toBe(-32000);
      expect(response.error.message).toBe('Backend error');
      expect(response.error.data?.originalData).toBe('test');
      expect(response.error.data?.serviceName).toBe('backend-service');
      expect(response.error.data?.correlationId).toBe('corr-456');
      expect(response.error.data?.propagatedFrom).toBe('backend');
    });

    it('should handle unknown error types', () => {
      const error = 'string error';
      const response = ErrorPropagation.propagateError({
        error,
        requestId: 'req-123',
        context: mockContext,
      });

      expect(response.error.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(response.error.message).toBe('An unknown error occurred');
    });

    it('should add service and tool names to propagated errors', () => {
      const error = new Error('Test error');
      const response = ErrorPropagation.propagateError({
        error,
        requestId: 'req-123',
        context: mockContext,
        serviceName: 'my-service',
        toolName: 'my-tool',
      });

      expect(response.error.data?.serviceName).toBe('my-service');
      expect(response.error.data?.toolName).toBe('my-tool');
    });
  });

  describe('extractErrorMessage', () => {
    it('should extract message from Error', () => {
      const error = new Error('Test message');
      expect(ErrorPropagation.extractErrorMessage(error)).toBe('Test message');
    });

    it('should extract message from JSON-RPC error', () => {
      const error: JsonRpcError = {
        code: -32000,
        message: 'JSON-RPC error message',
      };
      expect(ErrorPropagation.extractErrorMessage(error)).toBe('JSON-RPC error message');
    });

    it('should handle string errors', () => {
      expect(ErrorPropagation.extractErrorMessage('string error')).toBe('string error');
    });

    it('should handle unknown error types', () => {
      expect(ErrorPropagation.extractErrorMessage({ unknown: 'object' })).toBe(
        'An unknown error occurred'
      );
    });
  });

  describe('extractErrorCode', () => {
    it('should extract code from McpRouterError', () => {
      const error = new ServiceUnavailableError('test-service');
      expect(ErrorPropagation.extractErrorCode(error)).toBe(ErrorCode.SERVICE_UNAVAILABLE);
    });

    it('should extract code from JSON-RPC error', () => {
      const error: JsonRpcError = {
        code: -32000,
        message: 'Test error',
      };
      expect(ErrorPropagation.extractErrorCode(error)).toBe(-32000);
    });

    it('should return INTERNAL_ERROR for unknown error types', () => {
      expect(ErrorPropagation.extractErrorCode(new Error('test'))).toBe(
        ErrorCode.INTERNAL_ERROR
      );
    });
  });
});
