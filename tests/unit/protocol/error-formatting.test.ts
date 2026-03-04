/**
 * Unit tests for JSON-RPC Error Response Formatting
 * 
 * Tests error response formatting according to requirements:
 * - 7.3: Error responses must be JSON-RPC 2.0 compliant
 * - 9.1: Error responses must contain code, message, and context details
 * - 29.2: Parser must handle invalid message structures
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { JsonRpcParser } from '../../../src/protocol/parser.js';
import { JsonRpcSerializer } from '../../../src/protocol/serializer.js';
import { ErrorCode, type JsonRpcErrorResponse } from '../../../src/types/jsonrpc.js';

describe('Error Response Formatting', () => {
  let parser: JsonRpcParser;
  let serializer: JsonRpcSerializer;

  beforeEach(() => {
    parser = new JsonRpcParser();
    serializer = new JsonRpcSerializer();
  });

  describe('Standard JSON-RPC error codes', () => {
    it('should format PARSE_ERROR response correctly', () => {
      const errorResponse: JsonRpcErrorResponse = {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: ErrorCode.PARSE_ERROR,
          message: 'Parse error',
          data: {
            correlationId: 'test-correlation-id',
            requestId: 'test-request-id',
          },
        },
      };

      const serialized = serializer.serialize(errorResponse);
      const parsed = parser.parse(serialized);

      expect(parser.isErrorResponse(parsed)).toBe(true);
      expect(parsed).toEqual(errorResponse);
      
      const errorResp = parsed as JsonRpcErrorResponse;
      expect(errorResp.error.code).toBe(ErrorCode.PARSE_ERROR);
      expect(errorResp.error.message).toBe('Parse error');
      expect(errorResp.error.data?.correlationId).toBe('test-correlation-id');
    });

    it('should format INVALID_REQUEST response correctly', () => {
      const errorResponse: JsonRpcErrorResponse = {
        jsonrpc: '2.0',
        id: 'test-id',
        error: {
          code: ErrorCode.INVALID_REQUEST,
          message: 'Invalid Request',
          data: {
            correlationId: 'corr-123',
            requestId: 'req-456',
            details: 'Missing required field: method',
          },
        },
      };

      const serialized = serializer.serialize(errorResponse);
      const parsed = parser.parse(serialized);

      expect(parser.isErrorResponse(parsed)).toBe(true);
      const errorResp = parsed as JsonRpcErrorResponse;
      expect(errorResp.error.code).toBe(ErrorCode.INVALID_REQUEST);
      expect(errorResp.error.message).toBe('Invalid Request');
      expect(errorResp.error.data?.details).toBe('Missing required field: method');
    });

    it('should format METHOD_NOT_FOUND response correctly', () => {
      const errorResponse: JsonRpcErrorResponse = {
        jsonrpc: '2.0',
        id: 42,
        error: {
          code: ErrorCode.METHOD_NOT_FOUND,
          message: 'Method not found',
          data: {
            correlationId: 'corr-789',
            requestId: 'req-101',
            details: 'Method "unknown_method" does not exist',
          },
        },
      };

      const serialized = serializer.serialize(errorResponse);
      const parsed = parser.parse(serialized);

      expect(parser.isErrorResponse(parsed)).toBe(true);
      const errorResp = parsed as JsonRpcErrorResponse;
      expect(errorResp.error.code).toBe(ErrorCode.METHOD_NOT_FOUND);
      expect(errorResp.error.message).toBe('Method not found');
    });

    it('should format INVALID_PARAMS response correctly', () => {
      const errorResponse: JsonRpcErrorResponse = {
        jsonrpc: '2.0',
        id: 'param-test',
        error: {
          code: ErrorCode.INVALID_PARAMS,
          message: 'Invalid params',
          data: {
            correlationId: 'corr-param',
            requestId: 'req-param',
            details: {
              field: 'age',
              expected: 'number',
              received: 'string',
            },
          },
        },
      };

      const serialized = serializer.serialize(errorResponse);
      const parsed = parser.parse(serialized);

      expect(parser.isErrorResponse(parsed)).toBe(true);
      const errorResp = parsed as JsonRpcErrorResponse;
      expect(errorResp.error.code).toBe(ErrorCode.INVALID_PARAMS);
      expect(errorResp.error.message).toBe('Invalid params');
      expect(errorResp.error.data?.details).toEqual({
        field: 'age',
        expected: 'number',
        received: 'string',
      });
    });

    it('should format INTERNAL_ERROR response correctly', () => {
      const errorResponse: JsonRpcErrorResponse = {
        jsonrpc: '2.0',
        id: 999,
        error: {
          code: ErrorCode.INTERNAL_ERROR,
          message: 'Internal error',
          data: {
            correlationId: 'corr-internal',
            requestId: 'req-internal',
            stack: 'Error: Something went wrong\n  at ...',
          },
        },
      };

      const serialized = serializer.serialize(errorResponse);
      const parsed = parser.parse(serialized);

      expect(parser.isErrorResponse(parsed)).toBe(true);
      const errorResp = parsed as JsonRpcErrorResponse;
      expect(errorResp.error.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(errorResp.error.message).toBe('Internal error');
      expect(errorResp.error.data?.stack).toContain('Error: Something went wrong');
    });
  });

  describe('MCP Router System specific error codes', () => {
    it('should format TOOL_NOT_FOUND response correctly', () => {
      const errorResponse: JsonRpcErrorResponse = {
        jsonrpc: '2.0',
        id: 'tool-test',
        error: {
          code: ErrorCode.TOOL_NOT_FOUND,
          message: 'Tool not found',
          data: {
            correlationId: 'corr-tool',
            requestId: 'req-tool',
            toolName: 'filesystem__read_file',
            details: 'Tool "filesystem__read_file" does not exist',
          },
        },
      };

      const serialized = serializer.serialize(errorResponse);
      const parsed = parser.parse(serialized);

      expect(parser.isErrorResponse(parsed)).toBe(true);
      const errorResp = parsed as JsonRpcErrorResponse;
      expect(errorResp.error.code).toBe(ErrorCode.TOOL_NOT_FOUND);
      expect(errorResp.error.message).toBe('Tool not found');
      expect(errorResp.error.data?.toolName).toBe('filesystem__read_file');
    });

    it('should format TOOL_DISABLED response correctly', () => {
      const errorResponse: JsonRpcErrorResponse = {
        jsonrpc: '2.0',
        id: 'disabled-test',
        error: {
          code: ErrorCode.TOOL_DISABLED,
          message: 'Tool is disabled',
          data: {
            correlationId: 'corr-disabled',
            requestId: 'req-disabled',
            toolName: 'github__create_issue',
            serviceName: 'github',
          },
        },
      };

      const serialized = serializer.serialize(errorResponse);
      const parsed = parser.parse(serialized);

      expect(parser.isErrorResponse(parsed)).toBe(true);
      const errorResp = parsed as JsonRpcErrorResponse;
      expect(errorResp.error.code).toBe(ErrorCode.TOOL_DISABLED);
      expect(errorResp.error.message).toBe('Tool is disabled');
      expect(errorResp.error.data?.toolName).toBe('github__create_issue');
      expect(errorResp.error.data?.serviceName).toBe('github');
    });

    it('should format SERVICE_UNAVAILABLE response correctly', () => {
      const errorResponse: JsonRpcErrorResponse = {
        jsonrpc: '2.0',
        id: 'service-test',
        error: {
          code: ErrorCode.SERVICE_UNAVAILABLE,
          message: 'Service unavailable',
          data: {
            correlationId: 'corr-service',
            requestId: 'req-service',
            serviceName: 'database',
            details: 'Service "database" is not responding',
          },
        },
      };

      const serialized = serializer.serialize(errorResponse);
      const parsed = parser.parse(serialized);

      expect(parser.isErrorResponse(parsed)).toBe(true);
      const errorResp = parsed as JsonRpcErrorResponse;
      expect(errorResp.error.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
      expect(errorResp.error.message).toBe('Service unavailable');
      expect(errorResp.error.data?.serviceName).toBe('database');
    });

    it('should format SERVICE_UNHEALTHY response correctly', () => {
      const errorResponse: JsonRpcErrorResponse = {
        jsonrpc: '2.0',
        id: 'health-test',
        error: {
          code: ErrorCode.SERVICE_UNHEALTHY,
          message: 'Service is unhealthy',
          data: {
            correlationId: 'corr-health',
            requestId: 'req-health',
            serviceName: 'api-service',
            details: 'Health check failed 3 times',
          },
        },
      };

      const serialized = serializer.serialize(errorResponse);
      const parsed = parser.parse(serialized);

      expect(parser.isErrorResponse(parsed)).toBe(true);
      const errorResp = parsed as JsonRpcErrorResponse;
      expect(errorResp.error.code).toBe(ErrorCode.SERVICE_UNHEALTHY);
      expect(errorResp.error.message).toBe('Service is unhealthy');
      expect(errorResp.error.data?.serviceName).toBe('api-service');
    });

    it('should format CONNECTION_POOL_EXHAUSTED response correctly', () => {
      const errorResponse: JsonRpcErrorResponse = {
        jsonrpc: '2.0',
        id: 'pool-test',
        error: {
          code: ErrorCode.CONNECTION_POOL_EXHAUSTED,
          message: 'Connection pool exhausted',
          data: {
            correlationId: 'corr-pool',
            requestId: 'req-pool',
            serviceName: 'heavy-service',
            details: 'Maximum connections (5) reached, request timed out',
          },
        },
      };

      const serialized = serializer.serialize(errorResponse);
      const parsed = parser.parse(serialized);

      expect(parser.isErrorResponse(parsed)).toBe(true);
      const errorResp = parsed as JsonRpcErrorResponse;
      expect(errorResp.error.code).toBe(ErrorCode.CONNECTION_POOL_EXHAUSTED);
      expect(errorResp.error.message).toBe('Connection pool exhausted');
      expect(errorResp.error.data?.serviceName).toBe('heavy-service');
    });

    it('should format TIMEOUT response correctly', () => {
      const errorResponse: JsonRpcErrorResponse = {
        jsonrpc: '2.0',
        id: 'timeout-test',
        error: {
          code: ErrorCode.TIMEOUT,
          message: 'Request timeout',
          data: {
            correlationId: 'corr-timeout',
            requestId: 'req-timeout',
            serviceName: 'slow-service',
            toolName: 'slow-service__long_operation',
            details: 'Request exceeded timeout of 30000ms',
          },
        },
      };

      const serialized = serializer.serialize(errorResponse);
      const parsed = parser.parse(serialized);

      expect(parser.isErrorResponse(parsed)).toBe(true);
      const errorResp = parsed as JsonRpcErrorResponse;
      expect(errorResp.error.code).toBe(ErrorCode.TIMEOUT);
      expect(errorResp.error.message).toBe('Request timeout');
      expect(errorResp.error.data?.details).toContain('30000ms');
    });

    it('should format VALIDATION_ERROR response correctly', () => {
      const errorResponse: JsonRpcErrorResponse = {
        jsonrpc: '2.0',
        id: 'validation-test',
        error: {
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Validation error',
          data: {
            correlationId: 'corr-validation',
            requestId: 'req-validation',
            details: {
              errors: [
                { field: 'email', message: 'Invalid email format' },
                { field: 'age', message: 'Must be a positive number' },
              ],
            },
          },
        },
      };

      const serialized = serializer.serialize(errorResponse);
      const parsed = parser.parse(serialized);

      expect(parser.isErrorResponse(parsed)).toBe(true);
      const errorResp = parsed as JsonRpcErrorResponse;
      expect(errorResp.error.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(errorResp.error.message).toBe('Validation error');
      expect(errorResp.error.data?.details).toHaveProperty('errors');
    });

    it('should format CONFIGURATION_ERROR response correctly', () => {
      const errorResponse: JsonRpcErrorResponse = {
        jsonrpc: '2.0',
        id: 'config-test',
        error: {
          code: ErrorCode.CONFIGURATION_ERROR,
          message: 'Configuration error',
          data: {
            correlationId: 'corr-config',
            requestId: 'req-config',
            details: 'Invalid service configuration: missing required field "command"',
          },
        },
      };

      const serialized = serializer.serialize(errorResponse);
      const parsed = parser.parse(serialized);

      expect(parser.isErrorResponse(parsed)).toBe(true);
      const errorResp = parsed as JsonRpcErrorResponse;
      expect(errorResp.error.code).toBe(ErrorCode.CONFIGURATION_ERROR);
      expect(errorResp.error.message).toBe('Configuration error');
    });

    it('should format SESSION_ERROR response correctly', () => {
      const errorResponse: JsonRpcErrorResponse = {
        jsonrpc: '2.0',
        id: 'session-test',
        error: {
          code: ErrorCode.SESSION_ERROR,
          message: 'Session error',
          data: {
            correlationId: 'corr-session',
            requestId: 'req-session',
            sessionId: 'session-123',
            details: 'Session expired or invalid',
          },
        },
      };

      const serialized = serializer.serialize(errorResponse);
      const parsed = parser.parse(serialized);

      expect(parser.isErrorResponse(parsed)).toBe(true);
      const errorResp = parsed as JsonRpcErrorResponse;
      expect(errorResp.error.code).toBe(ErrorCode.SESSION_ERROR);
      expect(errorResp.error.message).toBe('Session error');
      expect(errorResp.error.data?.sessionId).toBe('session-123');
    });
  });

  describe('Error response context details', () => {
    it('should include all context fields when provided', () => {
      const errorResponse: JsonRpcErrorResponse = {
        jsonrpc: '2.0',
        id: 'context-test',
        error: {
          code: ErrorCode.TOOL_NOT_FOUND,
          message: 'Tool not found',
          data: {
            correlationId: 'corr-full',
            requestId: 'req-full',
            sessionId: 'session-full',
            serviceName: 'test-service',
            toolName: 'test-service__test_tool',
            details: 'Additional context information',
            stack: 'Error stack trace',
          },
        },
      };

      const serialized = serializer.serialize(errorResponse);
      const parsed = parser.parse(serialized);

      expect(parser.isErrorResponse(parsed)).toBe(true);
      const errorResp = parsed as JsonRpcErrorResponse;
      
      // Verify all context fields are preserved
      expect(errorResp.error.data?.correlationId).toBe('corr-full');
      expect(errorResp.error.data?.requestId).toBe('req-full');
      expect(errorResp.error.data?.sessionId).toBe('session-full');
      expect(errorResp.error.data?.serviceName).toBe('test-service');
      expect(errorResp.error.data?.toolName).toBe('test-service__test_tool');
      expect(errorResp.error.data?.details).toBe('Additional context information');
      expect(errorResp.error.data?.stack).toBe('Error stack trace');
    });

    it('should work with minimal context (only required fields)', () => {
      const errorResponse: JsonRpcErrorResponse = {
        jsonrpc: '2.0',
        id: 'minimal-test',
        error: {
          code: ErrorCode.INTERNAL_ERROR,
          message: 'Internal error',
        },
      };

      const serialized = serializer.serialize(errorResponse);
      const parsed = parser.parse(serialized);

      expect(parser.isErrorResponse(parsed)).toBe(true);
      const errorResp = parsed as JsonRpcErrorResponse;
      expect(errorResp.error.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(errorResp.error.message).toBe('Internal error');
      expect(errorResp.error.data).toBeUndefined();
    });

    it('should preserve complex details objects', () => {
      const errorResponse: JsonRpcErrorResponse = {
        jsonrpc: '2.0',
        id: 'complex-test',
        error: {
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Validation error',
          data: {
            correlationId: 'corr-complex',
            requestId: 'req-complex',
            details: {
              validationErrors: [
                {
                  field: 'user.email',
                  message: 'Invalid email',
                  value: 'not-an-email',
                },
                {
                  field: 'user.age',
                  message: 'Must be >= 18',
                  value: 15,
                },
              ],
              timestamp: '2024-01-01T00:00:00Z',
              attemptCount: 3,
            },
          },
        },
      };

      const serialized = serializer.serialize(errorResponse);
      const parsed = parser.parse(serialized);

      expect(parser.isErrorResponse(parsed)).toBe(true);
      const errorResp = parsed as JsonRpcErrorResponse;
      expect(errorResp.error.data?.details).toEqual({
        validationErrors: [
          {
            field: 'user.email',
            message: 'Invalid email',
            value: 'not-an-email',
          },
          {
            field: 'user.age',
            message: 'Must be >= 18',
            value: 15,
          },
        ],
        timestamp: '2024-01-01T00:00:00Z',
        attemptCount: 3,
      });
    });
  });

  describe('Error response with null id', () => {
    it('should handle null id for parse errors', () => {
      const errorResponse: JsonRpcErrorResponse = {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: ErrorCode.PARSE_ERROR,
          message: 'Parse error',
          data: {
            correlationId: 'corr-null-id',
            details: 'Could not parse request, id is unknown',
          },
        },
      };

      const serialized = serializer.serialize(errorResponse);
      const parsed = parser.parse(serialized);

      expect(parser.isErrorResponse(parsed)).toBe(true);
      const errorResp = parsed as JsonRpcErrorResponse;
      expect(errorResp.id).toBe(null);
      expect(errorResp.error.code).toBe(ErrorCode.PARSE_ERROR);
    });

    it('should handle null id for invalid request errors', () => {
      const errorResponse: JsonRpcErrorResponse = {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: ErrorCode.INVALID_REQUEST,
          message: 'Invalid Request',
          data: {
            correlationId: 'corr-invalid',
            details: 'Request structure is invalid, cannot determine id',
          },
        },
      };

      const serialized = serializer.serialize(errorResponse);
      const parsed = parser.parse(serialized);

      expect(parser.isErrorResponse(parsed)).toBe(true);
      const errorResp = parsed as JsonRpcErrorResponse;
      expect(errorResp.id).toBe(null);
      expect(errorResp.error.code).toBe(ErrorCode.INVALID_REQUEST);
    });
  });

  describe('Pretty-printed error responses', () => {
    it('should pretty-print error responses for logging', () => {
      const errorResponse: JsonRpcErrorResponse = {
        jsonrpc: '2.0',
        id: 'pretty-test',
        error: {
          code: ErrorCode.TOOL_NOT_FOUND,
          message: 'Tool not found',
          data: {
            correlationId: 'corr-pretty',
            requestId: 'req-pretty',
            toolName: 'test__tool',
          },
        },
      };

      const pretty = serializer.prettyPrint(errorResponse);
      
      // Should be formatted with newlines and indentation
      expect(pretty).toContain('\n');
      expect(pretty).toContain('  ');
      
      // Should be parseable back to the same object
      const parsed = parser.parse(pretty);
      expect(parsed).toEqual(errorResponse);
    });

    it('should pretty-print with custom indentation', () => {
      const errorResponse: JsonRpcErrorResponse = {
        jsonrpc: '2.0',
        id: 'indent-test',
        error: {
          code: ErrorCode.INTERNAL_ERROR,
          message: 'Internal error',
        },
      };

      const pretty = serializer.prettyPrint(errorResponse, 4);
      
      // Should use 4-space indentation
      expect(pretty).toContain('\n');
      expect(pretty).toContain('    ');
      
      // Should be parseable
      const parsed = parser.parse(pretty);
      expect(parsed).toEqual(errorResponse);
    });
  });
});
