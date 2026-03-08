/**
 * Unit tests for StdioTransport
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StdioTransport } from '../../../src/transport/stdio.js';
import { TransportState, TransportError } from '../../../src/transport/base.js';
import type { JsonRpcMessage } from '../../../src/types/jsonrpc.js';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

/**
 * Create a mock child process
 */
function createMockProcess() {
  const stdin = new EventEmitter() as any;
  stdin.write = vi.fn((_data: string, callback?: (error?: Error) => void) => {
    if (callback) {
      setImmediate(() => callback());
    }
    return true;
  });
  stdin.end = vi.fn();
  stdin.destroyed = false;

  const stdout = new EventEmitter() as any;
  stdout.setEncoding = vi.fn();

  const stderr = new EventEmitter() as any;
  stderr.setEncoding = vi.fn();

  const process = new EventEmitter() as any;
  process.stdin = stdin;
  process.stdout = stdout;
  process.stderr = stderr;
  process.kill = vi.fn();
  process.killed = false;

  return process;
}

describe('StdioTransport', () => {
  let mockProcess: ReturnType<typeof createMockProcess>;
  let transport: StdioTransport;

  beforeEach(() => {
    mockProcess = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mockProcess);
  });

  afterEach(async () => {
    if (transport) {
      try {
        await transport.close();
      } catch {
        // Ignore close errors in cleanup
      }
    }
    vi.clearAllMocks();
  });

  describe('Construction and Initialization', () => {
    it('should spawn child process with correct command and args', () => {
      transport = new StdioTransport({
        command: 'node',
        args: ['server.js', '--port', '3000'],
      });

      expect(spawn).toHaveBeenCalledWith(
        'node',
        ['server.js', '--port', '3000'],
        expect.objectContaining({
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      );
    });

    it('should pass environment variables to child process', () => {
      transport = new StdioTransport({
        command: 'node',
        args: ['server.js'],
        env: { NODE_ENV: 'test', API_KEY: 'secret' },
      });

      expect(spawn).toHaveBeenCalledWith(
        'node',
        ['server.js'],
        expect.objectContaining({
          env: expect.objectContaining({
            NODE_ENV: 'test',
            API_KEY: 'secret',
          }),
        })
      );
    });

    it('should set working directory if provided', () => {
      transport = new StdioTransport({
        command: 'node',
        args: ['server.js'],
        cwd: '/tmp/test',
      });

      expect(spawn).toHaveBeenCalledWith(
        'node',
        ['server.js'],
        expect.objectContaining({
          cwd: '/tmp/test',
        })
      );
    });

    it('should transition to CONNECTED state after spawning', () => {
      transport = new StdioTransport({
        command: 'node',
        args: ['server.js'],
      });

      expect(transport.getState()).toBe(TransportState.CONNECTED);
      expect(transport.isConnected()).toBe(true);
    });

    it('should return "stdio" as transport type', () => {
      transport = new StdioTransport({
        command: 'node',
        args: ['server.js'],
      });

      expect(transport.getType()).toBe('stdio');
    });
  });

  describe('send()', () => {
    beforeEach(() => {
      transport = new StdioTransport({
        command: 'node',
        args: ['server.js'],
      });
    });

    it('should send JSON-RPC message to stdin', async () => {
      const message: JsonRpcMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'test',
        params: { foo: 'bar' },
      };

      await transport.send(message);

      expect(mockProcess.stdin.write).toHaveBeenCalledWith(
        JSON.stringify(message) + '\n',
        expect.any(Function)
      );
    });

    it('should handle multiple messages', async () => {
      const messages: JsonRpcMessage[] = [
        { jsonrpc: '2.0', id: 1, method: 'test1' },
        { jsonrpc: '2.0', id: 2, method: 'test2' },
        { jsonrpc: '2.0', id: 3, method: 'test3' },
      ];

      for (const message of messages) {
        await transport.send(message);
      }

      expect(mockProcess.stdin.write).toHaveBeenCalledTimes(3);
    });

    it('should throw error if stdin is not available', async () => {
      mockProcess.stdin = null;

      const message: JsonRpcMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'test',
      };

      // First call will fail and put transport in error state
      await expect(transport.send(message)).rejects.toThrow(TransportError);
      // Transport should now be in error state
      expect(transport.getState()).toBe(TransportState.ERROR);
    });

    it('should throw error if stdin is destroyed', async () => {
      mockProcess.stdin.destroyed = true;

      const message: JsonRpcMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'test',
      };

      // First call will fail and put transport in error state
      await expect(transport.send(message)).rejects.toThrow(TransportError);
      // Transport should now be in error state
      expect(transport.getState()).toBe(TransportState.ERROR);
    });

    it('should handle write errors', async () => {
      mockProcess.stdin.write = vi.fn((_data: string, callback?: (error?: Error) => void) => {
        if (callback) {
          setImmediate(() => callback(new Error('Write failed')));
        }
        return false;
      });

      const message: JsonRpcMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'test',
      };

      // First call will fail and put transport in error state
      await expect(transport.send(message)).rejects.toThrow(TransportError);
      // Transport should now be in error state
      expect(transport.getState()).toBe(TransportState.ERROR);
    });
  });

  describe('receive()', () => {
    beforeEach(() => {
      transport = new StdioTransport({
        command: 'node',
        args: ['server.js'],
      });
    });

    it('should receive JSON-RPC messages from stdout', async () => {
      const messages: JsonRpcMessage[] = [
        { jsonrpc: '2.0', id: 1, result: 'result1' },
        { jsonrpc: '2.0', id: 2, result: 'result2' },
      ];

      // Start receiving
      const receivePromise = (async () => {
        const received: JsonRpcMessage[] = [];
        const iterator = transport.receive();

        // Receive first message
        const result1 = await iterator.next();
        if (!result1.done) received.push(result1.value);

        // Receive second message
        const result2 = await iterator.next();
        if (!result2.done) received.push(result2.value);

        return received;
      })();

      // Simulate stdout data
      await new Promise((resolve) => setImmediate(resolve));
      mockProcess.stdout.emit('data', JSON.stringify(messages[0]) + '\n');
      await new Promise((resolve) => setImmediate(resolve));
      mockProcess.stdout.emit('data', JSON.stringify(messages[1]) + '\n');

      const received = await receivePromise;
      expect(received).toEqual(messages);
    });

    it('should handle multiple messages in single chunk', async () => {
      const messages: JsonRpcMessage[] = [
        { jsonrpc: '2.0', id: 1, result: 'result1' },
        { jsonrpc: '2.0', id: 2, result: 'result2' },
        { jsonrpc: '2.0', id: 3, result: 'result3' },
      ];

      // Start receiving
      const receivePromise = (async () => {
        const received: JsonRpcMessage[] = [];
        const iterator = transport.receive();

        for (let i = 0; i < 3; i++) {
          const result = await iterator.next();
          if (!result.done) received.push(result.value);
        }

        return received;
      })();

      // Simulate all messages in one chunk
      await new Promise((resolve) => setImmediate(resolve));
      const chunk = messages.map((m) => JSON.stringify(m)).join('\n') + '\n';
      mockProcess.stdout.emit('data', chunk);

      const received = await receivePromise;
      expect(received).toEqual(messages);
    });

    it('should handle partial messages across chunks', async () => {
      const message: JsonRpcMessage = {
        jsonrpc: '2.0',
        id: 1,
        result: 'result',
      };
      const serialized = JSON.stringify(message) + '\n';
      const mid = Math.floor(serialized.length / 2);
      const chunk1 = serialized.slice(0, mid);
      const chunk2 = serialized.slice(mid);

      // Start receiving
      const receivePromise = (async () => {
        const iterator = transport.receive();
        const result = await iterator.next();
        return result.done ? null : result.value;
      })();

      // Simulate partial chunks
      await new Promise((resolve) => setImmediate(resolve));
      mockProcess.stdout.emit('data', chunk1);
      await new Promise((resolve) => setImmediate(resolve));
      mockProcess.stdout.emit('data', chunk2);

      const received = await receivePromise;
      expect(received).toEqual(message);
    });

    it('should skip invalid JSON lines', async () => {
      const validMessage: JsonRpcMessage = {
        jsonrpc: '2.0',
        id: 1,
        result: 'result',
      };

      // Start receiving
      const receivePromise = (async () => {
        const iterator = transport.receive();
        const result = await iterator.next();
        return result.done ? null : result.value;
      })();

      // Simulate invalid JSON followed by valid message
      await new Promise((resolve) => setImmediate(resolve));
      mockProcess.stdout.emit('data', 'invalid json\n');
      await new Promise((resolve) => setImmediate(resolve));
      mockProcess.stdout.emit('data', JSON.stringify(validMessage) + '\n');

      const received = await receivePromise;
      expect(received).toEqual(validMessage);
    });

    it('should complete when stdout ends', async () => {
      // Start receiving
      const receivePromise = (async () => {
        const received: JsonRpcMessage[] = [];
        const iterator = transport.receive();

        // Manually iterate instead of using for-await
        while (true) {
          const result = await iterator.next();
          if (result.done) break;
          received.push(result.value);
        }

        return received;
      })();

      // Emit one message then end
      await new Promise((resolve) => setImmediate(resolve));
      const message: JsonRpcMessage = { jsonrpc: '2.0', id: 1, result: 'result' };
      mockProcess.stdout.emit('data', JSON.stringify(message) + '\n');
      await new Promise((resolve) => setImmediate(resolve));
      mockProcess.stdout.emit('end');

      const received = await receivePromise;
      expect(received).toHaveLength(1);
      expect(received[0]).toEqual(message);
    });
  });

  describe('Process Lifecycle', () => {
    beforeEach(() => {
      transport = new StdioTransport({
        command: 'node',
        args: ['server.js'],
      });
    });

    it('should handle process exit with code 0', async () => {
      const exitPromise = new Promise<void>((resolve) => {
        transport.on('error', () => {
          // Should not emit error for clean exit
          throw new Error('Should not emit error for exit code 0');
        });
        setTimeout(resolve, 100);
      });

      mockProcess.emit('exit', 0, null);
      await exitPromise;
    });

    it('should handle process exit with non-zero code', async () => {
      const errorPromise = new Promise<Error>((resolve) => {
        transport.on('error', (error) => {
          resolve(error);
        });
      });

      mockProcess.emit('exit', 1, null);

      const error = await errorPromise;
      expect(error).toBeInstanceOf(TransportError);
      expect(error.message).toContain('code 1');
    });

    it('should handle process exit with signal', async () => {
      // SIGTERM is a normal termination signal, should not emit error
      const errorPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          resolve(); // No error is expected
        }, 100);

        transport.on('error', (_error) => {
          clearTimeout(timeout);
          reject(new Error('Should not emit error for SIGTERM'));
        });
      });

      mockProcess.emit('exit', null, 'SIGTERM');

      await errorPromise;
    });

    it('should handle process errors', async () => {
      const errorPromise = new Promise<Error>((resolve) => {
        transport.on('error', (error) => {
          resolve(error);
        });
      });

      const processError = new Error('Process error');
      mockProcess.emit('error', processError);

      const error = await errorPromise;
      expect(error).toBeInstanceOf(TransportError);
      expect(error.message).toContain('Process error');
    });

    it('should log stderr output', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mockProcess.stderr.emit('data', 'Error message from process\n');

      await new Promise((resolve) => setImmediate(resolve));

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error message from process')
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('close()', () => {
    beforeEach(() => {
      transport = new StdioTransport({
        command: 'node',
        args: ['server.js'],
      });
    });

    it('should close stdin and send SIGTERM', async () => {
      const closePromise = transport.close();

      // Simulate process exit
      await new Promise((resolve) => setImmediate(resolve));
      mockProcess.emit('exit', 0, null);

      await closePromise;

      expect(mockProcess.stdin.end).toHaveBeenCalled();
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
      expect(transport.isClosed()).toBe(true);
    });

    it('should force kill if process does not exit within timeout', async () => {
      const closePromise = transport.close();

      // Don't emit exit event, let it timeout
      await expect(closePromise).rejects.toThrow(TransportError);
      await expect(closePromise).rejects.toThrow('timeout');

      // Should have tried SIGKILL
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL');
    });

    it('should be idempotent', async () => {
      const closePromise1 = transport.close();

      // Simulate process exit
      await new Promise((resolve) => setImmediate(resolve));
      mockProcess.emit('exit', 0, null);

      await closePromise1;

      // Second close should not throw
      await transport.close();
      await transport.close();

      expect(transport.isClosed()).toBe(true);
    });

    it('should handle case where stdin is already destroyed', async () => {
      mockProcess.stdin.destroyed = true;

      const closePromise = transport.close();

      // Simulate process exit
      await new Promise((resolve) => setImmediate(resolve));
      mockProcess.emit('exit', 0, null);

      await closePromise;

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
      expect(transport.isClosed()).toBe(true);
    });
  });
});
