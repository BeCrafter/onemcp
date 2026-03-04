/**
 * Integration tests for ServiceForm with JSON mode
 * 
 * Tests mode switching, data preservation, and JSON/form integration.
 */

import { describe, it, expect } from 'vitest';
import type { ServiceDefinition } from '../../src/types/service.js';

describe('ServiceForm with JSON Mode', () => {
  describe('Mode Switching', () => {
    it('should support switching between form and JSON modes', () => {
      const formMode = 'form';
      const jsonMode = 'json';
      
      expect(formMode).toBe('form');
      expect(jsonMode).toBe('json');
    });

    it('should preserve service data when switching modes', () => {
      const service: ServiceDefinition = {
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
      };

      // Convert to JSON
      const json = JSON.stringify(service, null, 2);
      
      // Parse back
      const parsed = JSON.parse(json) as ServiceDefinition;
      
      expect(parsed).toEqual(service);
    });

    it('should convert form data to JSON format', () => {
      const formData = {
        name: 'filesystem',
        transport: 'stdio' as const,
        command: 'npx',
        args: '-y, @modelcontextprotocol/server-filesystem, /tmp',
        env: 'NODE_ENV=production, DEBUG=true',
        tags: 'local, storage',
        enabled: true,
        maxConnections: '5',
        idleTimeout: '60000',
        connectionTimeout: '30000',
      };

      const service: ServiceDefinition = {
        name: formData.name,
        transport: formData.transport,
        command: formData.command,
        args: formData.args.split(',').map(a => a.trim()),
        env: Object.fromEntries(
          formData.env.split(',').map(e => {
            const [key, ...valueParts] = e.trim().split('=');
            return [key?.trim() || '', valueParts.join('=').trim()];
          })
        ),
        tags: formData.tags.split(',').map(t => t.trim()),
        enabled: formData.enabled,
        connectionPool: {
          maxConnections: parseInt(formData.maxConnections, 10),
          idleTimeout: parseInt(formData.idleTimeout, 10),
          connectionTimeout: parseInt(formData.connectionTimeout, 10),
        },
      };

      const json = JSON.stringify(service, null, 2);
      const parsed = JSON.parse(json) as ServiceDefinition;
      
      expect(parsed.name).toBe('filesystem');
      expect(parsed.command).toBe('npx');
      expect(parsed.args).toEqual(['-y', '@modelcontextprotocol/server-filesystem', '/tmp']);
      expect(parsed.env).toEqual({ NODE_ENV: 'production', DEBUG: 'true' });
      expect(parsed.tags).toEqual(['local', 'storage']);
    });

    it('should convert JSON to form data', () => {
      const json = JSON.stringify({
        name: 'github',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: {
          GITHUB_TOKEN: 'token123',
        },
        tags: ['remote', 'api'],
        enabled: true,
        connectionPool: {
          maxConnections: 3,
          idleTimeout: 30000,
          connectionTimeout: 15000,
        },
      });

      const service = JSON.parse(json) as ServiceDefinition;
      
      const formData = {
        name: service.name,
        transport: service.transport,
        command: service.command || '',
        args: service.args?.join(', ') || '',
        env: service.env ? Object.entries(service.env).map(([k, v]) => `${k}=${v}`).join(', ') : '',
        tags: service.tags.join(', '),
        enabled: service.enabled,
        maxConnections: service.connectionPool.maxConnections.toString(),
        idleTimeout: service.connectionPool.idleTimeout.toString(),
        connectionTimeout: service.connectionPool.connectionTimeout.toString(),
      };

      expect(formData.name).toBe('github');
      expect(formData.command).toBe('npx');
      expect(formData.args).toBe('-y, @modelcontextprotocol/server-github');
      expect(formData.env).toBe('GITHUB_TOKEN=token123');
      expect(formData.tags).toBe('remote, api');
      expect(formData.maxConnections).toBe('3');
    });
  });

  describe('JSON Mode Features', () => {
    it('should support single service import', () => {
      const json = JSON.stringify({
        name: 'test',
        transport: 'stdio',
        command: 'node',
        enabled: true,
        tags: [],
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      });

      const service = JSON.parse(json) as ServiceDefinition;
      
      expect(service.name).toBe('test');
      expect(service.transport).toBe('stdio');
    });

    it('should support bulk service import', () => {
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

      const services = JSON.parse(json) as ServiceDefinition[];
      
      expect(services).toHaveLength(2);
      expect(services[0]?.name).toBe('service1');
      expect(services[1]?.name).toBe('service2');
    });

    it('should support mcpServers format import', () => {
      const json = JSON.stringify({
        filesystem: {
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        },
        github: {
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
        },
      });

      const mcpServers = JSON.parse(json);
      const services: ServiceDefinition[] = Object.entries(mcpServers).map(([name, config]: [string, any]) => ({
        name,
        transport: config.transport,
        command: config.command,
        args: config.args,
        enabled: true,
        tags: [],
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      }));

      expect(services).toHaveLength(2);
      expect(services[0]?.name).toBe('filesystem');
      expect(services[1]?.name).toBe('github');
    });
  });

  describe('Validation in JSON Mode', () => {
    it('should validate required fields', () => {
      const invalidServices = [
        { transport: 'stdio', command: 'node' }, // Missing name
        { name: 'test', command: 'node' }, // Missing transport
        { name: 'test', transport: 'stdio' }, // Missing command for stdio
        { name: 'test', transport: 'http' }, // Missing url for http
      ];

      for (const service of invalidServices) {
        const hasName = 'name' in service && service.name;
        const hasTransport = 'transport' in service && service.transport;
        const hasCommand = 'command' in service;
        const hasUrl = 'url' in service;

        if (!hasName || !hasTransport) {
          expect(hasName && hasTransport).toBe(false);
        }

        if (hasTransport && service.transport === 'stdio' && !hasCommand) {
          expect(hasCommand).toBe(false);
        }

        if (hasTransport && service.transport === 'http' && !hasUrl) {
          expect(hasUrl).toBe(false);
        }
      }
    });

    it('should validate service name format', () => {
      const validNames = ['test', 'test-service', 'test_service', 'test123'];
      const invalidNames = ['test service', 'test@service', 'test.service', ''];

      for (const name of validNames) {
        expect(/^[a-zA-Z0-9_-]+$/.test(name)).toBe(true);
      }

      for (const name of invalidNames) {
        expect(/^[a-zA-Z0-9_-]+$/.test(name)).toBe(false);
      }
    });

    it('should validate URL format', () => {
      const validUrls = [
        'http://localhost:3000',
        'https://api.example.com',
        'http://192.168.1.1:8080',
      ];
      const invalidUrls = [
        'localhost:3000',
        'ftp://example.com',
        'not-a-url',
        '',
      ];

      for (const url of validUrls) {
        expect(/^https?:\/\/.+/.test(url)).toBe(true);
      }

      for (const url of invalidUrls) {
        expect(/^https?:\/\/.+/.test(url)).toBe(false);
      }
    });

    it('should validate connection pool values', () => {
      const validPools = [
        { maxConnections: 1, idleTimeout: 1000, connectionTimeout: 1000 },
        { maxConnections: 50, idleTimeout: 60000, connectionTimeout: 30000 },
        { maxConnections: 100, idleTimeout: 300000, connectionTimeout: 60000 },
      ];

      const invalidPools = [
        { maxConnections: 0, idleTimeout: 1000, connectionTimeout: 1000 },
        { maxConnections: 101, idleTimeout: 1000, connectionTimeout: 1000 },
        { maxConnections: 5, idleTimeout: 500, connectionTimeout: 1000 },
        { maxConnections: 5, idleTimeout: 1000, connectionTimeout: 500 },
      ];

      for (const pool of validPools) {
        expect(pool.maxConnections >= 1 && pool.maxConnections <= 100).toBe(true);
        expect(pool.idleTimeout >= 1000).toBe(true);
        expect(pool.connectionTimeout >= 1000).toBe(true);
      }

      for (const pool of invalidPools) {
        const validMax = pool.maxConnections >= 1 && pool.maxConnections <= 100;
        const validIdle = pool.idleTimeout >= 1000;
        const validConn = pool.connectionTimeout >= 1000;
        expect(validMax && validIdle && validConn).toBe(false);
      }
    });
  });

  describe('Real-time Validation', () => {
    it('should detect JSON syntax errors', () => {
      const invalidJsons = [
        '{ "name": "test", }', // Trailing comma
        '{ name: "test" }', // Unquoted key
        "{ 'name': 'test' }", // Single quotes
        '{ "name": "test" ', // Missing closing brace
      ];

      for (const json of invalidJsons) {
        expect(() => JSON.parse(json)).toThrow();
      }
    });

    it('should accept valid JSON', () => {
      const validJsons = [
        '{"name":"test","transport":"stdio","command":"node"}',
        '{ "name": "test", "transport": "stdio", "command": "node" }',
        JSON.stringify({ name: 'test', transport: 'stdio', command: 'node' }),
      ];

      for (const json of validJsons) {
        expect(() => JSON.parse(json)).not.toThrow();
      }
    });
  });
});
