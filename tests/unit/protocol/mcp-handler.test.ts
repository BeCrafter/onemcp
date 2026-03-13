/**
 * Unit Tests for MCP Protocol Handler
 *
 * Tests specific examples and edge cases for MCP protocol methods.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { McpProtocolHandler } from '../../../src/protocol/mcp-handler.js';
import { ToolRouter } from '../../../src/routing/tool-router.js';
import { ServiceRegistry } from '../../../src/registry/service-registry.js';
import { NamespaceManager } from '../../../src/namespace/manager.js';
import { HealthMonitor } from '../../../src/health/health-monitor.js';
import { MemoryStorageAdapter } from '../../../src/storage/memory.js';
import { FileConfigProvider } from '../../../src/config/file-provider.js';
import { getPackageVersion } from '../../../src/utils/package-version.js';
import type { RequestContext } from '../../../src/types/context.js';
import type { ServiceDefinition } from '../../../src/types/service.js';
import type { SystemConfig } from '../../../src/types/config.js';
import type { JsonRpcRequest } from '../../../src/types/jsonrpc.js';
import { ErrorCode } from '../../../src/types/jsonrpc.js';

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
 * Create test service definition
 */
function createTestService(overrides?: Partial<ServiceDefinition>): ServiceDefinition {
  return {
    name: 'test-service',
    enabled: true,
    tags: [],
    transport: 'stdio',
    command: 'node',
    args: ['test.js'],
    env: {},
    connectionPool: {
      maxConnections: 5,
      idleTimeout: 60000,
      connectionTimeout: 30000,
    },
    ...overrides,
  };
}

