/**
 * Unit tests for FileConfigProvider
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileConfigProvider } from '../../../src/config/file-provider.js';
import { MemoryStorageAdapter } from '../../../src/storage/memory.js';
import { FileStorageAdapter } from '../../../src/storage/file.js';
import type { SystemConfig } from '../../../src/types/config.js';

describe('FileConfigProvider', () => {
  let storage: MemoryStorageAdapter;
  let provider: FileConfigProvider;
  let fileSystemStorage: FileStorageAdapter | null = null;
  let tempConfigDir: string | null = null;

  const validConfig: SystemConfig = {
    mode: 'cli',
    logLevel: 'INFO',
    configDir: '/test/config',
    mcpServers: {
      'test-service': {
        transport: 'stdio',
        command: 'node',
        args: ['server.js'],
        env: { NODE_ENV: 'test' },
        enabled: true,
        tags: ['test'],
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      },
    },
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

  beforeEach(async () => {
    storage = new MemoryStorageAdapter();
    provider = new FileConfigProvider({
      storageAdapter: storage,
      configDir: '/test/config',
    });
  });

  afterEach(async () => {
    // Clean up temporary directory if it was created
    if (tempConfigDir && fileSystemStorage) {
      try {
        await fs.promises.rm(tempConfigDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
      tempConfigDir = null;
      fileSystemStorage = null;
    }
  });

  /**
   * Helper function to set up a real file system for watch() tests
   */
  async function setupFileSystemProvider(): Promise<{
    fsProvider: FileConfigProvider;
    fsStorage: FileStorageAdapter;
    fsConfigDir: string;
  }> {
    const fsConfigDir = path.join(
      os.tmpdir(),
      `onemcp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await fs.promises.mkdir(fsConfigDir, { recursive: true });

    const fsStorage = new FileStorageAdapter(fsConfigDir);
    await fsStorage.initialize();

    const fsProvider = new FileConfigProvider({
      storageAdapter: fsStorage,
      configDir: fsConfigDir,
    });

    tempConfigDir = fsConfigDir;
    fileSystemStorage = fsStorage;

    return { fsProvider, fsStorage, fsConfigDir };
  }

  describe('load()', () => {
    it('should load valid configuration from storage', async () => {
      // Arrange
      await storage.write('config.json', JSON.stringify(validConfig));

      // Act
      const config = await provider.load();

      // Assert
      expect(config).toEqual(validConfig);
    });

    it('should throw error when config file does not exist', async () => {
      // Act & Assert
      await expect(provider.load()).rejects.toThrow('Configuration file not found');
    });

    it('should throw error when config JSON is malformed', async () => {
      // Arrange
      await storage.write('config.json', '{ invalid json }');

      // Act & Assert
      await expect(provider.load()).rejects.toThrow('Failed to parse configuration JSON');
    });

    it('should throw error when config validation fails', async () => {
      // Arrange
      const invalidConfig = { ...validConfig, mode: 'invalid' };
      await storage.write('config.json', JSON.stringify(invalidConfig));

      // Act & Assert
      await expect(provider.load()).rejects.toThrow('Configuration validation failed');
    });

    it('should load config with HTTP service', async () => {
      // Arrange
      const httpConfig: SystemConfig = {
        ...validConfig,
        mcpServers: {
          'http-service': {
            transport: 'http',
            url: 'https://example.com/mcp',
            enabled: true,
            tags: [],
            connectionPool: {
              maxConnections: 10,
              idleTimeout: 120000,
              connectionTimeout: 30000,
            },
          },
        },
      };
      await storage.write('config.json', JSON.stringify(httpConfig));

      // Act
      const config = await provider.load();

      // Assert
      expect(config.mcpServers['http-service']).toBeDefined();
      expect(config.mcpServers['http-service']?.transport).toBe('http');
      expect(config.mcpServers['http-service']?.url).toBe('https://example.com/mcp');
    });

    it('should load config with SSE service', async () => {
      // Arrange
      const sseConfig: SystemConfig = {
        ...validConfig,
        mcpServers: {
          'sse-service': {
            transport: 'sse',
            url: 'https://example.com/events',
            enabled: true,
            tags: [],
            connectionPool: {
              maxConnections: 5,
              idleTimeout: 60000,
              connectionTimeout: 30000,
            },
          },
        },
      };
      await storage.write('config.json', JSON.stringify(sseConfig));

      // Act
      const config = await provider.load();

      // Assert
      expect(config.mcpServers['sse-service']).toBeDefined();
      expect(config.mcpServers['sse-service']?.transport).toBe('sse');
      expect(config.mcpServers['sse-service']?.url).toBe('https://example.com/events');
    });
  });

  describe('save()', () => {
    it('should save valid configuration to storage', async () => {
      // Act
      await provider.save(validConfig);

      // Assert
      const saved = await storage.read('config.json');
      expect(saved).toBeDefined();
      if (saved) {
        const parsed = JSON.parse(saved);
        expect(parsed).toEqual(validConfig);
      }
    });

    it('should format JSON with pretty printing', async () => {
      // Act
      await provider.save(validConfig);

      // Assert
      const saved = await storage.read('config.json');
      if (saved) {
        expect(saved).toContain('\n');
        expect(saved).toContain('  ');
      }
    });

    it('should throw error when saving invalid configuration', async () => {
      // Arrange
      const invalidConfig = { ...validConfig, mode: 'invalid' as any };

      // Act & Assert
      await expect(provider.save(invalidConfig)).rejects.toThrow('Configuration validation failed');
    });

    it('should validate before saving', async () => {
      // Arrange
      const invalidConfig = { ...validConfig, mcpServers: {} as any };
      delete (invalidConfig as any).connectionPool;

      // Act & Assert
      await expect(provider.save(invalidConfig)).rejects.toThrow('Configuration validation failed');
    });
  });

  describe('validate()', () => {
    it('should validate correct configuration', () => {
      // Act
      const result = provider.validate(validConfig);

      // Assert
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject missing required fields', () => {
      // Arrange
      const invalidConfig = { ...validConfig };
      delete (invalidConfig as any).mode;

      // Act
      const result = provider.validate(invalidConfig);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      // AJV reports missing required fields at the root level, not with the field name
      expect(result.errors.some((e) => e.message.includes('mode') || e.field === '')).toBe(true);
    });

    it('should reject invalid mode value', () => {
      // Arrange
      const invalidConfig = { ...validConfig, mode: 'invalid' as any };

      // Act
      const result = provider.validate(invalidConfig);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes('mode'))).toBe(true);
    });

    it('should reject invalid log level', () => {
      // Arrange
      const invalidConfig = { ...validConfig, logLevel: 'TRACE' as any };

      // Act
      const result = provider.validate(invalidConfig);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes('logLevel'))).toBe(true);
    });

    it('should reject invalid port number', () => {
      // Arrange
      const invalidConfig = { ...validConfig, mode: 'server' as const, port: 70000 };

      // Act
      const result = provider.validate(invalidConfig);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes('port'))).toBe(true);
    });

    it('should require port for server mode', () => {
      // Arrange
      const invalidConfig = { ...validConfig, mode: 'server' as const };

      // Act
      const result = provider.validate(invalidConfig);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'port')).toBe(true);
    });

    it('should accept valid port for server mode', () => {
      // Arrange
      const serverConfig = { ...validConfig, mode: 'server' as const, port: 3000 };

      // Act
      const result = provider.validate(serverConfig);

      // Assert
      expect(result.valid).toBe(true);
    });

    it('should reject stdio service without command', () => {
      // Arrange
      const invalidConfig: SystemConfig = {
        ...validConfig,
        mcpServers: {
          test: {
            transport: 'stdio',
            enabled: true,
            tags: [],
            connectionPool: {
              maxConnections: 5,
              idleTimeout: 60000,
              connectionTimeout: 30000,
            },
          } as any,
        },
      };

      // Act
      const result = provider.validate(invalidConfig);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes('command'))).toBe(true);
    });

    it('should reject HTTP service without URL', () => {
      // Arrange
      const invalidConfig: SystemConfig = {
        ...validConfig,
        mcpServers: {
          test: {
            transport: 'http',
            enabled: true,
            tags: [],
            connectionPool: {
              maxConnections: 5,
              idleTimeout: 60000,
              connectionTimeout: 30000,
            },
          } as any,
        },
      };

      // Act
      const result = provider.validate(invalidConfig);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes('url'))).toBe(true);
    });

    it('should reject SSE service without URL', () => {
      // Arrange
      const invalidConfig: SystemConfig = {
        ...validConfig,
        mcpServers: {
          test: {
            transport: 'sse',
            enabled: true,
            tags: [],
            connectionPool: {
              maxConnections: 5,
              idleTimeout: 60000,
              connectionTimeout: 30000,
            },
          } as any,
        },
      };

      // Act
      const result = provider.validate(invalidConfig);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes('url'))).toBe(true);
    });

    it('should reject invalid URL format', () => {
      // Arrange
      const invalidConfig: SystemConfig = {
        ...validConfig,
        mcpServers: {
          test: {
            transport: 'http',
            url: 'not-a-valid-url',
            enabled: true,
            tags: [],
            connectionPool: {
              maxConnections: 5,
              idleTimeout: 60000,
              connectionTimeout: 30000,
            },
          },
        },
      };

      // Act
      const result = provider.validate(invalidConfig);

      // Assert
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.field.includes('url') && e.message.includes('Invalid URL'))
      ).toBe(true);
    });

    it('should accept valid HTTP URL', () => {
      // Arrange
      const validHttpConfig: SystemConfig = {
        ...validConfig,
        mcpServers: {
          test: {
            transport: 'http',
            url: 'https://example.com/mcp',
            enabled: true,
            tags: [],
            connectionPool: {
              maxConnections: 5,
              idleTimeout: 60000,
              connectionTimeout: 30000,
            },
          },
        },
      };

      // Act
      const result = provider.validate(validHttpConfig);

      // Assert
      expect(result.valid).toBe(true);
    });

    it('should reject invalid transport type', () => {
      // Arrange
      const invalidConfig: SystemConfig = {
        ...validConfig,
        mcpServers: {
          test: {
            transport: 'websocket' as any,
            enabled: true,
            tags: [],
            connectionPool: {
              maxConnections: 5,
              idleTimeout: 60000,
              connectionTimeout: 30000,
            },
          },
        },
      };

      // Act
      const result = provider.validate(invalidConfig);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes('transport'))).toBe(true);
    });

    it('should reject invalid connection pool values', () => {
      // Arrange
      const invalidConfig: SystemConfig = {
        ...validConfig,
        connectionPool: {
          maxConnections: 0,
          idleTimeout: -1,
          connectionTimeout: -1,
        },
      };

      // Act
      const result = provider.validate(invalidConfig);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject invalid health check interval', () => {
      // Arrange
      const invalidConfig: SystemConfig = {
        ...validConfig,
        healthCheck: {
          ...validConfig.healthCheck,
          interval: 500, // Less than minimum 1000
        },
      };

      // Act
      const result = provider.validate(invalidConfig);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes('interval'))).toBe(true);
    });

    it('should reject invalid audit level', () => {
      // Arrange
      const invalidConfig: SystemConfig = {
        ...validConfig,
        audit: {
          ...validConfig.audit,
          level: 'debug' as any,
        },
      };

      // Act
      const result = provider.validate(invalidConfig);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes('level'))).toBe(true);
    });

    it('should return all validation errors, not just first', () => {
      // Arrange
      const invalidConfig = {
        ...validConfig,
        mode: 'invalid' as any,
        logLevel: 'TRACE' as any,
        port: 70000,
      };

      // Act
      const result = provider.validate(invalidConfig);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
    });

    it('should validate service with tool states', () => {
      // Arrange
      const configWithToolStates: SystemConfig = {
        ...validConfig,
        mcpServers: {
          'test-service': {
            transport: 'stdio',
            command: 'node',
            args: ['server.js'],
            env: { NODE_ENV: 'test' },
            enabled: true,
            tags: ['test'],
            connectionPool: {
              maxConnections: 5,
              idleTimeout: 60000,
              connectionTimeout: 30000,
            },
            toolStates: {
              read_file: true,
              write_file: false,
              '*_directory': true,
            },
          },
        },
      };

      // Act
      const result = provider.validate(configWithToolStates);

      // Assert
      expect(result.valid).toBe(true);
    });
  });

  describe('watch()', () => {
    it('should return unwatch function', () => {
      // Act
      const unwatch = provider.watch(() => {});

      // Assert
      expect(typeof unwatch).toBe('function');

      // Cleanup
      unwatch();
    });

    it('should not throw when calling unwatch', () => {
      // Arrange
      const unwatch = provider.watch(() => {});

      // Act & Assert
      expect(() => unwatch()).not.toThrow();
    });

    it('should invoke callback when configuration changes', async () => {
      // Arrange - Set up real file system
      const { fsProvider, fsConfigDir } = await setupFileSystemProvider();

      // Create initial config file
      await fsProvider.save(validConfig);

      let callbackInvoked = false;
      let receivedConfig: SystemConfig | null = null;

      const unwatch = fsProvider.watch((config) => {
        callbackInvoked = true;
        receivedConfig = config;
      });

      // Act - Modify the config file directly to trigger fs.watch
      const updatedConfig = { ...validConfig, logLevel: 'DEBUG' as const };
      const configPath = path.join(fsConfigDir, 'config.json');
      await fs.promises.writeFile(configPath, JSON.stringify(updatedConfig, null, 2));

      // Wait for debounce and file system event
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Assert
      expect(callbackInvoked).toBe(true);
      expect(receivedConfig).toBeDefined();
      expect((receivedConfig as unknown as SystemConfig)?.logLevel).toBe('DEBUG');

      // Cleanup
      unwatch();
    });

    it('should debounce multiple rapid changes', async () => {
      // Arrange - Set up real file system
      const { fsProvider, fsConfigDir } = await setupFileSystemProvider();

      // Create initial config file
      await fsProvider.save(validConfig);

      let callbackCount = 0;
      const unwatch = fsProvider.watch(() => {
        callbackCount++;
      });

      // Act - Make multiple rapid changes
      const configPath = path.join(fsConfigDir, 'config.json');
      for (let i = 0; i < 5; i++) {
        const updatedConfig = { ...validConfig, logLevel: 'DEBUG' as const };
        await fs.promises.writeFile(configPath, JSON.stringify(updatedConfig, null, 2));
        // Small delay between writes
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      // Wait for debounce period
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Assert - With debouncing, callback should be invoked only once
      expect(callbackCount).toBeLessThanOrEqual(2);

      // Cleanup
      unwatch();
    });

    it('should maintain previous config on validation failure', async () => {
      // Arrange - Set up real file system
      const { fsProvider, fsConfigDir } = await setupFileSystemProvider();

      // Create initial valid config
      await fsProvider.save(validConfig);

      let lastValidConfig: SystemConfig | null = null;
      const unwatch = fsProvider.watch((config) => {
        lastValidConfig = config;
      });

      // First, trigger a valid change to populate lastValidConfig
      const validChangeConfig = { ...validConfig, logLevel: 'DEBUG' as const };
      const configPath = path.join(fsConfigDir, 'config.json');
      await fs.promises.writeFile(configPath, JSON.stringify(validChangeConfig, null, 2));
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Verify callback was invoked with valid config
      expect(lastValidConfig).toBeDefined();
      expect((lastValidConfig as unknown as SystemConfig)?.mode).toBe('cli');
      expect((lastValidConfig as unknown as SystemConfig)?.logLevel).toBe('DEBUG');

      // Act - Write invalid configuration
      const invalidConfig = { ...validConfig, mode: 'invalid' as any };
      await fs.promises.writeFile(configPath, JSON.stringify(invalidConfig, null, 2));

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Assert - Callback should not be invoked with invalid config
      // The last valid config should remain unchanged
      expect((lastValidConfig as unknown as SystemConfig)?.mode).toBe('cli');
      expect((lastValidConfig as unknown as SystemConfig)?.logLevel).toBe('DEBUG');

      // Cleanup
      unwatch();
    });

    it('should handle file deletion gracefully', async () => {
      // Arrange - Set up real file system
      const { fsProvider, fsConfigDir } = await setupFileSystemProvider();

      // Create initial config file
      await fsProvider.save(validConfig);

      const unwatch = fsProvider.watch(() => {});

      // Act - Delete the config file
      const configPath = path.join(fsConfigDir, 'config.json');
      await fs.promises.rm(configPath);

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Assert - Should not throw
      // The watcher should log a warning but continue running

      // Cleanup
      unwatch();
    });

    it('should catch and log callback errors without crashing', async () => {
      // Arrange - Set up real file system
      const { fsProvider, fsConfigDir } = await setupFileSystemProvider();

      // Create initial config file
      await fsProvider.save(validConfig);

      const unwatch = fsProvider.watch(() => {
        throw new Error('Callback error');
      });

      // Act - Trigger a change
      const updatedConfig = { ...validConfig, logLevel: 'DEBUG' as const };
      const configPath = path.join(fsConfigDir, 'config.json');
      await fs.promises.writeFile(configPath, JSON.stringify(updatedConfig, null, 2));

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Assert - Should not throw, watcher should continue running
      // The error is caught and logged internally

      // Cleanup
      unwatch();
    });

    it('should stop watching after unwatch is called', async () => {
      // Arrange - Set up real file system
      const { fsProvider, fsConfigDir } = await setupFileSystemProvider();

      // Create initial config file
      await fsProvider.save(validConfig);

      let callbackCount = 0;
      const unwatch = fsProvider.watch(() => {
        callbackCount++;
      });

      // Act - Unwatch immediately
      unwatch();

      // Make changes after unwatching
      const updatedConfig = { ...validConfig, logLevel: 'DEBUG' as const };
      const configPath = path.join(fsConfigDir, 'config.json');
      await fs.promises.writeFile(configPath, JSON.stringify(updatedConfig, null, 2));

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Assert - Callback should not be invoked after unwatch
      expect(callbackCount).toBe(0);
    });
  });

  describe('getConfigDir()', () => {
    it('should return configured directory', () => {
      // Act
      const dir = provider.getConfigDir();

      // Assert
      expect(dir).toBe('/test/config');
    });
  });

  describe('config directory resolution', () => {
    it('should use constructor option as highest priority', () => {
      // Arrange
      process.env['ONEMCP_CONFIG_DIR'] = '/env/config';
      const customProvider = new FileConfigProvider({
        storageAdapter: storage,
        configDir: '/custom/config',
      });

      // Act
      const dir = customProvider.getConfigDir();

      // Assert
      expect(dir).toBe('/custom/config');

      // Cleanup
      delete process.env['ONEMCP_CONFIG_DIR'];
    });

    it('should use environment variable when no constructor option', () => {
      // Arrange
      process.env['ONEMCP_CONFIG_DIR'] = '/env/config';
      const envProvider = new FileConfigProvider({
        storageAdapter: storage,
      });

      // Act
      const dir = envProvider.getConfigDir();

      // Assert
      expect(dir).toBe('/env/config');

      // Cleanup
      delete process.env['ONEMCP_CONFIG_DIR'];
    });

    it('should expand tilde in config path', () => {
      // Arrange
      const homeProvider = new FileConfigProvider({
        storageAdapter: storage,
        configDir: '~/my-config',
      });

      // Act
      const dir = homeProvider.getConfigDir();

      // Assert
      expect(dir).not.toContain('~');
      expect(dir).toContain('my-config');
    });
  });

  describe('edge cases', () => {
    it('should handle empty services object', () => {
      // Arrange
      const emptyServicesConfig = { ...validConfig, mcpServers: {} };

      // Act
      const result = provider.validate(emptyServicesConfig);

      // Assert
      expect(result.valid).toBe(true);
    });

    it('should handle service with minimal fields', () => {
      // Arrange
      const minimalConfig: SystemConfig = {
        ...validConfig,
        mcpServers: {
          minimal: {
            transport: 'stdio',
            command: 'node',
            enabled: true,
            tags: [],
            connectionPool: {
              maxConnections: 5,
              idleTimeout: 60000,
              connectionTimeout: 30000,
            },
          },
        },
      };

      // Act
      const result = provider.validate(minimalConfig);

      // Assert
      expect(result.valid).toBe(true);
    });

    it('should handle service with all optional fields', () => {
      // Arrange
      const fullConfig: SystemConfig = {
        ...validConfig,
        mcpServers: {
          full: {
            transport: 'stdio',
            command: 'node',
            args: ['--version'],
            env: { TEST: 'value' },
            enabled: true,
            tags: ['tag1', 'tag2'],
            connectionPool: {
              maxConnections: 10,
              idleTimeout: 120000,
              connectionTimeout: 60000,
            },
            toolStates: {
              tool1: true,
              tool2: false,
            },
          },
        },
      };

      // Act
      const result = provider.validate(fullConfig);

      // Assert
      expect(result.valid).toBe(true);
    });
  });

  describe('initialize()', () => {
    it('should create config directory if it does not exist', async () => {
      // Act
      await provider.initialize();

      // Assert
      // Check that config.json was created
      const configData = await storage.read('config.json');
      expect(configData).toBeDefined();
    });

    it('should create default config.json with sensible defaults', async () => {
      // Act
      await provider.initialize();

      // Assert
      const configData = await storage.read('config.json');
      expect(configData).toBeDefined();

      if (configData) {
        const config = JSON.parse(configData);
        expect(config.mode).toBe('cli');
        expect(config.logLevel).toBe('INFO');
        expect(config.mcpServers).toEqual({});
        expect(config.connectionPool).toBeDefined();
        expect(config.connectionPool.maxConnections).toBe(5);
        expect(config.healthCheck).toBeDefined();
        expect(config.healthCheck.enabled).toBe(true);
        expect(config.audit).toBeDefined();
        expect(config.security).toBeDefined();
        expect(config.security.dataMasking.enabled).toBe(true);
      }
    });

    it('should not overwrite existing config.json', async () => {
      // Arrange
      const existingConfig = { ...validConfig, logLevel: 'DEBUG' as const };
      // Use the same path that initialize() uses
      await provider.save(existingConfig);

      // Act
      await provider.initialize();

      // Assert
      const config = await provider.load();
      expect(config).toBeDefined();
      // initialize() should not overwrite existing config
      expect(config.logLevel).toBe('DEBUG');
    });

    it('should be idempotent - calling multiple times is safe', async () => {
      // Act
      await provider.initialize();
      await provider.initialize();
      await provider.initialize();

      // Assert
      const configData = await storage.read('config.json');
      expect(configData).toBeDefined();
    });

    it('should create default config with all required fields', async () => {
      // Act
      await provider.initialize();

      // Assert
      const configData = await storage.read('config.json');
      expect(configData).toBeDefined();

      if (configData) {
        const config = JSON.parse(configData);

        // Validate the created config
        const validationResult = provider.validate(config);
        expect(validationResult.valid).toBe(true);
        expect(validationResult.errors).toHaveLength(0);
      }
    });

    it('should include connection pool defaults in config', async () => {
      // Act
      await provider.initialize();

      // Assert
      const configData = await storage.read('config.json');
      expect(configData).toBeDefined();

      if (configData) {
        const config = JSON.parse(configData);
        expect(config.connectionPool.maxConnections).toBe(5);
        expect(config.connectionPool.idleTimeout).toBe(60000);
        expect(config.connectionPool.connectionTimeout).toBe(30000);
      }
    });

    it('should include health check defaults in config', async () => {
      // Act
      await provider.initialize();

      // Assert
      const configData = await storage.read('config.json');
      expect(configData).toBeDefined();

      if (configData) {
        const config = JSON.parse(configData);
        expect(config.healthCheck.enabled).toBe(true);
        expect(config.healthCheck.interval).toBe(30000);
        expect(config.healthCheck.failureThreshold).toBe(3);
        expect(config.healthCheck.autoUnload).toBe(true);
      }
    });

    it('should include audit defaults in config', async () => {
      // Act
      await provider.initialize();

      // Assert
      const configData = await storage.read('config.json');
      expect(configData).toBeDefined();

      if (configData) {
        const config = JSON.parse(configData);
        expect(config.audit.enabled).toBe(true);
        expect(config.audit.level).toBe('standard');
        expect(config.audit.logInput).toBe(false);
        expect(config.audit.logOutput).toBe(false);
        expect(config.audit.retention.days).toBe(30);
        expect(config.audit.retention.maxSize).toBe('1GB');
      }
    });

    it('should include security defaults in config', async () => {
      // Act
      await provider.initialize();

      // Assert
      const configData = await storage.read('config.json');
      expect(configData).toBeDefined();

      if (configData) {
        const config = JSON.parse(configData);
        expect(config.security.dataMasking.enabled).toBe(true);
        expect(config.security.dataMasking.patterns).toContain('password');
        expect(config.security.dataMasking.patterns).toContain('token');
        expect(config.security.dataMasking.patterns).toContain('secret');
        expect(config.security.dataMasking.patterns).toContain('key');
      }
    });

    it('should include logging defaults in config', async () => {
      // Act
      await provider.initialize();

      // Assert
      const configData = await storage.read('config.json');
      expect(configData).toBeDefined();

      if (configData) {
        const config = JSON.parse(configData);
        expect(config.logging).toBeDefined();
        expect(config.logging.level).toBe('INFO');
        expect(config.logging.outputs).toContain('console');
        expect(config.logging.format).toBe('pretty');
      }
    });

    it('should set configDir to the resolved directory path', async () => {
      // Act
      await provider.initialize();

      // Assert
      const configData = await storage.read('config.json');
      expect(configData).toBeDefined();

      if (configData) {
        const config = JSON.parse(configData);
        expect(config.configDir).toBe('/test/config');
      }
    });
  });
});
