/**
 * Unit tests for JSON-RPC Serializer
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { JsonRpcSerializer } from '../../../src/protocol/serializer.js';
import type {
  JsonRpcRequest,
  JsonRpcSuccessResponse,
  JsonRpcErrorResponse,
  JsonRpcNotification,
} from '../../../src/types/jsonrpc.js';

describe('JsonRpcSerializer', () => {
  let serializer: JsonRpcSerializer;

  beforeEach(() => {
    serializer = new JsonRpcSerializer();
  });

  describe('serialize()', () => {
    it('should serialize a request', () => {
      const message: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'test',
        params: { foo: 'bar' },
      };

      const serialized = serializer.serialize(message);

      expect(serialized).toBe(JSON.stringify(message));
      expect(JSON.parse(serialized)).toEqual(message);
    });

    it('should serialize a request with string id', () => {
      const message: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 'test-id',
        method: 'test',
      };

      const serialized = serializer.serialize(message);

      expect(serialized).toBe(JSON.stringify(message));
      expect(JSON.parse(serialized)).toEqual(message);
    });

    it('should serialize a request without params', () => {
      const message: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'test',
      };

      const serialized = serializer.serialize(message);

      expect(serialized).toBe(JSON.stringify(message));
      expect(JSON.parse(serialized)).toEqual(message);
    });

    it('should serialize a success response', () => {
      const message: JsonRpcSuccessResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: { success: true },
      };

      const serialized = serializer.serialize(message);

      expect(serialized).toBe(JSON.stringify(message));
      expect(JSON.parse(serialized)).toEqual(message);
    });

    it('should serialize an error response', () => {
      const message: JsonRpcErrorResponse = {
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32600,
          message: 'Invalid Request',
        },
      };

      const serialized = serializer.serialize(message);

      expect(serialized).toBe(JSON.stringify(message));
      expect(JSON.parse(serialized)).toEqual(message);
    });

    it('should serialize an error response with null id', () => {
      const message: JsonRpcErrorResponse = {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: 'Parse error',
        },
      };

      const serialized = serializer.serialize(message);

      expect(serialized).toBe(JSON.stringify(message));
      expect(JSON.parse(serialized)).toEqual(message);
    });

    it('should serialize an error response with data', () => {
      const message: JsonRpcErrorResponse = {
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32001,
          message: 'Tool not found',
          data: {
            correlationId: 'test-correlation-id',
            requestId: 'test-request-id',
            toolName: 'test-tool',
          },
        },
      };

      const serialized = serializer.serialize(message);

      expect(serialized).toBe(JSON.stringify(message));
      expect(JSON.parse(serialized)).toEqual(message);
    });

    it('should serialize a notification', () => {
      const message: JsonRpcNotification = {
        jsonrpc: '2.0',
        method: 'notify',
        params: { event: 'test' },
      };

      const serialized = serializer.serialize(message);

      expect(serialized).toBe(JSON.stringify(message));
      expect(JSON.parse(serialized)).toEqual(message);
    });

    it('should serialize a notification without params', () => {
      const message: JsonRpcNotification = {
        jsonrpc: '2.0',
        method: 'notify',
      };

      const serialized = serializer.serialize(message);

      expect(serialized).toBe(JSON.stringify(message));
      expect(JSON.parse(serialized)).toEqual(message);
    });

    it('should serialize complex nested data structures', () => {
      const message: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'test',
        params: {
          nested: {
            array: [1, 2, 3],
            object: { key: 'value' },
            null: null,
            boolean: true,
          },
        },
      };

      const serialized = serializer.serialize(message);

      expect(serialized).toBe(JSON.stringify(message));
      expect(JSON.parse(serialized)).toEqual(message);
    });
  });

  describe('prettyPrint()', () => {
    it('should pretty-print a request with default indentation', () => {
      const message: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'test',
        params: { foo: 'bar' },
      };

      const pretty = serializer.prettyPrint(message);

      expect(pretty).toBe(JSON.stringify(message, null, 2));
      expect(pretty).toContain('\n');
      expect(pretty).toContain('  ');
    });

    it('should pretty-print with custom indentation', () => {
      const message: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'test',
      };

      const pretty = serializer.prettyPrint(message, 4);

      expect(pretty).toBe(JSON.stringify(message, null, 4));
      expect(pretty).toContain('\n');
      expect(pretty).toContain('    ');
    });

    it('should pretty-print a success response', () => {
      const message: JsonRpcSuccessResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: { success: true },
      };

      const pretty = serializer.prettyPrint(message);

      expect(pretty).toBe(JSON.stringify(message, null, 2));
      expect(JSON.parse(pretty)).toEqual(message);
    });

    it('should pretty-print an error response', () => {
      const message: JsonRpcErrorResponse = {
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32600,
          message: 'Invalid Request',
          data: {
            correlationId: 'test-id',
          },
        },
      };

      const pretty = serializer.prettyPrint(message);

      expect(pretty).toBe(JSON.stringify(message, null, 2));
      expect(JSON.parse(pretty)).toEqual(message);
    });

    it('should pretty-print a notification', () => {
      const message: JsonRpcNotification = {
        jsonrpc: '2.0',
        method: 'notify',
        params: { event: 'test' },
      };

      const pretty = serializer.prettyPrint(message);

      expect(pretty).toBe(JSON.stringify(message, null, 2));
      expect(JSON.parse(pretty)).toEqual(message);
    });

    it('should pretty-print complex nested structures', () => {
      const message: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'test',
        params: {
          nested: {
            array: [1, 2, 3],
            object: { key: 'value' },
          },
        },
      };

      const pretty = serializer.prettyPrint(message);

      expect(pretty).toBe(JSON.stringify(message, null, 2));
      expect(pretty).toContain('\n');
      expect(JSON.parse(pretty)).toEqual(message);
    });
  });

  describe('round-trip serialization', () => {
    it('should maintain data integrity through serialize and parse', () => {
      const messages: Array<
        JsonRpcRequest | JsonRpcSuccessResponse | JsonRpcErrorResponse | JsonRpcNotification
      > = [
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'test',
          params: { foo: 'bar' },
        },
        {
          jsonrpc: '2.0',
          id: 'string-id',
          result: { success: true },
        },
        {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32700,
            message: 'Parse error',
          },
        },
        {
          jsonrpc: '2.0',
          method: 'notify',
          params: { event: 'test' },
        },
      ];

      for (const message of messages) {
        const serialized = serializer.serialize(message);
        const parsed = JSON.parse(serialized);
        expect(parsed).toEqual(message);
      }
    });

    it('should maintain data integrity through prettyPrint and parse', () => {
      const messages: Array<
        JsonRpcRequest | JsonRpcSuccessResponse | JsonRpcErrorResponse | JsonRpcNotification
      > = [
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'test',
          params: { foo: 'bar' },
        },
        {
          jsonrpc: '2.0',
          id: 'string-id',
          result: { success: true },
        },
        {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32700,
            message: 'Parse error',
          },
        },
        {
          jsonrpc: '2.0',
          method: 'notify',
          params: { event: 'test' },
        },
      ];

      for (const message of messages) {
        const pretty = serializer.prettyPrint(message);
        const parsed = JSON.parse(pretty);
        expect(parsed).toEqual(message);
      }
    });
  });
});
