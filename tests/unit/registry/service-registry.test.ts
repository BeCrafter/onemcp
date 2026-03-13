/**
 * Unit tests for ServiceRegistry
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServiceRegistry } from '../../../src/registry/service-registry.js';
import type { ServiceDefinition } from '../../../src/types/service.js';
import type { ConfigProvider, SystemConfig } from '../../../src/types/config.js';

/**
 * Create a mock ConfigProvider for testing
 */
function createMockConfigProvider(): ConfigProvider {
  let storedConfig: SystemConfig = {
    mode: 'cli' as const,
    logLevel: 'INFO' as const,
    configDir: '/test/config',
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
      enabled: true,
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
        enabled: true,
        patterns: ['password', 'token'],
      },
    },
  };

  return {
    load: vi.fn(async () => ({ ...storedConfig })),
    save: vi.fn(async (config: SystemConfig) => {
      storedConfig = { ...config };
    }),
    validate: vi.fn(() => ({ valid: true, errors: [] })),
    watch: vi.fn(() => () => {}),
  };
}

/**
 * Create a valid test service definition
 */
function createTestService(overrides: Partial<ServiceDefinition> = {}): ServiceDefinition {
  return {
    name: 'test-service',
    enabled: true,
    tags: ['test'],
    transport: 'stdio',
    command: 'node',
    args: ['server.js'],
    env: { NODE_ENV: 'test' },
    connectionPool: {
      maxConnections: 3,
      idleTimeout: 60000,
      connectionTimeout: 30000,
    },
    ...overrides,
  };
}

