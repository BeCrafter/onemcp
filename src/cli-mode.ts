/**
 * CLI Mode Runner
 *
 * Implements CLI mode functionality where the router communicates with a single
 * client via stdin/stdout using the stdio transport protocol.
 */

import { stdin, stdout } from 'node:process';
import type { SystemConfig, ToolDiscoveryConfig } from './types/config.js';
import type { JsonRpcMessage, JsonRpcNotification } from './types/jsonrpc.js';
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
import { silenceStderrForShutdown } from './utils/silence-stderr-shutdown.js';
import { collectServiceTriggerHints } from './protocol/smart-discovery-description.js';
import * as log from './utils/logger.js';
import { getPackageVersion } from './utils/package-version.js';

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
  private readonly tagFilter?: TagFilter;
  private readonly toolDiscoveryConfig?: ToolDiscoveryConfig;
  private cliInitialized = false;
  /** Whether the connected client uses Content-Length framing (true) or NDJSON (false). Defaults true for spec compliance, auto-detects from first message. */
  private useContentLength = true;

  constructor(
    private config: SystemConfig,
    configProvider: ConfigProvider,
    tagFilterParam?: TagFilter,
    toolDiscoveryConfigParam?: ToolDiscoveryConfig
  ) {
    if (tagFilterParam !== undefined) {
      this.tagFilter = tagFilterParam;
    }
    if (toolDiscoveryConfigParam !== undefined) {
      this.toolDiscoveryConfig = toolDiscoveryConfigParam;
    }
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

    const handlerOptions: {
      maxBatchSize: number;
      tagFilter?: TagFilter;
      toolDiscoveryConfig?: ToolDiscoveryConfig;
    } = {
      maxBatchSize: 100,
    };
    if (tagFilterParam) {
      handlerOptions.tagFilter = tagFilterParam;
    }
    if (toolDiscoveryConfigParam) {
      const aggregated = collectServiceTriggerHints(this.config.mcpServers);
      const merged: ToolDiscoveryConfig = {
        ...toolDiscoveryConfigParam,
        serviceTriggerHints: {
          ...aggregated,
          ...(toolDiscoveryConfigParam.serviceTriggerHints ?? {}),
        },
      };
      handlerOptions.toolDiscoveryConfig = merged;
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
    log.info('Starting MCP Router in CLI mode...');

    try {
      // Initialize service registry
      await this.serviceRegistry.initialize();
      log.info(`Loaded ${Object.keys(this.config.mcpServers).length} service(s)`);

      // Create connection pools for all enabled services
      this.initializeConnectionPools();

      // Pre-warm tool cache in smart discovery mode
      if (this.toolDiscoveryConfig?.smartDiscovery) {
        if (this.toolDiscoveryConfig.eagerVerify) {
          // Blocking: verify connections then warm tool cache before accepting requests
          log.info('Verifying connections for all enabled services (eager)...');
          const verifyResult = await this.toolRouter.verifyConnections(this.tagFilter);

          if (verifyResult.failed.length > 0) {
            log.warn(`${verifyResult.failed.length} service(s) failed verification:`);
            for (const f of verifyResult.failed) {
              log.warn(`  - ${f.service}: ${f.error}`);
            }
          }

          if (verifyResult.succeeded.length === 0 && verifyResult.failed.length > 0) {
            throw new Error(
              `All ${verifyResult.failed.length} service(s) failed verification. At least one service must be reachable.`
            );
          }

          log.info(
            `Connections verified: ${verifyResult.succeeded.length} succeeded, ${verifyResult.failed.length} failed`
          );
          log.info('Pre-warming tool cache...');
          await this.toolRouter.discoverTools(this.tagFilter);
          log.info('Tool cache warmed');
        } else {
          // Non-blocking: warm cache in background; first search_tools may wait briefly
          log.info('Pre-warming tool cache in background...');
          void this.toolRouter.discoverTools(this.tagFilter).catch((error: unknown) => {
            log.error(
              `Background cache warm-up failed: ${error instanceof Error ? error.message : String(error)}`
            );
          });
        }
      }

      // Protocol handler already initialized in constructor

      // Start health monitoring if enabled
      if (this.config.healthCheck.enabled) {
        this.healthMonitor.startHeartbeat(
          this.config.healthCheck.interval,
          this.config.healthCheck.failureThreshold ?? 3
        );
        log.info('Health monitoring started');
      }

      // Set up stdin/stdout communication
      this.setupStdioTransport();

      // Listen for tool list changes and notify clients
      this.toolRouter.on('cacheInvalidated', () => {
        void this.sendNotification({
          jsonrpc: '2.0',
          method: 'notifications/tools/list_changed',
          params: {},
        });
      });

      this.running = true;

      const svcCount = Object.keys(this.config.mcpServers).length;
      const enabledCount = Object.values(this.config.mcpServers).filter(
        (s) => s.enabled !== false
      ).length;

      log.info('');
      log.info('╔══════════════════════════════════════════════════════════════╗');
      log.info('║                    onemcp MCP Router                        ║');
      log.info('╚══════════════════════════════════════════════════════════════╝');
      log.info(`  版本: ${getPackageVersion()}    模式: cli       传输: stdio`);
      log.info(`  服务: ${svcCount} 个已配置, ${enabledCount} 个已启用`);
      log.info('');
      log.info('  ── MCP 协议 ─────────────────────────────────────────────────');
      log.info('  输入: stdin (Content-Length 帧 或 NDJSON 自动检测)');
      log.info('  输出: stdout (Content-Length 帧)');
      log.info('  日志: stderr (不影响 MCP 协议)');
      log.info('');
      log.info('  ── 支持的方法 ───────────────────────────────────────────────');
      log.info('  initialize / notifications/initialized / tools/list / tools/call');
      log.info('  ping / resources/list / prompts/list / logging/setLevel');
      log.info('');
      log.info('  ── MCP 客户端配置 ───────────────────────────────────────────');
      log.info(`  命令: node ${process.argv[1] ?? 'dist/cli.js'} --mode cli`);
      log.info('  协议版本: 2024-11-05');
      log.info('╚══════════════════════════════════════════════════════════════╝');
      log.info('');
      // Write directly to stderr so the test harness can detect readiness even
      // when the logger's stderr output is silenced in CLI mode.
      process.stderr.write('[INFO] MCP Router is ready and listening on stdin/stdout\n');
    } catch (error) {
      log.error(
        `Failed to start CLI mode: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  /**
   * Initialize connection pools for all enabled services
   */
  private initializeConnectionPools(): void {
    const services = this.serviceRegistry.list();
    const enabledServices = services.filter((s) => s.enabled);

    for (const service of enabledServices) {
      try {
        // Create connection pool for the service
        const pool = new ConnectionPool(
          service,
          service.connectionPool || this.config.connectionPool
        );

        // Listen for pool errors to prevent unhandled error events
        pool.on('error', () => {
          // Pool errors are already logged by ConnectionPool, no need to log again
        });

        // Register the pool with the tool router
        this.toolRouter.registerConnectionPool(service.name, pool);
        this.connectionPools.set(service.name, pool);

        // Register with health monitor (initial health check runs in background)
        void this.healthMonitor.registerConnectionPool(service.name, pool).catch(() => {});

        log.info(`Initialized connection pool for service: ${service.name}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error(
          `Failed to initialize connection pool for service ${service.name}: ${errorMessage}`
        );
        this.healthMonitor.recordInitFailure(service.name, errorMessage);
      }
    }
  }

  /**
   * Set up stdin/stdout transport for client communication.
   *
   * Supports two framing formats for reading (stdin):
   *   1. Content-Length: length-prefixed messages per MCP stdio transport spec
   *   2. NDJSON: newline-delimited JSON (used by MCP SDK and Inspector)
   *
   * Writing (stdout) always uses Content-Length framing per MCP spec.
   */
  private setupStdioTransport(): void {
    let buffer = '';
    const HEADER_RE = /Content-Length:\s*(\d+)\r?\n\r?\n/;

    stdin.setEncoding('utf8');
    stdin.on('data', (chunk: string) => {
      buffer += chunk;

      // Try Content-Length framed messages first (MCP spec standard)
      let clParsed = false;
      for (;;) {
        const match = HEADER_RE.exec(buffer);
        if (!match) break;

        clParsed = true;
        this.useContentLength = true;

        const rawLength = match[1];
        if (rawLength === undefined) {
          buffer = buffer.slice(match.index + match[0].length);
          continue;
        }
        const contentLength = parseInt(rawLength, 10);
        if (isNaN(contentLength) || contentLength <= 0) {
          buffer = buffer.slice(match.index + match[0].length);
          continue;
        }

        const headerEnd = match.index + match[0].length;
        if (buffer.length - headerEnd < contentLength) break;

        const body = buffer.slice(headerEnd, headerEnd + contentLength);
        buffer = buffer.slice(headerEnd + contentLength);

        // Also consume any trailing \r\n between frames
        if (buffer.startsWith('\r\n')) {
          buffer = buffer.slice(2);
        } else if (buffer.startsWith('\n')) {
          buffer = buffer.slice(1);
        }

        void this.handleStdinFrame(body);
      }

      // Fall back to NDJSON: split on newlines (used by MCP SDK/Inspector).
      // If no Content-Length frames were parsed and the buffer contains JSON,
      // auto-detect NDJSON mode.
      if (!clParsed) {
        // Check if buffer contains NDJSON (line starting with '{')
        if (buffer.trim().startsWith('{')) {
          this.useContentLength = false;
        }
        if (!this.useContentLength) {
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed) {
              void this.handleStdinFrame(trimmed);
            }
          }
        }
      }
    });

    stdin.on('end', () => {
      silenceStderrForShutdown();
      this.stop().catch(() => {
        process.exit(1);
      });
    });
  }

  private handleStdinFrame(body: string): void {
    const trimmed = body.trim();
    if (!trimmed) return;

    try {
      const message = this.parser.parse(trimmed);
      void this.processMessage(message);
    } catch (error) {
      const errorResponse = {
        jsonrpc: '2.0' as const,
        id: 0,
        error: {
          code: ErrorCode.PARSE_ERROR,
          message: `Parse error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      };
      void this.sendResponse(errorResponse);
    }
  }

  /**
   * Write a frame to stdout using the detected protocol format.
   * Content-Length framing (MCP spec) or NDJSON (MCP SDK/Inspector compatibility).
   */
  private writeFrame(payload: string): void {
    if (this.useContentLength) {
      const bodyBytes = Buffer.byteLength(payload, 'utf8');
      stdout.write(`Content-Length: ${bodyBytes}\r\n\r\n${payload}`);
    } else {
      stdout.write(payload + '\n');
    }
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

    // Check if it's a request (has method field AND id field).
    // Notifications have method but no id — must NOT be responded to per MCP spec.
    if ('method' in message && message.method && 'id' in message) {
      const request = message;

      // Create request context
      const context: RequestContext = {
        requestId: String(request.id),
        correlationId: randomUUID(),
        timestamp: new Date(),
        sessionInitialized: this.cliInitialized,
      };

      try {
        // Handle the request
        const response = await this.protocolHandler.handleRequest(request, context);

        if (request.method === 'initialize' && 'result' in response) {
          this.cliInitialized = true;
        }

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
      // It's a notification or response from the client
      // In CLI mode, we receive notifications like 'notifications/initialized'
      // Log these for debugging purposes
      const notification = message as JsonRpcNotification;
      log.info(`Received notification: ${notification.method}`);
    }
  }

  /**
   * Send a JSON-RPC response to stdout using Content-Length framing per MCP spec.
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
      this.writeFrame(serialized);
    } catch (error) {
      log.error(
        `Failed to send response: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Send a JSON-RPC notification to stdout using Content-Length framing per MCP spec.
   *
   * @param notification - Notification to send
   */
  private sendNotification(notification: JsonRpcMessage): void {
    try {
      const serialized = this.serializer.serialize(notification);
      this.writeFrame(serialized);
    } catch (error) {
      log.error(
        `Failed to send notification: ${error instanceof Error ? error.message : String(error)}`
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

    // Ensure stderr is silenced for this entire shutdown sequence.
    // In CLI/stdio mode, any stderr write is forwarded by the inspector to the browser
    // SSE transport. If that transport is already closed, the inspector crashes.
    // This is idempotent — safe to call even if already silenced by the signal handler.
    silenceStderrForShutdown();

    this.running = false;

    try {
      // Stop health monitoring
      if (this.config.healthCheck.enabled) {
        this.healthMonitor.stopHeartbeat();
        log.info('Health monitoring stopped');
      }

      // Close all connection pools
      for (const [serviceName, pool] of this.connectionPools.entries()) {
        try {
          await pool.closeAll();
          log.info(`Closed connection pool for service: ${serviceName}`);
        } catch (error) {
          log.warn(
            `Error closing connection pool for service ${serviceName}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      // stdin is paused to stop accepting new data — no explicit cleanup needed
      // The stdin 'end' handler will call stop()

      log.info('MCP Router shutdown complete');
    } catch (error) {
      log.error(`Error during shutdown: ${error instanceof Error ? error.message : String(error)}`);
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
