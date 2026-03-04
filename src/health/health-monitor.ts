/**
 * Health Monitor for MCP Router System
 * 
 * This module implements health monitoring for backend MCP services.
 * It performs health checks, tracks service health status, and provides
 * methods to query health information.
 */

import type { HealthStatus } from '../types/service.js';
import type { ServiceRegistry } from '../registry/service-registry.js';
import type { ConnectionPool } from '../pool/connection-pool.js';
import { EventEmitter } from 'events';

/**
 * Health Monitor class
 * 
 * Monitors the health of registered services by performing connectivity checks.
 * Tracks consecutive failures and provides health status information.
 */
export class HealthMonitor extends EventEmitter {
  private healthStatuses: Map<string, HealthStatus> = new Map();
  private connectionPools: Map<string, ConnectionPool> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private heartbeatIntervalMs: number = 30000; // Default 30 seconds
  private failureThreshold: number = 3; // Default threshold

  constructor(
    _serviceRegistry: ServiceRegistry
  ) {
    super();
  }

  /**
   * Register a connection pool for a service
   * 
   * This allows the health monitor to perform health checks on the service.
   * Performs an initial health check before enabling the service's tools.
   * 
   * @param serviceName - Name of the service
   * @param pool - Connection pool for the service
   * @returns Promise resolving to the initial health status
   */
  public async registerConnectionPool(serviceName: string, pool: ConnectionPool): Promise<HealthStatus> {
    this.connectionPools.set(serviceName, pool);
    
    // Perform initial health check (Requirement 20.9)
    const initialStatus = await this.checkHealth(serviceName);
    
    // Emit event for initial health check result
    if (initialStatus.healthy) {
      this.emit('serviceHealthy', serviceName, initialStatus);
    } else {
      this.emit('serviceUnhealthy', serviceName, initialStatus);
    }
    
    return initialStatus;
  }

  /**
   * Unregister a connection pool for a service
   * 
   * @param serviceName - Name of the service
   */
  public unregisterConnectionPool(serviceName: string): void {
    this.connectionPools.delete(serviceName);
    this.healthStatuses.delete(serviceName);
  }

  /**
   * Check health of a specific service
   * 
   * Performs a connectivity test by attempting to acquire and release a connection.
   * Updates the health status and consecutive failure count.
   * 
   * @param serviceName - Name of the service to check
   * @returns Promise resolving to health status
   */
  public async checkHealth(serviceName: string): Promise<HealthStatus> {
    const pool = this.connectionPools.get(serviceName);
    
    if (!pool) {
      // Service not registered with health monitor
      const status: HealthStatus = {
        serviceName,
        healthy: false,
        lastCheck: new Date(),
        consecutiveFailures: 0,
        error: {
          message: 'Service not registered with health monitor',
          code: 'NOT_REGISTERED',
          timestamp: new Date(),
        },
      };
      this.healthStatuses.set(serviceName, status);
      return status;
    }

    const previousStatus = this.healthStatuses.get(serviceName);
    let connection;

    try {
      // Attempt to acquire a connection
      connection = await pool.acquire();
      
      // Check if connection is healthy
      const isHealthy = pool.isConnectionHealthy(connection);
      
      if (!isHealthy) {
        throw new Error('Connection is not healthy');
      }

      // Health check passed
      const status: HealthStatus = {
        serviceName,
        healthy: true,
        lastCheck: new Date(),
        consecutiveFailures: 0,
      };

      // Check if health status changed from unhealthy to healthy
      const wasUnhealthy = previousStatus && !previousStatus.healthy;
      
      this.healthStatuses.set(serviceName, status);
      
      if (wasUnhealthy) {
        this.emit('healthChanged', status);
        this.emit('serviceRecovered', serviceName);
      }

      return status;
    } catch (error) {
      // Health check failed
      const consecutiveFailures = (previousStatus?.consecutiveFailures || 0) + 1;
      
      const status: HealthStatus = {
        serviceName,
        healthy: false,
        lastCheck: new Date(),
        consecutiveFailures,
        error: {
          message: error instanceof Error ? error.message : String(error),
          code: 'HEALTH_CHECK_FAILED',
          timestamp: new Date(),
        },
      };

      // Check if health status changed from healthy to unhealthy
      const wasHealthy = !previousStatus || previousStatus.healthy;
      
      this.healthStatuses.set(serviceName, status);
      
      if (wasHealthy) {
        this.emit('healthChanged', status);
        this.emit('serviceFailed', serviceName);
      }

      return status;
    } finally {
      // Release connection if acquired
      if (connection) {
        pool.release(connection);
      }
    }
  }

