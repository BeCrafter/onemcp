/**
 * Connection Pool Manager for MCP Router System
 * 
 * This module implements connection pooling for backend MCP servers.
 * It manages connection lifecycle, reuse, limits, and cleanup.
 */

import type { ServiceDefinition, ConnectionPoolConfig, PoolStats } from '../types/service.js';
import type { Transport } from '../types/transport.js';
import type { Connection } from './connection.js';
import {
  createConnection,
  updateConnectionState,
  isIdle,
  isClosed,
  isIdleTimeout,
} from './connection.js';
import { StdioTransport } from '../transport/stdio.js';
import { HttpTransport, type HttpTransportConfig } from '../transport/http.js';
import { EventEmitter } from 'events';

/**
 * Connection pool error class
 */
export class ConnectionPoolError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    cause?: Error
  ) {
    super(message, { cause });
    this.name = 'ConnectionPoolError';
  }
}

/**
 * Request waiting in queue
 */
interface QueuedRequest {
  resolve: (connection: Connection) => void;
  reject: (error: Error) => void;
  timestamp: Date;
}

/**
 * Connection Pool Manager
 * 
 * Manages a pool of connections to a single MCP service.
 * Supports connection reuse, limits, timeouts, and automatic cleanup.
 * Creates appropriate transport (Stdio or HTTP) based on service configuration.
 */
export class ConnectionPool extends EventEmitter {
  private connections: Map<string, Connection> = new Map();
  private queue: QueuedRequest[] = [];
  private nextConnectionId = 1;
  private idleTimeoutTimer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(
    private readonly service: ServiceDefinition,
    private readonly config: ConnectionPoolConfig
  ) {
    super();
    this.validateServiceConfiguration();
    this.startIdleTimeoutMonitor();
  }

  /**
   * Acquire a connection from the pool
   * 
   * Returns an available idle connection if one exists, otherwise creates
   * a new connection if under the limit, or queues the request if at capacity.
   * 
   * @returns Promise resolving to an acquired connection
   * @throws ConnectionPoolError if pool is closed or timeout occurs
   */
  public async acquire(): Promise<Connection> {
    if (this.closed) {
      throw new ConnectionPoolError(
        'Cannot acquire connection: pool is closed',
        'POOL_CLOSED'
      );
    }

    // Try to find an idle connection
    const idleConnection = this.findIdleConnection();
    if (idleConnection) {
      const busyConnection = updateConnectionState(idleConnection, 'busy');
      this.connections.set(busyConnection.id, busyConnection);
      this.emit('acquired', busyConnection.id);
      return busyConnection;
    }

    // Check if we can create a new connection
    if (this.connections.size < this.config.maxConnections) {
      const connection = await this.createConnection();
      const busyConnection = updateConnectionState(connection, 'busy');
      this.connections.set(busyConnection.id, busyConnection);
      this.emit('acquired', busyConnection.id);
      return busyConnection;
    }

    // Queue the request and wait
    return this.queueRequest();
  }

  /**
   * Release a connection back to the pool
   * 
   * Marks the connection as idle and processes any queued requests.
   * 
   * @param connection - Connection to release
   */
  public release(connection: Connection): void {
    if (this.closed) {
      // If pool is closed, close the connection
      void this.closeConnection(connection);
      return;
    }

    const existingConnection = this.connections.get(connection.id);
    if (!existingConnection) {
      // Connection not in pool, ignore
      return;
    }

    if (isClosed(existingConnection)) {
      // Connection is closed, remove from pool
      this.connections.delete(connection.id);
      this.emit('removed', connection.id);
      return;
    }

    // Mark as idle
    const idleConnection = updateConnectionState(existingConnection, 'idle');
    this.connections.set(idleConnection.id, idleConnection);
    this.emit('released', idleConnection.id);

    // Process queued requests
    this.processQueue();
  }

  /**
   * Mark a connection as failed and remove it from the pool
   * 
   * This method should be called when a connection fails during use.
   * The connection will be closed and removed from the pool.
   * 
   * @param connection - Failed connection
   * @param error - Error that caused the failure
   */
  public async markConnectionFailed(connection: Connection, error: Error): Promise<void> {
    const existingConnection = this.connections.get(connection.id);
    if (!existingConnection) {
      return;
    }

    this.emit('connectionFailed', connection.id, error);
    
    // Close and remove the connection
    await this.closeConnection(connection);
    
    // Process queue to potentially create a new connection for waiting requests
    this.processQueue();
  }

  /**
   * Check if a connection is healthy
   * 
   * Performs a basic health check by verifying the transport is not closed.
   * This is a lightweight check that can be called frequently.
   * 
   * @param connection - Connection to check
   * @returns True if connection appears healthy
   */
  public isConnectionHealthy(connection: Connection): boolean {
    // Connection is unhealthy if it's closed
    if (isClosed(connection)) {
      return false;
    }

    // For stdio transport, check if the process is still running
    if (connection.transport.getType() === 'stdio') {
      const stdioTransport = connection.transport as any;
      if (stdioTransport.process && stdioTransport.process.killed) {
        return false;
      }
    }

    return true;
  }

