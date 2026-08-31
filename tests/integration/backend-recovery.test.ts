/**
 * Integration tests: backend death does not permanently break tool discovery.
 *
 * These tests drive the REAL ConnectionPool with a REAL StdioTransport that
 * spawns a real backend process (the mock-stdio-mcp fixture). They cover the
 * end-to-end recovery chain the unit tests mock away:
 *
 *   backend process dies → transport reaches ERROR → isConnected() flips false
 *   → pool invalidates the connection → next acquire creates a fresh connection
 *   → tools/list succeeds again
 *
 * This is the actual user-facing scenario from MERC-3: "long-running server
 * mode loses tools after the backend connection drops".
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import { ConnectionPool } from '../../src/pool/connection-pool.js';
import type { Connection } from '../../src/pool/connection.js';
import type { JsonRpcMessage } from '../../src/types/jsonrpc.js';
import type { ServiceDefinition, ConnectionPoolConfig } from '../../src/types/service.js';

const FIXTURE_PATH = path.resolve(__dirname, 'fixtures/mock-stdio-mcp.cjs');

const EXPECTED_TOOL_COUNT = 2;

/**
 * Send a tools/list request over a connection and return the tools array.
 * Throws if the transport returns an error or the stream ends first — which is
 * exactly the TRANSPORT_ERROR-equivalent failure the fix is meant to prevent.
 */
async function listTools(connection: Connection): Promise<unknown[]> {
  const id = `tools-list-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await connection.transport.send({
    jsonrpc: '2.0',
    id,
    method: 'tools/list',
    params: {},
  } as JsonRpcMessage);

  const iterator = connection.transport.receive();
  try {
    for (;;) {
      const next = await iterator.next();
      if (next.done || !next.value) {
        throw new Error('transport stream ended before tools/list response');
      }
      const message = next.value as unknown as Record<string, unknown>;
      if ('id' in message && String(message['id']) === String(id)) {
        const error = message['error'] as { code?: number; message?: string } | undefined;
        if (error) {
          throw new Error(`tools/list returned error code ${error.code}: ${error.message}`);
        }
        const result = message['result'] as { tools?: unknown[] } | undefined;
        return result?.tools ?? [];
      }
    }
  } finally {
    await iterator.return?.(undefined as unknown as JsonRpcMessage);
  }
}

function waitForExit(pool: ConnectionPool, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pool.off('connectionFailed', onFailed);
      reject(new Error('Timed out waiting for backend process exit / pool invalidation'));
    }, timeoutMs);
    const onFailed = () => {
      clearTimeout(timer);
      pool.off('connectionFailed', onFailed);
      resolve();
    };
    pool.on('connectionFailed', onFailed);
  });
}

describe('Backend death recovery (integration)', () => {
  let pool: ConnectionPool;
  let service: ServiceDefinition;
  let poolConfig: ConnectionPoolConfig;

  beforeEach(() => {
    // Swallow pool-level error re-emits (transport errors surface here too).
    vi.spyOn(console, 'error').mockImplementation(() => {});

    service = {
      name: 'mock-backend',
      enabled: true,
      tags: [],
      transport: 'stdio',
      command: process.execPath,
      args: [FIXTURE_PATH],
      env: { ONEMCP_FIXTURE_EXIT_AFTER_LIST: '1' },
      connectionPool: {
        maxConnections: 2,
        idleTimeout: 60000,
        connectionTimeout: 10000,
      },
    };

    poolConfig = {
      maxConnections: 2,
      idleTimeout: 60000,
      connectionTimeout: 10000,
    };

    pool = new ConnectionPool(service, poolConfig);
    pool.on('error', () => {});
  });

  afterEach(async () => {
    if (pool) {
      await pool.closeAll().catch(() => {});
    }
    vi.restoreAllMocks();
  });

  it('recovers tools/list after the stdio backend exits with code 0', async () => {
    // First acquire: pool spawns backend A, runs the MCP handshake, returns conn1.
    const conn1 = await pool.acquire();
    const tools1 = await listTools(conn1);
    expect(tools1).toHaveLength(EXPECTED_TOOL_COUNT);

    // The fixture exits with code 0 right after responding — wait for the pool
    // to invalidate the now-dead connection.
    await waitForExit(pool);

    // The dead connection must no longer occupy a pool slot.
    expect(pool.getStats().total).toBe(0);

    // Second acquire must return a FRESH connection (a new backend process),
    // not the dead one — and tools/list must succeed again, not TRANSPORT_ERROR.
    const conn2 = await pool.acquire();
    expect(conn2.id).not.toBe(conn1.id);
    expect(pool.isConnectionHealthy(conn2)).toBe(true);

    const tools2 = await listTools(conn2);
    expect(tools2).toHaveLength(EXPECTED_TOOL_COUNT);
  }, 30000);

  it('recovers tools/list after the stdio backend is killed by a signal', async () => {
    // Use a backend that stays alive so we control the death moment precisely.
    const liveService: ServiceDefinition = {
      ...service,
      env: {}, // no EXIT_AFTER_LIST -> stays alive
    };
    const livePool = new ConnectionPool(liveService, poolConfig);
    livePool.on('error', () => {});
    try {
      const conn1 = await livePool.acquire();
      const tools1 = await listTools(conn1);
      expect(tools1).toHaveLength(EXPECTED_TOOL_COUNT);
      livePool.release(conn1);

      // Kill the backend child process externally (simulates OOM / signal kill).
      const proc = (conn1.transport as unknown as { process: { kill: (s: string) => void } })
        .process;
      const exitPromise = waitForExit(livePool);
      proc.kill('SIGKILL');

      await exitPromise;
      expect(livePool.getStats().total).toBe(0);

      // Next acquire creates a fresh connection; tools/list succeeds again.
      const conn2 = await livePool.acquire();
      expect(conn2.id).not.toBe(conn1.id);
      const tools2 = await listTools(conn2);
      expect(tools2).toHaveLength(EXPECTED_TOOL_COUNT);
    } finally {
      await livePool.closeAll().catch(() => {});
    }
  }, 30000);

  it('does not reuse a dead idle connection when maxConnections would be exhausted', async () => {
    // With maxConnections=1, a dead idle connection must be evicted (not held)
    // so the next acquire can create a replacement rather than hanging.
    const singleConfig: ConnectionPoolConfig = { ...poolConfig, maxConnections: 1 };
    const singlePool = new ConnectionPool(service, singleConfig);
    singlePool.on('error', () => {});
    try {
      const conn1 = await singlePool.acquire();
      await listTools(conn1);
      singlePool.release(conn1);

      await waitForExit(singlePool);
      expect(singlePool.getStats().total).toBe(0);

      // Would hang / time out if the dead connection kept its slot.
      const conn2 = await singlePool.acquire();
      const tools2 = await listTools(conn2);
      expect(tools2).toHaveLength(EXPECTED_TOOL_COUNT);
      expect(conn2.id).not.toBe(conn1.id);
    } finally {
      await singlePool.closeAll().catch(() => {});
    }
  }, 30000);
});
