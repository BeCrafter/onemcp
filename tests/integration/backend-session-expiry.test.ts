/**
 * Integration tests: backend session expiry must not permanently break tool discovery.
 *
 * These tests exercise the REAL ConnectionPool + HttpTransport against a real,
 * in-process Streamable HTTP MCP backend. They cover the user-facing scenario
 * the unit tests mock away:
 *
 *   backend session expires (backend answers tools/list with -32001 on the now
 *   stale session) → onemcp invalidates the stale connection and re-initializes
 *   a fresh backend session transparently → tools/list succeeds again.
 *
 * The mock backend expires a session deterministically (one tools/list per
 * session) instead of using a clock, so the test is not timing-sensitive.
 */

import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { ConnectionPool } from '../../src/pool/connection-pool.js';
import { ServiceRegistry } from '../../src/registry/service-registry.js';
import { NamespaceManager } from '../../src/namespace/manager.js';
import { HealthMonitor } from '../../src/health/health-monitor.js';
import { ToolRouter } from '../../src/routing/tool-router.js';
import type { ServiceDefinition, ConnectionPoolConfig } from '../../src/types/service.js';
import type { ConfigProvider, SystemConfig } from '../../src/types/config.js';

const TOOLS = [
  { name: 'alpha', description: 'Alpha tool', inputSchema: { type: 'object', properties: {} } },
  { name: 'beta', description: 'Beta tool', inputSchema: { type: 'object', properties: {} } },
];

function createMockConfigProvider(): ConfigProvider {
  const storedConfig: SystemConfig = {
    mode: 'cli',
    logLevel: 'INFO',
    configDir: '/test/config',
    mcpServers: {},
    connectionPool: { maxConnections: 5, idleTimeout: 60000, connectionTimeout: 30000 },
    healthCheck: { enabled: true, interval: 30000, failureThreshold: 3, autoUnload: true },
    audit: {
      enabled: true,
      level: 'standard',
      logInput: false,
      logOutput: false,
      retention: { days: 30, maxSize: '1GB' },
    },
    security: { dataMasking: { enabled: true, patterns: [] } },
  };
  return {
    load: async () => ({ ...storedConfig }),
    save: async () => {},
    validate: () => ({ valid: true, errors: [] }),
    watch: () => () => {},
  };
}

/**
 * Start a minimal Streamable HTTP MCP backend.
 *
 * Each session may serve exactly `requestsPerSession` non-initialize request(s)
 * before it is reported as expired, modelling the idle-timeout behaviour of the
 * real jymcp backend without wall-clock timing. `staleMode` selects how the
 * expiry is reported: a JSON-RPC `-32001` error (jymcp style, HTTP 200) or a
 * spec-conformant HTTP 404 on the stale Mcp-Session-Id.
 */
