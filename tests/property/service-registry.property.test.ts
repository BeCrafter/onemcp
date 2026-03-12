/**
 * Feature: onemcp-system
 * Property-based tests for Service Registry
 *
 * Tests:
 * - Property 1: Service registration round-trip
 * - Property 15: Tag AND filtering logic
 *
 * **Validates: Requirements 1.11, 13.5**
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { ServiceRegistry } from '../../src/registry/service-registry.js';
import type { ServiceDefinition } from '../../src/types/service.js';
import type { ConfigProvider, SystemConfig } from '../../src/types/config.js';
import { MemoryStorageAdapter } from '../../src/storage/memory.js';
import { FileConfigProvider } from '../../src/config/file-provider.js';

// ============================================================================
// Arbitrary Generators
// ============================================================================

/**
 * Generate valid service names
 */
const serviceNameArbitrary = (): fc.Arbitrary<string> =>
  fc
    .string({ minLength: 1, maxLength: 50 })
    .filter((s) => s.trim().length > 0)
    .map((s) => s.trim());

/**
 * Generate valid URLs
 */
const urlArbitrary = (): fc.Arbitrary<string> => fc.webUrl({ validSchemes: ['http', 'https'] });

/**
 * Generate valid connection pool configuration
 */
const connectionPoolConfigArbitrary = () =>
  fc.record({
    maxConnections: fc.integer({ min: 1, max: 20 }),
    idleTimeout: fc.integer({ min: 0, max: 300000 }),
    connectionTimeout: fc.integer({ min: 0, max: 60000 }),
  });

/**
 * Generate valid service definition based on transport type
 */
const serviceDefinitionArbitrary = (): fc.Arbitrary<ServiceDefinition> =>
  fc.oneof(
    // Stdio transport service
    fc.record({
      name: serviceNameArbitrary(),
      transport: fc.constant('stdio' as const),
      command: fc
        .string({ minLength: 1, maxLength: 100 })
        .filter((s) => !s.includes('\0') && s.trim().length > 0),
      args: fc.array(fc.string(), { maxLength: 10 }),
      env: fc.dictionary(fc.string({ minLength: 1 }), fc.string(), { maxKeys: 10 }),
      enabled: fc.boolean(),
      tags: fc.array(fc.string(), { maxLength: 5 }),
      connectionPool: connectionPoolConfigArbitrary(),
      toolStates: fc.dictionary(fc.string({ minLength: 1 }), fc.boolean(), { maxKeys: 10 }),
    }),
    // SSE transport service
    fc.record({
      name: serviceNameArbitrary(),
      transport: fc.constant('sse' as const),
      url: urlArbitrary(),
      enabled: fc.boolean(),
      tags: fc.array(fc.string(), { maxLength: 5 }),
      connectionPool: connectionPoolConfigArbitrary(),
      toolStates: fc.dictionary(fc.string({ minLength: 1 }), fc.boolean(), { maxKeys: 10 }),
    }),
    // HTTP transport service
    fc.record({
      name: serviceNameArbitrary(),
      transport: fc.constant('http' as const),
      url: urlArbitrary(),
      enabled: fc.boolean(),
      tags: fc.array(fc.string(), { maxLength: 5 }),
      connectionPool: connectionPoolConfigArbitrary(),
      toolStates: fc.dictionary(fc.string({ minLength: 1 }), fc.boolean(), { maxKeys: 10 }),
    })
  );

/**
 * Create a mock ConfigProvider for testing
 */
async function createTestConfigProvider(): Promise<ConfigProvider> {
  const storage = new MemoryStorageAdapter();
  const provider = new FileConfigProvider({
    storageAdapter: storage,
    configDir: '/tmp/test-config',
  });

  // Initialize with default config
  const defaultConfig: SystemConfig = {
    mode: 'cli',
    logLevel: 'INFO',
    configDir: '/tmp/test-config',
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
      enabled: true,
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
  };

  await provider.save(defaultConfig);

  return provider;
}

// ============================================================================
// Property 1: Service Registration Round-Trip
// ============================================================================

