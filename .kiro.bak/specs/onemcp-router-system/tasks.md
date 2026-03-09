# Implementation Plan: MCP Router System

## Overview

This implementation plan breaks down the MCP Router System into discrete coding tasks. The system is a Node.js-based middleware service that acts as an intelligent routing layer between MCP clients and multiple backend MCP servers. It provides service aggregation, tool namespacing, connection pooling, flexible deployment modes (CLI and Server), multi-protocol support (stdio, SSE, HTTP), multi-session isolation, health monitoring, and extensible architecture.

The implementation follows a bottom-up approach, starting with foundational components and building up to higher-level features. Each task builds on previous tasks, with checkpoints to ensure incremental validation.

## Tasks

- [x] 1. Project setup and core infrastructure
  - Initialize Node.js project with TypeScript configuration
  - Set up build tooling (tsup), linting (eslint), and formatting (prettier)
  - Configure test framework (vitest) and property-based testing (fast-check)
  - Create project directory structure (src/, tests/, docs/)
  - Set up package.json with all required dependencies
  - Create tsconfig.json with strict TypeScript settings
  - _Requirements: 26.1, 26.2_

- [x] 2. Implement core data models and types
  - [x] 2.1 Create TypeScript interfaces for all core data structures
    - Define ServiceDefinition, Tool, Connection, Session interfaces
    - Define JsonRpcMessage, JsonRpcError interfaces
    - Define RequestContext, HealthStatus, AuditLogEntry interfaces
    - Define configuration interfaces (SystemConfig, ConnectionPoolConfig, etc.)
    - _Requirements: 1.1, 2.2, 6.2, 12.1, 38.1_
  
  - [x] 2.2 Write property test for data model round-trip consistency
    - **Property 21: JSON-RPC message round-trip**
    - **Validates: Requirements 29.5**

- [ ] 3. Implement Transport Layer
  - [x] 3.1 Create Transport interface and base implementation
    - Define Transport interface with send(), receive(), close(), getType() methods
    - Implement error handling and connection state management
    - _Requirements: 7.4, 22.1_
  
  - [x] 3.2 Implement StdioTransport for stdio protocol
    - Create StdioTransport class using child process stdin/stdout
    - Implement message framing and parsing for stdio streams
    - Handle process lifecycle (spawn, monitor, terminate)
    - _Requirements: 1.5, 22.1, 22.2_
  
  - [x] 3.3 Implement HttpTransport for SSE and Streamable HTTP protocols
    - Create HttpTransport class with support for both SSE and HTTP modes
    - Implement SSE client using eventsource library
    - Implement HTTP streaming using node-fetch
    - Handle connection errors and reconnection logic
    - _Requirements: 1.6, 1.7, 22.6_
  
  - [x] 3.4 Write unit tests for Transport implementations
    - Test stdio transport with mock child processes
    - Test HTTP transport with mock servers
    - Test error handling and reconnection
    - _Requirements: 22.1, 22.6_

- [ ] 4. Implement Protocol Layer
  - [x] 4.1 Create JSON-RPC Parser
    - Implement parse() method to parse JSON-RPC 2.0 messages
    - Implement validate() method using ajv for schema validation
    - Handle malformed JSON and invalid message structures
    - _Requirements: 7.1, 29.1, 29.2_
  
  - [x] 4.2 Create JSON-RPC Serializer
    - Implement serialize() method for JSON-RPC messages
    - Implement prettyPrint() method for logging
    - Ensure compliance with JSON-RPC 2.0 specification
    - _Requirements: 7.2, 29.3, 29.4_
  
  - [x] 4.3 Write property tests for Protocol Layer
    - **Property 11: JSON-RPC request acceptance**
    - **Property 12: JSON-RPC response compliance**
    - **Property 21: JSON-RPC message round-trip**
    - **Validates: Requirements 7.1, 7.2, 29.5**
  
  - [x] 4.4 Write unit tests for error cases
    - Test parsing of malformed JSON
    - Test validation of invalid message structures
    - Test error response formatting
    - _Requirements: 7.3, 9.1, 29.2_

- [ ] 5. Checkpoint - Ensure transport and protocol layers work correctly
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Implement Storage Layer
  - [x] 6.1 Define StorageAdapter interface
    - Create interface with read(), write(), update(), delete(), listKeys() methods
    - Define error handling contract
    - _Requirements: 18.1_
  
  - [x] 6.2 Implement FileStorageAdapter
    - Create file-based storage using fs-extra
    - Implement atomic write operations to prevent corruption
    - Handle file system errors gracefully
    - _Requirements: 18.2, 18.4_
  
  - [x] 6.3 Implement MemoryStorageAdapter for testing
    - Create in-memory storage using Map
    - Implement all StorageAdapter methods
    - _Requirements: 18.5, 28.1_
  
  - [x] 6.4 Write property tests for StorageAdapter
    - **Property 2: Configuration persistence round-trip**
    - **Validates: Requirements 11.10, 18.4**
  
  - [x] 6.5 Write unit tests for storage implementations
    - Test file operations and error handling
    - Test atomic write operations
    - Test memory storage operations
    - _Requirements: 18.4, 18.6_


