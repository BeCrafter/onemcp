/**
 * Unit tests: transport error → pool connection invalidation (the full chain)
 *
 * These tests address the gap the Architect's review flagged: the existing pool
 * suites mock isConnected() directly (returning false), so they only verify the
 * pool's reaction to an already-unhealthy connection — not the real chain
 *   transport enters ERROR → isConnected() flips → pool invalidates → fresh acquire.
 *
 * They also cover the fix's "instant invalidation" selling point —
 * `transport.on('error') → invalidateConnection` — which previously had no test
 * coverage at all.
 *
 * To exercise the real state machine, the pool is wired to a TestTransport that
 * extends the real BaseTransport (a real EventEmitter). TestTransport uses
 * BaseTransport's actual handleError(): it flips state to ERROR and emits 'error'
 * exactly like StdioTransport.handleProcessExit / HttpTransport.handleSSEError do,
 * so isConnected() reflects a real state transition, not a stubbed return value.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BaseTransport } from '../../../src/transport/base.js';
import type { JsonRpcMessage } from '../../../src/types/jsonrpc.js';
import type {
  TransportType,
  ServiceDefinition,
  ConnectionPoolConfig,
} from '../../../src/types/service.js';
import { ConnectionPool } from '../../../src/pool/connection-pool.js';
import { StdioTransport } from '../../../src/transport/stdio.js';

/**
 * Real EventEmitter-backed transport using BaseTransport's actual state machine.
 *
 * - on()/emit() come from EventEmitter, so the pool's `transport.on('error', ...)`
 *   listener is really registered (not a vi.fn() no-op).
 * - isConnected() comes from BaseTransport and flips to false when handleError()
 *   moves state to ERROR — the same path StdioTransport/HttpTransport use.
 * - simulateError() is the test hook for that real path.
 */
class TestTransport extends BaseTransport {
  // Present so the stdio branch of isConnectionHealthy can inspect it.
  public process = { killed: false, exitCode: null as number | null };
  public closeCalls = 0;

  constructor() {
    super();
    // Match StdioTransport: once spawned, the transport is connected.
    this.setConnected();
  }

  public getType(): TransportType {
    return 'stdio';
  }

  protected async doSend(_message: JsonRpcMessage): Promise<void> {
    // no-op — the pool only sends initialize + initialized notifications
  }

  protected async *doReceive(): AsyncIterator<JsonRpcMessage> {
    // Yield a valid initialize response so the pool's MCP handshake completes.
    yield { jsonrpc: '2.0', id: 1, result: {} } as JsonRpcMessage;
  }

  protected async doClose(): Promise<void> {
    this.closeCalls++;
  }

  /**
   * Trigger the real error path, identical to StdioTransport.handleProcessExit
   * and HttpTransport.handleSSEError: flip state to ERROR and emit 'error'.
   */
  public simulateError(error: Error = new Error('simulated transport error')): void {
    this.handleError(error);
  }
}

// The pool constructs transports via `new StdioTransport(config)`. Replace that
// constructor with one that returns a TestTransport, so the pool exercises the
// real BaseTransport state machine instead of a vi.fn()-stubbed isConnected().
vi.mock('../../../src/transport/stdio.js', () => ({
  StdioTransport: vi.fn(),
}));

