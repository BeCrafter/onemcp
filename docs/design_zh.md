# 设计文档：MCP 路由系统

## 概述

MCP 路由系统是一个基于 Node.js 的路由服务，将多个 MCP（模型上下文协议）服务器聚合到统一的接口中。该系统作为 MCP 客户端和多个后端 MCP 服务器之间的中间件层，提供服务发现、工具路由、连接池管理和灵活的配置管理。

### 核心设计目标

1. **统一接口**：提供单一的 MCP 端点，聚合来自多个后端服务的工具
2. **灵活部署**：支持 CLI（标准输入输出）和 Server（网络）两种模式
3. **可扩展性**：处理多个并发客户端而不会耗尽资源
4. **可扩展性**：允许自定义配置提供者和存储适配器
5. **开发者体验**：提供独立的 CLI 工具和可导入的 NPM 包
6. **运维可见性**：包含日志记录、健康监控和诊断功能

### 技术栈

- **运行时**：Node.js v18+
- **语言**：TypeScript，提供类型安全和更好的开发体验
- **MCP SDK**：[@modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk) 用于 MCP 协议实现
- **TUI 库**：[ink](https://github.com/vadimdemedes/ink) 用于基于 React 的终端界面
- **进程管理**：Node.js child_process 用于启动 MCP 服务器进程
- **配置**：基于 JSON 的配置文件，支持可插拔存储

## 架构

### 高层架构

```
┌─────────────────────────────────────────────────────────────┐
│                        MCP 客户端                           │
│              (Claude Desktop, 自定义应用等)                 │
└────────────────┬────────────────────────────────────────────┘
                 │
                 │ JSON-RPC 2.0 over stdio/network
                 │
┌────────────────▼────────────────────────────────────────────┐
│                     MCP 路由系统                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              协议处理层                               │  │
│  │  (CLI 模式: stdio | Server 模式: 网络套接字)         │  │
│  └────────────────────┬─────────────────────────────────┘  │
│                       │                                     │
│  ┌────────────────────▼─────────────────────────────────┐  │
│  │              路由核心                                 │  │
│  │  • 服务注册表                                        │  │
│  │  • 工具发现与缓存                                    │  │
│  │  • 请求路由                                          │  │
│  │  • 基于标签的过滤                                    │  │
│  └────────────────────┬─────────────────────────────────┘  │
│                       │                                     │
│  ┌────────────────────▼─────────────────────────────────┐  │
│  │           连接池管理器                                │  │
│  │  • 每个服务的连接池                                  │  │
│  │  • 连接生命周期管理                                  │  │
│  │  • 健康检查                                          │  │
│  └────────────────────┬─────────────────────────────────┘  │
│                       │                                     │
└───────────────────────┼─────────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        │               │               │
┌───────▼──────┐ ┌──────▼─────┐ ┌──────▼─────┐
│ MCP 服务器 1 │ │ MCP 服务器 2│ │ MCP 服务器 N│
│  (filesystem)│ │   (github)  │ │   (custom)  │
└──────────────┘ └─────────────┘ └─────────────┘
```

### 组件层次

1. **协议处理层**：管理与客户端的通信（stdio 或网络）
2. **路由核心**：中央路由逻辑、服务注册表和工具管理
3. **连接池管理器**：管理与后端 MCP 服务器的连接
4. **配置层**：处理配置加载、验证和持久化
5. **TUI 层**：用于配置管理的交互式终端界面

## 组件和接口

### 1. 协议处理器

**职责**：处理与客户端的 MCP 协议通信

**接口**：

```typescript
interface IProtocolHandler {
  // 启动协议处理器
  start(): Promise<void>;
  
  // 停止协议处理器
  stop(): Promise<void>;
  
  // 处理传入的 JSON-RPC 请求
  handleRequest(request: JSONRPCRequest): Promise<JSONRPCResponse>;
  
  // 向客户端发送通知
  sendNotification(notification: JSONRPCNotification): void;
}

// CLI 模式处理器（stdio）
class StdioProtocolHandler implements IProtocolHandler {
  constructor(private router: RouterCore);
}

// Server 模式处理器（网络）
class ServerProtocolHandler implements IProtocolHandler {
  constructor(
    private router: RouterCore,
    private config: ServerConfig
  );
}
```

**关键行为**：
- 从传输层解析 JSON-RPC 2.0 消息
- 验证消息格式和协议版本
- 将请求路由到路由核心
- 格式化并将响应发送回客户端
- 处理协议级错误

### 2. 路由核心

**职责**：中央路由逻辑和服务管理

**接口**：

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
  name: string;           // 原始工具名称
  namespacedName: string; // service_name_tool_name
  description: string;
  inputSchema: JSONSchema;
  serviceName: string;
}

