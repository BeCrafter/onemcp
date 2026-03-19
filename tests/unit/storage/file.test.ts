/**
 * Unit tests for FileStorageAdapter
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import { FileStorageAdapter } from '../../../src/storage/file';

describe('FileStorageAdapter', () => {
  let adapter: FileStorageAdapter;
  let testDir: string;

  beforeEach(async () => {
    // Create a temporary directory for testing
    testDir = path.join(os.tmpdir(), `file-storage-test-${Date.now()}`);
    adapter = new FileStorageAdapter(testDir);
    await adapter.initialize();
  });

  afterEach(async () => {
    // Clean up test directory
    await fs.remove(testDir);
  });

  describe('initialize', () => {
    it('should create the base directory if it does not exist', async () => {
      const newDir = path.join(os.tmpdir(), `file-storage-new-${Date.now()}`);
      const newAdapter = new FileStorageAdapter(newDir);

      await newAdapter.initialize();

      const exists = await fs.pathExists(newDir);
      expect(exists).toBe(true);

      // Clean up
      await fs.remove(newDir);
    });

    it('should not fail if directory already exists', async () => {
      await expect(adapter.initialize()).resolves.not.toThrow();
    });
  });

  describe('write and read', () => {
    it('should write and read a simple key-value pair', async () => {
      const key = 'test.json';
      const value = '{"test": "data"}';

      await adapter.write(key, value);
      const result = await adapter.read(key);

      expect(result).toBe(value);
    });

    it('should write and read nested keys', async () => {
      const key = 'config/services/test.json';
      const value = '{"service": "test"}';

      await adapter.write(key, value);
      const result = await adapter.read(key);

      expect(result).toBe(value);
    });

    it('should return undefined for non-existent keys', async () => {
      const result = await adapter.read('non-existent.json');
      expect(result).toBeUndefined();
    });

    it('should overwrite existing files', async () => {
      const key = 'test.json';

      await adapter.write(key, 'first');
      await adapter.write(key, 'second');

      const result = await adapter.read(key);
      expect(result).toBe('second');
    });

    it('should handle special characters in keys', async () => {
      const key = 'test-file_123.json';
      const value = 'test data';

      await adapter.write(key, value);
      const result = await adapter.read(key);

      expect(result).toBe(value);
    });

    it('should sanitize keys to prevent directory traversal', async () => {
      const key = '../../../etc/passwd';
      const value = 'malicious';

      await adapter.write(key, value);

      // Should write to sanitized path within baseDir
      const result = await adapter.read(key);
      expect(result).toBe(value);

      // Verify it's within the test directory
      const files = await fs.readdir(testDir, { recursive: true });
      expect(files.some((f) => f.includes('passwd'))).toBe(true);
    });
  });

  describe('update', () => {
    it('should update existing files', async () => {
      const key = 'test.json';

      await adapter.write(key, 'original');
      await adapter.update(key, 'updated');

      const result = await adapter.read(key);
      expect(result).toBe('updated');
    });

    it('should throw error when updating non-existent file', async () => {
      await expect(adapter.update('non-existent.json', 'data')).rejects.toThrow('does not exist');
    });
  });

  describe('delete', () => {
    it('should delete existing files', async () => {
      const key = 'test.json';

      await adapter.write(key, 'data');
      await adapter.delete(key);

      const result = await adapter.read(key);
      expect(result).toBeUndefined();
    });

    it('should not throw error when deleting non-existent file', async () => {
      await expect(adapter.delete('non-existent.json')).resolves.not.toThrow();
    });

    it('should delete nested files', async () => {
      const key = 'config/services/test.json';

      await adapter.write(key, 'data');
      await adapter.delete(key);

      const result = await adapter.read(key);
      expect(result).toBeUndefined();
    });
  });

  describe('listKeys', () => {
    it('should return empty array for empty directory', async () => {
      const keys = await adapter.listKeys();
      expect(keys).toEqual([]);
    });

    it('should list all keys', async () => {
      await adapter.write('file1.json', 'data1');
      await adapter.write('file2.json', 'data2');
      await adapter.write('config/file3.json', 'data3');

      const keys = await adapter.listKeys();

      expect(keys).toHaveLength(3);
      expect(keys).toContain('file1.json');
      expect(keys).toContain('file2.json');
      expect(keys).toContain(path.join('config', 'file3.json'));
    });

    it('should filter keys by prefix', async () => {
      await adapter.write('config/service1.json', 'data1');
      await adapter.write('config/service2.json', 'data2');
      await adapter.write('data/file.json', 'data3');

      const keys = await adapter.listKeys('config');

      expect(keys).toHaveLength(2);
      expect(keys.every((k) => k.startsWith('config'))).toBe(true);
    });

    it('should not include temporary files', async () => {
      await adapter.write('file1.json', 'data1');

      // Manually create a temp file
      const tempPath = path.join(testDir, 'file2.json.tmp');
      await fs.writeFile(tempPath, 'temp data');

      const keys = await adapter.listKeys();

      expect(keys).toHaveLength(1);
      expect(keys).toContain('file1.json');
      expect(keys).not.toContain('file2.json.tmp');
    });

    it('should handle nested directory structures', async () => {
      await adapter.write('a/b/c/file1.json', 'data1');
      await adapter.write('a/b/file2.json', 'data2');
      await adapter.write('a/file3.json', 'data3');

      const keys = await adapter.listKeys();

      expect(keys).toHaveLength(3);
      expect(keys).toContain(path.join('a', 'b', 'c', 'file1.json'));
      expect(keys).toContain(path.join('a', 'b', 'file2.json'));
      expect(keys).toContain(path.join('a', 'file3.json'));
    });
  });

  describe('atomic write operations', () => {
    it('should use temporary file during write', async () => {
      const key = 'test.json';
      const value = 'test data';

      // Write the file
      await adapter.write(key, value);

      // Verify no temp file remains
      const tempPath = path.join(testDir, 'test.json.tmp');
      const tempExists = await fs.pathExists(tempPath);
      expect(tempExists).toBe(false);

      // Verify actual file exists
      const result = await adapter.read(key);
      expect(result).toBe(value);
    });

    it('should clean up temp file on write failure', async () => {
      // Create a read-only directory to force write failure
      const readOnlyDir = path.join(testDir, 'readonly');
      await fs.ensureDir(readOnlyDir);
      await fs.chmod(readOnlyDir, 0o444);

      const key = 'readonly/test.json';

      try {
        await adapter.write(key, 'data');
      } catch {
        // Expected to fail
      }

      // Verify no temp file remains
      const files = await fs.readdir(readOnlyDir);
      expect(files.every((f) => !f.endsWith('.tmp'))).toBe(true);

      // Clean up
      await fs.chmod(readOnlyDir, 0o755);
    });
  });

  describe('error handling', () => {
    it('should throw descriptive error on read failure', async () => {
      // Create a directory with the same name as the key
      const key = 'test.json';
      const dirPath = path.join(testDir, key);
      await fs.ensureDir(dirPath);

      await expect(adapter.read(key)).rejects.toThrow('Failed to read file');
    });

    it('should throw descriptive error on write failure to invalid path', async () => {
      // Use a regular file as the "base directory" so mkdir fails because
      // a file already exists at that path — this works on all platforms.
      const fileAsDir = path.join(testDir, 'blocking-file.txt');
      await fs.writeFile(fileAsDir, 'i am a file, not a directory');

      const invalidAdapter = new FileStorageAdapter(fileAsDir);

      await expect(invalidAdapter.write('test.json', 'data')).rejects.toThrow(
        'Failed to write file'
      );
    });

    it('should handle delete of directory gracefully', async () => {
      // fs.remove can delete directories, so this should succeed
      const key = 'test.json';
      const dirPath = path.join(testDir, key);
      await fs.ensureDir(dirPath);
      await fs.writeFile(path.join(dirPath, 'file.txt'), 'data');

      // Should succeed - fs.remove can delete directories
      await expect(adapter.delete(key)).resolves.not.toThrow();
    });

    it('should return empty array for non-existent directory in listKeys', async () => {
      // Create an adapter with non-existent directory
      const invalidAdapter = new FileStorageAdapter('/tmp/non-existent-dir-' + Date.now());

      // Should return empty array, not throw
      const keys = await invalidAdapter.listKeys();
      expect(keys).toEqual([]);
    });
  });
});