describe('McpProtocolHandler', () => {
  let configProvider: FileConfigProvider;
  let serviceRegistry: ServiceRegistry;
  let namespaceManager: NamespaceManager;
  let healthMonitor: HealthMonitor;
  let toolRouter: ToolRouter;
  let mcpHandler: McpProtocolHandler;
  let context: RequestContext;

  beforeEach(async () => {
    configProvider = await createTestConfigProvider();
    serviceRegistry = new ServiceRegistry(configProvider);
    await serviceRegistry.initialize();
    namespaceManager = new NamespaceManager();
    healthMonitor = new HealthMonitor(serviceRegistry);
    toolRouter = new ToolRouter(serviceRegistry, namespaceManager, healthMonitor);
    mcpHandler = new McpProtocolHandler(toolRouter, { maxBatchSize: 100 });

    context = {
      requestId: 'test-request-1',
      correlationId: 'test-correlation-1',
      timestamp: new Date(),
    };
  });

  describe('initialize', () => {
    it('should handle initialization handshake', async () => {
      const result = await mcpHandler.initialize(
        {
          protocolVersion: '2024-11-05',
          clientInfo: {
            name: 'test-client',
            version: '1.0.0',
          },
        },
        context
      );

      expect(result).toEqual({
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: 'onemcp',
          version: getPackageVersion(),
        },
      });

      expect(mcpHandler.isInitialized()).toBe(true);
    });

    it('should store tag filter from initialization parameters', async () => {
      const tagFilter = {
        tags: ['production', 'api'],
        logic: 'AND' as const,
      };

      await mcpHandler.initialize(
        {
          protocolVersion: '2024-11-05',
          clientInfo: {
            name: 'test-client',
            version: '1.0.0',
          },
          tagFilter,
        },
        context
      );

      expect(mcpHandler.getTagFilter()).toEqual(tagFilter);
    });

    it('should work without tag filter', async () => {
      await mcpHandler.initialize(
        {
          protocolVersion: '2024-11-05',
          clientInfo: {
            name: 'test-client',
            version: '1.0.0',
          },
        },
        context
      );

      expect(mcpHandler.getTagFilter()).toBeUndefined();
    });
  });

  describe('toolsList', () => {
    beforeEach(async () => {
      await mcpHandler.initialize(
        {
          protocolVersion: '2024-11-05',
          clientInfo: { name: 'test-client', version: '1.0.0' },
        },
        context
      );
    });

    it('should return empty list when no services are registered', async () => {
      const result = await mcpHandler.toolsList(undefined, context);

      expect(result).toEqual({ tools: [] });
    });

    it('should throw error if not initialized', async () => {
      const uninitializedHandler = new McpProtocolHandler(toolRouter);

      await expect(uninitializedHandler.toolsList(undefined, context)).rejects.toThrow(
        'not initialized'
      );
    });

    it('should apply tag filter from params', async () => {
      // Register a service with tags
      await serviceRegistry.register(
        createTestService({
          name: 'tagged-service',
          tags: ['production'],
        })
      );

      // Mock discoverTools to verify tag filter is passed
      const discoverToolsSpy = vi.spyOn(toolRouter, 'discoverTools');
      discoverToolsSpy.mockResolvedValue([]);

      const tagFilter = { tags: ['production'], logic: 'AND' as const };
      await mcpHandler.toolsList({ tagFilter }, context);

      expect(discoverToolsSpy).toHaveBeenCalledWith(tagFilter);
    });

    it('should use tag filter from initialization if not provided in params', async () => {
      // Create new handler with tag filter in initialization
      const handlerWithFilter = new McpProtocolHandler(toolRouter);
      const tagFilter = { tags: ['production'], logic: 'AND' as const };

      await handlerWithFilter.initialize(
        {
          protocolVersion: '2024-11-05',
          clientInfo: { name: 'test-client', version: '1.0.0' },
          tagFilter,
        },
        context
      );

      // Mock discoverTools to verify tag filter is passed
      const discoverToolsSpy = vi.spyOn(toolRouter, 'discoverTools');
      discoverToolsSpy.mockResolvedValue([]);

      await handlerWithFilter.toolsList(undefined, context);

      expect(discoverToolsSpy).toHaveBeenCalledWith(tagFilter);
    });

    it('should include tool enabled/disabled status', async () => {
      // Mock discoverTools to return tools with different statuses
      const mockTools = [
        {
          name: 'tool1',
          namespacedName: 'service__tool1',
          serviceName: 'service',
          description: 'Tool 1',
          inputSchema: {
            type: 'object' as const,
            properties: {},
          },
          enabled: true,
        },
        {
          name: 'tool2',
          namespacedName: 'service__tool2',
          serviceName: 'service',
          description: 'Tool 2',
          inputSchema: {
            type: 'object' as const,
            properties: {},
          },
          enabled: false,
        },
      ];

      vi.spyOn(toolRouter, 'discoverTools').mockResolvedValue(mockTools);

      const result = await mcpHandler.toolsList(undefined, context);

      expect(result.tools).toHaveLength(2);
      expect(result.tools[0]?.enabled).toBe(true);
      expect(result.tools[1]?.enabled).toBe(false);
    });
  });

  describe('toolsCall', () => {
    beforeEach(async () => {
      await mcpHandler.initialize(
        {
          protocolVersion: '2024-11-05',
          clientInfo: { name: 'test-client', version: '1.0.0' },
        },
        context
      );
    });

    it('should throw error if not initialized', async () => {
      const uninitializedHandler = new McpProtocolHandler(toolRouter);

      await expect(
        uninitializedHandler.toolsCall({ name: 'test-tool', arguments: {} }, context)
      ).rejects.toThrow('not initialized');
    });

    it('should throw error if tool name is missing', async () => {
      await expect(mcpHandler.toolsCall({ name: '', arguments: {} }, context)).rejects.toThrow(
        'Tool name is required'
      );
    });

    it('should call tool via router', async () => {
      const mockResult = { success: true, data: 'test-data' };
      const callToolSpy = vi.spyOn(toolRouter, 'callTool');
      callToolSpy.mockResolvedValue(mockResult);

      const result = await mcpHandler.toolsCall(
        {
          name: 'service__test-tool',
          arguments: { param1: 'value1' },
        },
        context
      );

      expect(callToolSpy).toHaveBeenCalledWith('service__test-tool', { param1: 'value1' }, context);
      expect(result).toEqual(mockResult);
    });

    it('should use empty object for arguments if not provided', async () => {
      const callToolSpy = vi.spyOn(toolRouter, 'callTool');
      callToolSpy.mockResolvedValue({ success: true });

      await mcpHandler.toolsCall({ name: 'service__test-tool' }, context);

      expect(callToolSpy).toHaveBeenCalledWith('service__test-tool', {}, context);
    });
  });

  describe('handleBatch', () => {
    beforeEach(async () => {
      await mcpHandler.initialize(
        {
          protocolVersion: '2024-11-05',
          clientInfo: { name: 'test-client', version: '1.0.0' },
        },
        context
      );
    });

    it('should handle empty batch', async () => {
      const responses = await mcpHandler.handleBatch([], context);
      expect(responses).toEqual([]);
    });

    it('should handle single request in batch', async () => {
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      };

      const responses = await mcpHandler.handleBatch([request], context);

      expect(responses).toHaveLength(1);
      expect(responses[0]?.id).toBe(1);
      expect('result' in (responses[0] || {})).toBe(true);
    });

    it('should handle multiple requests in batch', async () => {
      const requests: JsonRpcRequest[] = [
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {},
        },
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        },
      ];

      const responses = await mcpHandler.handleBatch(requests, context);

      expect(responses).toHaveLength(2);
      expect(responses[0]?.id).toBe(1);
      expect(responses[1]?.id).toBe(2);
    });

    it('should continue on error (partial failure)', async () => {
      const requests: JsonRpcRequest[] = [
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {},
        },
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'invalid-method',
          params: {},
        },
        {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/list',
          params: {},
        },
      ];

      const responses = await mcpHandler.handleBatch(requests, context);

      expect(responses).toHaveLength(3);

      // First request should succeed
      expect('result' in (responses[0] || {})).toBe(true);

      // Second request should fail
      expect('error' in (responses[1] || {})).toBe(true);
      if (responses[1] && 'error' in responses[1]) {
        expect(responses[1].error.code).toBe(ErrorCode.METHOD_NOT_FOUND);
      }

      // Third request should still succeed despite second failure
      expect('result' in (responses[2] || {})).toBe(true);
    });

    it('should enforce batch size limit', async () => {
      const requests: JsonRpcRequest[] = Array.from({ length: 101 }, (_, i) => ({
        jsonrpc: '2.0' as const,
        id: i,
        method: 'tools/list',
        params: {},
      }));

      await expect(mcpHandler.handleBatch(requests, context)).rejects.toThrow('exceeds maximum');
    });

    it('should create unique correlation IDs for each request', async () => {
      const requests: JsonRpcRequest[] = [
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'invalid-method',
          params: {},
        },
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'invalid-method',
          params: {},
        },
      ];

      const responses = await mcpHandler.handleBatch(requests, context);

      expect(responses).toHaveLength(2);

      // Both should be errors
      expect('error' in (responses[0] || {})).toBe(true);
      expect('error' in (responses[1] || {})).toBe(true);

      // Check correlation IDs are different
      if (responses[0] && 'error' in responses[0] && responses[1] && 'error' in responses[1]) {
        const corr1 = responses[0].error.data?.correlationId;
        const corr2 = responses[1].error.data?.correlationId;

        expect(corr1).toBeDefined();
        expect(corr2).toBeDefined();
        expect(corr1).not.toBe(corr2);
      }
    });
  });

  describe('handleRequest', () => {
    beforeEach(async () => {
      await mcpHandler.initialize(
        {
          protocolVersion: '2024-11-05',
          clientInfo: { name: 'test-client', version: '1.0.0' },
        },
        context
      );
    });

    it('should route initialize method', async () => {
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          clientInfo: { name: 'test', version: '1.0' },
        },
      };

      const response = await mcpHandler.handleRequest(request, context);

      expect('result' in response).toBe(true);
      if ('result' in response) {
        expect(response.result).toHaveProperty('protocolVersion');
        expect(response.result).toHaveProperty('serverInfo');
      }
    });

    it('should route tools/list method', async () => {
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      };

      const response = await mcpHandler.handleRequest(request, context);

      expect('result' in response).toBe(true);
      if ('result' in response) {
        expect(response.result).toHaveProperty('tools');
      }
    });

    it('should route tools/call method', async () => {
      vi.spyOn(toolRouter, 'callTool').mockResolvedValue({ success: true });

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'test-tool',
          arguments: {},
        },
      };

      const response = await mcpHandler.handleRequest(request, context);

      expect('result' in response).toBe(true);
    });

    it('should return error for unknown method', async () => {
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'unknown-method',
        params: {},
      };

      const response = await mcpHandler.handleRequest(request, context);

      expect('error' in response).toBe(true);
      if ('error' in response) {
        expect(response.error.code).toBe(ErrorCode.METHOD_NOT_FOUND);
        expect(response.error.message).toContain('unknown-method');
      }
    });

    it('should include correlation ID in error responses', async () => {
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'unknown-method',
        params: {},
      };

      const response = await mcpHandler.handleRequest(request, context);

      expect('error' in response).toBe(true);
      if ('error' in response) {
        expect(response.error.data).toHaveProperty('correlationId');
        expect(response.error.data?.correlationId).toBe(context.correlationId);
      }
    });
  });
});
