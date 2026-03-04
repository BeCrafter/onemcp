# Requirements Document

## Introduction

MCP Router System 是一个用 Node.js 开发的统一路由服务，用于管理和聚合多个 MCP (Model Context Protocol) 工具服务。该系统将多个独立的 MCP 服务收敛到一个统一的路由层，对外提供 CLI 和 Server 两种访问方式，支持多客户端并发访问，并通过命名空间机制避免工具名称冲突。

## Glossary

- **MCP_Router**: 核心路由服务，负责管理和转发 MCP 工具调用
- **MCP_Service**: 接入到路由系统的独立 MCP 工具服务
- **Tool**: MCP 服务提供的具体功能方法
- **Client**: 使用 MCP Router 服务的客户端应用
- **Service_Registry**: 服务注册表，存储已接入的 MCP 服务信息
- **Tool_Name**: 工具的完整名称，格式为"服务名称+工具名称"
- **Connection_Pool**: 连接池，管理与后端 MCP 服务的连接
- **CLI_Mode**: 命令行接口模式，通过标准输入输出与客户端通信
- **Server_Mode**: 服务器模式，通过网络协议与客户端通信
- **Service_Tag**: 服务标签，用于对 MCP 服务进行分类和分组
- **Tag_Filter**: 标签过滤器，用于根据标签筛选要加载的服务和工具
- **TUI**: Terminal User Interface，终端用户界面，提供交互式配置管理
- **Service_Config**: 服务配置，包含 MCP 服务的连接信息和元数据
- **Router_API**: 路由器编程接口，允许其他应用程序集成和使用路由功能
- **NPM_Package**: Node Package Manager 包，可独立使用或被其他项目引入
- **Config_Provider**: 配置提供者接口，支持从不同来源加载配置
- **Storage_Adapter**: 存储适配器，支持将配置持久化到不同的存储介质

## Requirements

### Requirement 1: Service Registration and Management

**User Story:** 作为系统管理员，我希望能够注册和管理多个 MCP 服务，以便统一管理所有工具服务。

#### Acceptance Criteria

1. WHEN a new MCP service is registered, THE MCP_Router SHALL store the service metadata including name, connection details, available tools, and associated tags
2. WHEN listing registered services, THE MCP_Router SHALL return all service names, their connection status, and their tags
3. WHEN a service is unregistered, THE MCP_Router SHALL remove it from the Service_Registry and close all associated connections
4. WHEN retrieving service details, THE MCP_Router SHALL return the service configuration, list of available tools, and assigned tags
5. WHEN registering a service, THE MCP_Router SHALL allow assignment of multiple tags to categorize the service

### Requirement 2: Tool Discovery and Enumeration

**User Story:** 作为开发者，我希望能够查看所有已注册服务中的可用工具，以便了解系统提供的功能。

#### Acceptance Criteria

1. WHEN querying available tools, THE MCP_Router SHALL return a list of all tools from all registered services
2. WHEN displaying tool information, THE MCP_Router SHALL include the tool name, description, input schema, and source service name
3. WHEN a service is registered, THE MCP_Router SHALL automatically discover and cache all tools provided by that service
4. WHEN a service's tool list changes, THE MCP_Router SHALL update the cached tool information

### Requirement 3: Tool Enable/Disable Control

**User Story:** 作为系统管理员，我希望能够启用或停用特定的工具，以便控制对外暴露的功能。

#### Acceptance Criteria

1. WHEN a tool is disabled, THE MCP_Router SHALL reject any invocation requests for that tool with a descriptive error
2. WHEN a tool is enabled, THE MCP_Router SHALL allow invocation requests to be forwarded to the backend service
3. WHEN querying tool status, THE MCP_Router SHALL return whether each tool is currently enabled or disabled
4. THE MCP_Router SHALL persist tool enable/disable state across service restarts

### Requirement 4: Tool Name Namespacing

**User Story:** 作为开发者，我希望工具名称包含服务名称前缀，以便避免不同服务间的工具名称冲突并快速定位工具来源。

#### Acceptance Criteria

1. WHEN exposing tools to clients, THE MCP_Router SHALL format tool names as "{service_name}_{tool_name}"
2. WHEN receiving a tool invocation request, THE MCP_Router SHALL parse the namespaced tool name to identify the target service and tool
3. WHEN two services provide tools with the same name, THE MCP_Router SHALL expose both tools with different namespaced names
4. WHEN a service name contains special characters, THE MCP_Router SHALL sanitize the name to ensure valid tool name format