describe('Feature: onemcp-system, Property 1: Service registration round-trip', () => {
  let registry: ServiceRegistry;
  let configProvider: ConfigProvider;

  beforeEach(async () => {
    configProvider = await createTestConfigProvider();
    registry = new ServiceRegistry(configProvider);
    await registry.initialize();
  });

  it('should preserve service definition after register and retrieve', async () => {
    await fc.assert(
      fc.asyncProperty(serviceDefinitionArbitrary(), async (serviceDef) => {
        // Register service
        await registry.register(serviceDef);

        // Retrieve service
        const retrieved = await registry.get(serviceDef.name);

        // Verify retrieved service equals original service (with deduplicated tags)
        const expectedService = {
          ...serviceDef,
          tags: serviceDef.tags ? Array.from(new Set(serviceDef.tags)) : serviceDef.tags,
        };
        expect(retrieved).toEqual(expectedService);

        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('should preserve all service fields through round-trip', async () => {
    await fc.assert(
      fc.asyncProperty(serviceDefinitionArbitrary(), async (serviceDef) => {
        await registry.register(serviceDef);
        const retrieved = await registry.get(serviceDef.name);

        // Verify all fields are preserved (with deduplicated tags)
        expect(retrieved?.name).toBe(serviceDef.name);
        expect(retrieved?.transport).toBe(serviceDef.transport);
        expect(retrieved?.enabled).toBe(serviceDef.enabled);
        expect(retrieved?.tags).toEqual(
          serviceDef.tags ? Array.from(new Set(serviceDef.tags)) : serviceDef.tags
        );
        expect(retrieved?.connectionPool).toEqual(serviceDef.connectionPool);
        expect(retrieved?.toolStates).toEqual(serviceDef.toolStates);

        // Verify transport-specific fields
        if (serviceDef.transport === 'stdio') {
          expect(retrieved?.command).toBe(serviceDef.command);
          expect(retrieved?.args).toEqual(serviceDef.args);
          expect(retrieved?.env).toEqual(serviceDef.env);
        } else {
          expect(retrieved?.url).toBe(serviceDef.url);
        }

        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('should handle stdio services with various configurations', async () => {
    await fc.assert(
      fc.asyncProperty(
        serviceNameArbitrary(),
        fc.string({ minLength: 1 }).filter((s) => !s.includes('\0') && s.trim().length > 0),
        fc.option(fc.array(fc.string(), { maxLength: 10 }), { nil: undefined }),
        fc.option(fc.dictionary(fc.string({ minLength: 1 }), fc.string()), { nil: undefined }),
        fc.boolean(),
        async (name, command, args, env, enabled) => {
          const service: ServiceDefinition = {
            name,
            transport: 'stdio',
            command,
            args: args || [],
            env: env || {},
            enabled,
            tags: [],
            connectionPool: {
              maxConnections: 5,
              idleTimeout: 60000,
              connectionTimeout: 30000,
            },
          };

          await registry.register(service);
          const retrieved = await registry.get(name);

          expect(retrieved).toEqual(service);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle HTTP/SSE services with URLs', async () => {
    await fc.assert(
      fc.asyncProperty(
        serviceNameArbitrary(),
        fc.constantFrom('http' as const, 'sse' as const),
        urlArbitrary(),
        fc.boolean(),
        async (name, transport, url, enabled) => {
          const service: ServiceDefinition = {
            name,
            transport,
            url,
            enabled,
            tags: [],
            connectionPool: {
              maxConnections: 5,
              idleTimeout: 60000,
              connectionTimeout: 30000,
            },
          };

          await registry.register(service);
          const retrieved = await registry.get(name);

          expect(retrieved).toEqual(service);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should preserve tool states through round-trip', async () => {
    await fc.assert(
      fc.asyncProperty(
        serviceDefinitionArbitrary(),
        fc.dictionary(fc.string({ minLength: 1 }), fc.boolean(), { maxKeys: 20 }),
        async (baseDef, toolStates) => {
          const service = { ...baseDef, toolStates };

          await registry.register(service);
          const retrieved = await registry.get(service.name);

          expect(retrieved?.toolStates).toEqual(toolStates);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should update existing service when registering with same name', async () => {
    await fc.assert(
      fc.asyncProperty(
        serviceNameArbitrary(),
        serviceDefinitionArbitrary(),
        serviceDefinitionArbitrary(),
        async (name, def1, def2) => {
          // Register first service
          const service1 = { ...def1, name };
          await registry.register(service1);

          // Register second service with same name
          const service2 = { ...def2, name };
          await registry.register(service2);

          // Retrieve should return second service (with deduplicated tags)
          const retrieved = await registry.get(name);
          const expectedService = {
            ...service2,
            tags: service2.tags ? Array.from(new Set(service2.tags)) : service2.tags,
          };
          expect(retrieved).toEqual(expectedService);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle services with empty optional fields', async () => {
    await fc.assert(
      fc.asyncProperty(serviceNameArbitrary(), fc.boolean(), async (name, enabled) => {
        const service: ServiceDefinition = {
          name,
          transport: 'stdio',
          command: 'test',
          enabled,
          tags: [],
          connectionPool: {
            maxConnections: 5,
            idleTimeout: 60000,
            connectionTimeout: 30000,
          },
        };

        await registry.register(service);
        const retrieved = await registry.get(name);

        expect(retrieved).toEqual(service);

        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('should handle services with connection pool configuration', async () => {
    await fc.assert(
      fc.asyncProperty(
        serviceDefinitionArbitrary(),
        connectionPoolConfigArbitrary(),
        async (baseDef, connectionPool) => {
          const service = { ...baseDef, connectionPool };

          await registry.register(service);
          const retrieved = await registry.get(service.name);

          expect(retrieved?.connectionPool).toEqual(connectionPool);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Property 15: Tag AND Filtering Logic
// ============================================================================

describe('Feature: onemcp-system, Property 15: Tag AND filtering logic', () => {
  let registry: ServiceRegistry;
  let configProvider: ConfigProvider;

  beforeEach(async () => {
    configProvider = await createTestConfigProvider();
    registry = new ServiceRegistry(configProvider);
    await registry.initialize();
  });

  it('should return only services with ALL specified tags when using AND logic', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(serviceDefinitionArbitrary(), { minLength: 5, maxLength: 20 }),
        fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 3 }),
        async (services, queryTags) => {
          // Ensure unique service names
          const uniqueServices = services.map((s, i) => ({ ...s, name: `service-${i}` }));

          // Register all services
          for (const service of uniqueServices) {
            await registry.register(service);
          }

          // Query with AND logic
          const results = await registry.findByTags(queryTags, true);

          // Verify all returned services have ALL query tags
          for (const result of results) {
            const serviceTags = result.tags || [];
            for (const queryTag of queryTags) {
              expect(serviceTags).toContain(queryTag);
            }
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should not return services missing any of the specified tags', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.string({ minLength: 1 }), { minLength: 2, maxLength: 5 }),
        async (allTags) => {
          // Deduplicate tags to ensure unique tags
          const uniqueTags = Array.from(new Set(allTags));

          // Skip if deduplication resulted in less than 2 tags
          if (uniqueTags.length < 2) {
            return true;
          }

          // Create services with different tag combinations
          const services: ServiceDefinition[] = [];

          // Service with all tags
          services.push({
            name: 'service-all',
            transport: 'stdio',
            command: 'test',
            enabled: true,
            tags: [...uniqueTags],
            connectionPool: {
              maxConnections: 5,
              idleTimeout: 60000,
              connectionTimeout: 30000,
            },
          });

          // Services with subsets of tags
          for (let i = 0; i < uniqueTags.length; i++) {
            services.push({
              name: `service-subset-${i}`,
              transport: 'stdio',
              command: 'test',
              enabled: true,
              tags: uniqueTags.slice(0, i), // Missing some tags
              connectionPool: {
                maxConnections: 5,
                idleTimeout: 60000,
                connectionTimeout: 30000,
              },
            });
          }

          // Register all services
          for (const service of services) {
            await registry.register(service);
          }

          // Query with AND logic for all tags
          const results = await registry.findByTags(uniqueTags, true);

          // Only service-all should be returned
          expect(results).toHaveLength(1);
          expect(results[0]?.name).toBe('service-all');

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle empty tag queries by returning all services', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(serviceDefinitionArbitrary(), { minLength: 1, maxLength: 10 }),
        async (services) => {
          // Re-initialize registry for clean state
          configProvider = await createTestConfigProvider();
          registry = new ServiceRegistry(configProvider);
          await registry.initialize();

          // Ensure unique service names
          const uniqueServices = services.map((s, i) => ({ ...s, name: `service-${i}` }));

          // Register all services
          for (const service of uniqueServices) {
            await registry.register(service);
          }

          // Query with empty tags
          const results = await registry.findByTags([], true);

          // Should return all services
          expect(results).toHaveLength(uniqueServices.length);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return empty array when no services match all tags', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(serviceDefinitionArbitrary(), { minLength: 1, maxLength: 10 }),
        fc.string({ minLength: 1 }),
        async (services, uniqueTag) => {
          // Re-initialize registry for clean state
          configProvider = await createTestConfigProvider();
          registry = new ServiceRegistry(configProvider);
          await registry.initialize();

          // Ensure no service has the unique tag and ensure unique names
          const servicesWithoutTag = services.map((s, i) => ({
            ...s,
            name: `service-${i}`,
            tags: (s.tags || []).filter((t) => t !== uniqueTag),
          }));

          // Register all services
          for (const service of servicesWithoutTag) {
            await registry.register(service);
          }

          // Query for the unique tag
          const results = await registry.findByTags([uniqueTag], true);

          // Should return empty array
          expect(results).toHaveLength(0);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle services with no tags correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        serviceNameArbitrary(),
        fc.array(fc.string({ minLength: 1 }), { minLength: 1 }),
        async (name, queryTags) => {
          // Register service with no tags
          const service: ServiceDefinition = {
            name,
            transport: 'stdio',
            command: 'test',
            enabled: true,
            tags: [],
            connectionPool: {
              maxConnections: 5,
              idleTimeout: 60000,
              connectionTimeout: 30000,
            },
          };

          await registry.register(service);

          // Query with any tags
          const results = await registry.findByTags(queryTags, true);

          // Service with no tags should not match
          expect(results).toHaveLength(0);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle single tag queries correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        fc.array(serviceDefinitionArbitrary(), { minLength: 5, maxLength: 15 }),
        async (targetTag, services) => {
          // Re-initialize registry for clean state
          configProvider = await createTestConfigProvider();
          registry = new ServiceRegistry(configProvider);
          await registry.initialize();

          // Assign target tag to some services and ensure unique names
          const servicesWithTag = services.map((s, i) => ({
            ...s,
            name: `service-${i}`,
            tags: i % 2 === 0 ? [...(s.tags || []), targetTag] : s.tags || [],
          }));

          // Register all services
          for (const service of servicesWithTag) {
            await registry.register(service);
          }

          // Query for single tag
          const results = await registry.findByTags([targetTag], true);

          // All results should have the target tag
          for (const result of results) {
            expect(result.tags).toContain(targetTag);
          }

          // Count should match services with tag
          const expectedCount = servicesWithTag.filter((s) =>
            (s.tags || []).includes(targetTag)
          ).length;
          expect(results).toHaveLength(expectedCount);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle multiple tag queries with AND logic', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.string({ minLength: 1 }), { minLength: 2, maxLength: 4 }),
        fc.integer({ min: 5, max: 15 }),
        async (queryTags, numServices) => {
          // Create services with various tag combinations
          const services: ServiceDefinition[] = [];

          for (let i = 0; i < numServices; i++) {
            const tags: string[] = [];

            // Randomly include query tags
            for (const tag of queryTags) {
              if (Math.random() > 0.5) {
                tags.push(tag);
              }
            }

            services.push({
              name: `service-${i}`,
              transport: 'stdio',
              command: 'test',
              enabled: true,
              tags,
              connectionPool: {
                maxConnections: 5,
                idleTimeout: 60000,
                connectionTimeout: 30000,
              },
            });
          }

          // Register all services
          for (const service of services) {
            await registry.register(service);
          }

          // Query with AND logic
          const results = await registry.findByTags(queryTags, true);

          // Verify all results have ALL query tags
          for (const result of results) {
            const serviceTags = result.tags || [];
            for (const queryTag of queryTags) {
              expect(serviceTags).toContain(queryTag);
            }
          }

          // Verify no service with all tags was missed
          const expectedServices = services.filter((s) => {
            const serviceTags = s.tags || [];
            return queryTags.every((tag) => serviceTags.includes(tag));
          });

          expect(results).toHaveLength(expectedServices.length);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should be consistent across multiple queries', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(serviceDefinitionArbitrary(), { minLength: 5, maxLength: 10 }),
        fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 3 }),
        async (services, queryTags) => {
          // Ensure unique service names
          const uniqueServices = services.map((s, i) => ({ ...s, name: `service-${i}` }));

          // Register all services
          for (const service of uniqueServices) {
            await registry.register(service);
          }

          // Query multiple times
          const results1 = await registry.findByTags(queryTags, true);
          const results2 = await registry.findByTags(queryTags, true);
          const results3 = await registry.findByTags(queryTags, true);

          // Results should be identical
          expect(results1).toEqual(results2);
          expect(results2).toEqual(results3);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle tag queries with special characters', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 3 }),
        async (tags) => {
          // Register service with tags
          const service: ServiceDefinition = {
            name: 'test-service',
            transport: 'stdio',
            command: 'test',
            enabled: true,
            tags,
            connectionPool: {
              maxConnections: 5,
              idleTimeout: 60000,
              connectionTimeout: 30000,
            },
          };

          await registry.register(service);

          // Query with same tags
          const results = await registry.findByTags(tags, true);

          // Should find the service
          expect(results).toHaveLength(1);
          expect(results[0]?.name).toBe('test-service');

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
