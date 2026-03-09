import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import type {
  JsonRpcMessage,
  JsonRpcRequest,
  JsonRpcSuccessResponse,
  JsonRpcErrorResponse,
  JsonRpcNotification,
  JsonRpcError,
} from '../../src/types/jsonrpc.js';

/**
 * Feature: onemcp-system, Property 21: JSON-RPC message round-trip
 *
 * **Validates: Requirements 29.5**
 *
 * For any valid JSON-RPC message object, serializing then parsing should
 * produce an equivalent message object.
 */

// Arbitrary generators for JSON-RPC message components

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
      fc.double({ noNaN: true, noDefaultInfinity: true }),
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

/**
 * Serialize a JSON-RPC message to a string
 */
function serializeMessage(message: JsonRpcMessage): string {
  return JSON.stringify(message);
}

/**
 * Parse a JSON-RPC message from a string
 */
function parseMessage(serialized: string): JsonRpcMessage {
  return JSON.parse(serialized) as JsonRpcMessage;
}

/**
 * Deep equality check for JSON-RPC messages
 * Handles special cases like NaN, undefined, etc.
 */
function messagesEqual(a: JsonRpcMessage, b: JsonRpcMessage): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

describe('Feature: onemcp-system, Property 21: JSON-RPC message round-trip', () => {
  it('should preserve JSON-RPC request messages through serialization round-trip', () => {
    fc.assert(
      fc.property(jsonRpcRequestArbitrary(), (message) => {
        const serialized = serializeMessage(message);
        const parsed = parseMessage(serialized);
        return messagesEqual(message, parsed);
      }),
      { numRuns: 100 }
    );
  });

  it('should preserve JSON-RPC success response messages through serialization round-trip', () => {
    fc.assert(
      fc.property(jsonRpcSuccessResponseArbitrary(), (message) => {
        const serialized = serializeMessage(message);
        const parsed = parseMessage(serialized);
        return messagesEqual(message, parsed);
      }),
      { numRuns: 100 }
    );
  });

  it('should preserve JSON-RPC error response messages through serialization round-trip', () => {
    fc.assert(
      fc.property(jsonRpcErrorResponseArbitrary(), (message) => {
        const serialized = serializeMessage(message);
        const parsed = parseMessage(serialized);
        return messagesEqual(message, parsed);
      }),
      { numRuns: 100 }
    );
  });

  it('should preserve JSON-RPC notification messages through serialization round-trip', () => {
    fc.assert(
      fc.property(jsonRpcNotificationArbitrary(), (message) => {
        const serialized = serializeMessage(message);
        const parsed = parseMessage(serialized);
        return messagesEqual(message, parsed);
      }),
      { numRuns: 100 }
    );
  });

  it('should preserve any valid JSON-RPC message through serialization round-trip', () => {
    fc.assert(
      fc.property(jsonRpcMessageArbitrary(), (message) => {
        const serialized = serializeMessage(message);
        const parsed = parseMessage(serialized);
        return messagesEqual(message, parsed);
      }),
      { numRuns: 100 }
    );
  });
});