### Requirement 5: Multi-Client Concurrent Access

**User Story:** 作为客户端应用，我希望能够与其他客户端并发访问 MCP Router，以便多个用户同时使用系统。

#### Acceptance Criteria

1. WHEN multiple clients connect simultaneously, THE MCP_Router SHALL handle each client connection independently
2. WHEN a client invokes a tool, THE MCP_Router SHALL not block other clients from invoking tools concurrently
3. WHEN backend service connections are limited, THE MCP_Router SHALL queue requests and process them without failing
4. WHEN a client disconnects, THE MCP_Router SHALL clean up resources without affecting other active clients

### Requirement 6: Connection Pool Management

**User Story:** 作为系统架构师，我希望系统使用连接池管理后端服务连接，以便提高性能和资源利用率。

#### Acceptance Criteria

1. WHEN initializing a service connection, THE Connection_Pool SHALL create and maintain reusable connections to the backend MCP service
2. WHEN a tool invocation is requested, THE Connection_Pool SHALL allocate an available connection or create a new one if within limits
3. WHEN a connection becomes idle, THE Connection_Pool SHALL keep it alive for reuse within a configured timeout period
4. WHEN a connection fails, THE Connection_Pool SHALL remove it and create a new connection for subsequent requests
5. THE Connection_Pool SHALL enforce maximum connection limits per service to prevent resource exhaustion

### Requirement 7: CLI Mode Support

**User Story:** 作为命令行用户，我希望通过标准输入输出与 MCP Router 交互，以便在终端环境中使用工具。

#### Acceptance Criteria

1. WHEN started in CLI mode, THE MCP_Router SHALL read JSON-RPC requests from standard input
2. WHEN processing a request in CLI mode, THE MCP_Router SHALL write JSON-RPC responses to standard output
3. WHEN an error occurs in CLI mode, THE MCP_Router SHALL return properly formatted JSON-RPC error responses
4. THE MCP_Router SHALL support the standard MCP protocol messages in CLI mode including initialize, tools/list, and tools/call

### Requirement 8: Server Mode Support

**User Story:** 作为网络客户端，我希望通过网络协议连接到 MCP Router，以便远程访问工具服务。

#### Acceptance Criteria

1. WHEN started in Server mode, THE MCP_Router SHALL listen on a configured network address and port
2. WHEN a client connects in Server mode, THE MCP_Router SHALL establish a persistent connection and handle JSON-RPC messages
3. WHEN multiple clients connect in Server mode, THE MCP_Router SHALL maintain separate session state for each client
4. THE MCP_Router SHALL support the standard MCP protocol messages in Server mode including initialize, tools/list, and tools/call
5. WHEN a client connection is closed, THE MCP_Router SHALL clean up the session without affecting other clients

### Requirement 9: Tool Invocation Routing

**User Story:** 作为客户端，我希望调用工具时请求能够正确路由到对应的后端服务，以便获得正确的执行结果。

#### Acceptance Criteria

1. WHEN a tool invocation request is received, THE MCP_Router SHALL parse the namespaced tool name to identify the target service
2. WHEN the target service is identified, THE MCP_Router SHALL forward the request to the appropriate backend MCP service
3. WHEN the backend service returns a response, THE MCP_Router SHALL forward the response to the requesting client
4. WHEN the target service is unavailable, THE MCP_Router SHALL return an error indicating the service is not reachable
5. WHEN a tool is disabled, THE MCP_Router SHALL return an error without forwarding the request to the backend service

### Requirement 10: Error Handling and Resilience

**User Story:** 作为系统运维人员，我希望系统能够优雅地处理错误情况，以便保持服务稳定性。

#### Acceptance Criteria

1. WHEN a backend service connection fails, THE MCP_Router SHALL return a descriptive error to the client and attempt to reconnect
2. WHEN a tool invocation times out, THE MCP_Router SHALL return a timeout error to the client
3. WHEN receiving malformed requests, THE MCP_Router SHALL return a JSON-RPC error response with appropriate error codes
4. WHEN a backend service returns an error, THE MCP_Router SHALL forward the error to the client with context about the source service
5. THE MCP_Router SHALL log all errors with sufficient detail for debugging and monitoring

### Requirement 11: Configuration Management

**User Story:** 作为系统管理员，我希望通过配置文件管理系统行为，以便灵活调整系统参数。

#### Acceptance Criteria