class RouterCore {
  // 服务管理
  registerService(service: ServiceDefinition): Promise<void>;
  unregisterService(serviceName: string): Promise<void>;
  listServices(): ServiceDefinition[];
  getService(serviceName: string): ServiceDefinition | null;
  
  // 工具管理
  listTools(tagFilter?: TagFilter): ToolDefinition[];
  enableTool(namespacedName: string): void;
  disableTool(namespacedName: string): void;
  isToolEnabled(namespacedName: string): boolean;
  
  // 工具调用
  invokeTool(
    namespacedName: string,
    args: unknown
  ): Promise<ToolResult>;
  
  // 批量调用
  invokeToolsBatch(
    calls: Array<{ namespacedName: string; args: unknown }>
  ): Promise<ToolResult[]>;
  
  // 健康检查
  checkHealth(): Promise<HealthStatus>;
  checkServiceHealth(serviceName: string): Promise<ServiceHealthStatus>;
}
```

**关键行为**：
- 维护带有元数据的服务注册表
- 缓存所有服务的工具定义
- 解析命名空间工具名称（service_name_tool_name）
- 将工具调用路由到适当的连接池
- 列出工具时应用标签过滤器
- 强制执行工具启用/禁用状态

### 3. 连接池管理器

**职责**：管理与后端 MCP 服务器的连接

**接口**：

```typescript
interface ConnectionPoolConfig {
  maxConnections: number;
  idleTimeout: number;      // 毫秒
  connectionTimeout: number; // 毫秒
  healthCheckInterval: number; // 毫秒
}

interface MCPConnection {
  id: string;
  serviceName: string;
  client: Client; // 来自 @modelcontextprotocol/sdk
  state: 'idle' | 'busy' | 'unhealthy';
  lastUsed: Date;
  process: ChildProcess;
}

class ConnectionPool {
  constructor(
    private service: ServiceDefinition,
    private config: ConnectionPoolConfig
  );
  
  // 从池中获取连接
  acquire(): Promise<MCPConnection>;
  
  // 将连接释放回池
  release(connection: MCPConnection): void;
  
  // 关闭所有连接
  close(): Promise<void>;
  
  // 健康检查
  healthCheck(): Promise<boolean>;
  
  // 获取池统计信息
  getStats(): PoolStats;
}

class ConnectionPoolManager {
  // 获取或创建服务的池
  getPool(serviceName: string): ConnectionPool;
  
  // 关闭服务的池
  closePool(serviceName: string): Promise<void>;
  
  // 关闭所有池
  closeAll(): Promise<void>;
}
```

**关键行为**：
- 创建和管理每个服务的连接池
- 将 MCP 服务器进程作为子进程启动
- 使用 stdio 传输建立 MCP 客户端连接
- 在可用时重用空闲连接
- 创建新连接直到达到最大限制
- 超时后关闭空闲连接
- 执行定期健康检查
- 处理连接失败和重新连接

### 4. 服务注册表

**职责**：存储和管理服务配置

**接口**：

```typescript
interface IServiceRegistry {
  // 添加或更新服务
  set(service: ServiceDefinition): Promise<void>;
  
  // 按名称获取服务
  get(name: string): ServiceDefinition | null;
  
  // 列出所有服务
  list(): ServiceDefinition[];
  
  // 删除服务
  delete(name: string): Promise<void>;
  
  // 按标签查找服务
  findByTag(tag: string): ServiceDefinition[];
  