- [ ] 7. Implement Configuration Management
  - [x] 7.1 Define ConfigProvider interface
    - Create interface with load(), save(), validate(), watch() methods
    - Define SystemConfig structure
    - _Requirements: 17.1, 17.2_
  
  - [x] 7.2 Implement FileConfigProvider
    - Create file-based config provider using StorageAdapter
    - Implement configuration loading from ~/.onemcp directory
    - Support custom config directory via --config-dir parameter and ONEMCP_CONFIG_DIR env var
    - Implement configuration validation using JSON schema
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.13, 17.4, 17.5, 30.1-30.9_
  
  - [x] 7.3 Implement configuration hot-reload
    - Implement watch() method using fs.watch
    - Validate configuration before applying changes
    - Maintain previous valid configuration on validation failure
    - _Requirements: 11.12, 11.14, 17.6_
  
  - [x] 7.4 Implement configuration directory initialization
    - Create directory structure (config.json, services/, logs/, backups/)
    - Create README file explaining directory structure
    - Handle directory creation on first run
    - _Requirements: 11.5, 11.6, 11.17, 41.8_
  
  - [x] 7.5 Write property tests for configuration management
    - **Property 2: Configuration persistence round-trip**
    - **Property 14: Invalid configuration rejection**
    - **Property 22: Configuration validation error completeness**
    - **Validates: Requirements 11.10, 11.7, 30.9**
  
  - [x] 7.6 Write unit tests for configuration operations
    - Test configuration loading and saving
    - Test validation with invalid configurations
    - Test hot-reload functionality
    - Test directory initialization
    - _Requirements: 11.7, 11.12, 11.13, 11.14_

- [ ] 8. Implement Namespace Manager
  - [x] 8.1 Create NamespaceManager class
    - Implement generateNamespacedName() using "{serviceName}__{toolName}" format
    - Implement parseNamespacedName() to extract service and tool names
    - Implement sanitizeServiceName() to clean special characters
    - _Requirements: 4.1, 4.2, 4.4_
  
  - [x] 8.2 Write property tests for namespace operations
    - **Property 6: Namespace round-trip**
    - **Validates: Requirements 4.1, 4.2**
  
  - [x] 8.3 Write unit tests for edge cases
    - Test special characters in service names
    - Test double underscore in tool names
    - Test empty strings and boundary conditions
    - _Requirements: 4.4_

- [ ] 9. Implement Service Registry
  - [x] 9.1 Create ServiceRegistry class
    - Implement register() method to add/update services
    - Implement unregister() method to remove services
    - Implement get() method to retrieve service by name
    - Implement list() method to list all services
    - Implement findByTags() method with AND/OR logic
    - Use ConfigProvider for persistence
    - _Requirements: 1.1-1.12, 13.1-13.5_
  
  - [x] 9.2 Implement service validation
    - Validate transport protocol type (stdio, sse, http)
    - Validate required fields based on transport type
    - Validate URL format for SSE/HTTP transports
    - Validate command existence for stdio transport
    - _Requirements: 1.4, 1.8, 30.4-30.9_
  
  - [x] 9.3 Write property tests for service registry
    - **Property 1: Service registration round-trip**
    - **Property 15: Tag AND filtering logic**
    - **Validates: Requirements 1.11, 13.5**
  
  - [x] 9.4 Write unit tests for service operations
    - Test service registration and retrieval
    - Test duplicate name handling (update existing)
    - Test service unregistration
    - Test tag-based queries
    - _Requirements: 1.9, 1.10, 1.11, 1.12, 13.2-13.5_

- [x] 10. Checkpoint - Ensure configuration and service management work correctly
  - Ensure all tests pass, ask the user if questions arise.


- [ ] 11. Implement Connection Pool Manager
  - [x] 11.1 Create Connection and ConnectionPool classes
    - Define Connection interface with id, transport, state, timestamps
    - Implement ConnectionPool class with acquire() and release() methods
    - Implement connection state management (idle, busy, closed)
    - _Requirements: 6.1, 6.2_
  
  - [x] 11.2 Implement connection lifecycle management
    - Implement connection creation based on transport type
    - Implement idle timeout mechanism to close unused connections
    - Implement connection timeout for acquisition
    - Implement closeAll() method for cleanup
    - _Requirements: 6.2, 6.3, 6.6, 22.4_
  
  - [x] 11.3 Implement connection pool limits and queuing
    - Enforce maxConnections limit
    - Implement request queuing when pool is exhausted
    - Implement timeout for queued requests
    - Return CONNECTION_POOL_EXHAUSTED error on timeout
    - _Requirements: 6.3, 6.5, 33.1_
  
  - [x] 11.4 Implement connection health checking
    - Detect failed connections and remove from pool
    - Create new connections on demand when failures occur
    - _Requirements: 6.4_
  
  - [x] 11.5 Implement pool statistics
    - Implement getStats() method returning total, idle, busy, waiting counts
    - Track connection usage metrics
    - _Requirements: 34.2_
  
  - [x] 11.6 Write property tests for connection pool
    - **Property 9: Connection pool reuse**
    - **Property 10: Connection pool limit enforcement**
    - **Validates: Requirements 6.1, 6.5**
  
  - [x] 11.7 Write unit tests for connection pool operations
    - Test connection acquisition and release
    - Test idle timeout behavior
    - Test max connections enforcement
    - Test request queuing
    - _Requirements: 6.1-6.6_

