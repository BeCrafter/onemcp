/**
 * Audit log type definitions
 */

/**
 * Request execution status
 */
export type ExecutionStatus = 'success' | 'error' | 'timeout';

/**
 * Routing decision information
 */
export interface RoutingDecision {
  /** Connection pool ID */
  poolId: string;
  /** Connection ID used */
  connectionId: string;
  /** Reason for routing decision */
  reason: string;
}

/**
 * Audit log entry for a request
 */
export interface AuditLogEntry {
  // Identifiers
  /** Unique request identifier */
  requestId: string;
  /** Correlation ID for tracking */
  correlationId: string;
  /** Session ID (if applicable) */
  sessionId?: string;
  /** AI Agent ID (if applicable) */
  agentId?: string;

  // Request information
  /** Tool name (namespaced) */
  toolName: string;
  /** Service name */
  serviceName: string;
  /** Connection ID */
  connectionId: string;

  // Timing information
  /** When the request was received */
  receivedAt: Date;
  /** When the request was routed */
  routedAt: Date;
  /** When the request completed */
  completedAt: Date;
  /** Total duration in milliseconds */
  duration: number;

  // Input/Output (optional based on config)
  /** Request input parameters */
  input?: unknown;
  /** Request output result */
  output?: unknown;

  // Status
  /** Execution status */
  status: ExecutionStatus;
  /** Error information if failed */
  error?: {
    code: number;
    message: string;
    stack?: string;
  };

  // Routing information
  /** Routing decision details */
  routingDecision: RoutingDecision;
}