  /**
   * Close all connections and shut down the pool
   * 
   * Closes all active connections, rejects queued requests, and stops monitoring.
   * 
   * @returns Promise resolving when all connections are closed
   */
  public async closeAll(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.stopIdleTimeoutMonitor();

    // Reject all queued requests
    const queuedRequests = [...this.queue];
    this.queue = [];
    for (const request of queuedRequests) {
      request.reject(
        new ConnectionPoolError(
          'Connection pool is closing',
          'POOL_CLOSING'
        )
      );
    }

    // Close all connections
    const closePromises: Promise<void>[] = [];
    for (const connection of this.connections.values()) {
      closePromises.push(this.closeConnection(connection));
    }

    await Promise.all(closePromises);
    this.connections.clear();
    this.emit('closed');
  }

  /**
   * Get pool statistics
   * 
   * @returns Current pool statistics
   */
  public getStats(): PoolStats {
    let idle = 0;
    let busy = 0;

    for (const connection of this.connections.values()) {
      if (isIdle(connection)) {
        idle++;
      } else if (connection.state === 'busy') {
        busy++;
      }
    }

    return {
      total: this.connections.size,
      idle,
      busy,
      waiting: this.queue.length,
    };
  }

  /**
   * Validate service configuration
   * 
   * @throws ConnectionPoolError if configuration is invalid
   */
  private validateServiceConfiguration(): void {
    if (this.service.transport === 'stdio') {
      if (!this.service.command) {
        throw new ConnectionPoolError(
          'Service with stdio transport must have a command',
          'INVALID_CONFIG'
        );
      }
    } else if (this.service.transport === 'sse' || this.service.transport === 'http') {
      if (!this.service.url) {
        throw new ConnectionPoolError(
          `Service with ${this.service.transport} transport must have a URL`,
          'INVALID_CONFIG'
        );
      }
    } else {
      throw new ConnectionPoolError(
        `Unknown transport type: ${this.service.transport}`,
        'INVALID_CONFIG'
      );
    }
  }

  /**
   * Find an idle connection in the pool
   * 
   * @returns Idle connection or undefined if none available
   */
  private findIdleConnection(): Connection | undefined {
    for (const connection of this.connections.values()) {
      if (isIdle(connection)) {
        return connection;
      }
    }
    return undefined;
  }

  /**
   * Create a new connection
   * 
   * @returns Promise resolving to new connection
   * @throws ConnectionPoolError if connection creation fails
   */
  private async createConnection(): Promise<Connection> {
    const id = `${this.service.name}-${this.nextConnectionId++}`;
    
    try {
      const transport = await this.createTransportWithTimeout();
      const connection = createConnection(id, transport);
      
      // Initialize the MCP connection
      await this.initializeMCPConnection(connection);
      
      this.emit('created', id);
      return connection;
    } catch (error) {
      this.emit('error', error);
      throw new ConnectionPoolError(
        `Failed to create connection: ${error instanceof Error ? error.message : String(error)}`,
        'CONNECTION_FAILED',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Create transport with connection timeout
   * 
   * Creates the appropriate transport (Stdio or HTTP) based on service configuration
   * 
   * @returns Promise resolving to transport
   * @throws Error if timeout occurs
   */
  private async createTransportWithTimeout(): Promise<Transport> {
    return Promise.race([
      this.createTransport(),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, this.config.connectionTimeout);
      }),
    ]);
  }

  /**
   * Create transport based on service configuration
   * 
   * @returns Promise resolving to transport
   */
  private async createTransport(): Promise<Transport> {
    if (this.service.transport === 'stdio') {
      // Create stdio transport
      const config: { command: string; args?: string[]; env?: Record<string, string> } = {
        command: this.service.command!,
      };
      if (this.service.args !== undefined) {
        config.args = this.service.args;
      }
      if (this.service.env !== undefined) {
        config.env = this.service.env;
      }
      return new StdioTransport(config);
    } else if (this.service.transport === 'sse') {
      // Create SSE transport
      const config: HttpTransportConfig = {
        url: this.service.url!,
        mode: 'sse',
        timeout: this.config.connectionTimeout,
      };
      if (this.service.headers) {
        config.headers = this.service.headers;
      }
      return new HttpTransport(config);
    } else if (this.service.transport === 'http') {
      // Create HTTP transport
      const config: HttpTransportConfig = {
        url: this.service.url!,
        mode: 'http',
        timeout: this.config.connectionTimeout,
      };
      if (this.service.headers) {
        config.headers = this.service.headers;
      }
      return new HttpTransport(config);
    } else {
      throw new Error(`Unsupported transport type: ${this.service.transport}`);
    }
  }

