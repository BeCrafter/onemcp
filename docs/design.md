# Design Document: MCP Router System

## Overview

The MCP Router System is a Node.js-based routing service that aggregates multiple MCP (Model Context Protocol) servers into a unified interface. The system acts as a middleware layer between MCP clients and multiple backend MCP servers, providing service discovery, tool routing, connection pooling, and flexible configuration management.

### Key Design Goals

1. **Unified Interface**: Present a single MCP endpoint that aggregates tools from multiple backend services
2. **Flexible Deployment**: Support both CLI (stdio) and Server (network) modes
3. **Scalability**: Handle multiple concurrent clients without resource exhaustion
4. **Extensibility**: Allow custom configuration providers and storage adapters
5. **Developer Experience**: Provide both standalone CLI tool and importable NPM package
6. **Operational Visibility**: Include logging, health monitoring, and diagnostics

### Technology Stack

- **Runtime**: Node.js v18+
- **Language**: TypeScript for type safety and better developer experience
- **MCP SDK**: [@modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk) for MCP protocol implementation
- **TUI Library**: [ink](https://github.com/vadimdemedes/ink) for React-based terminal interfaces
- **Process Management**: Node.js child_process for spawning MCP server processes
- **Configuration**: JSON-based configuration files with pluggable storage

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        MCP Clients                          │
│              (Claude Desktop, Custom Apps, etc.)            │
└────────────────┬────────────────────────────────────────────┘
                 │
                 │ JSON-RPC 2.0 over stdio/network
                 │
┌────────────────▼────────────────────────────────────────────┐
│                     MCP Router System                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Protocol Handler Layer                   │  │
│  │  (CLI Mode: stdio | Server Mode: network socket)     │  │
│  └────────────────────┬─────────────────────────────────┘  │
│                       │                                     │
│  ┌────────────────────▼─────────────────────────────────┐  │
│  │              Router Core                             │  │
│  │  • Service Registry                                  │  │
│  │  • Tool Discovery & Caching                          │  │
│  │  • Request Routing                                   │  │
│  │  • Tag-based Filtering                               │  │
│  └────────────────────┬─────────────────────────────────┘  │
│                       │                                     │
│  ┌────────────────────▼─────────────────────────────────┐  │
│  │           Connection Pool Manager                    │  │
│  │  • Per-service connection pools                      │  │
│  │  • Connection lifecycle management                   │  │
│  │  • Health checking                                   │  │
│  └────────────────────┬─────────────────────────────────┘  │
│                       │                                     │
└───────────────────────┼─────────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        │               │               │
┌───────▼──────┐ ┌──────▼─────┐ ┌──────▼─────┐
│ MCP Server 1 │ │ MCP Server 2│ │ MCP Server N│
│  (filesystem)│ │   (github)  │ │   (custom)  │
└──────────────┘ └─────────────┘ └─────────────┘
```

### Component Layers

1. **Protocol Handler Layer**: Manages communication with clients (stdio or network)
2. **Router Core**: Central routing logic, service registry, and tool management
3. **Connection Pool Manager**: Manages connections to backend MCP servers
4. **Configuration Layer**: Handles configuration loading, validation, and persistence
5. **TUI Layer**: Interactive terminal interface for configuration management

## Components and Interfaces

### 1. Protocol Handler

**Responsibility**: Handle MCP protocol communication with clients

**Interfaces**:

```typescript
interface IProtocolHandler {
  // Start the protocol handler
  start(): Promise<void>;
  
  // Stop the protocol handler
  stop(): Promise<void>;
  
  // Handle incoming JSON-RPC request
  handleRequest(request: JSONRPCRequest): Promise<JSONRPCResponse>;
  
  // Send notification to client
  sendNotification(notification: JSONRPCNotification): void;
}

// CLI Mode Handler (stdio)
class StdioProtocolHandler implements IProtocolHandler {
  constructor(private router: RouterCore);
}

// Server Mode Handler (network)
class ServerProtocolHandler implements IProtocolHandler {
  constructor(
    private router: RouterCore,
    private config: ServerConfig
  );
}
```

**Key Behaviors**:
- Parse JSON-RPC 2.0 messages from transport layer
- Validate message format and protocol version
- Route requests to Router Core
- Format and send responses back to clients
- Handle protocol-level errors

### 2. Router Core

**Responsibility**: Central routing logic and service management

**Interfaces**:

```typescript
interface ServiceDefinition {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  tags: string[];
  enabled: boolean;
  timeout?: number;
}

interface ToolDefinition {
  name: string;           // Original tool name
  namespacedName: string; // service_name_tool_name
  description: string;
  inputSchema: JSONSchema;
  serviceName: string;
}

class RouterCore {
  // Service management
  registerService(service: ServiceDefinition): Promise<void>;
  unregisterService(serviceName: string): Promise<void>;
  listServices(): ServiceDefinition[];
  getService(serviceName: string): ServiceDefinition | null;
  
  // Tool management
  listTools(tagFilter?: TagFilter): ToolDefinition[];
  enableTool(namespacedName: string): void;
  disableTool(namespacedName: string): void;
  isToolEnabled(namespacedName: string): boolean;
  
  // Tool invocation
  invokeTool(
    namespacedName: string,
    args: unknown
  ): Promise<ToolResult>;
  
  // Batch invocation
  invokeToolsBatch(
    calls: Array<{ namespacedName: string; args: unknown }>
  ): Promise<ToolResult[]>;
  
  // Health checking
  checkHealth(): Promise<HealthStatus>;
  checkServiceHealth(serviceName: string): Promise<ServiceHealthStatus>;
}
```

**Key Behaviors**:
- Maintain service registry with metadata
- Cache tool definitions from all services
- Parse namespaced tool names (service_name_tool_name)
- Route tool invocations to appropriate connection pool
- Apply tag filters when listing tools
- Enforce tool enable/disable state

### 3. Connection Pool Manager

**Responsibility**: Manage connections to backend MCP servers

**Interfaces**:

```typescript
interface ConnectionPoolConfig {
  maxConnections: number;
  idleTimeout: number;      // milliseconds
  connectionTimeout: number; // milliseconds
  healthCheckInterval: number; // milliseconds
}

interface MCPConnection {
  id: string;
  serviceName: string;
  client: Client; // from @modelcontextprotocol/sdk
  state: 'idle' | 'busy' | 'unhealthy';
  lastUsed: Date;
  process: ChildProcess;
}

class ConnectionPool {
  constructor(
    private service: ServiceDefinition,
    private config: ConnectionPoolConfig
  );
  
  // Acquire a connection from the pool
  acquire(): Promise<MCPConnection>;
  
  // Release a connection back to the pool
  release(connection: MCPConnection): void;
  
  // Close all connections
  close(): Promise<void>;
  
  // Health check
  healthCheck(): Promise<boolean>;
  
  // Get pool statistics
  getStats(): PoolStats;
}

class ConnectionPoolManager {
  // Get or create pool for a service
  getPool(serviceName: string): ConnectionPool;
  
  // Close pool for a service
  closePool(serviceName: string): Promise<void>;
  
  // Close all pools
  closeAll(): Promise<void>;
}
```

**Key Behaviors**:
- Create and manage per-service connection pools
- Spawn MCP server processes as child processes
- Establish MCP client connections using stdio transport
- Reuse idle connections when available
- Create new connections up to max limit
- Close idle connections after timeout
- Perform periodic health checks
- Handle connection failures and reconnection

### 4. Service Registry

**Responsibility**: Store and manage service configurations

**Interfaces**:

```typescript
interface IServiceRegistry {
  // Add or update service
  set(service: ServiceDefinition): Promise<void>;
  
  // Get service by name
  get(name: string): ServiceDefinition | null;
  
  // List all services
  list(): ServiceDefinition[];
  
  // Delete service
  delete(name: string): Promise<void>;
  
  // Find services by tag
  findByTag(tag: string): ServiceDefinition[];
  
  // Find services by multiple tags
  findByTags(tags: string[], mode: 'AND' | 'OR'): ServiceDefinition[];
}

class ServiceRegistry implements IServiceRegistry {
  constructor(private storage: IStorageAdapter);
}
```

### 5. Configuration Provider

**Responsibility**: Load and save configuration from various sources

**Interfaces**:

```typescript
interface RouterConfig {
  services: ServiceDefinition[];
  connectionPool: ConnectionPoolConfig;
  server?: ServerConfig;
  logging: LoggingConfig;
  toolStates: Record<string, boolean>; // namespacedName -> enabled
}

interface IConfigProvider {
  // Load configuration
  load(): Promise<RouterConfig>;
  
  // Save configuration
  save(config: RouterConfig): Promise<void>;
  
  // Validate configuration
  validate(config: RouterConfig): ValidationResult;
  
  // Watch for configuration changes
  watch(callback: (config: RouterConfig) => void): void;
}

// Default file-based provider
class FileConfigProvider implements IConfigProvider {
  constructor(private filePath: string);
}

// Custom provider interface for extensions
abstract class CustomConfigProvider implements IConfigProvider {
  abstract load(): Promise<RouterConfig>;
  abstract save(config: RouterConfig): Promise<void>;
}
```

### 6. Storage Adapter

**Responsibility**: Persist configuration data to various backends

**Interfaces**:

```typescript
interface IStorageAdapter {
  // Read data
  read<T>(key: string): Promise<T | null>;
  
  // Write data
  write<T>(key: string, value: T): Promise<void>;
  
  // Update data
  update<T>(key: string, updater: (current: T | null) => T): Promise<void>;
  
  // Delete data
  delete(key: string): Promise<void>;
  
  // List all keys
  keys(): Promise<string[]>;
}

// Built-in implementations
class JSONFileStorage implements IStorageAdapter {
  constructor(private basePath: string);
}

class InMemoryStorage implements IStorageAdapter {
  private data: Map<string, unknown>;
}
```

### 7. TUI Manager

**Responsibility**: Provide interactive terminal interface for configuration

**Interfaces**:

```typescript
interface ITUIManager {
  // Launch TUI
  launch(): Promise<void>;
  
  // Show service list
  showServiceList(): void;
  
  // Show add service form
  showAddServiceForm(): Promise<ServiceDefinition | null>;
  
  // Show edit service form
  showEditServiceForm(serviceName: string): Promise<ServiceDefinition | null>;
  
  // Show service test results
  showServiceTest(serviceName: string): Promise<void>;
}

class TUIManager implements ITUIManager {
  constructor(
    private registry: IServiceRegistry,
    private router: RouterCore
  );
}
```

### 8. Router API (Programmatic Interface)

**Responsibility**: Expose programmatic API for library usage

**Interfaces**:

```typescript
interface RouterOptions {
  config?: RouterConfig;
  configProvider?: IConfigProvider;
  storageAdapter?: IStorageAdapter;
  mode: 'cli' | 'server';
  serverConfig?: ServerConfig;
}

class MCPRouter extends EventEmitter {
  constructor(options: RouterOptions);
  
  // Lifecycle
  async start(): Promise<void>;
  async stop(): Promise<void>;
  
  // Service management
  async registerService(service: ServiceDefinition): Promise<void>;
  async unregisterService(serviceName: string): Promise<void>;
  listServices(): ServiceDefinition[];
  
  // Tool management
  listTools(tagFilter?: TagFilter): ToolDefinition[];
  enableTool(namespacedName: string): void;
  disableTool(namespacedName: string): void;
  
  // Tool invocation
  async invokeTool(namespacedName: string, args: unknown): Promise<ToolResult>;
  async invokeToolsBatch(calls: ToolCall[]): Promise<ToolResult[]>;
  
  // Health
  async checkHealth(): Promise<HealthStatus>;
  
  // Events
  on(event: 'service:connected', listener: (serviceName: string) => void): this;
  on(event: 'service:disconnected', listener: (serviceName: string) => void): this;
  on(event: 'tool:invoked', listener: (toolName: string, duration: number) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
}
```

## Data Models

### Service Definition

```typescript
interface ServiceDefinition {
  // Unique service identifier
  name: string;
  
  // Command to spawn the MCP server
  command: string;
  
  // Command arguments
  args: string[];
  
  // Environment variables
  env?: Record<string, string>;
  
  // Tags for categorization
  tags: string[];
  
  // Whether service is enabled
  enabled: boolean;
  
  // Tool invocation timeout (milliseconds)
  timeout?: number;
  
  // Connection pool configuration override
  poolConfig?: Partial<ConnectionPoolConfig>;
}
```

### Tool Definition

```typescript
interface ToolDefinition {
  // Original tool name from the service
  name: string;
  
  // Namespaced name: {serviceName}_{toolName}
  namespacedName: string;
  
  // Tool description
  description: string;
  
  // JSON Schema for tool input
  inputSchema: {
    type: 'object';
    properties: Record<string, JSONSchema>;
    required?: string[];
  };
  
  // Source service name
  serviceName: string;
  
  // Whether tool is enabled
  enabled: boolean;
}
```

### Tag Filter

```typescript
interface TagFilter {
  // Tags to filter by
  tags: string[];
  
  // Match mode: 'AND' requires all tags, 'OR' requires any tag
  mode: 'AND' | 'OR';
}
```

### Tool Result

```typescript
interface ToolResult {
  // Tool output content
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  
  // Whether the tool execution was successful
  isError: boolean;
}
```

### Health Status

```typescript
interface ServiceHealthStatus {
  serviceName: string;
  healthy: boolean;
  lastCheck: Date;
  error?: string;
}

interface HealthStatus {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  services: ServiceHealthStatus[];
  timestamp: Date;
}
```

### Configuration Models

```typescript
interface ConnectionPoolConfig {
  maxConnections: number;        // Default: 5
  idleTimeout: number;           // Default: 60000 (1 minute)
  connectionTimeout: number;     // Default: 10000 (10 seconds)
  healthCheckInterval: number;   // Default: 30000 (30 seconds)
}

interface ServerConfig {
  host: string;                  // Default: 'localhost'
  port: number;                  // Default: 3000
  enableHealthEndpoint: boolean; // Default: true
}

interface LoggingConfig {
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  output: 'console' | 'file' | 'custom';
  filePath?: string;
  includeTimestamp: boolean;
  includeCorrelationId: boolean;
}

interface RouterConfig {
  services: ServiceDefinition[];
  connectionPool: ConnectionPoolConfig;
  server?: ServerConfig;
  logging: LoggingConfig;
  toolStates: Record<string, boolean>;
  batchSizeLimit: number;        // Default: 10
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Service Registration Round Trip

*For any* valid service definition, registering it then retrieving it should return an equivalent service definition with all fields (name, command, args, env, tags, enabled state) preserved.

**Validates: Requirements 1.1, 1.4, 1.5**

### Property 2: Service Listing Completeness

*For any* set of registered services, listing all services should return exactly those services with no duplicates or omissions.

**Validates: Requirements 1.2**

### Property 3: Service Unregistration Cleanup

*For any* registered service, after unregistering it, the service should not appear in the service list and all its connections should be closed.

**Validates: Requirements 1.3**

### Property 4: Tool Discovery Completeness

*For any* set of registered services, querying all tools should return tools from all services with no omissions.

**Validates: Requirements 2.1, 2.3**

### Property 5: Tool Metadata Completeness

*For any* tool returned by the router, it should include all required fields: name, namespacedName, description, inputSchema, and serviceName.

**Validates: Requirements 2.2**

### Property 6: Disabled Tool Rejection

*For any* tool that is disabled, attempting to invoke it should return an error without forwarding the request to the backend service.

**Validates: Requirements 3.1, 9.5**

### Property 7: Tool State Persistence Round Trip

*For any* set of tool enable/disable states, after saving the configuration and restarting the router, the tool states should be preserved exactly.

**Validates: Requirements 3.4, 11.5**

### Property 8: Tool Status Query Accuracy

*For any* tool, querying its status should return the current enabled/disabled state that was last set.

**Validates: Requirements 3.3**

### Property 9: Tool Name Namespacing Format

*For any* service and tool combination, the exposed tool name should follow the format "{serviceName}_{toolName}" where serviceName is sanitized to remove special characters.

**Validates: Requirements 4.1, 4.4**

### Property 10: Namespaced Name Parsing

*For any* valid namespaced tool name, parsing it should correctly identify the service name and tool name components.

**Validates: Requirements 4.2**

### Property 11: Tool Name Conflict Resolution

*For any* two services with tools of the same name, both tools should be accessible with different namespaced names.

**Validates: Requirements 4.3**

### Property 12: Connection Pool Reuse

*For any* service, acquiring and releasing connections multiple times should reuse existing idle connections rather than creating new ones each time (up to the pool limit).

**Validates: Requirements 6.1**

### Property 13: Connection Pool Limit Enforcement

*For any* service with a maximum connection limit, attempting to acquire more connections than the limit should either wait for available connections or fail gracefully without exceeding the limit.

**Validates: Requirements 6.5**

### Property 14: Connection Failure Recovery

*For any* connection that fails, the connection pool should remove it and subsequent connection requests should create a new connection.

**Validates: Requirements 6.4**

### Property 15: JSON-RPC Error Format Compliance

*For any* error condition, the error response should be a valid JSON-RPC 2.0 error response with proper error code and message fields.

**Validates: Requirements 7.3, 10.3, 12.4, 12.5**

### Property 16: Service Unavailability Error

*For any* tool invocation targeting an unavailable service, the router should return an error indicating the service is not reachable without hanging indefinitely.

**Validates: Requirements 9.4**

### Property 17: Backend Error Forwarding

*For any* backend service error, the router should forward the error to the client with additional context identifying the source service.

**Validates: Requirements 10.1, 10.4**

### Property 18: Timeout Error Handling

*For any* tool invocation that exceeds the configured timeout, the router should return a timeout error to the client.

**Validates: Requirements 10.2**

### Property 19: Error Logging Completeness

*For any* error that occurs, the router should create a log entry with sufficient detail including error message, stack trace, and context.

**Validates: Requirements 10.5**

### Property 20: Configuration Loading Round Trip

*For any* valid configuration file, loading it should produce a configuration object that, when saved, produces an equivalent configuration file.

**Validates: Requirements 11.1**

### Property 21: Invalid Configuration Rejection

*For any* invalid configuration (missing required fields, invalid values, etc.), attempting to load it should fail with a descriptive error message.

**Validates: Requirements 11.2, 11.8**

### Property 22: Configuration Parameter Application

*For any* configuration parameter (connection pool settings, server settings, timeouts), setting it in the configuration should result in the router using that value.

**Validates: Requirements 11.3, 11.4, 11.6**

### Property 23: Configuration Hot Reload

*For any* valid configuration change, updating the configuration file should cause the router to reload and apply the changes without requiring a restart.

**Validates: Requirements 11.7**

### Property 24: Configuration Reload Fallback

*For any* invalid configuration during hot reload, the router should continue using the previous valid configuration and log an error.

**Validates: Requirements 11.9**

### Property 25: Tools List Response Format

*For any* tools/list request, the response should include all enabled tools with their complete schemas in the format specified by the MCP protocol.

**Validates: Requirements 12.2**

### Property 26: Tag Assignment and Retrieval

*For any* service registered with specific tags, retrieving the service should return those exact tags.

**Validates: Requirements 13.1, 13.2**

### Property 27: Tag-Based Service Filtering

*For any* tag query, the returned services should be exactly those services that have the specified tag(s) according to the AND/OR logic.

**Validates: Requirements 13.3, 13.5**

### Property 28: Tag Support Universality

*For any* string used as a tag (including common tags like "frontend", "backend" and custom tags), the router should accept and store it without restriction.

**Validates: Requirements 13.4**

### Property 29: Tag-Based Tool Filtering

*For any* tag filter applied, listing tools should return only tools from services matching the filter, and without a filter should return all enabled tools.

**Validates: Requirements 14.1, 14.2, 14.3**

### Property 30: Tag Filter Logic Correctness

*For any* multi-tag filter with AND logic, returned services should have all specified tags; with OR logic, returned services should have at least one specified tag.

**Validates: Requirements 14.4**

### Property 31: Tag Filter Resource Optimization

*For any* tag filter applied during initialization, the router should not create connections to services that don't match the filter.

**Validates: Requirements 14.5**

### Property 32: Configuration Validation and Persistence

*For any* configuration saved through the TUI or API, it should be validated before saving, and invalid configurations should be rejected with clear error messages.

**Validates: Requirements 15.6, 15.8**

### Property 33: Programmatic Configuration

*For any* valid configuration object provided programmatically, the router should accept it and behave identically to file-based configuration.

**Validates: Requirements 16.4**

### Property 34: Event Emission

*For any* significant event (service connection, disconnection, tool invocation, error), the router should emit the corresponding event to registered listeners.

**Validates: Requirements 16.5**

### Property 35: Custom Config Provider Substitution

*For any* custom config provider registered, the router should use it for all configuration operations instead of the default file-based provider.

**Validates: Requirements 17.2**

### Property 36: Config Provider Reload Trigger

*For any* configuration change detected by a custom config provider, the router should automatically reload affected services.

**Validates: Requirements 17.6**

### Property 37: Custom Storage Adapter Substitution

*For any* custom storage adapter provided, the router should use it for all persistence operations.

**Validates: Requirements 18.3**

### Property 38: Storage Adapter Atomicity

*For any* concurrent storage operations, the storage adapter should ensure no configuration corruption occurs.

**Validates: Requirements 18.4**

### Property 39: Storage Failure Error Handling

*For any* storage operation failure, the adapter should return a descriptive error without corrupting existing configuration.

**Validates: Requirements 18.6**

### Property 40: Service Lifecycle Logging

*For any* service lifecycle event (registration, connection, disconnection, error), a log entry should be created with the event type and service name.

**Validates: Requirements 19.1**

### Property 41: Tool Invocation Logging

*For any* tool invocation, a log entry should be created containing client identifier, tool name, timestamp, and execution duration.

**Validates: Requirements 19.2**

### Property 42: Log Level Filtering

*For any* log level configuration, only log entries at or above that level should be output.

**Validates: Requirements 19.3**

### Property 43: Log Output Routing

*For any* configured log output (console, file, custom), log entries should be written to that output.

**Validates: Requirements 19.4**

### Property 44: Correlation ID Presence

*For any* request that spans multiple services, all log entries related to that request should include the same correlation ID.

**Validates: Requirements 19.5**

### Property 45: Service Health Check Completeness

*For any* health check request, the router should attempt to ping all registered services and report their individual health statuses.

**Validates: Requirements 20.2**

### Property 46: Unhealthy Service Marking

*For any* service that fails health checks repeatedly (configurable threshold), the router should mark it as unhealthy and log a warning.

**Validates: Requirements 20.3**

### Property 47: Batch Request Processing

*For any* batch request containing multiple tool calls, the router should execute all calls and return all results in a single response.

**Validates: Requirements 21.1, 21.2**

### Property 48: Batch Partial Failure Handling

*For any* batch request where some tool calls fail, the router should continue executing other calls and include both successes and failures in the response.

**Validates: Requirements 21.4**

### Property 49: Batch Size Limit Enforcement

*For any* batch request, if it exceeds the configured size limit, the router should reject it with an error without executing any tool calls.

**Validates: Requirements 21.5, 21.6**

## Error Handling

### Error Categories

1. **Configuration Errors**: Invalid configuration files, missing required fields, type mismatches
2. **Connection Errors**: Backend service unavailable, connection timeout, connection refused
3. **Protocol Errors**: Malformed JSON-RPC messages, unsupported protocol version, invalid method names
4. **Invocation Errors**: Tool not found, tool disabled, invalid arguments, execution timeout
5. **Resource Errors**: Connection pool exhausted, batch size limit exceeded, memory limits

### Error Handling Strategy

**Configuration Errors**:
- Validate configuration at load time
- Fail fast with descriptive error messages
- During hot reload, fall back to previous valid configuration
- Log all configuration errors with file path and line number if applicable

**Connection Errors**:
- Implement exponential backoff for reconnection attempts
- Mark services as unhealthy after repeated failures
- Return descriptive errors to clients indicating service unavailability
- Log connection errors with service name and error details

**Protocol Errors**:
- Validate all incoming JSON-RPC messages
- Return standard JSON-RPC error responses with appropriate error codes
- Log protocol errors with message content (sanitized for sensitive data)

**Invocation Errors**:
- Validate tool names and arguments before forwarding
- Enforce timeout limits with configurable values
- Return errors with context about which service/tool failed
- Log invocation errors with correlation IDs

**Resource Errors**:
- Enforce connection pool limits to prevent exhaustion
- Queue requests when pool is at capacity (with timeout)
- Enforce batch size limits to prevent DoS
- Return clear error messages indicating resource constraints

### Error Response Format

All errors follow JSON-RPC 2.0 error response format:

```json
{
  "jsonrpc": "2.0",
  "id": "request-id",
  "error": {
    "code": -32000,
    "message": "Service unavailable",
    "data": {
      "serviceName": "filesystem",
      "details": "Connection timeout after 10000ms",
      "correlationId": "abc-123"
    }
  }
}
```

### Error Codes

- `-32700`: Parse error (invalid JSON)
- `-32600`: Invalid request (malformed JSON-RPC)
- `-32601`: Method not found
- `-32602`: Invalid params
- `-32603`: Internal error
- `-32000`: Service unavailable
- `-32001`: Tool not found
- `-32002`: Tool disabled
- `-32003`: Tool execution timeout
- `-32004`: Connection pool exhausted
- `-32005`: Batch size limit exceeded

## Testing Strategy

### Dual Testing Approach

The MCP Router System requires both unit testing and property-based testing for comprehensive coverage:

**Unit Tests**: Focus on specific examples, edge cases, and integration points
- Specific configuration file formats
- Specific error conditions (empty service name, invalid port number)
- Integration between components (protocol handler → router core → connection pool)
- Edge cases (empty tool list, service with no tags, zero timeout)

**Property-Based Tests**: Verify universal properties across all inputs
- Use [fast-check](https://github.com/dubzzz/fast-check) for TypeScript property-based testing
- Each property test should run minimum 100 iterations
- Generate random service definitions, tool names, configurations, etc.
- Verify properties hold for all generated inputs

### Property-Based Testing Configuration

**Library**: fast-check (TypeScript property-based testing library)

**Test Structure**:
```typescript
import fc from 'fast-check';

// Feature: mcp-router-system, Property 1: Service Registration Round Trip
test('Property 1: Service registration round trip', () => {
  fc.assert(
    fc.property(
      serviceDefinitionArbitrary(),
      async (service) => {
        const router = new RouterCore(storage);
        await router.registerService(service);
        const retrieved = router.getService(service.name);
        expect(retrieved).toEqual(service);
      }
    ),
    { numRuns: 100 }
  );
});
```

**Generators (Arbitraries)**:
- `serviceDefinitionArbitrary()`: Generate random service definitions
- `toolNameArbitrary()`: Generate random tool names
- `configArbitrary()`: Generate random configurations
- `tagFilterArbitrary()`: Generate random tag filters
- `batchRequestArbitrary()`: Generate random batch requests

### Unit Testing Focus Areas

1. **Configuration Loading**: Test specific config file formats (JSON, with/without optional fields)
2. **Protocol Handling**: Test specific MCP protocol messages (initialize, tools/list, tools/call)
3. **Connection Pool**: Test specific scenarios (acquire, release, timeout, failure)
4. **TUI**: Test TUI logic (validation, form handling) without UI rendering
5. **Error Handling**: Test specific error conditions and verify error messages
6. **Integration**: Test end-to-end flows with mock MCP servers

### Test Coverage Goals

- **Line Coverage**: Minimum 80%
- **Branch Coverage**: Minimum 75%
- **Property Coverage**: 100% of correctness properties implemented as tests
- **Integration Coverage**: All major user flows tested end-to-end

### Testing Tools

- **Test Framework**: Jest or Vitest
- **Property Testing**: fast-check
- **Mocking**: Built-in Jest/Vitest mocks
- **Coverage**: Istanbul (built into Jest/Vitest)
- **E2E Testing**: Custom test harness with mock MCP servers

### Continuous Testing

- Run unit tests on every commit
- Run property tests on every pull request
- Run integration tests before release
- Monitor test execution time and optimize slow tests
- Fail builds on test failures or coverage drops