- [ ] 12. Implement Health Monitor
  - [x] 12.1 Create HealthMonitor class
    - Implement checkHealth() method to test service connectivity
    - Implement getAllHealthStatus() method
    - Track consecutive failures and last check time
    - _Requirements: 20.1, 20.2, 20.4, 20.5_
  
  - [x] 12.2 Implement heartbeat mechanism
    - Implement startHeartbeat() and stopHeartbeat() methods
    - Execute periodic health checks at configured interval
    - Mark services as unhealthy after threshold failures
    - _Requirements: 20.3, 20.5_
  
  - [x] 12.3 Implement health status event system
    - Implement onHealthChange() event emitter
    - Emit events when service health status changes
    - _Requirements: 20.8_
  
  - [x] 12.4 Implement initial health check on service registration
    - Execute health check before enabling service tools
    - Only enable tools after successful health check
    - _Requirements: 20.9_
  
  - [x] 12.5 Write property tests for health monitoring
    - **Property 17: Health status auto tool management**
    - **Validates: Requirements 20.6, 20.7**
  
  - [x] 12.6 Write unit tests for health monitoring
    - Test health check execution
    - Test heartbeat mechanism
    - Test failure threshold detection
    - Test event emission
    - _Requirements: 20.1-20.9_

- [ ] 13. Implement Tool Router
  - [x] 13.1 Create ToolRouter class with tool discovery
    - Implement discoverTools() method to query all enabled services
    - Use NamespaceManager to generate namespaced tool names
    - Apply tag filters during discovery
    - Cache discovered tools for performance
    - _Requirements: 2.1, 2.2, 2.3, 14.1-14.5, 25.1_
  
  - [x] 13.2 Implement tool state management
    - Implement setToolState() to enable/disable tools
    - Implement getToolState() to query tool status
    - Persist tool states using ConfigProvider
    - Support tool state patterns in service configuration
    - _Requirements: 3.1-3.11_
  
  - [x] 13.3 Implement cache invalidation
    - Implement invalidateCache() method
    - Trigger cache invalidation on service registration/unregistration
    - Trigger cache invalidation on health status changes
    - _Requirements: 2.4_
  
  - [x] 13.4 Implement tool calling logic
    - Implement callTool() method with namespace parsing
    - Validate tool is enabled before calling
    - Validate parameters against tool schema
    - Route call to correct service via ConnectionPool
    - Maintain request context and correlation ID
    - _Requirements: 5.1, 5.2, 5.3, 5.4_
  
  - [x] 13.5 Write property tests for tool router
    - **Property 3: Tool discovery completeness**
    - **Property 4: Tool cache invalidation**
    - **Property 5: Disabled tool rejection**
    - **Property 7: Tool routing correctness**
    - **Property 8: Parameter schema validation**
    - **Validates: Requirements 2.1, 2.4, 3.1, 5.1, 5.2**
  
  - [x] 13.6 Write unit tests for tool operations
    - Test tool discovery with various service configurations
    - Test tool state management
    - Test cache invalidation scenarios
    - Test tool calling with valid and invalid parameters
    - _Requirements: 2.1-2.4, 3.1-3.11, 5.1-5.4_

- [x] 14. Checkpoint - Ensure core routing and health monitoring work correctly
  - Ensure all tests pass, ask the user if questions arise.


- [x] 15. Implement Session Manager (for Server mode)
  - [x] 15.1 Create Session and SessionManager classes
    - Define Session interface with id, agentId, context, timestamps
    - Implement createSession() method
    - Implement getSession() method
    - Implement closeSession() method with resource cleanup
    - _Requirements: 23.2, 23.7, 38.1, 38.2, 38.3_
  
  - [x] 15.2 Implement session isolation
    - Create independent request queues per session
    - Create independent context per session
    - Ensure error isolation between sessions
    - _Requirements: 23.7, 38.4, 38.5, 38.7_
  
  - [x] 15.3 Implement session lifecycle management
    - Implement listActiveSessions() method
    - Implement cleanupExpiredSessions() method
    - Track last activity time per session
    - _Requirements: 38.10_
  
  - [x] 15.4 Implement per-session resource limits
    - Support configurable resource limits per session
    - Enforce limits during request processing
    - _Requirements: 38.8_
  
  - [x] 15.5 Write property tests for session isolation
    - **Property 19: Session complete isolation**
    - **Validates: Requirements 23.7, 38.4**
  
  - [x] 15.6 Write unit tests for session management
    - Test session creation and cleanup
    - Test concurrent sessions
    - Test session expiration
    - Test resource limit enforcement
    - _Requirements: 23.2, 23.7, 38.1-38.10_

- [x] 16. Implement Error Handling System
  - [x] 16.1 Define error codes and error response format
    - Define ErrorCode enum with all error types
    - Create error response builder following JSON-RPC 2.0 format
    - Include correlation ID, request ID, session ID in error data
    - _Requirements: 9.1-9.5, 10.3, 10.4_
  
  - [x] 16.2 Implement error propagation
    - Forward backend errors to client with added context
    - Add service name and routing information to errors
    - Maintain error stack traces in debug mode
    - _Requirements: 10.1, 10.2_
  
  - [x] 16.3 Implement timeout handling
    - Implement configurable timeout for tool calls
    - Terminate requests exceeding timeout
    - Return TIMEOUT error with duration information
    - _Requirements: 10.2_
  
  - [x] 16.4 Implement error recovery mechanisms
    - Implement retry logic with exponential backoff
    - Implement automatic service restart on crash
    - Implement health-based error recovery
    - _Requirements: 32.1-32.5_
  
  - [x] 16.5 Write property tests for error handling
    - **Property 13: Error response format**
    - **Property 23: Service crash auto-recovery**
    - **Validates: Requirements 9.1, 32.1**
  
  - [x] 16.6 Write unit tests for error scenarios
    - Test all error types and codes
    - Test error propagation from backend
    - Test timeout handling
    - Test retry logic
    - _Requirements: 9.1-9.5, 10.1-10.4, 32.1-32.5_

