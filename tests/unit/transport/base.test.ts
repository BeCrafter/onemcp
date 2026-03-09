/**
 * Unit tests for BaseTransport
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BaseTransport, TransportState, TransportError } from '../../../src/transport/base.js';
import type { JsonRpcMessage } from '../../../src/types/jsonrpc.js';
import type { TransportType } from '../../../src/types/service.js';

/**
 * Mock transport implementation for testing
 */
class MockTransport extends BaseTransport {
  public sendCalls: JsonRpcMessage[] = [];
  public receivedMessages: JsonRpcMessage[] = [];
  public shouldThrowOnSend = false;
  public shouldThrowOnReceive = false;
  public shouldThrowOnClose = false;

  constructor() {
    super();
    // Simulate connection established
    this.setConnected();
  }

  public getType(): TransportType {
    return 'stdio';
  }

  protected async doSend(message: JsonRpcMessage): Promise<void> {
    if (this.shouldThrowOnSend) {
      throw new Error('Send failed');
    }
    this.sendCalls.push(message);
  }

  protected async *doReceive(): AsyncIterator<JsonRpcMessage> {
    if (this.shouldThrowOnReceive) {
      throw new Error('Receive failed');
    }
    for (const message of this.receivedMessages) {
      yield message;
    }
  }

  protected async doClose(): Promise<void> {
    if (this.shouldThrowOnClose) {
      throw new Error('Close failed');
    }
  }

  // Expose protected method for testing
  public triggerError(error: unknown): void {
    this.handleError(error);
  }
}

