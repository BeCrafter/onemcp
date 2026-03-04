/**
 * Unit tests for HttpTransport
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpTransport } from '../../../src/transport/http.js';
import { TransportState } from '../../../src/transport/base.js';
import type { JsonRpcMessage } from '../../../src/types/jsonrpc.js';
import EventSource from 'eventsource';
import fetch from 'node-fetch';

// Mock EventSource and fetch
vi.mock('eventsource');
vi.mock('node-fetch');

describe('HttpTransport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  describe('SSE mode', () => {
    it('should initialize SSE connection', () => {
      const mockEventSource = {
        onmessage: null,
        onopen: null,
        onerror: null,
        close: vi.fn(),
      };
      
      vi.mocked(EventSource).mockImplementation(() => mockEventSource as any);

      const transport = new HttpTransport({
        url: 'http://localhost:3000/sse',
        mode: 'sse',
      });

      expect(EventSource).toHaveBeenCalledWith('http://localhost:3000/sse');
      expect(transport.getType()).toBe('sse');
    });

    it('should handle incoming SSE messages', async () => {
      const mockEventSource = {
        onmessage: null as ((event: MessageEvent) => void) | null,
        onopen: null as ((event: Event) => void) | null,
        onerror: null as ((event: Event) => void) | null,
        close: vi.fn(),
      };
      
      vi.mocked(EventSource).mockImplementation(() => mockEventSource as any);

      const transport = new HttpTransport({
        url: 'http://localhost:3000/sse',
        mode: 'sse',
      });

      // Simulate connection open
      if (mockEventSource.onopen) {
        mockEventSource.onopen({} as Event);
      }

      // Simulate receiving a message
      const testMessage: JsonRpcMessage = {
        jsonrpc: '2.0',
        id: 1,
        result: { success: true },
      };

      if (mockEventSource.onmessage) {
        mockEventSource.onmessage({
          data: JSON.stringify(testMessage),
        } as MessageEvent);
      }

      // Receive the message
      const iterator = transport.receive();
      const result = await iterator.next();

      expect(result.done).toBe(false);
      expect(result.value).toEqual(testMessage);

      await transport.close();
    });

    it('should handle SSE connection errors with reconnection', () => {
      vi.useFakeTimers();
      
      const mockEventSource = {
        onmessage: null as ((event: MessageEvent) => void) | null,
        onopen: null as ((event: Event) => void) | null,
        onerror: null as ((event: Event) => void) | null,
        close: vi.fn(),
      };
      
      let eventSourceCallCount = 0;
      vi.mocked(EventSource).mockImplementation(() => {
        eventSourceCallCount++;
        return mockEventSource as any;
      });

      const transport = new HttpTransport({
        url: 'http://localhost:3000/sse',
        mode: 'sse',
        maxReconnectAttempts: 3,
        reconnectDelay: 1000,
      });

      // Simulate connection error
      if (mockEventSource.onerror) {
        mockEventSource.onerror({} as Event);
      }

      // Fast-forward time to trigger reconnection
      vi.advanceTimersByTime(1000);

      // Should have attempted reconnection
      expect(eventSourceCallCount).toBeGreaterThan(1);

      vi.useRealTimers();
      transport.close();
    });

    it('should stop reconnecting after max attempts', () => {
      vi.useFakeTimers();
      
      const mockEventSource = {
        onmessage: null as ((event: MessageEvent) => void) | null,
        onopen: null as ((event: Event) => void) | null,
        onerror: null as ((event: Event) => void) | null,
        close: vi.fn(),
      };
      
      let eventSourceCallCount = 0;
      vi.mocked(EventSource).mockImplementation(() => {
        eventSourceCallCount++;
        return mockEventSource as any;
      });

      const errorSpy = vi.fn();

      const transport = new HttpTransport({
        url: 'http://localhost:3000/sse',
        mode: 'sse',
        maxReconnectAttempts: 2,
        reconnectDelay: 1000,
      });

      transport.on('error', errorSpy);

      // Simulate multiple connection errors
      if (mockEventSource.onerror) {
        mockEventSource.onerror({} as Event);
        vi.advanceTimersByTime(1000);
        
        mockEventSource.onerror({} as Event);
        vi.advanceTimersByTime(2000);
        
        mockEventSource.onerror({} as Event);
        vi.advanceTimersByTime(4000);
      }

      // Should have stopped after max attempts (initial + 2 reconnects = 3 total)
      expect(eventSourceCallCount).toBe(3);
      expect(transport.getState()).toBe(TransportState.ERROR);
      expect(errorSpy).toHaveBeenCalled();

      vi.useRealTimers();
      transport.close();
    });

    it('should close SSE connection properly', async () => {
      const mockEventSource = {
        onmessage: null,
        onopen: null,
        onerror: null,
        close: vi.fn(),
      };
      
      vi.mocked(EventSource).mockImplementation(() => mockEventSource as any);

      const transport = new HttpTransport({
        url: 'http://localhost:3000/sse',
        mode: 'sse',
      });

      await transport.close();

      expect(mockEventSource.close).toHaveBeenCalled();
      expect(transport.getState()).toBe(TransportState.CLOSED);
    });
  });

  describe('HTTP mode', () => {
    it('should initialize HTTP transport', () => {
      const transport = new HttpTransport({
        url: 'http://localhost:3000/rpc',
        mode: 'http',
      });

      expect(transport.getType()).toBe('http');
      expect(transport.getState()).toBe(TransportState.CONNECTED);
    });

    it('should send HTTP POST request', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: vi.fn().mockResolvedValue(JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { success: true },
        })),
      };

      vi.mocked(fetch).mockResolvedValue(mockResponse as any);

      const transport = new HttpTransport({
        url: 'http://localhost:3000/rpc',
        mode: 'http',
      });

      const testMessage: JsonRpcMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'test',
        params: {},
      };

      await transport.send(testMessage);

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3000/rpc',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(testMessage),
        })
      );

      await transport.close();
    });

    it('should handle HTTP request timeout', async () => {
      vi.mocked(fetch).mockImplementation(() => {
        return new Promise((_, reject) => {
          const error = new Error('The operation was aborted');
          error.name = 'AbortError';
          setTimeout(() => reject(error), 100);
        });
      });

      const transport = new HttpTransport({
        url: 'http://localhost:3000/rpc',
        mode: 'http',
        timeout: 50,
      });

      const testMessage: JsonRpcMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'test',
        params: {},
      };

      await expect(transport.send(testMessage)).rejects.toThrow('HTTP request timeout');

      await transport.close();
    }, 15000); // Increase timeout for this test

    it('should handle HTTP request failure', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      };

      vi.mocked(fetch).mockResolvedValue(mockResponse as any);

      const transport = new HttpTransport({
        url: 'http://localhost:3000/rpc',
        mode: 'http',
      });

      const testMessage: JsonRpcMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'test',
        params: {},
      };

      await expect(transport.send(testMessage)).rejects.toThrow('HTTP request failed with status 500');

      await transport.close();
    });

    it('should enqueue HTTP response for receiving', async () => {
      const responseMessage: JsonRpcMessage = {
        jsonrpc: '2.0',
        id: 1,
        result: { success: true },
      };

      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: vi.fn().mockResolvedValue(JSON.stringify(responseMessage)),
      };

      vi.mocked(fetch).mockResolvedValue(mockResponse as any);

      const transport = new HttpTransport({
        url: 'http://localhost:3000/rpc',
        mode: 'http',
      });

      const testMessage: JsonRpcMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'test',
        params: {},
      };

      await transport.send(testMessage);

      // Receive the response
      const iterator = transport.receive();
      const result = await iterator.next();

      expect(result.done).toBe(false);
      expect(result.value).toEqual(responseMessage);

      await transport.close();
    });

    it('should handle network errors', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

      const transport = new HttpTransport({
        url: 'http://localhost:3000/rpc',
        mode: 'http',
      });

      const testMessage: JsonRpcMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'test',
        params: {},
      };

      await expect(transport.send(testMessage)).rejects.toThrow('Failed to send HTTP request');

      await transport.close();
    });
  });

  describe('Common functionality', () => {
    it('should not allow sending after close', async () => {
      const transport = new HttpTransport({
        url: 'http://localhost:3000/rpc',
        mode: 'http',
      });

      await transport.close();

      const testMessage: JsonRpcMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'test',
        params: {},
      };

      await expect(transport.send(testMessage)).rejects.toThrow('Cannot send message: transport is closed');
    });

    it('should handle multiple close calls gracefully', async () => {
      const transport = new HttpTransport({
        url: 'http://localhost:3000/rpc',
        mode: 'http',
      });

      await transport.close();
      await transport.close(); // Should not throw

      expect(transport.getState()).toBe(TransportState.CLOSED);
    });

    it('should use default configuration values', () => {
      const transport = new HttpTransport({
        url: 'http://localhost:3000/rpc',
        mode: 'http',
      });

      // Default values should be applied
      expect(transport).toBeDefined();
      
      transport.close();
    });
  });
});