  // 按多个标签查找服务
  findByTags(tags: string[], mode: 'AND' | 'OR'): ServiceDefinition[];
}

class ServiceRegistry implements IServiceRegistry {
  constructor(private storage: IStorageAdapter);
}
```

### 5. 配置提供者

**职责**：从各种来源加载和保存配置

**接口**：

```typescript
interface RouterConfig {
  services: ServiceDefinition[];
  connectionPool: ConnectionPoolConfig;
  server?: ServerConfig;
  logging: LoggingConfig;
  toolStates: Record<string, boolean>; // namespacedName -> enabled
}

interface IConfigProvider {
  // 加载配置
  load(): Promise<RouterConfig>;
  
  // 保存配置
  save(config: RouterConfig): Promise<void>;
  
  // 验证配置
  validate(config: RouterConfig): ValidationResult;
  
  // 监视配置更改
  watch(callback: (config: RouterConfig) => void): void;
}

// 默认的基于文件的提供者
class FileConfigProvider implements IConfigProvider {
  constructor(private filePath: string);
}

// 用于扩展的自定义提供者接口
abstract class CustomConfigProvider implements IConfigProvider {
  abstract load(): Promise<RouterConfig>;
  abstract save(config: RouterConfig): Promise<void>;
}
```

### 6. 存储适配器

**职责**：将配置数据持久化到各种后端

**接口**：

```typescript
interface IStorageAdapter {
  // 读取数据
  read<T>(key: string): Promise<T | null>;
  
  // 写入数据
  write<T>(key: string, value: T): Promise<void>;
  
  // 更新数据
  update<T>(key: string, updater: (current: T | null) => T): Promise<void>;
  
  // 删除数据
  delete(key: string): Promise<void>;
  
  // 列出所有键
  keys(): Promise<string[]>;
}

// 内置实现
class JSONFileStorage implements IStorageAdapter {
  constructor(private basePath: string);
}

class InMemoryStorage implements IStorageAdapter {
  private data: Map<string, unknown>;
}
```

### 7. TUI 管理器

**职责**：提供用于配置的交互式终端界面

**接口**：

```typescript
interface ITUIManager {
  // 启动 TUI
  launch(): Promise<void>;
  
  // 显示服务列表
  showServiceList(): void;
  
  // 显示添加服务表单
  showAddServiceForm(): Promise<ServiceDefinition | null>;
  
  // 显示编辑服务表单
  showEditServiceForm(serviceName: string): Promise<ServiceDefinition | null>;
  
  // 显示服务测试结果
  showServiceTest(serviceName: string): Promise<void>;
}

class TUIManager implements ITUIManager {
  constructor(
    private registry: IServiceRegistry,
    private router: RouterCore
  );
}
```

### 8. 路由器 API（编程接口）

**职责**：为库使用公开编程 API

**接口**：

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
  
  // 生命周期
  async start(): Promise<void>;
  async stop(): Promise<void>;
  
  // 服务管理
  async registerService(service: ServiceDefinition): Promise<void>;
  async unregisterService(serviceName: string): Promise<void>;
  listServices(): ServiceDefinition[];
  
  // 工具管理
  listTools(tagFilter?: TagFilter): ToolDefinition[];
  enableTool(namespacedName: string): void;
  disableTool(namespacedName: string): void;
  
  // 工具调用
  async invokeTool(namespacedName: string, args: unknown): Promise<ToolResult>;
  async invokeToolsBatch(calls: ToolCall[]): Promise<ToolResult[]>;
  
  // 健康检查
  async checkHealth(): Promise<HealthStatus>;
  
  // 事件
  on(event: 'service:connected', listener: (serviceName: string) => void): this;
  on(event: 'service:disconnected', listener: (serviceName: string) => void): this;
  on(event: 'tool:invoked', listener: (toolName: string, duration: number) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
}
```

## 数据模型

### 服务定义

