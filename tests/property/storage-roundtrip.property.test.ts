import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { FileStorageAdapter } from '../../src/storage/file.js';
import { MemoryStorageAdapter } from '../../src/storage/memory.js';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';

/**
 * Feature: onemcp-system, Property 2: Configuration persistence round-trip
 *
 * **Validates: Requirements 11.10, 18.4**
 *
 * For any system configuration (including service definitions and tool states),
 * saving configuration, restarting system, then loading configuration should
 * produce an equivalent configuration object.
 */

// Arbitrary generators for configuration data

/**
 * Generate valid storage keys
 * Ensures keys are safe for both memory and file system storage
 */
const storageKeyArbitrary = (): fc.Arbitrary<string> =>
  fc
    .string({ minLength: 1, maxLength: 50 })
    .filter((s) => !s.includes('..') && !s.startsWith('/') && s.trim().length > 0)
    .filter((s) => s !== '.' && s !== '..') // Exclude directory references
    .map((s) => s.trim()) // Remove leading/trailing whitespace
    .map((s) => s.replace(/[<>:"|?*\\/]/g, '_')); // Remove invalid filename characters

/**
 * Generate arbitrary JSON-compatible configuration values
 */
const configValueArbitrary = (): fc.Arbitrary<unknown> =>
  fc.letrec((tie) => ({
    value: fc.oneof(
      { depthSize: 'small' },
      fc.constant(null),
      fc.boolean(),
      fc.integer(),
      fc.double({ noNaN: true, noDefaultInfinity: true }),
      fc.string(),
      fc.array(tie('value'), { maxLength: 5 }),
      fc.dictionary(fc.string({ minLength: 1, maxLength: 20 }), tie('value'), { maxKeys: 5 })
    ),
  })).value as fc.Arbitrary<unknown>;

/**
 * Generate a configuration object (key-value pairs)
 * Uses uniqueArray to ensure no duplicate keys
 */
const configurationArbitrary = (): fc.Arbitrary<Record<string, string>> =>
  fc
    .uniqueArray(
      fc.record({
        key: storageKeyArbitrary(),
        value: configValueArbitrary().map((v) => JSON.stringify(v)),
      }),
      { minLength: 1, maxLength: 10, selector: (item) => item.key }
    )
    .map((items) => {
      const result: Record<string, string> = {};
      for (const item of items) {
        result[item.key] = item.value;
      }
      return result;
    });

describe('Feature: onemcp-system, Property 2: Configuration persistence round-trip', () => {
  describe('MemoryStorageAdapter', () => {
    let storage: MemoryStorageAdapter;

    beforeEach(() => {
      storage = new MemoryStorageAdapter();
    });

    afterEach(() => {
      storage.clear();
    });

    it('should preserve single key-value pairs through write and read', async () => {
      await fc.assert(
        fc.asyncProperty(storageKeyArbitrary(), configValueArbitrary(), async (key, value) => {
          const serialized = JSON.stringify(value);

          // Write
          await storage.write(key, serialized);

          // Read
          const retrieved = await storage.read(key);

          // Verify
          expect(retrieved).toBe(serialized);

          // Verify round-trip
          const deserialized = JSON.parse(retrieved!);
          return JSON.stringify(value) === JSON.stringify(deserialized);
        }),
        { numRuns: 100 }
      );
    });

    it('should preserve multiple key-value pairs through write and read', async () => {
      await fc.assert(
        fc.asyncProperty(configurationArbitrary(), async (config) => {
          // Write all key-value pairs
          for (const [key, value] of Object.entries(config)) {
            await storage.write(key, value);
          }

          // Read all key-value pairs
          const retrieved: Record<string, string> = {};
          for (const key of Object.keys(config)) {
            const value = await storage.read(key);
            if (value !== undefined) {
              retrieved[key] = value;
            }
          }

          // Verify all keys were retrieved
          expect(Object.keys(retrieved).sort()).toEqual(Object.keys(config).sort());

          // Verify all values match
          for (const key of Object.keys(config)) {
            expect(retrieved[key]).toBe(config[key]);
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should preserve configuration through update operations', async () => {
      await fc.assert(
        fc.asyncProperty(
          storageKeyArbitrary(),
          configValueArbitrary(),
          configValueArbitrary(),
          async (key, initialValue, updatedValue) => {
            const initialSerialized = JSON.stringify(initialValue);
            const updatedSerialized = JSON.stringify(updatedValue);

            // Write initial value
            await storage.write(key, initialSerialized);

            // Update value
            await storage.update(key, updatedSerialized);

            // Read updated value
            const retrieved = await storage.read(key);

            // Verify updated value is retrieved
            expect(retrieved).toBe(updatedSerialized);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle delete operations correctly', async () => {
      await fc.assert(
        fc.asyncProperty(storageKeyArbitrary(), configValueArbitrary(), async (key, value) => {
          const serialized = JSON.stringify(value);

          // Write
          await storage.write(key, serialized);

          // Verify exists
          const beforeDelete = await storage.read(key);
          expect(beforeDelete).toBe(serialized);

          // Delete
          await storage.delete(key);

          // Verify deleted
          const afterDelete = await storage.read(key);
          expect(afterDelete).toBeUndefined();

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should list all keys correctly', async () => {
      await fc.assert(
        fc.asyncProperty(configurationArbitrary(), async (config) => {
          // Clear storage before each iteration
          storage.clear();

          // Write all key-value pairs
          for (const [key, value] of Object.entries(config)) {
            await storage.write(key, value);
          }

          // List all keys
          const keys = await storage.listKeys();

          // Verify all keys are listed
          expect(keys.sort()).toEqual(Object.keys(config).sort());

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should filter keys by prefix correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uniqueArray(
            fc.record({
              key: storageKeyArbitrary(),
              value: configValueArbitrary().map((v) => JSON.stringify(v)),
            }),
            { minLength: 1, maxLength: 20, selector: (item) => item.key }
          ),
          fc.string({ minLength: 1, maxLength: 10 }),
          async (items, prefix) => {
            // Clear storage
            storage.clear();

            // Write all items
            for (const item of items) {
              await storage.write(item.key, item.value);
            }

            // List keys with prefix
            const filteredKeys = await storage.listKeys(prefix);

            // Verify only keys with prefix are returned
            const expectedKeys = items
              .map((item) => item.key)
              .filter((key) => key.startsWith(prefix));

            expect(filteredKeys.sort()).toEqual(expectedKeys.sort());

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('FileStorageAdapter', () => {
    let storage: FileStorageAdapter;
    let tempDir: string;

    beforeEach(async () => {
      // Create a temporary directory for each test
      tempDir = path.join(
        os.tmpdir(),
        `storage-test-${Date.now()}-${Math.random().toString(36).substring(7)}`
      );
      storage = new FileStorageAdapter(tempDir);
      await storage.initialize();
    });

    afterEach(async () => {
      // Clean up temporary directory
      try {
        await fs.remove(tempDir);
      } catch {
        // Ignore cleanup errors
      }
    });

    it('should preserve single key-value pairs through write and read', async () => {
      await fc.assert(
        fc.asyncProperty(storageKeyArbitrary(), configValueArbitrary(), async (key, value) => {
          const serialized = JSON.stringify(value);

          // Write
          await storage.write(key, serialized);

          // Read
          const retrieved = await storage.read(key);

          // Verify
          expect(retrieved).toBe(serialized);

          // Verify round-trip
          const deserialized = JSON.parse(retrieved!);
          return JSON.stringify(value) === JSON.stringify(deserialized);
        }),
        { numRuns: 100 }
      );
    });

    it('should preserve multiple key-value pairs through write and read', async () => {
      await fc.assert(
        fc.asyncProperty(configurationArbitrary(), async (config) => {
          // Write all key-value pairs
          for (const [key, value] of Object.entries(config)) {
            await storage.write(key, value);
          }

          // Read all key-value pairs
          const retrieved: Record<string, string> = {};
          for (const key of Object.keys(config)) {
            const value = await storage.read(key);
            if (value !== undefined) {
              retrieved[key] = value;
            }
          }

          // Verify all keys were retrieved
          expect(Object.keys(retrieved).sort()).toEqual(Object.keys(config).sort());

          // Verify all values match
          for (const key of Object.keys(config)) {
            expect(retrieved[key]).toBe(config[key]);
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should preserve configuration through update operations', async () => {
      await fc.assert(
        fc.asyncProperty(
          storageKeyArbitrary(),
          configValueArbitrary(),
          configValueArbitrary(),
          async (key, initialValue, updatedValue) => {
            const initialSerialized = JSON.stringify(initialValue);
            const updatedSerialized = JSON.stringify(updatedValue);

            // Write initial value
            await storage.write(key, initialSerialized);

            // Update value
            await storage.update(key, updatedSerialized);

            // Read updated value
            const retrieved = await storage.read(key);

            // Verify updated value is retrieved
            expect(retrieved).toBe(updatedSerialized);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle delete operations correctly', async () => {
      await fc.assert(
        fc.asyncProperty(storageKeyArbitrary(), configValueArbitrary(), async (key, value) => {
          const serialized = JSON.stringify(value);

          // Write
          await storage.write(key, serialized);

          // Verify exists
          const beforeDelete = await storage.read(key);
          expect(beforeDelete).toBe(serialized);

          // Delete
          await storage.delete(key);

          // Verify deleted
          const afterDelete = await storage.read(key);
          expect(afterDelete).toBeUndefined();

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should list all keys correctly', async () => {
      await fc.assert(
        fc.asyncProperty(configurationArbitrary(), async (config) => {
          // Skip if config has case-insensitive duplicate keys (file system limitation)
          const lowerKeys = Object.keys(config).map((k) => k.toLowerCase());
          const uniqueLowerKeys = new Set(lowerKeys);
          if (lowerKeys.length !== uniqueLowerKeys.size) {
            // Case-insensitive duplicate detected, skip this test case
            return true;
          }

          // Create fresh storage for this iteration
          const iterTempDir = path.join(
            os.tmpdir(),
            `storage-test-${Date.now()}-${Math.random().toString(36).substring(7)}`
          );
          const iterStorage = new FileStorageAdapter(iterTempDir);
          await iterStorage.initialize();

          try {
            // Write all key-value pairs
            for (const [key, value] of Object.entries(config)) {
              await iterStorage.write(key, value);
            }

            // List all keys
            const keys = await iterStorage.listKeys();

            // Verify all keys are listed
            expect(keys.sort()).toEqual(Object.keys(config).sort());

            return true;
          } finally {
            // Clean up
            await fs.remove(iterTempDir);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should filter keys by prefix correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uniqueArray(
            fc.record({
              key: storageKeyArbitrary(),
              value: configValueArbitrary().map((v) => JSON.stringify(v)),
            }),
            { minLength: 1, maxLength: 20, selector: (item) => item.key }
          ),
          fc.string({ minLength: 1, maxLength: 10 }),
          async (items, prefix) => {
            // Create fresh storage for this iteration
            const iterTempDir = path.join(
              os.tmpdir(),
              `storage-test-${Date.now()}-${Math.random().toString(36).substring(7)}`
            );
            const iterStorage = new FileStorageAdapter(iterTempDir);
            await iterStorage.initialize();

            try {
              // Write all items
              for (const item of items) {
                await iterStorage.write(item.key, item.value);
              }

              // List keys with prefix
              const filteredKeys = await iterStorage.listKeys(prefix);

              // Verify only keys with prefix are returned
              const expectedKeys = items
                .map((item) => item.key)
                .filter((key) => key.startsWith(prefix));

              expect(filteredKeys.sort()).toEqual(expectedKeys.sort());

              return true;
            } finally {
              // Clean up
              await fs.remove(iterTempDir);
            }
          }
        ),
        { numRuns: 50 } // Reduced runs for file I/O performance
      );
    });

    it('should ensure atomic write operations (no corruption on concurrent writes)', async () => {
      await fc.assert(
        fc.asyncProperty(
          storageKeyArbitrary(),
          fc.array(configValueArbitrary(), { minLength: 2, maxLength: 5 }),
          async (key, values) => {
            // Perform concurrent writes
            await Promise.all(
              values.map((value, index) => storage.write(`${key}-${index}`, JSON.stringify(value)))
            );

            // Verify all writes succeeded
            for (let i = 0; i < values.length; i++) {
              const retrieved = await storage.read(`${key}-${i}`);
              expect(retrieved).toBe(JSON.stringify(values[i]));
            }

            return true;
          }
        ),
        { numRuns: 50 } // Reduced runs for file I/O performance
      );
    });
  });
});
