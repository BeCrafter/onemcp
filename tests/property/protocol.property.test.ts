import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { JsonRpcParser } from '../../src/protocol/parser.js';
import { JsonRpcSerializer } from '../../src/protocol/serializer.js';
import type {
  JsonRpcMessage,
  JsonRpcRequest,
  JsonRpcSuccessResponse,
  JsonRpcErrorResponse,
  JsonRpcNotification,
  JsonRpcError,
} from '../../src/types/jsonrpc.js';

/**
 * Feature: onemcp-system
 * Property-based tests for Protocol Layer
 *
 * Tests:
 * - Property 11: JSON-RPC request acceptance
 * - Property 12: JSON-RPC response compliance
 * - Property 21: JSON-RPC message round-trip (integration with existing test)
 *
 * **Validates: Requirements 7.1, 7.2, 29.5**
 */

// ============================================================================
// Arbitrary Generators
// ============================================================================

/**
 * Generate valid JSON-RPC request IDs (string or number)
 */
const jsonRpcIdArbitrary = (): fc.Arbitrary<string | number> =>
  fc.oneof(
    fc.string({ minLength: 1, maxLength: 100 }),
    fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER })
  );

/**
 * Generate valid JSON-RPC method names
 * Method names must not start with "rpc." (reserved for internal use)
 */
const methodNameArbitrary = (): fc.Arbitrary<string> =>
  fc.string({ minLength: 1, maxLength: 100 }).filter((s) => !s.startsWith('rpc.'));

/**
 * Generate arbitrary JSON-compatible values for params/result
 */
const jsonValueArbitrary = (): fc.Arbitrary<unknown> =>
  fc.letrec((tie) => ({
    value: fc.oneof(
      { depthSize: 'small' },
      fc.constant(null),
      fc.boolean(),
      fc.integer(),
      fc.double({ noNaN: true, noDefaultInfinity: true }).filter((n) => !Object.is(n, -0)),
      fc.string(),
      fc.array(tie('value'), { maxLength: 5 }),
      fc.dictionary(fc.string({ minLength: 1, maxLength: 20 }), tie('value'), { maxKeys: 5 })
    ),
  })).value as fc.Arbitrary<unknown>;

/**
 * Generate JSON-RPC error objects
 */
const jsonRpcErrorArbitrary = (): fc.Arbitrary<JsonRpcError> => {
  return fc
    .tuple(
      fc.integer(),
      fc.string({ minLength: 1, maxLength: 200 }),
      fc.option(
        fc
          .tuple(
            fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
            fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
            fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
            fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
            fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
            fc.option(jsonValueArbitrary(), { nil: undefined }),
            fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: undefined })
          )
          .map(([correlationId, requestId, sessionId, serviceName, toolName, details, stack]) => {
            const data: any = {};

            if (correlationId !== undefined) data.correlationId = correlationId;
            if (requestId !== undefined) data.requestId = requestId;
            if (sessionId !== undefined) data.sessionId = sessionId;
            if (serviceName !== undefined) data.serviceName = serviceName;
            if (toolName !== undefined) data.toolName = toolName;
            if (details !== undefined) data.details = details;
            if (stack !== undefined) data.stack = stack;

            return data;
          }),
        { nil: undefined }
      )
    )
    .map(([code, message, data]) => {
      const error: any = {
        code,
        message,
      };

      if (data !== undefined) error.data = data;

      return error as JsonRpcError;
    });
};

/**
 * Generate JSON-RPC request messages
 */
const jsonRpcRequestArbitrary = (): fc.Arbitrary<JsonRpcRequest> =>
  fc.record({
    jsonrpc: fc.constant('2.0' as const),
    id: jsonRpcIdArbitrary(),
    method: methodNameArbitrary(),
    params: fc.option(jsonValueArbitrary(), { nil: undefined }),
  });

/**
 * Generate JSON-RPC success response messages
 */
