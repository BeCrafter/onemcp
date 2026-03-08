/**
 * Unit tests for MemoryStorageAdapter
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStorageAdapter } from '../../../src/storage/memory';

describe('MemoryStorageAdapter', () => {
  let adapter: MemoryStorageAdapter;

  beforeEach(() => {
    adapter = new MemoryStorageAdapter();
  });

  describe('read', () => {
    it('should return undefined for non-existent key', async () => {
      const result = await adapter.read('non-existent');
      expect(result).toBeUndefined();
    });

    it('should return stored value for existing key', async () => {
      await adapter.write('test-key', 'test-value');
      const result = await adapter.read('test-key');
      expect(result).toBe('test-value');
    });
  });

  describe('write', () => {
    it('should store value with key', async () => {
      await adapter.write('key1', 'value1');
      const result = await adapter.read('key1');
      expect(result).toBe('value1');
    });

    it('should overwrite existing value', async () => {
      await adapter.write('key1', 'value1');
      await adapter.write('key1', 'value2');
      const result = await adapter.read('key1');
      expect(result).toBe('value2');
    });

    it('should store multiple keys independently', async () => {
      await adapter.write('key1', 'value1');
      await adapter.write('key2', 'value2');
      await adapter.write('key3', 'value3');

      expect(await adapter.read('key1')).toBe('value1');
      expect(await adapter.read('key2')).toBe('value2');
      expect(await adapter.read('key3')).toBe('value3');
    });
  });

  describe('update', () => {
    it('should update existing value', async () => {
      await adapter.write('key1', 'value1');
      await adapter.update('key1', 'updated-value');
      const result = await adapter.read('key1');
      expect(result).toBe('updated-value');
    });

    it('should throw error when updating non-existent key', async () => {
      await expect(adapter.update('non-existent', 'value')).rejects.toThrow(
        'Key non-existent does not exist'
      );
    });
  });

  describe('delete', () => {
    it('should delete existing key', async () => {
      await adapter.write('key1', 'value1');
      await adapter.delete('key1');
      const result = await adapter.read('key1');
      expect(result).toBeUndefined();
    });

    it('should silently succeed when deleting non-existent key', async () => {
      await expect(adapter.delete('non-existent')).resolves.toBeUndefined();
    });

    it('should not affect other keys', async () => {
      await adapter.write('key1', 'value1');
      await adapter.write('key2', 'value2');
      await adapter.delete('key1');

      expect(await adapter.read('key1')).toBeUndefined();
      expect(await adapter.read('key2')).toBe('value2');
    });
  });

  describe('listKeys', () => {
    it('should return empty array when no keys exist', async () => {
      const keys = await adapter.listKeys();
      expect(keys).toEqual([]);
    });

    it('should return all keys', async () => {
      await adapter.write('key1', 'value1');
      await adapter.write('key2', 'value2');
      await adapter.write('key3', 'value3');

      const keys = await adapter.listKeys();
      expect(keys).toHaveLength(3);
      expect(keys).toContain('key1');
      expect(keys).toContain('key2');
      expect(keys).toContain('key3');
    });

    it('should filter keys by prefix', async () => {
      await adapter.write('service/fs', 'value1');
      await adapter.write('service/github', 'value2');
      await adapter.write('config/main', 'value3');

      const keys = await adapter.listKeys('service/');
      expect(keys).toHaveLength(2);
      expect(keys).toContain('service/fs');
      expect(keys).toContain('service/github');
      expect(keys).not.toContain('config/main');
    });

    it('should return empty array when no keys match prefix', async () => {
      await adapter.write('key1', 'value1');
      await adapter.write('key2', 'value2');

      const keys = await adapter.listKeys('prefix/');
      expect(keys).toEqual([]);
    });
  });

  describe('clear', () => {
    it('should remove all stored data', async () => {
      await adapter.write('key1', 'value1');
      await adapter.write('key2', 'value2');
      await adapter.write('key3', 'value3');

      adapter.clear();

      expect(await adapter.read('key1')).toBeUndefined();
      expect(await adapter.read('key2')).toBeUndefined();
      expect(await adapter.read('key3')).toBeUndefined();
      expect(await adapter.listKeys()).toEqual([]);
    });
  });

  describe('size', () => {
    it('should return 0 for empty storage', () => {
      expect(adapter.size()).toBe(0);
    });

    it('should return correct count of stored items', async () => {
      await adapter.write('key1', 'value1');
      expect(adapter.size()).toBe(1);

      await adapter.write('key2', 'value2');
      expect(adapter.size()).toBe(2);

      await adapter.write('key3', 'value3');
      expect(adapter.size()).toBe(3);
    });

    it('should decrease count after deletion', async () => {
      await adapter.write('key1', 'value1');
      await adapter.write('key2', 'value2');
      expect(adapter.size()).toBe(2);

      await adapter.delete('key1');
      expect(adapter.size()).toBe(1);
    });

    it('should not increase count when overwriting', async () => {
      await adapter.write('key1', 'value1');
      expect(adapter.size()).toBe(1);

      await adapter.write('key1', 'value2');
      expect(adapter.size()).toBe(1);
    });
  });

  describe('edge cases', () => {
    it('should handle empty string values', async () => {
      await adapter.write('key1', '');
      const result = await adapter.read('key1');
      expect(result).toBe('');
    });

    it('should handle keys with special characters', async () => {
      const specialKey = 'key/with/slashes-and_underscores.json';
      await adapter.write(specialKey, 'value');
      const result = await adapter.read(specialKey);
      expect(result).toBe('value');
    });

    it('should handle large values', async () => {
      const largeValue = 'x'.repeat(10000);
      await adapter.write('large-key', largeValue);
      const result = await adapter.read('large-key');
      expect(result).toBe(largeValue);
    });

    it('should handle JSON data', async () => {
      const jsonData = JSON.stringify({ name: 'test', value: 123 });
      await adapter.write('json-key', jsonData);
      const result = await adapter.read('json-key');
      expect(result).toBe(jsonData);
      expect(JSON.parse(result!)).toEqual({ name: 'test', value: 123 });
    });
  });
});