  /**
   * Get all health statuses
   * 
   * Returns health status for all services that have been checked.
   * Services that haven't been checked yet will not be included.
   * 
   * @returns Promise resolving to array of health statuses
   */
  public async getAllHealthStatus(): Promise<HealthStatus[]> {
    return Array.from(this.healthStatuses.values());
  }

  /**
   * Get health status for a specific service
   * 
   * @param serviceName - Name of the service
   * @returns Health status or undefined if not checked yet
   */
  public getHealthStatus(serviceName: string): HealthStatus | undefined {
    return this.healthStatuses.get(serviceName);
  }

  /**
   * Clear health status for a service
   * 
   * @param serviceName - Name of the service
   */
  public clearHealthStatus(serviceName: string): void {
    this.healthStatuses.delete(serviceName);
  }

  /**
   * Clear all health statuses
   */
  public clearAllHealthStatuses(): void {
    this.healthStatuses.clear();
  }

  /**
   * Start heartbeat monitoring
   * 
   * Begins periodic health checks for all registered services at the configured interval.
   * Services that exceed the failure threshold will be marked as unhealthy.
   * 
   * @param intervalMs - Interval in milliseconds between health checks (default: 30000)
   * @param failureThreshold - Number of consecutive failures before marking unhealthy (default: 3)
   */
  public startHeartbeat(intervalMs: number = 30000, failureThreshold: number = 3): void {
    // Stop existing heartbeat if running
    this.stopHeartbeat();

    this.heartbeatIntervalMs = intervalMs;
    this.failureThreshold = failureThreshold;

    // Start periodic health checks
    this.heartbeatInterval = setInterval(() => {
      this.performHeartbeatChecks();
    }, this.heartbeatIntervalMs);

    // Perform initial check immediately
    this.performHeartbeatChecks();
  }

  /**
   * Stop heartbeat monitoring
   * 
   * Stops the periodic health checks.
   */
  public stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Subscribe to health status changes
   * 
   * Provides a convenient method to listen for health status changes.
   * The callback will be invoked whenever a service's health status changes
   * (from healthy to unhealthy or vice versa).
   * 
   * @param callback - Function to call when health status changes
   * @returns Function to unsubscribe from the event
   */
  public onHealthChange(callback: (status: HealthStatus) => void): () => void {
    this.on('healthChanged', callback);
    
    // Return unsubscribe function
    return () => {
      this.off('healthChanged', callback);
    };
  }

  /**
   * Perform health checks on all registered services
   * 
   * This is called periodically by the heartbeat mechanism.
   * Services that exceed the failure threshold will be marked as unhealthy.
   * 
   * @private
   */
  private async performHeartbeatChecks(): Promise<void> {
    const serviceNames = Array.from(this.connectionPools.keys());

    // Check all services in parallel
    await Promise.allSettled(
      serviceNames.map(async (serviceName) => {
        const status = await this.checkHealth(serviceName);

        // Check if service has exceeded failure threshold
        if (!status.healthy && status.consecutiveFailures >= this.failureThreshold) {
          // Emit event that service is unhealthy and should be unloaded
          this.emit('serviceUnhealthy', serviceName, status);
        }
      })
    );
  }
}
