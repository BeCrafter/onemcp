/**
 * Feature: onemcp-router-system
 * Property-based tests for Connection Pool
 * 
 * Tests:
 * - Property 9: Connection pool reuse
 * - Property 10: Connection pool limit enforcement
 * 
 * **Validates: Requirements 6.1, 6.5**
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { ConnectionPool } from '../../src/pool/connection-pool.js';
import type { ServiceDefinition, ConnectionPoolConfig } from '../../src/types/service.js';

// Mock the transport modules
vi.mock('../../src/transport/stdio.js', () => {
  return {
    StdioTransport: vi.fn().mockImplementation(function(this: any) {
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
    HttpTransport: vi.fn().mockImplementation(function(this: any) {
      this.send = vi.fn().mockResolvedValue(undefined);
      this.receive = vi.fn();
      this.close = vi.fn().mockResolvedValue(undefined);
      this.getType = vi.fn().mockReturnValue('http');
      return this;
    }),
  };
});

// ============================================================================
// Arbitrary Generators
// ============================================================================

/**
 * Generate valid connection pool configuration
 */
const connectionPoolConfigArbitrary = (): fc.Arbitrary<ConnectionPoolConfig> =>
  fc.record({
    maxConnections: fc.integer({ min: 1, max: 10 }),
    idleTimeout: fc.integer({ min: 1000, max: 60000 }),
    connectionTimeout: fc.integer({ min: 1000, max: 10000 }),
  });

/**
 * Generate valid service definition for stdio transport
 */
const stdioServiceArbitrary = (): fc.Arbitrary<ServiceDefinition> =>
  fc.record({
    name: fc.string({ minLength: 1, maxLength: 20 })
      .filter(s => s.trim().length > 0)
      .map(s => s.trim()),
    transport: fc.constant('stdio' as const),
    command: fc.constant('test-command'),
    args: fc.option(fc.array(fc.string(), { maxLength: 5 }), { nil: undefined }),
    env: fc.option(
      fc.dictionary(fc.string({ minLength: 1 }), fc.string(), { maxKeys: 5 }),
      { nil: undefined }
    ),
    enabled: fc.constant(true),
    tags: fc.option(fc.array(fc.string(), { maxLength: 3 }), { nil: undefined }),
    connectionPool: fc.option(connectionPoolConfigArbitrary(), { nil: undefined }),
  });

/**
 * Generate valid service definition for HTTP transport
 */
const httpServiceArbitrary = (): fc.Arbitrary<ServiceDefinition> =>
  fc.record({
    name: fc.string({ minLength: 1, maxLength: 20 })
      .filter(s => s.trim().length > 0)
      .map(s => s.trim()),
    transport: fc.constantFrom('http' as const, 'sse' as const),
    url: fc.webUrl({ validSchemes: ['http', 'https'] }),
    enabled: fc.constant(true),
    tags: fc.option(fc.array(fc.string(), { maxLength: 3 }), { nil: undefined }),
    connectionPool: fc.option(connectionPoolConfigArbitrary(), { nil: undefined }),
  });

/**
 * Generate any valid service definition
 */
const serviceDefinitionArbitrary = (): fc.Arbitrary<ServiceDefinition> =>
  fc.oneof(stdioServiceArbitrary(), httpServiceArbitrary());

/**
 * Generate a sequence of acquire/release operations
 */
const operationSequenceArbitrary = (maxOps: number = 20) =>
  fc.array(
    fc.constantFrom('acquire' as const, 'release' as const),
    { minLength: 1, maxLength: maxOps }
  );

// ============================================================================
// Property 9: Connection Pool Reuse
// ============================================================================