const jsonRpcSuccessResponseArbitrary = (): fc.Arbitrary<JsonRpcSuccessResponse> =>
  fc.record({
    jsonrpc: fc.constant('2.0' as const),
    id: jsonRpcIdArbitrary(),
    result: jsonValueArbitrary(),
  });

/**
 * Generate JSON-RPC error response messages
 */
const jsonRpcErrorResponseArbitrary = (): fc.Arbitrary<JsonRpcErrorResponse> =>
  fc.record({
    jsonrpc: fc.constant('2.0' as const),
    id: fc.oneof(jsonRpcIdArbitrary(), fc.constant(null)),
    error: jsonRpcErrorArbitrary(),
  });

/**
 * Generate JSON-RPC notification messages
 */
const jsonRpcNotificationArbitrary = (): fc.Arbitrary<JsonRpcNotification> =>
  fc.record({
    jsonrpc: fc.constant('2.0' as const),
    method: methodNameArbitrary(),
    params: fc.option(jsonValueArbitrary(), { nil: undefined }),
  });

/**
 * Generate any valid JSON-RPC message
 */
const jsonRpcMessageArbitrary = (): fc.Arbitrary<JsonRpcMessage> =>
  fc.oneof(
    jsonRpcRequestArbitrary(),
    jsonRpcSuccessResponseArbitrary(),
    jsonRpcErrorResponseArbitrary(),
    jsonRpcNotificationArbitrary()
  );

// ============================================================================
// Property 11: JSON-RPC Request Acceptance
// ============================================================================

