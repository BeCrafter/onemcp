/**
 * Integration test: SSE backend reconnect exhaustion → pool recovery.
 *
 * Covers the Architect's SSE E2E gherkin (from the MERC-3 review):
 *
 *   Feature: Backend death does not permanently break tool discovery
 *     Scenario: SSE backend reconnect exhausts
 *       Given OneMCP server mode with a registered SSE backend, tools/list returns N tools
 *       When the backend SSE endpoint becomes unreachable past maxReconnectAttempts
 *       Then the pool marks the transport ERROR
 *       And the next tools/list either recovers once SSE is reachable again,
 *            or returns a clear degraded error (not a stale dead-connection response)
 *
 * HttpTransport and ConnectionPool are real; only the network primitives
 * (eventsource, node-fetch) are mocked so the test can drive SSE connectivity
 * deterministically. This verifies the real chain:
 *   SSE errors → handleSSEError reconnects → max attempts → handleError
 *     → transport state ERROR + 'error' emitted
 *     → pool's transport.on('error') listener → invalidateConnection
 *     → dead connection removed → next acquire creates a fresh transport
 *     → once SSE is reachable again, tools/list succeeds via the fresh connection.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import EventSource from 'eventsource';
import fetch from 'node-fetch';
import { ConnectionPool } from '../../src/pool/connection-pool.js';
import { TransportState } from '../../src/transport/base.js';
import type { ServiceDefinition, ConnectionPoolConfig } from '../../src/types/service.js';
import type { JsonRpcMessage } from '../../src/types/jsonrpc.js';

vi.mock('eventsource');
vi.mock('node-fetch');

const POOL_CONFIG: ConnectionPoolConfig = {
  maxConnections: 3,
  idleTimeout: 60000,
  connectionTimeout: 10000,
};

/**
 * A controllable EventSource. HttpTransport uses addEventListener('endpoint'),
 * onmessage, onopen, onerror and close(). This mock is a real EventEmitter so
 * the transport's listeners really register, and connectivity is driven by
 * `sseReachable`: when reachable, a new EventSource completes the MCP SSE
 * handshake (endpoint + an initialize response); when unreachable, it stays
 * silent so the transport's reconnect logic must exhaust.
 */
class MockEventSource extends EventEmitter {
  public onmessage: ((e: { data: string }) => void) | null = null;
  public onopen: ((e: Event) => void) | null = null;
  public onerror: ((e: Event) => void) | null = null;
  public close = vi.fn();
  // HttpTransport calls addEventListener('endpoint', handler); alias to on().
  public addEventListener = this.on.bind(this);

  constructor(private readonly reachable: boolean) {
    super();
    // Drive the SSE handshake / unreachability on a microtask so HttpTransport
    // has assigned onmessage/onopen/onerror first.
    queueMicrotask(() => {
      if (this.reachable) {
        // Standard MCP SSE handshake: server sends the 'endpoint' event.
        this.emit('endpoint', { data: '/messages' });
        // Then push an initialize response so the pool's MCP init completes.
        queueMicrotask(() => {
          if (this.onmessage) {
            this.onmessage({
              data: JSON.stringify({ jsonrpc: '2.0', id: 'init', result: {} }),
            });
          }
        });
      }
      // When unreachable, do nothing — onerror is driven by the test via
      // simulateError() to step the transport's reconnect logic.
    });
  }

  public simulateMessage(data: string): void {
    if (this.onmessage) this.onmessage({ data });
  }

  public simulateError(): void {
    if (this.onerror) this.onerror({} as Event);
  }
}