- [x] 17. Implement Logging and Audit System
  - [x] 17.1 Set up logging infrastructure
    - Configure pino logger with multiple outputs (console, file)
    - Implement configurable log levels (DEBUG, INFO, WARN, ERROR)
    - Implement structured logging with JSON format
    - _Requirements: 19.1, 19.3, 19.4, 19.12_
  
  - [x] 17.2 Implement request logging
    - Log all service lifecycle events
    - Log all tool calls with timestamps and duration
    - Include correlation ID in all log entries
    - Include session ID and agent ID in Server mode
    - _Requirements: 19.1, 19.2, 19.5, 19.7_
  
  - [x] 17.3 Implement audit logging
    - Create AuditLogEntry structure
    - Log complete request lifecycle (received, routed, completed)
    - Log routing decisions and connection selection
    - Support configurable input/output logging
    - _Requirements: 19.8, 19.9, 19.10, 19.14, 39.1-39.3_
  
  - [x] 17.4 Implement data masking for sensitive information
    - Implement configurable masking patterns
    - Mask sensitive data in logs (passwords, tokens, keys)
    - _Requirements: 19.11, 24.2_
  
  - [x] 17.5 Implement log filtering and querying
    - Support filtering by session, agent, service, tool
    - Implement log export functionality
    - _Requirements: 19.13, 39.5, 39.6_
  
  - [x] 17.6 Write property tests for logging
    - **Property 16: Log contains correlation ID**
    - **Validates: Requirements 19.5**
  
  - [x] 17.7 Write unit tests for logging operations
    - Test log output at different levels
    - Test data masking
    - Test log filtering
    - Test audit log completeness
    - _Requirements: 19.1-19.14, 39.1-39.10_

- [x] 18. Implement Metrics Collection
  - [x] 18.1 Create MetricsCollector class
    - Track tool call counts and execution times
    - Track connection pool statistics
    - Track error rates and types
    - _Requirements: 34.1, 34.2, 34.3_
  
  - [x] 18.2 Implement metrics API
    - Provide API to query collected metrics
    - Support metrics aggregation by service, tool, session
    - _Requirements: 34.4, 38.9_
  
  - [x] 18.3 Implement metrics configuration
    - Support configurable collection interval
    - Support configurable retention period
    - _Requirements: 34.5_
  
  - [x] 18.4 Write unit tests for metrics collection
    - Test metric tracking accuracy
    - Test metrics aggregation
    - Test retention policy
    - _Requirements: 34.1-34.5_

- [x] 19. Checkpoint - Ensure error handling, logging, and metrics work correctly
  - Ensure all tests pass, ask the user if questions arise.


- [x] 20. Implement MCP Protocol Methods
  - [x] 20.1 Implement initialize method
    - Handle MCP protocol initialization handshake
    - Establish client connection
    - Apply tag filters from initialization parameters
    - _Requirements: 12.1, 14.5_
  
  - [x] 20.2 Implement tools/list method
    - Return all available tools with schemas
    - Apply tag filters if specified
    - Include tool enabled/disabled status
    - _Requirements: 12.2, 3.10_
  
  - [x] 20.3 Implement tools/call method
    - Execute tool calls via ToolRouter
    - Handle errors and return appropriate responses
    - _Requirements: 12.3_
  
  - [x] 20.4 Implement batch request handling
    - Accept batch requests with multiple tool calls
    - Execute all calls and collect results
    - Handle partial failures (continue on error)
    - Enforce batch size limits
    - _Requirements: 21.1-21.5_
  
  - [x] 20.5 Write property tests for protocol methods
    - **Property 18: Batch request partial failure isolation**
    - **Validates: Requirements 21.4**
  
  - [x] 20.6 Write unit tests for MCP protocol methods
    - Test initialize handshake
    - Test tools/list with various filters
    - Test tools/call with valid and invalid requests
    - Test batch request handling
    - _Requirements: 12.1-12.5, 21.1-21.5_

- [x] 21. Implement CLI Mode
  - [x] 21.1 Create CLI entry point
    - Implement command-line argument parsing
    - Support --config-dir, --log-level, --help, --version flags
    - Support --validate and --init flags
    - _Requirements: 8.1, 41.1-41.13_
  
  - [x] 21.2 Implement stdio transport for CLI mode
    - Connect to stdin/stdout for client communication
    - Use StdioTransport for client connection
    - Handle single client session
    - _Requirements: 8.1_
  
  - [x] 21.3 Implement CLI lifecycle
    - Initialize system from configuration
    - Start health monitoring
    - Process requests from stdin
    - Handle graceful shutdown on SIGINT/SIGTERM
    - _Requirements: 31.1-31.5_
  
  - [x] 21.4 Write integration tests for CLI mode
    - Test CLI startup and initialization
    - Test request processing via stdio
    - Test graceful shutdown
    - _Requirements: 8.1, 31.1-31.5_