describe('ServiceRegistry', () => {
  let registry: ServiceRegistry;
  let mockConfigProvider: ConfigProvider;

  beforeEach(async () => {
    mockConfigProvider = createMockConfigProvider();
    registry = new ServiceRegistry(mockConfigProvider);
    await registry.initialize();
  });

  describe('register', () => {
    it('should register a new service', async () => {
      const service = createTestService();

      await registry.register(service);

      const retrieved = await registry.get('test-service');
      expect(retrieved).toEqual(service);
    });

    it('should update an existing service with the same name', async () => {
      const service1 = createTestService({ enabled: true });
      const service2 = createTestService({ enabled: false });

      await registry.register(service1);
      await registry.register(service2);

      const retrieved = await registry.get('test-service');
      expect(retrieved?.enabled).toBe(false);
    });

    it('should persist service to configuration', async () => {
      const service = createTestService();

      await registry.register(service);

      expect(mockConfigProvider.save).toHaveBeenCalled();
    });

    it('should validate service before registering', async () => {
      const invalidService = createTestService({ name: '' });

      await expect(registry.register(invalidService)).rejects.toThrow(
        'Service name is required and cannot be empty'
      );
    });

    it('should register stdio service with required fields', async () => {
      const service = createTestService({
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'server'],
      });

      await registry.register(service);

      const retrieved = await registry.get('test-service');
      expect(retrieved?.transport).toBe('stdio');
      expect(retrieved?.command).toBe('npx');
    });

    it('should register HTTP service with URL', async () => {
      const service = createTestService({
        transport: 'http',
        url: 'https://api.example.com/mcp',
      });
      delete (service as any).command;

      await registry.register(service);

      const retrieved = await registry.get('test-service');
      expect(retrieved?.transport).toBe('http');
      expect(retrieved?.url).toBe('https://api.example.com/mcp');
    });

    it('should register SSE service with URL', async () => {
      const service = createTestService({
        transport: 'sse',
        url: 'https://api.example.com/events',
      });
      delete (service as any).command;

      await registry.register(service);

      const retrieved = await registry.get('test-service');
      expect(retrieved?.transport).toBe('sse');
      expect(retrieved?.url).toBe('https://api.example.com/events');
    });

    it('should reject stdio service without command', async () => {
      const service = createTestService({
        transport: 'stdio',
      });
      delete (service as any).command;

      await expect(registry.register(service)).rejects.toThrow(
        'Command is required for stdio transport'
      );
    });

    it('should reject HTTP service without URL', async () => {
      const service = createTestService({
        transport: 'http',
      });
      delete (service as any).command;
      delete (service as any).url;

      await expect(registry.register(service)).rejects.toThrow(
        'URL is required for http transport'
      );
    });

    it('should reject SSE service without URL', async () => {
      const service = createTestService({
        transport: 'sse',
      });
      delete (service as any).command;
      delete (service as any).url;

      await expect(registry.register(service)).rejects.toThrow('URL is required for sse transport');
    });

    it('should reject service with invalid URL format', async () => {
      const service = createTestService({
        transport: 'http',
        url: 'not-a-valid-url',
      });
      delete (service as any).command;

      await expect(registry.register(service)).rejects.toThrow('Invalid URL format');
    });

    it('should reject service with invalid transport type', async () => {
      const service = createTestService({
        transport: 'invalid' as any,
      });

      await expect(registry.register(service)).rejects.toThrow('Invalid transport type');
    });

    it('should register service with tool states', async () => {
      const service = createTestService({
        toolStates: {
          read_file: true,
          write_file: false,
          '*_directory': true,
        },
      });

      await registry.register(service);

      const retrieved = await registry.get('test-service');
      expect(retrieved?.toolStates).toEqual({
        read_file: true,
        write_file: false,
        '*_directory': true,
      });
    });

    it('should reject service with invalid tool states', async () => {
      const service = createTestService({
        toolStates: {
          read_file: 'yes' as any,
        },
      });

      await expect(registry.register(service)).rejects.toThrow(
        'Tool state value for pattern "read_file" must be a boolean'
      );
    });
  });

  describe('unregister', () => {
    it('should remove a registered service', async () => {
      const service = createTestService();

      await registry.register(service);
      await registry.unregister('test-service');

      const retrieved = await registry.get('test-service');
      expect(retrieved).toBeNull();
    });

    it('should persist changes after unregistering', async () => {
      const service = createTestService();

      await registry.register(service);
      vi.clearAllMocks();

      await registry.unregister('test-service');

      expect(mockConfigProvider.save).toHaveBeenCalled();
    });

    it('should handle unregistering non-existent service gracefully', async () => {
      await expect(registry.unregister('non-existent')).resolves.not.toThrow();
    });
  });

  describe('get', () => {
    it('should retrieve a registered service', async () => {
      const service = createTestService();

      await registry.register(service);
      const retrieved = await registry.get('test-service');

      expect(retrieved).toEqual(service);
    });

    it('should return null for non-existent service', async () => {
      const retrieved = await registry.get('non-existent');

      expect(retrieved).toBeNull();
    });

    it('should return equivalent service definition after registration', async () => {
      const service = createTestService({
        name: 'filesystem',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        env: { NODE_ENV: 'production' },
        tags: ['local', 'storage'],
      });

      await registry.register(service);
      const retrieved = await registry.get('filesystem');

      expect(retrieved).toEqual(service);
    });
  });

  describe('list', () => {
    it('should return empty array when no services registered', async () => {
      const services = await registry.list();

      expect(services).toEqual([]);
    });

    it('should return all registered services', async () => {
      const service1 = createTestService({ name: 'service1' });
      const service2 = createTestService({ name: 'service2' });
      const service3 = createTestService({ name: 'service3' });

      await registry.register(service1);
      await registry.register(service2);
      await registry.register(service3);

      const services = await registry.list();

      expect(services).toHaveLength(3);
      expect(services).toContainEqual(service1);
      expect(services).toContainEqual(service2);
      expect(services).toContainEqual(service3);
    });

    it('should return services with complete metadata', async () => {
      const service = createTestService({
        name: 'complete-service',
        enabled: true,
        tags: ['tag1', 'tag2'],
        transport: 'http',
        url: 'https://api.example.com',
        connectionPool: {
          maxConnections: 10,
          idleTimeout: 120000,
          connectionTimeout: 30000,
        },
        toolStates: {
          tool1: true,
          tool2: false,
        },
      });
      delete (service as any).command;

      await registry.register(service);
      const services = await registry.list();

      expect(services[0]).toEqual(service);
    });
  });

  describe('findByTags', () => {
    beforeEach(async () => {
      await registry.register(
        createTestService({
          name: 'service1',
          tags: ['local', 'storage'],
        })
      );

      await registry.register(
        createTestService({
          name: 'service2',
          tags: ['remote', 'api'],
        })
      );

      await registry.register(
        createTestService({
          name: 'service3',
          tags: ['local', 'api'],
        })
      );

      await registry.register(
        createTestService({
          name: 'service4',
          tags: [],
        })
      );
    });

    it('should find services with AND logic (all tags)', async () => {
      const services = await registry.findByTags(['local', 'storage'], true);

      expect(services).toHaveLength(1);
      expect(services[0]?.name).toBe('service1');
    });

    it('should find services with OR logic (at least one tag)', async () => {
      const services = await registry.findByTags(['local', 'remote'], false);

      expect(services).toHaveLength(3);
      const names = services.map((s) => s.name);
      expect(names).toContain('service1');
      expect(names).toContain('service2');
      expect(names).toContain('service3');
    });

    it('should return empty array when no services match AND logic', async () => {
      const services = await registry.findByTags(['local', 'remote'], true);

      expect(services).toHaveLength(0);
    });

    it('should return empty array when no services match OR logic', async () => {
      const services = await registry.findByTags(['nonexistent'], false);

      expect(services).toHaveLength(0);
    });

    it('should return all services when tags array is empty', async () => {
      const services = await registry.findByTags([], true);

      expect(services).toHaveLength(4);
    });

    it('should find services with single tag', async () => {
      const services = await registry.findByTags(['api'], true);

      expect(services).toHaveLength(2);
      const names = services.map((s) => s.name);
      expect(names).toContain('service2');
      expect(names).toContain('service3');
    });

    it('should not match services with no tags', async () => {
      const services = await registry.findByTags(['local'], true);

      expect(services).toHaveLength(2);
      expect(services.every((s) => s.name !== 'service4')).toBe(true);
    });

    it('should handle services with undefined tags as empty array', async () => {
      const service = createTestService({
        name: 'service5',
      });
      delete (service as any).tags;

      await registry.register(service);

      const services = await registry.findByTags(['any'], false);

      expect(services.every((s) => s.name !== 'service5')).toBe(true);
    });
  });

  describe('validation', () => {
    it('should reject service with empty name', async () => {
      const service = createTestService({ name: '' });

      await expect(registry.register(service)).rejects.toThrow(
        'Service name is required and cannot be empty'
      );
    });

    it('should reject service with whitespace-only name', async () => {
      const service = createTestService({ name: '   ' });

      await expect(registry.register(service)).rejects.toThrow(
        'Service name is required and cannot be empty'
      );
    });

    it('should reject service without transport', async () => {
      const service = createTestService({ transport: undefined as any });

      await expect(registry.register(service)).rejects.toThrow(
        'Service transport type is required'
      );
    });

    it('should reject service with non-boolean enabled field', async () => {
      const service = createTestService({ enabled: 'yes' as any });

      await expect(registry.register(service)).rejects.toThrow(
        'Service enabled field must be a boolean'
      );
    });

    it('should reject service with non-array tags', async () => {
      const service = createTestService({ tags: 'tag1,tag2' as any });

      await expect(registry.register(service)).rejects.toThrow('Service tags must be an array');
    });

    it('should reject service with non-string tag', async () => {
      const service = createTestService({ tags: ['tag1', 123 as any] });

      await expect(registry.register(service)).rejects.toThrow('All tags must be strings');
    });

    it('should reject service with invalid maxConnections', async () => {
      const service = createTestService({
        connectionPool: {
          maxConnections: 0,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      });

      await expect(registry.register(service)).rejects.toThrow(
        'Connection pool maxConnections must be a positive number'
      );
    });

    it('should reject service with negative idleTimeout', async () => {
      const service = createTestService({
        connectionPool: {
          maxConnections: 5,
          idleTimeout: -1000,
          connectionTimeout: 30000,
        },
      });

      await expect(registry.register(service)).rejects.toThrow(
        'Connection pool idleTimeout must be a non-negative number'
      );
    });

    it('should reject service with negative connectionTimeout', async () => {
      const service = createTestService({
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: -5000,
        },
      });

      await expect(registry.register(service)).rejects.toThrow(
        'Connection pool connectionTimeout must be a non-negative number'
      );
    });

    it('should accept service with zero idleTimeout', async () => {
      const service = createTestService({
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 0,
          connectionTimeout: 30000,
        },
      });

      await expect(registry.register(service)).resolves.not.toThrow();
    });

    it('should accept service with zero connectionTimeout', async () => {
      const service = createTestService({
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 0,
        },
      });

      await expect(registry.register(service)).resolves.not.toThrow();
    });

    // Requirement 30.4: Validate command format for stdio transport
    it('should reject stdio service with command containing null bytes', async () => {
      const service = createTestService({
        transport: 'stdio',
        command: 'node\0malicious',
      });

      await expect(registry.register(service)).rejects.toThrow(
        'Command contains invalid null byte characters'
      );
    });

    // Requirement 30.9: Return all validation errors, not just the first
    it('should collect and return all validation errors', async () => {
      const service = createTestService({
        name: '', // Error 1: empty name
        transport: 'invalid' as any, // Error 2: invalid transport
        enabled: 'yes' as any, // Error 3: non-boolean enabled
        tags: 'not-an-array' as any, // Error 4: non-array tags
      });

      try {
        await registry.register(service);
        expect.fail('Should have thrown validation error');
      } catch (error: any) {
        const errorMessage = error.message;

        // Verify error message contains all validation errors
        expect(errorMessage).toContain('Service validation failed');
        expect(errorMessage).toContain('Service name is required and cannot be empty');
        expect(errorMessage).toContain('Invalid transport type');
        expect(errorMessage).toContain('Service enabled field must be a boolean');
        expect(errorMessage).toContain('Service tags must be an array');
      }
    });

    it('should collect multiple transport-specific validation errors', async () => {
      const service = createTestService({
        transport: 'stdio',
        command: '', // Error 1: empty command
        connectionPool: {
          maxConnections: 0, // Error 2: invalid maxConnections
          idleTimeout: -100, // Error 3: negative idleTimeout
          connectionTimeout: 30000,
        },
      });

      try {
        await registry.register(service);
        expect.fail('Should have thrown validation error');
      } catch (error: any) {
        const errorMessage = error.message;

        // Verify error message contains all validation errors
        expect(errorMessage).toContain('Service validation failed');
        expect(errorMessage).toContain('Command is required for stdio transport');
        expect(errorMessage).toContain('Connection pool maxConnections must be a positive number');
        expect(errorMessage).toContain('Connection pool idleTimeout must be a non-negative number');
      }
    });

    it('should collect URL validation errors for HTTP transport', async () => {
      const service = createTestService({
        transport: 'http',
        url: 'not-a-valid-url', // Error 1: invalid URL format
        enabled: 'true' as any, // Error 2: non-boolean enabled
      });
      delete (service as any).command;

      try {
        await registry.register(service);
        expect.fail('Should have thrown validation error');
      } catch (error: any) {
        const errorMessage = error.message;

        // Verify error message contains all validation errors
        expect(errorMessage).toContain('Service validation failed');
        expect(errorMessage).toContain('Invalid URL format');
        expect(errorMessage).toContain('Service enabled field must be a boolean');
      }
    });
  });

  describe('initialize', () => {
    it('should load services from configuration on initialize', async () => {
      const service1 = createTestService({ name: 'service1' });
      const service2 = createTestService({ name: 'service2' });

      // Mock config provider to return services
      const mockProvider = createMockConfigProvider();
      const { name: _n1, ...def1 } = service1;
      const { name: _n2, ...def2 } = service2;
      const configWithServices: SystemConfig = {
        mode: 'cli' as const,
        logLevel: 'INFO' as const,
        configDir: '/test',
        mcpServers: { [service1.name]: def1, [service2.name]: def2 },
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
          level: 'standard' as const,
          logInput: false,
          logOutput: false,
          retention: { days: 30, maxSize: '1GB' },
        },
        security: {
          dataMasking: { enabled: true, patterns: [] },
        },
      };
      mockProvider.load = vi.fn(async () => configWithServices);

      const newRegistry = new ServiceRegistry(mockProvider);
      await newRegistry.initialize();

      const services = await newRegistry.list();
      expect(services).toHaveLength(2);
      expect(services).toContainEqual(service1);
      expect(services).toContainEqual(service2);
    });

    it('should clear existing services on re-initialize', async () => {
      await registry.register(createTestService({ name: 'old-service' }));

      // Verify service was registered
      let services = await registry.list();
      expect(services).toHaveLength(1);

      // Mock the config provider to return empty services on next load
      const emptyConfig: SystemConfig = {
        mode: 'cli' as const,
        logLevel: 'INFO' as const,
        configDir: '/test',
        mcpServers: {}, // Empty services record
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
          level: 'standard' as const,
          logInput: false,
          logOutput: false,
          retention: { days: 30, maxSize: '1GB' },
        },
        security: {
          dataMasking: { enabled: true, patterns: [] },
        },
      };
      vi.mocked(mockConfigProvider.load).mockResolvedValueOnce(emptyConfig);

      // Re-initialize should load from config (which has empty services array)
      await registry.initialize();

      services = await registry.list();
      expect(services).toHaveLength(0);
    });
  });

  describe('events', () => {
    it('should emit serviceRegistered event when service is registered', async () => {
      const service = createTestService();

      const eventPromise = new Promise<{ serviceName: string; service: ServiceDefinition }>(
        (resolve) => {
          registry.once(
            'serviceRegistered',
            (serviceName: string, serviceData: ServiceDefinition) => {
              resolve({ serviceName, service: serviceData });
            }
          );
        }
      );

      await registry.register(service);

      const event = await eventPromise;
      expect(event.serviceName).toBe('test-service');
      expect(event.service).toEqual(service);
    });

    it('should emit serviceUnregistered event when service is unregistered', async () => {
      const service = createTestService();
      await registry.register(service);

      const eventPromise = new Promise<string>((resolve) => {
        registry.once('serviceUnregistered', (serviceName: string) => {
          resolve(serviceName);
        });
      });

      await registry.unregister('test-service');

      const serviceName = await eventPromise;
      expect(serviceName).toBe('test-service');
    });

    it('should emit serviceRegistered event when updating existing service', async () => {
      const service1 = createTestService({ enabled: true });
      await registry.register(service1);

      const eventPromise = new Promise<{ serviceName: string; service: ServiceDefinition }>(
        (resolve) => {
          registry.once(
            'serviceRegistered',
            (serviceName: string, serviceData: ServiceDefinition) => {
              resolve({ serviceName, service: serviceData });
            }
          );
        }
      );

      const service2 = createTestService({ enabled: false });
      await registry.register(service2);

      const event = await eventPromise;
      expect(event.serviceName).toBe('test-service');
      expect(event.service.enabled).toBe(false);
    });
  });
});
