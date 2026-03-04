/**
 * File-based storage adapter implementation
 */

import fs from 'fs-extra';
import path from 'node:path';
import { StorageAdapter } from '../types/storage.js';

/**
 * File-based storage adapter using fs-extra
 * Implements atomic write operations to prevent corruption
 */
export class FileStorageAdapter implements StorageAdapter {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  /**
   * Initialize the storage directory
   */
  async initialize(): Promise<void> {
    try {
      await fs.ensureDir(this.baseDir);
    } catch (error) {
      throw new Error(
        `Failed to initialize storage directory: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get the full file path for a key
   */
  private getFilePath(key: string): string {
    // Sanitize key to prevent directory traversal
    const sanitizedKey = key.replace(/\.\./g, '').replace(/^\/+/, '');
    return path.join(this.baseDir, sanitizedKey);
  }

  /**
   * Read data by key
   */
  async read(key: string): Promise<string | undefined> {
    const filePath = this.getFilePath(key);
    
    try {
      const exists = await fs.pathExists(filePath);
      if (!exists) {
        return undefined;
      }
      
      const data = await fs.readFile(filePath, 'utf-8');
      return data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw new Error(
        `Failed to read file ${key}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Write data with key using atomic write operation
   * Uses a temporary file and move to ensure atomicity
   */
  async write(key: string, value: string): Promise<void> {
    const filePath = this.getFilePath(key);
    const tempPath = `${filePath}.tmp`;
    
    try {
      // Ensure parent directory exists
      await fs.ensureDir(path.dirname(filePath));
      
      // Write to temporary file
      await fs.writeFile(tempPath, value, 'utf-8');
      
      // Atomic move (overwrites if exists)
      await fs.move(tempPath, filePath, { overwrite: true });
    } catch (error) {
      // Clean up temp file if it exists
      try {
        await fs.remove(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      
      throw new Error(
        `Failed to write file ${key}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Update existing data
   * Uses atomic write operation
   */
  async update(key: string, value: string): Promise<void> {
    const filePath = this.getFilePath(key);
    
    try {
      const exists = await fs.pathExists(filePath);
      if (!exists) {
        throw new Error(`File ${key} does not exist`);
      }
      
      // Use atomic write for update
      await this.write(key, value);
    } catch (error) {
      throw new Error(
        `Failed to update file ${key}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Delete data by key
   */
  async delete(key: string): Promise<void> {
    const filePath = this.getFilePath(key);
    
    try {
      const exists = await fs.pathExists(filePath);
      if (!exists) {
        // Silently succeed if file doesn't exist
        return;
      }
      
      await fs.remove(filePath);
    } catch (error) {
      throw new Error(
        `Failed to delete file ${key}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * List all keys with optional prefix filter
   */
  async listKeys(prefix?: string): Promise<string[]> {
    try {
      const exists = await fs.pathExists(this.baseDir);
      if (!exists) {
        return [];
      }
      
      const keys: string[] = [];
      
      // Recursively walk directory
      await this.walkDirectory(this.baseDir, this.baseDir, keys, prefix);
      
      return keys;
    } catch (error) {
      throw new Error(
        `Failed to list keys: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Recursively walk directory to collect file paths
   */
  private async walkDirectory(
    dir: string,
    baseDir: string,
    keys: string[],
    prefix?: string
  ): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        await this.walkDirectory(fullPath, baseDir, keys, prefix);
      } else if (entry.isFile()) {
        // Skip temporary files
        if (entry.name.endsWith('.tmp')) {
          continue;
        }
        
        // Get relative path from base directory
        const relativePath = path.relative(baseDir, fullPath);
        
        // Apply prefix filter if specified
        if (!prefix || relativePath.startsWith(prefix)) {
          keys.push(relativePath);
        }
      }
    }
  }
}
