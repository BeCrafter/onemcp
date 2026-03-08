/**
 * Default metrics configuration
 */

import type { MetricsConfig } from '../types/config.js';

/**
 * Default metrics configuration
 *
 * Requirements:
 * - 34.5: Support configurable collection interval and retention period
 */
export const DEFAULT_METRICS_CONFIG: MetricsConfig = {
  enabled: true,
  collectionInterval: 60000, // 1 minute
  retentionPeriod: 86400000, // 24 hours
};

/**
 * Create metrics configuration with defaults
 */
export function createMetricsConfig(partial?: Partial<MetricsConfig>): MetricsConfig {
  return {
    ...DEFAULT_METRICS_CONFIG,
    ...partial,
  };
}

/**
 * Validate metrics configuration
 */
export function validateMetricsConfig(config: MetricsConfig): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (config.collectionInterval <= 0) {
    errors.push('collectionInterval must be greater than 0');
  }

  if (config.retentionPeriod <= 0) {
    errors.push('retentionPeriod must be greater than 0');
  }

  if (config.retentionPeriod < config.collectionInterval) {
    errors.push('retentionPeriod must be greater than or equal to collectionInterval');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
