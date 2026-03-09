/**
 * In-memory storage adapter implementation for testing
 */

import { StorageAdapter } from '../types/storage';

/**
 * In-memory storage adapter using Map
 * Provides fast, non-persistent storage for testing purposes
 */
export class MemoryStorageAdapter implements StorageAdapter {
  private data: Map<string, string>;

  constructor() {
    this.data = new Map();
  }

  /**
   * Read data by key
   */
  async read(key: string): Promise<string | undefined> {
    return Promise.resolve(this.data.get(key));
  }

  /**
   * Write data with key
   */
  async write(key: string, value: string): Promise<void> {
    this.data.set(key, value);
    return Promise.resolve();
  }

  /**
   * Update existing data
   */
  async update(key: string, value: string): Promise<void> {
    if (!this.data.has(key)) {
      return Promise.reject(new Error(`Key ${key} does not exist`));
    }
    this.data.set(key, value);
    return Promise.resolve();
  }

  /**
   * Delete data by key
   */
  async delete(key: string): Promise<void> {
    this.data.delete(key);
    return Promise.resolve();
  }

  /**
   * List all keys with optional prefix filter
   */
  async listKeys(prefix?: string): Promise<string[]> {
    const keys = Array.from(this.data.keys());

    if (prefix) {
      return Promise.resolve(keys.filter((key) => key.startsWith(prefix)));
    }

    return Promise.resolve(keys);
  }

  /**
   * Clear all data (useful for testing)
   */
  clear(): void {
    this.data.clear();
  }

  /**
   * Get the number of stored items (useful for testing)
   */
  size(): number {
    return this.data.size;
  }
}
