/**
 * CLI Mode Runner
 *
 * Implements CLI mode functionality where the router communicates with a single
 * client via stdin/stdout using the stdio transport protocol.
 */

import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline';
import type { SystemConfig } from './types/config.js';
import type { JsonRpcMessage, JsonRpcRequest } from './types/jsonrpc.js';
import { JsonRpcParser } from './protocol/parser.js';
import { JsonRpcSerializer } from './protocol/serializer.js';
import { McpProtocolHandler } from './protocol/mcp-handler.js';
import { ServiceRegistry } from './registry/service-registry.js';
import { NamespaceManager } from './namespace/manager.js';
import { HealthMonitor } from './health/health-monitor.js';
import { ToolRouter } from './routing/tool-router.js';
import { ConnectionPool } from './pool/connection-pool.js';
import type { ConfigProvider } from './types/config.js';
import { ErrorCode } from './types/jsonrpc.js';
import type { RequestContext } from './types/context.js';
import type { TagFilter } from './types/tool.js';
import { randomUUID } from 'node:crypto';

/**
 * CLI Mode Runner class
 *
 * Manages the lifecycle of the router in CLI mode:
 * - Initializes all components from configuration
 * - Sets up stdin/stdout communication
 * - Processes JSON-RPC requests from stdin
 * - Sends JSON-RPC responses to stdout
 * - Handles graceful shutdown
 */
export class CliModeRunner {
  private parser: JsonRpcParser;
  private serializer: JsonRpcSerializer;
  private protocolHandler: McpProtocolHandler | null = null;
  private serviceRegistry: ServiceRegistry;
  private namespaceManager: NamespaceManager;
  private healthMonitor: HealthMonitor;
  private toolRouter: ToolRouter;
  private connectionPools: Map<string, ConnectionPool> = new Map();
  private running = false;
  private readline: ReturnType<typeof createInterface> | null = null;

  constructor(
    private config: SystemConfig,
    configProvider: ConfigProvider,
    tagFilter?: TagFilter
  ) {
    this.parser = new JsonRpcParser();
    this.serializer = new JsonRpcSerializer();
    this.serviceRegistry = new ServiceRegistry(configProvider);
    this.namespaceManager = new NamespaceManager();
    this.healthMonitor = new HealthMonitor(this.serviceRegistry);
    this.toolRouter = new ToolRouter(
      this.serviceRegistry,
      this.namespaceManager,
      this.healthMonitor
    );

    // Initialize protocol handler with tag filter
    const handlerOptions: { maxBatchSize: number; tagFilter?: TagFilter } = {
      maxBatchSize: 100,
    };
    if (tagFilter) {
      handlerOptions.tagFilter = tagFilter;
    }
    this.protocolHandler = new McpProtocolHandler(this.toolRouter, handlerOptions);
  }

