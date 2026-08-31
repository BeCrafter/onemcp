/**
 * Integration test: backend death does not permanently break tool discovery.
 *
 * Covers the Architect's stdio E2E gherkin (from the MERC-3 review):
 *
 *   Feature: Backend death does not permanently break tool discovery
 *     Scenario: stdio backend process exits mid-run
 *       Given OneMCP server mode with a registered stdio backend, tools/list returns N tools
 *       When the backend child process exits (code 0)
 *       Then the next tools/list request succeeds (not TRANSPORT_ERROR)
 *       And returns the same N tools via a fresh connection
 *
 * This exercises the real StdioTransport + real ConnectionPool + a real child
 * process (tests/integration/fixtures/mock-stdio-server.js). No transport is
 * mocked, so it verifies the actual recovery chain the fix enables:
 *   process exit (code 0) → handleProcessExit → handleError → transport ERROR
 *     → pool's transport.on('error') listener → invalidateConnection
 *     → dead connection removed → next acquire creates a fresh connection
 *     → tools/list succeeds again.
 *
 * Without the fix (isConnectionHealthy ignoring transport state / no transport
 * 'error' listener), the dead connection would be reused and the second
 * tools/list would fail with TRANSPORT_ERROR / RESPONSE_STREAM_ENDED.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { ConnectionPool } from '../../src/pool/connection-pool.js';
import type { ServiceDefinition, ConnectionPoolConfig } from '../../src/types/service.js';
import type { JsonRpcMessage } from '../../src/types/jsonrpc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, 'fixtures', 'mock-stdio-server.js');

const POOL_CONFIG: ConnectionPoolConfig = {
  maxConnections: 3,
  idleTimeout: 60000,
  connectionTimeout: 10000,
};

function makeStdioService(): ServiceDefinition {
  return {
    name: 'mock-stdio',
    enabled: true,
    tags: [],
    transport: 'stdio',
    command: 'node',
    args: [FIXTURE],
    connectionPool: POOL_CONFIG,
  };
}

/** Minimal JSON-RPC client over a pooled connection: send a request and read
 *  the response with the matching id (skipping id-less notifications). */
async function rpc(
  transport: { send(m: JsonRpcMessage): Promise<void>; receive(): AsyncIterator<JsonRpcMessage> },
  id: string | number,
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

describe('Backend death does not permanently break tool discovery', () => {
  describe('stdio backend process exits mid-run (code 0)', () => {
    let pool: ConnectionPool;

    beforeEach(() => {
      pool = new ConnectionPool(makeStdioService(), POOL_CONFIG);
      // The pool re-emits transport errors on its own 'error' channel — attach a
      // listener so Node's EventEmitter does not throw on an unhandled 'error'.
      pool.on('error', () => {});
    });

    afterEach(async () => {
      if (pool) {
        await pool.closeAll();
      }
    });

    it('recovers tools/list via a fresh connection after the backend exits', async () => {
      // Given: a registered stdio backend, tools/list returns N tools.
      const conn1 = await pool.acquire();
      const list1 = await rpc(conn1.transport, 'list-1', 'tools/list', {});
      expect(list1.error).toBeUndefined();
      expect(list1.result?.tools).toBeDefined();
      const tools1 = list1.result?.tools ?? [];
      expect(tools1.length).toBe(3);
      const names1 = tools1.map((t) => t.name);

      // When: the backend child process exits (code 0).
      // The `exit` tool makes the fixture respond then process.exit(0).
      const exitResp = await rpc(conn1.transport, 'exit-1', 'tools/call', {
        name: 'exit',
        arguments: {},
      });
      expect(exitResp.error).toBeUndefined();
      expect(exitResp.result).toBeDefined();

      // The transport's process 'exit' (code 0) → handleError → transport ERROR
      // → pool invalidates the dead connection. Wait for the slot to be freed.
      await vi.waitFor(() => {
        expect(pool.getStats().total).toBe(0);
      });

      // Then: the next tools/list request succeeds (not TRANSPORT_ERROR) and
      // returns the same N tools via a fresh connection.
      const conn2 = await pool.acquire();
      expect(conn2.id).not.toBe(conn1.id); // a fresh connection, not the dead one

      const list2 = await rpc(conn2.transport, 'list-2', 'tools/list', {});
      expect(list2.error).toBeUndefined();
      expect(list2.result?.tools).toBeDefined();
      const tools2 = list2.result?.tools ?? [];
      expect(tools2.length).toBe(3);
      expect(tools2.map((t) => t.name)).toEqual(names1);

      pool.release(conn2);
    }, 30000);

    it('does not hand out the dead connection to a later acquire (slot freed)', async () => {
      // Fill the single slot, kill the backend, and confirm the next acquire
      // does not block/queue on the dead connection but creates a fresh one.
      const singleSlotPool = new ConnectionPool(makeStdioService(), {
        ...POOL_CONFIG,
        maxConnections: 1,
      });
      singleSlotPool.on('error', () => {});

      try {
        const conn1 = await singleSlotPool.acquire();
        expect(singleSlotPool.getStats().total).toBe(1);

        // Backend exits (code 0) → dead connection invalidated → slot freed.
        await rpc(conn1.transport, 'exit-1', 'tools/call', { name: 'exit', arguments: {} });
        await vi.waitFor(() => {
          expect(singleSlotPool.getStats().total).toBe(0);
        });

        // With the slot freed, a fresh connection is created instead of queueing.
        const conn2 = await singleSlotPool.acquire();
        expect(conn2.id).not.toBe(conn1.id);
        const list = await rpc(conn2.transport, 'list-1', 'tools/list', {});
        expect(list.error).toBeUndefined();
        expect(list.result?.tools?.length).toBe(3);

        singleSlotPool.release(conn2);
      } finally {
        await singleSlotPool.closeAll();
      }
    }, 30000);
  });
});
