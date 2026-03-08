/**
 * Integration tests for Server Mode
 *
 * Tests the complete Server mode functionality including:
 * - HTTP server startup and shutdown
 * - Multi-client connection handling
 * - Session isolation
 * - Health, diagnostics, and metrics endpoints
 * - Concurrent request handling
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ServerModeRunner } from '../../src/server-mode.js';
import { MemoryStorageAdapter } from '../../src/storage/memory.js';
import { FileConfigProvider } from '../../src/config/file-provider.js';
import type { SystemConfig } from '../../src/types/config.js';

describe('Server Mode Integration Tests', () => {
  let runner: ServerModeRunner;
  let configProvider: FileConfigProvider;
  let storage: MemoryStorageAdapter;
  let config: SystemConfig;
  const testPort = 13000; // Use a high port to avoid conflicts

  beforeEach(async () => {
    // Create test configuration
    config = {
      mode: 'server',
      port: testPort,
      logLevel: 'ERROR', // Reduce noise in tests
      configDir: '/tmp/test-onemcp',
      services: [],
      connectionPool: {
        maxConnections: 5,
        idleTimeout: 60000,
        connectionTimeout: 30000,
      },
      healthCheck: {
        enabled: true,
        interval: 30000,
        failureThreshold: 3,
        autoUnload: true,
      },
      audit: {
        enabled: false,
        level: 'standard',
        logInput: false,
        logOutput: false,
        retention: {
          days: 30,
          maxSize: '1GB',
        },
      },
      security: {
        dataMasking: {
          enabled: true,
          patterns: ['password', 'token'],
        },
      },
      logging: {
        level: 'ERROR',
        outputs: ['console'],
        format: 'json',
      },
      metrics: {
        enabled: true,
        collectionInterval: 60000,
        retentionPeriod: 86400000,
      },
    };

    // Create storage and config provider
    storage = new MemoryStorageAdapter();

    // Store the config in memory storage with the full path that FileConfigProvider expects
    const configPath = `${config.configDir}/config.json`;
    await storage.write(configPath, JSON.stringify(config));

    configProvider = new FileConfigProvider({
      storageAdapter: storage,
      configDir: config.configDir,
    });

    // Create runner
    runner = new ServerModeRunner(config, configProvider);
  });

  afterEach(async () => {
    if (runner.isRunning()) {
      await runner.stop();
    }
  });

  describe('Server Startup and Shutdown', () => {
    it('should start the HTTP server successfully', async () => {
      await runner.start();
      expect(runner.isRunning()).toBe(true);

      // Verify server is listening by making a request to root endpoint
      const response = await fetch(`http://localhost:${testPort}/`);
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data).toMatchObject({
        name: 'MCP Router System',
        mode: 'server',
        status: 'running',
      });
    });

    it('should stop the HTTP server gracefully', async () => {
      await runner.start();
      expect(runner.isRunning()).toBe(true);

      await runner.stop();
      expect(runner.isRunning()).toBe(false);

      // Verify server is no longer listening
      await expect(fetch(`http://localhost:${testPort}/`)).rejects.toThrow();
    });

    it('should handle multiple start/stop cycles', async () => {
      // First cycle
      await runner.start();
      expect(runner.isRunning()).toBe(true);
      await runner.stop();
      expect(runner.isRunning()).toBe(false);

      // Create new runner for second cycle
      runner = new ServerModeRunner(config, configProvider);
      await runner.start();
      expect(runner.isRunning()).toBe(true);
      await runner.stop();
      expect(runner.isRunning()).toBe(false);
    });
  });

  describe('Health Check Endpoint', () => {
    it('should return health status', async () => {
      await runner.start();

      const response = await fetch(`http://localhost:${testPort}/health`);
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data).toHaveProperty('status');
      expect(data).toHaveProperty('timestamp');
      expect(data).toHaveProperty('services');
      expect(data).toHaveProperty('sessions');
      expect(Array.isArray(data.services)).toBe(true);
    });

    it('should return healthy status when all services are healthy', async () => {
      await runner.start();

      const response = await fetch(`http://localhost:${testPort}/health`);
      const data = await response.json();

      expect(data.status).toBe('healthy');
      expect(response.status).toBe(200);
    });
  });

  describe('Diagnostics Endpoint', () => {
    it('should return diagnostics information', async () => {
      await runner.start();

      const response = await fetch(`http://localhost:${testPort}/diagnostics`);
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data).toHaveProperty('timestamp');
      expect(data).toHaveProperty('mode', 'server');
      expect(data).toHaveProperty('port', testPort);
      expect(data).toHaveProperty('services');
      expect(data).toHaveProperty('sessions');
      expect(data).toHaveProperty('health');
      expect(data).toHaveProperty('connectionPools');
    });

    it('should include session information', async () => {
      await runner.start();

      // Make a request to create a session
      await fetch(`http://localhost:${testPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': 'test-session-1',
          'X-Agent-Id': 'test-agent-1',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {},
        }),
      });

      const response = await fetch(`http://localhost:${testPort}/diagnostics`);
      const data = await response.json();

      expect(data.sessions.active).toBeGreaterThan(0);
      expect(Array.isArray(data.sessions.list)).toBe(true);
    });
  });

  describe('Metrics Endpoint', () => {
    it('should return metrics information', async () => {
      await runner.start();

      const response = await fetch(`http://localhost:${testPort}/metrics`);
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data).toHaveProperty('timestamp');
      expect(data).toHaveProperty('metrics');
    });
  });

  describe('Multi-Client Connection Handling', () => {
    it('should handle multiple concurrent client connections', async () => {
      await runner.start();

      // Create multiple concurrent requests with different session IDs
      const requests = Array.from({ length: 5 }, (_, i) =>
        fetch(`http://localhost:${testPort}/mcp`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Session-Id': `session-${i}`,
            'X-Agent-Id': `agent-${i}`,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: i,
            method: 'initialize',
            params: {},
          }),
        })
      );

      const responses = await Promise.all(requests);

      // All requests should succeed
      for (const response of responses) {
        expect(response.ok).toBe(true);
      }

      // Check diagnostics to verify multiple sessions
      const diagResponse = await fetch(`http://localhost:${testPort}/diagnostics`);
      const diagData = await diagResponse.json();
      expect(diagData.sessions.active).toBeGreaterThanOrEqual(5);
    });

    it('should isolate sessions between different clients', async () => {
      await runner.start();

      // Client 1 makes a request
      const response1 = await fetch(`http://localhost:${testPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': 'session-1',
          'X-Agent-Id': 'agent-1',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {},
        }),
      });

      // Client 2 makes a request
      const response2 = await fetch(`http://localhost:${testPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': 'session-2',
          'X-Agent-Id': 'agent-2',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {},
        }),
      });

      expect(response1.ok).toBe(true);
      expect(response2.ok).toBe(true);

      const data1 = await response1.json();
      const data2 = await response2.json();

      // Both should get valid responses
      expect(data1).toHaveProperty('jsonrpc', '2.0');
      expect(data2).toHaveProperty('jsonrpc', '2.0');
    });
  });

  describe('MCP Request Handling', () => {
    it('should handle initialize requests', async () => {
      await runner.start();

      const response = await fetch(`http://localhost:${testPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '1.0',
            clientInfo: {
              name: 'test-client',
              version: '1.0.0',
            },
          },
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();

      expect(data).toHaveProperty('jsonrpc', '2.0');
      expect(data).toHaveProperty('id', 1);
      expect(data).toHaveProperty('result');
    });

    it('should handle tools/list requests', async () => {
      await runner.start();

      const response = await fetch(`http://localhost:${testPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();

      expect(data).toHaveProperty('jsonrpc', '2.0');
      expect(data).toHaveProperty('id', 2);
      expect(data).toHaveProperty('result');
      expect(data.result).toHaveProperty('tools');
      expect(Array.isArray(data.result.tools)).toBe(true);
    });

    it('should return error for invalid JSON-RPC requests', async () => {
      await runner.start();

      const response = await fetch(`http://localhost:${testPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // Missing jsonrpc field
          id: 1,
          method: 'test',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();

      expect(data).toHaveProperty('jsonrpc', '2.0');
      expect(data).toHaveProperty('error');
      expect(data.error).toHaveProperty('code');
      expect(data.error).toHaveProperty('message');
    });

    it('should return error for malformed JSON', async () => {
      await runner.start();

      const response = await fetch(`http://localhost:${testPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: 'invalid json{',
      });

      expect(response.status).toBe(400);
      const data = await response.json();

      expect(data).toHaveProperty('jsonrpc', '2.0');
      expect(data).toHaveProperty('error');
      expect(data.error.code).toBe(-32700); // Parse error
    });
  });

  describe('Session Management', () => {
    it('should create sessions for new clients', async () => {
      await runner.start();

      // Make request without session ID
      await fetch(`http://localhost:${testPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {},
        }),
      });

      // Check diagnostics
      const diagResponse = await fetch(`http://localhost:${testPort}/diagnostics`);
      const diagData = await diagResponse.json();

      expect(diagData.sessions.active).toBeGreaterThan(0);
    });

    it('should reuse existing sessions when session ID is provided', async () => {
      await runner.start();

      const sessionId = 'test-session-123';

      // First request
      await fetch(`http://localhost:${testPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': sessionId,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {},
        }),
      });

      // Second request with same session ID
      await fetch(`http://localhost:${testPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': sessionId,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        }),
      });

      // Check diagnostics - should still have the same session
      const diagResponse = await fetch(`http://localhost:${testPort}/diagnostics`);
      const diagData = await diagResponse.json();

      const session = diagData.sessions.list.find((s: any) => s.id === sessionId);
      expect(session).toBeDefined();
    });
  });

  describe('Concurrent Request Handling', () => {
    it('should handle concurrent requests from the same session', async () => {
      await runner.start();

      const sessionId = 'concurrent-session';

      // Make multiple concurrent requests with the same session
      const requests = Array.from({ length: 10 }, (_, i) =>
        fetch(`http://localhost:${testPort}/mcp`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Session-Id': sessionId,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: i,
            method: 'tools/list',
            params: {},
          }),
        })
      );

      const responses = await Promise.all(requests);

      // All requests should succeed
      for (const response of responses) {
        expect(response.ok).toBe(true);
      }

      // Verify all responses are valid
      const data = await Promise.all(responses.map((r) => r.json()));
      for (let i = 0; i < data.length; i++) {
        expect(data[i]).toHaveProperty('jsonrpc', '2.0');
        expect(data[i]).toHaveProperty('id', i);
      }
    });

    it('should handle concurrent requests from different sessions', async () => {
      await runner.start();

      // Make concurrent requests from different sessions
      const requests = Array.from({ length: 10 }, (_, i) =>
        fetch(`http://localhost:${testPort}/mcp`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Session-Id': `session-${i}`,
            'X-Agent-Id': `agent-${i}`,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/list',
            params: {},
          }),
        })
      );

      const responses = await Promise.all(requests);

      // All requests should succeed
      for (const response of responses) {
        expect(response.ok).toBe(true);
      }

      // Check diagnostics to verify multiple sessions
      const diagResponse = await fetch(`http://localhost:${testPort}/diagnostics`);
      const diagData = await diagResponse.json();
      expect(diagData.sessions.active).toBeGreaterThanOrEqual(10);
    });
  });
});
