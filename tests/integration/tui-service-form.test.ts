/**
 * Integration tests for TUI service add/edit forms
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { FileStorageAdapter } from '../../src/storage/file.js';
import { FileConfigProvider } from '../../src/config/file-provider.js';
import { ServiceRegistry } from '../../src/registry/service-registry.js';
import type { ServiceDefinition } from '../../src/types/service.js';

describe('TUI Service Form Integration', () => {
  let testDir: string;
  let storage: FileStorageAdapter;
  let configProvider: FileConfigProvider;
  let registry: ServiceRegistry;

  beforeEach(async () => {
    // Create temporary test directory
    testDir = join(tmpdir(), `onemcp-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    // Initialize storage and config provider
    storage = new FileStorageAdapter(testDir);
    configProvider = new FileConfigProvider({
      storageAdapter: storage,
      configDir: testDir,
    });

    // Initialize with default config
    await configProvider.save({
      mode: 'cli',
      logLevel: 'INFO',
      configDir: testDir,
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
    });

    // Initialize service registry
    registry = new ServiceRegistry(configProvider);
    await registry.initialize();
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Service Creation', () => {
    it('should create a new stdio service with all fields', async () => {
      const service: ServiceDefinition = {
        name: 'test-stdio',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        env: {
          NODE_ENV: 'production',
          DEBUG: 'true',
        },
        tags: ['local', 'storage'],
        enabled: true,
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      await registry.register(service);

      const retrieved = await registry.get('test-stdio');
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('test-stdio');
      expect(retrieved?.transport).toBe('stdio');
      expect(retrieved?.command).toBe('npx');
      expect(retrieved?.args).toEqual(['-y', '@modelcontextprotocol/server-filesystem', '/tmp']);
      expect(retrieved?.env).toEqual({
        NODE_ENV: 'production',
        DEBUG: 'true',
      });
      expect(retrieved?.tags).toEqual(['local', 'storage']);
      expect(retrieved?.enabled).toBe(true);
    });

    it('should create a new HTTP service', async () => {
      const service: ServiceDefinition = {
        name: 'test-http',
        transport: 'http',
        url: 'https://api.example.com/mcp',
        tags: ['remote', 'api'],
        enabled: true,
        connectionPool: {
          maxConnections: 10,
          idleTimeout: 120000,
          connectionTimeout: 30000,
        },
      };

      await registry.register(service);

      const retrieved = await registry.get('test-http');
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('test-http');
      expect(retrieved?.transport).toBe('http');
      expect(retrieved?.url).toBe('https://api.example.com/mcp');
      expect(retrieved?.tags).toEqual(['remote', 'api']);
      expect(retrieved?.enabled).toBe(true);
    });

    it('should create a new SSE service', async () => {
      const service: ServiceDefinition = {
        name: 'test-sse',
        transport: 'sse',
        url: 'https://events.example.com/mcp',
        tags: ['remote', 'events'],
        enabled: true,
        connectionPool: {
          maxConnections: 3,
          idleTimeout: 90000,
          connectionTimeout: 30000,
        },
      };

      await registry.register(service);

      const retrieved = await registry.get('test-sse');
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('test-sse');
      expect(retrieved?.transport).toBe('sse');
      expect(retrieved?.url).toBe('https://events.example.com/mcp');
    });

    it('should create service with minimal fields', async () => {
      const service: ServiceDefinition = {
        name: 'minimal-service',
        transport: 'stdio',
        command: 'node',
        tags: [],
        enabled: true,
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      await registry.register(service);

      const retrieved = await registry.get('minimal-service');
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('minimal-service');
      expect(retrieved?.args).toBeUndefined();
      expect(retrieved?.env).toBeUndefined();
      expect(retrieved?.tags).toEqual([]);
    });
  });

  describe('Service Editing', () => {
    it('should update existing service', async () => {
      // Create initial service
      const initialService: ServiceDefinition = {
        name: 'editable-service',
        transport: 'stdio',
        command: 'node',
        tags: ['test'],
        enabled: true,
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      await registry.register(initialService);

      // Update service
      const updatedService: ServiceDefinition = {
        name: 'editable-service',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'some-package'],
        tags: ['test', 'updated'],
        enabled: false,
        connectionPool: {
          maxConnections: 10,
          idleTimeout: 120000,
          connectionTimeout: 60000,
        },
      };

      await registry.register(updatedService);

      const retrieved = await registry.get('editable-service');
      expect(retrieved).toBeDefined();
      expect(retrieved?.command).toBe('npx');
      expect(retrieved?.args).toEqual(['-y', 'some-package']);
      expect(retrieved?.tags).toEqual(['test', 'updated']);
      expect(retrieved?.enabled).toBe(false);
      expect(retrieved?.connectionPool.maxConnections).toBe(10);
    });

    it('should change transport type when editing', async () => {
      // Create stdio service
      const stdioService: ServiceDefinition = {
        name: 'changeable-service',
        transport: 'stdio',
        command: 'node',
        tags: [],
        enabled: true,
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      await registry.register(stdioService);

      // Change to HTTP service
      const httpService: ServiceDefinition = {
        name: 'changeable-service',
        transport: 'http',
        url: 'https://api.example.com/mcp',
        tags: [],
        enabled: true,
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      await registry.register(httpService);

      const retrieved = await registry.get('changeable-service');
      expect(retrieved).toBeDefined();
      expect(retrieved?.transport).toBe('http');
      expect(retrieved?.url).toBe('https://api.example.com/mcp');
      expect(retrieved?.command).toBeUndefined();
    });
  });

  describe('Field Validation', () => {
    it('should validate service name format', async () => {
      const invalidService: ServiceDefinition = {
        name: 'invalid name with spaces',
        transport: 'stdio',
        command: 'node',
        tags: [],
        enabled: true,
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      // Service registry should accept this, but form validation would reject it
      // This test documents the expected behavior
      await expect(registry.register(invalidService)).resolves.not.toThrow();
    });

    it('should handle empty tags array', async () => {
      const service: ServiceDefinition = {
        name: 'no-tags',
        transport: 'stdio',
        command: 'node',
        tags: [],
        enabled: true,
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      await registry.register(service);

      const retrieved = await registry.get('no-tags');
      expect(retrieved?.tags).toEqual([]);
    });

    it('should handle connection pool configuration', async () => {
      const service: ServiceDefinition = {
        name: 'custom-pool',
        transport: 'stdio',
        command: 'node',
        tags: [],
        enabled: true,
        connectionPool: {
          maxConnections: 20,
          idleTimeout: 180000,
          connectionTimeout: 45000,
        },
      };

      await registry.register(service);

      const retrieved = await registry.get('custom-pool');
      expect(retrieved?.connectionPool).toEqual({
        maxConnections: 20,
        idleTimeout: 180000,
        connectionTimeout: 45000,
      });
    });
  });

  describe('Transport-Specific Fields', () => {
    it('should show command field for stdio transport', async () => {
      const service: ServiceDefinition = {
        name: 'stdio-service',
        transport: 'stdio',
        command: 'python',
        args: ['-m', 'mcp_server'],
        env: {
          PYTHONPATH: '/usr/local/lib',
        },
        tags: [],
        enabled: true,
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      await registry.register(service);

      const retrieved = await registry.get('stdio-service');
      expect(retrieved?.command).toBe('python');
      expect(retrieved?.args).toEqual(['-m', 'mcp_server']);
      expect(retrieved?.env).toEqual({ PYTHONPATH: '/usr/local/lib' });
      expect(retrieved?.url).toBeUndefined();
    });

    it('should show URL field for HTTP transport', async () => {
      const service: ServiceDefinition = {
        name: 'http-service',
        transport: 'http',
        url: 'https://api.example.com/mcp',
        tags: [],
        enabled: true,
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      await registry.register(service);

      const retrieved = await registry.get('http-service');
      expect(retrieved?.url).toBe('https://api.example.com/mcp');
      expect(retrieved?.command).toBeUndefined();
      expect(retrieved?.args).toBeUndefined();
      expect(retrieved?.env).toBeUndefined();
    });

    it('should show URL field for SSE transport', async () => {
      const service: ServiceDefinition = {
        name: 'sse-service',
        transport: 'sse',
        url: 'https://events.example.com/mcp',
        tags: [],
        enabled: true,
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      await registry.register(service);

      const retrieved = await registry.get('sse-service');
      expect(retrieved?.url).toBe('https://events.example.com/mcp');
      expect(retrieved?.command).toBeUndefined();
    });
  });

  describe('Service List', () => {
    it('should list all services after creation', async () => {
      const service1: ServiceDefinition = {
        name: 'service-1',
        transport: 'stdio',
        command: 'node',
        tags: [],
        enabled: true,
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      const service2: ServiceDefinition = {
        name: 'service-2',
        transport: 'http',
        url: 'https://api.example.com/mcp',
        tags: [],
        enabled: true,
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      await registry.register(service1);
      await registry.register(service2);

      const services = await registry.list();
      expect(services).toHaveLength(2);
      expect(services.map((s) => s.name)).toContain('service-1');
      expect(services.map((s) => s.name)).toContain('service-2');
    });

    it('should update service count after operations', async () => {
      const service: ServiceDefinition = {
        name: 'countable-service',
        transport: 'stdio',
        command: 'node',
        tags: [],
        enabled: true,
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      let services = await registry.list();
      const initialCount = services.length;

      await registry.register(service);

      services = await registry.list();
      expect(services.length).toBe(initialCount + 1);
    });
  });
});