```typescript
interface ServiceDefinition {
  // 唯一服务标识符
  name: string;
  
  // 启动 MCP 服务器的命令
  command: string;
  
  // 命令参数
  args: string[];
  
  // 环境变量
  env?: Record<string, string>;
  
  // 用于分类的标签
  tags: string[];
  
  // 服务是否启用
  enabled: boolean;
  
  // 工具调用超时（毫秒）
  timeout?: number;
  
  // 连接池配置覆盖
  poolConfig?: Partial<ConnectionPoolConfig>;
}
```

### 工具定义

```typescript
interface ToolDefinition {
  // 来自服务的原始工具名称
  name: string;
  
  // 命名空间名称：{serviceName}_{toolName}
  namespacedName: string;
  
  // 工具描述
  description: string;
  
  // 工具输入的 JSON Schema
  inputSchema: {
    type: 'object';
    properties: Record<string, JSONSchema>;
    required?: string[];
  };
  
  // 源服务名称
  serviceName: string;
  
  // 工具是否启用
  enabled: boolean;
}
```

### 标签过滤器

```typescript
interface TagFilter {
  // 要过滤的标签
  tags: string[];
  
  // 匹配模式：'AND' 需要所有标签，'OR' 需要任意标签
  mode: 'AND' | 'OR';
}
```

### 工具结果

```typescript
interface ToolResult {
  // 工具输出内容
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  
  // 工具执行是否成功
  isError: boolean;
}
```

### 健康状态

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

### 配置模型

```typescript
interface ConnectionPoolConfig {
  maxConnections: number;        // 默认：5
  idleTimeout: number;           // 默认：60000（1 分钟）
  connectionTimeout: number;     // 默认：10000（10 秒）
  healthCheckInterval: number;   // 默认：30000（30 秒）
}

interface ServerConfig {
  host: string;                  // 默认：'localhost'
  port: number;                  // 默认：3000
  enableHealthEndpoint: boolean; // 默认：true
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
  batchSizeLimit: number;        // 默认：10
}
```

## 正确性属性

*属性是在系统的所有有效执行中应该保持为真的特征或行为——本质上是关于系统应该做什么的正式陈述。属性充当人类可读规范和机器可验证正确性保证之间的桥梁。*

### 属性 1：服务注册往返一致性

*对于任何*有效的服务定义，注册后再检索应返回等效的服务定义，所有字段（名称、命令、参数、环境变量、标签、启用状态）都应保留。

**验证需求：1.1, 1.4, 1.5**

### 属性 2：服务列表完整性

*对于任何*已注册服务集合，列出所有服务应准确返回这些服务，没有重复或遗漏。

**验证需求：1.2**

### 属性 3：服务注销清理

*对于任何*已注册的服务，注销后，该服务不应出现在服务列表中，其所有连接应被关闭。

**验证需求：1.3**

### 属性 4：工具发现完整性

*对于任何*已注册服务集合，查询所有工具应返回所有服务的工具，没有遗漏。

**验证需求：2.1, 2.3**

### 属性 5：工具元数据完整性

*对于任何*路由器返回的工具，它应包含所有必需字段：name、namespacedName、description、inputSchema 和 serviceName。

**验证需求：2.2**

### 属性 6：禁用工具拒绝

*对于任何*被禁用的工具，尝试调用它应返回错误，而不将请求转发到后端服务。

**验证需求：3.1, 9.5**

### 属性 7：工具状态持久化往返

*对于任何*工具启用/禁用状态集合，保存配置并重启路由器后，工具状态应完全保留。

**验证需求：3.4, 11.5**

### 属性 8：工具状态查询准确性

*对于任何*工具，查询其状态应返回最后设置的当前启用/禁用状态。

**验证需求：3.3**

### 属性 9：工具名称命名空间格式

*对于任何*服务和工具组合，公开的工具名称应遵循格式"{serviceName}_{toolName}"，其中 serviceName 经过清理以删除特殊字符。

**验证需求：4.1, 4.4**

### 属性 10：命名空间名称解析

*对于任何*有效的命名空间工具名称，解析它应正确识别服务名称和工具名称组件。

**验证需求：4.2**

### 属性 11：工具名称冲突解决

