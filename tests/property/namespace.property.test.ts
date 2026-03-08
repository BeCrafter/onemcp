import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { NamespaceManager } from '../../src/namespace/manager.js';

/**
 * Feature: onemcp-system
 * Property-based tests for Namespace Operations
 *
 * Tests:
 * - Property 6: Namespace round-trip
 *
 * **Validates: Requirements 4.1, 4.2**
 */

// ============================================================================
// Arbitrary Generators
// ============================================================================

/**
 * Generate valid service names that will sanitize to non-empty, valid identifiers
 * This ensures we test realistic service names that work with the namespace system
 */
const validServiceNameArbitrary = (): fc.Arbitrary<string> =>
  fc
    .string({ minLength: 1, maxLength: 50 })
    .map((s) => {
      // Ensure at least one alphanumeric character
      if (!/[a-zA-Z0-9]/.test(s)) {
        return 'service' + s;
      }
      return s;
    })
    .filter((s) => {
      const manager = new NamespaceManager();
      const sanitized = manager.sanitizeServiceName(s);
      // Must sanitize to a non-empty string that doesn't start/end with underscore or hyphen
      // and doesn't contain the delimiter "__"
      return (
        sanitized.length > 0 &&
        !sanitized.startsWith('_') &&
        !sanitized.endsWith('_') &&
        !sanitized.startsWith('-') &&
        !sanitized.endsWith('-') &&
        !sanitized.includes('__')
      );
    });

/**
 * Generate valid tool names (non-empty, non-whitespace-only strings)
 */
const validToolNameArbitrary = (): fc.Arbitrary<string> =>
  fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0);

/**
 * Generate tool names with double underscores
 */
const toolNameWithDoubleUnderscoresArbitrary = (): fc.Arbitrary<string> =>
  fc
    .array(
      fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
      { minLength: 2, maxLength: 5 }
    )
    .map((parts) => parts.join('__'));

// ============================================================================
// Property 6: Namespace Round-Trip
// ============================================================================