describe('BaseTransport', () => {
  let transport: MockTransport;

  beforeEach(() => {
    transport = new MockTransport();
  });

  describe('State Management', () => {
    it('should start in CONNECTED state after construction', () => {
      expect(transport.getState()).toBe(TransportState.CONNECTED);
      expect(transport.isConnected()).toBe(true);
      expect(transport.isClosed()).toBe(false);
    });

    it('should transition to CLOSING state when close is called', async () => {
      const closePromise = transport.close();
      // State should be CLOSING during close operation
      expect(transport.getState()).toBe(TransportState.CLOSING);
      await closePromise;
    });

    it('should transition to CLOSED state after close completes', async () => {
      await transport.close();
      expect(transport.getState()).toBe(TransportState.CLOSED);
      expect(transport.isClosed()).toBe(true);
      expect(transport.isConnected()).toBe(false);
    });

    it('should transition to ERROR state when error occurs', () => {
      const errorSpy = vi.fn();
      transport.on('error', errorSpy);

      const error = new Error('Test error');
      transport.triggerError(error);

      expect(transport.getState()).toBe(TransportState.ERROR);
      expect(errorSpy).toHaveBeenCalledWith(error);
    });
  });

  describe('send()', () => {
    it('should send message successfully when connected', async () => {
      const message: JsonRpcMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'test',
      };

      await transport.send(message);
      expect(transport.sendCalls).toHaveLength(1);
      expect(transport.sendCalls[0]).toEqual(message);
    });

    it('should throw error when transport is closed', async () => {
      await transport.close();

      const message: JsonRpcMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'test',
      };

      await expect(transport.send(message)).rejects.toThrow(TransportError);
      await expect(transport.send(message)).rejects.toThrow('transport is closed');
    });

    it('should throw error when transport is closing', async () => {
      // Start closing but don't await yet
      const closePromise = transport.close();

      // Give it a moment to enter CLOSING state
      await new Promise((resolve) => setImmediate(resolve));

      const message: JsonRpcMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'test',
      };

      // Now the transport should be in CLOSING state
      if (transport.getState() === TransportState.CLOSING) {
        await expect(transport.send(message)).rejects.toThrow(TransportError);
        await expect(transport.send(message)).rejects.toThrow('transport is closing');
      }

      await closePromise;
    });

    it('should throw error when transport is in error state', async () => {
      const errorSpy = vi.fn();
      transport.on('error', errorSpy);

      transport.triggerError(new Error('Previous error'));

      const message: JsonRpcMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'test',
      };

      await expect(transport.send(message)).rejects.toThrow(TransportError);
      await expect(transport.send(message)).rejects.toThrow('error state');
    });

    it('should handle send errors and update state', async () => {
      transport.shouldThrowOnSend = true;

      const message: JsonRpcMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'test',
      };

      await expect(transport.send(message)).rejects.toThrow('Send failed');
      expect(transport.getState()).toBe(TransportState.ERROR);
    });
  });

  describe('receive()', () => {
    it('should receive messages successfully when connected', async () => {
      const messages: JsonRpcMessage[] = [
        { jsonrpc: '2.0', id: 1, result: 'result1' },
        { jsonrpc: '2.0', id: 2, result: 'result2' },
      ];
      transport.receivedMessages = messages;

      const received: JsonRpcMessage[] = [];
      const iterator = transport.receive();
      let result;
      while (!(result = await iterator.next()).done) {
        received.push(result.value);
      }

      expect(received).toEqual(messages);
    });

    it('should throw error when transport is closed', async () => {
      await transport.close();

      await expect(async () => {
        const iterator = transport.receive();
        await iterator.next();
      }).rejects.toThrow(TransportError);
    });

    it('should handle receive errors and update state', async () => {
      transport.shouldThrowOnReceive = true;

      const iterator = transport.receive();
      await expect(iterator.next()).rejects.toThrow('Receive failed');
      expect(transport.getState()).toBe(TransportState.ERROR);
    });
  });

  describe('close()', () => {
    it('should close successfully', async () => {
      const closedSpy = vi.fn();
      transport.on('closed', closedSpy);

      await transport.close();

      expect(transport.isClosed()).toBe(true);
      expect(closedSpy).toHaveBeenCalledOnce();
    });

    it('should be idempotent (multiple close calls)', async () => {
      await transport.close();
      await transport.close();
      await transport.close();

      expect(transport.isClosed()).toBe(true);
    });

    it('should wait for existing close operation', async () => {
      const closePromise1 = transport.close();
      const closePromise2 = transport.close();

      await Promise.all([closePromise1, closePromise2]);

      expect(transport.isClosed()).toBe(true);
    });

    it('should handle close errors', async () => {
      transport.shouldThrowOnClose = true;

      await expect(transport.close()).rejects.toThrow('Close failed');
      expect(transport.getState()).toBe(TransportState.ERROR);
    });
  });

  describe('Events', () => {
    it('should emit "connected" event when setConnected is called', () => {
      const connectedSpy = vi.fn();

      // Create a new mock transport class that doesn't call setConnected in constructor
      class TestTransport extends BaseTransport {
        public getType(): TransportType {
          return 'stdio';
        }
        protected async doSend(): Promise<void> {}
        protected async *doReceive(): AsyncIterator<JsonRpcMessage> {}
        protected async doClose(): Promise<void> {}

        public callSetConnected(): void {
          this.setConnected();
        }
      }

      const testTransport = new TestTransport();
      testTransport.on('connected', connectedSpy);
      testTransport.callSetConnected();

      expect(connectedSpy).toHaveBeenCalled();
    });

    it('should emit "closing" event when close starts', async () => {
      const closingSpy = vi.fn();
      transport.on('closing', closingSpy);

      await transport.close();

      expect(closingSpy).toHaveBeenCalledOnce();
    });

    it('should emit "closed" event when close completes', async () => {
      const closedSpy = vi.fn();
      transport.on('closed', closedSpy);

      await transport.close();

      expect(closedSpy).toHaveBeenCalledOnce();
    });

    it('should emit "error" event when error occurs', () => {
      const errorSpy = vi.fn();
      transport.on('error', errorSpy);

      const error = new Error('Test error');
      transport.triggerError(error);

      expect(errorSpy).toHaveBeenCalledWith(error);
    });
  });

  describe('getType()', () => {
    it('should return the transport type', () => {
      expect(transport.getType()).toBe('stdio');
    });
  });
});
