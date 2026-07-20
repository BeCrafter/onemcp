/**
 * Server Mode Runner
 *
 * Implements Server mode functionality where the router acts as an HTTP server
 * and handles multiple concurrent client connections using Streamable HTTP protocol.
 */

import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import type { SystemConfig, ToolDiscoveryConfig } from './types/config.js';
import type { TagFilter } from './types/tool.js';
import { JsonRpcParser } from './protocol/parser.js';
import { McpProtocolHandler } from './protocol/mcp-handler.js';
import { ServiceRegistry } from './registry/service-registry.js';
import { NamespaceManager } from './namespace/manager.js';
import { HealthMonitor } from './health/health-monitor.js';
import { ToolRouter } from './routing/tool-router.js';
import { ConnectionPool } from './pool/connection-pool.js';
import { getPackageVersion } from './utils/package-version.js';
import { SessionManager, type SessionContext } from './session/session-manager.js';
import { MetricsService } from './metrics/service.js';
import type { ConfigProvider } from './types/config.js';
import type { RequestContext } from './types/context.js';
import { collectServiceTriggerHints } from './protocol/smart-discovery-description.js';
import * as log from './utils/logger.js';

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
  // SSE connections keyed by session ID — used to push server notifications to clients
  private sseConnections: Map<string, ServerResponse> = new Map();

  constructor(
    private config: SystemConfig,
    configProvider: ConfigProvider,
    private options: {
      onShutdownComplete?: (() => void) | undefined;
      toolDiscoveryConfig?: ToolDiscoveryConfig | undefined;
    } = {}
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

    // DELETE endpoint for session termination (MCP Streamable HTTP spec)
    this.fastify.delete('/mcp', async (request: FastifyRequest, reply: FastifyReply) => {
      return this.handleSessionTermination(request, reply);
    });

    // SSE endpoint for server-to-client notifications (MCP Streamable HTTP spec)
    this.fastify.get('/mcp', async (request: FastifyRequest, reply: FastifyReply) => {
      return this.handleSseConnection(request, reply);
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
        version: getPackageVersion(),
        mode: 'server',
        status: 'running',
      };
    });
  }

  /**
   * Handle SSE connection for server-to-client notifications (GET /mcp)
   *
   * Per MCP Streamable HTTP spec, clients open a persistent GET /mcp SSE stream
   * so the server can push notifications (e.g. tools/list_changed) at any time.
   */
  private handleSseConnection(request: FastifyRequest, reply: FastifyReply): void {
    // Hijack the response so Fastify never touches it after this handler returns.
    // Without this, Fastify tries to send its own response once the async handler
    // resolves, writing to an already-in-use (or closed) stream and triggering
    // "Not connected" errors in downstream clients.
    void reply.hijack();

    const sessionId = this.getSessionId(request);
    const res = reply.raw;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Session-ID': sessionId,
    });

    // Initial comment — confirms the stream is open without triggering JSON parsing
    res.write(': connected\n\n');

    this.sseConnections.set(sessionId, res);

    // Clean up when client disconnects
    request.raw.on('close', () => {
      this.sseConnections.delete(sessionId);
      try {
        res.end();
      } catch {
        /* already closed */
      }
    });
    // The response stays open naturally because res.end() has not been called.
    // Fastify won't close it because we called reply.hijack().
  }

  /**
   * Send an SSE event to all connected SSE clients
   */
  private broadcastSseEvent(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const [sessionId, res] of this.sseConnections.entries()) {
      try {
        res.write(payload);
      } catch {
        // Client disconnected — remove stale entry
        this.sseConnections.delete(sessionId);
      }
    }
  }

  /**
   * Handle MCP JSON-RPC requests
   */
  private async handleMcpRequest(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!this.protocolHandler) {
      void reply.code(503).send({
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
            log.info(`Tag filter from header: ${tags.join(', ')} (OR logic)`);
          }
        }

        // Parse smart discovery override from HTTP header
        // X-MCP-Smart-Discovery: false  → disable smart discovery for this session
        // X-MCP-Smart-Discovery: true   → enable smart discovery for this session
        // (absent)                      → use server default (--smart-discovery flag or default: disabled)
        let sessionSmartDiscovery: boolean | undefined;
        const smartDiscoveryHeader = request.headers['x-mcp-smart-discovery'];
        if (typeof smartDiscoveryHeader === 'string') {
          const val = smartDiscoveryHeader.trim().toLowerCase();
          if (val === 'false' || val === '0' || val === 'off') {
            sessionSmartDiscovery = false;
          } else if (val === 'true' || val === '1' || val === 'on') {
            sessionSmartDiscovery = true;
          }
          if (sessionSmartDiscovery !== undefined) {
            log.info(
              `Smart discovery from header: ${sessionSmartDiscovery ? 'enabled' : 'disabled'}`
            );
          }
        }

        const sessionContext: SessionContext = {};
        if (tagFilter) {
          sessionContext.tagFilter = tagFilter;
        }
        if (sessionSmartDiscovery !== undefined) {
          sessionContext.smartDiscovery = sessionSmartDiscovery;
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
        void reply.code(400).send({
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

      // Check if it's a request (has method + id) or notification (has method, no id)
      if ('method' in message && message.method && 'id' in message) {
        const jsonRpcRequest = message;

        // Create request context with session info
        const sessionTagFilter = session.context.tagFilter;
        const context: RequestContext = {
          requestId: String(jsonRpcRequest.id),
          correlationId: randomUUID(),
          sessionId: session.id,
          agentId: session.agentId,
          timestamp: new Date(),
          sessionInitialized: session.context.initialized === true,
        };
        if (sessionTagFilter) {
          context.tagFilter = sessionTagFilter;
        }
        if (session.context.smartDiscovery !== undefined) {
          context.smartDiscovery = session.context.smartDiscovery;
        }

        // Track active request
        this.sessionManager.incrementActiveRequests(session.id);

        try {
          // Handle the request
          const response = await this.protocolHandler.handleRequest(jsonRpcRequest, context);

          // Mark session as initialized after successful initialize handshake
          if (jsonRpcRequest.method === 'initialize' && 'result' in response) {
            session.context.initialized = true;
            // Echo session ID back so client includes it in subsequent requests (MCP Streamable HTTP spec)
            void reply.header('mcp-session-id', session.id);
          }

          // Send response
          void reply.code(200).send(response);
        } catch (handlerError) {
          // Handler error
          void reply.code(500).send({
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
      } else if ('method' in message && message.method) {
        // Notification: has method but no id — must not send any JSON-RPC response per MCP spec
        // Use 202 Accepted instead of 204 No Content for compatibility with MCP clients
        void reply.code(202).send();
      } else {
        // Not a request or notification
        void reply.code(400).send({
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
      void reply.code(500).send({
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
   * Handle session termination (DELETE /mcp)
   *
   * Per MCP Streamable HTTP spec, clients send DELETE with Mcp-Session-Id header
   * to explicitly terminate a session. Cleans up SSE connection and session state.
   */
  private async handleSessionTermination(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const sessionId = request.headers['mcp-session-id'];
    if (typeof sessionId === 'string') {
      // Close SSE connection if exists
      const sseRes = this.sseConnections.get(sessionId);
      if (sseRes) {
        this.sseConnections.delete(sessionId);
        try {
          sseRes.end();
        } catch {
          /* already closed */
        }
      }
      // Close session
      await this.sessionManager.closeSession(sessionId);
      log.info(`Session terminated: ${sessionId}`);
    }
    void reply.code(200).send();
  }

  /**
   * Handle health check requests
   *
   * Returns the status of all configured services by merging data from:
   * 1. ServiceRegistry — all configured services (including disabled ones)
   * 2. HealthMonitor — health status of registered services
   * 3. connectionPools — services that successfully created a connection pool
   */
  private handleHealthCheck(_request: FastifyRequest, reply: FastifyReply): void {
    try {
      const services = this.serviceRegistry.list();
      const healthStatuses = this.healthMonitor.getAllHealthStatus();
      const healthMap = new Map(healthStatuses.map((s) => [s.serviceName, s]));

      const serviceDetails = services.map((service) => {
        const health = healthMap.get(service.name);
        const hasPool = this.connectionPools.has(service.name);

        if (!service.enabled) {
          return { name: service.name, status: 'disabled' as const, healthy: null };
        }
        if (!hasPool) {
          const initFailure = this.healthMonitor.getInitFailure(service.name);
          return {
            name: service.name,
            status: 'broken' as const,
            healthy: false,
            error: {
              message: initFailure?.message ?? 'Failed to initialize connection pool',
              code: 'INIT_FAILED',
            },
          };
        }
        if (!health) {
          return {
            name: service.name,
            status: 'initializing' as const,
            healthy: null,
            lastCheck: null,
          };
        }
        return {
          name: service.name,
          status: health.healthy ? ('healthy' as const) : ('degraded' as const),
          healthy: health.healthy,
          lastCheck: health.lastCheck.toISOString(),
          consecutiveFailures: health.consecutiveFailures,
          error: health.error ?? null,
        };
      });

      const hasDegraded = serviceDetails.some(
        (s) => s.status === 'broken' || s.status === 'degraded'
      );
      const overallStatus = hasDegraded ? 'degraded' : 'healthy';

      void reply.code(overallStatus === 'healthy' ? 200 : 503).send({
        status: overallStatus,
        timestamp: new Date().toISOString(),
        services: serviceDetails,
        summary: {
          total: services.length,
          healthy: serviceDetails.filter((s) => s.status === 'healthy').length,
          degraded: serviceDetails.filter((s) => s.status === 'degraded').length,
          broken: serviceDetails.filter((s) => s.status === 'broken').length,
          initializing: serviceDetails.filter((s) => s.status === 'initializing').length,
          disabled: serviceDetails.filter((s) => s.status === 'disabled').length,
        },
        sessions: {
          active: this.sessionManager.getActiveSessionCount(),
        },
      });
    } catch (error) {
      void reply.code(500).send({
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Handle diagnostics requests
   */
  private handleDiagnostics(_request: FastifyRequest, reply: FastifyReply): void {
    try {
      const services = this.serviceRegistry.list();
      const sessions = this.sessionManager.listActiveSessions();
      const healthStatuses = this.healthMonitor.getAllHealthStatus();

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

      void reply.code(200).send(response);
    } catch (error) {
      void reply.code(500).send({
        error: 'Failed to generate diagnostics',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Handle metrics requests
   */
  private handleMetrics(_request: FastifyRequest, reply: FastifyReply): void {
    try {
      const metrics = this.metricsService.getSystemMetrics();

      void reply.code(200).send({
        timestamp: new Date().toISOString(),
        metrics,
      });
    } catch (error) {
      void reply.code(500).send({
        error: 'Failed to retrieve metrics',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get session ID from request headers or create new one
   */
  private getSessionId(request: FastifyRequest): string {
    // MCP Streamable HTTP spec: mcp-session-id (standard)
    const mcpSession = request.headers['mcp-session-id'];
    if (typeof mcpSession === 'string') {
      return mcpSession;
    }
    // Legacy: x-session-id (onemcp custom)
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
    log.info('Starting MCP Router in Server mode...');

    try {
      // Initialize service registry
      await this.serviceRegistry.initialize();
      log.info(`Loaded ${Object.keys(this.config.mcpServers).length} service(s)`);

      // Create connection pools for all enabled services
      this.initializeConnectionPools();

      // Initialize protocol handler
      let mergedToolDiscovery: ToolDiscoveryConfig | undefined;
      if (this.options.toolDiscoveryConfig !== undefined) {
        const aggregated = collectServiceTriggerHints(this.config.mcpServers);
        mergedToolDiscovery = {
          ...this.options.toolDiscoveryConfig,
          serviceTriggerHints: {
            ...aggregated,
            ...(this.options.toolDiscoveryConfig.serviceTriggerHints ?? {}),
          },
        };
      }
      this.protocolHandler = new McpProtocolHandler(this.toolRouter, {
        maxBatchSize: 100,
        ...(mergedToolDiscovery !== undefined && {
          toolDiscoveryConfig: mergedToolDiscovery,
        }),
      });

      // Start health monitoring if enabled
      if (this.config.healthCheck.enabled) {
        void this.healthMonitor.startHeartbeat(
          this.config.healthCheck.interval,
          this.config.healthCheck.failureThreshold ?? 3
        );
        log.info('Health monitoring started');
      }

      // Start session cleanup
      void this.sessionManager.startAutoCleanup(60000, 300000); // Cleanup every minute, 5 min timeout

      this.unwatchConfig = this.configProvider.watch((newConfig) => {
        log.info('Configuration change detected, reloading...');
        void this.reloadConfig(newConfig).catch((error) => {
          log.error(
            `Failed to reload configuration: ${error instanceof Error ? error.message : String(error)}`
          );
        });
      });
      log.info('Config file watcher started');

      // Start HTTP server
      const port = this.config.port || 3000;
      const host = '0.0.0.0';

      await this.fastify.listen({ port, host });

      // Broadcast tools/list_changed notification to all connected SSE clients
      this.toolRouter.on('cacheInvalidated', () => {
        log.debug('Tool list changed - notifying connected clients via SSE');
        this.broadcastSseEvent('message', {
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
      log.info(`  版本: ${getPackageVersion()}    模式: server    端口: ${port}`);
      log.info(`  服务: ${svcCount} 个已配置, ${enabledCount} 个已启用`);
      log.info('');
      log.info('  ── MCP 协议端点 ──────────────────────────────────────────────');
      log.info(
        `  POST   http://127.0.0.1:${port}/mcp   JSON-RPC 请求 (initialize, tools/list, tools/call, ping, ...)`
      );
      log.info(
        `  GET    http://127.0.0.1:${port}/mcp   SSE 连接 (服务端推送 notifications/tools/list_changed)`
      );
      log.info(`  DELETE http://127.0.0.1:${port}/mcp   终止会话 (Mcp-Session-Id header)`);
      log.info('');
      log.info('  ── 辅助端点 ──────────────────────────────────────────────────');
      log.info(`  GET    http://127.0.0.1:${port}/              服务信息`);
      log.info(`  GET    http://127.0.0.1:${port}/health        健康检查 (200=正常, 503=降级)`);
      log.info(`  GET    http://127.0.0.1:${port}/diagnostics   诊断信息 (服务/会话/连接池)`);
      log.info(`  GET    http://127.0.0.1:${port}/metrics       指标数据`);
      log.info('');
      log.info('  ── 请求头 ────────────────────────────────────────────────────');
      log.info('  Mcp-Session-Id          会话标识 (initialize 响应返回, 后续请求携带)');
      log.info('  X-MCP-Tags              标签过滤 (逗号分隔, 如: "tag1,tag2")');
      log.info('  X-MCP-Smart-Discovery   智能发现 (true/false, 覆盖服务端默认)');
      log.info('  X-Agent-Id              客户端标识');
      log.info('');
      log.info('  ── MCP 客户端配置 ───────────────────────────────────────────');
      log.info(`  Streamable HTTP:  URL = http://127.0.0.1:${port}/mcp`);
      log.info('  传输协议:         Content-Length 帧 或 NDJSON 均支持');
      log.info('  协议版本:         2024-11-05');
      log.info('╚══════════════════════════════════════════════════════════════╝');
      log.info('');
    } catch (error) {
      log.error(
        `Failed to start Server mode: ${error instanceof Error ? error.message : String(error)}`
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
        log.warn(
          `Failed to initialize connection pool for service ${service.name}: ${errorMessage}`
        );
        this.healthMonitor.recordInitFailure(service.name, errorMessage);
      }
    }
  }

  private async reloadConfig(newConfig: SystemConfig): Promise<void> {
    const oldConfig = this.config;
    this.config = newConfig;

    const oldServices = oldConfig.mcpServers;
    const newServices = newConfig.mcpServers;

    const oldServiceNames = new Set(Object.keys(oldServices));
    const newServiceNames = new Set(Object.keys(newServices));

    for (const serviceName of oldServiceNames) {
      if (!newServiceNames.has(serviceName)) {
        const pool = this.connectionPools.get(serviceName);
        if (pool) {
          await pool.closeAll();
          this.connectionPools.delete(serviceName);
          this.toolRouter.unregisterConnectionPool(serviceName);
          log.info(`Removed connection pool for deleted service: ${serviceName}`);
        }
      }
    }

    for (const [serviceName, newServiceDef] of Object.entries(newServices)) {
      const newService = { ...newServiceDef, name: serviceName };
      const oldServiceDef = oldServices[serviceName];
      if (!oldServiceDef) {
        if (newService.enabled) {
          try {
            const pool = new ConnectionPool(
              newService,
              newService.connectionPool || newConfig.connectionPool
            );
            this.toolRouter.registerConnectionPool(newService.name, pool);
            this.connectionPools.set(newService.name, pool);
            log.info(`Added connection pool for new service: ${newService.name}`);
          } catch (error) {
            log.warn(
              `Failed to create connection pool for new service ${newService.name}: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
      } else {
        const oldService = { ...oldServiceDef, name: serviceName };
        if (
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
              log.info(`Updated connection pool for service: ${newService.name}`);
            } catch (error) {
              log.warn(
                `Failed to update connection pool for service ${newService.name}: ${error instanceof Error ? error.message : String(error)}`
              );
            }
          }
        }
      }
    }

    await this.serviceRegistry.initialize();
    this.toolRouter.invalidateCache();

    // Clear health statuses for all services to allow rechecking after config change
    this.healthMonitor.clearAllHealthStatuses();

    log.info(`Reloaded ${Object.keys(newServices).length} service(s)`);
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

    log.info('Shutting down MCP Router...');
    this.running = false;

    try {
      // Stop accepting new connections
      await this.fastify.close();
      log.info('HTTP server closed');

      // Stop session cleanup
      this.sessionManager.stopAutoCleanup();

      // Stop health monitoring
      if (this.config.healthCheck.enabled) {
        this.healthMonitor.stopHeartbeat();
        log.info('Health monitoring stopped');
      }

      // Close all SSE connections
      for (const res of this.sseConnections.values()) {
        try {
          res.end();
        } catch {
          /* ignore */
        }
      }
      this.sseConnections.clear();

      // Close all sessions
      await this.sessionManager.closeAllSessions();
      log.info('All sessions closed');

      if (this.unwatchConfig) {
        this.unwatchConfig();
        this.unwatchConfig = null;
        log.info('Config file watcher stopped');
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

      log.info('MCP Router shutdown complete');
      this.options.onShutdownComplete?.();
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

  /**
   * Get the Fastify instance (for testing)
   */
  getFastify(): FastifyInstance {
    return this.fastify;
  }
}