describe('Feature: onemcp-system, Property 6: Namespace round-trip', () => {
  const manager = new NamespaceManager();

  it('should preserve service and tool names through namespace generation and parsing', () => {
    fc.assert(
      fc.property(
        validServiceNameArbitrary(),
        validToolNameArbitrary(),
        (serviceName, toolName) => {
          // Generate namespaced name
          const namespaced = manager.generateNamespacedName(serviceName, toolName);

          // Parse namespaced name
          const parsed = manager.parseNamespacedName(namespaced);

          // Verify round-trip: parsed serviceName should equal sanitized original
          expect(parsed.serviceName).toBe(manager.sanitizeServiceName(serviceName));

          // Verify round-trip: parsed toolName should equal original
          expect(parsed.toolName).toBe(toolName);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle tool names with double underscores in round-trip', () => {
    fc.assert(
      fc.property(
        validServiceNameArbitrary(),
        toolNameWithDoubleUnderscoresArbitrary(),
        (serviceName, toolName) => {
          // Generate namespaced name
          const namespaced = manager.generateNamespacedName(serviceName, toolName);

          // Parse namespaced name
          const parsed = manager.parseNamespacedName(namespaced);

          // Verify service name is sanitized
          expect(parsed.serviceName).toBe(manager.sanitizeServiceName(serviceName));

          // Verify tool name with double underscores is preserved
          expect(parsed.toolName).toBe(toolName);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should maintain idempotency: sanitize(sanitize(name)) === sanitize(name)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 100 }), (serviceName) => {
        const sanitized1 = manager.sanitizeServiceName(serviceName);
        const sanitized2 = manager.sanitizeServiceName(sanitized1);

        // Sanitization should be idempotent
        expect(sanitized2).toBe(sanitized1);

        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('should handle mixed case service names consistently', () => {
    fc.assert(
      fc.property(
        validServiceNameArbitrary(),
        validToolNameArbitrary(),
        (serviceName, toolName) => {
          // Generate with original case
          const namespaced1 = manager.generateNamespacedName(serviceName, toolName);

          // Generate with different case
          const namespaced2 = manager.generateNamespacedName(serviceName.toUpperCase(), toolName);
          const namespaced3 = manager.generateNamespacedName(serviceName.toLowerCase(), toolName);

          // Parse all three
          const parsed1 = manager.parseNamespacedName(namespaced1);
          const parsed2 = manager.parseNamespacedName(namespaced2);
          const parsed3 = manager.parseNamespacedName(namespaced3);

          // All should have the same sanitized service name (lowercase)
          expect(parsed1.serviceName).toBe(parsed2.serviceName);
          expect(parsed2.serviceName).toBe(parsed3.serviceName);

          // All should have the same tool name
          expect(parsed1.toolName).toBe(toolName);
          expect(parsed2.toolName).toBe(toolName);
          expect(parsed3.toolName).toBe(toolName);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle service names with spaces consistently', () => {
    fc.assert(
      fc.property(
        fc
          .array(
            fc.string({ minLength: 1, maxLength: 20 }).filter((s) => /[a-zA-Z0-9]/.test(s)),
            { minLength: 2, maxLength: 5 }
          )
          .map((parts) => parts.join(' '))
          .filter((s) => {
            const sanitized = manager.sanitizeServiceName(s);
            return (
              sanitized.length > 0 &&
              !sanitized.startsWith('_') &&
              !sanitized.endsWith('_') &&
              !sanitized.startsWith('-') &&
              !sanitized.endsWith('-') &&
              !sanitized.includes('__')
            );
          }),
        validToolNameArbitrary(),
        (serviceName, toolName) => {
          // Generate namespaced name
          const namespaced = manager.generateNamespacedName(serviceName, toolName);

          // Parse namespaced name
          const parsed = manager.parseNamespacedName(namespaced);

          // Spaces should be converted to hyphens
          const expectedServiceName = manager.sanitizeServiceName(serviceName);
          expect(parsed.serviceName).toBe(expectedServiceName);
          expect(parsed.serviceName).not.toContain(' ');

          // Tool name should be preserved
          expect(parsed.toolName).toBe(toolName);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should preserve alphanumeric characters in service names', () => {
    fc.assert(
      fc.property(
        validServiceNameArbitrary(),
        validToolNameArbitrary(),
        (serviceName, toolName) => {
          const sanitized = manager.sanitizeServiceName(serviceName);

          // Generate and parse
          const namespaced = manager.generateNamespacedName(serviceName, toolName);
          const parsed = manager.parseNamespacedName(namespaced);

          // Sanitized name should only contain lowercase alphanumeric, hyphens, underscores
          expect(sanitized).toMatch(/^[a-z0-9\-_]+$/);

          // Parsed service name should match sanitized
          expect(parsed.serviceName).toBe(sanitized);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle very long service and tool names', () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 100, maxLength: 500 })
          .map((s) => 'service' + s) // Ensure it has valid content
          .filter((s) => {
            const sanitized = manager.sanitizeServiceName(s);
            return (
              sanitized.length > 0 &&
              !sanitized.startsWith('_') &&
              !sanitized.endsWith('_') &&
              !sanitized.startsWith('-') &&
              !sanitized.endsWith('-') &&
              !sanitized.includes('__')
            );
          }),
        fc.string({ minLength: 100, maxLength: 500 }).filter((t) => t.trim().length > 0),
        (serviceName, toolName) => {
          // Generate namespaced name
          const namespaced = manager.generateNamespacedName(serviceName, toolName);

          // Parse namespaced name
          const parsed = manager.parseNamespacedName(namespaced);

          // Verify round-trip
          expect(parsed.serviceName).toBe(manager.sanitizeServiceName(serviceName));
          expect(parsed.toolName).toBe(toolName);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle tool names with special characters', () => {
    fc.assert(
      fc.property(
        validServiceNameArbitrary(),
        fc
          .string({ minLength: 1, maxLength: 50 })
          .map((s) => s + '!@#$%^&*()')
          .filter((t) => t.trim().length > 0),
        (serviceName, toolName) => {
          // Generate namespaced name
          const namespaced = manager.generateNamespacedName(serviceName, toolName);

          // Parse namespaced name
          const parsed = manager.parseNamespacedName(namespaced);

          // Tool name should be preserved exactly (not sanitized)
          expect(parsed.toolName).toBe(toolName);

          // Service name should be sanitized
          expect(parsed.serviceName).toBe(manager.sanitizeServiceName(serviceName));

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should generate unique namespaced names for different service-tool pairs', () => {
    fc.assert(
      fc.property(
        validServiceNameArbitrary(),
        validServiceNameArbitrary(),
        validToolNameArbitrary(),
        validToolNameArbitrary(),
        (service1, service2, tool1, tool2) => {
          // Skip if pairs are identical after sanitization
          const sanitized1 = manager.sanitizeServiceName(service1);
          const sanitized2 = manager.sanitizeServiceName(service2);

          if (sanitized1 === sanitized2 && tool1 === tool2) {
            return true; // Skip this case
          }

          // Generate namespaced names
          const namespaced1 = manager.generateNamespacedName(service1, tool1);
          const namespaced2 = manager.generateNamespacedName(service2, tool2);

          // If service or tool differs, namespaced names should differ
          if (sanitized1 !== sanitized2 || tool1 !== tool2) {
            expect(namespaced1).not.toBe(namespaced2);
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle service names with hyphens and underscores', () => {
    fc.assert(
      fc.property(
        fc
          .array(
            fc.string({ minLength: 1, maxLength: 10 }).filter((s) => /[a-zA-Z0-9]/.test(s)),
            { minLength: 2, maxLength: 5 }
          )
          .chain((parts) => fc.constantFrom('-', '_').map((sep) => parts.join(sep)))
          .filter((s) => {
            const sanitized = manager.sanitizeServiceName(s);
            return (
              sanitized.length > 0 &&
              !sanitized.startsWith('_') &&
              !sanitized.endsWith('_') &&
              !sanitized.startsWith('-') &&
              !sanitized.endsWith('-') &&
              !sanitized.includes('__')
            );
          }),
        validToolNameArbitrary(),
        (serviceName, toolName) => {
          // Generate namespaced name
          const namespaced = manager.generateNamespacedName(serviceName, toolName);

          // Parse namespaced name
          const parsed = manager.parseNamespacedName(namespaced);

          // Hyphens and underscores should be preserved in sanitization
          const sanitized = manager.sanitizeServiceName(serviceName);
          expect(parsed.serviceName).toBe(sanitized);

          // Tool name should be preserved
          expect(parsed.toolName).toBe(toolName);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle multiple consecutive delimiters in tool names', () => {
    fc.assert(
      fc.property(
        validServiceNameArbitrary(),
        fc.integer({ min: 2, max: 10 }).chain((n) =>
          fc
            .array(
              fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.trim().length > 0),
              { minLength: n, maxLength: n }
            )
            .map((parts) => parts.join('__'))
        ),
        (serviceName, toolName) => {
          // Generate namespaced name
          const namespaced = manager.generateNamespacedName(serviceName, toolName);

          // Parse namespaced name
          const parsed = manager.parseNamespacedName(namespaced);

          // Tool name with multiple __ should be preserved
          expect(parsed.toolName).toBe(toolName);

          // Service name should be sanitized
          expect(parsed.serviceName).toBe(manager.sanitizeServiceName(serviceName));

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