describe('Feature: onemcp-system, Property 11: JSON-RPC request acceptance', () => {
  let parser: JsonRpcParser;

  beforeEach(() => {
    parser = new JsonRpcParser();
  });

  it('should accept and parse all valid JSON-RPC 2.0 requests', () => {
    fc.assert(
      fc.property(jsonRpcRequestArbitrary(), (request) => {
        // Serialize the request to JSON string
        const serialized = JSON.stringify(request);

        // Parse should succeed without throwing
        const parsed = parser.parse(serialized);

        // Parsed message should be a valid request
        expect(parser.isRequest(parsed)).toBe(true);

        // Validation should pass
        const validation = parser.validate(parsed);
        expect(validation.valid).toBe(true);

        // Parsed message should match the serialized-then-parsed version
        // (This handles edge cases like -0 becoming 0 through JSON serialization)
        const expected = JSON.parse(serialized);
        expect(parsed).toEqual(expected);

        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('should accept requests with various parameter types', () => {
    fc.assert(
      fc.property(
        jsonRpcIdArbitrary(),
        methodNameArbitrary(),
        jsonValueArbitrary(),
        (id, method, params) => {
          const request: JsonRpcRequest = {
            jsonrpc: '2.0',
            id,
            method,
            params,
          };

          const serialized = JSON.stringify(request);
          const parsed = parser.parse(serialized);

          expect(parser.isRequest(parsed)).toBe(true);
          expect(parsed).toEqual(request);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should accept requests without params field', () => {
    fc.assert(
      fc.property(jsonRpcIdArbitrary(), methodNameArbitrary(), (id, method) => {
        const request: JsonRpcRequest = {
          jsonrpc: '2.0',
          id,
          method,
        };

        const serialized = JSON.stringify(request);
        const parsed = parser.parse(serialized);

        expect(parser.isRequest(parsed)).toBe(true);
        expect(parsed).toEqual(request);

        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('should accept notifications (requests without id)', () => {
    fc.assert(
      fc.property(jsonRpcNotificationArbitrary(), (notification) => {
        const serialized = JSON.stringify(notification);
        const parsed = parser.parse(serialized);

        expect(parser.isNotification(parsed)).toBe(true);

        const validation = parser.validate(parsed);
        expect(validation.valid).toBe(true);

        expect(parsed).toEqual(notification);

        return true;
      }),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Property 12: JSON-RPC Response Compliance
// ============================================================================

describe('Feature: onemcp-system, Property 12: JSON-RPC response compliance', () => {
  let parser: JsonRpcParser;
  let serializer: JsonRpcSerializer;

  beforeEach(() => {
    parser = new JsonRpcParser();
    serializer = new JsonRpcSerializer();
  });

  it('should produce JSON-RPC 2.0 compliant success responses', () => {
    fc.assert(
      fc.property(jsonRpcSuccessResponseArbitrary(), (response) => {
        // Serialize the response
        const serialized = serializer.serialize(response);

        // Parse it back
        const parsed = parser.parse(serialized);

        // Should be recognized as a success response
        expect(parser.isSuccessResponse(parsed)).toBe(true);

        // Should pass validation
        const validation = parser.validate(parsed);
        expect(validation.valid).toBe(true);

        // Should have required fields
        expect(parsed).toHaveProperty('jsonrpc', '2.0');
        expect(parsed).toHaveProperty('id');
        expect(parsed).toHaveProperty('result');

        // Should not have error field
        expect(parsed).not.toHaveProperty('error');

        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('should produce JSON-RPC 2.0 compliant error responses', () => {
    fc.assert(
      fc.property(jsonRpcErrorResponseArbitrary(), (response) => {
        // Serialize the response
        const serialized = serializer.serialize(response);

        // Parse it back
        const parsed = parser.parse(serialized);

        // Should be recognized as an error response
        expect(parser.isErrorResponse(parsed)).toBe(true);

        // Should pass validation
        const validation = parser.validate(parsed);
        expect(validation.valid).toBe(true);

        // Should have required fields
        expect(parsed).toHaveProperty('jsonrpc', '2.0');
        expect(parsed).toHaveProperty('id');
        expect(parsed).toHaveProperty('error');

        // Error should have required fields
        const errorResponse = parsed as JsonRpcErrorResponse;
        expect(errorResponse.error).toHaveProperty('code');
        expect(errorResponse.error).toHaveProperty('message');
        expect(typeof errorResponse.error.code).toBe('number');
        expect(typeof errorResponse.error.message).toBe('string');

        // Should not have result field
        expect(parsed).not.toHaveProperty('result');

        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('should produce compliant responses for all message types', () => {
    fc.assert(
      fc.property(jsonRpcMessageArbitrary(), (message) => {
        // Serialize the message
        const serialized = serializer.serialize(message);

        // Parse it back
        const parsed = parser.parse(serialized);

        // Should pass validation
        const validation = parser.validate(parsed);
        expect(validation.valid).toBe(true);

        // Should have jsonrpc field set to "2.0"
        expect(parsed).toHaveProperty('jsonrpc', '2.0');

        // Should be one of the valid message types
        const isValidType =
          parser.isRequest(parsed) ||
          parser.isSuccessResponse(parsed) ||
          parser.isErrorResponse(parsed) ||
          parser.isNotification(parsed);
        expect(isValidType).toBe(true);

        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('should ensure error responses have proper error structure', () => {
    fc.assert(
      fc.property(
        jsonRpcIdArbitrary(),
        fc.integer(),
        fc.string({ minLength: 1 }),
        fc.option(
          fc
            .tuple(
              fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
              fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
              fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
              fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
              fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
              fc.option(jsonValueArbitrary(), { nil: undefined }),
              fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: undefined })
            )
            .map(([correlationId, requestId, sessionId, serviceName, toolName, details, stack]) => {
              const data: any = {};

              if (correlationId !== undefined) data.correlationId = correlationId;
              if (requestId !== undefined) data.requestId = requestId;
              if (sessionId !== undefined) data.sessionId = sessionId;
              if (serviceName !== undefined) data.serviceName = serviceName;
              if (toolName !== undefined) data.toolName = toolName;
              if (details !== undefined) data.details = details;
              if (stack !== undefined) data.stack = stack;

              return data;
            })
        ),
        (id, code, message, data) => {
          const errorObj: JsonRpcError = {
            code,
            message,
          };
          if (data && Object.keys(data).length > 0) {
            errorObj.data = data;
          }
          const response: JsonRpcErrorResponse = {
            jsonrpc: '2.0',
            id,
            error: errorObj,
          };

          const serialized = serializer.serialize(response);
          const parsed = parser.parse(serialized);

          expect(parser.isErrorResponse(parsed)).toBe(true);

          const validation = parser.validate(parsed);
          expect(validation.valid).toBe(true);

          const errorResponse = parsed as JsonRpcErrorResponse;
          expect(errorResponse.error.code).toBe(code);
          expect(errorResponse.error.message).toBe(message);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle null id in error responses', () => {
    fc.assert(
      fc.property(fc.integer(), fc.string({ minLength: 1 }), (code, message) => {
        const response: JsonRpcErrorResponse = {
          jsonrpc: '2.0',
          id: null,
          error: {
            code,
            message,
          },
        };

        const serialized = serializer.serialize(response);
        const parsed = parser.parse(serialized);

        expect(parser.isErrorResponse(parsed)).toBe(true);

        const validation = parser.validate(parsed);
        expect(validation.valid).toBe(true);

        const errorResponse = parsed as JsonRpcErrorResponse;
        expect(errorResponse.id).toBe(null);

        return true;
      }),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Property 21: JSON-RPC Message Round-Trip (Integration Test)
// ============================================================================

describe('Feature: onemcp-system, Property 21: JSON-RPC message round-trip (integration)', () => {
  let parser: JsonRpcParser;
  let serializer: JsonRpcSerializer;

  beforeEach(() => {
    parser = new JsonRpcParser();
    serializer = new JsonRpcSerializer();
  });

  it('should preserve all message types through serialize-parse round-trip', () => {
    fc.assert(
      fc.property(jsonRpcMessageArbitrary(), (message) => {
        // Serialize
        const serialized = serializer.serialize(message);

        // Parse
        const parsed = parser.parse(serialized);

        // Should be equal
        expect(parsed).toEqual(message);

        // Validation should pass
        const validation = parser.validate(parsed);
        expect(validation.valid).toBe(true);

        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('should preserve requests through round-trip', () => {
    fc.assert(
      fc.property(jsonRpcRequestArbitrary(), (request) => {
        const serialized = serializer.serialize(request);
        const parsed = parser.parse(serialized);

        expect(parsed).toEqual(request);
        expect(parser.isRequest(parsed)).toBe(true);

        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('should preserve success responses through round-trip', () => {
    fc.assert(
      fc.property(jsonRpcSuccessResponseArbitrary(), (response) => {
        const serialized = serializer.serialize(response);
        const parsed = parser.parse(serialized);

        expect(parsed).toEqual(response);
        expect(parser.isSuccessResponse(parsed)).toBe(true);

        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('should preserve error responses through round-trip', () => {
    fc.assert(
      fc.property(jsonRpcErrorResponseArbitrary(), (response) => {
        const serialized = serializer.serialize(response);
        const parsed = parser.parse(serialized);

        expect(parsed).toEqual(response);
        expect(parser.isErrorResponse(parsed)).toBe(true);

        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('should preserve notifications through round-trip', () => {
    fc.assert(
      fc.property(jsonRpcNotificationArbitrary(), (notification) => {
        const serialized = serializer.serialize(notification);
        const parsed = parser.parse(serialized);

        expect(parsed).toEqual(notification);
        expect(parser.isNotification(parsed)).toBe(true);

        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('should preserve prettyPrint output through round-trip', () => {
    fc.assert(
      fc.property(jsonRpcMessageArbitrary(), (message) => {
        // Pretty print
        const pretty = serializer.prettyPrint(message);

        // Parse
        const parsed = parser.parse(pretty);

        // Should be equal
        expect(parsed).toEqual(message);

        return true;
      }),
      { numRuns: 100 }
    );
  });
});
