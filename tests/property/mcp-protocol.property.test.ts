/**
 * Property-Based Tests for MCP Protocol Methods
 *
 * Tests universal properties of MCP protocol handling using fast-check.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { McpProtocolHandler } from '../../src/protocol/mcp-handler.js';
import { ToolRouter } from '../../src/routing/tool-router.js';
import { ServiceRegistry } from '../../src/registry/service-registry.js';
import { NamespaceManager } from '../../src/namespace/manager.js';
import { HealthMonitor } from '../../src/health/health-monitor.js';
import { MemoryStorageAdapter } from '../../src/storage/memory.js';
import { FileConfigProvider } from '../../src/config/file-provider.js';
import type { RequestContext } from '../../src/types/context.js';
import type { SystemConfig } from '../../src/types/config.js';
import type { JsonRpcRequest } from '../../src/types/jsonrpc.js';
import { ErrorCode } from '../../src/types/jsonrpc.js';

/**
 * Create a test config provider with in-memory storage
 */
async function createTestConfigProvider(): Promise<FileConfigProvider> {
  const storage = new MemoryStorageAdapter();

  const defaultConfig: SystemConfig = {
    mode: 'cli',
    logLevel: 'INFO',
    configDir: '/test',
    mcpServers: {},
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
        patterns: ['password', 'token', 'secret', 'key'],
      },
    },
  };

  await storage.write('config.json', JSON.stringify(defaultConfig));

  return new FileConfigProvider({
    storageAdapter: storage,
    configDir: '/test',
  });
}

/**
 * Arbitrary for tool call requests
 */
function toolCallRequestArbitrary(): fc.Arbitrary<JsonRpcRequest> {
  return fc.record({
    jsonrpc: fc.constant('2.0' as const),
    id: fc.oneof(fc.string(), fc.integer()),
    method: fc.constant('tools/call'),
    params: fc.record({
      name: fc.string({ minLength: 1 }),
      arguments: fc.option(fc.dictionary(fc.string(), fc.anything())),
    }),
  });
}