*对于任何*两个具有相同名称工具的服务，两个工具都应可通过不同的命名空间名称访问。

**验证需求：4.3**

### 属性 12：连接池重用

*对于任何*服务，多次获取和释放连接应重用现有的空闲连接，而不是每次都创建新连接（直到达到池限制）。

**验证需求：6.1**

### 属性 13：连接池限制强制执行

*对于任何*具有最大连接限制的服务，尝试获取超过限制的连接应等待可用连接或优雅失败，而不超过限制。

**验证需求：6.5**

### 属性 14：连接失败恢复

*对于任何*失败的连接，连接池应将其删除，后续连接请求应创建新连接。

**验证需求：6.4**

### 属性 15：JSON-RPC 错误格式合规性

*对于任何*错误条件，错误响应应是有效的 JSON-RPC 2.0 错误响应，具有正确的错误代码和消息字段。

**验证需求：7.3, 10.3, 12.4, 12.5**

### 属性 16：服务不可用错误

*对于任何*针对不可用服务的工具调用，路由器应返回指示服务不可达的错误，而不会无限期挂起。

**验证需求：9.4**

### 属性 17：后端错误转发

*对于任何*后端服务错误，路由器应将错误转发给客户端，并附加标识源服务的上下文。

**验证需求：10.1, 10.4**

### 属性 18：超时错误处理

*对于任何*超过配置超时的工具调用，路由器应向客户端返回超时错误。

**验证需求：10.2**

### 属性 19：错误日志完整性

*对于任何*发生的错误，路由器应创建包含足够详细信息的日志条目，包括错误消息、堆栈跟踪和上下文。

**验证需求：10.5**

### 属性 20：配置加载往返

*对于任何*有效的配置文件，加载它应产生一个配置对象，保存时应产生等效的配置文件。

**验证需求：11.1**

### 属性 21：无效配置拒绝

*对于任何*无效配置（缺少必需字段、无效值等），尝试加载它应失败并显示描述性错误消息。

**验证需求：11.2, 11.8**

### 属性 22：配置参数应用

*对于任何*配置参数（连接池设置、服务器设置、超时），在配置中设置它应导致路由器使用该值。

**验证需求：11.3, 11.4, 11.6**

### 属性 23：配置热重载

*对于任何*有效的配置更改，更新配置文件应导致路由器重新加载并应用更改，而无需重启。

**验证需求：11.7**

### 属性 24：配置重载回退

*对于任何*热重载期间的无效配置，路由器应继续使用先前的有效配置并记录错误。

**验证需求：11.9**

### 属性 25：工具列表响应格式

*对于任何* tools/list 请求，响应应包含所有启用的工具及其完整的模式，格式符合 MCP 协议规范。

**验证需求：12.2**

### 属性 26：标签分配和检索

*对于任何*使用特定标签注册的服务，检索该服务应返回这些确切的标签。

**验证需求：13.1, 13.2**

### 属性 27：基于标签的服务过滤

*对于任何*标签查询，返回的服务应恰好是根据 AND/OR 逻辑具有指定标签的那些服务。

**验证需求：13.3, 13.5**

### 属性 28：标签支持通用性

*对于任何*用作标签的字符串（包括常见标签如"frontend"、"backend"和自定义标签），路由器应无限制地接受和存储它。

**验证需求：13.4**

### 属性 29：基于标签的工具过滤

*对于任何*应用的标签过滤器，列出工具应仅返回来自匹配过滤器的服务的工具，没有过滤器时应返回所有启用的工具。

**验证需求：14.1, 14.2, 14.3**

### 属性 30：标签过滤器逻辑正确性

*对于任何*使用 AND 逻辑的多标签过滤器，返回的服务应具有所有指定的标签；使用 OR 逻辑时，返回的服务应至少具有一个指定的标签。

**验证需求：14.4**

### 属性 31：标签过滤器资源优化

*对于任何*初始化期间应用的标签过滤器，路由器不应创建与不匹配过滤器的服务的连接。

**验证需求：14.5**

### 属性 32：配置验证和持久化