- [x] 22. Implement Server Mode
  - [x] 22.1 Create HTTP server using Fastify
    - Set up Fastify server with HTTP streaming support
    - Listen on 0.0.0.0 with configurable port
    - Support Streamable HTTP protocol
    - _Requirements: 8.2, 8.4, 8.5_
  
  - [x] 22.2 Implement multi-client connection handling
    - Create new session for each client connection
    - Use SessionManager to isolate clients
    - Handle concurrent requests from multiple clients
    - _Requirements: 23.1, 23.2, 23.4_
  
  - [x] 22.3 Implement health check endpoint
    - Create /health endpoint returning system status
    - Include all service health statuses
    - _Requirements: 20.1, 20.2_
  
  - [x] 22.4 Implement diagnostics endpoint
    - Create /diagnostics endpoint for debugging
    - Return current system state (services, pools, sessions)
    - _Requirements: 35.4_
  
  - [x] 22.5 Implement metrics endpoint
    - Create /metrics endpoint for metrics query
    - Return collected metrics in structured format
    - _Requirements: 34.4_
  
  - [x] 22.6 Implement server lifecycle
    - Initialize system from configuration
    - Start health monitoring
    - Start HTTP server
    - Handle graceful shutdown
    - _Requirements: 8.2, 31.1-31.5_
  
  - [x] 22.7 Write integration tests for Server mode
    - Test server startup and initialization
    - Test multi-client connections
    - Test concurrent request handling
    - Test health and diagnostics endpoints
    - Test graceful shutdown
    - _Requirements: 8.2, 23.1-23.9_

- [x] 23. Checkpoint - Ensure CLI and Server modes work correctly
  - Ensure all tests pass, ask the user if questions arise.


- [x] 24. Implement TUI Configuration Interface
  - [x] 24.1 Set up TUI framework using Ink
    - Create TUI entry point separate from main CLI
    - Set up Ink components and rendering
    - _Requirements: 15.1_
  
  - [x] 24.2 Implement service list view
    - Display all registered services with status
    - Show service details (name, transport, tags, enabled status)
    - Support navigation and selection
    - _Requirements: 15.2_
  
  - [x] 24.3 Implement service add/edit forms
    - Create form mode for step-by-step service configuration
    - Implement fields: name, transport type, command/URL, args, env, tags
    - Show/hide fields based on transport type selection
    - Provide input validation and helpful error messages
    - _Requirements: 15.3, 15.4, 15.10, 15.26_
  
  - [x] 24.4 Implement JSON mode for service configuration
    - Create multi-line JSON editor
    - Implement real-time JSON validation
    - Support importing from file
    - Support bulk import of multiple services
    - _Requirements: 15.9, 15.11, 40.1, 40.5_
  
  - [x] 24.5 Implement mode switching between form and JSON
    - Provide quick toggle between form and JSON modes
    - Preserve data when switching modes
    - _Requirements: 15.12_
  
  - [x] 24.6 Implement configuration templates
    - Provide pre-configured templates for common services
    - Include templates for different transport types
    - Allow template selection and customization
    - _Requirements: 15.14_
  
  - [x] 24.7 Implement service deletion
    - Add delete functionality with confirmation
    - Clean up associated resources
    - _Requirements: 15.5_
  
  - [x] 24.8 Implement service testing
    - Add "Test Connection" functionality
    - Execute health check and display results
    - _Requirements: 15.7_
  
  - [x] 24.9 Implement configuration preview and export
    - Show complete configuration before saving
    - Export configuration to mcpServers format JSON
    - _Requirements: 15.13, 15.15, 40.2, 40.8_
  
  - [x] 24.10 Implement tool management interface
    - Display all tools from all services
    - Show tool status (enabled/disabled)
    - Support filtering by service
    - Support search by name/description
    - _Requirements: 15.18, 15.20, 15.22, 15.23_
  
  - [x] 24.11 Implement tool state management in TUI
    - Allow enabling/disabling individual tools
    - Support bulk enable/disable operations
    - Show warnings when disabling tools
    - Provide quick toggle functionality
    - _Requirements: 15.19, 15.21, 15.24, 15.25_
  
  - [x] 24.12 Integrate tool management with service configuration
    - Show tool list when editing service
    - Allow managing tool states within service view
    - Include tool states in configuration import/export
    - _Requirements: 15.27, 15.28, 15.29, 15.30_
  
  - [x] 24.13 Implement keyboard shortcuts and help
    - Add keyboard shortcuts for common operations
    - Provide context-sensitive help
    - _Requirements: 15.16, 15.17_
  
  - [x] 24.14 Write integration tests for TUI
    - Test service CRUD operations
    - Test form and JSON modes
    - Test tool management
    - Test configuration import/export
    - _Requirements: 15.1-15.30_

- [x] 25. Implement Configuration Import/Export
  - [x] 25.1 Implement configuration import functionality
    - Parse mcpServers format JSON
    - Validate imported configuration
    - Handle name conflicts (overwrite/skip/rename options)
    - Support partial import on validation errors
    - Import tool state definitions from configuration
    - _Requirements: 40.1, 40.3, 40.4, 40.7, 40.14_
  
  - [x] 25.2 Implement configuration export functionality
    - Export all or selected services to JSON
    - Support filtering by tags
    - Include tool states in export
    - Use mcpServers format
    - _Requirements: 40.2, 40.8, 40.15_
  
  - [x] 25.3 Implement configuration backup
    - Automatic periodic backups to backups/ directory
    - Include timestamp in backup filenames
    - Implement retention policy (count and time-based)
    - _Requirements: 40.9, 40.11, 40.12, 40.13_
  
  - [x] 25.4 Implement configuration restore
    - List available backups
    - Restore from selected backup
    - Validate backup before restoring
    - _Requirements: 40.10_
  
  - [x] 25.5 Implement tool state pattern matching
    - Support wildcard patterns in tool state definitions
    - Support regex patterns for tool names
    - Apply patterns during service registration
    - _Requirements: 3.6, 40.16_
  
  - [x] 25.6 Write unit tests for import/export
    - Test import with valid and invalid JSON
    - Test export with various filters
    - Test backup and restore
    - Test tool state pattern matching
    - _Requirements: 40.1-40.16_

