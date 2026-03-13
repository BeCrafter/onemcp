/**
 * Service Deletion Integration Test
 *
 * Verifies that service deletion properly syncs to configuration file
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ServiceRegistry } from '../../src/registry/service-registry.js';
import { FileConfigProvider } from '../../src/config/file-provider.js';
import { FileStorageAdapter } from '../../src/storage/file.js';
import type { SystemConfig } from '../../src/types/config.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Service Deletion Integration', () => {
  let tempDir: string;
  let storage: FileStorageAdapter;
  let provider: FileConfigProvider;
  let registry: ServiceRegistry;

  beforeEach(async () => {
    // Create temporary directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onemcp-delete-test-'));

    // Initialize components
    storage = new FileStorageAdapter(tempDir);
    provider = new FileConfigProvider({
      storageAdapter: storage,
      configDir: tempDir,
    });

    // Create initial configuration with two services
    const config: SystemConfig = {
      mode: 'server',
      port: 3000,
      logLevel: 'INFO',
      configDir: tempDir,
      mcpServers: {
        'test-service-1': {
          enabled: true,
          tags: ['test'],
          transport: 'stdio',
          command: 'node',
          connectionPool: {
            maxConnections: 5,
            idleTimeout: 60000,
            connectionTimeout: 30000,
          },
        },
        'test-service-2': {
          enabled: true,
          tags: ['test'],
          transport: 'stdio',
          command: 'node',
          connectionPool: {
            maxConnections: 5,
            idleTimeout: 60000,
            connectionTimeout: 30000,
          },
        },
      },
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

  it('should delete service from registry and persist to config file', async () => {
    // Verify initial state
    const initialServices = await registry.list();
    expect(initialServices).toHaveLength(2);
    expect(initialServices.map((s) => s.name)).toContain('test-service-1');
    expect(initialServices.map((s) => s.name)).toContain('test-service-2');

    // Delete service
    await registry.unregister('test-service-1');

    // Verify service removed from registry
    const servicesAfterDelete = await registry.list();
    expect(servicesAfterDelete).toHaveLength(1);
    expect(servicesAfterDelete[0]?.name).toBe('test-service-2');

    // Verify service removed from config file
    const savedConfig = await provider.load();
    expect(Object.keys(savedConfig.mcpServers)).toHaveLength(1);
    expect(Object.keys(savedConfig.mcpServers)[0]).toBe('test-service-2');
  });

  it('should delete multiple services sequentially', async () => {
    // Delete first service
    await registry.unregister('test-service-1');

    let services = await registry.list();
    expect(services).toHaveLength(1);
    expect(services[0]?.name).toBe('test-service-2');

    // Delete second service
    await registry.unregister('test-service-2');

    services = await registry.list();
    expect(services).toHaveLength(0);

    // Verify config file is empty
    const savedConfig = await provider.load();
    expect(Object.keys(savedConfig.mcpServers)).toHaveLength(0);
  });

  it('should handle deleting non-existent service gracefully', async () => {
    // Delete non-existent service (should not throw)
    await registry.unregister('non-existent-service');

    // Verify original services still exist
    const services = await registry.list();
    expect(services).toHaveLength(2);

    const savedConfig = await provider.load();
    expect(Object.keys(savedConfig.mcpServers)).toHaveLength(2);
  });

  it('should emit serviceUnregistered event on deletion', async () => {
    let eventEmitted = false;
    let emittedServiceName = '';

    registry.on('serviceUnregistered', (serviceName: string) => {
      eventEmitted = true;
      emittedServiceName = serviceName;
    });

    await registry.unregister('test-service-1');

    expect(eventEmitted).toBe(true);
    expect(emittedServiceName).toBe('test-service-1');
  });
});
