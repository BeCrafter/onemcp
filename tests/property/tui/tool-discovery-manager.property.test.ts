import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { ToolDiscoveryManager } from '../../../src/tui/tool-discovery-manager.js';

/**
 * Feature: auto-discover-service-tools
 * Property-based tests for Tool Discovery Manager
 *
 * Tests:
 * - Property 3: 成功发现存储到缓存 (Successful discovery stored in cache)
 *
 * **Validates: Requirements 1.3, 3.1, 3.2**
 */

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
 * Generate valid tool counts
 */
const toolCountArbitrary = (): fc.Arbitrary<number> => fc.integer({ min: 0, max: 100 });

/**
 * Generate a service with tool count
 */
const serviceWithToolCountArbitrary = () =>
  fc.record({
    name: serviceNameArbitrary(),
    toolCount: toolCountArbitrary(),
  });

// ============================================================================
// Property 3: 成功发现存储到缓存
// ============================================================================

describe('Feature: auto-discover-service-tools, Property 3: 成功发现存储到缓存', () => {
  let manager: ToolDiscoveryManager;

  beforeEach(() => {
    manager = new ToolDiscoveryManager();
  });

  it('should cache tool count for successfully discovered services', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(serviceWithToolCountArbitrary(), { minLength: 1, maxLength: 20 }),
        async (services) => {
          // Clear cache between runs to avoid cross-run contamination
          manager.clear();

          // Deduplicate by name (last-write-wins)
          const uniqueServices = services.reduce<typeof services>((acc, svc) => {
            const existing = acc.findIndex((s) => s.name === svc.name);
            if (existing >= 0) {
              acc[existing] = svc;
            } else {
              acc.push(svc);
            }
            return acc;
          }, []);

          // Simulate successful discovery for each unique service
          for (const service of uniqueServices) {
            // Emit a 'discovered' event to simulate successful discovery
            manager.emit('discovered', {
              serviceName: service.name,
              status: 'completed' as const,
              toolCount: service.toolCount,
              timestamp: new Date(),
            });
          }

          // Verify all tool counts are cached and retrievable by service name
          for (const service of uniqueServices) {
            const cached = manager.getToolCount(service.name);
            expect(cached).toBe(service.toolCount);
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should cache tool count for single service discovery', async () => {
    await fc.assert(
      fc.asyncProperty(
        serviceNameArbitrary(),
        toolCountArbitrary(),
        async (serviceName, toolCount) => {
          // Clear cache between runs to avoid cross-run contamination
          manager.clear();

          // Simulate successful discovery
          manager.emit('discovered', {
            serviceName,
            status: 'completed' as const,
            toolCount,
            timestamp: new Date(),
          });

          // Verify tool count is cached
          const cached = manager.getToolCount(serviceName);
          expect(cached).toBe(toolCount);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should retrieve cached tool count by exact service name', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(serviceWithToolCountArbitrary(), { minLength: 2, maxLength: 10 }),
        async (services) => {
          // Clear cache between runs to avoid cross-run contamination
          manager.clear();

          // Ensure unique service names
          const uniqueServices = services.filter(
            (service, index, self) => self.findIndex((s) => s.name === service.name) === index
          );

          if (uniqueServices.length < 2) {
            return true; // Skip if not enough unique services
          }

          // Cache all services
          for (const service of uniqueServices) {
            manager.emit('discovered', {
              serviceName: service.name,
              status: 'completed' as const,
              toolCount: service.toolCount,
              timestamp: new Date(),
            });
          }

          // Verify each service retrieves its own tool count
          for (const service of uniqueServices) {
            const cached = manager.getToolCount(service.name);
            expect(cached).toBe(service.toolCount);
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return undefined for non-existent service', async () => {
    await fc.assert(
      fc.asyncProperty(
        serviceWithToolCountArbitrary(),
        serviceNameArbitrary(),
        async (service, nonExistentName) => {
          // Assume nonExistentName is different from service.name
          fc.pre(nonExistentName !== service.name);

          // Clear cache between runs to avoid cross-run contamination
          manager.clear();

          // Cache one service
          manager.emit('discovered', {
            serviceName: service.name,
            status: 'completed' as const,
            toolCount: service.toolCount,
            timestamp: new Date(),
          });

          // Verify cached service exists
          expect(manager.getToolCount(service.name)).toBe(service.toolCount);

          // Verify non-existent service returns undefined
          expect(manager.getToolCount(nonExistentName)).toBeUndefined();

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should update cached tool count when service is rediscovered', async () => {
    await fc.assert(
      fc.asyncProperty(
        serviceNameArbitrary(),
        toolCountArbitrary(),
        toolCountArbitrary(),
        async (serviceName, initialCount, updatedCount) => {
          // First discovery
          manager.emit('discovered', {
            serviceName,
            status: 'completed' as const,
            toolCount: initialCount,
            timestamp: new Date(),
          });

          // Verify initial cache
          expect(manager.getToolCount(serviceName)).toBe(initialCount);

          // Second discovery with different count
          manager.emit('discovered', {
            serviceName,
            status: 'completed' as const,
            toolCount: updatedCount,
            timestamp: new Date(),
          });

          // Verify cache is updated
          expect(manager.getToolCount(serviceName)).toBe(updatedCount);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should preserve cache across multiple queries', async () => {
    await fc.assert(
      fc.asyncProperty(
        serviceWithToolCountArbitrary(),
        fc.integer({ min: 1, max: 10 }),
        async (service, numQueries) => {
          // Cache service
          manager.emit('discovered', {
            serviceName: service.name,
            status: 'completed' as const,
            toolCount: service.toolCount,
            timestamp: new Date(),
          });

          // Query multiple times
          for (let i = 0; i < numQueries; i++) {
            const cached = manager.getToolCount(service.name);
            expect(cached).toBe(service.toolCount);
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should cache zero tool count correctly', async () => {
    await fc.assert(
      fc.asyncProperty(serviceNameArbitrary(), async (serviceName) => {
        // Simulate discovery with zero tools
        manager.emit('discovered', {
          serviceName,
          status: 'completed' as const,
          toolCount: 0,
          timestamp: new Date(),
        });

        // Verify zero is cached (not undefined)
        const cached = manager.getToolCount(serviceName);
        expect(cached).toBe(0);
        expect(cached).not.toBeUndefined();

        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('should clear all cached data when clear is called', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(serviceWithToolCountArbitrary(), { minLength: 1, maxLength: 10 }),
        async (services) => {
          // Cache all services
          for (const service of services) {
            manager.emit('discovered', {
              serviceName: service.name,
              status: 'completed' as const,
              toolCount: service.toolCount,
              timestamp: new Date(),
            });
          }

          // Verify all are cached
          for (const service of services) {
            expect(manager.getToolCount(service.name)).toBe(service.toolCount);
          }

          // Clear cache
          manager.clear();

          // Verify all are cleared
          for (const service of services) {
            expect(manager.getToolCount(service.name)).toBeUndefined();
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
