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
    return this.data.get(key);
  }

  /**
   * Write data with key
   */
  async write(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }

  /**
   * Update existing data
   */
  async update(key: string, value: string): Promise<void> {
    if (!this.data.has(key)) {
      throw new Error(`Key ${key} does not exist`);
    }
    this.data.set(key, value);
  }

  /**
   * Delete data by key
   */
  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  /**
   * List all keys with optional prefix filter
   */
  async listKeys(prefix?: string): Promise<string[]> {
    const keys = Array.from(this.data.keys());
    
    if (prefix) {
      return keys.filter(key => key.startsWith(prefix));
    }
    
    return keys;
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
