/**
 * Integration tests: TUI discovery-worker must recover from backend session expiry.
 *
 * fetchServiceTools opens a one-shot connection per attempt; a session-expiry
 * failure (-32001 JSON-RPC error, or a spec-conformant HTTP 404) must be
 * retried once so the fresh attempt establishes a new backend session
 * (lazy rebuild) instead of surfacing an error to the TUI.
 */

import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { fetchServiceTools } from '../../src/tui/discovery-worker.js';
import type { ServiceDefinition } from '../../src/types/service.js';

const TOOLS = [
  { name: 'alpha', description: 'Alpha', inputSchema: { type: 'object', properties: {} } },
];

type Mode = 'first-session-expired' | 'first-session-http404' | 'always-expired';

function startMockBackend(mode: Mode): Promise<{
  url: string;
  close: () => Promise<void>;
  stats: () => { initializes: number; expiredErrors: number };
}> {
  const sessions = new Map<string, number>();
  let sidCounter = 0;
  let initializeCount = 0;
  let expiredErrors = 0;

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        res.writeHead(400).end();
        return;
      }
      const sendJson = (status: number, body: unknown) => {
        const json = JSON.stringify(body);
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(json),
        });
        res.end(json);
      };

      if (msg['method'] === 'initialize') {
        initializeCount++;
        const sessionId = `sess-${++sidCounter}`;
        // The first session is already expired; every later session is healthy.
        sessions.set(sessionId, sidCounter === 1 ? 0 : 5);
        const json = JSON.stringify({
          jsonrpc: '2.0',
          id: msg['id'],
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'mock-backend', version: '1.0.0' },
          },
        });
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(json),
          'mcp-session-id': sessionId,
        });
        res.end(json);
        return;
      }

      const sessionId = req.headers['mcp-session-id'];
      const remaining = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;

      if (msg['method'] === 'tools/list') {
        const expired = mode === 'always-expired' || remaining === undefined || remaining <= 0;
        if (expired) {
          expiredErrors++;
          // Spec-conformant backends answer a stale Mcp-Session-Id with HTTP 404.
          if (mode === 'first-session-http404') {
            res.writeHead(404).end('Not Found');
            return;
          }
          sendJson(200, {
            jsonrpc: '2.0',
            id: msg['id'],
            error: {
              code: -32001,
              message: 'Session not found or expired. Please send initialize again.',
            },
          });
          return;
        }
        sessions.set(sessionId as string, (remaining as number) - 1);
        sendJson(200, { jsonrpc: '2.0', id: msg['id'], result: { tools: TOOLS } });
        return;
      }

      // notifications/initialized and anything else
      sendJson(200, { jsonrpc: '2.0', id: msg['id'] ?? 'notification', result: {} });
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}/mcp`,
        close: () => new Promise<void>((r) => server.close(() => r())),
        stats: () => ({ initializes: initializeCount, expiredErrors }),
      });
    });
  });
}

function makeService(url: string): ServiceDefinition {
  return {
    name: 'mock-http',
    enabled: true,
    tags: [],
    transport: 'http',
    url,
    connectionPool: { maxConnections: 1, idleTimeout: 60000, connectionTimeout: 10000 },
  } as ServiceDefinition;
}

describe('discovery-worker session expiry recovery', () => {
  let backend: Awaited<ReturnType<typeof startMockBackend>> | undefined;

  afterEach(async () => {
    if (backend) {
      await backend.close().catch(() => {});
      backend = undefined;
    }
  });

  it('recovers from a JSON-RPC -32001 expired session via one retry', async () => {
    backend = await startMockBackend('first-session-expired');

    const tools = await fetchServiceTools(makeService(backend.url), 5000);

    expect(tools.map((t) => t.name)).toEqual(['alpha']);
    // The retry established a brand-new backend session (lazy rebuild).
    expect(backend.stats()).toEqual({ initializes: 2, expiredErrors: 1 });
  });

  it('recovers from a spec-conformant HTTP 404 session expiry via one retry', async () => {
    backend = await startMockBackend('first-session-http404');

    const tools = await fetchServiceTools(makeService(backend.url), 5000);

    expect(tools.map((t) => t.name)).toEqual(['alpha']);
    expect(backend.stats()).toEqual({ initializes: 2, expiredErrors: 1 });
  });

  it('fails after the single retry when every session is expired (bounded)', async () => {
    backend = await startMockBackend('always-expired');

    await expect(fetchServiceTools(makeService(backend.url), 5000)).rejects.toThrow(
      /Session not found/
    );
    // Exactly two attempts (initial + one lazy rebuild), then the error surfaces.
    expect(backend.stats()).toEqual({ initializes: 2, expiredErrors: 2 });
  });
});