describe('Feature: onemcp-router-system, Property 9: Connection pool reuse', () => {
  let pools: ConnectionPool[] = [];

  afterEach(async () => {
    // Clean up all pools
    for (const pool of pools) {
      await pool.closeAll();
    }
    pools = [];
    vi.clearAllMocks();
  });

  it('should reuse idle connections instead of creating new ones', async () => {
    await fc.assert(
      fc.asyncProperty(
        serviceDefinitionArbitrary(),
        connectionPoolConfigArbitrary(),
        fc.integer({ min: 2, max: 10 }),
        async (service, config, numRequests) => {
          // Create pool
          const pool = new ConnectionPool(service, config);
          pools.push(pool);

          // Track connection IDs
          const connectionIds: string[] = [];

          // First request - should create a new connection
          const conn1 = await pool.acquire();
          connectionIds.push(conn1.id);
          pool.release(conn1);

          // Subsequent requests - should reuse the same connection
          for (let i = 1; i < numRequests; i++) {
            const conn = await pool.acquire();
            connectionIds.push(conn.id);
            pool.release(conn);
          }

          // All connection IDs should be the same (reused)
          const uniqueIds = new Set(connectionIds);
          expect(uniqueIds.size).toBe(1);

          // Verify stats show only 1 connection was created
          const stats = pool.getStats();
          expect(stats.total).toBe(1);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should reuse any available idle connection', async () => {
    await fc.assert(
      fc.asyncProperty(
        serviceDefinitionArbitrary(),
        connectionPoolConfigArbitrary(),
        fc.integer({ min: 2, max: 5 }),
        async (service, config, numConnections) => {
          // Ensure maxConnections is at least numConnections
          const poolConfig = {
            ...config,
            maxConnections: Math.max(config.maxConnections, numConnections),
          };

          const pool = new ConnectionPool(service, poolConfig);
          pools.push(pool);

          // Acquire multiple connections
          const connections = [];
          for (let i = 0; i < numConnections; i++) {
            connections.push(await pool.acquire());
          }

          // Release all connections
          for (const conn of connections) {
            pool.release(conn);
          }

          // Verify all are idle
          const statsAfterRelease = pool.getStats();
          expect(statsAfterRelease.idle).toBe(numConnections);

          // Acquire one connection - should reuse one of the idle ones
          const reusedConn = await pool.acquire();
          const reusedId = reusedConn.id;

          // Verify the reused connection was one of the original connections
          const originalIds = connections.map(c => c.id);
          expect(originalIds).toContain(reusedId);

          // Verify stats show one less idle connection
          const statsAfterReuse = pool.getStats();
          expect(statsAfterReuse.idle).toBe(numConnections - 1);
          expect(statsAfterReuse.busy).toBe(1);

          pool.release(reusedConn);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  // Note: Complex timing-dependent scenarios like queue processing and timeouts
  // are better tested in unit tests rather than property-based tests

  it('should maintain connection identity through acquire-release cycles', async () => {
    await fc.assert(
      fc.asyncProperty(
        serviceDefinitionArbitrary(),
        connectionPoolConfigArbitrary(),
        fc.integer({ min: 2, max: 10 }),
        async (service, config, numCycles) => {
          const pool = new ConnectionPool(service, config);
          pools.push(pool);

          // First acquire
          const conn1 = await pool.acquire();
          const originalId = conn1.id;
          pool.release(conn1);

          // Multiple acquire-release cycles
          for (let i = 0; i < numCycles; i++) {
            const conn = await pool.acquire();
            
            // Should be the same connection
            expect(conn.id).toBe(originalId);
            
            pool.release(conn);
          }

          // Verify only one connection exists
          const stats = pool.getStats();
          expect(stats.total).toBe(1);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should reuse connections for different transport types', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(stdioServiceArbitrary(), httpServiceArbitrary()),
        connectionPoolConfigArbitrary(),
        fc.integer({ min: 2, max: 8 }),
        async (service, config, numRequests) => {
          const pool = new ConnectionPool(service, config);
          pools.push(pool);

          // First request
          const conn1 = await pool.acquire();
          const firstId = conn1.id;
          pool.release(conn1);

          // Subsequent requests should reuse
          for (let i = 1; i < numRequests; i++) {
            const conn = await pool.acquire();
            expect(conn.id).toBe(firstId);
            pool.release(conn);
          }

          // Verify only one connection was created
          const stats = pool.getStats();
          expect(stats.total).toBe(1);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should not create new connections when idle ones are available', async () => {
    await fc.assert(
      fc.asyncProperty(
        serviceDefinitionArbitrary(),
        fc.integer({ min: 2, max: 8 }),
        fc.integer({ min: 1000, max: 10000 }),
        async (service, maxConnections, timeout) => {
          const config: ConnectionPoolConfig = {
            maxConnections,
            idleTimeout: 60000,
            connectionTimeout: timeout,
          };

          const pool = new ConnectionPool(service, config);
          pools.push(pool);

          // Create some connections and release them
          const initialConnections = Math.min(3, maxConnections);
          const connections = [];
          
          for (let i = 0; i < initialConnections; i++) {
            connections.push(await pool.acquire());
          }

          for (const conn of connections) {
            pool.release(conn);
          }

          // Verify all are idle
          const statsAfterRelease = pool.getStats();
          expect(statsAfterRelease.idle).toBe(initialConnections);
          expect(statsAfterRelease.total).toBe(initialConnections);

          // Acquire connections again - should reuse existing ones
          const reusedConnections = [];
          for (let i = 0; i < initialConnections; i++) {
            reusedConnections.push(await pool.acquire());
          }

          // Should not have created any new connections
          const statsAfterReuse = pool.getStats();
          expect(statsAfterReuse.total).toBe(initialConnections);

          // Clean up
          for (const conn of reusedConnections) {
            pool.release(conn);
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Property 10: Connection Pool Limit Enforcement
// ============================================================================

describe('Feature: onemcp-router-system, Property 10: Connection pool limit enforcement', () => {
  let pools: ConnectionPool[] = [];

  afterEach(async () => {
    // Clean up all pools
    for (const pool of pools) {
      await pool.closeAll();
    }
    pools = [];
    vi.clearAllMocks();
  });

  it('should never exceed maxConnections limit', async () => {
    await fc.assert(
      fc.asyncProperty(
        serviceDefinitionArbitrary(),
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1000, max: 10000 }),
        async (service, maxConnections, timeout) => {
          const config: ConnectionPoolConfig = {
            maxConnections,
            idleTimeout: 60000,
            connectionTimeout: timeout,
          };

          const pool = new ConnectionPool(service, config);
          pools.push(pool);

          // Try to acquire more connections than the limit
          const connections = [];
          const acquirePromises = [];

          // Acquire up to the limit
          for (let i = 0; i < maxConnections; i++) {
            acquirePromises.push(pool.acquire());
          }

          connections.push(...await Promise.all(acquirePromises));

          // Verify we're at the limit
          const stats = pool.getStats();
          expect(stats.total).toBe(maxConnections);
          expect(stats.busy).toBe(maxConnections);

          // Try to acquire one more - should queue
          const extraPromise = pool.acquire();
          
          // Give it a moment to process
          await new Promise(resolve => setTimeout(resolve, 10));

          // Should still be at the limit
          const statsAfterExtra = pool.getStats();
          expect(statsAfterExtra.total).toBe(maxConnections);
          expect(statsAfterExtra.waiting).toBeGreaterThan(0);

          // Release one connection to fulfill the queued request
          pool.release(connections[0]!);

          // Wait for the queued request to be fulfilled
          const extraConn = await extraPromise;
          connections[0] = extraConn;

          // Should still be at the limit
          const finalStats = pool.getStats();
          expect(finalStats.total).toBe(maxConnections);

          // Clean up
          for (const conn of connections) {
            pool.release(conn);
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  // Note: Queue processing and timeout scenarios are better tested in unit tests
  // due to their timing-dependent nature

  it('should maintain limit across concurrent operations', async () => {
    await fc.assert(
      fc.asyncProperty(
        serviceDefinitionArbitrary(),
        fc.integer({ min: 2, max: 8 }),
        fc.integer({ min: 5, max: 20 }),
        async (service, maxConnections, numOperations) => {
          const config: ConnectionPoolConfig = {
            maxConnections,
            idleTimeout: 60000,
            connectionTimeout: 5000,
          };

          const pool = new ConnectionPool(service, config);
          pools.push(pool);

          const activeConnections: any[] = [];
          let maxObservedTotal = 0;

          // Perform random acquire/release operations
          for (let i = 0; i < numOperations; i++) {
            if (Math.random() > 0.5 && activeConnections.length < maxConnections) {
              // Acquire
              const conn = await pool.acquire();
              activeConnections.push(conn);
            } else if (activeConnections.length > 0) {
              // Release
              const conn = activeConnections.pop();
              pool.release(conn);
            }

            // Check stats
            const stats = pool.getStats();
            maxObservedTotal = Math.max(maxObservedTotal, stats.total);
            
            // Verify limit is never exceeded
            expect(stats.total).toBeLessThanOrEqual(maxConnections);
          }

          // Clean up
          for (const conn of activeConnections) {
            pool.release(conn);
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should enforce limit for different transport types', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(stdioServiceArbitrary(), httpServiceArbitrary()),
        fc.integer({ min: 1, max: 5 }),
        async (service, maxConnections) => {
          const config: ConnectionPoolConfig = {
            maxConnections,
            idleTimeout: 60000,
            connectionTimeout: 5000,
          };

          const pool = new ConnectionPool(service, config);
          pools.push(pool);

          // Acquire all connections
          const connections = [];
          for (let i = 0; i < maxConnections; i++) {
            connections.push(await pool.acquire());
          }

          // Verify at limit
          const stats = pool.getStats();
          expect(stats.total).toBe(maxConnections);
          expect(stats.busy).toBe(maxConnections);

          // Try to acquire more - should queue
          const extraPromise = pool.acquire();
          await new Promise(resolve => setTimeout(resolve, 10));

          const statsWithQueue = pool.getStats();
          expect(statsWithQueue.total).toBe(maxConnections);
          expect(statsWithQueue.waiting).toBeGreaterThan(0);

          // Clean up
          pool.release(connections[0]!);
          const extraConn = await extraPromise;
          pool.release(extraConn);
          
          for (let i = 1; i < connections.length; i++) {
            pool.release(connections[i]!);
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle limit of 1 correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        serviceDefinitionArbitrary(),
        fc.integer({ min: 2, max: 10 }),
        async (service, numRequests) => {
          const config: ConnectionPoolConfig = {
            maxConnections: 1,
            idleTimeout: 60000,
            connectionTimeout: 5000,
          };

          const pool = new ConnectionPool(service, config);
          pools.push(pool);

          // Sequential requests should all use the same connection
          const connectionIds: string[] = [];

          for (let i = 0; i < numRequests; i++) {
            const conn = await pool.acquire();
            connectionIds.push(conn.id);
            pool.release(conn);
          }

          // All should be the same connection
          const uniqueIds = new Set(connectionIds);
          expect(uniqueIds.size).toBe(1);

          // Verify only 1 connection exists
          const stats = pool.getStats();
          expect(stats.total).toBe(1);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should process queued requests in order when connections become available', async () => {
    await fc.assert(
      fc.asyncProperty(
        serviceDefinitionArbitrary(),
        fc.integer({ min: 1, max: 3 }),
        fc.integer({ min: 2, max: 5 }),
        async (service, maxConnections, queueSize) => {
          const config: ConnectionPoolConfig = {
            maxConnections,
            idleTimeout: 60000,
            connectionTimeout: 10000,
          };

          const pool = new ConnectionPool(service, config);
          pools.push(pool);

          // Acquire all connections
          const connections = [];
          for (let i = 0; i < maxConnections; i++) {
            connections.push(await pool.acquire());
          }

          // Queue multiple requests
          const queuedPromises = [];
          for (let i = 0; i < queueSize; i++) {
            queuedPromises.push(pool.acquire());
          }

          await new Promise(resolve => setTimeout(resolve, 10));

          // Verify all are queued
          const statsWithQueue = pool.getStats();
          expect(statsWithQueue.waiting).toBe(queueSize);

          // Release connections one by one
          const fulfilledConnections = [];
          for (let i = 0; i < queueSize; i++) {
            pool.release(connections[i % maxConnections]!);
            
            // Wait a bit for queue processing
            await new Promise(resolve => setTimeout(resolve, 10));
            
            // One queued request should be fulfilled
            const stats = pool.getStats();
            expect(stats.waiting).toBe(queueSize - i - 1);
          }

          // Wait for all queued requests to complete
          const queuedConnections = await Promise.all(queuedPromises);
          expect(queuedConnections).toHaveLength(queueSize);

          // Clean up
          for (const conn of queuedConnections) {
            pool.release(conn);
          }
          for (let i = queueSize; i < connections.length; i++) {
            pool.release(connections[i]!);
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should maintain limit when connections fail', async () => {
    await fc.assert(
      fc.asyncProperty(
        serviceDefinitionArbitrary(),
        fc.integer({ min: 2, max: 5 }),
        async (service, maxConnections) => {
          const config: ConnectionPoolConfig = {
            maxConnections,
            idleTimeout: 60000,
            connectionTimeout: 5000,
          };

          const pool = new ConnectionPool(service, config);
          pools.push(pool);

          // Acquire some connections
          const connections = [];
          for (let i = 0; i < maxConnections; i++) {
            connections.push(await pool.acquire());
          }

          // Mark one as failed
          await pool.markConnectionFailed(connections[0]!, new Error('Test failure'));

          // Should be able to acquire a new connection (replacing the failed one)
          const newConn = await pool.acquire();
          expect(newConn).toBeDefined();

          // Total should still respect the limit
          const stats = pool.getStats();
          expect(stats.total).toBeLessThanOrEqual(maxConnections);

          // Clean up
          pool.release(newConn);
          for (let i = 1; i < connections.length; i++) {
            pool.release(connections[i]!);
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
