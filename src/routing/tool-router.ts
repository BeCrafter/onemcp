/**
 * Tool Router for MCP Router System
 *
 * This module implements tool discovery, caching, and routing functionality.
 * It discovers tools from all enabled services, applies namespacing to avoid
 * conflicts, caches results for performance, and routes tool calls to the
 * correct service.
 */

import type { Tool, TagFilter } from '../types/tool.js';
import type { ServiceDefinition } from '../types/service.js';
import type { ServiceRegistry } from '../registry/service-registry.js';
import type { NamespaceManager } from '../namespace/manager.js';
import type { ConnectionPool } from '../pool/connection-pool.js';
import type { Connection } from '../pool/connection.js';
import type { HealthMonitor } from '../health/health-monitor.js';
import type { RequestContext } from '../types/context.js';
import type {
  JsonRpcRequest,
  JsonRpcSuccessResponse,
  JsonRpcErrorResponse,
} from '../types/jsonrpc.js';
import { ErrorCode } from '../types/jsonrpc.js';
import Ajv from 'ajv';
import { EventEmitter } from 'events';

/** Default timeout for a single service's tools/list during discovery (ms) */
const DEFAULT_DISCOVERY_TIMEOUT_MS = 30_000;

/** Cache TTL: use cached tool list only if younger than this (ms). Set to 0 to use cache until invalidated. */
const CACHE_TTL_MS: number = 60_000;

/** Max number of services to query concurrently during discovery (avoids resource exhaustion) */
const MAX_CONCURRENT_DISCOVERY = 10;

/**
 * Tool cache entry
 */
interface ToolCacheEntry {
  tools: Tool[];
  timestamp: Date;
}

/**
 * Tool Router class
 *
 * Manages tool discovery, caching, and routing. Integrates with ServiceRegistry,
 * NamespaceManager, ConnectionPool, and HealthMonitor to provide a complete
 * tool routing solution.
 */
export class ToolRouter extends EventEmitter {
  private toolCache: ToolCacheEntry | null = null;
  private connectionPools: Map<string, ConnectionPool> = new Map();
  /** In-flight discovery promise per tag-filter key for request coalescing */
  private inFlightDiscovery: Map<string, Promise<Tool[]>> = new Map();

  constructor(
    private readonly serviceRegistry: ServiceRegistry,
    private readonly namespaceManager: NamespaceManager,
    private readonly healthMonitor: HealthMonitor
  ) {
    super();

    // Subscribe to health status changes to auto-unload/load tools
    this.healthMonitor.on('serviceUnhealthy', (serviceName: string) => {
      this.handleServiceUnhealthy(serviceName);
    });

    this.healthMonitor.on('serviceRecovered', (serviceName: string) => {
      this.handleServiceRecovered(serviceName);
    });

    // Subscribe to service registration/unregistration events for cache invalidation (Requirement 2.4)
    this.serviceRegistry.on('serviceRegistered', () => {
      this.invalidateCache();
    });

    this.serviceRegistry.on('serviceUnregistered', () => {
      this.invalidateCache();
    });
  }

  /**
   * Register a connection pool for a service
   *
   * This allows the tool router to route tool calls to the service.
   *
   * @param serviceName - Name of the service
   * @param pool - Connection pool for the service
   */
  public registerConnectionPool(serviceName: string, pool: ConnectionPool): void {
    this.connectionPools.set(serviceName, pool);
  }