describe('Transport error invalidates pool connection', () => {
  let pool: ConnectionPool;
  let service: ServiceDefinition;
  let poolConfig: ConnectionPoolConfig;

  beforeEach(() => {
    vi.mocked(StdioTransport).mockImplementation(function (this: unknown) {
      return new TestTransport() as unknown as StdioTransport;
    } as never);

    service = {
      name: 'test-service',
      enabled: true,
      tags: [],
      transport: 'stdio',
      command: 'test-command',
      connectionPool: {
        maxConnections: 3,
        idleTimeout: 60000,
        connectionTimeout: 5000,
      },
    };
    poolConfig = {
      maxConnections: 3,
      idleTimeout: 60000,
      connectionTimeout: 5000,
    };
    pool = new ConnectionPool(service, poolConfig);
    // The pool re-emits transport errors on its own 'error' channel. Without a
    // listener Node's EventEmitter would throw on an unhandled 'error' event.
    pool.on('error', () => {});
  });

  afterEach(async () => {
    if (pool) {
      await pool.closeAll();
    }
  });

  it('a pooled transport error emits connectionFailed with that connection id and frees the slot', async () => {
    const conn = await pool.acquire();
    pool.release(conn); // idle in the pool

    const failedSpy = vi.fn();
    pool.on('connectionFailed', failedSpy);

    // When the transport emits a real error (process exit / SSE exhausted / HTTP
    // failure), the pool must invalidate the connection immediately.
    (conn.transport as TestTransport).simulateError();

    await vi.waitFor(() => {
      expect(failedSpy).toHaveBeenCalledWith(conn.id, expect.any(Error));
    });

    // The dead connection no longer occupies a maxConnections slot.
    expect(pool.getStats().total).toBe(0);

    // The next acquire returns a fresh connection with a different id.
    const conn2 = await pool.acquire();
    expect(conn2.id).not.toBe(conn.id);
    expect(conn2.transport.isConnected()).toBe(true);
  });

  it('invalidates a busy connection that errors mid-use (not just idle ones)', async () => {
    const conn = await pool.acquire(); // busy, never released

    const failedSpy = vi.fn();
    pool.on('connectionFailed', failedSpy);

    (conn.transport as TestTransport).simulateError();

    await vi.waitFor(() => {
      expect(failedSpy).toHaveBeenCalledWith(conn.id, expect.any(Error));
    });
    expect(pool.getStats().total).toBe(0);

    const conn2 = await pool.acquire();
    expect(conn2.id).not.toBe(conn.id);
  });

  it('is idempotent: a second error on the same connection does not double-invalidate', async () => {
    const conn = await pool.acquire();
    pool.release(conn);

    const failedSpy = vi.fn();
    pool.on('connectionFailed', failedSpy);

    (conn.transport as TestTransport).simulateError();
    await vi.waitFor(() => expect(failedSpy).toHaveBeenCalledTimes(1));

    // A second error arrives (e.g. the 'exit' event after the stream 'error').
    (conn.transport as TestTransport).simulateError();
    await new Promise((resolve) => setImmediate(resolve));

    // connectionFailed must fire exactly once — invalidateConnection is idempotent.
    expect(failedSpy).toHaveBeenCalledTimes(1);
    expect(pool.getStats().total).toBe(0);
  });

  it('does not reuse a connection whose transport reached ERROR via the real state machine', async () => {
    const conn = await pool.acquire();
    pool.release(conn); // idle in the pool

    // The transport really enters ERROR — isConnected() flips for real, it is not
    // stubbed. This is the regression guard: if isConnectionHealthy stops calling
    // isConnected(), or handleError stops flipping state, this test fails.
    (conn.transport as TestTransport).simulateError();
    await new Promise((resolve) => setImmediate(resolve));

    expect((conn.transport as TestTransport).isConnected()).toBe(false);
    expect(pool.isConnectionHealthy(conn)).toBe(false);

    // The dead idle connection must not be handed out — a fresh one is created.
    const conn2 = await pool.acquire();
    expect(conn2.id).not.toBe(conn.id);
    expect(pool.isConnectionHealthy(conn2)).toBe(true);
    expect(pool.getStats().total).toBe(1);
  });

  it('freeing the slot prevents pool exhaustion when a connection dies at max capacity', async () => {
    // A pool with a single slot: if the dead connection kept occupying it, the
    // next acquire would queue/timeout instead of getting a fresh connection.
    const singleSlotPool = new ConnectionPool(service, { ...poolConfig, maxConnections: 1 });
    singleSlotPool.on('error', () => {});

    const conn = await singleSlotPool.acquire();
    expect(singleSlotPool.getStats().total).toBe(1);
    singleSlotPool.release(conn);

    (conn.transport as TestTransport).simulateError();
    await vi.waitFor(() => expect(singleSlotPool.getStats().total).toBe(0));

    // With the slot freed, acquire returns a fresh connection instead of queueing.
    const conn2 = await singleSlotPool.acquire();
    expect(conn2.id).not.toBe(conn.id);
    expect(singleSlotPool.getStats().total).toBe(1);

    await singleSlotPool.closeAll();
  });
});
