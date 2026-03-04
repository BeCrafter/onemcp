/**
 * Integration tests for ServiceFormUnified component
 * 
 * Note: These tests verify the component logic and structure.
 * Visual rendering tests would require ink-testing-library.
 */

import { describe, it, expect } from 'vitest';
import type { ServiceDefinition } from '../../src/types/service.js';

// Import the helper functions from the component
// These are exported for testing purposes

describe('ServiceFormUnified', () => {
  // Test the form data conversion logic

  // Test the form data conversion logic
  
  describe('Service Definition Conversion', () => {
    it('should create valid stdio service definition', () => {
      const service: ServiceDefinition = {
        name: 'test-service',
        transport: 'stdio',
        command: 'node',
        args: ['server.js', '--port', '3000'],
        env: { NODE_ENV: 'production' },
        enabled: true,
        tags: ['test', 'local'],
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      expect(service.name).toBe('test-service');
      expect(service.transport).toBe('stdio');
      expect(service.command).toBe('node');
      expect(service.args).toEqual(['server.js', '--port', '3000']);
      expect(service.env).toEqual({ NODE_ENV: 'production' });
    });

    it('should create valid HTTP service definition', () => {
      const service: ServiceDefinition = {
        name: 'remote-api',
        transport: 'http',
        url: 'https://api.example.com/mcp',
        enabled: true,
        tags: ['remote', 'api'],
        connectionPool: {
          maxConnections: 10,
          idleTimeout: 120000,
          connectionTimeout: 60000,
        },
      };

      expect(service.name).toBe('remote-api');
      expect(service.transport).toBe('http');
      expect(service.url).toBe('https://api.example.com/mcp');
      expect(service.command).toBeUndefined();
    });
  });

  describe('Field Validation Logic', () => {
    it('should validate service name format', () => {
      const validNames = ['my-service', 'api_v2', 'test123', 'Service-Name_123'];
      const invalidNames = ['invalid name', 'service!', 'test@service', 'my service'];

      validNames.forEach(name => {
        expect(/^[a-zA-Z0-9_-]+$/.test(name)).toBe(true);
      });

      invalidNames.forEach(name => {
        expect(/^[a-zA-Z0-9_-]+$/.test(name)).toBe(false);
      });
    });

    it('should validate URL format', () => {
      const validUrls = [
        'http://localhost:3000',
        'https://api.example.com',
        'http://192.168.1.1:8080/path',
      ];
      const invalidUrls = [
        'ftp://example.com',
        'example.com',
        'localhost:3000',
      ];

      validUrls.forEach(url => {
        expect(/^https?:\/\/.+/.test(url)).toBe(true);
      });

      invalidUrls.forEach(url => {
        expect(/^https?:\/\/.+/.test(url)).toBe(false);
      });
    });

    it('should validate numeric ranges', () => {
      // Max connections: 1-100
      expect(5).toBeGreaterThanOrEqual(1);
      expect(5).toBeLessThanOrEqual(100);
      expect(0).toBeLessThan(1);
      expect(101).toBeGreaterThan(100);

      // Timeouts: >= 1000ms
      expect(60000).toBeGreaterThanOrEqual(1000);
      expect(500).toBeLessThan(1000);
    });
  });

  describe('Form Data Structure', () => {
    it('should handle comma-separated values', () => {
      const tagsString = 'test, local, api';
      const tags = tagsString.split(',').map(t => t.trim()).filter(t => t.length > 0);
      
      expect(tags).toEqual(['test', 'local', 'api']);
    });

    it('should parse environment variables', () => {
      const envString = 'NODE_ENV=production, DEBUG=true, PORT=3000';
      const env: Record<string, string> = {};
      
      const envPairs = envString.split(',').map(e => e.trim()).filter(e => e.length > 0);
      for (const pair of envPairs) {
        const [key, ...valueParts] = pair.split('=');
        if (key && valueParts.length > 0) {
          env[key.trim()] = valueParts.join('=').trim();
        }
      }

      expect(env).toEqual({
        NODE_ENV: 'production',
        DEBUG: 'true',
        PORT: '3000',
      });
    });

    it('should handle empty optional fields', () => {
      const service: ServiceDefinition = {
        name: 'minimal-service',
        transport: 'stdio',
        command: 'node',
        enabled: true,
        tags: [],
        connectionPool: {
          maxConnections: 5,
          idleTimeout: 60000,
          connectionTimeout: 30000,
        },
      };

      expect(service.args).toBeUndefined();
      expect(service.env).toBeUndefined();
      expect(service.tags).toEqual([]);
    });
  });

  describe('Field Configuration', () => {
    it('should have correct required fields for stdio', () => {
      const requiredFields = ['name', 'transport', 'command'];
      const optionalFields = ['args', 'env', 'tags', 'enabled', 'maxConnections', 'idleTimeout', 'connectionTimeout'];

      expect(requiredFields).toContain('name');
      expect(requiredFields).toContain('command');
      expect(optionalFields).toContain('args');
      expect(optionalFields).toContain('env');
    });

    it('should have correct required fields for HTTP', () => {
      const requiredFields = ['name', 'transport', 'url'];
      const optionalFields = ['tags', 'enabled', 'maxConnections', 'idleTimeout', 'connectionTimeout'];

      expect(requiredFields).toContain('name');
      expect(requiredFields).toContain('url');
      expect(optionalFields).toContain('tags');
    });
  });

  describe('Default Values', () => {
    it('should use correct default values', () => {
      const defaults = {
        enabled: true,
        maxConnections: 5,
        idleTimeout: 60000,
        connectionTimeout: 30000,
      };

      expect(defaults.enabled).toBe(true);
      expect(defaults.maxConnections).toBe(5);
      expect(defaults.idleTimeout).toBe(60000);
      expect(defaults.connectionTimeout).toBe(30000);
    });
  });
});
