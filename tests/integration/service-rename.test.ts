/**
 * Service Rename Integration Test
 *
 * Verifies that renaming a service properly replaces the old service
 * instead of creating a duplicate
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ServiceRegistry } from '../../src/registry/service-registry.js';
import { FileConfigProvider } from '../../src/config/file-provider.js';
import { FileStorageAdapter } from '../../src/storage/file.js';
import type { SystemConfig, ServiceDefinition } from '../../src/types/index.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Service Rename Integration', () => {
  let tempDir: string;
  let storage: FileStorageAdapter;
  let provider: FileConfigProvider;
  let registry: ServiceRegistry;
  let originalService: ServiceDefinition;

  beforeEach(async () => {
    // Create temporary directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onemcp-rename-test-'));

    // Initialize components
    storage = new FileStorageAdapter(tempDir);
    provider = new FileConfigProvider({
      storageAdapter: storage,
      configDir: tempDir,
    });

    // Define original service
    originalService = {
      name: 'original-service',
      enabled: true,
      tags: ['test', 'original'],
      transport: 'stdio',
      command: 'node',
      args: ['--version'],
      connectionPool: {
        maxConnections: 5,
        idleTimeout: 60000,
        connectionTimeout: 30000,
      },
      toolStates: {
        tool1: true,
        tool2: false,
      },
    };

    // Create initial configuration with one service
    const config: SystemConfig = {
      mode: 'server',
      port: 3000,
      logLevel: 'INFO',
      configDir: tempDir,
      mcpServers: [originalService],
      connectionPool: {
        maxConnections: 10,
        idleTimeout: 60000,
        connectionTimeout: 30000,
      },
      healthCheck: {
        enabled: true,
        interval: 30000,
        failureThreshold: 3,
        autoUnload: false,
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
      logging: {
        level: 'INFO',
        outputs: ['console'],
        format: 'json',
      },
      metrics: {
        enabled: false,
        collectionInterval: 60000,
        retentionPeriod: 86400000,
      },
    };

    await provider.save(config);

    // Initialize registry
    registry = new ServiceRegistry(provider);
    await registry.initialize();
  });

  afterEach(() => {
    // Cleanup temporary directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should rename service by deleting old and creating new', async () => {
    // Verify initial state
    const initialServices = await registry.list();
    expect(initialServices).toHaveLength(1);
    expect(initialServices[0]?.name).toBe('original-service');

    // Simulate rename: unregister old, register new
    const renamedService: ServiceDefinition = {
      ...originalService,
      name: 'renamed-service',
    };

    await registry.unregister('original-service');
    await registry.register(renamedService);

    // Verify only one service exists with new name
    const servicesAfterRename = await registry.list();
    expect(servicesAfterRename).toHaveLength(1);
    expect(servicesAfterRename[0]?.name).toBe('renamed-service');

    // Verify old service is gone
    const oldService = await registry.get('original-service');
    expect(oldService).toBeNull();

    // Verify new service exists
    const newService = await registry.get('renamed-service');
    expect(newService).not.toBeNull();
    expect(newService?.name).toBe('renamed-service');

    // Verify config file has only one service
    const savedConfig = await provider.load();
    expect(savedConfig.mcpServers).toHaveLength(1);
    expect(savedConfig.mcpServers[0]?.name).toBe('renamed-service');
  });

  it('should preserve all service properties during rename', async () => {
    // Rename service
    const renamedService: ServiceDefinition = {
      ...originalService,
      name: 'renamed-service',
    };

    await registry.unregister('original-service');
    await registry.register(renamedService);

    // Verify all properties are preserved
    const service = await registry.get('renamed-service');
    expect(service).not.toBeNull();
    expect(service?.enabled).toBe(originalService.enabled);
    expect(service?.tags).toEqual(originalService.tags);
    expect(service?.transport).toBe(originalService.transport);
    expect(service?.command).toBe(originalService.command);
    expect(service?.args).toEqual(originalService.args);
    expect(service?.toolStates).toEqual(originalService.toolStates);
    expect(service?.connectionPool).toEqual(originalService.connectionPool);
  });

  it('should not create duplicate when renaming', async () => {
    // Rename service
    const renamedService: ServiceDefinition = {
      ...originalService,
      name: 'renamed-service',
    };

    await registry.unregister('original-service');
    await registry.register(renamedService);

    // Verify total count is still 1
    const services = await registry.list();
    expect(services).toHaveLength(1);

    // Verify config file has only 1 service
    const savedConfig = await provider.load();
    expect(savedConfig.mcpServers).toHaveLength(1);
  });

  it('should handle rename with multiple services', async () => {
    // Add another service
    const anotherService: ServiceDefinition = {
      name: 'another-service',
      enabled: true,
      tags: ['test'],
      transport: 'stdio',
      command: 'node',
      connectionPool: {
        maxConnections: 5,
        idleTimeout: 60000,
        connectionTimeout: 30000,
      },
    };

    await registry.register(anotherService);

    // Verify we have 2 services
    let services = await registry.list();
    expect(services).toHaveLength(2);

    // Rename original service
    const renamedService: ServiceDefinition = {
      ...originalService,
      name: 'renamed-service',
    };

    await registry.unregister('original-service');
    await registry.register(renamedService);

    // Verify we still have 2 services
    services = await registry.list();
    expect(services).toHaveLength(2);

    // Verify service names
    const serviceNames = services.map((s) => s.name).sort();
    expect(serviceNames).toEqual(['another-service', 'renamed-service']);

    // Verify config file
    const savedConfig = await provider.load();
    expect(savedConfig.mcpServers).toHaveLength(2);
    const configNames = savedConfig.mcpServers.map((s) => s.name).sort();
    expect(configNames).toEqual(['another-service', 'renamed-service']);
  });

  it('should emit events during rename', async () => {
    const events: string[] = [];

    registry.on('serviceUnregistered', (serviceName: string) => {
      events.push(`unregistered:${serviceName}`);
    });

    registry.on('serviceRegistered', (serviceName: string) => {
      events.push(`registered:${serviceName}`);
    });

    // Rename service
    const renamedService: ServiceDefinition = {
      ...originalService,
      name: 'renamed-service',
    };

    await registry.unregister('original-service');
    await registry.register(renamedService);

    // Verify events were emitted in correct order
    expect(events).toEqual(['unregistered:original-service', 'registered:renamed-service']);
  });
});
