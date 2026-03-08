/**
 * Server Mode Runner
 *
 * Implements Server mode functionality where the router acts as an HTTP server
 * and handles multiple concurrent client connections using Streamable HTTP protocol.
 */

import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { SystemConfig } from './types/config.js';
import type { JsonRpcRequest } from './types/jsonrpc.js';
import type { TagFilter } from './types/tool.js';
import { JsonRpcParser } from './protocol/parser.js';
import { McpProtocolHandler } from './protocol/mcp-handler.js';
import { ServiceRegistry } from './registry/service-registry.js';
import { NamespaceManager } from './namespace/manager.js';
import { HealthMonitor } from './health/health-monitor.js';
import { ToolRouter } from './routing/tool-router.js';
import { ConnectionPool } from './pool/connection-pool.js';
import { SessionManager } from './session/session-manager.js';
import { MetricsService } from './metrics/service.js';
import type { ConfigProvider } from './types/config.js';
import type { RequestContext } from './types/context.js';

/**
 * Server Mode Runner class
 *
 * Manages the lifecycle of the router in Server mode:
 * - Initializes all components from configuration
 * - Sets up Fastify HTTP server
 * - Handles multiple concurrent client connections
 * - Manages sessions for client isolation
 * - Provides health, diagnostics, and metrics endpoints
 * - Handles graceful shutdown
 */
export class ServerModeRunner {
  private fastify: FastifyInstance;
  private parser: JsonRpcParser;
  private protocolHandler: McpProtocolHandler | null = null;
  private serviceRegistry: ServiceRegistry;
  private namespaceManager: NamespaceManager;
  private healthMonitor: HealthMonitor;
  private toolRouter: ToolRouter;
  private sessionManager: SessionManager;
  private metricsService: MetricsService;
  private connectionPools: Map<string, ConnectionPool> = new Map();
  private running = false;
  private configProvider: ConfigProvider;
  private unwatchConfig: (() => void) | null = null;

  constructor(
    private config: SystemConfig,
    configProvider: ConfigProvider
  ) {
    this.fastify = Fastify({
      logger: false, // We use our own logger
      disableRequestLogging: true,
    });

    this.parser = new JsonRpcParser();
    this.configProvider = configProvider;
    this.serviceRegistry = new ServiceRegistry(configProvider);
    this.namespaceManager = new NamespaceManager();
    this.healthMonitor = new HealthMonitor(this.serviceRegistry);
    this.sessionManager = new SessionManager();
    this.metricsService = new MetricsService(
      config.metrics || {
        enabled: true,
        collectionInterval: 60000,
        retentionPeriod: 86400000,
      }
    );
    this.toolRouter = new ToolRouter(
      this.serviceRegistry,
      this.namespaceManager,
      this.healthMonitor
    );

    this.setupRoutes();
  }

