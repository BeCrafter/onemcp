/**
 * Feature: onemcp-system
 * Property-based tests for Health Monitoring
 *
 * Tests:
 * - Property 17: Health status auto tool management
 *
 * **Validates: Requirements 20.6, 20.7**
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { HealthMonitor } from '../../src/health/health-monitor.js';
import { ServiceRegistry } from '../../src/registry/service-registry.js';
import { ConnectionPool } from '../../src/pool/connection-pool.js';
import { MemoryStorageAdapter } from '../../src/storage/memory.js';
import { FileConfigProvider } from '../../src/config/file-provider.js';
import type { ServiceDefinition, Connection, HealthStatus } from '../../src/types/service.js';
import type { ConfigProvider, SystemConfig } from '../../src/types/config.js';

// Mock the transport modules
vi.mock('../../src/transport/stdio.js', () => {
  return {
    StdioTransport: vi.fn().mockImplementation(function (this: any) {
      this.send = vi.fn().mockResolvedValue(undefined);
      this.receive = vi.fn();
      this.close = vi.fn().mockResolvedValue(undefined);
      this.getType = vi.fn().mockReturnValue('stdio');
      this.process = null;
      return this;
    }),
  };
});

vi.mock('../../src/transport/http.js', () => {
  return {
    HttpTransport: vi.fn().mockImplementation(function (this: any) {
      this.send = vi.fn().mockResolvedValue(undefined);
      this.receive = vi.fn();
      this.close = vi.fn().mockResolvedValue(undefined);
      this.getType = vi.fn().mockReturnValue('http');
      return this;
    }),
  };
});

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Create a test config provider
 */
async function createTestConfigProvider(): Promise<ConfigProvider> {
  const storage = new MemoryStorageAdapter();
  const provider = new FileConfigProvider({
    storageAdapter: storage,
    configDir: '/tmp/test-health-config',
  });

  const defaultConfig: SystemConfig = {
    mode: 'cli',
    logLevel: 'INFO',
    configDir: '/tmp/test-health-config',
    mcpServers: [],
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
  };

  await provider.save(defaultConfig);
  return provider;
}

/**
 * Create a mock connection
 */
function createMockConnection(id: string) {
  return {
    id,
    transport: {
      send: vi.fn().mockResolvedValue(undefined),
      receive: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      getType: () => 'stdio',
    } as any,
    state: 'idle' as const,
    lastUsed: new Date(),
    createdAt: new Date(),
  };
}

// ============================================================================
// Arbitrary Generators
// ============================================================================

/**
 * Generate valid service names
 */
const serviceNameArbitrary = (): fc.Arbitrary<string> =>
  fc
    .string({ minLength: 1, maxLength: 30 })
    .filter((s) => s.trim().length > 0)
    .map((s) => s.trim().replace(/[^a-zA-Z0-9-_]/g, '-'));

/**
 * Generate valid service definition
 */
const serviceDefinitionArbitrary = (): fc.Arbitrary<ServiceDefinition> =>
  fc.record({
    name: serviceNameArbitrary(),
    transport: fc.constant('stdio' as const),
    command: fc.constant('test-command'),
    args: fc.array(fc.string(), { maxLength: 3 }),
    enabled: fc.constant(true),
    tags: fc.array(fc.string(), { maxLength: 3 }),
    connectionPool: fc.record({
      maxConnections: fc.integer({ min: 1, max: 5 }),
      idleTimeout: fc.integer({ min: 1000, max: 60000 }),
      connectionTimeout: fc.integer({ min: 1000, max: 30000 }),
    }),
  });

/**
 * Generate a sequence of health status transitions
 * Each transition is either 'healthy' or 'unhealthy'
 */
const healthTransitionSequenceArbitrary = () =>
  fc.array(fc.constantFrom('healthy' as const, 'unhealthy' as const), {
    minLength: 2,
    maxLength: 10,
  });

// ============================================================================
// Property 17: Health Status Auto Tool Management
// ============================================================================

