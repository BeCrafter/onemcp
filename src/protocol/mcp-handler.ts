/**
 * MCP Protocol Handler
 *
 * Implements MCP protocol methods (initialize, tools/list, tools/call)
 * and handles batch requests.
 */

import type {
  JsonRpcError,
  JsonRpcRequest,
  JsonRpcSuccessResponse,
  JsonRpcErrorResponse,
} from '../types/jsonrpc.js';
import type { ToolRouter } from '../routing/tool-router.js';
import type { RequestContext, TagFilter } from '../types/context.js';
import type { ToolDiscoveryConfig } from '../types/config.js';
import { ErrorCode } from '../types/jsonrpc.js';
import { ErrorBuilder } from '../errors/error-builder.js';
import { getPackageVersion } from '../utils/package-version.js';
import { SEARCH_TOOL_DEFINITION, searchTools } from './tool-search.js';

/**
 * MCP initialize parameters
 */
export interface InitializeParams {
  protocolVersion: string;
  capabilities?: {
    tools?: Record<string, unknown>;
  };
  clientInfo?: {
    name: string;
    version: string;
  };
  tagFilter?: TagFilter;
}

/**
 * MCP initialize result
 */
export interface InitializeResult {
  protocolVersion: string;
  capabilities: {
    tools: Record<string, unknown>;
  };
  serverInfo: {
    name: string;
    version: string;
  };
}

/**
 * Tools list parameters
 */
export interface ToolsListParams {
  tagFilter?: TagFilter;
}

/**
 * Tool call parameters
 */
export interface ToolCallParams {
  name: string;
  arguments?: Record<string, unknown>;
}

/**
 * Batch request
 */
export interface BatchRequest {
  requests: JsonRpcRequest[];
}

/**
 * MCP Protocol Handler class
 *
 * Handles MCP protocol initialization, tool listing, tool calling,
 * and batch request processing.
 */
export class McpProtocolHandler {
  private initialized = false;
  private tagFilter?: TagFilter;
  private readonly maxBatchSize: number;
  private toolDiscoveryConfig: ToolDiscoveryConfig;

  constructor(
    private readonly toolRouter: ToolRouter,
    options?: {
      maxBatchSize?: number;
      tagFilter?: TagFilter;
      toolDiscoveryConfig?: ToolDiscoveryConfig;
    }
  ) {
    this.maxBatchSize = options?.maxBatchSize ?? 100;
    if (options?.tagFilter) {
      this.tagFilter = options.tagFilter;
    }
    this.toolDiscoveryConfig = options?.toolDiscoveryConfig ?? {
      smartDiscovery: false,
      maxResults: 10,
      searchDescription: true,
    };
  }

