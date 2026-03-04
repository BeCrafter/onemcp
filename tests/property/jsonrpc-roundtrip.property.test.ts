import { describe, it, expect } from 'vitest';
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
 * Feature: onemcp-router-system, Property 21: JSON-RPC message round-trip
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
  fc.string({ minLength: 1, maxLength: 100 }).filter(s => !s.startsWith('rpc.'));

/**
 * Generate arbitrary JSON-compatible values for params/result
 */
const jsonValueArbitrary = (): fc.Arbitrary<unknown> =>
  fc.letrec(tie => ({
    value: fc.oneof(
      { depthSize: 'small' },
      fc.constant(null),
      fc.boolean(),
      fc.integer(),
      fc.double({ noNaN: true, noDefaultInfinity: true }),
      fc.string(),
      fc.array(tie('value') as fc.Arbitrary<unknown>, { maxLength: 5 }),
      fc.dictionary(
        fc.string({ minLength: 1, maxLength: 20 }),
        tie('value') as fc.Arbitrary<unknown>,
        { maxKeys: 5 }
      )
    ),
  })).value as fc.Arbitrary<unknown>;

/**
 * Generate JSON-RPC error objects
 */
const jsonRpcErrorArbitrary = (): fc.Arbitrary<JsonRpcError> =>
  fc.record({
    code: fc.integer(),
    message: fc.string({ minLength: 1, maxLength: 200 }),
    data: fc.option(
      fc.record({
        correlationId: fc.option(fc.string()),
        requestId: fc.option(fc.string()),
        sessionId: fc.option(fc.string()),
        serviceName: fc.option(fc.string()),
        toolName: fc.option(fc.string()),
        details: fc.option(jsonValueArbitrary()),
        stack: fc.option(fc.string()),
      }),
      { nil: undefined }
    ),
  });

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

describe('Feature: onemcp-router-system, Property 21: JSON-RPC message round-trip', () => {
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