  /**
   * Verify connections for all enabled services
   *
   * Establishes and verifies connections for all enabled services without
   * retrieving tool lists. Connections are pooled for later use.
   *
   * This is used in smart discovery mode to ensure services are reachable
   * before the server starts accepting requests, while still maintaining
   * the lazy loading benefits of smart discovery.
   *
   * @param tagFilter - Optional tag filter to limit which services to verify
   * @returns Promise resolving when all connections are verified
   * @throws Error if any service connection fails
   */
  public async verifyConnections(tagFilter?: TagFilter): Promise<void> {
    let services: ServiceDefinition[];
    if (tagFilter) {
      const matchAll = tagFilter.logic === 'AND';
      services = await this.serviceRegistry.findByTags(tagFilter.tags, matchAll);
    } else {
      services = this.serviceRegistry.list();
    }

    const enabledServices = services.filter((service) => service.enabled);

    const results = await this.runWithConcurrencyLimit(
      enabledServices,
      MAX_CONCURRENT_DISCOVERY,
      async (service) => {
        const pool = this.connectionPools.get(service.name);
        if (!pool) {
          throw new Error(`No connection pool registered for service: ${service.name}`);
        }

        try {
          // Acquire a connection to establish and verify the connection
          const connection = await pool.acquire();
          // Immediately release the connection back to the pool
          pool.release(connection);
          return { service: service.name, success: true };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            service: service.name,
            success: false,
            error: errorMessage,
          };
        }
      }
    );

    // Check for failures and throw if any service failed to connect
    const failures: Array<{ service: string; error: string }> = [];

    for (const result of results) {
      if (result.status === 'rejected') {
        const errorMessage =
          result.reason instanceof Error ? result.reason.message : String(result.reason);
        failures.push({ service: 'unknown', error: errorMessage });
      } else if (result.status === 'fulfilled' && !result.value.success) {
        failures.push({
          service: result.value.service,
          error: result.value.error ?? 'Unknown error',
        });
      }
    }