  /**
   * Set up HTTP routes
   */
  private setupRoutes(): void {
    // Main MCP endpoint - handles JSON-RPC requests
    this.fastify.post('/mcp', async (request: FastifyRequest, reply: FastifyReply) => {
      return this.handleMcpRequest(request, reply);
    });

    // Health check endpoint
    this.fastify.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
      return this.handleHealthCheck(request, reply);
    });

    // Diagnostics endpoint
    this.fastify.get('/diagnostics', async (request: FastifyRequest, reply: FastifyReply) => {
      return this.handleDiagnostics(request, reply);
    });

    // Metrics endpoint
    this.fastify.get('/metrics', async (_request: FastifyRequest, _reply: FastifyReply) => {
      return this.handleMetrics(_request, _reply);
    });

    // Root endpoint - basic info
    this.fastify.get('/', async (_request: FastifyRequest, _reply: FastifyReply) => {
      return {
        name: 'MCP Router System',
        version: '0.1.0',
        mode: 'server',
        status: 'running',
      };
    });
  }

  /**
   * Handle MCP JSON-RPC requests
   */
  private async handleMcpRequest(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!this.protocolHandler) {
      reply.code(503).send({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32603,
          message: 'Server not initialized',
        },
      });
      return;
    }

    try {
      // Get or create session
      const sessionId = this.getSessionId(request);
      let session = this.sessionManager.getSession(sessionId);

      if (!session) {
        // Create new session for this client
        const agentId = this.getAgentId(request);

        // Parse tag filter from HTTP header (X-MCP-Tags: "tag1,tag2,tag3")
        let tagFilter: TagFilter | undefined;
        const tagsHeader = request.headers['x-mcp-tags'];
        if (tagsHeader && typeof tagsHeader === 'string') {
          const tags = tagsHeader
            .split(',')
            .map((t) => t.trim())
            .filter((t) => t.length > 0);
          if (tags.length > 0) {
            tagFilter = { tags, logic: 'OR' };
            console.error(`Tag filter from header: ${tags.join(', ')} (OR logic)`);
          }
        }

        const sessionContext: { tagFilter?: TagFilter } = {};
        if (tagFilter) {
          sessionContext.tagFilter = tagFilter;
        }
        session = this.sessionManager.createSession(agentId, sessionContext);
      }

      // Parse request body
      const body = request.body as string | object;
      const messageText = typeof body === 'string' ? body : JSON.stringify(body);

      let message;
      try {
        message = this.parser.parse(messageText);
      } catch (parseError) {
        // Parse error
        reply.code(400).send({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32700,
            message: 'Parse error',
            data: {
              details: parseError instanceof Error ? parseError.message : String(parseError),
            },
          },
        });
        return;
      }

      // Check if it's a request
      if ('method' in message && message.method) {
        const jsonRpcRequest = message as JsonRpcRequest;

        // Create request context with session info
        const sessionTagFilter = session.context.tagFilter;
        const context: RequestContext = {
          requestId: String(jsonRpcRequest.id),
          correlationId: randomUUID(),
          sessionId: session.id,
          agentId: session.agentId,
          timestamp: new Date(),
        };
        if (sessionTagFilter) {
          context.tagFilter = sessionTagFilter;
        }

        // Track active request
        this.sessionManager.incrementActiveRequests(session.id);

        try {
          // Handle the request
          const response = await this.protocolHandler.handleRequest(jsonRpcRequest, context);

          // Send response
          reply.code(200).send(response);
        } catch (handlerError) {
          // Handler error
          reply.code(500).send({
            jsonrpc: '2.0',
            id: jsonRpcRequest.id,
            error: {
              code: -32603,
              message: 'Internal error',
              data: {
                details:
                  handlerError instanceof Error ? handlerError.message : String(handlerError),
                correlationId: context.correlationId,
              },
            },
          });
        } finally {
          // Decrement active request count
          this.sessionManager.decrementActiveRequests(session.id);
        }
      } else {
        // Not a request
        reply.code(400).send({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32600,
            message: 'Invalid Request',
            data: { details: 'Expected a JSON-RPC request with method field' },
          },
        });
      }
    } catch (error) {
      // Unexpected error
      reply.code(500).send({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32603,
          message: 'Internal error',
          data: {
            details: error instanceof Error ? error.message : String(error),
          },
        },
      });
    }
  }

  /**
   * Handle health check requests
   */
  private async handleHealthCheck(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const healthStatuses = await this.healthMonitor.getAllHealthStatus();
      const allHealthy = healthStatuses.every((status) => status.healthy);

      const response = {
        status: allHealthy ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        services: healthStatuses.map((status) => ({
          name: status.serviceName,
          healthy: status.healthy,
          lastCheck: status.lastCheck.toISOString(),
          error: status.error,
        })),
        sessions: {
          active: this.sessionManager.getActiveSessionCount(),
        },
      };

      reply.code(allHealthy ? 200 : 503).send(response);
    } catch (error) {
      reply.code(500).send({
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Handle diagnostics requests
   */
  private async handleDiagnostics(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const services = await this.serviceRegistry.list();
      const sessions = this.sessionManager.listActiveSessions();
      const healthStatuses = await this.healthMonitor.getAllHealthStatus();

      const response = {
        timestamp: new Date().toISOString(),
        mode: 'server',
        port: this.config.port || 3000,
        services: {
          total: services.length,
          enabled: services.filter((s) => s.enabled).length,
          list: services.map((s) => ({
            name: s.name,
            enabled: s.enabled,
            transport: s.transport,
            tags: s.tags,
          })),
        },
        sessions: {
          active: sessions.length,
          list: sessions.map((s) => ({
            id: s.id,
            agentId: s.agentId,
            createdAt: s.createdAt.toISOString(),
            lastActivity: s.lastActivity.toISOString(),
            activeRequests: s.activeRequests,
          })),
        },
        health: healthStatuses.map((status) => ({
          serviceName: status.serviceName,
          healthy: status.healthy,
          lastCheck: status.lastCheck.toISOString(),
          consecutiveFailures: status.consecutiveFailures,
          error: status.error,
        })),
        connectionPools: Array.from(this.connectionPools.entries()).map(([name, pool]) => ({
          serviceName: name,
          stats: pool.getStats(),
        })),
      };

      reply.code(200).send(response);
    } catch (error) {
      reply.code(500).send({
        error: 'Failed to generate diagnostics',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Handle metrics requests
   */
  private async handleMetrics(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const metrics = this.metricsService.getSystemMetrics();

      reply.code(200).send({
        timestamp: new Date().toISOString(),
        metrics,
      });
    } catch (error) {
      reply.code(500).send({
        error: 'Failed to retrieve metrics',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get session ID from request headers or create new one
   */
  private getSessionId(request: FastifyRequest): string {
    const sessionHeader = request.headers['x-session-id'];
    if (typeof sessionHeader === 'string') {
      return sessionHeader;
    }
    return randomUUID();
  }

  /**
   * Get agent ID from request headers or use default
   */
  private getAgentId(request: FastifyRequest): string {
    const agentHeader = request.headers['x-agent-id'];
    if (typeof agentHeader === 'string') {
      return agentHeader;
    }
    // Use IP address as fallback
    return request.ip || 'unknown';
  }

  /**
   * Start the Server mode runner
   *
   * Initializes the system, starts health monitoring, and starts the HTTP server.
   */
  async start(): Promise<void> {
    console.error('Starting MCP Router in Server mode...');

    try {
      // Initialize service registry
      await this.serviceRegistry.initialize();
      console.error(`Loaded ${this.config.services.length} service(s)`);

      // Create connection pools for all enabled services
      await this.initializeConnectionPools();

      // Initialize protocol handler
      this.protocolHandler = new McpProtocolHandler(this.toolRouter, {
        maxBatchSize: 100,
      });

      // Start health monitoring if enabled
      if (this.config.healthCheck.enabled) {
        this.healthMonitor.startHeartbeat(this.config.healthCheck.interval);
        console.error('Health monitoring started');
      }

      // Start session cleanup
      this.sessionManager.startAutoCleanup(60000, 300000); // Cleanup every minute, 5 min timeout

      this.unwatchConfig = this.configProvider.watch((newConfig) => {
        console.error('Configuration change detected, reloading...');
        this.reloadConfig(newConfig).catch((error) => {
          console.error(
            `Failed to reload configuration: ${error instanceof Error ? error.message : String(error)}`
          );
        });
      });
      console.error('Config file watcher started');

      // Start HTTP server
      const port = this.config.port || 3000;
      const host = '0.0.0.0';

      await this.fastify.listen({ port, host });

      this.running = true;
      console.error(`MCP Router is ready and listening on http://${host}:${port}`);
      console.error(`Health check: http://${host}:${port}/health`);
      console.error(`Diagnostics: http://${host}:${port}/diagnostics`);
      console.error(`Metrics: http://${host}:${port}/metrics`);
    } catch (error) {
      console.error(
        `Failed to start Server mode: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  /**
   * Initialize connection pools for all enabled services
   */
  private async initializeConnectionPools(): Promise<void> {
    const services = await this.serviceRegistry.list();
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

  private async reloadConfig(newConfig: SystemConfig): Promise<void> {
    const oldConfig = this.config;
    this.config = newConfig;

    const oldServices = oldConfig.services;
    const newServices = newConfig.services;

    const oldServiceNames = new Set(oldServices.map((s) => s.name));
    const newServiceNames = new Set(newServices.map((s) => s.name));

    for (const serviceName of oldServiceNames) {
      if (!newServiceNames.has(serviceName)) {
        const pool = this.connectionPools.get(serviceName);
        if (pool) {
          await pool.closeAll();
          this.connectionPools.delete(serviceName);
          this.toolRouter.unregisterConnectionPool(serviceName);
          console.error(`Removed connection pool for deleted service: ${serviceName}`);
        }
      }
    }

    for (const newService of newServices) {
      const oldService = oldServices.find((s) => s.name === newService.name);
      if (!oldService) {
        if (newService.enabled) {
          try {
            const pool = new ConnectionPool(
              newService,
              newService.connectionPool || newConfig.connectionPool
            );
            this.toolRouter.registerConnectionPool(newService.name, pool);
            this.connectionPools.set(newService.name, pool);
            console.error(`Added connection pool for new service: ${newService.name}`);
          } catch (error) {
            console.error(
              `Failed to create connection pool for new service ${newService.name}: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
      } else if (
        oldService.enabled !== newService.enabled ||
        JSON.stringify(oldService.connectionPool) !== JSON.stringify(newService.connectionPool)
      ) {
        const existingPool = this.connectionPools.get(newService.name);
        if (existingPool) {
          await existingPool.closeAll();
          this.connectionPools.delete(newService.name);
          this.toolRouter.unregisterConnectionPool(newService.name);
        }

        if (newService.enabled) {
          try {
            const pool = new ConnectionPool(
              newService,
              newService.connectionPool || newConfig.connectionPool
            );
            this.toolRouter.registerConnectionPool(newService.name, pool);
            this.connectionPools.set(newService.name, pool);
            console.error(`Updated connection pool for service: ${newService.name}`);
          } catch (error) {
            console.error(
              `Failed to update connection pool for service ${newService.name}: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
      }
    }

    await this.serviceRegistry.initialize();
    this.toolRouter.invalidateCache();
    console.error(`Reloaded ${newServices.length} service(s)`);
  }

  /**
   * Stop the Server mode runner
   *
   * Performs graceful shutdown:
   * - Stops accepting new requests
   * - Waits for active requests to complete
   * - Stops health monitoring
   * - Closes all connection pools
   * - Closes all sessions
   * - Stops HTTP server
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    console.error('Shutting down MCP Router...');
    this.running = false;

    try {
      // Stop accepting new connections
      await this.fastify.close();
      console.error('HTTP server closed');

      // Stop session cleanup
      this.sessionManager.stopAutoCleanup();

      // Stop health monitoring
      if (this.config.healthCheck.enabled) {
        this.healthMonitor.stopHeartbeat();
        console.error('Health monitoring stopped');
      }

      // Close all sessions
      await this.sessionManager.closeAllSessions();
      console.error('All sessions closed');

      if (this.unwatchConfig) {
        this.unwatchConfig();
        this.unwatchConfig = null;
        console.error('Config file watcher stopped');
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

  /**
   * Get the Fastify instance (for testing)
   */
  getFastify(): FastifyInstance {
    return this.fastify;
  }
}