- [x] 26. Implement Security Features
  - [x] 26.1 Implement input validation
    - Validate all input parameters for injection attacks
    - Sanitize inputs before processing
    - Reject or escape malicious patterns
    - _Requirements: 24.1_
  
  - [x] 26.2 Implement data masking
    - Implement configurable masking patterns
    - Mask sensitive data in logs and outputs
    - _Requirements: 24.2_
  
  - [x] 26.3 Implement resource limits
    - Enforce batch size limits
    - Enforce connection pool limits
    - Enforce concurrent request limits
    - Enforce memory limits
    - _Requirements: 24.3, 24.4, 33.1-33.5_
  
  - [x] 26.4 Write property tests for security
    - **Property 20: Input parameter validation**
    - **Validates: Requirements 24.1**
  
  - [x] 26.5 Write unit tests for security features
    - Test injection attack prevention
    - Test data masking
    - Test resource limit enforcement
    - _Requirements: 24.1-24.5, 33.1-33.5_

- [x] 27. Checkpoint - Ensure TUI, import/export, and security work correctly
  - Ensure all tests pass, ask the user if questions arise.


- [x] 28. Implement Programming API
  - [x] 28.1 Create public API exports
    - Export main Router class
    - Export ServiceRegistry, ToolRouter, ConfigProvider interfaces
    - Export all public types and interfaces
    - _Requirements: 16.1_
  
  - [x] 28.2 Implement programmatic service management
    - Expose register(), unregister(), list() methods
    - Expose tool enable/disable methods
    - _Requirements: 16.2, 16.3_
  
  - [x] 28.3 Implement programmatic configuration
    - Accept configuration objects programmatically
    - Support custom ConfigProvider and StorageAdapter injection
    - _Requirements: 16.4, 28.2_
  
  - [x] 28.4 Implement event system
    - Emit events for service lifecycle (connect, disconnect)
    - Emit events for tool calls
    - Emit events for errors
    - Emit events for health status changes
    - _Requirements: 16.5_
  
  - [x] 28.5 Implement start/stop methods
    - Provide start() method to initialize router
    - Provide stop() method for graceful shutdown
    - _Requirements: 16.6_
  
  - [x] 28.6 Write integration tests for programming API
    - Test programmatic service management
    - Test event emission
    - Test custom provider injection
    - Test start/stop lifecycle
    - _Requirements: 16.1-16.6_

- [x] 29. Implement Extensibility Features
  - [x] 29.1 Document ConfigProvider interface
    - Create interface documentation
    - Provide implementation example
    - _Requirements: 17.1, 17.2, 26.5_
  
  - [x] 29.2 Document StorageAdapter interface
    - Create interface documentation
    - Provide implementation example
    - _Requirements: 18.1, 18.2, 26.5_
  
  - [x] 29.3 Create example custom implementations
    - Create example database ConfigProvider
    - Create example cloud StorageAdapter
    - _Requirements: 17.3, 18.3, 26.5_
  
  - [x] 29.4 Write tests for custom provider integration
    - Test custom ConfigProvider registration
    - Test custom StorageAdapter registration
    - _Requirements: 17.3, 18.3_

- [x] 30. Implement Debug and Diagnostics Features
  - [x] 30.1 Implement debug logging
    - Log detailed JSON-RPC messages at DEBUG level
    - Log connection pool operations
    - Log state transitions
    - Include stack traces in debug mode
    - _Requirements: 35.1, 35.2, 35.3_
  
  - [x] 30.2 Implement runtime log level change
    - Allow changing log level without restart
    - Provide API for log level control
    - _Requirements: 35.5_
  
  - [x] 30.3 Enhance diagnostics endpoint
    - Include detailed system state
    - Include active requests and their status
    - Include connection pool details
    - _Requirements: 35.4_
  
  - [x] 30.4 Write unit tests for debug features
    - Test debug logging output
    - Test log level changes
    - Test diagnostics endpoint
    - _Requirements: 35.1-35.5_

- [x] 31. Implement MCP Inspector Compatibility
  - [x] 31.1 Verify CLI mode compatibility with MCP Inspector
    - Test connection via `npx @modelcontextprotocol/inspector`
    - Ensure all protocol messages are handled correctly
    - Verify tool discovery and invocation
    - _Requirements: 36.1, 36.3, 36.4, 36.5_
  
  - [x] 31.2 Verify Server mode compatibility with MCP Inspector
    - Test network connection via MCP Inspector
    - Ensure HTTP transport works correctly
    - _Requirements: 36.2, 36.3, 36.4, 36.5_
  
  - [x] 31.3 Create MCP Inspector documentation
    - Document how to use MCP Inspector with CLI mode
    - Document how to use MCP Inspector with Server mode
    - Provide troubleshooting guide
    - _Requirements: 36.6_
  
  - [x] 31.4 Write end-to-end tests with MCP Inspector
    - Test CLI mode with MCP Inspector
    - Test Server mode with MCP Inspector
    - _Requirements: 36.1-36.6_

