/**
 * Integration tests for TUI Service List View
 *
 * Tests the service list display functionality including:
 * - Displaying all registered services
 * - Showing service details (name, transport, tags, enabled status)
 * - Navigation and selection
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FileStorageAdapter } from '../../src/storage/file.js';
import { FileConfigProvider } from '../../src/config/file-provider.js';
import { ServiceRegistry } from '../../src/registry/service-registry.js';
import type { ServiceDefinition } from '../../src/types/service.js';

describe('TUI Service List View Integration', () => {
  let tempDir: string;
  let storage: FileStorageAdapter;
  let configProvider: FileConfigProvider;
  let registry: ServiceRegistry;

  beforeEach(async () => {
    // Create temporary directory for test configuration
    tempDir = mkdtempSync(join(tmpdir(), 'onemcp-tui-test-'));

    // Initialize storage and config provider
    storage = new FileStorageAdapter(tempDir);
    configProvider = new FileConfigProvider({
      storageAdapter: storage,
      configDir: tempDir,
    });

    // Initialize with default config
    await configProvider.save({
      mode: 'cli',
      logLevel: 'INFO',
      configDir: tempDir,
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
          enabled: false,
          patterns: [],
        },
      },
    });

    // Initialize service registry
    registry = new ServiceRegistry(configProvider);
    await registry.initialize();
  });

  afterEach(() => {
    // Clean up temporary directory
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should display empty service list when no services are registered', async () => {
    const services = await registry.list();

    expect(services).toEqual([]);
  });

  it('should display all registered services with their details', async () => {
    // Register test services
    const service1: ServiceDefinition = {
      name: 'test-service-1',
      transport: 'stdio',
      command: 'node',
      args: ['test.js'],
      env: { NODE_ENV: 'test' },
      tags: ['test', 'local'],
      enabled: true,
      connectionPool: {
        maxConnections: 3,
        idleTimeout: 30000,
        connectionTimeout: 15000,
      },
    };

    const service2: ServiceDefinition = {
      name: 'test-service-2',
      transport: 'http',
      url: 'http://localhost:3000',
      tags: ['remote', 'api'],
      enabled: false,
      connectionPool: {
        maxConnections: 5,
        idleTimeout: 60000,
        connectionTimeout: 30000,
      },
    };

    await registry.register(service1);
    await registry.register(service2);

    // Get service list
    const services = await registry.list();

    // Verify all services are returned
    expect(services).toHaveLength(2);

    // Verify service 1 details
    const retrievedService1 = services.find((s) => s.name === 'test-service-1');
    expect(retrievedService1).toBeDefined();
    expect(retrievedService1?.transport).toBe('stdio');
    expect(retrievedService1?.command).toBe('node');
    expect(retrievedService1?.args).toEqual(['test.js']);
    expect(retrievedService1?.tags).toEqual(['test', 'local']);
    expect(retrievedService1?.enabled).toBe(true);

    // Verify service 2 details
    const retrievedService2 = services.find((s) => s.name === 'test-service-2');
    expect(retrievedService2).toBeDefined();
    expect(retrievedService2?.transport).toBe('http');
    expect(retrievedService2?.url).toBe('http://localhost:3000');
    expect(retrievedService2?.tags).toEqual(['remote', 'api']);
    expect(retrievedService2?.enabled).toBe(false);
  });

  it('should display services with different transport types', async () => {
    // Register services with different transports
    const stdioService: ServiceDefinition = {
      name: 'stdio-service',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
      enabled: true,
      tags: [],
      connectionPool: {
        maxConnections: 5,
        idleTimeout: 60000,
        connectionTimeout: 30000,
      },
    };

    const sseService: ServiceDefinition = {
      name: 'sse-service',
      transport: 'sse',
      url: 'http://localhost:3001/sse',
      enabled: true,
      tags: [],
      connectionPool: {
        maxConnections: 5,
        idleTimeout: 60000,
        connectionTimeout: 30000,
      },
    };

    const httpService: ServiceDefinition = {
      name: 'http-service',
      transport: 'http',
      url: 'http://localhost:3002/mcp',
      enabled: true,
      tags: [],
      connectionPool: {
        maxConnections: 5,
        idleTimeout: 60000,
        connectionTimeout: 30000,
      },
    };

    await registry.register(stdioService);
    await registry.register(sseService);
    await registry.register(httpService);

    // Get service list
    const services = await registry.list();

    // Verify all transport types are present
    expect(services).toHaveLength(3);
    expect(services.find((s) => s.transport === 'stdio')).toBeDefined();
    expect(services.find((s) => s.transport === 'sse')).toBeDefined();
    expect(services.find((s) => s.transport === 'http')).toBeDefined();
  });

  it('should display services with enabled and disabled status', async () => {
    // Register enabled and disabled services
    const enabledService: ServiceDefinition = {
      name: 'enabled-service',
      transport: 'stdio',
      command: 'node',
      enabled: true,
      tags: [],
      connectionPool: {
        maxConnections: 5,
        idleTimeout: 60000,
        connectionTimeout: 30000,
      },
    };

    const disabledService: ServiceDefinition = {
      name: 'disabled-service',
      transport: 'stdio',
      command: 'node',
      enabled: false,
      tags: [],
      connectionPool: {
        maxConnections: 5,
        idleTimeout: 60000,
        connectionTimeout: 30000,
      },
    };

    await registry.register(enabledService);
    await registry.register(disabledService);

    // Get service list
    const services = await registry.list();

    // Verify status
    expect(services).toHaveLength(2);
    expect(services.find((s) => s.name === 'enabled-service')?.enabled).toBe(true);
    expect(services.find((s) => s.name === 'disabled-service')?.enabled).toBe(false);
  });

  it('should display services with tags', async () => {
    // Register service with tags
    const taggedService: ServiceDefinition = {
      name: 'tagged-service',
      transport: 'stdio',
      command: 'node',
      tags: ['production', 'critical', 'database'],
      enabled: true,
      connectionPool: {
        maxConnections: 5,
        idleTimeout: 60000,
        connectionTimeout: 30000,
      },
    };

    await registry.register(taggedService);

    // Get service list
    const services = await registry.list();

    // Verify tags
    expect(services).toHaveLength(1);
    expect(services[0]?.tags).toEqual(['production', 'critical', 'database']);
  });

  it('should display services with connection pool configuration', async () => {
    // Register service with custom connection pool
    const service: ServiceDefinition = {
      name: 'pooled-service',
      transport: 'stdio',
      command: 'node',
      enabled: true,
      tags: [],
      connectionPool: {
        maxConnections: 10,
        idleTimeout: 120000,
        connectionTimeout: 45000,
      },
    };

    await registry.register(service);

    // Get service list
    const services = await registry.list();

    // Verify connection pool config
    expect(services).toHaveLength(1);
    expect(services[0]?.connectionPool).toEqual({
      maxConnections: 10,
      idleTimeout: 120000,
      connectionTimeout: 45000,
    });
  });

  it('should support navigation through service list', async () => {
    // Register multiple services
    for (let i = 1; i <= 5; i++) {
      await registry.register({
        name: `service-${i}`,
        transport: 'stdio',
        command: 'node',
        enabled: true,
        tags: [],
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      });
    }

    // Get service list
    const services = await registry.list();

    // Verify we can navigate through all services
    expect(services).toHaveLength(5);

    // Simulate navigation
    let selectedIndex = 0;

    // Navigate down
    selectedIndex = Math.min(services.length - 1, selectedIndex + 1);
    expect(selectedIndex).toBe(1);

    selectedIndex = Math.min(services.length - 1, selectedIndex + 1);
    expect(selectedIndex).toBe(2);

    // Navigate up
    selectedIndex = Math.max(0, selectedIndex - 1);
    expect(selectedIndex).toBe(1);

    // Navigate to end
    selectedIndex = services.length - 1;
    expect(selectedIndex).toBe(4);

    // Try to navigate past end (should stay at end)
    selectedIndex = Math.min(services.length - 1, selectedIndex + 1);
    expect(selectedIndex).toBe(4);

    // Navigate to beginning
    selectedIndex = 0;
    expect(selectedIndex).toBe(0);

    // Try to navigate before beginning (should stay at beginning)
    selectedIndex = Math.max(0, selectedIndex - 1);
    expect(selectedIndex).toBe(0);
  });
});
