/**
 * Configuration provider type definitions
 */

import type { SystemConfig } from './config.js';
import type { ValidationResult } from './jsonrpc.js';

/**
 * Configuration provider interface
 */
export interface ConfigProvider {
  /**
   * Load configuration
   */
  load(): Promise<SystemConfig>;
  
  /**
   * Save configuration
   */
  save(config: SystemConfig): Promise<void>;
  
  /**
   * Validate configuration
   */
  validate(config: SystemConfig): ValidationResult;
  
  /**
   * Watch for configuration changes
   */
  watch(callback: (config: SystemConfig) => void): void;
}
