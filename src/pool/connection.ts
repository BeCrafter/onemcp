/**
 * Connection management for MCP Router System
 *
 * This module defines the Connection interface and related types for managing
 * connections to backend MCP servers. Connections track their state (idle, busy, closed),
 * timestamps, and the underlying transport instance.
 */

import type { Transport } from '../types/transport.js';
import type { ConnectionState } from '../types/service.js';

/**
 * Connection to an MCP server
 *
 * Represents a single connection to a backend MCP server, including its state,
 * transport instance, and lifecycle timestamps.
 */
export interface Connection {
  /** Unique connection identifier */
  id: string;

  /** Transport instance for communication */
  transport: Transport;

  /** Current connection state (idle, busy, closed) */
  state: ConnectionState;

  /** Last time the connection was used */
  lastUsed: Date;

  /** When the connection was created */
  createdAt: Date;
}

/**
 * Create a new connection instance
 *
 * @param id - Unique connection identifier
 * @param transport - Transport instance for communication
 * @returns New connection in idle state
 */
export function createConnection(id: string, transport: Transport): Connection {
  const now = new Date();
  return {
    id,
    transport,
    state: 'idle',
    lastUsed: now,
    createdAt: now,
  };
}

/**
 * Update connection state
 *
 * @param connection - Connection to update
 * @param state - New state
 * @returns Updated connection
 */
export function updateConnectionState(connection: Connection, state: ConnectionState): Connection {
  return {
    ...connection,
    state,
    lastUsed: state === 'busy' ? new Date() : connection.lastUsed,
  };
}

/**
 * Check if connection is idle
 *
 * @param connection - Connection to check
 * @returns True if connection is idle
 */
export function isIdle(connection: Connection): boolean {
  return connection.state === 'idle';
}

/**
 * Check if connection is busy
 *
 * @param connection - Connection to check
 * @returns True if connection is busy
 */
export function isBusy(connection: Connection): boolean {
  return connection.state === 'busy';
}

/**
 * Check if connection is closed
 *
 * @param connection - Connection to check
 * @returns True if connection is closed
 */
export function isClosed(connection: Connection): boolean {
  return connection.state === 'closed';
}

/**
 * Check if connection has been idle for longer than timeout
 *
 * @param connection - Connection to check
 * @param idleTimeout - Idle timeout in milliseconds
 * @returns True if connection has exceeded idle timeout
 */
export function isIdleTimeout(connection: Connection, idleTimeout: number): boolean {
  if (connection.state !== 'idle') {
    return false;
  }

  const idleTime = Date.now() - connection.lastUsed.getTime();
  return idleTime > idleTimeout;
}
