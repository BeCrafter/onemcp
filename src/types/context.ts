/**
 * Request context and session-related type definitions
 */

import type { TagFilter } from './tool.js';

// Re-export TagFilter for convenience
export type { TagFilter } from './tool.js';

/**
 * Request context for tracking and routing
 */
export interface RequestContext {
  /** Unique request identifier */
  requestId: string;
  /** Correlation ID for tracking across services */
  correlationId: string;
  /** Session ID (for Server mode) */
  sessionId?: string;
  /** AI Agent ID (for Server mode) */
  agentId?: string;
  /** Request timestamp */
  timestamp: Date;
  /** Tag filter for service/tool filtering */
  tagFilter?: TagFilter;
}

/**
 * Resource limits for a session
 */
export interface ResourceLimits {
  /** Maximum concurrent requests */
  maxConcurrentRequests?: number;
  /** Request timeout in milliseconds */
  requestTimeout?: number;
  /** Maximum batch size */
  maxBatchSize?: number;
}

/**
 * Session context
 */
export interface SessionContext {
  /** Tag filter for this session */
  tagFilter?: TagFilter;
  /** Resource limits for this session */
  resourceLimits?: ResourceLimits;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Session for an AI Agent connection
 */
export interface Session {
  /** Unique session identifier */
  id: string;
  /** AI Agent identifier */
  agentId: string;
  /** When the session was created */
  createdAt: Date;
  /** Last activity timestamp */
  lastActivity: Date;
  /** Request queue (implementation-specific) */
  requestQueue: unknown;
  /** Session context */
  context: SessionContext;
}
