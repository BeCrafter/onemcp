/**
 * Storage adapter type definitions
 */

/**
 * Storage adapter interface for persisting configuration data
 */
export interface StorageAdapter {
  /**
   * Read data by key
   */
  read(key: string): Promise<string | undefined>;

  /**
   * Write data with key
   */
  write(key: string, value: string): Promise<void>;

  /**
   * Update existing data
   */
  update(key: string, value: string): Promise<void>;

  /**
   * Delete data by key
   */
  delete(key: string): Promise<void>;

  /**
   * List all keys with optional prefix filter
   */
  listKeys(prefix?: string): Promise<string[]>;
}
