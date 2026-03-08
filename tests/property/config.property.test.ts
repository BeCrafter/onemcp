import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { FileConfigProvider } from '../../src/config/file-provider.js';
import { MemoryStorageAdapter } from '../../src/storage/memory.js';
import { FileStorageAdapter } from '../../src/storage/file.js';
import type { SystemConfig } from '../../src/types/config.js';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';

/**
 * Feature: onemcp-system
 * Property-based tests for Configuration Management
 *
 * Tests:
 * - Property 2: Configuration persistence round-trip
 * - Property 14: Invalid configuration rejection
 * - Property 22: Configuration validation error completeness
 *
 * **Validates: Requirements 11.10, 11.7, 30.9**
 */

// ============================================================================
// Arbitrary Generators
// ============================================================================

/**
 * Generate valid deployment modes
 */
const deploymentModeArbitrary = (): fc.Arbitrary<'cli' | 'server'> =>
  fc.constantFrom('cli' as const, 'server' as const);

/**
 * Generate valid log levels
 */
const logLevelArbitrary = (): fc.Arbitrary<'DEBUG' | 'INFO' | 'WARN' | 'ERROR'> =>
  fc.constantFrom('DEBUG' as const, 'INFO' as const, 'WARN' as const, 'ERROR' as const);

/**
 * Generate valid transport types
 */
const transportTypeArbitrary = (): fc.Arbitrary<'stdio' | 'sse' | 'http'> =>
  fc.constantFrom('stdio' as const, 'sse' as const, 'http' as const);

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
    idleTimeout: fc.integer({ min: 1000, max: 300000 }),
    connectionTimeout: fc.integer({ min: 1000, max: 60000 }),
  });

/**
 * Generate valid service definition based on transport type
 */
const serviceDefinitionArbitrary = () =>
  fc.oneof(
    // Stdio transport service
    fc
      .record({
        name: serviceNameArbitrary(),
        transport: fc.constant('stdio' as const),
        command: fc.string({ minLength: 1, maxLength: 100 }),
        args: fc.option(fc.array(fc.string(), { maxLength: 10 }), { nil: undefined }),
        env: fc.option(fc.dictionary(fc.string({ minLength: 1 }), fc.string(), { maxKeys: 10 }), {
          nil: undefined,
        }),
        enabled: fc.boolean(),
        tags: fc.array(fc.string(), { maxLength: 5 }),
        connectionPool: connectionPoolConfigArbitrary(),
        toolStates: fc.option(
          fc.dictionary(fc.string({ minLength: 1 }), fc.boolean(), { maxKeys: 10 }),
          { nil: undefined }
        ),
      })
      .map((service) => {
        // Remove undefined optional fields for exactOptionalPropertyTypes
        const result: any = {
          name: service.name,
          transport: service.transport,
          command: service.command,
          enabled: service.enabled,
          tags: service.tags,
          connectionPool: service.connectionPool,
        };
        if (service.args !== undefined) result.args = service.args;
        if (service.env !== undefined) result.env = service.env;
        if (service.toolStates !== undefined) result.toolStates = service.toolStates;
        return result;
      }),
    // SSE transport service
    fc
      .record({
        name: serviceNameArbitrary(),
        transport: fc.constant('sse' as const),
        url: urlArbitrary(),
        enabled: fc.boolean(),
        tags: fc.array(fc.string(), { maxLength: 5 }),
        connectionPool: connectionPoolConfigArbitrary(),
        toolStates: fc.option(
          fc.dictionary(fc.string({ minLength: 1 }), fc.boolean(), { maxKeys: 10 }),
          { nil: undefined }
        ),
      })
      .map((service) => {
        const result: any = {
          name: service.name,
          transport: service.transport,
          url: service.url,
          enabled: service.enabled,
          tags: service.tags,
          connectionPool: service.connectionPool,
        };
        if (service.toolStates !== undefined) result.toolStates = service.toolStates;
        return result;
      }),
    // HTTP transport service
    fc
      .record({
        name: serviceNameArbitrary(),
        transport: fc.constant('http' as const),
        url: urlArbitrary(),
        enabled: fc.boolean(),
        tags: fc.array(fc.string(), { maxLength: 5 }),
        connectionPool: connectionPoolConfigArbitrary(),
        toolStates: fc.option(
          fc.dictionary(fc.string({ minLength: 1 }), fc.boolean(), { maxKeys: 10 }),
          { nil: undefined }
        ),
      })
      .map((service) => {
        const result: any = {
          name: service.name,
          transport: service.transport,
          url: service.url,
          enabled: service.enabled,
          tags: service.tags,
          connectionPool: service.connectionPool,
        };
        if (service.toolStates !== undefined) result.toolStates = service.toolStates;
        return result;
      })
  );