1. THE MCP_Router SHALL load configuration from a file at startup including service definitions, connection pool settings, and mode selection
2. WHEN configuration is invalid, THE MCP_Router SHALL fail to start with a clear error message indicating the configuration problem
3. THE MCP_Router SHALL support configuration of connection pool parameters including max connections, idle timeout, and connection timeout
4. THE MCP_Router SHALL support configuration of server mode parameters including listen address and port
5. THE MCP_Router SHALL support configuration of tool enable/disable state that persists across restarts
6. THE MCP_Router SHALL support configuration of timeout values for tool invocations including per-tool and global defaults
7. WHEN configuration file changes are detected, THE MCP_Router SHALL reload the configuration without requiring a restart
8. WHEN reloading configuration, THE MCP_Router SHALL validate the new configuration before applying changes
9. WHEN configuration reload fails, THE MCP_Router SHALL continue using the previous valid configuration and log an error

### Requirement 12: MCP Protocol Compliance

**User Story:** 作为 MCP 客户端开发者，我希望 MCP Router 完全遵循 MCP 协议规范，以便使用标准 MCP 客户端库连接。

#### Acceptance Criteria

1. THE MCP_Router SHALL implement the MCP protocol initialization handshake including protocol version negotiation
2. THE MCP_Router SHALL support the tools/list method returning all enabled tools with their schemas
3. THE MCP_Router SHALL support the tools/call method for invoking tools with arguments
4. THE MCP_Router SHALL use standard JSON-RPC 2.0 message format for all requests and responses
5. THE MCP_Router SHALL include proper error codes and messages as defined in the MCP specification

### Requirement 13: Service Tagging and Categorization

**User Story:** 作为系统管理员，我希望能够为 MCP 服务打标签，以便按场景对服务进行分类和管理。

#### Acceptance Criteria

1. WHEN registering a service, THE MCP_Router SHALL allow specifying one or more tags for the service
2. WHEN updating a service, THE MCP_Router SHALL allow modifying the service's tags
3. WHEN querying services by tag, THE MCP_Router SHALL return all services that have the specified tag
4. THE MCP_Router SHALL support common tags such as "frontend", "backend", "database", "api", and custom tags
5. WHEN a service has multiple tags, THE MCP_Router SHALL allow querying by any combination of tags

### Requirement 14: Tag-Based Tool Filtering

**User Story:** 作为客户端应用，我希望能够根据标签筛选要使用的工具，以便在特定场景下只加载相关的工具集。

#### Acceptance Criteria

1. WHEN initializing with tag filters, THE MCP_Router SHALL only load and expose tools from services matching the specified tags
2. WHEN listing tools with tag filters active, THE MCP_Router SHALL return only tools from services with matching tags
3. WHEN no tag filter is specified, THE MCP_Router SHALL load and expose all enabled tools from all services
4. WHEN multiple tags are specified in the filter, THE MCP_Router SHALL support both AND and OR logic for tag matching
5. WHEN a tag filter is applied, THE MCP_Router SHALL not initialize connections to services that don't match the filter to save resources

### Requirement 15: TUI Configuration Management

**User Story:** 作为系统管理员，我希望通过友好的 TUI 界面管理 MCP 服务配置，以便更便捷地添加、修改和删除服务。

#### Acceptance Criteria

1. WHEN the TUI is launched, THE MCP_Router SHALL display a menu with options to list, add, edit, delete, and test services
2. WHEN adding a new service through TUI, THE MCP_Router SHALL provide an interactive form to input service name, command, arguments, environment variables, and tags
3. WHEN editing a service through TUI, THE MCP_Router SHALL pre-fill the form with existing configuration and allow modifications
4. WHEN displaying the service list in TUI, THE MCP_Router SHALL show service name, status, tags, and enabled/disabled state in a table format
5. WHEN testing a service through TUI, THE MCP_Router SHALL attempt to connect and list tools, displaying the result to the user
6. WHEN saving configuration through TUI, THE MCP_Router SHALL validate the input and write to the configuration file in standard MCP service format
7. THE TUI SHALL support keyboard navigation including arrow keys, Enter for selection, and Esc for cancellation
8. WHEN configuration validation fails, THE TUI SHALL display clear error messages and allow the user to correct the input

### Requirement 16: NPM Package and Programmatic API

**User Story:** 作为应用开发者，我希望能够将 MCP Router 作为 NPM 包引入到我的项目中，以便通过编程方式集成路由功能并自定义配置管理。

#### Acceptance Criteria