describe('Backend death does not permanently break tool discovery', () => {
  describe('SSE backend reconnect exhausts', () => {
    let pool: ConnectionPool;
    let createdEventSources: MockEventSource[];
    let sseReachable: boolean;

    beforeEach(() => {
      // Fake only timer APIs so the reconnect setTimeout chain is deterministic
      // while microtasks (queueMicrotask / promises) still run normally.
      vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] });
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});

      createdEventSources = [];
      sseReachable = true;

      vi.mocked(EventSource).mockImplementation(() => {
        const es = new MockEventSource(sseReachable);
        createdEventSources.push(es);
        return es as unknown as EventSource;
      });

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => null },
        text: () => Promise.resolve(''),
      } as never);

      const service: ServiceDefinition = {
        name: 'mock-sse',
        enabled: true,
        tags: [],
        transport: 'sse',
        url: 'http://localhost:65535/sse',
        connectionPool: POOL_CONFIG,
      };
      pool = new ConnectionPool(service, POOL_CONFIG);
      pool.on('error', () => {});
    });

    afterEach(async () => {
      if (pool) {
        await pool.closeAll();
      }
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    const currentEventSource = (): MockEventSource => {
      const es = createdEventSources[createdEventSources.length - 1];
      if (!es) throw new Error('no EventSource created yet');
      return es;
    };

    /** Send a JSON-RPC request over the connection and read the matching reply. */
    async function rpc(
      transport: {
        send(m: JsonRpcMessage): Promise<void>;
        receive(): AsyncIterator<JsonRpcMessage>;
      },
      id: string,
      method: string,
      params: unknown
    ): Promise<{
      result?: { tools?: Array<{ name: string }> };
      error?: { code: number; message: string };
    }> {
      await transport.send({ jsonrpc: '2.0', id, method, params: params as never });
      const iterator = transport.receive();
      for (;;) {
        const next = await iterator.next();
        if (next.done || !next.value) {
          throw new Error('transport stream ended before a matching response');
        }
        const msg = next.value as { id?: unknown; result?: unknown; error?: unknown };
        if (msg.id !== undefined && msg.id !== null && String(msg.id) === String(id)) {
          return msg as {
            result?: { tools?: Array<{ name: string }> };
            error?: { code: number; message: string };
          };
        }
      }
    }

    const TOOLS_LIST_RESPONSE = JSON.stringify({
      jsonrpc: '2.0',
      id: 'list-1',
      result: {
        tools: [
          { name: 'echo', description: 'echo', inputSchema: { type: 'object', properties: {} } },
          { name: 'add', description: 'add', inputSchema: { type: 'object', properties: {} } },
        ],
      },
    });

    it('marks the transport ERROR and recovers tools/list via a fresh connection once SSE is reachable', async () => {
      // Given: a registered SSE backend, tools/list returns N tools.
      const conn1 = await pool.acquire();
      // The reachable EventSource auto-completed the init handshake; push the
      // tools/list reply and read it.
      currentEventSource().simulateMessage(TOOLS_LIST_RESPONSE);
      const list1 = await rpc(conn1.transport, 'list-1', 'tools/list', {});
      expect(list1.error).toBeUndefined();
      expect(list1.result?.tools?.length).toBe(2);
      pool.release(conn1); // idle in the pool

      // Capture the moment the transport reaches ERROR (handleError sets state
      // ERROR and emits 'error' before the pool's close() moves it to CLOSED).
      const transportErrorSpy = vi.fn();
      conn1.transport.on('error', transportErrorSpy);

      const connectionFailedSpy = vi.fn();
      pool.on('connectionFailed', connectionFailedSpy);

      // When: the SSE endpoint becomes unreachable past maxReconnectAttempts.
      sseReachable = false; // any reconnect attempt stays unreachable
      const maxAttempts = 3; // HttpTransport default maxReconnectAttempts
      // Kick off the first error on the live connection; each reconnect creates
      // a new (unreachable) EventSource whose error advances the counter.
      currentEventSource().simulateError();
      for (let i = 0; i < maxAttempts; i++) {
        // Fire the scheduled reconnect (exponential backoff: 1s, 2s, 4s).
        await vi.advanceTimersByTimeAsync(2 ** i * 1000 + 1);
        // The reconnect created a new unreachable EventSource; step its error.
        currentEventSource().simulateError();
      }

      // Then: the transport reached ERROR and the pool invalidated the connection.
      expect(transportErrorSpy).toHaveBeenCalled();
      expect(
        (conn1.transport as unknown as { getState: () => TransportState }).getState()
      ).not.toBe(TransportState.CONNECTED);
      expect((conn1.transport as { isConnected: () => boolean }).isConnected()).toBe(false);

      await vi.waitFor(() => {
        expect(connectionFailedSpy).toHaveBeenCalledWith(conn1.id, expect.any(Error));
      });
      expect(pool.getStats().total).toBe(0); // dead connection no longer occupies a slot

      // And: once SSE is reachable again, the next tools/list recovers via a
      // fresh connection (not a stale dead-connection response).
      sseReachable = true;
      const conn2 = await pool.acquire();
      expect(conn2.id).not.toBe(conn1.id); // fresh connection

      currentEventSource().simulateMessage(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 'list-2',
          result: {
            tools: [
              {
                name: 'echo',
                description: 'echo',
                inputSchema: { type: 'object', properties: {} },
              },
              { name: 'add', description: 'add', inputSchema: { type: 'object', properties: {} } },
            ],
          },
        })
      );
      const list2 = await rpc(conn2.transport, 'list-2', 'tools/list', {});
      expect(list2.error).toBeUndefined();
      expect(list2.result?.tools?.map((t) => t.name)).toEqual(['echo', 'add']);

      pool.release(conn2);
    }, 30000);

    it('does not hand out the stale dead SSE connection (returns a clear error while unreachable)', async () => {
      // While SSE stays unreachable, the next acquire cannot reuse the dead
      // connection — it must attempt a fresh transport and fail clearly (not
      // return a stale dead-connection response).
      const conn1 = await pool.acquire();
      currentEventSource().simulateMessage(TOOLS_LIST_RESPONSE);
      const list1 = await rpc(conn1.transport, 'list-1', 'tools/list', {});
      expect(list1.result?.tools?.length).toBe(2);
      pool.release(conn1);

      sseReachable = false;
      currentEventSource().simulateError();
      const maxAttempts = 3;
      for (let i = 0; i < maxAttempts; i++) {
        await vi.advanceTimersByTimeAsync(2 ** i * 1000 + 1);
        currentEventSource().simulateError();
      }
      await vi.waitFor(() => expect(pool.getStats().total).toBe(0));

      // SSE is still unreachable: a fresh acquire attempts a new transport that
      // cannot connect, so the pool rejects with a clear error (connection
      // creation timeout) rather than handing back the dead connection.
      sseReachable = false;
      const acquirePromise = pool.acquire();
      acquirePromise.catch(() => {}); // avoid unhandled rejection during the wait
      // The unreachable EventSource never completes the SSE handshake, so
      // createTransport's bounded wait rejects after connectionTimeout.
      await vi.advanceTimersByTimeAsync(POOL_CONFIG.connectionTimeout + 1000);
      await expect(acquirePromise).rejects.toThrow();

      // The dead connection is not resurrected: the pool is still empty.
      expect(pool.getStats().total).toBe(0);
    }, 30000);
  });
});
