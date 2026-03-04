/**
 * Unit tests for NamespaceManager
 */

import { describe, it, expect } from 'vitest';
import { NamespaceManager } from '../../../src/namespace/manager';

describe('NamespaceManager', () => {
  const manager = new NamespaceManager();

  describe('generateNamespacedName', () => {
    it('should generate namespaced name with double underscore delimiter', () => {
      const result = manager.generateNamespacedName('my-service', 'read_file');
      expect(result).toBe('my-service__read_file');
    });

    it('should sanitize service name before generating namespace', () => {
      const result = manager.generateNamespacedName('My Service!', 'read_file');
      expect(result).toBe('my-service__read_file');
    });

    it('should keep tool name as-is', () => {
      const result = manager.generateNamespacedName('service', 'Tool_With_Special!@#');
      expect(result).toBe('service__Tool_With_Special!@#');
    });

    it('should handle service names with spaces', () => {
      const result = manager.generateNamespacedName('my service name', 'tool');
      expect(result).toBe('my-service-name__tool');
    });

    it('should handle service names with multiple special characters', () => {
      const result = manager.generateNamespacedName('My@Service#123!', 'tool');
      expect(result).toBe('myservice123__tool');
    });

    it('should preserve hyphens and underscores in service names', () => {
      const result = manager.generateNamespacedName('my-service_name', 'tool');
      expect(result).toBe('my-service_name__tool');
    });
  });

  describe('parseNamespacedName', () => {
    it('should parse valid namespaced name', () => {
      const result = manager.parseNamespacedName('my-service__read_file');
      expect(result).toEqual({
        serviceName: 'my-service',
        toolName: 'read_file',
      });
    });

    it('should handle tool names with double underscores', () => {
      const result = manager.parseNamespacedName('service__tool__with__underscores');
      expect(result).toEqual({
        serviceName: 'service',
        toolName: 'tool__with__underscores',
      });
    });

    it('should throw error for names without delimiter', () => {
      expect(() => {
        manager.parseNamespacedName('invalid-name');
      }).toThrow('Invalid namespaced name');
    });

    it('should throw error for empty service name', () => {
      expect(() => {
        manager.parseNamespacedName('__tool');
      }).toThrow('Both service name and tool name must be non-empty');
    });

    it('should throw error for empty tool name', () => {
      expect(() => {
        manager.parseNamespacedName('service__');
      }).toThrow('Both service name and tool name must be non-empty');
    });

    it('should handle special characters in tool names', () => {
      const result = manager.parseNamespacedName('service__tool!@#$%');
      expect(result).toEqual({
        serviceName: 'service',
        toolName: 'tool!@#$%',
      });
    });
  });

  describe('sanitizeServiceName', () => {
    it('should convert to lowercase', () => {
      const result = manager.sanitizeServiceName('MyService');
      expect(result).toBe('myservice');
    });

    it('should convert spaces to hyphens', () => {
      const result = manager.sanitizeServiceName('my service name');
      expect(result).toBe('my-service-name');
    });

    it('should remove special characters', () => {
      const result = manager.sanitizeServiceName('my@service#123!');
      expect(result).toBe('myservice123');
    });

    it('should preserve hyphens', () => {
      const result = manager.sanitizeServiceName('my-service');
      expect(result).toBe('my-service');
    });

    it('should preserve underscores', () => {
      const result = manager.sanitizeServiceName('my_service');
      expect(result).toBe('my_service');
    });

    it('should preserve numbers', () => {
      const result = manager.sanitizeServiceName('service123');
      expect(result).toBe('service123');
    });

    it('should handle multiple consecutive spaces', () => {
      const result = manager.sanitizeServiceName('my   service');
      expect(result).toBe('my-service');
    });

    it('should handle empty string', () => {
      const result = manager.sanitizeServiceName('');
      expect(result).toBe('');
    });

    it('should handle string with only special characters', () => {
      const result = manager.sanitizeServiceName('!@#$%^&*()');
      expect(result).toBe('');
    });

    it('should handle mixed case with special characters', () => {
      const result = manager.sanitizeServiceName('My-Service_Name!@#123');
      expect(result).toBe('my-service_name123');
    });
  });

  describe('round-trip consistency', () => {
    it('should maintain consistency for generate then parse', () => {
      const serviceName = 'my-service';
      const toolName = 'read_file';
      
      const namespaced = manager.generateNamespacedName(serviceName, toolName);
      const parsed = manager.parseNamespacedName(namespaced);
      
      expect(parsed.serviceName).toBe(serviceName);
      expect(parsed.toolName).toBe(toolName);
    });

    it('should maintain consistency with sanitization', () => {
      const serviceName = 'My Service!';
      const toolName = 'read_file';
      
      const namespaced = manager.generateNamespacedName(serviceName, toolName);
      const parsed = manager.parseNamespacedName(namespaced);
      
      // Service name should be sanitized
      expect(parsed.serviceName).toBe(manager.sanitizeServiceName(serviceName));
      expect(parsed.toolName).toBe(toolName);
    });

    it('should handle tool names with double underscores in round-trip', () => {
      const serviceName = 'service';
      const toolName = 'tool__with__underscores';
      
      const namespaced = manager.generateNamespacedName(serviceName, toolName);
      const parsed = manager.parseNamespacedName(namespaced);
      
      expect(parsed.serviceName).toBe(serviceName);
      expect(parsed.toolName).toBe(toolName);
    });
  });

  describe('edge cases', () => {
    it('should handle very long service names', () => {
      const longName = 'a'.repeat(1000);
      const result = manager.sanitizeServiceName(longName);
      expect(result).toBe(longName);
    });

    it('should handle very long tool names', () => {
      const longTool = 'tool_' + 'a'.repeat(1000);
      const namespaced = manager.generateNamespacedName('service', longTool);
      const parsed = manager.parseNamespacedName(namespaced);
      expect(parsed.toolName).toBe(longTool);
    });

    it('should handle unicode characters in service names', () => {
      const result = manager.sanitizeServiceName('service-中文-名称');
      // Unicode characters should be removed
      expect(result).toBe('service--');
    });

    it('should handle service name with only spaces', () => {
      const result = manager.sanitizeServiceName('   ');
      expect(result).toBe('-');
    });

    describe('special characters in service names', () => {
      it('should handle exclamation mark', () => {
        const result = manager.sanitizeServiceName('service!name');
        expect(result).toBe('servicename');
      });

      it('should handle at symbol', () => {
        const result = manager.sanitizeServiceName('service@name');
        expect(result).toBe('servicename');
      });

      it('should handle hash symbol', () => {
        const result = manager.sanitizeServiceName('service#name');
        expect(result).toBe('servicename');
      });

      it('should handle dollar sign', () => {
        const result = manager.sanitizeServiceName('service$name');
        expect(result).toBe('servicename');
      });

      it('should handle percent sign', () => {
        const result = manager.sanitizeServiceName('service%name');
        expect(result).toBe('servicename');
      });

      it('should handle caret', () => {
        const result = manager.sanitizeServiceName('service^name');
        expect(result).toBe('servicename');
      });

      it('should handle ampersand', () => {
        const result = manager.sanitizeServiceName('service&name');
        expect(result).toBe('servicename');
      });

      it('should handle asterisk', () => {
        const result = manager.sanitizeServiceName('service*name');
        expect(result).toBe('servicename');
      });

      it('should handle parentheses', () => {
        const result = manager.sanitizeServiceName('service(name)');
        expect(result).toBe('servicename');
      });

      it('should handle brackets', () => {
        const result = manager.sanitizeServiceName('service[name]');
        expect(result).toBe('servicename');
      });

      it('should handle braces', () => {
        const result = manager.sanitizeServiceName('service{name}');
        expect(result).toBe('servicename');
      });

      it('should handle pipe', () => {
        const result = manager.sanitizeServiceName('service|name');
        expect(result).toBe('servicename');
      });

      it('should handle backslash', () => {
        const result = manager.sanitizeServiceName('service\\name');
        expect(result).toBe('servicename');
      });

      it('should handle forward slash', () => {
        const result = manager.sanitizeServiceName('service/name');
        expect(result).toBe('servicename');
      });

      it('should handle colon', () => {
        const result = manager.sanitizeServiceName('service:name');
        expect(result).toBe('servicename');
      });

      it('should handle semicolon', () => {
        const result = manager.sanitizeServiceName('service;name');
        expect(result).toBe('servicename');
      });

      it('should handle quotes', () => {
        const result = manager.sanitizeServiceName('service"name\'test');
        expect(result).toBe('servicenametest');
      });

      it('should handle less than and greater than', () => {
        const result = manager.sanitizeServiceName('service<name>');
        expect(result).toBe('servicename');
      });

      it('should handle comma and period', () => {
        const result = manager.sanitizeServiceName('service,name.test');
        expect(result).toBe('servicenametest');
      });

      it('should handle question mark', () => {
        const result = manager.sanitizeServiceName('service?name');
        expect(result).toBe('servicename');
      });

      it('should handle tilde', () => {
        const result = manager.sanitizeServiceName('service~name');
        expect(result).toBe('servicename');
      });

      it('should handle backtick', () => {
        const result = manager.sanitizeServiceName('service`name');
        expect(result).toBe('servicename');
      });

      it('should handle plus and equals', () => {
        const result = manager.sanitizeServiceName('service+name=test');
        expect(result).toBe('servicenametest');
      });

      it('should handle all special characters together', () => {
        const result = manager.sanitizeServiceName('!@#$%^&*()[]{}|\\/:;"\'<>,.?~`+=');
        expect(result).toBe('');
      });
    });

    describe('double underscore in tool names', () => {
      it('should preserve double underscore at start of tool name', () => {
        const namespaced = manager.generateNamespacedName('service', '__private_tool');
        const parsed = manager.parseNamespacedName(namespaced);
        expect(parsed.serviceName).toBe('service');
        expect(parsed.toolName).toBe('__private_tool');
      });

      it('should preserve double underscore at end of tool name', () => {
        const namespaced = manager.generateNamespacedName('service', 'tool__');
        const parsed = manager.parseNamespacedName(namespaced);
        expect(parsed.serviceName).toBe('service');
        expect(parsed.toolName).toBe('tool__');
      });

      it('should preserve multiple double underscores in tool name', () => {
        const namespaced = manager.generateNamespacedName('service', 'tool__name__test__end');
        const parsed = manager.parseNamespacedName(namespaced);
        expect(parsed.serviceName).toBe('service');
        expect(parsed.toolName).toBe('tool__name__test__end');
      });

      it('should preserve triple underscore in tool name', () => {
        const namespaced = manager.generateNamespacedName('service', 'tool___name');
        const parsed = manager.parseNamespacedName(namespaced);
        expect(parsed.serviceName).toBe('service');
        expect(parsed.toolName).toBe('tool___name');
      });

      it('should handle tool name that is only underscores', () => {
        const namespaced = manager.generateNamespacedName('service', '____');
        const parsed = manager.parseNamespacedName(namespaced);
        expect(parsed.serviceName).toBe('service');
        expect(parsed.toolName).toBe('____');
      });

      it('should correctly parse when service name ends with underscore', () => {
        // Note: When service name ends with underscore, the generated name has 3+ underscores
        // The parser finds the first __ occurrence, which may not preserve trailing underscores
        const namespaced = manager.generateNamespacedName('service_', 'tool');
        // Generated: service___tool
        // Parser finds first __ at position 7, giving: service + _tool
        const parsed = manager.parseNamespacedName(namespaced);
        expect(parsed.serviceName).toBe('service');
        expect(parsed.toolName).toBe('_tool');
      });

      it('should handle complex case with underscores in both names', () => {
        const namespaced = manager.generateNamespacedName('my_service_name', 'my__tool__name');
        const parsed = manager.parseNamespacedName(namespaced);
        expect(parsed.serviceName).toBe('my_service_name');
        expect(parsed.toolName).toBe('my__tool__name');
      });
    });

    describe('empty strings and boundary conditions', () => {
      it('should handle empty service name', () => {
        const result = manager.sanitizeServiceName('');
        expect(result).toBe('');
      });

      it('should handle empty tool name in generation', () => {
        const namespaced = manager.generateNamespacedName('service', '');
        expect(namespaced).toBe('service__');
      });

      it('should throw error when parsing empty tool name', () => {
        expect(() => {
          manager.parseNamespacedName('service__');
        }).toThrow('Both service name and tool name must be non-empty');
      });

      it('should throw error when parsing empty service name', () => {
        expect(() => {
          manager.parseNamespacedName('__tool');
        }).toThrow('Both service name and tool name must be non-empty');
      });

      it('should throw error when parsing only delimiter', () => {
        expect(() => {
          manager.parseNamespacedName('__');
        }).toThrow('Both service name and tool name must be non-empty');
      });

      it('should handle single character service name', () => {
        const result = manager.sanitizeServiceName('a');
        expect(result).toBe('a');
      });

      it('should handle single character tool name', () => {
        const namespaced = manager.generateNamespacedName('service', 'x');
        const parsed = manager.parseNamespacedName(namespaced);
        expect(parsed.toolName).toBe('x');
      });

      it('should handle service name with only whitespace', () => {
        const result = manager.sanitizeServiceName('     ');
        expect(result).toBe('-');
      });

      it('should handle service name with tabs and newlines', () => {
        const result = manager.sanitizeServiceName('\t\n\r');
        expect(result).toBe('-');
      });

      it('should handle service name with mixed whitespace', () => {
        const result = manager.sanitizeServiceName('  \t  \n  ');
        expect(result).toBe('-');
      });

      it('should handle tool name with only whitespace', () => {
        const namespaced = manager.generateNamespacedName('service', '   ');
        expect(namespaced).toBe('service__   ');
      });

      it('should handle zero-width characters in service name', () => {
        const result = manager.sanitizeServiceName('service\u200Bname');
        expect(result).toBe('servicename');
      });

      it('should handle service name at maximum reasonable length', () => {
        const maxName = 'a'.repeat(255);
        const result = manager.sanitizeServiceName(maxName);
        expect(result).toBe(maxName);
        expect(result.length).toBe(255);
      });

      it('should handle tool name at maximum reasonable length', () => {
        const maxTool = 'tool_' + 'x'.repeat(250);
        const namespaced = manager.generateNamespacedName('service', maxTool);
        const parsed = manager.parseNamespacedName(namespaced);
        expect(parsed.toolName).toBe(maxTool);
      });

      it('should handle service name with leading and trailing spaces', () => {
        const result = manager.sanitizeServiceName('  service  ');
        expect(result).toBe('-service-');
      });

      it('should handle service name with leading special characters', () => {
        const result = manager.sanitizeServiceName('!!!service');
        expect(result).toBe('service');
      });

      it('should handle service name with trailing special characters', () => {
        const result = manager.sanitizeServiceName('service!!!');
        expect(result).toBe('service');
      });

      it('should handle service name with only numbers', () => {
        const result = manager.sanitizeServiceName('12345');
        expect(result).toBe('12345');
      });

      it('should handle service name starting with number', () => {
        const result = manager.sanitizeServiceName('123service');
        expect(result).toBe('123service');
      });

      it('should handle service name with consecutive hyphens', () => {
        const result = manager.sanitizeServiceName('service---name');
        expect(result).toBe('service---name');
      });

      it('should handle service name with consecutive underscores', () => {
        const result = manager.sanitizeServiceName('service___name');
        expect(result).toBe('service___name');
      });
    });
  });
});