- [x] 32. Implement Performance Optimizations
  - [x] 32.1 Implement tool cache with expiration
    - Add configurable cache expiration time
    - Implement cache warming on startup
    - _Requirements: 25.1, 25.3_
  
  - [x] 32.2 Optimize connection reuse
    - Prefer idle connections over creating new ones
    - Implement connection warmup for frequently used services
    - _Requirements: 25.2_
  
  - [x] 32.3 Implement async I/O throughout
    - Ensure all I/O operations are non-blocking
    - Use async/await consistently
    - _Requirements: 25.5_
  
  - [x] 32.4 Optimize tag filtering
    - Only connect to services matching tag filter
    - Skip connection creation for filtered services
    - _Requirements: 25.4_
  
  - [x] 32.5 Write performance tests
    - Test tool discovery performance
    - Test concurrent request throughput
    - Test connection pool efficiency
    - _Requirements: 25.1-25.5_

- [x] 33. Checkpoint - Ensure API, extensibility, and performance features work correctly
  - Ensure all tests pass, ask the user if questions arise.


- [x] 34. Create Comprehensive Documentation
  - [x] 34.1 Create README with getting started guide
    - Installation instructions
    - Quick start for CLI mode
    - Quick start for Server mode
    - Basic configuration examples
    - _Requirements: 26.1_
  
  - [x] 34.2 Create configuration reference documentation
    - Document all configuration options
    - Provide configuration file format examples
    - Document environment variables
    - Document command-line parameters
    - _Requirements: 26.2, 26.3_
  
  - [x] 34.3 Create API reference documentation
    - Document all public interfaces and methods
    - Provide code examples for programmatic usage
    - Document event system
    - _Requirements: 26.4_
  
  - [x] 34.4 Create extensibility guide
    - Document how to implement custom ConfigProvider
    - Document how to implement custom StorageAdapter
    - Provide complete examples
    - _Requirements: 26.5_
  
  - [x] 34.5 Create deployment guide
    - Document CLI mode deployment
    - Document Server mode deployment
    - Provide Docker examples
    - Provide systemd service examples
    - _Requirements: 26.3_
  
  - [x] 34.6 Create troubleshooting guide
    - Common issues and solutions
    - Debug mode usage
    - Log analysis tips
    - MCP Inspector usage
    - _Requirements: 26.1, 36.6_
  
  - [x] 34.7 Create migration guide for version upgrades
    - Document breaking changes
    - Provide migration scripts if needed
    - _Requirements: 27.3, 27.5_

- [x] 35. Implement Version Management
  - [x] 35.1 Add version information to responses
    - Include version in initialize response
    - Include version in health endpoint
    - _Requirements: 27.1_
  
  - [x] 35.2 Implement version compatibility checking
    - Support multiple MCP protocol versions
    - Validate client protocol version
    - _Requirements: 27.2_
  
  - [x] 35.3 Follow semantic versioning
    - Set up version in package.json
    - Document versioning policy
    - _Requirements: 27.4_
  
  - [x] 35.4 Write tests for version compatibility
    - Test version information in responses
    - Test protocol version negotiation
    - _Requirements: 27.1, 27.2_

- [x] 36. Write Comprehensive Property-Based Tests
  - [x] 36.1 Property 1: Service registration round-trip
    - Generate random valid service definitions
    - Verify register then retrieve returns equivalent definition
    - Run 100+ iterations
    - _Requirements: 1.11_
  
  - [x] 36.2 Property 2: Configuration persistence round-trip
    - Generate random system configurations
    - Verify save, restart, load returns equivalent configuration
    - Run 100+ iterations
    - _Requirements: 11.10, 3.4_
  
  - [x] 36.3 Property 3: Tool discovery completeness
    - Generate random service sets
    - Verify tool list contains exactly all enabled tools from enabled services
    - Run 100+ iterations
    - _Requirements: 2.1_
  
  - [x] 36.4 Property 4: Tool cache invalidation
    - Generate random service registration/unregistration sequences
    - Verify tool list always reflects current state
    - Run 100+ iterations
    - _Requirements: 2.4_
  
  - [x] 36.5 Property 5: Disabled tool rejection
    - Generate random tool calls to disabled tools
    - Verify all calls are rejected with appropriate error
    - Run 100+ iterations
    - _Requirements: 3.1_
  
  - [x] 36.6 Property 6: Namespace round-trip
    - Generate random service and tool names
    - Verify generate then parse returns original names
    - Run 100+ iterations
    - _Requirements: 4.1, 4.2_
  
  - [x] 36.7 Property 7: Tool routing correctness
    - Generate random namespaced tool calls
    - Verify calls are routed to correct service
    - Run 100+ iterations
    - _Requirements: 5.1_
  
  - [x] 36.8 Property 8: Parameter schema validation
    - Generate random invalid parameters
    - Verify all invalid parameters are rejected
    - Run 100+ iterations
    - _Requirements: 5.2_
  
  - [x] 36.9 Property 9: Connection pool reuse
    - Generate sequential requests to same service
    - Verify connections are reused when available
    - Run 100+ iterations
    - _Requirements: 6.1_
  
  - [x] 36.10 Property 10: Connection pool limit enforcement
    - Generate requests exceeding pool limits
    - Verify limits are enforced (queue or reject)
    - Run 100+ iterations
    - _Requirements: 6.5_
  
  - [x] 36.11 Property 11: JSON-RPC request acceptance
    - Generate random valid JSON-RPC 2.0 requests
    - Verify all are accepted and processed
    - Run 100+ iterations
    - _Requirements: 7.1_
  
  - [x] 36.12 Property 12: JSON-RPC response compliance
    - Generate random requests
    - Verify all responses comply with JSON-RPC 2.0
    - Run 100+ iterations
    - _Requirements: 7.2_
  
  - [x] 36.13 Property 13: Error response format
    - Generate requests causing various errors
    - Verify all error responses contain code, message, context
    - Run 100+ iterations
    - _Requirements: 9.1_
  
  - [x] 36.14 Property 14: Invalid configuration rejection
    - Generate random invalid configurations
    - Verify all are rejected with descriptive errors
    - Run 100+ iterations
    - _Requirements: 11.7_
  
  - [x] 36.15 Property 15: Tag AND filtering logic
    - Generate random tag sets and queries
    - Verify AND logic returns only services with all tags
    - Run 100+ iterations
    - _Requirements: 13.5_
  
  - [x] 36.16 Property 16: Log contains correlation ID
    - Generate random requests
    - Verify all log entries contain correlation ID
    - Run 100+ iterations
    - _Requirements: 19.5_
  
  - [x] 36.17 Property 17: Health status auto tool management
    - Generate health status transitions
    - Verify tools are auto-loaded/unloaded correctly
    - Run 100+ iterations
    - _Requirements: 20.6, 20.7_
  
  - [x] 36.18 Property 18: Batch request partial failure isolation
    - Generate batch requests with some failing calls
    - Verify failures don't prevent other calls from executing
    - Run 100+ iterations
    - _Requirements: 21.4_
  
  - [x] 36.19 Property 19: Session complete isolation
    - Generate concurrent requests from different sessions
    - Verify complete isolation of operations and state
    - Run 100+ iterations
    - _Requirements: 23.7, 38.4_
  
  - [x] 36.20 Property 20: Input parameter validation
    - Generate inputs with malicious patterns
    - Verify all are rejected or sanitized
    - Run 100+ iterations
    - _Requirements: 24.1_
  
  - [x] 36.21 Property 21: JSON-RPC message round-trip
    - Generate random valid JSON-RPC messages
    - Verify serialize then parse returns equivalent message
    - Run 100+ iterations
    - _Requirements: 29.5_
  
  - [x] 36.22 Property 22: Configuration validation error completeness
    - Generate configurations with multiple errors
    - Verify all errors are reported, not just first
    - Run 100+ iterations
    - _Requirements: 30.9_
  
  - [x] 36.23 Property 23: Service crash auto-recovery
    - Simulate service crashes
    - Verify next request triggers restart and succeeds
    - Run 100+ iterations
    - _Requirements: 32.1_