*对于任何*通过 TUI 或 API 保存的配置，应在保存前进行验证，无效配置应被拒绝并显示清晰的错误消息。

**验证需求：15.6, 15.8**

### 属性 33：编程配置

*对于任何*以编程方式提供的有效配置对象，路由器应接受它并表现得与基于文件的配置相同。

**验证需求：16.4**

### 属性 34：事件发射

*对于任何*重要事件（服务连接、断开连接、工具调用、错误），路由器应向注册的监听器发出相应的事件。

**验证需求：16.5**

### 属性 35：自定义配置提供者替换

*对于任何*注册的自定义配置提供者，路由器应将其用于所有配置操作，而不是默认的基于文件的提供者。

**验证需求：17.2**

### 属性 36：配置提供者重载触发

*对于任何*自定义配置提供者检测到的配置更改，路由器应自动重新加载受影响的服务。

**验证需求：17.6**

### 属性 37：自定义存储适配器替换

*对于任何*提供的自定义存储适配器，路由器应将其用于所有持久化操作。

**验证需求：18.3**

### 属性 38：存储适配器原子性

*对于任何*并发存储操作，存储适配器应确保不会发生配置损坏。

**验证需求：18.4**

### 属性 39：存储失败错误处理

*对于任何*存储操作失败，适配器应返回描述性错误，而不损坏现有配置。

**验证需求：18.6**

### 属性 40：服务生命周期日志记录

*对于任何*服务生命周期事件（注册、连接、断开连接、错误），应创建包含事件类型和服务名称的日志条目。

**验证需求：19.1**

### 属性 41：工具调用日志记录

*对于任何*工具调用，应创建包含客户端标识符、工具名称、时间戳和执行持续时间的日志条目。

**验证需求：19.2**

### 属性 42：日志级别过滤

*对于任何*日志级别配置，只应输出该级别或更高级别的日志条目。

**验证需求：19.3**

### 属性 43：日志输出路由

*对于任何*配置的日志输出（控制台、文件、自定义），日志条目应写入该输出。

**验证需求：19.4**

### 属性 44：关联 ID 存在

*对于任何*跨多个服务的请求，与该请求相关的所有日志条目应包含相同的关联 ID。

**验证需求：19.5**

### 属性 45：服务健康检查完整性

*对于任何*健康检查请求，路由器应尝试 ping 所有已注册的服务并报告其各自的健康状态。

**验证需求：20.2**

### 属性 46：不健康服务标记

*对于任何*重复失败健康检查的服务（可配置阈值），路由器应将其标记为不健康并记录警告。

**验证需求：20.3**

### 属性 47：批量请求处理

*对于任何*包含多个工具调用的批量请求，路由器应执行所有调用并在单个响应中返回所有结果。

**验证需求：21.1, 21.2**

### 属性 48：批量部分失败处理

*对于任何*某些工具调用失败的批量请求，路由器应继续执行其他调用，并在响应中包含成功和失败。

**验证需求：21.4**

### 属性 49：批量大小限制强制执行

*对于任何*批量请求，如果超过配置的大小限制，路由器应拒绝它并返回错误，而不执行任何工具调用。

**验证需求：21.5, 21.6**

## 错误处理

### 错误类别

1. **配置错误**：无效的配置文件、缺少必需字段、类型不匹配
2. **连接错误**：后端服务不可用、连接超时、连接被拒绝
3. **协议错误**：格式错误的 JSON-RPC 消息、不支持的协议版本、无效的方法名称
4. **调用错误**：找不到工具、工具被禁用、无效参数、执行超时
5. **资源错误**：连接池耗尽、批量大小限制超出、内存限制

### 错误处理策略

**配置错误**：
- 在加载时验证配置
- 使用描述性错误消息快速失败
- 在热重载期间，回退到先前的有效配置
- 记录所有配置错误，包括文件路径和行号（如果适用）

**连接错误**：
- 实施指数退避重新连接尝试
- 重复失败后将服务标记为不健康
- 向客户端返回描述性错误，指示服务不可用
- 记录连接错误，包括服务名称和错误详细信息

