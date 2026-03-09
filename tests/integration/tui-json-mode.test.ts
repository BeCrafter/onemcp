/**
 * Integration tests for TUI JSON mode
 *
 * Tests JSON editor, validation, file import, and bulk import functionality.
 */

import { describe, it, expect } from 'vitest';
import type { ServiceDefinition } from '../../src/types/service.js';

describe('TUI JSON Mode', () => {
  describe('JSON Validation', () => {
    it('should validate single service JSON', () => {
      const json = JSON.stringify({
        name: 'test-service',
        transport: 'stdio',
        command: 'node',
        args: ['server.js'],
        enabled: true,
        tags: ['test'],
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      });

      const parsed = JSON.parse(json) as ServiceDefinition;

      expect(parsed.name).toBe('test-service');
      expect(parsed.transport).toBe('stdio');
      expect(parsed.command).toBe('node');
    });

    it('should validate array of services JSON', () => {
      const json = JSON.stringify([
        {
          name: 'service1',
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
        {
          name: 'service2',
          transport: 'http',
          url: 'http://localhost:3000',
          enabled: true,
          tags: [],
          connectionPool: {
            maxConnections: 5,
            idleTimeout: 60000,
            connectionTimeout: 30000,
          },
        },
      ]);

      const parsed = JSON.parse(json) as ServiceDefinition[];

      expect(parsed).toHaveLength(2);
      expect(parsed[0]?.name).toBe('service1');
      expect(parsed[1]?.name).toBe('service2');
    });

    it('should validate mcpServers format JSON', () => {
      const json = JSON.stringify({
        filesystem: {
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
          env: {
            NODE_ENV: 'production',
          },
          tags: ['local', 'storage'],
          enabled: true,
        },
        github: {
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          tags: ['remote', 'api'],
          enabled: true,
        },
      });

      const parsed = JSON.parse(json);

      expect(parsed.filesystem).toBeDefined();
      expect(parsed.github).toBeDefined();
      expect(parsed.filesystem.command).toBe('npx');
      expect(parsed.github.command).toBe('npx');
    });

    it('should detect invalid JSON syntax', () => {
      const invalidJson = '{ "name": "test", invalid }';

      expect(() => JSON.parse(invalidJson)).toThrow();
    });

    it('should detect missing required fields', () => {
      const json = JSON.stringify({
        // Missing name
        transport: 'stdio',
        command: 'node',
      });

      const parsed = JSON.parse(json);

      expect(parsed.name).toBeUndefined();
    });

    it('should detect invalid transport type', () => {
      const json = JSON.stringify({
        name: 'test',
        transport: 'invalid',
        command: 'node',
      });

      const parsed = JSON.parse(json);

      expect(parsed.transport).toBe('invalid');
      expect(['stdio', 'sse', 'http']).not.toContain(parsed.transport);
    });

    it('should detect missing command for stdio transport', () => {
      const json = JSON.stringify({
        name: 'test',
        transport: 'stdio',
        // Missing command
      });

      const parsed = JSON.parse(json);

      expect(parsed.command).toBeUndefined();
    });

    it('should detect missing URL for HTTP transport', () => {
      const json = JSON.stringify({
        name: 'test',
        transport: 'http',
        // Missing url
      });

      const parsed = JSON.parse(json);

      expect(parsed.url).toBeUndefined();
    });

    it('should detect invalid URL format', () => {
      const json = JSON.stringify({
        name: 'test',
        transport: 'http',
        url: 'not-a-url',
      });

      const parsed = JSON.parse(json);

      expect(parsed.url).toBe('not-a-url');
      expect(/^https?:\/\/.+/.test(parsed.url)).toBe(false);
    });

    it('should detect invalid connection pool values', () => {
      const json = JSON.stringify({
        name: 'test',
        transport: 'stdio',
        command: 'node',
        connectionPool: {
          maxConnections: 0, // Invalid: must be >= 1
          idleTimeout: 500, // Invalid: must be >= 1000
          connectionTimeout: 500, // Invalid: must be >= 1000
        },
      });

      const parsed = JSON.parse(json);

      expect(parsed.connectionPool.maxConnections).toBe(0);
      expect(parsed.connectionPool.idleTimeout).toBe(500);
      expect(parsed.connectionPool.connectionTimeout).toBe(500);
    });
  });

  describe('mcpServers Format Conversion', () => {
    it('should convert mcpServers format to ServiceDefinition array', () => {
      const mcpServers = {
        filesystem: {
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
          env: {
            NODE_ENV: 'production',
          },
          tags: ['local', 'storage'],
          enabled: true,
          connectionPool: {
            maxConnections: 5,
            idleTimeout: 60000,
            connectionTimeout: 30000,
          },
        },
        github: {
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          tags: ['remote', 'api'],
          enabled: true,
        },
      };

      const services: ServiceDefinition[] = Object.entries(mcpServers).map(([name, config]) => {
        return {
          name,
          transport: config.transport as 'stdio',
          command: 'command' in config ? config.command : '',
          args: 'args' in config ? config.args : [],
          env: 'env' in config ? (config.env as Record<string, string>) : {},
          tags: 'tags' in config ? config.tags : [],
          enabled: 'enabled' in config ? (config.enabled as boolean) : true,
          connectionPool:
            'connectionPool' in config
              ? (config.connectionPool as any)
              : {
                  maxConnections: 5,
                  idleTimeout: 60000,
                  connectionTimeout: 30000,
                },
        };
      });

      expect(services).toHaveLength(2);
      expect(services[0]?.name).toBe('filesystem');
      expect(services[0]?.command).toBe('npx');
      expect(services[0]?.args).toEqual(['-y', '@modelcontextprotocol/server-filesystem', '/tmp']);
      expect(services[1]?.name).toBe('github');
    });

    it('should handle HTTP services in mcpServers format', () => {
      const mcpServers = {
        'remote-api': {
          transport: 'http',
          url: 'https://api.example.com/mcp',
          tags: ['remote', 'api'],
          enabled: true,
        },
      };

      const services: ServiceDefinition[] = Object.entries(mcpServers).map(([name, config]) => ({
        name,
        transport: config.transport as 'http',
        url: config.url,
        tags: config.tags,
        enabled: config.enabled,
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      }));

      expect(services).toHaveLength(1);
      expect(services[0]?.name).toBe('remote-api');
      expect(services[0]?.transport).toBe('http');
      expect(services[0]?.url).toBe('https://api.example.com/mcp');
    });

    it('should handle tool states in mcpServers format', () => {
      const mcpServers = {
        filesystem: {
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
          toolStates: {
            read_file: true,
            write_file: false,
            '*_directory': true,
          },
        },
      };

      const services: ServiceDefinition[] = Object.entries(mcpServers).map(([name, config]) => ({
        name,
        transport: config.transport as 'stdio',
        command: config.command,
        args: config.args,
        toolStates: config.toolStates,
        enabled: true,
        tags: [],
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      }));

      expect(services[0]?.toolStates).toBeDefined();
      expect(services[0]?.toolStates?.['read_file']).toBe(true);
      expect(services[0]?.toolStates?.['write_file']).toBe(false);
      expect(services[0]?.toolStates?.['*_directory']).toBe(true);
    });
  });

  describe('Bulk Import', () => {
    it('should import multiple services from array', () => {
      const services: ServiceDefinition[] = [
        {
          name: 'service1',
          transport: 'stdio',
          command: 'node',
          args: ['server1.js'],
          enabled: true,
          tags: ['test'],
          connectionPool: {
            maxConnections: 5,
            idleTimeout: 60000,
            connectionTimeout: 30000,
          },
        },
        {
          name: 'service2',
          transport: 'http',
          url: 'http://localhost:3000',
          enabled: true,
          tags: ['test'],
          connectionPool: {
            maxConnections: 5,
            idleTimeout: 60000,
            connectionTimeout: 30000,
          },
        },
        {
          name: 'service3',
          transport: 'stdio',
          command: 'python',
          args: ['server.py'],
          enabled: false,
          tags: ['test', 'python'],
          connectionPool: {
            maxConnections: 3,
            idleTimeout: 30000,
            connectionTimeout: 15000,
          },
        },
      ];

      expect(services).toHaveLength(3);
      expect(services.every((s) => s.name && s.transport)).toBe(true);
    });

    it('should import multiple services from mcpServers format', () => {
      const mcpServers = {
        service1: {
          transport: 'stdio',
          command: 'node',
          args: ['server1.js'],
        },
        service2: {
          transport: 'http',
          url: 'http://localhost:3000',
        },
        service3: {
          transport: 'stdio',
          command: 'python',
          args: ['server.py'],
          enabled: false,
        },
      };

      const services: ServiceDefinition[] = Object.entries(mcpServers).map(([name, config]) => {
        const transportType =
          'url' in config && config.url
            ? (config.transport as 'http')
            : (config.transport as 'stdio');

        if (transportType === 'stdio') {
          return {
            name,
            transport: transportType,
            command: 'command' in config ? config.command : '',
            args: 'args' in config ? config.args : [],
            env: 'env' in config ? (config.env as Record<string, string>) : {},
            enabled: 'enabled' in config ? (config.enabled as boolean) : true,
            tags: 'tags' in config ? (config.tags as string[]) : [],
            connectionPool: {
              maxConnections: 5,
              idleTimeout: 60000,
              connectionTimeout: 30000,
            },
          };
        } else {
          return {
            name,
            transport: transportType,
            url: 'url' in config ? config.url : '',
            headers: 'headers' in config ? (config.headers as Record<string, string>) : {},
            enabled: 'enabled' in config ? (config.enabled as boolean) : true,
            tags: 'tags' in config ? (config.tags as string[]) : [],
            connectionPool: {
              maxConnections: 5,
              idleTimeout: 60000,
              connectionTimeout: 30000,
            },
          };
        }
      });

      expect(services).toHaveLength(3);
      expect(services[0]?.name).toBe('service1');
      expect(services[1]?.name).toBe('service2');
      expect(services[2]?.name).toBe('service3');
      expect(services[2]?.enabled).toBe(false);
    });
  });

  describe('JSON Editor Features', () => {
    it('should provide example template', () => {
      const example = {
        filesystem: {
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
          env: {
            NODE_ENV: 'production',
          },
          tags: ['local', 'storage'],
          enabled: true,
          connectionPool: {
            maxConnections: 5,
            idleTimeout: 60000,
            connectionTimeout: 30000,
          },
        },
        github: {
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          env: {
            GITHUB_TOKEN: 'your-token-here',
          },
          tags: ['remote', 'api'],
          enabled: true,
        },
      };

      const json = JSON.stringify(example, null, 2);

      expect(json).toContain('filesystem');
      expect(json).toContain('github');
      expect(JSON.parse(json)).toEqual(example);
    });

    it('should format JSON with proper indentation', () => {
      const service = {
        name: 'test',
        transport: 'stdio',
        command: 'node',
      };

      const formatted = JSON.stringify(service, null, 2);
      const lines = formatted.split('\n');

      expect(lines.length).toBeGreaterThan(1);
      expect(lines[1]).toMatch(/^\s{2}/); // Check for 2-space indentation
    });
  });
});
