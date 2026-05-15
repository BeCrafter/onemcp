/**
 * Configuration-related type definitions
 */

import type { ServiceDefinition, ConnectionPoolConfig } from './service.js';
import type { TriggerHints } from '../protocol/smart-discovery-description.js';

/**
 * Deployment mode
 */
export type DeploymentMode = 'cli' | 'server' | 'tui';

/**
 * Log level
 */
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

/**
 * Audit log detail level
 */
export type AuditLevel = 'minimal' | 'standard' | 'verbose';

/**
 * Health check configuration
 */
export interface HealthCheckConfig {
  /** Whether health checks are enabled */
  enabled: boolean;
  /** Health check interval in milliseconds */
  interval: number;
  /** Number of failures before marking as unhealthy */
  failureThreshold: number;
  /** Whether to auto-unload tools from unhealthy services */
  autoUnload: boolean;
}

/**
 * Audit log retention policy
 */
export interface AuditRetentionPolicy {
  /** Number of days to retain logs */
  days: number;
  /** Maximum log size (e.g., "1GB") */
  maxSize: string;
}

/**
 * Audit log configuration
 */
export interface AuditConfig {
  /** Whether audit logging is enabled */
  enabled: boolean;
  /** Audit detail level */
  level: AuditLevel;
  /** Whether to log input parameters */
  logInput: boolean;
  /** Whether to log output results */
  logOutput: boolean;
  /** Log retention policy */
  retention: AuditRetentionPolicy;
}

/**
 * Data masking configuration
 */
export interface DataMaskingConfig {
  /** Whether data masking is enabled */
  enabled: boolean;
  /** Patterns to mask (e.g., "password", "token") */
  patterns: string[];
}

/**
 * Security configuration
 */
export interface SecurityConfig {
  /** Data masking configuration */
  dataMasking: DataMaskingConfig;
}

/**
 * Metrics configuration
 */
export interface MetricsConfig {
  /** Whether metrics collection is enabled */
  enabled: boolean;
  /** Metrics collection interval in milliseconds */
  collectionInterval: number;
  /** Metrics retention period in milliseconds */
  retentionPeriod: number;
}

/**
 * Tool discovery configuration for smart tool filtering
 */
export interface ToolDiscoveryConfig {
  /** Whether smart tool discovery is enabled (default: true) */
  smartDiscovery: boolean;
  /** Maximum number of results to return from search (default: 10) */
  maxResults?: number;
  /** Whether to search in tool descriptions (default: true) */
  searchDescription?: boolean;
  /**
   * When true, block startup until all service connections are verified and tool cache is warm.
   * When false (default), pre-warm the cache in the background without blocking startup.
   */
  eagerVerify?: boolean;
  /**
   * Custom synonym mappings to extend the built-in synonym table.
   * Key: query term (lowercase); Value: array of equivalent terms.
   * Example: { "deploy": ["publish", "release", "push"] }
   */
  synonyms?: Record<string, string[]>;
  /**
   * Per-service trigger hints surfaced in the smart-discovery search description.
   * Key: service name (matches `mcpServers` entry). Value: hints injected into the
   * PROACTIVE TRIGGERS / TRIGGER PHRASES sections in addition to whatever the
   * heuristic extractor finds in each tool's own description.
   */
  serviceTriggerHints?: Record<string, TriggerHints>;
  /**
   * Maximum length (in characters) of the dynamically composed search description.
   * Lower-priority service entries are dropped first when the budget is exceeded.
   * Defaults to 8000.
   */
  descriptionBudgetBytes?: number;
}

/**
 * Logging configuration
 */
export interface LoggingConfig {
  /** Log level */
  level: LogLevel;
  /** Log outputs (console, file, custom) */
  outputs: Array<'console' | 'file'>;
  /** Log format (json, pretty) */
  format: 'json' | 'pretty';
  /** Log file path (if file output is enabled) */
  filePath?: string;
}

/**
 * System configuration
 */
export interface SystemConfig {
  /** Deployment mode */
  mode: DeploymentMode;
  /** Server port (for server mode) */
  port?: number;
  /** Log level */
  logLevel: LogLevel;
  /** Configuration directory path */
  configDir: string;
  /** Registered MCP servers */
  mcpServers: Record<string, Omit<ServiceDefinition, 'name'>>;
  /** Default connection pool configuration */
  connectionPool: ConnectionPoolConfig;
  /** Health check configuration */
  healthCheck: HealthCheckConfig;
  /** Audit log configuration */
  audit: AuditConfig;
  /** Security configuration */
  security: SecurityConfig;
  /** Logging configuration */
  logging?: LoggingConfig;
  /** Metrics configuration */
  metrics?: MetricsConfig;
  /** Tool discovery configuration */
  toolDiscovery?: ToolDiscoveryConfig;
}

/**
 * Validation error details
 */
export interface ValidationError {
  /** Field path that failed validation */
  field: string;
  /** Error message */
  message: string;
  /** Expected value or constraint */
  expected?: unknown;
  /** Actual value that failed */
  actual?: unknown;
}

/**
 * Validation result
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** List of validation errors (empty if valid) */
  errors: ValidationError[];
}

/**
 * Configuration provider interface
 *
 * Responsible for loading, saving, validating, and watching configuration.
 * Implementations can load configuration from various sources (files, databases, APIs, etc.)
 */
export interface ConfigProvider {
  /**
   * Load configuration from storage
   * @returns Promise resolving to system configuration
   * @throws Error if configuration cannot be loaded or is invalid
   */
  load(): Promise<SystemConfig>;

  /**
   * Save configuration to storage
   * @param config - System configuration to save
   * @returns Promise resolving when save is complete
   * @throws Error if configuration cannot be saved
   */
  save(config: SystemConfig): Promise<void>;

  /**
   * Validate configuration structure and values
   * @param config - System configuration to validate
   * @returns Validation result with any errors found
   */
  validate(config: SystemConfig): ValidationResult;

  /**
   * Watch for configuration changes and invoke callback
   * @param callback - Function to call when configuration changes
   * @returns Function to stop watching
   */
  watch(callback: (config: SystemConfig) => void): () => void;
}