    if (failures.length > 0) {
      const failureDetails = failures
        .map((failure) => `${failure.service}: ${failure.error}`)
        .join('\n  ');
      throw new Error(
        `Failed to verify connections for ${failures.length} service(s):\n  ${failureDetails}`
      );
    }
  }

  /**
   * Unregister a connection pool for a service
   *
   * @param serviceName - Name of the service
   */
  public unregisterConnectionPool(serviceName: string): void {
    this.connectionPools.delete(serviceName);
  }

  /**
   * Discover all tools from enabled services
   *
   * Queries all enabled services (optionally filtered by tags) and returns
   * an aggregated list of tools with namespaced names. Results are cached
   * for performance.
   *
   * Requirements:
   * - 2.1: Query all enabled services and return aggregated tool list
   * - 2.2: Provide name, namespaced name, description, input schema, source service
   * - 2.3: Cache tool definitions for performance
   * - 14.1-14.5: Support tag filtering during discovery
   *
   * @param tagFilter - Optional tag filter to apply
   * @returns Promise resolving to array of discovered tools
   */
  public async discoverTools(tagFilter?: TagFilter): Promise<Tool[]> {
    const cacheKey = this.tagFilterKey(tagFilter);

    // Use cache when no tag filter, cache exists, and not expired (Requirement 2.3)
    if (!tagFilter && this.toolCache) {
      const ageMs = Date.now() - this.toolCache.timestamp.getTime();
      if (CACHE_TTL_MS === 0 || ageMs < CACHE_TTL_MS) {
        return this.toolCache.tools;
      }
      this.toolCache = null;
    }

    // Request coalescing: reuse in-flight discovery for the same tag filter
    const inFlight = this.inFlightDiscovery.get(cacheKey);
    if (inFlight !== undefined) {
      return inFlight;
    }

    const promise = this.runDiscovery(tagFilter);
    this.inFlightDiscovery.set(cacheKey, promise);
    void promise.finally(() => {
      this.inFlightDiscovery.delete(cacheKey);
    });
    return promise;
  }

  /** Stable key for tag filter for coalescing */
  private tagFilterKey(tagFilter?: TagFilter): string {
    if (!tagFilter) {
      return '';
    }
    const tags = [...tagFilter.tags].sort();
    return JSON.stringify({ tags, logic: tagFilter.logic });
  }

  /**
   * Run discovery with bounded concurrency and merge results.
   */
  private async runDiscovery(tagFilter?: TagFilter): Promise<Tool[]> {
    let services: ServiceDefinition[];
    if (tagFilter) {
      const matchAll = tagFilter.logic === 'AND';
      services = await this.serviceRegistry.findByTags(tagFilter.tags, matchAll);
    } else {
      services = this.serviceRegistry.list();
    }

    const enabledServices = services.filter((service) => service.enabled);
    const healthyServices = enabledServices.filter((service) => {
      const healthStatus = this.healthMonitor.getHealthStatus(service.name);
      return !healthStatus || healthStatus.healthy;
    });

    const results = await this.runWithConcurrencyLimit(
      healthyServices,
      MAX_CONCURRENT_DISCOVERY,
      async (service) => {
        const pool = this.connectionPools.get(service.name);
        if (!pool) {
          return { service: service.name, tools: [] as Tool[] };
        }
        const serviceTools = await this.queryServiceTools(service, pool);
        const enabledTools = serviceTools.filter((tool) => tool.enabled);
        return { service: service.name, tools: enabledTools };
      }
    );

    const allTools: Tool[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const service = healthyServices[i];
      if (service === undefined || result === undefined) {
        continue;
      }
      if (result.status === 'fulfilled') {
        allTools.push(...result.value.tools);
      } else {
        const reason: unknown = result.reason;
        console.error(
          `Failed to discover tools from service "${service.name}":`,
          reason instanceof Error ? reason.message : String(reason)
        );
        this.emit('toolDiscoveryError', service.name, reason);
      }
    }

    if (!tagFilter) {
      const wasEmpty = this.toolCache === null;
      this.toolCache = {
        tools: allTools,
        timestamp: new Date(),
      };
      // Emit cacheInvalidated event when cache is populated from empty state
      // This notifies clients that tools are now available
      if (wasEmpty) {
        this.emit('cacheInvalidated');
      }
    }

    return allTools;
  }

  /**
   * Run async tasks with bounded concurrency; returns settled results in order.
   */
  private async runWithConcurrencyLimit<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>
  ): Promise<Array<PromiseSettledResult<R>>> {
    const results = new Array<PromiseSettledResult<R>>(items.length);
    let index = 0;

    const runOne = async (): Promise<void> => {
      const i = index++;
      if (i >= items.length) {
        return;
      }
      const item = items[i];
      if (item === undefined) {
        return;
      }
      try {
        const value = await fn(item);
        results[i] = { status: 'fulfilled', value };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
      await runOne();
    };

    const concurrency = Math.min(limit, items.length);
    await Promise.all(Array.from({ length: concurrency }, () => runOne()));
    return results;
  }

  /**
   * Invalidate the tool cache
   *
   * Forces the next discoverTools() call to re-query all services.
   * Should be called when services are registered/unregistered or when
   * health status changes.
   *
   * Requirement 2.4: Cache invalidation on service changes
   */
  public invalidateCache(): void {
    this.toolCache = null;
    this.inFlightDiscovery.clear();
    this.emit('cacheInvalidated');
  }

  /**
   * Set the enabled/disabled state of a tool
   *
   * Updates the tool state in the service configuration and persists it.
   * Emits a toolStateChanged event when the state changes.
   *
   * Requirements:
   * - 3.2: Enable/disable individual tools by namespaced name
   * - 3.4: Persist tool states across restarts
   * - 3.8: Allow dynamic modification via API
   * - 3.9: Emit events when tool state changes
   *
   * @param namespacedName - Namespaced tool name (serviceName__toolName)
   * @param enabled - True to enable, false to disable
   * @throws Error if tool or service not found
   */
  public async setToolState(namespacedName: string, enabled: boolean): Promise<void> {
    // Parse the namespaced name to get service and tool names
    const { serviceName, toolName } = this.namespaceManager.parseNamespacedName(namespacedName);

    // Get the service
    const service = this.serviceRegistry.get(serviceName);
    if (!service) {
      throw new Error(`Service not found: ${serviceName}`);
    }

    // Initialize toolStates if not present
    if (!service.toolStates) {
      service.toolStates = {};
    }

    // Check if state is actually changing
    const currentState = this.isToolEnabled(service, toolName);
    if (currentState === enabled) {
      // State is not changing, no need to update
      return;
    }

    // Update the tool state
    service.toolStates[toolName] = enabled;

    // Persist the updated service configuration (Requirement 3.4)
    await this.serviceRegistry.register(service);

    // Invalidate cache to reflect the change
    this.invalidateCache();

    // Emit event (Requirement 3.9)
    this.emit('toolStateChanged', {
      namespacedName,
      serviceName,
      toolName,
      enabled,
    });
  }

  /**
   * Get the enabled/disabled state of a tool
   *
   * Queries the current state of a tool from the service configuration.
   *
   * Requirements:
   * - 3.3: Query tool enabled/disabled status
   * - 3.11: Default to enabled when not specified
   *
   * @param namespacedName - Namespaced tool name (serviceName__toolName)
   * @returns True if tool is enabled, false if disabled
   * @throws Error if tool or service not found
   */
  public getToolState(namespacedName: string): boolean {
    // Parse the namespaced name to get service and tool names
    const { serviceName, toolName } = this.namespaceManager.parseNamespacedName(namespacedName);

    // Get the service
    const service = this.serviceRegistry.get(serviceName);
    if (!service) {
      throw new Error(`Service not found: ${serviceName}`);
    }

    // Return the tool state (Requirement 3.3, 3.11)
    return this.isToolEnabled(service, toolName);
  }

  /**
   * Query tools from a specific service
   *
   * Acquires a connection from the pool, queries the service's tools,
   * applies namespacing, and returns the tool list.
   *
   * @param service - Service definition
   * @param pool - Connection pool for the service
   * @returns Promise resolving to array of tools from the service
   * @private
   */
  /**
   * Whether an error indicates the connection is dead and should be removed from the pool.
   */
  private isConnectionLevelError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    if (error.name !== 'TransportError' || !('code' in error)) {
      return false;
    }
    const code = (error as { code?: string }).code;
    const connectionLevelCodes = new Set([
      'PROCESS_EXITED',
      'PROCESS_ERROR',
      'PROCESS_NULL',
      'STDIN_UNAVAILABLE',
      'STDIN_DESTROYED',
      'STDIN_WRITE_FAILED',
      'TRANSPORT_CLOSED',
      'TRANSPORT_CLOSING',
      'TRANSPORT_ERROR',
      'HTTP_TIMEOUT',
      'HTTP_REQUEST_FAILED',
      'HTTP_SEND_FAILED',
    ]);
    return typeof code === 'string' && connectionLevelCodes.has(code);
  }

  /**
   * Run a promise with a timeout; reject with an Error if it exceeds the limit.
   */
  private async withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`${label} timed out after ${ms}ms`));
      }, ms);
    });
    try {
      const result = await Promise.race([promise, timeoutPromise]);
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      return result;
    } catch (e) {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      throw e;
    }
  }

  private async queryServiceTools(
    service: ServiceDefinition,
    pool: ConnectionPool
  ): Promise<Tool[]> {
    const connection = await pool.acquire();
    let connectionHandled = false;
    try {
      const timeoutMs = service.connectionPool?.connectionTimeout ?? DEFAULT_DISCOVERY_TIMEOUT_MS;
      const rawTools: unknown[] = await this.withTimeout(
        this.queryToolsViaMCP(connection),
        timeoutMs,
        `tools/list for ${service.name}`
      );

      const tools: Tool[] = rawTools.map((rawTool: unknown) => {
        const toolObj = rawTool as {
          name: string;
          description?: string;
          inputSchema?: {
            type: 'object';
            properties: Record<string, unknown>;
            required?: string[];
          };
        };
        const namespacedName = this.namespaceManager.generateNamespacedName(
          service.name,
          toolObj.name
        );
        const enabled = this.isToolEnabled(service, toolObj.name);

        return {
          name: toolObj.name,
          namespacedName,
          serviceName: service.name,
          description: toolObj.description || '',
          inputSchema: toolObj.inputSchema || {
            type: 'object',
            properties: {},
            required: [],
          },
          enabled,
        };
      });

      return tools;
    } catch (error) {
      if (this.isConnectionLevelError(error)) {
        await pool.markConnectionFailed(
          connection,
          error instanceof Error ? error : new Error(String(error))
        );
        connectionHandled = true;
      } else {
        pool.release(connection);
        connectionHandled = true;
      }
      throw error;
    } finally {
      if (!connectionHandled) {
        pool.release(connection);
      }
    }
  }

  /**
   * Query tools from a service via MCP protocol
   *
   * Sends a tools/list request to the service via the transport layer
   * and parses the response to extract tool definitions.
   *
   * @param connection - Connection to the service
   * @returns Promise resolving to raw tool definitions
   * @private
   */
  private async queryToolsViaMCP(connection: Connection): Promise<unknown[]> {
    // Create the JSON-RPC request for tools/list
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: `tools-list-${Date.now()}`,
      method: 'tools/list',
      params: {},
    };

    // Send the request via the transport
    await connection.transport.send(request);

    // Wait for the response
    const responseIterator = connection.transport.receive();
    const nextResult = await responseIterator.next();
    const response = nextResult.value as JsonRpcSuccessResponse | JsonRpcErrorResponse | null;

    if (!response) {
      throw new Error('No response received from service for tools/list request');
    }

    // Check if it's an error response
    if ('error' in response && response) {
      const errorResponse = response;
      throw new Error(`Failed to query tools from service: ${errorResponse.error.message}`);
    }

    // Check if it's a success response
    if ('result' in response && response) {
      const successResponse = response;
      const result = successResponse.result as { tools?: unknown[] };

      // Return the tools array from the result
      return result.tools || [];
    }

    throw new Error('Invalid response format from service for tools/list request');
  }

  /**
   * Determine if a tool is enabled based on service configuration
   *
   * Checks the service's toolStates configuration to determine if a tool
   * should be enabled. Supports pattern matching with wildcards.
   *
   * @param service - Service definition
   * @param toolName - Name of the tool
   * @returns True if tool is enabled, false otherwise
   * @private
   */
  private isToolEnabled(service: ServiceDefinition, toolName: string): boolean {
    // If no tool states configured, default to enabled (Requirement 3.11)
    if (!service.toolStates) {
      return true;
    }

    // Check for exact match first
    if (toolName in service.toolStates) {
      return service.toolStates[toolName] ?? true;
    }

    // Check for pattern matches
    for (const [pattern, enabled] of Object.entries(service.toolStates)) {
      if (this.matchesPattern(toolName, pattern)) {
        return enabled ?? true;
      }
    }

    // Default to enabled if no matching pattern found
    return true;
  }

  /**
   * Check if a tool name matches a pattern
   *
   * Supports wildcard patterns (e.g., "read_*", "*_file")
   *
   * @param toolName - Tool name to check
   * @param pattern - Pattern to match against
   * @returns True if tool name matches pattern
   * @private
   */
  private matchesPattern(toolName: string, pattern: string): boolean {
    // Convert wildcard pattern to regex
    // Escape special regex characters except *
    const regexPattern = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(toolName);
  }

  /**
   * Handle service becoming unhealthy
   *
   * Invalidates the cache to remove tools from the unhealthy service.
   * This implements auto-unload functionality (Requirement 20.6).
   *
   * @param serviceName - Name of the unhealthy service
   * @private
   */
  private handleServiceUnhealthy(serviceName: string): void {
    this.invalidateCache();
    this.emit('serviceToolsUnloaded', serviceName);
  }

  /**
   * Handle service recovering to healthy state
   *
   * Invalidates the cache to reload tools from the recovered service.
   * This implements auto-load functionality (Requirement 20.7).
   *
   * @param serviceName - Name of the recovered service
   * @private
   */
  private handleServiceRecovered(serviceName: string): void {
    this.invalidateCache();
    this.emit('serviceToolsLoaded', serviceName);
  }

  /**
   * Call a tool by its namespaced name
   *
   * Routes the tool call to the correct service, validates parameters,
   * and maintains request context throughout the call.
   *
   * Requirements:
   * - 5.1: Route tool calls to correct service based on namespaced name
   * - 5.2: Validate tool parameters against input schema
   * - 5.3: Return results to client on success
   * - 5.4: Maintain request context and correlation ID
   *
   * @param namespacedName - Namespaced tool name (serviceName__toolName)
   * @param params - Tool parameters
   * @param context - Request context with correlation ID
   * @returns Promise resolving to tool execution result
   * @throws Error if tool not found, disabled, or validation fails
   */
  public async callTool(
    namespacedName: string,
    params: unknown,
    context: RequestContext
  ): Promise<unknown> {
    // Parse the namespaced name to get service and tool names (Requirement 5.1)
    const { serviceName, toolName } = this.namespaceManager.parseNamespacedName(namespacedName);

    // Get the service
    const service = this.serviceRegistry.get(serviceName);
    if (!service) {
      throw this.createToolError(
        ErrorCode.TOOL_NOT_FOUND,
        `Tool not found: ${namespacedName}`,
        context,
        { serviceName, toolName }
      );
    }

    // Check if service is enabled
    if (!service.enabled) {
      throw this.createToolError(
        ErrorCode.SERVICE_UNAVAILABLE,
        `Service is disabled: ${serviceName}`,
        context,
        { serviceName, toolName }
      );
    }

    // Check if tool is enabled (Requirement 5.1)
    const toolEnabled = this.isToolEnabled(service, toolName);
    if (!toolEnabled) {
      throw this.createToolError(
        ErrorCode.TOOL_DISABLED,
        `Tool is disabled: ${namespacedName}`,
        context,
        { serviceName, toolName }
      );
    }

    // Check if service is healthy
    const healthStatus = this.healthMonitor.getHealthStatus(serviceName);
    if (healthStatus && !healthStatus.healthy) {
      throw this.createToolError(
        ErrorCode.SERVICE_UNHEALTHY,
        `Service is unhealthy: ${serviceName}`,
        context,
        { serviceName, toolName, details: healthStatus.error }
      );
    }

    // Get the connection pool for the service
    const pool = this.connectionPools.get(serviceName);
    if (!pool) {
      throw this.createToolError(
        ErrorCode.SERVICE_UNAVAILABLE,
        `No connection pool available for service: ${serviceName}`,
        context,
        { serviceName, toolName }
      );
    }

    // Get tool schema for validation (Requirement 5.2)
    const tool = await this.findTool(serviceName, toolName, pool);
    if (!tool) {
      throw this.createToolError(
        ErrorCode.TOOL_NOT_FOUND,
        `Tool not found in service: ${namespacedName}`,
        context,
        { serviceName, toolName }
      );
    }

    // Validate parameters against tool schema (Requirement 5.2)
    this.validateToolParameters(tool, params, context);

    let connection: Connection;
    try {
      connection = await pool.acquire();
    } catch (error) {
      throw this.createToolError(
        ErrorCode.CONNECTION_POOL_EXHAUSTED,
        `Failed to acquire connection for service: ${serviceName}`,
        context,
        { serviceName, toolName },
        error as Error
      );
    }

    let connectionHandled = false;
    try {
      const result = await this.executeToolCall(connection, toolName, params, context);

      this.emit('toolCallSuccess', {
        namespacedName,
        serviceName,
        toolName,
        context,
      });

      return result;
    } catch (error) {
      this.emit('toolCallError', {
        namespacedName,
        serviceName,
        toolName,
        context,
        error,
      });

      if (this.isConnectionLevelError(error)) {
        await pool.markConnectionFailed(
          connection,
          error instanceof Error ? error : new Error(String(error))
        );
        connectionHandled = true;
      }

      if (error instanceof Error && 'code' in error) {
        throw error;
      }

      throw this.createToolError(
        ErrorCode.INTERNAL_ERROR,
        `Tool execution failed: ${(error as Error).message}`,
        context,
        { serviceName, toolName },
        error as Error
      );
    } finally {
      if (!connectionHandled) {
        pool.release(connection);
      }
    }
  }

  /**
   * Find a tool in a service
   *
   * Queries the service for its tools and finds the specified tool.
   *
   * @param serviceName - Name of the service
   * @param toolName - Name of the tool
   * @param pool - Connection pool for the service
   * @returns Promise resolving to the tool or null if not found
   * @private
   */
  private async findTool(
    serviceName: string,
    toolName: string,
    pool: ConnectionPool
  ): Promise<Tool | null> {
    // Get the service
    const service = this.serviceRegistry.get(serviceName);
    if (!service) {
      return null;
    }

    // Query tools from the service
    try {
      const tools = await this.queryServiceTools(service, pool);
      return tools.find((t) => t.name === toolName) || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Validate tool parameters against the tool's input schema
   *
   * Uses Ajv to validate parameters against the JSON schema.
   *
   * @param tool - Tool definition with input schema
   * @param params - Parameters to validate
   * @param context - Request context for error reporting
   * @throws Error if validation fails
   * @private
   */
  private validateToolParameters(tool: Tool, params: unknown, context: RequestContext): void {
    // Create Ajv instance for schema validation
    const ajv = new Ajv({ allErrors: true });

    // Compile the schema
    const validate = ajv.compile(tool.inputSchema);

    // Validate the parameters
    const valid = validate(params);

    if (!valid) {
      const errors =
        validate.errors?.map((err) => ({
          path: err.instancePath || err.schemaPath,
          message: err.message || 'Validation error',
        })) || [];

      throw this.createToolError(
        ErrorCode.VALIDATION_ERROR,
        `Parameter validation failed for tool: ${tool.namespacedName}`,
        context,
        {
          serviceName: tool.serviceName,
          toolName: tool.name,
          validationErrors: errors,
        }
      );
    }
  }

  /**
   * Execute a tool call via MCP protocol
   *
   * Sends a tools/call request to the service and waits for the response.
   * Maintains request context and correlation ID throughout the call.
   *
   * @param connection - Connection to the service
   * @param toolName - Name of the tool to call
   * @param params - Tool parameters
   * @param context - Request context
   * @returns Promise resolving to the tool execution result
   * @private
   */
  private async executeToolCall(
    connection: Connection,
    toolName: string,
    params: unknown,
    context: RequestContext
  ): Promise<unknown> {
    // Create the JSON-RPC request
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: context.requestId,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: params,
      },
    };

    // Send the request via the transport
    await connection.transport.send(request);

    // Wait for the response
    // Note: In a real implementation, we would need to handle the async iterator
    // and match responses to requests by ID. For now, we'll use a simplified approach.
    const responseIterator = connection.transport.receive();
    const nextResult = await responseIterator.next();
    const response = nextResult.value as JsonRpcSuccessResponse | JsonRpcErrorResponse | null;

    if (!response) {
      throw new Error('No response received from service');
    }

    // Check if it's an error response
    if ('error' in response && response) {
      const errorResponse = response;
      throw this.createToolError(
        errorResponse.error.code,
        errorResponse.error.message,
        context,
        errorResponse.error.data
      );
    }

    // Check if it's a success response
    if ('result' in response && response) {
      const successResponse = response;
      return successResponse.result;
    }

    throw new Error('Invalid response format from service');
  }

  /**
   * Create a properly formatted tool error
   *
   * Creates an error with JSON-RPC error format including context information.
   *
   * @param code - Error code
   * @param message - Error message
   * @param context - Request context
   * @param data - Additional error data
   * @param cause - Original error if any
   * @returns Error object with proper formatting
   * @private
   */
  private createToolError(
    code: number,
    message: string,
    context: RequestContext,
    data?: Record<string, unknown>,
    cause?: Error
  ): Error {
    const error = new Error(message, { cause }) as Error & {
      code: number;
      data: Record<string, unknown>;
    };

    error.code = code;
    error.data = {
      correlationId: context.correlationId,
      requestId: context.requestId,
      sessionId: context.sessionId,
      ...data,
    };

    return error;
  }
}