describe('Feature: onemcp-system, Property 17: Health status auto tool management', () => {
  let healthMonitor: HealthMonitor;
  let serviceRegistry: ServiceRegistry;
  let configProvider: ConfigProvider;
  let pools: ConnectionPool[] = [];

  beforeEach(async () => {
    configProvider = await createTestConfigProvider();
    serviceRegistry = new ServiceRegistry(configProvider);
    await serviceRegistry.initialize();
    healthMonitor = new HealthMonitor(serviceRegistry);
  });

  afterEach(async () => {
    healthMonitor.stopHeartbeat();
    for (const pool of pools) {
      await pool.closeAll();
    }
    pools = [];
    vi.clearAllMocks();
  });

  it('should emit serviceFailed event when service transitions from healthy to unhealthy', async () => {
    await fc.assert(
      fc.asyncProperty(serviceDefinitionArbitrary(), async (serviceDef) => {
        const pool = new ConnectionPool(serviceDef, serviceDef.connectionPool);
        pools.push(pool);

        const mockConnection = createMockConnection('test-conn-1');

        // Start healthy
        vi.spyOn(pool, 'acquire').mockResolvedValue(mockConnection);
        vi.spyOn(pool, 'isConnectionHealthy').mockReturnValue(true);
        vi.spyOn(pool, 'release').mockImplementation(() => {});

        await healthMonitor.registerConnectionPool(serviceDef.name, pool);

        // Verify initial healthy status
        const initialStatus = healthMonitor.getHealthStatus(serviceDef.name);
        expect(initialStatus?.healthy).toBe(true);

        // Set up event listener AFTER registration
        const serviceFailedSpy = vi.fn();
        healthMonitor.on('serviceFailed', serviceFailedSpy);

        // Transition to unhealthy
        vi.spyOn(pool, 'acquire').mockRejectedValue(new Error('Connection failed'));

        await healthMonitor.checkHealth(serviceDef.name);

        // Verify unhealthy status
        const unhealthyStatus = healthMonitor.getHealthStatus(serviceDef.name);
        expect(unhealthyStatus?.healthy).toBe(false);

        // Verify serviceFailed event was emitted
        expect(serviceFailedSpy).toHaveBeenCalledWith(serviceDef.name);

        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('should emit serviceRecovered event when service transitions from unhealthy to healthy', async () => {
    await fc.assert(
      fc.asyncProperty(serviceDefinitionArbitrary(), async (serviceDef) => {
        const pool = new ConnectionPool(serviceDef, serviceDef.connectionPool);
        pools.push(pool);

        const mockConnection = createMockConnection('test-conn-1');

        // Start unhealthy
        vi.spyOn(pool, 'acquire').mockRejectedValue(new Error('Connection failed'));

        await healthMonitor.registerConnectionPool(serviceDef.name, pool);

        // Verify initial unhealthy status
        const initialStatus = healthMonitor.getHealthStatus(serviceDef.name);
        expect(initialStatus?.healthy).toBe(false);

        // Set up event listener
        const serviceRecoveredSpy = vi.fn();
        healthMonitor.on('serviceRecovered', serviceRecoveredSpy);

        // Transition to healthy
        vi.spyOn(pool, 'acquire').mockResolvedValue(mockConnection);
        vi.spyOn(pool, 'isConnectionHealthy').mockReturnValue(true);
        vi.spyOn(pool, 'release').mockImplementation(() => {});

        await healthMonitor.checkHealth(serviceDef.name);

        // Verify healthy status
        const healthyStatus = healthMonitor.getHealthStatus(serviceDef.name);
        expect(healthyStatus?.healthy).toBe(true);

        // Verify event was emitted
        expect(serviceRecoveredSpy).toHaveBeenCalledWith(serviceDef.name);

        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('should emit healthChanged event for every health status transition', async () => {
    await fc.assert(
      fc.asyncProperty(
        serviceDefinitionArbitrary(),
        healthTransitionSequenceArbitrary(),
        async (serviceDef, transitions) => {
          const pool = new ConnectionPool(serviceDef, serviceDef.connectionPool);
          pools.push(pool);

          const mockConnection = createMockConnection('test-conn-1');

          // Register with initial state (first transition)
          if (transitions[0] === 'healthy') {
            vi.spyOn(pool, 'acquire').mockResolvedValue(mockConnection);
            vi.spyOn(pool, 'isConnectionHealthy').mockReturnValue(true);
            vi.spyOn(pool, 'release').mockImplementation(() => {});
          } else {
            vi.spyOn(pool, 'acquire').mockRejectedValue(new Error('Connection failed'));
          }

          await healthMonitor.registerConnectionPool(serviceDef.name, pool);

          // Set up event listener AFTER registration
          const healthChangedSpy = vi.fn();
          healthMonitor.on('healthChanged', healthChangedSpy);

          let previousState = transitions[0];
          let expectedTransitions = 0;

          // Apply remaining transitions
          for (let i = 1; i < transitions.length; i++) {
            const currentState = transitions[i]!;

            // Only apply and count actual state changes
            if (currentState !== previousState) {
              expectedTransitions++;

              if (currentState === 'healthy') {
                vi.spyOn(pool, 'acquire').mockResolvedValue(mockConnection);
                vi.spyOn(pool, 'isConnectionHealthy').mockReturnValue(true);
                vi.spyOn(pool, 'release').mockImplementation(() => {});
              } else {
                vi.spyOn(pool, 'acquire').mockRejectedValue(new Error('Connection failed'));
              }

              await healthMonitor.checkHealth(serviceDef.name);

              previousState = currentState;
            }
          }

          // Verify healthChanged was emitted for each actual transition
          expect(healthChangedSpy).toHaveBeenCalledTimes(expectedTransitions);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should track consecutive failures correctly across health transitions', async () => {
    await fc.assert(
      fc.asyncProperty(
        serviceDefinitionArbitrary(),
        fc.integer({ min: 1, max: 10 }),
        async (serviceDef, numFailures) => {
          const pool = new ConnectionPool(serviceDef, serviceDef.connectionPool);
          pools.push(pool);

          const mockConnection = createMockConnection('test-conn-1');

          // Start healthy
          vi.spyOn(pool, 'acquire').mockResolvedValue(mockConnection);
          vi.spyOn(pool, 'isConnectionHealthy').mockReturnValue(true);
          vi.spyOn(pool, 'release').mockImplementation(() => {});

          await healthMonitor.registerConnectionPool(serviceDef.name, pool);

          // Transition to unhealthy and accumulate failures
          vi.spyOn(pool, 'acquire').mockRejectedValue(new Error('Connection failed'));

          for (let i = 0; i < numFailures; i++) {
            await healthMonitor.checkHealth(serviceDef.name);

            const status = healthMonitor.getHealthStatus(serviceDef.name);
            expect(status?.consecutiveFailures).toBe(i + 1);
          }

          // Recover to healthy - should reset consecutive failures
          vi.spyOn(pool, 'acquire').mockResolvedValue(mockConnection);
          vi.spyOn(pool, 'isConnectionHealthy').mockReturnValue(true);

          await healthMonitor.checkHealth(serviceDef.name);

          const recoveredStatus = healthMonitor.getHealthStatus(serviceDef.name);
          expect(recoveredStatus?.healthy).toBe(true);
          expect(recoveredStatus?.consecutiveFailures).toBe(0);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should emit serviceUnhealthy event when failure threshold is exceeded during heartbeat', async () => {
    await fc.assert(
      fc.asyncProperty(serviceDefinitionArbitrary(), async (serviceDef) => {
        // Create a fresh health monitor for each test run to avoid event listener pollution
        const freshConfigProvider = await createTestConfigProvider();
        const freshRegistry = new ServiceRegistry(freshConfigProvider);
        await freshRegistry.initialize();
        const freshHealthMonitor = new HealthMonitor(freshRegistry);

        const pool = new ConnectionPool(serviceDef, serviceDef.connectionPool);
        pools.push(pool);

        // Start with failing connection
        vi.spyOn(pool, 'acquire').mockRejectedValue(new Error('Connection failed'));

        await freshHealthMonitor.registerConnectionPool(serviceDef.name, pool);

        // Set up event listener
        const serviceUnhealthySpy = vi.fn();
        freshHealthMonitor.on('serviceUnhealthy', serviceUnhealthySpy);

        // Use a fixed threshold of 2 for faster testing
        const failureThreshold = 2;

        // Start heartbeat with short interval
        freshHealthMonitor.startHeartbeat(50, failureThreshold);

        // Wait for enough heartbeat cycles to exceed threshold
        // Add extra time to ensure the threshold is exceeded
        const waitTime = 50 * (failureThreshold + 1) + 100;
        await new Promise((resolve) => setTimeout(resolve, waitTime));

        // Stop heartbeat
        freshHealthMonitor.stopHeartbeat();

        // Verify serviceUnhealthy event was emitted
        expect(serviceUnhealthySpy).toHaveBeenCalled();

        // Verify the status has exceeded threshold
        const calls = serviceUnhealthySpy.mock.calls;
        const lastCall = calls[calls.length - 1];
        const [serviceName, status] = lastCall as [string, HealthStatus];

        expect(serviceName).toBe(serviceDef.name);
        expect(status.consecutiveFailures).toBeGreaterThanOrEqual(failureThreshold);

        return true;
      }),
      { numRuns: 20, timeout: 30000 }
    );
  }, 30000);

  it('should handle multiple services with independent health transitions', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(serviceDefinitionArbitrary(), { minLength: 2, maxLength: 5 }),
        async (serviceDefs) => {
          // Ensure unique service names
          const uniqueServices = serviceDefs.map((s, i) => ({ ...s, name: `service-${i}` }));

          const poolsMap = new Map<string, ConnectionPool>();
          const mockConnections = new Map<string, Connection>();

          // Register all services as healthy initially
          for (const serviceDef of uniqueServices) {
            const pool = new ConnectionPool(serviceDef, serviceDef.connectionPool);
            pools.push(pool);
            poolsMap.set(serviceDef.name, pool);

            const mockConnection = createMockConnection(`conn-${serviceDef.name}`);
            mockConnections.set(serviceDef.name, mockConnection);

            vi.spyOn(pool, 'acquire').mockResolvedValue(mockConnection);
            vi.spyOn(pool, 'isConnectionHealthy').mockReturnValue(true);
            vi.spyOn(pool, 'release').mockImplementation(() => {});

            await healthMonitor.registerConnectionPool(serviceDef.name, pool);
          }

          // Verify all are healthy
          for (const serviceDef of uniqueServices) {
            const status = healthMonitor.getHealthStatus(serviceDef.name);
            expect(status?.healthy).toBe(true);
          }

          // Make first service unhealthy
          const firstService = uniqueServices[0]!;
          const firstPool = poolsMap.get(firstService.name)!;
          vi.spyOn(firstPool, 'acquire').mockRejectedValue(new Error('Connection failed'));

          await healthMonitor.checkHealth(firstService.name);

          // Verify first service is unhealthy
          const firstStatus = healthMonitor.getHealthStatus(firstService.name);
          expect(firstStatus?.healthy).toBe(false);

          // Verify other services are still healthy
          for (let i = 1; i < uniqueServices.length; i++) {
            const serviceDef = uniqueServices[i]!;
            const status = healthMonitor.getHealthStatus(serviceDef.name);
            expect(status?.healthy).toBe(true);
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should maintain health status consistency across multiple checks', async () => {
    await fc.assert(
      fc.asyncProperty(
        serviceDefinitionArbitrary(),
        fc.integer({ min: 2, max: 10 }),
        async (serviceDef, numChecks) => {
          const pool = new ConnectionPool(serviceDef, serviceDef.connectionPool);
          pools.push(pool);

          const mockConnection = createMockConnection('test-conn-1');

          // Set up as healthy
          vi.spyOn(pool, 'acquire').mockResolvedValue(mockConnection);
          vi.spyOn(pool, 'isConnectionHealthy').mockReturnValue(true);
          vi.spyOn(pool, 'release').mockImplementation(() => {});

          await healthMonitor.registerConnectionPool(serviceDef.name, pool);

          // Perform multiple health checks
          for (let i = 0; i < numChecks; i++) {
            await healthMonitor.checkHealth(serviceDef.name);

            const status = healthMonitor.getHealthStatus(serviceDef.name);
            expect(status?.healthy).toBe(true);
            expect(status?.consecutiveFailures).toBe(0);
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should emit correct events in the correct order during health transitions', async () => {
    await fc.assert(
      fc.asyncProperty(serviceDefinitionArbitrary(), async (serviceDef) => {
        const pool = new ConnectionPool(serviceDef, serviceDef.connectionPool);
        pools.push(pool);

        const mockConnection = createMockConnection('test-conn-1');

        // Start healthy
        vi.spyOn(pool, 'acquire').mockResolvedValue(mockConnection);
        vi.spyOn(pool, 'isConnectionHealthy').mockReturnValue(true);
        vi.spyOn(pool, 'release').mockImplementation(() => {});

        await healthMonitor.registerConnectionPool(serviceDef.name, pool);

        // Track event order
        const events: string[] = [];

        healthMonitor.on('healthChanged', () => events.push('healthChanged'));
        healthMonitor.on('serviceFailed', () => events.push('serviceFailed'));
        healthMonitor.on('serviceRecovered', () => events.push('serviceRecovered'));

        // Transition to unhealthy
        vi.spyOn(pool, 'acquire').mockRejectedValue(new Error('Connection failed'));
        await healthMonitor.checkHealth(serviceDef.name);

        // Should emit healthChanged and serviceFailed
        expect(events).toContain('healthChanged');
        expect(events).toContain('serviceFailed');

        // Clear events
        events.length = 0;

        // Transition back to healthy
        vi.spyOn(pool, 'acquire').mockResolvedValue(mockConnection);
        vi.spyOn(pool, 'isConnectionHealthy').mockReturnValue(true);
        await healthMonitor.checkHealth(serviceDef.name);

        // Should emit healthChanged and serviceRecovered
        expect(events).toContain('healthChanged');
        expect(events).toContain('serviceRecovered');

        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('should not emit events when health status remains unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(
        serviceDefinitionArbitrary(),
        fc.integer({ min: 2, max: 8 }),
        async (serviceDef, numChecks) => {
          const pool = new ConnectionPool(serviceDef, serviceDef.connectionPool);
          pools.push(pool);

          const mockConnection = createMockConnection('test-conn-1');

          // Start healthy
          vi.spyOn(pool, 'acquire').mockResolvedValue(mockConnection);
          vi.spyOn(pool, 'isConnectionHealthy').mockReturnValue(true);
          vi.spyOn(pool, 'release').mockImplementation(() => {});

          await healthMonitor.registerConnectionPool(serviceDef.name, pool);

          // Set up event listeners after initial registration
          const healthChangedSpy = vi.fn();
          const serviceFailedSpy = vi.fn();
          const serviceRecoveredSpy = vi.fn();

          healthMonitor.on('healthChanged', healthChangedSpy);
          healthMonitor.on('serviceFailed', serviceFailedSpy);
          healthMonitor.on('serviceRecovered', serviceRecoveredSpy);

          // Perform multiple health checks while staying healthy
          for (let i = 0; i < numChecks; i++) {
            await healthMonitor.checkHealth(serviceDef.name);
          }

          // No events should be emitted since status didn't change
          expect(healthChangedSpy).not.toHaveBeenCalled();
          expect(serviceFailedSpy).not.toHaveBeenCalled();
          expect(serviceRecoveredSpy).not.toHaveBeenCalled();

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle rapid health status oscillations correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        serviceDefinitionArbitrary(),
        fc.integer({ min: 3, max: 10 }),
        async (serviceDef, numOscillations) => {
          const pool = new ConnectionPool(serviceDef, serviceDef.connectionPool);
          pools.push(pool);

          const mockConnection = createMockConnection('test-conn-1');

          // Start healthy
          vi.spyOn(pool, 'acquire').mockResolvedValue(mockConnection);
          vi.spyOn(pool, 'isConnectionHealthy').mockReturnValue(true);
          vi.spyOn(pool, 'release').mockImplementation(() => {});

          await healthMonitor.registerConnectionPool(serviceDef.name, pool);

          const healthChangedSpy = vi.fn();
          healthMonitor.on('healthChanged', healthChangedSpy);

          // Oscillate between healthy and unhealthy
          for (let i = 0; i < numOscillations; i++) {
            if (i % 2 === 0) {
              // Make unhealthy
              vi.spyOn(pool, 'acquire').mockRejectedValue(new Error('Connection failed'));
            } else {
              // Make healthy
              vi.spyOn(pool, 'acquire').mockResolvedValue(mockConnection);
              vi.spyOn(pool, 'isConnectionHealthy').mockReturnValue(true);
            }

            await healthMonitor.checkHealth(serviceDef.name);
          }

          // Should have emitted healthChanged for each oscillation
          expect(healthChangedSpy).toHaveBeenCalledTimes(numOscillations);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