- [x] 37. Write Integration Tests
  - [x] 37.1 Test complete CLI mode workflow
    - Start router in CLI mode
    - Register services
    - Discover tools
    - Call tools
    - Verify results
    - _Requirements: 8.1, 12.1-12.3_
  
  - [x] 37.2 Test complete Server mode workflow
    - Start router in Server mode
    - Connect multiple clients
    - Execute concurrent requests
    - Verify session isolation
    - _Requirements: 8.2, 23.1-23.9_
  
  - [x] 37.3 Test multi-service scenario
    - Register multiple services with different transports
    - Verify tool discovery from all services
    - Call tools from different services
    - Verify correct routing
    - _Requirements: 1.1-1.12, 5.1_
  
  - [x] 37.4 Test health monitoring workflow
    - Register services
    - Simulate service failures
    - Verify auto-unload of tools
    - Simulate service recovery
    - Verify auto-reload of tools
    - _Requirements: 20.1-20.9_
  
  - [x] 37.5 Test configuration hot-reload
    - Start router with initial configuration
    - Modify configuration file
    - Verify automatic reload
    - Verify services reflect changes
    - _Requirements: 11.12, 11.14_
  
  - [x] 37.6 Test TUI workflow
    - Start TUI
    - Add service via form mode
    - Add service via JSON mode
    - Edit service
    - Test service connection
    - Manage tool states
    - Export configuration
    - _Requirements: 15.1-15.30_

- [x] 38. Final Integration and Testing
  - [x] 38.1 Run full test suite
    - Execute all unit tests
    - Execute all property-based tests
    - Execute all integration tests
    - Verify code coverage meets targets (80%+ overall)
  
  - [x] 38.2 Perform end-to-end testing
    - Test with real MCP servers (filesystem, github, etc.)
    - Test with MCP Inspector
    - Test both CLI and Server modes
    - Test all transport protocols (stdio, SSE, HTTP)
  
  - [x] 38.3 Performance testing
    - Test with high concurrent load
    - Measure latency and throughput
    - Verify resource usage is within limits
    - Test connection pool efficiency
  
  - [x] 38.4 Security testing
    - Test injection attack prevention
    - Test resource limit enforcement
    - Test data masking
    - Verify no sensitive data leaks in logs

- [x] 39. Final Checkpoint - Complete system verification
  - Ensure all tests pass, ask the user if questions arise.
  - Verify all 23 correctness properties are tested
  - Verify all requirements are covered
  - Verify documentation is complete

## Notes

- Tasks marked with `*` are optional testing tasks and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property-based tests validate universal correctness properties with 100+ iterations
- Unit tests validate specific examples and edge cases
- Integration tests validate complete workflows
- Checkpoints ensure incremental validation at major milestones
- The implementation uses TypeScript and Node.js as specified in the design document
- All 23 correctness properties from the design document are covered in property-based tests
- The system supports three transport protocols: stdio, SSE, and Streamable HTTP
- Both CLI mode (single client via stdio) and Server mode (multiple clients via HTTP) are implemented
- The TUI provides a user-friendly interface for configuration management
- Comprehensive logging, metrics, and audit capabilities are included
- Security features include input validation, data masking, and resource limits
- The system is designed for extensibility through custom ConfigProvider and StorageAdapter implementations

