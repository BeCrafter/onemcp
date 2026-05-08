/**
 * Tool Discovery Manager for TUI
 * Manages automatic tool discovery for services with in-memory caching
 */

import { EventEmitter } from 'events';
import { discoverServiceTools, DiscoveryError, DiscoveryErrorType } from './discovery-worker.js';
import type { ServiceDefinition } from '../types/service.js';

/**
 * Discovery status for a service
 */
export type DiscoveryStatus = 'pending' | 'in-progress' | 'completed' | 'failed';

/**
 * Discovery result for a service
 */
export interface DiscoveryResult {
  serviceName: string;
  status: DiscoveryStatus;
  toolCount?: number;
  error?: string;
  timestamp: Date;
}

/**
 * Discovery configuration
 */
export interface DiscoveryConfig {
  /** Maximum number of concurrent discovery operations (default: 5) */
  maxConcurrent: number;
  /** Timeout for each discovery operation in milliseconds (default: 10000) */
  timeout: number;
  /** Number of retry attempts for failed discoveries (default: 3) */
  retryAttempts: number;
  /** Base backoff time in milliseconds for retries (default: 1000) */
  retryBackoffMs: number;
}

/**
 * Default discovery configuration
 */
const DEFAULT_CONFIG: DiscoveryConfig = {
  maxConcurrent: 5,
  timeout: 10000,
  retryAttempts: 3,
  retryBackoffMs: 1000,
};

/**
 * Tool Discovery Manager
 * Manages automatic tool discovery for services with in-memory caching
 */
export class ToolDiscoveryManager extends EventEmitter {
  private readonly cache: Map<string, number>;
  private readonly statusMap: Map<string, DiscoveryStatus>;
  private readonly errorMap: Map<string, string>;
  private readonly config: DiscoveryConfig;
  private readonly activeDiscoveries: Set<string>;
  private readonly discoveryQueue: Array<{
    serviceName: string;
    service: ServiceDefinition;
    priority: number;
  }>;

  /**
   * Create a new ToolDiscoveryManager
   * @param partialConfig - Optional partial configuration (merged with defaults)
   */
  constructor(partialConfig?: Partial<DiscoveryConfig>) {
    super();
    this.cache = new Map();
    this.statusMap = new Map();
    this.errorMap = new Map();
    this.config = { ...DEFAULT_CONFIG, ...partialConfig };
    this.activeDiscoveries = new Set();
    this.discoveryQueue = [];

    // Listen to our own 'discovered' events to update cache
    this.on('discovered', (result: DiscoveryResult) => {
      if (result.status === 'completed' && result.toolCount !== undefined) {
        this.cache.set(result.serviceName, result.toolCount);
        this.statusMap.set(result.serviceName, 'completed');
        this.errorMap.delete(result.serviceName);
      }
    });

    // Listen to our own 'error' events to update status
    this.on('error', (result: DiscoveryResult) => {
      this.statusMap.set(result.serviceName, 'failed');
      if (result.error !== undefined) {
        this.errorMap.set(result.serviceName, result.error);
      }
    });
  }

  /**
   * Discover tools for visible services with prioritization
   * Uses maxRetries: 0 (fast-fail) for auto-discovery on startup
   * @param services - List of services to discover
   * @param visibleIndices - Indices of visible services (for prioritization)
   */
  public async discoverVisible(
    services: ServiceDefinition[],
    visibleIndices: number[]
  ): Promise<void> {
    // Clear existing queue
    this.discoveryQueue.length = 0;

    // Build priority queue: visible services first, then others
    const visibleSet = new Set(visibleIndices);

    services.forEach((service, index) => {
      if (!service.enabled) {
        return; // Skip disabled services
      }

      const status = this.getStatus(service.name);
      if (status === 'completed' || status === 'in-progress') {
        return; // Skip already discovered or in-progress
      }

      const priority = visibleSet.has(index) ? 1 : 2;
      this.discoveryQueue.push({ serviceName: service.name, service, priority });
    });

    // Sort by priority (lower number = higher priority)
    this.discoveryQueue.sort((a, b) => a.priority - b.priority);

    // Start processing queue with no retries (fast-fail for auto-discovery)
    await this.processQueue(0);
  }