  /**
   * Initialize MCP connection by sending initialize request
   * 
   * @param connection - Connection to initialize
   * @throws Error if initialization fails
   * @private
   */
  private async initializeMCPConnection(connection: Connection): Promise<void> {
    const initRequest = {
      jsonrpc: '2.0' as const,
      id: `init-${Date.now()}`,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'onemcp-router',
          version: '1.0.0',
        },
      },
    };

    // Send initialize request
    await connection.transport.send(initRequest);

    // Wait for response
    const responseIterator = connection.transport.receive();
    const { value: response } = await responseIterator.next();

    if (!response) {
      throw new Error('No response received for initialize request');
    }

    // Check for error response
    if ('error' in response) {
      throw new Error(`Initialize failed: ${(response as any).error.message}`);
    }

    // Verify it's a success response
    if (!('result' in response)) {
      throw new Error('Invalid initialize response format');
    }
  }

  /**
   * Queue a connection request
   * 
   * @returns Promise resolving to connection when available
   */
  private queueRequest(): Promise<Connection> {
    return new Promise((resolve, reject) => {
      const request: QueuedRequest = {
        resolve,
        reject,
        timestamp: new Date(),
      };

      this.queue.push(request);
      this.emit('queued', this.queue.length);

      // Set timeout for queued request
      setTimeout(() => {
        const index = this.queue.indexOf(request);
        if (index !== -1) {
          this.queue.splice(index, 1);
          reject(
            new ConnectionPoolError(
              'Connection pool exhausted: request timeout while waiting for available connection',
              'CONNECTION_POOL_EXHAUSTED'
            )
          );
        }
      }, this.config.connectionTimeout);
    });
  }

  /**
   * Process queued requests
   * 
   * Assigns idle connections to waiting requests. If no idle connections
   * are available and we're under the limit, creates new connections.
   * This method processes the queue synchronously for idle connections
   * and asynchronously creates new connections as needed.
   */
  private processQueue(): void {
    // First, process all requests that can use idle connections
    while (this.queue.length > 0) {
      const idleConnection = this.findIdleConnection();
      if (!idleConnection) {
        break;
      }

      const request = this.queue.shift();
      if (request) {
        const busyConnection = updateConnectionState(idleConnection, 'busy');
        this.connections.set(busyConnection.id, busyConnection);
        request.resolve(busyConnection);
        this.emit('acquired', busyConnection.id);
      }
    }

    // Then, if there are still queued requests and we're under the limit,
    // create new connections asynchronously
    if (this.queue.length > 0 && this.connections.size < this.config.maxConnections) {
      void this.createConnectionsForQueue();
    }
  }

  /**
   * Create new connections for queued requests
   * 
   * This method is called asynchronously to create connections for waiting requests
   * when no idle connections are available but we're under the max limit.
   */
  private async createConnectionsForQueue(): Promise<void> {
    while (this.queue.length > 0 && this.connections.size < this.config.maxConnections) {
      const request = this.queue.shift();
      if (!request) {
        break;
      }

      try {
        const connection = await this.createConnection();
        const busyConnection = updateConnectionState(connection, 'busy');
        this.connections.set(busyConnection.id, busyConnection);
        request.resolve(busyConnection);
        this.emit('acquired', busyConnection.id);
      } catch (error) {
        request.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  /**
   * Close a single connection
   * 
   * @param connection - Connection to close
   */
  private async closeConnection(connection: Connection): Promise<void> {
    try {
      await connection.transport.close();
      const closedConnection = updateConnectionState(connection, 'closed');
      this.connections.set(closedConnection.id, closedConnection);
      this.emit('connectionClosed', connection.id);
    } catch (error) {
      this.emit('error', error);
    } finally {
      this.connections.delete(connection.id);
    }
  }

  /**
   * Start monitoring for idle timeout
   */
  private startIdleTimeoutMonitor(): void {
    // Check every 10 seconds or half the idle timeout, whichever is smaller
    const interval = Math.min(10000, this.config.idleTimeout / 2);
    
    this.idleTimeoutTimer = setInterval(() => {
      this.cleanupIdleConnections();
    }, interval);
  }

  /**
   * Stop monitoring for idle timeout
   */
  private stopIdleTimeoutMonitor(): void {
    if (this.idleTimeoutTimer) {
      clearInterval(this.idleTimeoutTimer);
      this.idleTimeoutTimer = null;
    }
  }

  /**
   * Clean up connections that have exceeded idle timeout
   */
  private cleanupIdleConnections(): void {
    const connectionsToClose: Connection[] = [];

    for (const connection of this.connections.values()) {
      if (isIdleTimeout(connection, this.config.idleTimeout)) {
        connectionsToClose.push(connection);
      }
    }

    for (const connection of connectionsToClose) {
      this.emit('idleTimeout', connection.id);
      void this.closeConnection(connection);
    }
  }
}