describe('Property 18: Batch Request Partial Failure Isolation', () => {
  let configProvider: FileConfigProvider;
  let serviceRegistry: ServiceRegistry;
  let namespaceManager: NamespaceManager;
  let healthMonitor: HealthMonitor;
  let toolRouter: ToolRouter;
  let mcpHandler: McpProtocolHandler;

  beforeEach(async () => {
    configProvider = await createTestConfigProvider();
    serviceRegistry = new ServiceRegistry(configProvider);
    await serviceRegistry.initialize();
    namespaceManager = new NamespaceManager();
    healthMonitor = new HealthMonitor(serviceRegistry);
    toolRouter = new ToolRouter(serviceRegistry, namespaceManager, healthMonitor);
    mcpHandler = new McpProtocolHandler(toolRouter, { maxBatchSize: 100 });
  });

  it('should isolate failures in batch requests - failures do not prevent other calls from executing', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(toolCallRequestArbitrary(), { minLength: 2, maxLength: 10 }),
        async (requests) => {
          // Initialize the handler
          const context: RequestContext = {
            requestId: 'test-request',
            correlationId: 'test-correlation',
            timestamp: new Date(),
          };

          await mcpHandler.initialize(
            {
              protocolVersion: '2024-11-05',
              clientInfo: { name: 'test-client', version: '1.0.0' },
            },
            context
          );

          // Execute batch request
          const responses = await mcpHandler.handleBatch(requests, context);

          // Verify we got a response for each request (Requirement 21.2)
          expect(responses).toHaveLength(requests.length);

          // Verify each response has the correct ID
          for (let i = 0; i < requests.length; i++) {
            const response = responses[i];
            const request = requests[i];
            expect(response).toBeDefined();
            expect(request).toBeDefined();
            if (response && request) {
              expect(response.id).toBe(request.id);
            }
          }

          // Count successes and failures
          const successes = responses.filter((r) => 'result' in r);
          const failures = responses.filter((r) => 'error' in r);

          // Verify that we have both successes and failures OR all failures
          // (since tools don't exist, most will fail, but the batch should complete)
          expect(successes.length + failures.length).toBe(requests.length);

          // Verify that failures have proper error structure
          for (const failure of failures) {
            if ('error' in failure) {
              expect(failure.error).toHaveProperty('code');
              expect(failure.error).toHaveProperty('message');
              expect(typeof failure.error.code).toBe('number');
              expect(typeof failure.error.message).toBe('string');
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should enforce batch size limits', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 101, max: 200 }), async (batchSize) => {
        const context: RequestContext = {
          requestId: 'test-request',
          correlationId: 'test-correlation',
          timestamp: new Date(),
        };

        await mcpHandler.initialize(
          {
            protocolVersion: '2024-11-05',
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
          context
        );

        // Create a batch larger than the limit
        const requests: JsonRpcRequest[] = Array.from({ length: batchSize }, (_, i) => ({
          jsonrpc: '2.0' as const,
          id: i,
          method: 'tools/call',
          params: {
            name: `tool-${i}`,
            arguments: {},
          },
        }));

        // Verify that batch size limit is enforced (Requirement 21.5)
        await expect(mcpHandler.handleBatch(requests, context)).rejects.toThrow();
      }),
      { numRuns: 50 }
    );
  });

  it('should maintain correlation IDs for each request in batch', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(toolCallRequestArbitrary(), { minLength: 2, maxLength: 10 }),
        async (requests) => {
          const context: RequestContext = {
            requestId: 'test-request',
            correlationId: 'test-correlation',
            timestamp: new Date(),
          };

          await mcpHandler.initialize(
            {
              protocolVersion: '2024-11-05',
              clientInfo: { name: 'test-client', version: '1.0.0' },
            },
            context
          );

          const responses = await mcpHandler.handleBatch(requests, context);

          // Verify each response maintains correlation ID (Requirement 21.3)
          for (const response of responses) {
            if ('error' in response && response.error.data) {
              expect(response.error.data).toHaveProperty('correlationId');
              expect(typeof response.error.data.correlationId).toBe('string');
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('MCP Protocol Methods - Additional Properties', () => {
  let configProvider: FileConfigProvider;
  let serviceRegistry: ServiceRegistry;
  let namespaceManager: NamespaceManager;
  let healthMonitor: HealthMonitor;
  let toolRouter: ToolRouter;
  let mcpHandler: McpProtocolHandler;

  beforeEach(async () => {
    configProvider = await createTestConfigProvider();
    serviceRegistry = new ServiceRegistry(configProvider);
    await serviceRegistry.initialize();
    namespaceManager = new NamespaceManager();
    healthMonitor = new HealthMonitor(serviceRegistry);
    toolRouter = new ToolRouter(serviceRegistry, namespaceManager, healthMonitor);
    mcpHandler = new McpProtocolHandler(toolRouter, { maxBatchSize: 100 });
  });

  it('should require initialization before handling requests', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom('tools/list', 'tools/call'), async (method) => {
        const context: RequestContext = {
          requestId: 'test-request',
          correlationId: 'test-correlation',
          timestamp: new Date(),
        };

        const request: JsonRpcRequest = {
          jsonrpc: '2.0',
          id: 1,
          method,
          params: method === 'tools/call' ? { name: 'test-tool' } : undefined,
        };

        // Should fail before initialization
        const response = await mcpHandler.handleRequest(request, context);

        expect('error' in response).toBe(true);
        if ('error' in response) {
          expect(response.error.code).toBe(ErrorCode.INTERNAL_ERROR);
          expect(response.error.message).toContain('not initialized');
        }
      }),
      { numRuns: 50 }
    );
  });

  it('should accept tag filters during initialization', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 5 }),
        fc.constantFrom<'AND' | 'OR'>('AND', 'OR'),
        async (tags, logic) => {
          const context: RequestContext = {
            requestId: 'test-request',
            correlationId: 'test-correlation',
            timestamp: new Date(),
          };

          const result = await mcpHandler.initialize(
            {
              protocolVersion: '2024-11-05',
              clientInfo: { name: 'test-client', version: '1.0.0' },
              tagFilter: { tags, logic },
            },
            context
          );

          // Verify initialization succeeded
          expect(result).toHaveProperty('protocolVersion');
          expect(result).toHaveProperty('serverInfo');

          // Verify tag filter was stored
          const storedFilter = mcpHandler.getTagFilter();
          expect(storedFilter).toBeDefined();
          expect(storedFilter?.tags).toEqual(tags);
          expect(storedFilter?.logic).toBe(logic);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return proper error for unknown methods', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .string({ minLength: 1 })
          .filter((s) => !['initialize', 'tools/list', 'tools/call'].includes(s)),
        async (method) => {
          const context: RequestContext = {
            requestId: 'test-request',
            correlationId: 'test-correlation',
            timestamp: new Date(),
          };

          // Initialize first
          await mcpHandler.initialize(
            {
              protocolVersion: '2024-11-05',
              clientInfo: { name: 'test-client', version: '1.0.0' },
            },
            context
          );

          const request: JsonRpcRequest = {
            jsonrpc: '2.0',
            id: 1,
            method,
            params: {},
          };

          const response = await mcpHandler.handleRequest(request, context);

          expect('error' in response).toBe(true);
          if ('error' in response) {
            expect(response.error.code).toBe(ErrorCode.METHOD_NOT_FOUND);
            expect(response.error.message).toContain(method);
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});