  /**
   * Start the CLI mode runner
   *
   * Initializes the system, starts health monitoring, and begins processing
   * requests from stdin.
   */
  async start(): Promise<void> {
    console.error('Starting MCP Router in CLI mode...');

    try {
      // Initialize service registry
      await this.serviceRegistry.initialize();
      console.error(`Loaded ${Object.keys(this.config.mcpServers).length} service(s)`);

      // Create connection pools for all enabled services
      await this.initializeConnectionPools();

      // Protocol handler already initialized in constructor

      // Start health monitoring if enabled
      if (this.config.healthCheck.enabled) {
        this.healthMonitor.startHeartbeat(
          this.config.healthCheck.interval,
          this.config.healthCheck.failureThreshold ?? 3
        );
        console.error('Health monitoring started');
      }

      // Set up stdin/stdout communication
      this.setupStdioTransport();

      this.running = true;
      console.error('MCP Router is ready and listening on stdin/stdout');
    } catch (error) {
      console.error(
        `Failed to start CLI mode: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  /**
   * Initialize connection pools for all enabled services
   */
  private async initializeConnectionPools(): Promise<void> {
    // Use Promise.resolve to satisfy require-await rule
    await Promise.resolve();

    const services = this.serviceRegistry.list();
    const enabledServices = services.filter((s) => s.enabled);

    for (const service of enabledServices) {
      try {
        // Create connection pool for the service
        const pool = new ConnectionPool(
          service,
          service.connectionPool || this.config.connectionPool
        );

        // Register the pool with the tool router
        this.toolRouter.registerConnectionPool(service.name, pool);
        this.connectionPools.set(service.name, pool);

        console.error(`Initialized connection pool for service: ${service.name}`);
      } catch (error) {
        console.error(
          `Failed to initialize connection pool for service ${service.name}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  /**
   * Set up stdin/stdout transport for client communication
   *
   * Reads JSON-RPC messages from stdin line by line and processes them.
   * Sends responses to stdout.
   */
  private setupStdioTransport(): void {
    // Create readline interface for line-by-line reading.
    // Use stderr for output so stdout is used only for MCP JSON-RPC messages.
    this.readline = createInterface({
      input: stdin,
      output: process.stderr,
      terminal: false,
    });

    // Process each line as a JSON-RPC message
    this.readline.on('line', (line: string) => {
      void (async () => {
        const trimmed = line.trim();
        if (!trimmed) {
          return; // Skip empty lines
        }

        try {
          // Parse the JSON-RPC message
          const message = this.parser.parse(trimmed);

          // Process the message
          await this.processMessage(message);
        } catch (error) {
          // Send parse error response. Use a valid id (0) so MCP clients that require id: string|number can parse it.
          const errorResponse = {
            jsonrpc: '2.0' as const,
            id: 0,
            error: {
              code: ErrorCode.PARSE_ERROR,
              message: `Parse error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          };

          // Send error response to client
          void this.sendResponse(errorResponse);
        }
      })();
    });

    // Handle stdin close
    this.readline.on('close', () => {
      console.error('stdin closed, shutting down...');
      this.stop().catch((error) => {
        console.error(`Error during shutdown: ${error}`);
        process.exit(1);
      });
    });
  }

  /**
   * Process a JSON-RPC message
   *
   * Routes the message to the protocol handler and sends the response.
   *
   * @param message - JSON-RPC message to process
   */
  private async processMessage(message: JsonRpcMessage): Promise<void> {
    if (!this.protocolHandler) {
      throw new Error('Protocol handler not initialized');
    }

    // Check if it's a request (has method field)
    if ('method' in message && message.method) {
      const request = message as JsonRpcRequest;

      // Create request context
      const context: RequestContext = {
        requestId: String(request.id),
        correlationId: randomUUID(),
        timestamp: new Date(),
      };

      try {
        // Handle the request
        const response = await this.protocolHandler.handleRequest(request, context);

        // Send the response
        this.sendResponse(response);
      } catch (error) {
        // Send error response
        const errorResponse = {
          jsonrpc: '2.0' as const,
          id: request.id,
          error: {
            code: -32603,
            message: 'Internal error',
            data: {
              details: error instanceof Error ? error.message : String(error),
              correlationId: context.correlationId,
            },
          },
        };

        this.sendResponse(errorResponse);
      }
    } else {
      // It's a notification or response, which we don't handle in CLI mode
      console.error('Received non-request message, ignoring');
    }
  }

  /**
   * Send a JSON-RPC response to stdout.
   * Normalizes id to never be null/undefined so MCP clients that require id: string|number can parse it.
   */
  private sendResponse(response: JsonRpcMessage): void {
    try {
      const isResponse =
        ('result' in response && response.result !== undefined) ||
        ('error' in response && response.error !== undefined);
      const idInvalid =
        isResponse && 'id' in response && (response.id === null || response.id === undefined);
      const out: JsonRpcMessage = idInvalid ? { ...response, id: 0 } : response;
      const serialized = this.serializer.serialize(out);
      stdout.write(serialized + '\n');
    } catch (error) {
      console.error(
        `Failed to send response: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Stop the CLI mode runner
   *
   * Performs graceful shutdown:
   * - Stops accepting new requests
   * - Stops health monitoring
   * - Closes all connection pools
   * - Closes stdin/stdout
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    console.error('Shutting down MCP Router...');
    this.running = false;

    try {
      // Stop health monitoring
      if (this.config.healthCheck.enabled) {
        this.healthMonitor.stopHeartbeat();
        console.error('Health monitoring stopped');
      }

      // Close all connection pools
      for (const [serviceName, pool] of this.connectionPools.entries()) {
        try {
          await pool.closeAll();
          console.error(`Closed connection pool for service: ${serviceName}`);
        } catch (error) {
          console.error(
            `Error closing connection pool for service ${serviceName}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      // Close readline interface
      if (this.readline) {
        this.readline.close();
        this.readline = null;
      }

      console.error('MCP Router shutdown complete');
    } catch (error) {
      console.error(
        `Error during shutdown: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  /**
   * Check if the runner is currently running
   */
  isRunning(): boolean {
    return this.running;
  }
}