  /**
   * Refresh discovery for services with zero tools
   * Uses full retry logic for manual refresh
   * @param services - List of all services
   */
  public async refreshZeroToolServices(services: ServiceDefinition[]): Promise<void> {
    // Clear existing queue
    this.discoveryQueue.length = 0;

    // Add services with zero or missing tool counts to queue
    services.forEach((service) => {
      if (!service.enabled) {
        return;
      }

      const toolCount = this.getToolCount(service.name);
      if (toolCount === undefined || toolCount === 0) {
        // Reset status so they can be re-queued
        this.statusMap.delete(service.name);
        this.discoveryQueue.push({ serviceName: service.name, service, priority: 1 });
      }
    });

    // Start processing queue with full retry logic
    await this.processQueue(this.config.retryAttempts);
  }

  /**
   * Process the discovery queue with concurrency control
   * @param maxRetries - Maximum retry attempts (0 = no retry, undefined = use config default)
   */
  private async processQueue(maxRetries?: number): Promise<void> {
    // Use a Map so completed promises are removed from the race pool,
    // preventing Promise.race from spinning infinitely on already-resolved entries.
    const inFlight = new Map<string, Promise<void>>();

    const startNext = (): void => {
      while (this.discoveryQueue.length > 0 && inFlight.size < this.config.maxConcurrent) {
        const item = this.discoveryQueue.shift();
        if (item === undefined) break;

        const { serviceName, service } = item;
        this.activeDiscoveries.add(serviceName);
        this.statusMap.set(serviceName, 'in-progress');

        const promise = this.discoverService(serviceName, service, 0, maxRetries).finally(() => {
          this.activeDiscoveries.delete(serviceName);
          inFlight.delete(serviceName);
        });

        inFlight.set(serviceName, promise);
      }
    };

    startNext();

    while (inFlight.size > 0) {
      await Promise.race(inFlight.values());
      startNext();
    }
  }

  /**
   * Discover tools for a single service with retry logic
   * @param serviceName - Name of the service
   * @param serviceDefinition - Full service definition
   * @param attempt - Current retry attempt (default: 0)
   * @param maxRetries - Override max retries (undefined = use config default)
   */
  private async discoverService(
    serviceName: string,
    serviceDefinition: ServiceDefinition,
    attempt: number = 0,
    maxRetries?: number
  ): Promise<void> {
    const effectiveMaxRetries = maxRetries ?? this.config.retryAttempts;
    try {
      const toolCount = await discoverServiceTools(serviceDefinition, this.config.timeout);

      this.emit('discovered', {
        serviceName,
        status: 'completed' as const,
        toolCount,
        timestamp: new Date(),
      });
    } catch (err) {
      const error =
        err instanceof DiscoveryError
          ? err
          : new DiscoveryError(
              DiscoveryErrorType.SERVICE_UNAVAILABLE,
              serviceName,
              err instanceof Error ? err.message : String(err),
              err instanceof Error ? err : undefined
            );

      // Retry logic with exponential backoff
      if (attempt < effectiveMaxRetries) {
        const backoffMs = this.calculateBackoff(attempt);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        await this.discoverService(serviceName, serviceDefinition, attempt + 1, maxRetries);
      } else {
        // Max retries reached, emit error
        this.emit('error', {
          serviceName,
          status: 'failed' as const,
          error: error.message,
          timestamp: new Date(),
        });
      }
    }
  }

  /**
   * Calculate exponential backoff delay
   * @param attempt - Current attempt number
   * @returns Delay in milliseconds
   */
  private calculateBackoff(attempt: number): number {
    return this.config.retryBackoffMs * Math.pow(2, attempt);
  }

  /**
   * Get cached tool count for a service
   * @param serviceName - Name of the service
   * @returns Tool count or undefined if not cached
   */
  public getToolCount(serviceName: string): number | undefined {
    return this.cache.get(serviceName);
  }

  /**
   * Get discovery status for a service
   * @param serviceName - Name of the service
   * @returns Current discovery status (defaults to 'pending' if not found)
   */
  public getStatus(serviceName: string): DiscoveryStatus {
    return this.statusMap.get(serviceName) ?? 'pending';
  }

  /**
   * Get error message for a failed discovery
   * @param serviceName - Name of the service
   * @returns Error message or undefined if no error
   */
  public getError(serviceName: string): string | undefined {
    return this.errorMap.get(serviceName);
  }

  /**
   * Clear all cached data
   * Removes all tool counts, statuses, and errors from memory
   */
  public clear(): void {
    this.cache.clear();
    this.statusMap.clear();
    this.errorMap.clear();
  }

  /**
   * Get the current discovery configuration
   * @returns Current configuration settings
   */
  public getConfig(): DiscoveryConfig {
    return { ...this.config };
  }
}