/**
 * Generate valid system configuration
 */
const systemConfigArbitrary = () =>
  fc
    .record({
      mode: deploymentModeArbitrary(),
      port: fc.option(fc.integer({ min: 1, max: 65535 }), { nil: undefined }),
      logLevel: logLevelArbitrary(),
      configDir: fc.constant('/tmp/test-config'),
      services: fc.array(serviceDefinitionArbitrary(), { maxLength: 5 }),
      connectionPool: connectionPoolConfigArbitrary(),
      healthCheck: fc.record({
        enabled: fc.boolean(),
        interval: fc.integer({ min: 1000, max: 60000 }),
        failureThreshold: fc.integer({ min: 1, max: 10 }),
        autoUnload: fc.boolean(),
      }),
      audit: fc.record({
        enabled: fc.boolean(),
        level: fc.constantFrom('minimal' as const, 'standard' as const, 'verbose' as const),
        logInput: fc.boolean(),
        logOutput: fc.boolean(),
        retention: fc.record({
          days: fc.integer({ min: 1, max: 365 }),
          maxSize: fc.constantFrom('100MB', '500MB', '1GB', '5GB'),
        }),
      }),
      security: fc.record({
        dataMasking: fc.record({
          enabled: fc.boolean(),
          patterns: fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 10 }),
        }),
      }),
      logging: fc.option(
        fc.record({
          level: logLevelArbitrary(),
          outputs: fc.array(fc.constantFrom('console', 'file'), { minLength: 1, maxLength: 2 }),
          format: fc.constantFrom('json' as const, 'pretty' as const),
          filePath: fc.option(fc.string(), { nil: undefined }),
        }),
        { nil: undefined }
      ),
    })
    .chain((config) => {
      // Ensure server mode has a port
      if (config.mode === 'server' && !config.port) {
        return fc.constant({ ...config, port: 3000 } as SystemConfig);
      }
      return fc.constant(config as SystemConfig);
    });

/**
 * Generate invalid system configuration (missing required fields or wrong types)
 */
const invalidSystemConfigArbitrary = () =>
  fc.oneof(
    // Missing required field: mode
    fc.record({
      logLevel: logLevelArbitrary(),
      configDir: fc.constant('/tmp/test-config'),
      services: fc.constant([]),
      connectionPool: connectionPoolConfigArbitrary(),
      healthCheck: fc.record({
        enabled: fc.boolean(),
        interval: fc.integer({ min: 1000 }),
        failureThreshold: fc.integer({ min: 1 }),
        autoUnload: fc.boolean(),
      }),
      audit: fc.record({
        enabled: fc.boolean(),
        level: fc.constantFrom('minimal' as const, 'standard' as const, 'verbose' as const),
        logInput: fc.boolean(),
        logOutput: fc.boolean(),
        retention: fc.record({
          days: fc.integer({ min: 1 }),
          maxSize: fc.constant('1GB'),
        }),
      }),
      security: fc.record({
        dataMasking: fc.record({
          enabled: fc.boolean(),
          patterns: fc.array(fc.string(), { minLength: 1 }),
        }),
      }),
    }),
    // Invalid port number (out of range)
    systemConfigArbitrary().map((config) => ({
      ...config,
      mode: 'server' as const,
      port: fc.sample(fc.oneof(fc.integer({ max: 0 }), fc.integer({ min: 65536 })), 1)[0],
    })),
    // Invalid service: stdio without command
    systemConfigArbitrary().map((config) => ({
      ...config,
      services: [
        {
          name: 'invalid-service',
          transport: 'stdio' as const,
          enabled: true,
          // Missing command field
        },
      ],
    })),
    // Invalid service: http without URL
    systemConfigArbitrary().map((config) => ({
      ...config,
      services: [
        {
          name: 'invalid-service',
          transport: 'http' as const,
          enabled: true,
          // Missing url field
        },
      ],
    })),
    // Invalid health check interval (too small)
    systemConfigArbitrary().map((config) => ({
      ...config,
      healthCheck: {
        ...config.healthCheck,
        interval: fc.sample(fc.integer({ max: 999 }), 1)[0],
      },
    }))
  );

