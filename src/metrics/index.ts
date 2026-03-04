/**
 * Metrics module exports
 */

export { MetricsCollector } from './collector.js';
export { MetricsService } from './service.js';
export {
  DEFAULT_METRICS_CONFIG,
  createMetricsConfig,
  validateMetricsConfig,
} from './defaults.js';
export type {
  ToolCallMetrics,
  ConnectionPoolMetrics,
  ErrorMetrics,
  ServiceMetrics,
  SessionMetrics,
  SystemMetrics,
  MetricsQueryOptions,
  MetricsConfig,
} from '../types/metrics.js';