  /**
   * Handle MCP protocol initialization
   *
   * Establishes client connection and applies tag filters from initialization parameters.
   *
   * Requirements:
   * - 12.1: Handle MCP protocol initialization handshake
   * - 14.5: Apply tag filters from initialization parameters
   *
   * @param params - Initialize parameters
   * @param context - Request context
   * @returns Initialize result
   */
  async initialize(params: InitializeParams, _context: RequestContext): Promise<InitializeResult> {
    // Store tag filter if provided
    if (params.tagFilter) {
      this.tagFilter = params.tagFilter;
    }

    this.initialized = true;

    // Use Promise.resolve to satisfy require-await rule
    await Promise.resolve();

    return {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {
          listChanged: true,
        },
      },
      serverInfo: {
        name: 'onemcp',
        version: getPackageVersion(),
      },
    };
  }

  /**
   * Handle tools/list request
   *
   * Returns all available tools with schemas, applying tag filters if specified.
   *
   * Requirements:
   * - 12.2: Return all available tools with schemas
   * - 3.10: Include tool enabled/disabled status
   *
   * @param params - Tools list parameters
   * @param context - Request context
   * @returns List of tools
   */
  async toolsList(
    params: ToolsListParams | undefined,
    _context: RequestContext
  ): Promise<{
    tools: Array<{ name: string; description: string; inputSchema: unknown; enabled: boolean }>;
  }> {
    if (!this.initialized) {
      throw new Error('Protocol not initialized');
    }

    // Per-session header overrides server default; fall back to server-level config
    const smartDiscovery = _context.smartDiscovery ?? this.toolDiscoveryConfig.smartDiscovery;
    if (smartDiscovery) {
      return {
        tools: [
          {
            name: SEARCH_TOOL_DEFINITION.name,
            description: SEARCH_TOOL_DEFINITION.description,
            inputSchema: SEARCH_TOOL_DEFINITION.inputSchema,
            enabled: true,
          },
        ],
      };
    }

    const tagFilter = params?.tagFilter ?? _context.tagFilter ?? this.tagFilter;
    const tools = await this.toolRouter.discoverTools(tagFilter);

    return {
      tools: tools.map((tool) => ({
        name: tool.namespacedName,
        description: tool.description,
        inputSchema: tool.inputSchema,
        enabled: tool.enabled,
      })),
    };
  }

  /**
   * Handle tools/call request
   *
   * Executes tool call via ToolRouter and handles errors.
   *
   * Requirements:
   * - 12.3: Execute tool calls via ToolRouter
   *
   * @param params - Tool call parameters
   * @param context - Request context
   * @returns Tool call result
   */
  async toolsCall(params: ToolCallParams, context: RequestContext): Promise<unknown> {
    if (!this.initialized) {
      throw new Error('Protocol not initialized');
    }

    if (!params.name) {
      throw new Error('Tool name is required');
    }

    if (params.name === SEARCH_TOOL_DEFINITION.name) {
      const tagFilter = context.tagFilter ?? this.tagFilter;
      const allTools = await this.toolRouter.discoverTools(tagFilter);
      const args = params.arguments ?? {};
      const query = args['query'] ?? '';
      const limit = args['limit'];
      const searchParams = {
        query: String(query),
        limit: typeof limit === 'number' ? limit : (this.toolDiscoveryConfig.maxResults ?? 10),
        searchDescription: this.toolDiscoveryConfig.searchDescription ?? true,
      };
      return searchTools(allTools, searchParams);
    }

    const result = await this.toolRouter.callTool(params.name, params.arguments ?? {}, context);

    return result;
  }

  /**
   * Handle ping request
   *
   * Implements MCP protocol ping mechanism for connection health monitoring.
   * Returns an empty object as pong response.
   *
   * @returns Empty object as pong response
   */
  async ping(): Promise<Record<string, never>> {
    // Use Promise.resolve to satisfy require-await rule
    await Promise.resolve();
    return {};
  }

  /**
   * Handle batch request
   *
   * Executes multiple tool calls and collects results, handling partial failures.
   *
   * Requirements:
   * - 21.1: Accept batch requests with multiple tool calls
   * - 21.2: Execute all calls and collect results
   * - 21.4: Handle partial failures (continue on error)
   * - 21.5: Enforce batch size limits
   *
   * @param requests - Array of JSON-RPC requests
   * @param context - Request context
   * @returns Array of responses (success or error)
   */
  async handleBatch(
    requests: JsonRpcRequest[],
    context: RequestContext
  ): Promise<Array<JsonRpcSuccessResponse | JsonRpcErrorResponse>> {
    // Enforce batch size limit (Requirement 21.5)
    if (requests.length > this.maxBatchSize) {
      throw new Error(`Batch size ${requests.length} exceeds maximum ${this.maxBatchSize}`);
    }

    // Execute all requests and collect results (Requirements 21.2, 21.4)
    const responses: Array<JsonRpcSuccessResponse | JsonRpcErrorResponse> = [];

    for (const request of requests) {
      try {
        // Create a new context for each request with unique correlation ID
        const requestContext: RequestContext = {
          ...context,
          requestId: String(request.id),
          correlationId: `${context.correlationId}-${request.id}`,
        };

        // Route the request
        const result = await this.handleRequest(request, requestContext);
        responses.push(result);
      } catch (error) {
        // Continue on error (Requirement 21.4)
        const errorResponse: JsonRpcErrorResponse = {
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: ErrorCode.INTERNAL_ERROR,
            message: error instanceof Error ? error.message : 'Unknown error',
            data: {
              correlationId: context.correlationId,
              requestId: String(request.id),
            },
          },
        };
        responses.push(errorResponse);
      }
    }

    return responses;
  }

  /**
   * Handle a single JSON-RPC request
   *
   * Routes the request to the appropriate handler based on the method.
   *
   * @param request - JSON-RPC request
   * @param context - Request context
   * @returns JSON-RPC response
   */
  async handleRequest(
    request: JsonRpcRequest,
    context: RequestContext
  ): Promise<JsonRpcSuccessResponse | JsonRpcErrorResponse> {
    try {
      let result: unknown;

      switch (request.method) {
        case 'initialize':
          result = await this.initialize(request.params as InitializeParams, context);
          break;

        case 'tools/list':
          result = await this.toolsList(request.params as ToolsListParams | undefined, context);
          break;

        case 'tools/call':
          result = await this.toolsCall(request.params as ToolCallParams, context);
          break;

        case 'ping':
          result = await this.ping();
          break;

        default:
          return ErrorBuilder.methodNotFound(request.method, request.id, context);
      }

      return {
        jsonrpc: '2.0',
        id: request.id,
        result,
      };
    } catch (error) {
      // Build error response
      if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
        const err = error as { code: number; message: string; data?: unknown };
        const errResponse: JsonRpcError = {
          code: err.code,
          message: err.message,
        };
        if (err.data !== undefined && err.data !== null) {
          errResponse.data = err.data;
        }
        return {
          jsonrpc: '2.0',
          id: request.id,
          error: errResponse,
        };
      }

      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: ErrorCode.INTERNAL_ERROR,
          message: error instanceof Error ? error.message : 'Unknown error',
          data: {
            correlationId: context.correlationId,
            requestId: context.requestId,
          },
        },
      };
    }
  }

  /**
   * Check if the protocol is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get the current tag filter
   */
  getTagFilter(): TagFilter | undefined {
    return this.tagFilter;
  }
}