/**
 * Generate configuration with multiple validation errors
 */
const multiErrorConfigArbitrary = () =>
  systemConfigArbitrary().map((config) => ({
    ...config,
    mode: 'server' as const,
    port: undefined, // Error 1: Missing port for server mode
    services: [
      {
        name: 'invalid-stdio',
        transport: 'stdio' as const,
        enabled: true,
        // Error 2: Missing command for stdio
      },
      {
        name: 'invalid-http',
        transport: 'http' as const,
        enabled: true,
        // Error 3: Missing URL for http
      },
    ],
    healthCheck: {
      ...config.healthCheck,
      interval: 500, // Error 4: Interval too small
    },
  }));

// ============================================================================
// Property 2: Configuration Persistence Round-Trip
// ============================================================================

describe('Feature: onemcp-system, Property 2: Configuration persistence round-trip', () => {
  describe('MemoryStorageAdapter', () => {
    let storage: MemoryStorageAdapter;
    let provider: FileConfigProvider;

    beforeEach(() => {
      storage = new MemoryStorageAdapter();
      provider = new FileConfigProvider({
        storageAdapter: storage,
        configDir: '/tmp/test-config',
      });
    });

    afterEach(() => {
      storage.clear();
    });

    it('should preserve configuration through save and load', async () => {
      await fc.assert(
        fc.asyncProperty(systemConfigArbitrary(), async (config) => {
          // Save configuration
          await provider.save(config);

          // Load configuration
          const loaded = await provider.load();

          // Verify configuration is preserved
          expect(loaded).toEqual(config);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should preserve service definitions through round-trip', async () => {
      await fc.assert(
        fc.asyncProperty(
          systemConfigArbitrary(),
          fc.array(serviceDefinitionArbitrary(), { minLength: 1, maxLength: 10 }),
          async (baseConfig, services) => {
            const config = { ...baseConfig, services };

            // Save
            await provider.save(config);

            // Load
            const loaded = await provider.load();

            // Verify services are preserved
            expect(loaded.services).toEqual(services);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve tool states through round-trip', async () => {
      await fc.assert(
        fc.asyncProperty(
          systemConfigArbitrary(),
          fc.dictionary(fc.string({ minLength: 1 }), fc.boolean(), { maxKeys: 20 }),
          async (baseConfig, toolStates) => {
            const config: SystemConfig = {
              ...baseConfig,
              services: [
                {
                  name: 'test-service',
                  transport: 'stdio' as const,
                  command: 'test',
                  enabled: true,
                  tags: [],
                  connectionPool: baseConfig.connectionPool,
                  toolStates,
                },
              ],
            };

            // Save
            await provider.save(config);

            // Load
            const loaded = await provider.load();

            // Verify tool states are preserved
            expect(loaded.services[0]?.toolStates).toEqual(toolStates);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('FileStorageAdapter', () => {
    let storage: FileStorageAdapter;
    let provider: FileConfigProvider;
    let tempDir: string;

    beforeEach(async () => {
      tempDir = path.join(
        os.tmpdir(),
        `config-test-${Date.now()}-${Math.random().toString(36).substring(7)}`
      );
      storage = new FileStorageAdapter(tempDir);
      await storage.initialize();
      provider = new FileConfigProvider({
        storageAdapter: storage,
        configDir: tempDir,
      });
      await provider.initialize();
    });

    afterEach(async () => {
      try {
        await fs.remove(tempDir);
      } catch {
        // Ignore cleanup errors
      }
    });

    it('should preserve configuration through save and load', async () => {
      await fc.assert(
        fc.asyncProperty(systemConfigArbitrary(), async (config) => {
          // Update configDir to match tempDir
          const configWithDir = { ...config, configDir: tempDir };

          // Save configuration
          await provider.save(configWithDir);

          // Load configuration
          const loaded = await provider.load();

          // Verify configuration is preserved
          expect(loaded).toEqual(configWithDir);

          return true;
        }),
        { numRuns: 50 } // Reduced for file I/O
      );
    });

    it('should preserve configuration after system restart simulation', async () => {
      await fc.assert(
        fc.asyncProperty(systemConfigArbitrary(), async (config) => {
          const configWithDir = { ...config, configDir: tempDir };

          // Save configuration
          await provider.save(configWithDir);

          // Simulate system restart by creating new provider instance
          const newProvider = new FileConfigProvider({
            storageAdapter: new FileStorageAdapter(tempDir),
            configDir: tempDir,
          });

          // Load configuration with new provider
          const loaded = await newProvider.load();

          // Verify configuration is preserved across restart
          expect(loaded).toEqual(configWithDir);

          return true;
        }),
        { numRuns: 50 } // Reduced for file I/O
      );
    });
  });
});

// ============================================================================
// Property 14: Invalid Configuration Rejection
// ============================================================================

describe('Feature: onemcp-system, Property 14: Invalid configuration rejection', () => {
  let storage: MemoryStorageAdapter;
  let provider: FileConfigProvider;

  beforeEach(() => {
    storage = new MemoryStorageAdapter();
    provider = new FileConfigProvider({
      storageAdapter: storage,
      configDir: '/tmp/test-config',
    });
  });

  afterEach(() => {
    storage.clear();
  });

  it('should reject all invalid configurations', () => {
    fc.assert(
      fc.property(invalidSystemConfigArbitrary(), (invalidConfig) => {
        // Validate should return invalid
        const result = provider.validate(invalidConfig as SystemConfig);

        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);

        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('should reject configuration missing required fields', () => {
    fc.assert(
      fc.property(
        fc.record({
          mode: deploymentModeArbitrary(),
          // Missing other required fields
        }),
        (partialConfig) => {
          const result = provider.validate(partialConfig as SystemConfig);

          expect(result.valid).toBe(false);
          expect(result.errors.length).toBeGreaterThan(0);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should reject server mode without port', () => {
    fc.assert(
      fc.property(systemConfigArbitrary(), (config) => {
        const serverConfig = {
          ...config,
          mode: 'server' as const,
        };
        delete (serverConfig as any).port;

        const result = provider.validate(serverConfig as SystemConfig);

        expect(result.valid).toBe(false);
        expect(result.errors.some((err) => err.field === 'port')).toBe(true);

        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('should reject stdio service without command', () => {
    fc.assert(
      fc.property(systemConfigArbitrary(), (config) => {
        const invalidConfig = {
          ...config,
          services: [
            {
              name: 'test-service',
              transport: 'stdio' as const,
              enabled: true,
              // Missing command
            },
          ],
        };

        const result = provider.validate(invalidConfig as SystemConfig);

        expect(result.valid).toBe(false);
        expect(result.errors.some((err) => err.field.includes('command'))).toBe(true);

        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('should reject HTTP/SSE service without URL', () => {
    fc.assert(
      fc.property(
        systemConfigArbitrary(),
        transportTypeArbitrary().filter((t) => t === 'http' || t === 'sse'),
        (config, transport) => {
          const invalidConfig = {
            ...config,
            services: [
              {
                name: 'test-service',
                transport,
                enabled: true,
                // Missing url
              },
            ],
          };

          const result = provider.validate(invalidConfig as SystemConfig);

          expect(result.valid).toBe(false);
          expect(result.errors.some((err) => err.field.includes('url'))).toBe(true);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should reject invalid URL format', () => {
    fc.assert(
      fc.property(
        systemConfigArbitrary(),
        fc.string().filter((s) => {
          try {
            new URL(s);
            return false;
          } catch {
            return true;
          }
        }),
        (config, invalidUrl) => {
          const invalidConfig = {
            ...config,
            services: [
              {
                name: 'test-service',
                transport: 'http' as const,
                url: invalidUrl,
                enabled: true,
              },
            ],
          };

          const result = provider.validate(invalidConfig as SystemConfig);

          expect(result.valid).toBe(false);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should prevent saving invalid configuration', async () => {
    await fc.assert(
      fc.asyncProperty(invalidSystemConfigArbitrary(), async (invalidConfig) => {
        // Attempt to save should throw
        await expect(provider.save(invalidConfig as SystemConfig)).rejects.toThrow();

        return true;
      }),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Property 22: Configuration Validation Error Completeness
// ============================================================================

describe('Feature: onemcp-system, Property 22: Configuration validation error completeness', () => {
  let storage: MemoryStorageAdapter;
  let provider: FileConfigProvider;

  beforeEach(() => {
    storage = new MemoryStorageAdapter();
    provider = new FileConfigProvider({
      storageAdapter: storage,
      configDir: '/tmp/test-config',
    });
  });

  afterEach(() => {
    storage.clear();
  });

  it('should report all validation errors, not just the first one', () => {
    fc.assert(
      fc.property(multiErrorConfigArbitrary(), (configWithErrors) => {
        const result = provider.validate(configWithErrors as unknown as SystemConfig);

        // Should be invalid
        expect(result.valid).toBe(false);

        // Should have multiple errors (at least 2)
        expect(result.errors.length).toBeGreaterThanOrEqual(2);

        // Verify specific expected errors are present
        const errorFields = result.errors.map((err) => err.field);

        // Should report port error
        expect(errorFields.some((field) => field.includes('port'))).toBe(true);

        // Should report service errors
        expect(errorFields.some((field) => field.includes('services'))).toBe(true);

        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('should report errors for all invalid services', () => {
    fc.assert(
      fc.property(
        systemConfigArbitrary(),
        fc.integer({ min: 2, max: 5 }),
        (baseConfig, numInvalidServices) => {
          // Create multiple invalid services
          const invalidServices = Array.from({ length: numInvalidServices }, (_, i) => ({
            name: `invalid-service-${i}`,
            transport: 'stdio' as const,
            enabled: true,
            // Missing command
          }));

          const config = {
            ...baseConfig,
            services: invalidServices,
          };

          const result = provider.validate(config as unknown as SystemConfig);

          // Should be invalid
          expect(result.valid).toBe(false);

          // Should have at least one error per invalid service
          const serviceErrors = result.errors.filter((err) => err.field.includes('services'));
          expect(serviceErrors.length).toBeGreaterThanOrEqual(numInvalidServices);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should provide detailed error information for each error', () => {
    fc.assert(
      fc.property(multiErrorConfigArbitrary(), (configWithErrors) => {
        const result = provider.validate(configWithErrors as unknown as SystemConfig);

        // Each error should have required fields
        for (const error of result.errors) {
          expect(error).toHaveProperty('field');
          expect(error).toHaveProperty('message');
          expect(typeof error.field).toBe('string');
          expect(typeof error.message).toBe('string');
          expect(error.field.length).toBeGreaterThan(0);
          expect(error.message.length).toBeGreaterThan(0);
        }

        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('should report errors in a consistent format', () => {
    fc.assert(
      fc.property(invalidSystemConfigArbitrary(), (invalidConfig) => {
        const result = provider.validate(invalidConfig as SystemConfig);

        // All errors should follow ValidationError interface
        for (const error of result.errors) {
          expect(error).toMatchObject({
            field: expect.any(String),
            message: expect.any(String),
          });

          // Optional fields can be undefined or have correct type
          // Don't require them to be defined
        }

        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('should not stop validation after first error', () => {
    fc.assert(
      fc.property(systemConfigArbitrary(), (baseConfig) => {
        // Create config with multiple known errors
        const config: any = {
          ...baseConfig,
          mode: 'server' as const,
          services: [
            {
              name: 'invalid-1',
              transport: 'stdio' as const,
              enabled: true,
              // Missing command - Error 2
            },
            {
              name: 'invalid-2',
              transport: 'http' as const,
              enabled: true,
              // Missing url - Error 3
            },
          ],
        };
        delete config.port; // Error 1

        const result = provider.validate(config as unknown as SystemConfig);

        // Should report multiple errors
        expect(result.errors.length).toBeGreaterThanOrEqual(3);

        // Should have errors for different fields
        const uniqueFields = new Set(result.errors.map((err) => err.field));
        expect(uniqueFields.size).toBeGreaterThanOrEqual(2);

        return true;
      }),
      { numRuns: 100 }
    );
  });
});