function startMockBackend(
  requestsPerSession = 1,
  staleMode: 'jsonrpc' | 'http404' = 'jsonrpc'
): Promise<{
  url: string;
  close: () => Promise<void>;
  initializeCount: () => number;
}> {
  const sessions = new Map<string, number>(); // sid -> remaining allowed requests
  let sidCounter = 0;
  let initializeCount = 0;

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        res.writeHead(400).end();
        return;
      }

      // Notifications: no id -> 202 empty (MCP Streamable HTTP spec)
      if (msg['id'] === undefined || msg['id'] === null) {
        res.writeHead(202, { 'Content-Type': 'text/event-stream' });
        res.end();
        return;
      }

      const sendJson = (status: number, body: unknown, headers: Record<string, string> = {}) => {
        const json = JSON.stringify(body);
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(json),
          ...headers,
        });
        res.end(json);
      };

      if (msg['method'] === 'initialize') {
        initializeCount++;
        const sessionId = `sess-${++sidCounter}`;
        sessions.set(sessionId, requestsPerSession);
        sendJson(
          200,
          {
            jsonrpc: '2.0',
            id: msg['id'],
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: { listChanged: true } },
              serverInfo: { name: 'mock-backend', version: '1.0.0' },
            },
          },
          { 'mcp-session-id': sessionId }
        );
        return;
      }

      const sessionId = Array.isArray(req.headers['mcp-session-id'])
        ? String(req.headers['mcp-session-id'][0])
        : req.headers['mcp-session-id'];
      const remaining = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;

      if (remaining !== undefined && remaining > 0) {
        sessions.set(sessionId as string, remaining - 1);
        if (msg['method'] === 'tools/list') {
          sendJson(200, { jsonrpc: '2.0', id: msg['id'], result: { tools: TOOLS } });
        } else {
          sendJson(200, {
            jsonrpc: '2.0',
            id: msg['id'],
            result: { content: [{ type: 'text', text: 'ok' }] },
          });
        }
        return;
      }

      if (staleMode === 'http404') {
        // Spec-conformant expiry signal: HTTP 404 on the stale Mcp-Session-Id.
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
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}/mcp`,
        initializeCount: () => initializeCount,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

describe('Backend session expiry recovery (integration)', () => {
  let backend: Awaited<ReturnType<typeof startMockBackend>> | undefined;

  afterEach(async () => {
    if (backend) {
      await backend.close().catch(() => {});
      backend = undefined;
    }
  });

  it('recovers tools/list after the backend session expires', async () => {
    backend = await startMockBackend();

    const service: ServiceDefinition = {
      name: 'mock-http',
      enabled: true,
      tags: [],
      transport: 'http',
      url: backend.url,
      connectionPool: { maxConnections: 2, idleTimeout: 60000, connectionTimeout: 10000 },
    } as ServiceDefinition;
    const poolConfig: ConnectionPoolConfig = {
      maxConnections: 2,
      idleTimeout: 60000,
      connectionTimeout: 10000,
    };

    const configProvider = createMockConfigProvider();
    const serviceRegistry = new ServiceRegistry(configProvider);
    await serviceRegistry.initialize();
    await serviceRegistry.register(service);

    const namespaceManager = new NamespaceManager();
    const healthMonitor = new HealthMonitor(serviceRegistry);
    const toolRouter = new ToolRouter(serviceRegistry, namespaceManager, healthMonitor);

    const pool = new ConnectionPool(service, poolConfig);
    pool.on('error', () => {});
    toolRouter.registerConnectionPool(service.name, pool);

    try {
      // First discovery uses a fresh session and succeeds.
      const tools1 = await toolRouter.discoverTools();
      expect(tools1.map((t) => t.name)).toEqual(['alpha', 'beta']);

      // The mock now considers that session expired.
      toolRouter.invalidateCache();

      // Second discovery must transparently re-initialize a fresh session and
      // still return the tools (previously this returned an empty list forever).
      const tools2 = await toolRouter.discoverTools();
      expect(tools2.map((t) => t.name)).toEqual(['alpha', 'beta']);

      // Exactly two sessions were created: the original + one re-initialized.
      expect(backend.initializeCount()).toBe(2);
    } finally {
      await pool.closeAll().catch(() => {});
    }
  }, 30000);

  it('recovers tools/call after the backend session expires', async () => {
    // Two requests per session: one for callTool's internal tools/list lookup
    // (findTool queries the backend live) and one for the actual tools/call.
    backend = await startMockBackend(2);

    const service: ServiceDefinition = {
      name: 'mock-http',
      enabled: true,
      tags: [],
      transport: 'http',
      url: backend.url,
      connectionPool: { maxConnections: 2, idleTimeout: 60000, connectionTimeout: 10000 },
    } as ServiceDefinition;
    const poolConfig: ConnectionPoolConfig = {
      maxConnections: 2,
      idleTimeout: 60000,
      connectionTimeout: 10000,
    };

    const configProvider = createMockConfigProvider();
    const serviceRegistry = new ServiceRegistry(configProvider);
    await serviceRegistry.initialize();
    await serviceRegistry.register(service);

    const namespaceManager = new NamespaceManager();
    const healthMonitor = new HealthMonitor(serviceRegistry);
    const toolRouter = new ToolRouter(serviceRegistry, namespaceManager, healthMonitor);

    const pool = new ConnectionPool(service, poolConfig);
    pool.on('error', () => {});
    toolRouter.registerConnectionPool(service.name, pool);

    try {
      // Discovery uses up the session's one allowed non-initialize request, so
      // the pooled connection now holds an expired session.
      const tools = await toolRouter.discoverTools();
      expect(tools.map((t) => t.name)).toEqual(['alpha', 'beta']);

      // findTool serves from the discovery cache now — drop it so callTool's
      // internal tools/list lookup goes live and consumes the session's second
      // request, making the actual tools/call hit the expired session.
      toolRouter.invalidateServiceCache(service.name);

      // The first tools/call hits the expired session (-32001). The router must
      // invalidate the stale connection, re-initialize a fresh backend session
      // and succeed transparently — the caller just sees the tool result.
      const result = (await toolRouter.callTool(
        'mock-http__alpha',
        {},
        {
          requestId: 'req-1',
          correlationId: 'corr-1',
          timestamp: new Date(),
        }
      )) as { content: Array<{ type: string; text: string }> };
      expect(result.content[0]?.text).toBe('ok');

      // Exactly two sessions were created: the original + one re-initialized.
      expect(backend.initializeCount()).toBe(2);

      // The rebuilt session stays usable for a subsequent call on the same
      // pooled connection.
      const result2 = (await toolRouter.callTool(
        'mock-http__beta',
        {},
        {
          requestId: 'req-2',
          correlationId: 'corr-2',
          timestamp: new Date(),
        }
      )) as { content: Array<{ type: string; text: string }> };
      expect(result2.content[0]?.text).toBe('ok');
    } finally {
      await pool.closeAll().catch(() => {});
    }
  }, 30000);

  it('recovers tools/call when a spec-conformant backend answers HTTP 404 on the stale session', async () => {
    // One request per session: discovery consumes session A's only request, so
    // the pooled connection is stale by the time the tool is called. The stale
    // session is reported as HTTP 404 (the MCP-spec expiry signal) instead of
    // a JSON-RPC -32001 error body.
    backend = await startMockBackend(1, 'http404');

    const service: ServiceDefinition = {
      name: 'mock-http',
      enabled: true,
      tags: [],
      transport: 'http',
      url: backend.url,
      connectionPool: { maxConnections: 2, idleTimeout: 60000, connectionTimeout: 10000 },
    } as ServiceDefinition;
    const poolConfig: ConnectionPoolConfig = {
      maxConnections: 2,
      idleTimeout: 60000,
      connectionTimeout: 10000,
    };

    const configProvider = createMockConfigProvider();
    const serviceRegistry = new ServiceRegistry(configProvider);
    await serviceRegistry.initialize();
    await serviceRegistry.register(service);

    const namespaceManager = new NamespaceManager();
    const healthMonitor = new HealthMonitor(serviceRegistry);
    const toolRouter = new ToolRouter(serviceRegistry, namespaceManager, healthMonitor);

    const pool = new ConnectionPool(service, poolConfig);
    pool.on('error', () => {});
    toolRouter.registerConnectionPool(service.name, pool);

    try {
      // Populates the discovery cache (findTool will serve from it, matching
      // the common client flow) and uses up session A's single request.
      const tools = await toolRouter.discoverTools();
      expect(tools.map((t) => t.name)).toEqual(['alpha', 'beta']);

      // The tools/call hits the stale session and receives HTTP 404. The
      // router must classify it as session expiry, invalidate the connection,
      // re-initialize and succeed transparently.
      const result = (await toolRouter.callTool(
        'mock-http__alpha',
        {},
        {
          requestId: 'req-1',
          correlationId: 'corr-1',
          timestamp: new Date(),
        }
      )) as { content: Array<{ type: string; text: string }> };
      expect(result.content[0]?.text).toBe('ok');

      // Exactly two sessions: the original + one re-initialized on the 404.
      expect(backend.initializeCount()).toBe(2);
    } finally {
      await pool.closeAll().catch(() => {});
    }
  }, 30000);
});
