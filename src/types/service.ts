/**
 * Service-related type definitions for the MCP Router System
 */

/**
 * Transport protocol types supported by MCP servers
 */
export type TransportType = 'stdio' | 'sse' | 'http';

/**
 * Connection pool configuration for a service
 */
export interface ConnectionPoolConfig {
  /** Maximum number of concurrent connections (default: 5) */
  maxConnections: number;
  /** Idle timeout in milliseconds (default: 60000) */
  idleTimeout: number;
  /** Connection timeout in milliseconds (default: 30000) */
  connectionTimeout: number;
}

/**
 * Service definition for an MCP server
 */
export interface ServiceDefinition {
  /** Unique service name */
  name: string;
  /** Whether the service is enabled */
  enabled: boolean;
  /** Tags for categorization and filtering */
  tags: string[];

  /** Transport protocol type */
  transport: TransportType;

  /** Command to start the service (required for stdio transport) */
  command?: string;
  /** Command arguments (optional for stdio transport) */
  args?: string[];
  /** Environment variables (optional for stdio transport) */
  env?: Record<string, string>;

  /** Service URL (required for sse/http transport) */
  url?: string;

  /** Custom HTTP headers (optional for http/sse transport) */
  headers?: Record<string, string>;

  /** Connection pool configuration */
  connectionPool: ConnectionPoolConfig;

  /** Tool enable/disable states (pattern -> enabled) */
  toolStates?: Record<string, boolean>;

  /**
   * Optional trigger hints surfaced in the smart-discovery search description.
   * Use these when the upstream tool descriptions don't already advertise
   * MANDATORY/Must-Check style markers but the LLM should still call search
   * proactively for this service.
   */
  triggerHints?: {
    onSessionStart?: string;
    onSessionEnd?: string;
    phrases?: string[];
  };
}

/**
 * Connection state
 */
export type ConnectionState = 'idle' | 'busy' | 'closed';

/**
 * Connection to an MCP server
 */
export interface Connection {
  /** Unique connection identifier */
  id: string;
  /** Transport instance */
  transport: unknown; // Will be typed as Transport interface
  /** Current connection state */
  state: ConnectionState;
  /** Last time the connection was used */
  lastUsed: Date;
  /** When the connection was created */
  createdAt: Date;
}

/**
 * Connection pool statistics
 */
export interface PoolStats {
  /** Total number of connections */
  total: number;
  /** Number of idle connections */
  idle: number;
  /** Number of busy connections */
  busy: number;
  /** Number of waiting requests */
  waiting: number;
}

/**
 * Health status for a service
 */
export interface HealthStatus {
  /** Service name */
  serviceName: string;
  /** Whether the service is healthy */
  healthy: boolean;
  /** Last health check time */
  lastCheck: Date;
  /** Number of consecutive failures */
  consecutiveFailures: number;
  /** Error information if unhealthy */
  error?: {
    message: string;
    code: string;
    timestamp: Date;
  };
}
