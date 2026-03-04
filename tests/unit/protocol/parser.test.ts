/**
 * Unit tests for JSON-RPC Parser
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { JsonRpcParser } from '../../../src/protocol/parser.js';
import type {
  JsonRpcRequest,
  JsonRpcSuccessResponse,
  JsonRpcErrorResponse,
  JsonRpcNotification,
} from '../../../src/types/jsonrpc.js';

describe('JsonRpcParser', () => {
  let parser: JsonRpcParser;

  beforeEach(() => {
    parser = new JsonRpcParser();
  });

  describe('parse()', () => {
    describe('valid messages', () => {
      it('should parse a valid request', () => {
        const raw = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'test',
          params: { foo: 'bar' },
        });

        const message = parser.parse(raw);

        expect(message).toEqual({
          jsonrpc: '2.0',
          id: 1,
          method: 'test',
          params: { foo: 'bar' },
        });
      });

      it('should parse a request with string id', () => {
        const raw = JSON.stringify({
          jsonrpc: '2.0',
          id: 'test-id',
          method: 'test',
        });

        const message = parser.parse(raw);

        expect(message).toEqual({
          jsonrpc: '2.0',
          id: 'test-id',
          method: 'test',
        });
      });

      it('should parse a request without params', () => {
        const raw = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'test',
        });

        const message = parser.parse(raw);

        expect(message).toEqual({
          jsonrpc: '2.0',
          id: 1,
          method: 'test',
        });
      });

      it('should parse a valid success response', () => {
        const raw = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { success: true },
        });

        const message = parser.parse(raw);

        expect(message).toEqual({
          jsonrpc: '2.0',
          id: 1,
          result: { success: true },
        });
      });

      it('should parse a valid error response', () => {
        const raw = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          error: {
            code: -32600,
            message: 'Invalid Request',
          },
        });

        const message = parser.parse(raw);

        expect(message).toEqual({
          jsonrpc: '2.0',
          id: 1,
          error: {
            code: -32600,
            message: 'Invalid Request',
          },
        });
      });

      it('should parse an error response with null id', () => {
        const raw = JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32700,
            message: 'Parse error',
          },
        });

        const message = parser.parse(raw);

        expect(message).toEqual({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32700,
            message: 'Parse error',
          },
        });
      });

      it('should parse a valid notification', () => {
        const raw = JSON.stringify({
          jsonrpc: '2.0',
          method: 'notify',
          params: { event: 'test' },
        });

        const message = parser.parse(raw);

        expect(message).toEqual({
          jsonrpc: '2.0',
          method: 'notify',
          params: { event: 'test' },
        });
      });

      it('should parse a notification without params', () => {
        const raw = JSON.stringify({
          jsonrpc: '2.0',
          method: 'notify',
        });

        const message = parser.parse(raw);

        expect(message).toEqual({
          jsonrpc: '2.0',
          method: 'notify',
        });
      });
    });

    describe('malformed JSON', () => {
      it('should throw error for invalid JSON', () => {
        const raw = '{ invalid json }';

        expect(() => parser.parse(raw)).toThrow('Parse error: Invalid JSON');
      });

      it('should throw error for non-object JSON', () => {
        const raw = '"string"';

        expect(() => parser.parse(raw)).toThrow('Parse error: Message must be a JSON object');
      });

      it('should throw error for JSON array', () => {
        const raw = '[]';

        expect(() => parser.parse(raw)).toThrow('Parse error: Message must be a JSON object');
      });

      it('should throw error for JSON null', () => {
        const raw = 'null';

        expect(() => parser.parse(raw)).toThrow('Parse error: Message must be a JSON object');
      });
    });

    describe('invalid message structures', () => {
      it('should throw error for missing jsonrpc field', () => {
        const raw = JSON.stringify({
          id: 1,
          method: 'test',
        });

        expect(() => parser.parse(raw)).toThrow('Invalid request');
      });

      it('should throw error for wrong jsonrpc version', () => {
        const raw = JSON.stringify({
          jsonrpc: '1.0',
          id: 1,
          method: 'test',
        });

        expect(() => parser.parse(raw)).toThrow('Invalid request');
      });

      it('should throw error for request missing method', () => {
        const raw = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
        });

        expect(() => parser.parse(raw)).toThrow('Invalid request');
      });

      it('should parse a notification when id is undefined', () => {
        // When id is undefined in JSON.stringify, it's omitted, making it a notification
        const raw = JSON.stringify({
          jsonrpc: '2.0',
          method: 'test',
          id: undefined,
        });

        const message = parser.parse(raw);

        // This becomes a valid notification
        expect(message).toEqual({
          jsonrpc: '2.0',
          method: 'test',
        });
        expect(parser.isNotification(message)).toBe(true);
      });

      it('should throw error for response with both result and error', () => {
        const raw = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {},
          error: { code: -32600, message: 'Error' },
        });

        expect(() => parser.parse(raw)).toThrow('Invalid request');
      });

      it('should throw error for response missing both result and error', () => {
        const raw = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
        });

        expect(() => parser.parse(raw)).toThrow('Invalid request');
      });

      it('should throw error for invalid id type', () => {
        const raw = JSON.stringify({
          jsonrpc: '2.0',
          id: { invalid: 'object' },
          method: 'test',
        });

        expect(() => parser.parse(raw)).toThrow('Invalid request');
      });

      it('should throw error for error response with invalid error structure', () => {
        const raw = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          error: {
            code: 'not-a-number',
            message: 'Error',
          },
        });

        expect(() => parser.parse(raw)).toThrow('Invalid request');
      });

      it('should throw error for error response missing error code', () => {
        const raw = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          error: {
            message: 'Error',
          },
        });

        expect(() => parser.parse(raw)).toThrow('Invalid request');
      });

      it('should throw error for error response missing error message', () => {
        const raw = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          error: {
            code: -32600,
          },
        });

        expect(() => parser.parse(raw)).toThrow('Invalid request');
      });
    });
  });

  describe('validate()', () => {
    it('should validate a valid request', () => {
      const message: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'test',
      };

      const result = parser.validate(message);

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should validate a valid success response', () => {
      const message: JsonRpcSuccessResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {},
      };

      const result = parser.validate(message);

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should validate a valid error response', () => {
      const message: JsonRpcErrorResponse = {
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32600,
          message: 'Invalid Request',
        },
      };

      const result = parser.validate(message);

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should validate a valid notification', () => {
      const message: JsonRpcNotification = {
        jsonrpc: '2.0',
        method: 'notify',
      };

      const result = parser.validate(message);

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should return error for non-object message', () => {
      const message = 'not an object' as any;

      const result = parser.validate(message);

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0]?.message).toContain('must be a JSON object');
    });

    it('should return error for wrong jsonrpc version', () => {
      const message = {
        jsonrpc: '1.0',
        id: 1,
        method: 'test',
      } as any;

      const result = parser.validate(message);

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0]?.message).toContain('2.0');
    });

    it('should return error for invalid message structure', () => {
      const message = {
        jsonrpc: '2.0',
      } as any;

      const result = parser.validate(message);

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });
  });

  describe('type guards', () => {
    it('should identify a request', () => {
      const message: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'test',
      };

      expect(parser.isRequest(message)).toBe(true);
      expect(parser.isSuccessResponse(message)).toBe(false);
      expect(parser.isErrorResponse(message)).toBe(false);
      expect(parser.isNotification(message)).toBe(false);
    });

    it('should identify a success response', () => {
      const message: JsonRpcSuccessResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {},
      };

      expect(parser.isRequest(message)).toBe(false);
      expect(parser.isSuccessResponse(message)).toBe(true);
      expect(parser.isErrorResponse(message)).toBe(false);
      expect(parser.isNotification(message)).toBe(false);
    });

    it('should identify an error response', () => {
      const message: JsonRpcErrorResponse = {
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32600,
          message: 'Invalid Request',
        },
      };

      expect(parser.isRequest(message)).toBe(false);
      expect(parser.isSuccessResponse(message)).toBe(false);
      expect(parser.isErrorResponse(message)).toBe(true);
      expect(parser.isNotification(message)).toBe(false);
    });

    it('should identify a notification', () => {
      const message: JsonRpcNotification = {
        jsonrpc: '2.0',
        method: 'notify',
      };

      expect(parser.isRequest(message)).toBe(false);
      expect(parser.isSuccessResponse(message)).toBe(false);
      expect(parser.isErrorResponse(message)).toBe(false);
      expect(parser.isNotification(message)).toBe(true);
    });
  });
});
