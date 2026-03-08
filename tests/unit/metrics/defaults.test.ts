/**
 * Unit tests for metrics configuration defaults
 *
 * Requirements:
 * - 34.5: Support configurable collection interval and retention period
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_METRICS_CONFIG,
  createMetricsConfig,
  validateMetricsConfig,
} from '../../../src/metrics/defaults.js';

describe('Metrics Configuration', () => {
  describe('DEFAULT_METRICS_CONFIG', () => {
    it('should have valid default values', () => {
      expect(DEFAULT_METRICS_CONFIG.enabled).toBe(true);
      expect(DEFAULT_METRICS_CONFIG.collectionInterval).toBeGreaterThan(0);
      expect(DEFAULT_METRICS_CONFIG.retentionPeriod).toBeGreaterThan(0);
      expect(DEFAULT_METRICS_CONFIG.retentionPeriod).toBeGreaterThanOrEqual(
        DEFAULT_METRICS_CONFIG.collectionInterval
      );
    });
  });

  describe('createMetricsConfig', () => {
    it('should create config with defaults', () => {
      const config = createMetricsConfig();
      expect(config).toEqual(DEFAULT_METRICS_CONFIG);
    });

    it('should merge partial config with defaults', () => {
      const config = createMetricsConfig({
        enabled: false,
      });

      expect(config.enabled).toBe(false);
      expect(config.collectionInterval).toBe(DEFAULT_METRICS_CONFIG.collectionInterval);
      expect(config.retentionPeriod).toBe(DEFAULT_METRICS_CONFIG.retentionPeriod);
    });

    it('should override all defaults', () => {
      const config = createMetricsConfig({
        enabled: false,
        collectionInterval: 5000,
        retentionPeriod: 10000,
      });

      expect(config.enabled).toBe(false);
      expect(config.collectionInterval).toBe(5000);
      expect(config.retentionPeriod).toBe(10000);
    });
  });

  describe('validateMetricsConfig', () => {
    it('should validate valid config', () => {
      const result = validateMetricsConfig({
        enabled: true,
        collectionInterval: 1000,
        retentionPeriod: 5000,
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject negative collection interval', () => {
      const result = validateMetricsConfig({
        enabled: true,
        collectionInterval: -1000,
        retentionPeriod: 5000,
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('collectionInterval must be greater than 0');
    });

    it('should reject zero collection interval', () => {
      const result = validateMetricsConfig({
        enabled: true,
        collectionInterval: 0,
        retentionPeriod: 5000,
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('collectionInterval must be greater than 0');
    });

    it('should reject negative retention period', () => {
      const result = validateMetricsConfig({
        enabled: true,
        collectionInterval: 1000,
        retentionPeriod: -5000,
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('retentionPeriod must be greater than 0');
    });

    it('should reject zero retention period', () => {
      const result = validateMetricsConfig({
        enabled: true,
        collectionInterval: 1000,
        retentionPeriod: 0,
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('retentionPeriod must be greater than 0');
    });

    it('should reject retention period less than collection interval', () => {
      const result = validateMetricsConfig({
        enabled: true,
        collectionInterval: 5000,
        retentionPeriod: 1000,
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'retentionPeriod must be greater than or equal to collectionInterval'
      );
    });

    it('should allow retention period equal to collection interval', () => {
      const result = validateMetricsConfig({
        enabled: true,
        collectionInterval: 5000,
        retentionPeriod: 5000,
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return multiple errors', () => {
      const result = validateMetricsConfig({
        enabled: true,
        collectionInterval: -1000,
        retentionPeriod: -5000,
      });

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
    });
  });
});