1. THE MCP_Router SHALL be published as an NPM package with a clear and semantic version number
2. WHEN imported as a module, THE Router_API SHALL expose methods to initialize, configure, and control the router programmatically
3. THE Router_API SHALL provide methods to register services, list tools, invoke tools, and manage service lifecycle
4. WHEN used as a library, THE MCP_Router SHALL allow configuration through JavaScript/TypeScript objects in addition to configuration files
5. THE Router_API SHALL support event listeners for service connection status, tool invocations, and errors
6. THE NPM_Package SHALL include TypeScript type definitions for all public APIs
7. THE NPM_Package SHALL be usable both as a standalone CLI tool and as an importable library
8. WHEN integrated into other applications, THE Router_API SHALL not interfere with the host application's event loop or process lifecycle

### Requirement 17: Custom Configuration Provider

**User Story:** 作为应用开发者，我希望能够自定义配置的加载方式，以便从数据库、API 或其他来源加载 MCP 服务配置。

#### Acceptance Criteria

1. THE MCP_Router SHALL define a Config_Provider interface with methods to load, save, and validate service configurations
2. WHEN a custom Config_Provider is registered, THE MCP_Router SHALL use it instead of the default file-based configuration
3. THE default Config_Provider SHALL load configuration from JSON files in the file system
4. WHEN implementing a custom Config_Provider, developers SHALL be able to load configuration from databases, REST APIs, or other sources
5. THE Config_Provider interface SHALL support asynchronous operations for loading and saving configurations
6. WHEN configuration changes through a custom provider, THE MCP_Router SHALL reload affected services automatically

### Requirement 18: Pluggable Storage Adapters

**User Story:** 作为应用开发者，我希望能够指定配置的存储介质，以便将配置保存到文件系统、数据库或云存储。

#### Acceptance Criteria

1. THE MCP_Router SHALL define a Storage_Adapter interface with methods to read, write, update, and delete configuration data
2. THE MCP_Router SHALL provide built-in Storage_Adapter implementations for JSON files and in-memory storage
3. WHEN a custom Storage_Adapter is provided, THE MCP_Router SHALL use it for all configuration persistence operations
4. THE Storage_Adapter interface SHALL support atomic operations to prevent configuration corruption
5. WHEN implementing a custom Storage_Adapter, developers SHALL be able to persist configuration to databases, cloud storage, or other backends
6. WHEN storage operations fail, THE Storage_Adapter SHALL return descriptive errors without corrupting existing configuration

### Requirement 19: Logging and Diagnostics

**User Story:** 作为系统运维人员，我希望系统提供详细的日志记录，以便诊断问题和监控系统运行状态。

#### Acceptance Criteria

1. THE MCP_Router SHALL log all service lifecycle events including registration, connection, disconnection, and errors
2. THE MCP_Router SHALL log all tool invocations including client identifier, tool name, timestamp, and execution duration
3. THE MCP_Router SHALL support configurable log levels including DEBUG, INFO, WARN, and ERROR
4. WHEN logging is configured, THE MCP_Router SHALL write logs to the specified output including console, file, or custom logger
5. THE MCP_Router SHALL include correlation IDs in logs to trace requests across service boundaries

### Requirement 20: Basic Health Monitoring

**User Story:** 作为系统管理员，我希望能够检查系统和各个服务的健康状态，以便及时发现和处理问题。

#### Acceptance Criteria

1. THE MCP_Router SHALL provide a method to check the overall system health status
2. WHEN checking service health, THE MCP_Router SHALL attempt to ping each registered service and report its status
3. WHEN a service fails health checks repeatedly, THE MCP_Router SHALL mark it as unhealthy and log a warning
4. THE MCP_Router SHALL expose service health status through the Router_API for programmatic access
5. WHEN running in Server mode, THE MCP_Router SHALL optionally expose a health check endpoint

### Requirement 21: Batch Tool Invocation

**User Story:** 作为客户端应用，我希望能够一次调用多个工具，以便提高效率并减少网络往返次数。

#### Acceptance Criteria

1. THE MCP_Router SHALL support batch tool invocation requests containing multiple tool calls in a single request
2. WHEN processing a batch request, THE MCP_Router SHALL execute all tool calls and return all results in a single response
3. WHEN executing batch requests, THE MCP_Router SHALL execute tool calls concurrently when possible to improve performance
4. WHEN a tool call in a batch fails, THE MCP_Router SHALL continue executing other tool calls and include the error in the batch response
5. THE MCP_Router SHALL support configurable batch size limits to prevent resource exhaustion
6. WHEN a batch request exceeds the size limit, THE MCP_Router SHALL return an error without executing any tool calls
