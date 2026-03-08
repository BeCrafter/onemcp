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
    // Check cache first (Requirement 2.3)
    if (this.toolCache && !tagFilter) {
      return this.toolCache.tools;
    }

    // Get all services (Requirement 2.1)
    let services: ServiceDefinition[];

    if (tagFilter) {
      // Apply tag filter (Requirements 14.1-14.5)
      const matchAll = tagFilter.logic === 'AND';
      services = await this.serviceRegistry.findByTags(tagFilter.tags, matchAll);
    } else {
      services = await this.serviceRegistry.list();
    }

    // Filter to only enabled services
    const enabledServices = services.filter((service) => service.enabled);

    // Filter to only healthy services
    const healthyServices = enabledServices.filter((service) => {
      const healthStatus = this.healthMonitor.getHealthStatus(service.name);
      // Include service if:
      // 1. No health status yet (not checked), or
      // 2. Health status is healthy
      return !healthStatus || healthStatus.healthy;
    });

    // Discover tools from all healthy enabled services
    const allTools: Tool[] = [];

    for (const service of healthyServices) {
      const pool = this.connectionPools.get(service.name);

      if (!pool) {
        // No connection pool registered for this service, skip
        continue;
      }

      try {
        // Query tools from the service
        const serviceTools = await this.queryServiceTools(service, pool);

        // Filter out disabled tools - only return enabled tools to external clients
        const enabledTools = serviceTools.filter((tool) => tool.enabled);
        allTools.push(...enabledTools);
      } catch (error) {
        // Log error to console for debugging
        console.error(
          `Failed to discover tools from service "${service.name}":`,
          error instanceof Error ? error.message : String(error)
        );
        // Also emit event for programmatic handling
        this.emit('toolDiscoveryError', service.name, error);
      }
    }

    // Cache the results if no tag filter was applied (Requirement 2.3)
    if (!tagFilter) {
      this.toolCache = {
        tools: allTools,
        timestamp: new Date(),
      };
    }

    return allTools;
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
    const service = await this.serviceRegistry.get(serviceName);
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
  public async getToolState(namespacedName: string): Promise<boolean> {
    // Parse the namespaced name to get service and tool names
    const { serviceName, toolName } = this.namespaceManager.parseNamespacedName(namespacedName);

    // Get the service
    const service = await this.serviceRegistry.get(serviceName);
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
  private async queryServiceTools(
    service: ServiceDefinition,
    pool: ConnectionPool
  ): Promise<Tool[]> {
    // Acquire a connection
    const connection = await pool.acquire();

    try {
      // Query tools from the service using MCP protocol
      // For now, we'll use a mock implementation since the actual MCP protocol
      // communication is not yet implemented
      const rawTools = await this.queryToolsViaMCP(connection);

      // Apply namespacing and create Tool objects (Requirement 2.2)
      const tools: Tool[] = rawTools.map((rawTool) => {
        const namespacedName = this.namespaceManager.generateNamespacedName(
          service.name,
          rawTool.name
        );

        // Determine if tool is enabled based on service configuration
        const enabled = this.isToolEnabled(service, rawTool.name);

        return {
          name: rawTool.name,
          namespacedName,
          serviceName: service.name,
          description: rawTool.description || '',
          inputSchema: rawTool.inputSchema || {
            type: 'object',
            properties: {},
          },
          enabled,
        };
      });

      return tools;
    } finally {
      // Always release the connection
      pool.release(connection);
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
  private async queryToolsViaMCP(connection: any): Promise<any[]> {
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
    const { value: response } = await responseIterator.next();

    if (!response) {
      throw new Error('No response received from service for tools/list request');
    }

    // Check if it's an error response
    if ('error' in response) {
      const errorResponse = response as JsonRpcErrorResponse;
      throw new Error(`Failed to query tools from service: ${errorResponse.error.message}`);
    }

    // Check if it's a success response
    if ('result' in response) {
      const successResponse = response as JsonRpcSuccessResponse;
      const result = successResponse.result as { tools?: any[] };

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
    const service = await this.serviceRegistry.get(serviceName);
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

    // Acquire a connection from the pool
    let connection;
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

    try {
      // Execute the tool call via MCP protocol (Requirement 5.3, 5.4)
      const result = await this.executeToolCall(connection, toolName, params, context);

      // Emit success event
      this.emit('toolCallSuccess', {
        namespacedName,
        serviceName,
        toolName,
        context,
      });

      return result;
    } catch (error) {
      // Emit error event
      this.emit('toolCallError', {
        namespacedName,
        serviceName,
        toolName,
        context,
        error,
      });

      // Re-throw with proper error formatting
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
      // Always release the connection back to the pool
      pool.release(connection);
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
    const service = await this.serviceRegistry.get(serviceName);
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
    connection: any,
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
    const { value: response } = await responseIterator.next();

    if (!response) {
      throw new Error('No response received from service');
    }

    // Check if it's an error response
    if ('error' in response) {
      const errorResponse = response as JsonRpcErrorResponse;
      throw this.createToolError(
        errorResponse.error.code,
        errorResponse.error.message,
        context,
        errorResponse.error.data
      );
    }

    // Check if it's a success response
    if ('result' in response) {
      const successResponse = response as JsonRpcSuccessResponse;
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