**协议错误**：
- 验证所有传入的 JSON-RPC 消息
- 返回带有适当错误代码的标准 JSON-RPC 错误响应
- 记录协议错误，包括消息内容（对敏感数据进行清理）

**调用错误**：
- 在转发之前验证工具名称和参数
- 使用可配置值强制执行超时限制
- 返回包含哪个服务/工具失败的上下文的错误
- 使用关联 ID 记录调用错误

**资源错误**：
- 强制执行连接池限制以防止耗尽
- 当池达到容量时排队请求（带超时）
- 强制执行批量大小限制以防止 DoS
- 返回清晰的错误消息，指示资源约束

### 错误响应格式

所有错误都遵循 JSON-RPC 2.0 错误响应格式：

```json
{
  "jsonrpc": "2.0",
  "id": "request-id",
  "error": {
    "code": -32000,
    "message": "服务不可用",
    "data": {
      "serviceName": "filesystem",
      "details": "10000ms 后连接超时",
      "correlationId": "abc-123"
    }
  }
}
```

### 错误代码

- `-32700`：解析错误（无效的 JSON）
- `-32600`：无效请求（格式错误的 JSON-RPC）
- `-32601`：找不到方法
- `-32602`：无效参数
- `-32603`：内部错误
- `-32000`：服务不可用
- `-32001`：找不到工具
- `-32002`：工具被禁用
- `-32003`：工具执行超时
- `-32004`：连接池耗尽
- `-32005`：批量大小限制超出

## 测试策略

### 双重测试方法

MCP 路由系统需要单元测试和基于属性的测试来实现全面覆盖：

**单元测试**：专注于特定示例、边缘情况和集成点
- 特定的配置文件格式
- 特定的错误条件（空服务名称、无效端口号）
- 组件之间的集成（协议处理器 → 路由核心 → 连接池）
- 边缘情况（空工具列表、没有标签的服务、零超时）

**基于属性的测试**：验证所有输入的通用属性
- 使用 [fast-check](https://github.com/dubzzz/fast-check) 进行 TypeScript 基于属性的测试
- 每个属性测试应运行至少 100 次迭代
- 生成随机服务定义、工具名称、配置等
- 验证属性对所有生成的输入都成立

### 基于属性的测试配置

**库**：fast-check（TypeScript 基于属性的测试库）

**测试结构**：
```typescript
import fc from 'fast-check';

// Feature: mcp-router-system, Property 1: Service Registration Round Trip
test('属性 1：服务注册往返', () => {
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

**生成器（Arbitraries）**：
- `serviceDefinitionArbitrary()`：生成随机服务定义
- `toolNameArbitrary()`：生成随机工具名称
- `configArbitrary()`：生成随机配置
- `tagFilterArbitrary()`：生成随机标签过滤器
- `batchRequestArbitrary()`：生成随机批量请求

### 单元测试重点领域

1. **配置加载**：测试特定的配置文件格式（JSON，有/无可选字段）
2. **协议处理**：测试特定的 MCP 协议消息（initialize、tools/list、tools/call）
3. **连接池**：测试特定场景（获取、释放、超时、失败）
4. **TUI**：测试 TUI 逻辑（验证、表单处理），不进行 UI 渲染
5. **错误处理**：测试特定错误条件并验证错误消息
6. **集成**：使用模拟 MCP 服务器测试端到端流程

### 测试覆盖率目标

- **行覆盖率**：最低 80%
- **分支覆盖率**：最低 75%
- **属性覆盖率**：100% 的正确性属性实现为测试
- **集成覆盖率**：所有主要用户流程端到端测试

### 测试工具

- **测试框架**：Jest 或 Vitest
- **属性测试**：fast-check
- **模拟**：内置的 Jest/Vitest 模拟
- **覆盖率**：Istanbul（内置于 Jest/Vitest）
- **E2E 测试**：使用模拟 MCP 服务器的自定义测试工具

### 持续测试

- 每次提交时运行单元测试
- 每次拉取请求时运行属性测试
- 发布前运行集成测试
- 监控测试执行时间并优化慢速测试
- 测试失败或覆盖率下降时构建失败
