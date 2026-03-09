/**
 * Unit tests for HealthMonitor
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HealthMonitor } from '../../../src/health/health-monitor.js';
import { ServiceRegistry } from '../../../src/registry/service-registry.js';
import { ConnectionPool } from '../../../src/pool/connection-pool.js';
import { MemoryStorageAdapter } from '../../../src/storage/memory.js';
import { FileConfigProvider } from '../../../src/config/file-provider.js';
import type { ServiceDefinition } from '../../../src/types/service.js';
import type { Connection } from '../../../src/pool/connection.js';

describe('HealthMonitor', () => {
  let healthMonitor: HealthMonitor;
  let serviceRegistry: ServiceRegistry;
  let storage: MemoryStorageAdapter;
  let configProvider: FileConfigProvider;

  beforeEach(async () => {
    storage = new MemoryStorageAdapter();

    // Initialize storage with default config
    const defaultConfig = {
      mode: 'cli' as const,
      logLevel: 'INFO' as const,
      configDir: '/test/config',
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
        level: 'standard' as const,
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
    };

    // Write to the full path that FileConfigProvider expects
    await storage.write('/test/config/config.json', JSON.stringify(defaultConfig));

    configProvider = new FileConfigProvider({
      storageAdapter: storage,
      configDir: '/test/config',
    });
    serviceRegistry = new ServiceRegistry(configProvider);
    await serviceRegistry.initialize();
    healthMonitor = new HealthMonitor(serviceRegistry);
  });

  describe('registerConnectionPool', () => {
    it('should register a connection pool for a service', async () => {
      const service: ServiceDefinition = {
        name: 'test-service',
        enabled: true,
        tags: [],
        transport: 'stdio',
        command: 'node',
        args: ['test.js'],
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      const pool = new ConnectionPool(service, service.connectionPool);
      const mockConnection: Connection = {
        id: 'test-conn-1',
        transport: {
          send: vi.fn(),
          receive: vi.fn(),
          close: vi.fn(),
          getType: () => 'stdio',
        } as any,
        state: 'idle',
        lastUsed: new Date(),
        createdAt: new Date(),
      };

      vi.spyOn(pool, 'acquire').mockResolvedValue(mockConnection);
      vi.spyOn(pool, 'isConnectionHealthy').mockReturnValue(true);
      vi.spyOn(pool, 'release').mockImplementation(() => {});

      const status = await healthMonitor.registerConnectionPool('test-service', pool);

      // Should return initial health status
      expect(status).toBeDefined();
      expect(status.serviceName).toBe('test-service');
      expect(status.healthy).toBe(true);
    });

    it('should perform initial health check on registration (Requirement 20.9)', async () => {
      const service: ServiceDefinition = {
        name: 'test-service',
        enabled: true,
        tags: [],
        transport: 'stdio',
        command: 'node',
        args: ['test.js'],
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      const pool = new ConnectionPool(service, service.connectionPool);
      const mockConnection: Connection = {
        id: 'test-conn-1',
        transport: {
          send: vi.fn(),
          receive: vi.fn(),
          close: vi.fn(),
          getType: () => 'stdio',
        } as any,
        state: 'idle',
        lastUsed: new Date(),
        createdAt: new Date(),
      };

      const acquireSpy = vi.spyOn(pool, 'acquire').mockResolvedValue(mockConnection);
      vi.spyOn(pool, 'isConnectionHealthy').mockReturnValue(true);
      vi.spyOn(pool, 'release').mockImplementation(() => {});

      await healthMonitor.registerConnectionPool('test-service', pool);

      // Verify that health check was performed during registration
      expect(acquireSpy).toHaveBeenCalled();

      // Verify health status is available immediately
      const status = healthMonitor.getHealthStatus('test-service');
      expect(status).toBeDefined();
      expect(status?.healthy).toBe(true);
    });

    it('should emit serviceHealthy event when initial health check passes', async () => {
      const service: ServiceDefinition = {
        name: 'test-service',
        enabled: true,
        tags: [],
        transport: 'stdio',
        command: 'node',
        args: ['test.js'],
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      const pool = new ConnectionPool(service, service.connectionPool);
      const mockConnection: Connection = {
        id: 'test-conn-1',
        transport: {
          send: vi.fn(),
          receive: vi.fn(),
          close: vi.fn(),
          getType: () => 'stdio',
        } as any,
        state: 'idle',
        lastUsed: new Date(),
        createdAt: new Date(),
      };

      vi.spyOn(pool, 'acquire').mockResolvedValue(mockConnection);
      vi.spyOn(pool, 'isConnectionHealthy').mockReturnValue(true);
      vi.spyOn(pool, 'release').mockImplementation(() => {});

      const serviceHealthySpy = vi.fn();
      healthMonitor.on('serviceHealthy', serviceHealthySpy);

      await healthMonitor.registerConnectionPool('test-service', pool);

      expect(serviceHealthySpy).toHaveBeenCalledTimes(1);
      expect(serviceHealthySpy).toHaveBeenCalledWith(
        'test-service',
        expect.objectContaining({
          serviceName: 'test-service',
          healthy: true,
        })
      );
    });

    it('should emit serviceUnhealthy event when initial health check fails', async () => {
      const service: ServiceDefinition = {
        name: 'test-service',
        enabled: true,
        tags: [],
        transport: 'stdio',
        command: 'node',
        args: ['test.js'],
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      const pool = new ConnectionPool(service, service.connectionPool);
      vi.spyOn(pool, 'acquire').mockRejectedValue(new Error('Connection failed'));

      const serviceUnhealthySpy = vi.fn();
      healthMonitor.on('serviceUnhealthy', serviceUnhealthySpy);

      const status = await healthMonitor.registerConnectionPool('test-service', pool);

      expect(status.healthy).toBe(false);
      expect(serviceUnhealthySpy).toHaveBeenCalledTimes(1);
      expect(serviceUnhealthySpy).toHaveBeenCalledWith(
        'test-service',
        expect.objectContaining({
          serviceName: 'test-service',
          healthy: false,
        })
      );
    });

    it('should return unhealthy status when initial health check fails', async () => {
      const service: ServiceDefinition = {
        name: 'test-service',
        enabled: true,
        tags: [],
        transport: 'stdio',
        command: 'node',
        args: ['test.js'],
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      const pool = new ConnectionPool(service, service.connectionPool);
      vi.spyOn(pool, 'acquire').mockRejectedValue(new Error('Connection failed'));

      const status = await healthMonitor.registerConnectionPool('test-service', pool);

      expect(status.serviceName).toBe('test-service');
      expect(status.healthy).toBe(false);
      expect(status.consecutiveFailures).toBe(1);
      expect(status.error).toBeDefined();
      expect(status.error?.message).toBe('Connection failed');
    });
  });

  describe('unregisterConnectionPool', () => {
    it('should unregister a connection pool and clear health status', async () => {
      const service: ServiceDefinition = {
        name: 'test-service',
        enabled: true,
        tags: [],
        transport: 'stdio',
        command: 'node',
        args: ['test.js'],
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      const pool = new ConnectionPool(service, service.connectionPool);
      healthMonitor.registerConnectionPool('test-service', pool);

      // Check health to create status
      await healthMonitor.checkHealth('test-service');

      // Unregister
      healthMonitor.unregisterConnectionPool('test-service');

      // Verify status is cleared
      const status = healthMonitor.getHealthStatus('test-service');
      expect(status).toBeUndefined();
    });
  });

  describe('checkHealth', () => {
    it('should return unhealthy status for unregistered service', async () => {
      const status = await healthMonitor.checkHealth('unknown-service');

      expect(status.serviceName).toBe('unknown-service');
      expect(status.healthy).toBe(false);
      expect(status.consecutiveFailures).toBe(0);
      expect(status.error).toBeDefined();
      expect(status.error?.code).toBe('NOT_REGISTERED');
    });

    it('should return healthy status when connection succeeds', async () => {
      const service: ServiceDefinition = {
        name: 'test-service',
        enabled: true,
        tags: [],
        transport: 'stdio',
        command: 'node',
        args: ['test.js'],
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      // Create a mock pool
      const pool = new ConnectionPool(service, service.connectionPool);

      // Mock acquire to return a healthy connection
      const mockConnection: Connection = {
        id: 'test-conn-1',
        transport: {
          send: vi.fn(),
          receive: vi.fn(),
          close: vi.fn(),
          getType: () => 'stdio',
        } as any,
        state: 'idle',
        lastUsed: new Date(),
        createdAt: new Date(),
      };

      vi.spyOn(pool, 'acquire').mockResolvedValue(mockConnection);
      vi.spyOn(pool, 'isConnectionHealthy').mockReturnValue(true);
      vi.spyOn(pool, 'release').mockImplementation(() => {});

      healthMonitor.registerConnectionPool('test-service', pool);

      const status = await healthMonitor.checkHealth('test-service');

      expect(status.serviceName).toBe('test-service');
      expect(status.healthy).toBe(true);
      expect(status.consecutiveFailures).toBe(0);
      expect(status.error).toBeUndefined();
      expect(status.lastCheck).toBeInstanceOf(Date);
    });

    it('should return unhealthy status when connection fails', async () => {
      const service: ServiceDefinition = {
        name: 'test-service',
        enabled: true,
        tags: [],
        transport: 'stdio',
        command: 'node',
        args: ['test.js'],
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      const pool = new ConnectionPool(service, service.connectionPool);

      // Mock acquire to fail
      vi.spyOn(pool, 'acquire').mockRejectedValue(new Error('Connection failed'));

      healthMonitor.registerConnectionPool('test-service', pool);

      const status = await healthMonitor.checkHealth('test-service');

      expect(status.serviceName).toBe('test-service');
      expect(status.healthy).toBe(false);
      expect(status.consecutiveFailures).toBe(1);
      expect(status.error).toBeDefined();
      expect(status.error?.message).toBe('Connection failed');
      expect(status.error?.code).toBe('HEALTH_CHECK_FAILED');
    });

    it('should increment consecutive failures on repeated failures', async () => {
      const service: ServiceDefinition = {
        name: 'test-service',
        enabled: true,
        tags: [],
        transport: 'stdio',
        command: 'node',
        args: ['test.js'],
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      const pool = new ConnectionPool(service, service.connectionPool);
      vi.spyOn(pool, 'acquire').mockRejectedValue(new Error('Connection failed'));

      healthMonitor.registerConnectionPool('test-service', pool);

      // First failure
      const status1 = await healthMonitor.checkHealth('test-service');
      expect(status1.consecutiveFailures).toBe(1);

      // Second failure
      const status2 = await healthMonitor.checkHealth('test-service');
      expect(status2.consecutiveFailures).toBe(2);

      // Third failure
      const status3 = await healthMonitor.checkHealth('test-service');
      expect(status3.consecutiveFailures).toBe(3);
    });

    it('should reset consecutive failures when service recovers', async () => {
      const service: ServiceDefinition = {
        name: 'test-service',
        enabled: true,
        tags: [],
        transport: 'stdio',
        command: 'node',
        args: ['test.js'],
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      const pool = new ConnectionPool(service, service.connectionPool);
      const mockConnection: Connection = {
        id: 'test-conn-1',
        transport: {
          send: vi.fn(),
          receive: vi.fn(),
          close: vi.fn(),
          getType: () => 'stdio',
        } as any,
        state: 'idle',
        lastUsed: new Date(),
        createdAt: new Date(),
      };

      // First fail during registration
      vi.spyOn(pool, 'acquire').mockRejectedValue(new Error('Connection failed'));
      await healthMonitor.registerConnectionPool('test-service', pool);

      // Verify initial failure
      const status1 = healthMonitor.getHealthStatus('test-service');
      expect(status1?.consecutiveFailures).toBe(1);

      // Fail again to increment
      await healthMonitor.checkHealth('test-service');
      const status2 = healthMonitor.getHealthStatus('test-service');
      expect(status2?.consecutiveFailures).toBe(2);

      // Then succeed
      vi.spyOn(pool, 'acquire').mockResolvedValue(mockConnection);
      vi.spyOn(pool, 'isConnectionHealthy').mockReturnValue(true);
      vi.spyOn(pool, 'release').mockImplementation(() => {});

      const status3 = await healthMonitor.checkHealth('test-service');
      expect(status3.healthy).toBe(true);
      expect(status3.consecutiveFailures).toBe(0);
    });

    it('should emit healthChanged event when status changes from healthy to unhealthy', async () => {
      const service: ServiceDefinition = {
        name: 'test-service',
        enabled: true,
        tags: [],
        transport: 'stdio',
        command: 'node',
        args: ['test.js'],
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      const pool = new ConnectionPool(service, service.connectionPool);
      const mockConnection: Connection = {
        id: 'test-conn-1',
        transport: {
          send: vi.fn(),
          receive: vi.fn(),
          close: vi.fn(),
          getType: () => 'stdio',
        } as any,
        state: 'idle',
        lastUsed: new Date(),
        createdAt: new Date(),
      };

      healthMonitor.registerConnectionPool('test-service', pool);

      // Start healthy
      vi.spyOn(pool, 'acquire').mockResolvedValue(mockConnection);
      vi.spyOn(pool, 'isConnectionHealthy').mockReturnValue(true);
      vi.spyOn(pool, 'release').mockImplementation(() => {});

      await healthMonitor.checkHealth('test-service');

      // Set up event listener
      const healthChangedSpy = vi.fn();
      const serviceFailedSpy = vi.fn();
      healthMonitor.on('healthChanged', healthChangedSpy);
      healthMonitor.on('serviceFailed', serviceFailedSpy);

      // Then fail
      vi.spyOn(pool, 'acquire').mockRejectedValue(new Error('Connection failed'));

      await healthMonitor.checkHealth('test-service');

      expect(healthChangedSpy).toHaveBeenCalledTimes(1);
      expect(serviceFailedSpy).toHaveBeenCalledWith('test-service');
    });

    it('should emit healthChanged event when status changes from unhealthy to healthy', async () => {
      const service: ServiceDefinition = {
        name: 'test-service',
        enabled: true,
        tags: [],
        transport: 'stdio',
        command: 'node',
        args: ['test.js'],
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      const pool = new ConnectionPool(service, service.connectionPool);
      const mockConnection: Connection = {
        id: 'test-conn-1',
        transport: {
          send: vi.fn(),
          receive: vi.fn(),
          close: vi.fn(),
          getType: () => 'stdio',
        } as any,
        state: 'idle',
        lastUsed: new Date(),
        createdAt: new Date(),
      };

      healthMonitor.registerConnectionPool('test-service', pool);

      // Start unhealthy
      vi.spyOn(pool, 'acquire').mockRejectedValue(new Error('Connection failed'));
      await healthMonitor.checkHealth('test-service');

      // Set up event listener
      const healthChangedSpy = vi.fn();
      const serviceRecoveredSpy = vi.fn();
      healthMonitor.on('healthChanged', healthChangedSpy);
      healthMonitor.on('serviceRecovered', serviceRecoveredSpy);

      // Then succeed
      vi.spyOn(pool, 'acquire').mockResolvedValue(mockConnection);
      vi.spyOn(pool, 'isConnectionHealthy').mockReturnValue(true);
      vi.spyOn(pool, 'release').mockImplementation(() => {});

      await healthMonitor.checkHealth('test-service');

      expect(healthChangedSpy).toHaveBeenCalledTimes(1);
      expect(serviceRecoveredSpy).toHaveBeenCalledWith('test-service');
    });

    it('should release connection even if health check fails', async () => {
      const service: ServiceDefinition = {
        name: 'test-service',
        enabled: true,
        tags: [],
        transport: 'stdio',
        command: 'node',
        args: ['test.js'],
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      const pool = new ConnectionPool(service, service.connectionPool);
      const mockConnection: Connection = {
        id: 'test-conn-1',
        transport: {
          send: vi.fn(),
          receive: vi.fn(),
          close: vi.fn(),
          getType: () => 'stdio',
        } as any,
        state: 'idle',
        lastUsed: new Date(),
        createdAt: new Date(),
      };

      healthMonitor.registerConnectionPool('test-service', pool);

      vi.spyOn(pool, 'acquire').mockResolvedValue(mockConnection);
      vi.spyOn(pool, 'isConnectionHealthy').mockReturnValue(false); // Unhealthy
      const releaseSpy = vi.spyOn(pool, 'release').mockImplementation(() => {});

      await healthMonitor.checkHealth('test-service');

      expect(releaseSpy).toHaveBeenCalledWith(mockConnection);
    });
  });

  describe('getAllHealthStatus', () => {
    it('should return empty array when no services checked', async () => {
      const statuses = await healthMonitor.getAllHealthStatus();
      expect(statuses).toEqual([]);
    });

    it('should return all health statuses', async () => {
      const service1: ServiceDefinition = {
        name: 'service-1',
        enabled: true,
        tags: [],
        transport: 'stdio',
        command: 'node',
        args: ['test1.js'],
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      const service2: ServiceDefinition = {
        name: 'service-2',
        enabled: true,
        tags: [],
        transport: 'stdio',
        command: 'node',
        args: ['test2.js'],
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      const pool1 = new ConnectionPool(service1, service1.connectionPool);
      const pool2 = new ConnectionPool(service2, service2.connectionPool);

      vi.spyOn(pool1, 'acquire').mockRejectedValue(new Error('Failed'));
      vi.spyOn(pool2, 'acquire').mockRejectedValue(new Error('Failed'));

      healthMonitor.registerConnectionPool('service-1', pool1);
      healthMonitor.registerConnectionPool('service-2', pool2);

      await healthMonitor.checkHealth('service-1');
      await healthMonitor.checkHealth('service-2');

      const statuses = await healthMonitor.getAllHealthStatus();
      expect(statuses).toHaveLength(2);
      expect(statuses.map((s) => s.serviceName).sort()).toEqual(['service-1', 'service-2']);
    });
  });

  describe('getHealthStatus', () => {
    it('should return undefined for unchecked service', () => {
      const status = healthMonitor.getHealthStatus('unknown-service');
      expect(status).toBeUndefined();
    });

    it('should return health status for checked service', async () => {
      const service: ServiceDefinition = {
        name: 'test-service',
        enabled: true,
        tags: [],
        transport: 'stdio',
        command: 'node',
        args: ['test.js'],
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      const pool = new ConnectionPool(service, service.connectionPool);
      vi.spyOn(pool, 'acquire').mockRejectedValue(new Error('Failed'));

      healthMonitor.registerConnectionPool('test-service', pool);
      await healthMonitor.checkHealth('test-service');

      const status = healthMonitor.getHealthStatus('test-service');
      expect(status).toBeDefined();
      expect(status?.serviceName).toBe('test-service');
    });
  });

  describe('clearHealthStatus', () => {
    it('should clear health status for a service', async () => {
      const service: ServiceDefinition = {
        name: 'test-service',
        enabled: true,
        tags: [],
        transport: 'stdio',
        command: 'node',
        args: ['test.js'],
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      const pool = new ConnectionPool(service, service.connectionPool);
      vi.spyOn(pool, 'acquire').mockRejectedValue(new Error('Failed'));

      healthMonitor.registerConnectionPool('test-service', pool);
      await healthMonitor.checkHealth('test-service');

      expect(healthMonitor.getHealthStatus('test-service')).toBeDefined();

      healthMonitor.clearHealthStatus('test-service');

      expect(healthMonitor.getHealthStatus('test-service')).toBeUndefined();
    });
  });

  describe('clearAllHealthStatuses', () => {
    it('should clear all health statuses', async () => {
      const service1: ServiceDefinition = {
        name: 'service-1',
        enabled: true,
        tags: [],
        transport: 'stdio',
        command: 'node',
        args: ['test1.js'],
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      const service2: ServiceDefinition = {
        name: 'service-2',
        enabled: true,
        tags: [],
        transport: 'stdio',
        command: 'node',
        args: ['test2.js'],
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      const pool1 = new ConnectionPool(service1, service1.connectionPool);
      const pool2 = new ConnectionPool(service2, service2.connectionPool);

      vi.spyOn(pool1, 'acquire').mockRejectedValue(new Error('Failed'));
      vi.spyOn(pool2, 'acquire').mockRejectedValue(new Error('Failed'));

      healthMonitor.registerConnectionPool('service-1', pool1);
      healthMonitor.registerConnectionPool('service-2', pool2);

      await healthMonitor.checkHealth('service-1');
      await healthMonitor.checkHealth('service-2');

      const statusesBefore = await healthMonitor.getAllHealthStatus();
      expect(statusesBefore).toHaveLength(2);

      healthMonitor.clearAllHealthStatuses();

      const statusesAfter = await healthMonitor.getAllHealthStatus();
      expect(statusesAfter).toHaveLength(0);
    });
  });

  describe('startHeartbeat', () => {
    it('should start periodic health checks', async () => {
      const service: ServiceDefinition = {
        name: 'test-service',
        enabled: true,
        tags: [],
        transport: 'stdio',
        command: 'node',
        args: ['test.js'],
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      const pool = new ConnectionPool(service, service.connectionPool);
      const mockConnection: Connection = {
        id: 'test-conn-1',
        transport: {
          send: vi.fn(),
          receive: vi.fn(),
          close: vi.fn(),
          getType: () => 'stdio',
        } as any,
        state: 'idle',
        lastUsed: new Date(),
        createdAt: new Date(),
      };

      vi.spyOn(pool, 'acquire').mockResolvedValue(mockConnection);
      vi.spyOn(pool, 'isConnectionHealthy').mockReturnValue(true);
      vi.spyOn(pool, 'release').mockImplementation(() => {});

      healthMonitor.registerConnectionPool('test-service', pool);

      // Start heartbeat with short interval for testing
      healthMonitor.startHeartbeat(100, 3);

      // Wait for at least one heartbeat cycle
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Check that health was checked
      const status = healthMonitor.getHealthStatus('test-service');
      expect(status).toBeDefined();
      expect(status?.healthy).toBe(true);

      // Clean up
      healthMonitor.stopHeartbeat();
    });

    it('should perform initial health check immediately', async () => {
      const service: ServiceDefinition = {
        name: 'test-service',
        enabled: true,
        tags: [],
        transport: 'stdio',
        command: 'node',
        args: ['test.js'],
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      const pool = new ConnectionPool(service, service.connectionPool);
      vi.spyOn(pool, 'acquire').mockRejectedValue(new Error('Failed'));

      healthMonitor.registerConnectionPool('test-service', pool);

      // Start heartbeat
      healthMonitor.startHeartbeat(10000, 3);

      // Status should be available immediately (no need to wait for interval)
      await new Promise((resolve) => setTimeout(resolve, 50));

      const status = healthMonitor.getHealthStatus('test-service');
      expect(status).toBeDefined();

      // Clean up
      healthMonitor.stopHeartbeat();
    });

    it('should emit serviceUnhealthy event when threshold is exceeded', async () => {
      const service: ServiceDefinition = {
        name: 'test-service',
        enabled: true,
        tags: [],
        transport: 'stdio',
        command: 'node',
        args: ['test.js'],
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      const pool = new ConnectionPool(service, service.connectionPool);
      vi.spyOn(pool, 'acquire').mockRejectedValue(new Error('Connection failed'));

      await healthMonitor.registerConnectionPool('test-service', pool);

      const serviceUnhealthySpy = vi.fn();
      healthMonitor.on('serviceUnhealthy', serviceUnhealthySpy);

      // Start heartbeat with threshold of 2 (registration already counted as 1 failure)
      healthMonitor.startHeartbeat(50, 2);

      // Wait for enough cycles to exceed threshold (need at least 1 more failure)
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should have emitted serviceUnhealthy event
      expect(serviceUnhealthySpy).toHaveBeenCalled();
      const lastCall = serviceUnhealthySpy.mock.calls[serviceUnhealthySpy.mock.calls.length - 1];
      const [serviceName, status] = lastCall;
      expect(serviceName).toBe('test-service');
      expect(status.consecutiveFailures).toBeGreaterThanOrEqual(2);

      // Clean up
      healthMonitor.stopHeartbeat();
    });

    it('should check multiple services in parallel', async () => {
      const service1: ServiceDefinition = {
        name: 'service-1',
        enabled: true,
        tags: [],
        transport: 'stdio',
        command: 'node',
        args: ['test1.js'],
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      const service2: ServiceDefinition = {
        name: 'service-2',
        enabled: true,
        tags: [],
        transport: 'stdio',
        command: 'node',
        args: ['test2.js'],
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      const pool1 = new ConnectionPool(service1, service1.connectionPool);
      const pool2 = new ConnectionPool(service2, service2.connectionPool);

      vi.spyOn(pool1, 'acquire').mockRejectedValue(new Error('Failed'));
      vi.spyOn(pool2, 'acquire').mockRejectedValue(new Error('Failed'));

      healthMonitor.registerConnectionPool('service-1', pool1);
      healthMonitor.registerConnectionPool('service-2', pool2);

      // Start heartbeat
      healthMonitor.startHeartbeat(100, 3);

      // Wait for at least one cycle
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Both services should have been checked
      const status1 = healthMonitor.getHealthStatus('service-1');
      const status2 = healthMonitor.getHealthStatus('service-2');

      expect(status1).toBeDefined();
      expect(status2).toBeDefined();

      // Clean up
      healthMonitor.stopHeartbeat();
    });
  });

  describe('stopHeartbeat', () => {
    it('should stop periodic health checks', async () => {
      const service: ServiceDefinition = {
        name: 'test-service',
        enabled: true,
        tags: [],
        transport: 'stdio',
        command: 'node',
        args: ['test.js'],
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      const pool = new ConnectionPool(service, service.connectionPool);
      let checkCount = 0;
      vi.spyOn(pool, 'acquire').mockImplementation(async () => {
        checkCount++;
        throw new Error('Failed');
      });

      healthMonitor.registerConnectionPool('test-service', pool);

      // Start heartbeat with short interval
      healthMonitor.startHeartbeat(50, 3);

      // Wait for initial check
      await new Promise((resolve) => setTimeout(resolve, 10));
      const initialCheckCount = checkCount;

      // Stop heartbeat
      healthMonitor.stopHeartbeat();

      // Wait to ensure no more checks happen
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Check count should not have increased significantly after stop
      // (allow for 1 extra check that might have been in progress)
      expect(checkCount).toBeLessThanOrEqual(initialCheckCount + 1);
    });

    it('should be safe to call multiple times', () => {
      expect(() => {
        healthMonitor.stopHeartbeat();
        healthMonitor.stopHeartbeat();
        healthMonitor.stopHeartbeat();
      }).not.toThrow();
    });

    it('should stop previous heartbeat when starting new one', async () => {
      const service: ServiceDefinition = {
        name: 'test-service',
        enabled: true,
        tags: [],
        transport: 'stdio',
        command: 'node',
        args: ['test.js'],
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      const pool = new ConnectionPool(service, service.connectionPool);
      vi.spyOn(pool, 'acquire').mockRejectedValue(new Error('Failed'));

      healthMonitor.registerConnectionPool('test-service', pool);

      // Start first heartbeat
      healthMonitor.startHeartbeat(1000, 3);

      // Start second heartbeat with different interval (should stop first)
      healthMonitor.startHeartbeat(50, 3);

      // Wait for one cycle of the second heartbeat
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should have status from second heartbeat
      const status = healthMonitor.getHealthStatus('test-service');
      expect(status).toBeDefined();

      // Clean up
      healthMonitor.stopHeartbeat();
    });
  });

  describe('onHealthChange', () => {
    it('should subscribe to health status changes', async () => {
      const service: ServiceDefinition = {
        name: 'test-service',
        enabled: true,
        tags: [],
        transport: 'stdio',
        command: 'node',
        args: ['test.js'],
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      const pool = new ConnectionPool(service, service.connectionPool);
      const mockConnection: Connection = {
        id: 'test-conn-1',
        transport: {
          send: vi.fn(),
          receive: vi.fn(),
          close: vi.fn(),
          getType: () => 'stdio',
        } as any,
        state: 'idle',
        lastUsed: new Date(),
        createdAt: new Date(),
      };

      healthMonitor.registerConnectionPool('test-service', pool);

      // Start healthy
      vi.spyOn(pool, 'acquire').mockResolvedValue(mockConnection);
      vi.spyOn(pool, 'isConnectionHealthy').mockReturnValue(true);
      vi.spyOn(pool, 'release').mockImplementation(() => {});

      await healthMonitor.checkHealth('test-service');

      // Subscribe to health changes
      const callback = vi.fn();
      const unsubscribe = healthMonitor.onHealthChange(callback);

      // Then fail
      vi.spyOn(pool, 'acquire').mockRejectedValue(new Error('Connection failed'));
      await healthMonitor.checkHealth('test-service');

      expect(callback).toHaveBeenCalledTimes(1);
      const status = callback.mock.calls[0][0];
      expect(status.serviceName).toBe('test-service');
      expect(status.healthy).toBe(false);

      // Clean up
      unsubscribe();
    });

    it('should return unsubscribe function that removes the listener', async () => {
      const service: ServiceDefinition = {
        name: 'test-service',
        enabled: true,
        tags: [],
        transport: 'stdio',
        command: 'node',
        args: ['test.js'],
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      const pool = new ConnectionPool(service, service.connectionPool);
      const mockConnection: Connection = {
        id: 'test-conn-1',
        transport: {
          send: vi.fn(),
          receive: vi.fn(),
          close: vi.fn(),
          getType: () => 'stdio',
        } as any,
        state: 'idle',
        lastUsed: new Date(),
        createdAt: new Date(),
      };

      healthMonitor.registerConnectionPool('test-service', pool);

      // Start healthy
      vi.spyOn(pool, 'acquire').mockResolvedValue(mockConnection);
      vi.spyOn(pool, 'isConnectionHealthy').mockReturnValue(true);
      vi.spyOn(pool, 'release').mockImplementation(() => {});

      await healthMonitor.checkHealth('test-service');

      // Subscribe and immediately unsubscribe
      const callback = vi.fn();
      const unsubscribe = healthMonitor.onHealthChange(callback);
      unsubscribe();

      // Then fail
      vi.spyOn(pool, 'acquire').mockRejectedValue(new Error('Connection failed'));
      await healthMonitor.checkHealth('test-service');

      // Callback should not have been called
      expect(callback).not.toHaveBeenCalled();
    });

    it('should support multiple subscribers', async () => {
      const service: ServiceDefinition = {
        name: 'test-service',
        enabled: true,
        tags: [],
        transport: 'stdio',
        command: 'node',
        args: ['test.js'],
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      const pool = new ConnectionPool(service, service.connectionPool);
      const mockConnection: Connection = {
        id: 'test-conn-1',
        transport: {
          send: vi.fn(),
          receive: vi.fn(),
          close: vi.fn(),
          getType: () => 'stdio',
        } as any,
        state: 'idle',
        lastUsed: new Date(),
        createdAt: new Date(),
      };

      healthMonitor.registerConnectionPool('test-service', pool);

      // Start healthy
      vi.spyOn(pool, 'acquire').mockResolvedValue(mockConnection);
      vi.spyOn(pool, 'isConnectionHealthy').mockReturnValue(true);
      vi.spyOn(pool, 'release').mockImplementation(() => {});

      await healthMonitor.checkHealth('test-service');

      // Subscribe multiple callbacks
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const callback3 = vi.fn();

      const unsubscribe1 = healthMonitor.onHealthChange(callback1);
      const unsubscribe2 = healthMonitor.onHealthChange(callback2);
      const unsubscribe3 = healthMonitor.onHealthChange(callback3);

      // Then fail
      vi.spyOn(pool, 'acquire').mockRejectedValue(new Error('Connection failed'));
      await healthMonitor.checkHealth('test-service');

      // All callbacks should have been called
      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).toHaveBeenCalledTimes(1);
      expect(callback3).toHaveBeenCalledTimes(1);

      // Clean up
      unsubscribe1();
      unsubscribe2();
      unsubscribe3();
    });

    it('should notify on recovery (unhealthy to healthy)', async () => {
      const service: ServiceDefinition = {
        name: 'test-service',
        enabled: true,
        tags: [],
        transport: 'stdio',
        command: 'node',
        args: ['test.js'],
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      const pool = new ConnectionPool(service, service.connectionPool);
      const mockConnection: Connection = {
        id: 'test-conn-1',
        transport: {
          send: vi.fn(),
          receive: vi.fn(),
          close: vi.fn(),
          getType: () => 'stdio',
        } as any,
        state: 'idle',
        lastUsed: new Date(),
        createdAt: new Date(),
      };

      healthMonitor.registerConnectionPool('test-service', pool);

      // Start unhealthy
      vi.spyOn(pool, 'acquire').mockRejectedValue(new Error('Connection failed'));
      await healthMonitor.checkHealth('test-service');

      // Subscribe to health changes
      const callback = vi.fn();
      const unsubscribe = healthMonitor.onHealthChange(callback);

      // Then recover
      vi.spyOn(pool, 'acquire').mockResolvedValue(mockConnection);
      vi.spyOn(pool, 'isConnectionHealthy').mockReturnValue(true);
      vi.spyOn(pool, 'release').mockImplementation(() => {});

      await healthMonitor.checkHealth('test-service');

      expect(callback).toHaveBeenCalledTimes(1);
      const status = callback.mock.calls[0][0];
      expect(status.serviceName).toBe('test-service');
      expect(status.healthy).toBe(true);

      // Clean up
      unsubscribe();
    });
  });
});
