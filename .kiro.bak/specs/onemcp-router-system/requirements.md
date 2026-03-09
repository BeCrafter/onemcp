# 需求文档：MCP 路由系统

## 介绍

MCP 路由系统是一个基于 Node.js 的中间件服务，将多个 MCP（模型上下文协议）服务器聚合到统一的接口中。该系统作为 MCP 客户端和多个后端 MCP 服务器之间的路由层，提供服务发现、工具路由、连接池管理和灵活的配置管理。

系统支持两种部署模式：
- CLI 模式：通过 stdio（标准输入输出）与客户端通信
- Server 模式：通过 Streamable HTTP 与客户端通信，支持多个并发连接

## 术语表

- **Router_System**：MCP 路由系统，本文档描述的核心系统
- **MCP_Client**：使用 MCP 协议与 Router_System 通信的客户端应用程序（如 Claude Desktop）
- **MCP_Server**：提供工具和资源的后端 MCP 服务器进程
- **Service**：Router_System 中注册的 MCP_Server 配置，包含启动命令和元数据
- **Tool**：MCP_Server 公开的可调用功能
- **Namespaced_Tool_Name**：格式为 "{serviceName}__{toolName}" 的唯一工具标识符
- **Connection_Pool**：管理与单个 Service 的多个连接的组件
- **Tag**：用于分类和过滤 Service 的字符串标签
- **Tag_Filter**：用于根据 Tag 过滤 Service 或 Tool 的查询条件
- **Config_Provider**：负责加载和保存配置的组件
- **Storage_Adapter**：负责持久化配置数据的组件
- **TUI**：终端用户界面，用于交互式配置管理
- **Health_Check**：验证 Service 可用性的诊断操作
- **Heartbeat**：定期执行的健康检查，用于监控 Service 的持续可用性
- **Batch_Request**：包含多个工具调用的单个请求
- **Correlation_ID**：跨多个组件跟踪单个请求的唯一标识符
- **Auto_Unload**：当 Service 不健康时自动从工具列表中移除其工具的过程
- **Auto_Load**：当 Service 恢复健康时自动将其工具添加回工具列表的过程
- **MCP_Inspector**：@modelcontextprotocol/inspector 工具，用于验证 MCP 服务器的正确性
- **Cursor_MCP_Config**：Cursor IDE 中定义的 MCP 配置格式标准
- **AI_Agent**：连接到 Router_System 的 AI 代理客户端（如 Claude、GPT 等）
- **Session**：单个 AI_Agent 与 Router_System 之间的独立连接会话
- **Session_Isolation**：确保不同 Session 之间的请求、状态和数据相互隔离的机制
- **Request_ID**：单个请求的唯一标识符，用于追踪请求的完整生命周期
- **Audit_Log**：详细记录系统操作和请求的审计日志，用于合规和调试
- **Data_Masking**：对敏感数据进行脱敏处理的机制，保护隐私信息
- **TUI_Form**：TUI 中的交互式表单，用于逐步引导用户输入配置信息
- **mcpServers_Format**：标准的 MCP 服务器配置 JSON 格式，包含 command、args、env 等字段
- **Bulk_Import**：批量导入多个服务配置的功能
- **Config_Directory**：存储系统配置文件的目录，默认为 ~/.onemcp
- **CLI_Parameter**：命令行参数
- **Streamable_HTTP**：MCP 协议支持的基于 HTTP 的流式传输方式，用于 Server 模式
- **SSE**：Server-Sent Events，MCP 协议支持的基于 HTTP 的单向流式传输方式
- **Transport_Protocol**：MCP 服务器使用的传输协议类型（stdio、SSE 或 Streamable HTTP）


## 需求

### 需求 1：服务管理

**用户故事：** 作为系统管理员，我希望能够注册、注销和列出 MCP 服务，以便管理路由器连接的后端服务。

#### 验收标准

1. THE Router_System SHALL 接受包含名称、命令、参数、环境变量、标签和启用状态的 Service 定义
2. THE Router_System SHALL 支持与 @modelcontextprotocol/inspector 兼容的配置参数格式
3. THE Router_System SHALL 支持 Cursor IDE 定义的 MCP 配置格式，包括 command、args 和 env 字段
4. THE Router_System SHALL 支持配置 Service 的传输协议类型（stdio、SSE 或 Streamable HTTP）
5. WHERE Service 使用 stdio 传输协议，THE Router_System SHALL 通过子进程的标准输入输出与 Service 通信
6. WHERE Service 使用 SSE 传输协议，THE Router_System SHALL 通过 HTTP 连接和 Server-Sent Events 与 Service 通信
7. WHERE Service 使用 Streamable HTTP 传输协议，THE Router_System SHALL 通过 HTTP 流式请求与 Service 通信
8. WHERE Service 使用 SSE 或 Streamable HTTP 传输协议，THE Service 定义 SHALL 包含 URL 字段
9. WHEN 请求服务列表时，THE Router_System SHALL 返回所有已注册的 Service 及其完整元数据，包括传输协议类型
10. WHEN 注销 Service 时，THE Router_System SHALL 从注册表中删除该 Service 并关闭所有相关连接
11. WHEN 注册 Service 后检索该 Service 时，THE Router_System SHALL 返回与原始定义等效的 Service 定义
12. WHEN 注册具有重复名称的 Service 时，THE Router_System SHALL 更新现有 Service 定义

### 需求 2：工具发现

**用户故事：** 作为 MCP 客户端，我希望发现所有可用的工具及其模式，以便了解可以调用哪些功能。

#### 验收标准

1. WHEN MCP_Client 请求工具列表时，THE Router_System SHALL 查询所有已启用的 Service 并返回聚合的工具列表
2. THE Router_System SHALL 为每个 Tool 提供名称、命名空间名称、描述、输入模式和源服务名称
3. THE Router_System SHALL 缓存工具定义以提高性能
4. WHEN Service 注册或注销时，THE Router_System SHALL 使工具缓存失效并重新发现工具

### 需求 3：工具状态管理

**用户故事：** 作为系统管理员，我希望启用或禁用特定工具，以便控制哪些功能对客户端可用。

#### 验收标准

1. WHEN Tool 被禁用时，THE Router_System SHALL 拒绝对该 Tool 的调用请求并返回错误
2. THE Router_System SHALL 允许通过 Namespaced_Tool_Name 启用或禁用单个 Tool
3. WHEN 查询 Tool 状态时，THE Router_System SHALL 返回当前的启用或禁用状态
4. THE Router_System SHALL 在配置中持久化 Tool 状态，以便在重启后保留
5. THE Router_System SHALL 支持在 Service 配置中预先定义工具的启用/禁用状态
6. THE Router_System SHALL 支持在 Service 配置中使用工具名称模式（通配符或正则表达式）批量定义工具状态
7. WHEN 导入包含工具状态定义的 Service 配置时，THE Router_System SHALL 应用这些预定义的工具状态
8. THE Router_System SHALL 允许通过 API 动态修改工具的启用/禁用状态
9. WHEN 工具状态改变时，THE Router_System SHALL 发出事件通知
10. THE Router_System SHALL 在工具列表响应中包含每个工具的启用/禁用状态
11. WHERE Service 配置未指定工具状态，THE Router_System SHALL 默认启用该 Service 的所有工具

### 需求 4：工具命名空间

**用户故事：** 作为系统架构师，我希望工具名称使用命名空间，以便避免来自不同服务的工具之间的名称冲突。

#### 验收标准

1. THE Router_System SHALL 使用格式 "{serviceName}__{toolName}" 为所有 Tool 生成 Namespaced_Tool_Name
2. WHEN 解析 Namespaced_Tool_Name 时，THE Router_System SHALL 正确识别 Service 名称和 Tool 名称组件
3. WHEN 两个 Service 公开同名 Tool 时，THE Router_System SHALL 通过不同的 Namespaced_Tool_Name 使两者都可访问
4. THE Router_System SHALL 清理 Service 名称中的特殊字符以确保有效的命名空间名称

### 需求 5：工具调用路由

**用户故事：** 作为 MCP 客户端，我希望调用工具并接收结果，以便执行后端服务提供的功能。

#### 验收标准

1. WHEN MCP_Client 使用 Namespaced_Tool_Name 和参数调用 Tool 时，THE Router_System SHALL 将请求路由到正确的 Service
2. THE Router_System SHALL 验证 Tool 参数是否符合 Tool 的输入模式
3. WHEN Tool 执行成功时，THE Router_System SHALL 将结果返回给 MCP_Client
4. THE Router_System SHALL 在工具调用期间维护请求上下文和 Correlation_ID


### 需求 6：连接池管理

**用户故事：** 作为系统架构师，我希望系统使用连接池管理与后端服务的连接，以便优化资源使用和性能。

#### 验收标准

1. THE Router_System SHALL 为每个 Service 维护一个 Connection_Pool，在可用时重用空闲连接
2. THE Router_System SHALL 允许配置每个 Service 的最大连接数、空闲超时和连接超时
3. WHEN Connection_Pool 达到最大连接数时，THE Router_System SHALL 排队新请求或在超时后返回错误
4. WHEN 连接失败时，THE Router_System SHALL 从池中删除该连接并在需要时创建新连接
5. THE Router_System SHALL 强制执行连接池限制以防止资源耗尽
6. WHEN 连接空闲超过配置的超时时间时，THE Router_System SHALL 关闭该连接

### 需求 7：协议处理

**用户故事：** 作为 MCP 客户端，我希望使用标准 JSON-RPC 2.0 协议与路由器通信，以便实现互操作性。

#### 验收标准

1. THE Router_System SHALL 接受符合 JSON-RPC 2.0 规范的请求
2. THE Router_System SHALL 返回符合 JSON-RPC 2.0 规范的响应
3. THE Router_System SHALL 为所有错误条件返回符合 JSON-RPC 2.0 的错误响应
4. THE Router_System SHALL 支持 MCP 协议规范定义的三种传输方式：stdio、SSE 和 Streamable HTTP

### 需求 8：部署模式

**用户故事：** 作为系统部署者，我希望选择 CLI 或 Server 模式，以便根据我的用例灵活部署。

#### 验收标准

1. WHERE CLI 模式，THE Router_System SHALL 作为命令行工具运行，通过 stdio 传输协议与单个客户端通信
2. WHERE Server 模式，THE Router_System SHALL 作为 HTTP 服务器运行，通过 Streamable HTTP 传输协议处理多个并发客户端
3. THE Router_System SHALL 允许在配置中指定部署模式
4. WHERE Server 模式，THE Router_System SHALL 监听 0.0.0.0 地址以接受来自任何网络接口的连接
5. WHERE Server 模式，THE Router_System SHALL 允许配置监听端口号

### 需求 9：错误处理

**用户故事：** 作为 MCP 客户端开发者，我希望接收清晰的错误消息，以便诊断和处理问题。

#### 验收标准

1. WHEN 发生错误时，THE Router_System SHALL 返回包含错误代码、消息和上下文详细信息的错误响应
2. WHEN 请求的 Tool 不存在时，THE Router_System SHALL 返回 "找不到工具" 错误
3. WHEN 请求格式错误时，THE Router_System SHALL 返回 "无效请求" 错误
4. WHEN Service 不可用时，THE Router_System SHALL 返回 "服务不可用" 错误并包含服务名称
5. WHEN Tool 被禁用时，THE Router_System SHALL 返回 "工具被禁用" 错误

### 需求 10：超时和错误传播

**用户故事：** 作为系统运维人员，我希望系统处理超时和后端错误，以便防止无限期挂起和提供清晰的错误信息。

#### 验收标准

1. WHEN MCP_Server 返回错误时，THE Router_System SHALL 将错误转发给 MCP_Client 并附加源服务上下文
2. WHEN Tool 调用超过配置的超时时间时，THE Router_System SHALL 终止请求并返回超时错误
3. THE Router_System SHALL 为所有错误响应使用标准 JSON-RPC 2.0 错误格式
4. THE Router_System SHALL 在错误响应中包含 Correlation_ID 以便追踪
5. THE Router_System SHALL 记录所有错误，包含错误消息、堆栈跟踪和上下文信息


### 需求 11：配置管理

**用户故事：** 作为系统管理员，我希望通过配置文件管理路由器设置，以便轻松配置和维护系统。

#### 验收标准

1. THE Router_System SHALL 从 JSON 配置文件加载配置，包括服务定义、连接池设置和日志配置
2. THE Router_System SHALL 默认将配置文件存储在 ~/.onemcp 目录下
3. THE Router_System SHALL 支持通过命令行参数 --config-dir 或 -c 指定自定义配置目录位置
4. THE Router_System SHALL 支持通过环境变量 ONEMCP_CONFIG_DIR 指定配置目录位置
5. WHEN 配置目录不存在时，THE Router_System SHALL 自动创建该目录及必要的子目录
6. THE Router_System SHALL 在配置目录中维护以下文件结构：
   - config.json：主配置文件
   - services/：服务定义目录
   - logs/：日志文件目录（如果配置为文件输出）
   - backups/：配置备份目录
7. WHEN 配置文件无效时，THE Router_System SHALL 拒绝加载并返回描述性错误消息
8. THE Router_System SHALL 应用配置文件中指定的所有配置参数
9. THE Router_System SHALL 将配置更改持久化到配置文件
10. THE Router_System SHALL 在重启后保留配置，包括 Service 定义和 Tool 状态
11. THE Router_System SHALL 允许配置连接池参数，包括最大连接数、空闲超时和连接超时
12. WHEN 配置文件更改时，THE Router_System SHALL 自动重新加载配置而无需重启
13. THE Router_System SHALL 在加载前验证配置文件，拒绝缺少必需字段或包含无效值的配置
14. WHEN 热重载期间配置无效时，THE Router_System SHALL 继续使用先前的有效配置并记录错误
15. THE Router_System SHALL 在启动时显示正在使用的配置目录路径
16. THE Router_System SHALL 支持相对路径和绝对路径作为配置目录位置
17. THE Router_System SHALL 在配置目录中创建 README 文件，说明目录结构和配置格式

### 需求 12：MCP 协议实现

**用户故事：** 作为 MCP 客户端，我希望路由器实现标准 MCP 协议方法，以便与任何兼容的 MCP 客户端一起工作。

#### 验收标准

1. THE Router_System SHALL 实现 MCP 协议的 initialize 方法以建立客户端连接
2. THE Router_System SHALL 实现 tools/list 方法以返回所有可用工具及其模式
3. THE Router_System SHALL 实现 tools/call 方法以执行工具调用
4. THE Router_System SHALL 为所有协议错误返回符合 JSON-RPC 2.0 的错误响应
5. THE Router_System SHALL 在错误响应中包含适当的错误代码和描述性消息

### 需求 13：标签系统

**用户故事：** 作为系统管理员，我希望使用标签对服务进行分类，以便组织和过滤服务。

#### 验收标准

1. THE Router_System SHALL 允许为每个 Service 分配零个或多个 Tag
2. WHEN 检索 Service 时，THE Router_System SHALL 返回分配给该 Service 的所有 Tag
3. THE Router_System SHALL 允许按 Tag 查询 Service，使用 AND 或 OR 逻辑
4. THE Router_System SHALL 接受任何字符串作为有效的 Tag
5. WHEN 使用 AND 逻辑查询多个 Tag 时，THE Router_System SHALL 仅返回具有所有指定 Tag 的 Service

### 需求 14：基于标签的工具过滤

**用户故事：** 作为 MCP 客户端，我希望根据服务标签过滤工具，以便仅访问相关功能。

#### 验收标准

1. THE Router_System SHALL 允许在列出工具时应用 Tag_Filter
2. WHEN 应用 Tag_Filter 时，THE Router_System SHALL 仅返回来自匹配过滤器的 Service 的 Tool
3. WHEN 未应用 Tag_Filter 时，THE Router_System SHALL 返回所有已启用 Service 的所有 Tool
4. THE Router_System SHALL 支持 Tag_Filter 的 AND 和 OR 逻辑模式
5. WHEN 在初始化期间应用 Tag_Filter 时，THE Router_System SHALL 不创建与不匹配过滤器的 Service 的连接

### 需求 15：TUI 管理界面

**用户故事：** 作为系统管理员，我希望使用交互式终端界面管理配置，以便轻松添加、编辑和测试服务。

#### 验收标准

1. THE Router_System SHALL 提供独立的 TUI 命令用于配置管理
2. THE TUI SHALL 显示所有已注册 Service 的列表及其状态
3. THE TUI SHALL 提供添加新 Service 的表单，包含所有必需和可选字段
4. THE TUI SHALL 提供编辑现有 Service 的表单
5. THE TUI SHALL 允许删除 Service
6. THE TUI SHALL 在保存前验证 Service 配置
7. THE TUI SHALL 提供测试 Service 连接的功能
8. THE TUI SHALL 在保存无效配置时显示清晰的错误消息
9. THE TUI SHALL 提供两种服务添加模式：
   - 表单模式：通过友好的交互式表单逐步引导用户输入配置信息
   - JSON 模式：允许用户直接粘贴或输入完整的 mcpServers 格式 JSON 配置
10. WHERE 表单模式，THE TUI SHALL 提供以下友好的输入界面：
    - 服务名称输入（带验证和建议）
    - 传输协议类型选择（stdio、SSE 或 Streamable HTTP）
    - 命令输入（支持自动补全和路径选择，仅用于 stdio 协议）
    - URL 输入（仅用于 SSE 和 Streamable HTTP 协议）
    - 参数列表输入（支持动态添加/删除参数项，仅用于 stdio 协议）
    - 环境变量输入（键值对输入和模板选择，仅用于 stdio 协议）
    - 标签选择（支持多选和自定义标签）
    - 连接池配置（带默认值和范围提示）
    - 工具状态预配置（可选，用于预先定义工具的启用/禁用状态）
11. WHERE JSON 模式，THE TUI SHALL：
    - 提供多行文本编辑器用于输入 JSON
    - 实时验证 JSON 格式的正确性
    - 显示 JSON 语法错误的位置和原因
    - 支持从文件导入 JSON 配置
    - 支持批量导入多个服务配置
12. THE TUI SHALL 在表单模式和 JSON 模式之间提供快速切换功能
13. THE TUI SHALL 提供配置预览功能，在保存前显示完整的配置内容
14. THE TUI SHALL 支持配置模板，提供常见 MCP 服务的预设配置（如 filesystem、github、database 等），包括不同传输协议类型的模板
15. THE TUI SHALL 提供配置导出功能，将当前配置导出为 mcpServers 格式的 JSON 文件
16. THE TUI SHALL 在输入过程中提供上下文帮助和示例
17. THE TUI SHALL 支持键盘快捷键以提高操作效率
18. THE TUI SHALL 提供工具管理界面，显示每个 Service 公开的所有 Tool 列表
19. THE TUI SHALL 允许用户在工具管理界面中启用或禁用单个 Tool
20. THE TUI SHALL 在工具列表中清晰显示每个 Tool 的当前状态（已启用/已禁用）
21. THE TUI SHALL 支持批量启用或禁用多个 Tool
22. THE TUI SHALL 支持按 Service 过滤工具列表
23. THE TUI SHALL 支持搜索和过滤工具（按名称、描述或 Service）
24. THE TUI SHALL 在禁用工具时显示警告，说明该操作的影响
25. THE TUI SHALL 提供工具状态的快速切换功能（通过快捷键或点击）
26. THE TUI SHALL 根据选择的传输协议类型动态显示和隐藏相关的配置字段
27. THE TUI SHALL 在编辑 Service 时显示该 Service 的所有工具列表及其当前启用/禁用状态
28. THE TUI SHALL 允许在 Service 配置界面中直接管理该 Service 的工具状态
29. THE TUI SHALL 在导入包含工具状态定义的配置时，显示预览并允许用户确认或修改工具状态
30. THE TUI SHALL 在导出配置时包含当前的工具启用/禁用状态


### 需求 16：编程 API

**用户故事：** 作为应用程序开发者，我希望将路由器作为库导入，以便在我的 Node.js 应用程序中以编程方式使用它。

#### 验收标准

1. THE Router_System SHALL 提供可导入的 NPM 包，公开编程 API
2. THE Router_System SHALL 允许通过 API 注册、注销和列出 Service
3. THE Router_System SHALL 允许通过 API 启用、禁用和列出 Tool
4. THE Router_System SHALL 接受以编程方式提供的配置对象
5. THE Router_System SHALL 为重要事件发出事件，包括服务连接、断开连接、工具调用和错误
6. THE Router_System SHALL 提供启动和停止路由器的方法

### 需求 17：可扩展配置提供者

**用户故事：** 作为系统集成者，我希望实现自定义配置提供者，以便从各种来源（数据库、API、环境变量）加载配置。

#### 验收标准

1. THE Router_System SHALL 定义 Config_Provider 接口，包含加载、保存、验证和监视方法
2. THE Router_System SHALL 允许注册自定义 Config_Provider 实现
3. WHEN 注册自定义 Config_Provider 时，THE Router_System SHALL 将其用于所有配置操作
4. THE Router_System SHALL 提供默认的基于文件的 Config_Provider 实现
5. THE Router_System SHALL 调用 Config_Provider 的验证方法以确保配置有效性
6. WHEN Config_Provider 检测到配置更改时，THE Router_System SHALL 自动重新加载受影响的 Service

### 需求 18：可扩展存储适配器

**用户故事：** 作为系统集成者，我希望实现自定义存储适配器，以便将配置持久化到各种后端（数据库、云存储、键值存储）。

#### 验收标准

1. THE Router_System SHALL 定义 Storage_Adapter 接口，包含读取、写入、更新、删除和列出键的方法
2. THE Router_System SHALL 提供默认的 JSON 文件存储适配器
3. THE Router_System SHALL 允许注册自定义 Storage_Adapter 实现
4. THE Router_System SHALL 确保存储操作的原子性以防止配置损坏
5. THE Router_System SHALL 提供内存存储适配器用于测试
6. WHEN 存储操作失败时，THE Storage_Adapter SHALL 返回描述性错误而不损坏现有配置

### 需求 19：日志记录

**用户故事：** 作为系统运维人员，我希望系统记录所有重要事件和错误，以便监控和故障排除。

#### 验收标准

1. THE Router_System SHALL 记录所有服务生命周期事件，包括注册、连接、断开连接和错误
2. THE Router_System SHALL 记录所有工具调用，包含客户端标识符、工具名称、时间戳和执行持续时间
3. THE Router_System SHALL 支持可配置的日志级别：DEBUG、INFO、WARN、ERROR
4. THE Router_System SHALL 支持多种日志输出：控制台、文件和自定义输出
5. THE Router_System SHALL 在日志条目中包含 Correlation_ID 以跟踪跨多个服务的请求
6. THE Router_System SHALL 允许配置日志格式，包括时间戳和 Correlation_ID 的包含
7. WHERE Server 模式，THE Router_System SHALL 在日志中包含 Session 标识符和 AI_Agent 标识符
8. THE Router_System SHALL 记录每个请求的完整调度路径，包括从接收到路由到后端服务的所有步骤
9. THE Router_System SHALL 记录每个工具调用的输入参数（在配置允许的情况下）
10. THE Router_System SHALL 记录每个工具调用的输出结果（在配置允许的情况下）
11. THE Router_System SHALL 允许配置敏感数据的脱敏规则，以保护隐私信息
12. THE Router_System SHALL 提供结构化日志格式（如 JSON），便于日志分析工具解析
13. THE Router_System SHALL 支持按 Session、AI_Agent、Service 或 Tool 过滤日志
14. THE Router_System SHALL 记录请求调度决策，包括选择的连接池、连接 ID 和路由原因

### 需求 20：健康监控

**用户故事：** 作为系统运维人员，我希望监控路由器和后端服务的健康状况，以便检测和诊断问题。

#### 验收标准

1. THE Router_System SHALL 提供健康检查端点，返回整体系统健康状况
2. THE Router_System SHALL 对所有已注册的 Service 执行健康检查并报告各自的状态
3. THE Router_System SHALL 允许配置健康检查间隔
4. THE Router_System SHALL 在健康检查响应中包含每个 Service 的最后检查时间和错误详细信息
5. WHEN Service 重复失败健康检查时，THE Router_System SHALL 将其标记为不健康并记录警告
6. WHEN Service 健康检查失败时，THE Router_System SHALL 自动卸载该 Service 的所有 Tool，使其对客户端不可见
7. WHEN 先前不健康的 Service 恢复健康时，THE Router_System SHALL 自动重新加载该 Service 的所有 Tool，使其对客户端可用
8. THE Router_System SHALL 在工具自动卸载和加载时发出相应的事件通知
9. THE Router_System SHALL 在 Service 首次注册后执行初始健康检查，在健康检查通过前不启用其工具

### 需求 21：批量请求处理

**用户故事：** 作为 MCP 客户端，我希望在单个请求中调用多个工具，以便减少往返次数并提高性能。

#### 验收标准

1. THE Router_System SHALL 接受包含多个工具调用的 Batch_Request
2. THE Router_System SHALL 执行 Batch_Request 中的所有工具调用并在单个响应中返回所有结果
3. THE Router_System SHALL 为 Batch_Request 中的每个工具调用维护单独的 Correlation_ID
4. WHEN Batch_Request 中的某些工具调用失败时，THE Router_System SHALL 继续执行其他调用并在响应中包含成功和失败
5. THE Router_System SHALL 强制执行可配置的批量大小限制以防止资源耗尽
6. WHEN Batch_Request 超过批量大小限制时，THE Router_System SHALL 拒绝整个请求并返回错误


### 需求 22：进程管理

**用户故事：** 作为系统架构师，我希望路由器管理后端 MCP 服务器进程的生命周期，以便自动启动、监控和停止服务。

#### 验收标准

1. WHERE Service 使用 stdio 传输协议，THE Router_System SHALL 使用配置的命令和参数将 MCP_Server 作为子进程启动
2. THE Router_System SHALL 将配置的环境变量传递给 MCP_Server 进程
3. WHERE Service 使用 stdio 传输协议，WHEN MCP_Server 进程崩溃时，THE Router_System SHALL 检测失败并在下次请求时重新启动进程
4. WHEN 关闭 Connection_Pool 时，THE Router_System SHALL 优雅地终止所有 MCP_Server 进程
5. WHERE Service 使用 stdio 传输协议，THE Router_System SHALL 监控 MCP_Server 进程的标准错误输出并记录错误消息
6. WHERE Service 使用 SSE 或 Streamable HTTP 传输协议，THE Router_System SHALL 通过 HTTP 连接管理与 Service 的通信，无需启动子进程
7. WHERE Service 使用 SSE 或 Streamable HTTP 传输协议，THE Router_System SHALL 验证 Service URL 的可达性
8. THE Router_System SHALL 根据 Service 的传输协议类型选择适当的连接管理策略

### 需求 23：并发处理

**用户故事：** 作为系统架构师，我希望路由器处理多个并发请求，以便支持多个客户端和高吞吐量场景。

#### 验收标准

1. WHERE Server 模式，THE Router_System SHALL 同时处理来自多个 MCP_Client 的请求
2. WHERE Server 模式，THE Router_System SHALL 支持多个 AI_Agent 同时连接，每个 AI_Agent 拥有独立的 Session
3. THE Router_System SHALL 使用 Connection_Pool 在并发请求之间重用连接
4. THE Router_System SHALL 为每个请求维护独立的 Correlation_ID
5. THE Router_System SHALL 防止并发请求之间的竞态条件和数据损坏
6. THE Router_System SHALL 允许配置最大并发连接数以防止资源耗尽
7. THE Router_System SHALL 确保不同 AI_Agent 的 Session 之间完全隔离，一个 AI_Agent 的操作不会影响其他 AI_Agent
8. THE Router_System SHALL 为每个 Session 维护独立的请求上下文和状态
9. WHEN 一个 AI_Agent 的请求失败或超时时，THE Router_System SHALL 不影响其他 AI_Agent 的正常操作

### 需求 24：安全性

**用户故事：** 作为安全工程师，我希望路由器实施安全最佳实践，以便保护系统免受恶意输入和攻击。

#### 验收标准

1. THE Router_System SHALL 验证所有输入参数以防止注入攻击
2. THE Router_System SHALL 清理日志输出中的敏感数据，包括环境变量和参数
3. THE Router_System SHALL 强制执行批量大小限制以防止拒绝服务攻击
4. THE Router_System SHALL 强制执行连接池限制以防止资源耗尽攻击
5. WHERE Server 模式，THE Router_System SHALL 允许配置访问控制和身份验证机制

### 需求 25：性能优化

**用户故事：** 作为系统架构师，我希望路由器优化性能，以便最小化延迟并最大化吞吐量。

#### 验收标准

1. THE Router_System SHALL 缓存工具定义以避免重复发现请求
2. THE Router_System SHALL 重用连接池中的空闲连接以避免进程启动开销
3. THE Router_System SHALL 允许配置缓存过期时间
4. WHEN 应用 Tag_Filter 时，THE Router_System SHALL 仅连接到匹配的 Service 以节省资源
5. THE Router_System SHALL 使用异步 I/O 操作以避免阻塞

### 需求 26：文档和示例

**用户故事：** 作为开发者，我希望获得全面的文档和示例，以便快速学习和使用路由器。

#### 验收标准

1. THE Router_System SHALL 提供 README 文档，包含安装、配置和使用说明
2. THE Router_System SHALL 提供配置文件格式的示例
3. THE Router_System SHALL 提供常见用例的示例，包括 CLI 模式和 Server 模式
4. THE Router_System SHALL 提供 API 参考文档，包含所有公共接口和方法
5. THE Router_System SHALL 提供实现自定义 Config_Provider 和 Storage_Adapter 的示例

### 需求 27：版本兼容性

**用户故事：** 作为系统维护者，我希望路由器支持版本兼容性，以便平滑升级和向后兼容。

#### 验收标准

1. THE Router_System SHALL 在响应中包含版本信息
2. THE Router_System SHALL 支持 MCP 协议的多个版本
3. WHEN 配置文件格式更改时，THE Router_System SHALL 提供迁移工具或向后兼容性
4. THE Router_System SHALL 遵循语义版本控制以指示破坏性更改
5. THE Router_System SHALL 在主要版本更改时提供升级指南

### 需求 28：测试支持

**用户故事：** 作为测试工程师，我希望路由器提供测试支持，以便轻松编写单元测试和集成测试。

#### 验收标准

1. THE Router_System SHALL 提供内存存储适配器用于测试，无需文件系统访问
2. THE Router_System SHALL 允许注入模拟 Config_Provider 和 Storage_Adapter 用于测试
3. THE Router_System SHALL 提供测试工具用于创建模拟 MCP_Server
4. THE Router_System SHALL 允许在测试中禁用日志输出
5. THE Router_System SHALL 提供工厂方法用于创建测试配置


### 需求 29：解析器和序列化器

**用户故事：** 作为系统架构师，我希望路由器正确解析和序列化 JSON-RPC 消息，以便确保协议兼容性和数据完整性。

#### 验收标准

1. THE Router_System SHALL 解析符合 JSON-RPC 2.0 规范的传入消息
2. WHEN 传入消息格式错误时，THE Router_System SHALL 返回解析错误响应
3. THE Router_System SHALL 将响应序列化为符合 JSON-RPC 2.0 规范的格式
4. THE Router_System SHALL 实现 Pretty_Printer 以格式化 JSON-RPC 消息用于日志记录
5. FOR ALL 有效的 JSON-RPC 消息，解析后序列化再解析 SHALL 产生等效的消息对象（往返属性）

### 需求 30：配置验证

**用户故事：** 作为系统管理员，我希望路由器验证配置，以便在启动前捕获配置错误。

#### 验收标准

1. THE Router_System SHALL 验证所有必需的配置字段是否存在
2. THE Router_System SHALL 验证配置值的类型是否正确（数字、字符串、布尔值、数组）
3. THE Router_System SHALL 验证数值配置是否在有效范围内（例如端口号 1-65535）
4. WHERE Service 使用 stdio 传输协议，THE Router_System SHALL 验证 Service 命令是否可执行
5. WHERE Service 使用 SSE 或 Streamable HTTP 传输协议，THE Router_System SHALL 验证 Service URL 格式是否正确
6. THE Router_System SHALL 验证传输协议类型是否为有效值（stdio、SSE 或 Streamable HTTP）
7. WHERE Service 使用 SSE 或 Streamable HTTP 传输协议，THE Router_System SHALL 验证 URL 字段是否存在
8. WHERE Service 使用 stdio 传输协议，THE Router_System SHALL 验证 command 字段是否存在
9. WHEN 配置验证失败时，THE Router_System SHALL 返回包含所有验证错误的详细错误消息

### 需求 31：优雅关闭

**用户故事：** 作为系统运维人员，我希望路由器优雅地关闭，以便完成正在进行的请求并清理资源。

#### 验收标准

1. WHEN 接收到关闭信号时，THE Router_System SHALL 停止接受新请求
2. THE Router_System SHALL 等待所有正在进行的请求完成，最多等待配置的超时时间
3. THE Router_System SHALL 关闭所有 Connection_Pool 并终止 MCP_Server 进程
4. THE Router_System SHALL 刷新所有日志缓冲区并关闭日志文件
5. THE Router_System SHALL 在关闭完成后退出，返回适当的退出代码

### 需求 32：错误恢复

**用户故事：** 作为系统运维人员，我希望路由器从临时错误中恢复，以便提供弹性服务。

#### 验收标准

1. WHEN MCP_Server 进程崩溃时，THE Router_System SHALL 在下次请求时自动重新启动进程
2. WHEN 连接失败时，THE Router_System SHALL 使用指数退避重试连接
3. THE Router_System SHALL 允许配置最大重试次数和退避参数
4. WHEN Service 在配置的重试次数后仍然不可用时，THE Router_System SHALL 将其标记为不健康
5. WHEN 先前不健康的 Service 恢复时，THE Router_System SHALL 自动将其标记为健康

### 需求 33：资源限制

**用户故事：** 作为系统运维人员，我希望配置资源限制，以便防止路由器消耗过多的系统资源。

#### 验收标准

1. THE Router_System SHALL 允许配置每个 Service 的最大连接数
2. THE Router_System SHALL 允许配置最大并发请求数
3. THE Router_System SHALL 允许配置最大批量请求大小
4. THE Router_System SHALL 允许配置内存使用限制
5. WHEN 达到资源限制时，THE Router_System SHALL 拒绝新请求并返回资源耗尽错误

### 需求 34：指标收集

**用户故事：** 作为系统运维人员，我希望收集性能指标，以便监控和优化系统性能。

#### 验收标准

1. THE Router_System SHALL 收集每个 Tool 的调用计数和执行时间
2. THE Router_System SHALL 收集每个 Service 的连接池统计信息，包括活动连接、空闲连接和等待请求
3. THE Router_System SHALL 收集错误率和错误类型统计信息
4. THE Router_System SHALL 提供 API 或端点以查询收集的指标
5. THE Router_System SHALL 允许配置指标收集间隔和保留期

### 需求 35：调试支持

**用户故事：** 作为开发者，我希望路由器提供调试支持，以便诊断和解决问题。

#### 验收标准

1. WHERE DEBUG 日志级别，THE Router_System SHALL 记录所有 JSON-RPC 消息的详细内容
2. THE Router_System SHALL 提供详细模式，记录连接池操作和状态转换
3. THE Router_System SHALL 在错误响应中包含堆栈跟踪（当配置为调试模式时）
4. THE Router_System SHALL 提供诊断端点，返回当前系统状态，包括所有 Service、Connection_Pool 和活动请求
5. THE Router_System SHALL 允许在运行时动态更改日志级别

### 需求 36：MCP Inspector 兼容性

**用户故事：** 作为开发者和测试工程师，我希望路由器与 @modelcontextprotocol/inspector 工具兼容，以便验证服务的正确性和调试问题。

#### 验收标准

1. WHERE CLI 模式，THE Router_System SHALL 能够被 `npx @modelcontextprotocol/inspector` 工具连接和验证
2. WHERE Server 模式，THE Router_System SHALL 能够被 `npx @modelcontextprotocol/inspector` 工具通过网络连接和验证
3. THE Router_System SHALL 正确响应 MCP_Inspector 发送的所有标准 MCP 协议消息
4. THE Router_System SHALL 在 MCP_Inspector 中正确显示所有已注册的工具及其模式
5. THE Router_System SHALL 允许通过 MCP_Inspector 成功调用所有已启用的工具
6. THE Router_System SHALL 提供文档说明如何使用 MCP_Inspector 验证 CLI 和 Server 模式的部署

### 需求 37：配置格式标准化

**用户故事：** 作为系统集成者，我希望路由器使用标准化的配置格式，以便与现有的 MCP 生态系统工具兼容。

#### 验收标准

1. THE Router_System SHALL 使用与 Cursor IDE MCP 配置兼容的 JSON 格式定义服务
2. THE Router_System SHALL 支持标准的 `command`、`args` 和 `env` 字段用于服务定义
3. THE Router_System SHALL 支持与 @modelcontextprotocol/inspector 相同的配置参数结构
4. THE Router_System SHALL 提供配置示例，展示如何定义与 Cursor IDE 和 MCP_Inspector 兼容的服务
5. THE Router_System SHALL 验证配置格式是否符合 MCP 生态系统标准
6. THE Router_System SHALL 在配置文档中明确说明与 Cursor IDE 和 MCP_Inspector 的兼容性

### 需求 38：多 AI Agent 会话隔离

**用户故事：** 作为 AI Agent 开发者，我希望多个 AI Agent 可以同时连接到路由器而不会相互干扰，以便支持多用户和多租户场景。

#### 验收标准

1. WHERE Server 模式，THE Router_System SHALL 为每个连接的 AI_Agent 创建独立的 Session
2. THE Router_System SHALL 确保每个 Session 拥有独立的请求队列和响应通道
3. THE Router_System SHALL 为每个 Session 分配唯一的会话标识符
4. WHEN 多个 AI_Agent 同时调用相同的 Tool 时，THE Router_System SHALL 正确隔离每个调用的上下文和结果
5. THE Router_System SHALL 确保一个 Session 的错误或异常不会传播到其他 Session
6. THE Router_System SHALL 为每个 Session 独立跟踪和记录日志，包含会话标识符
7. WHEN 一个 AI_Agent 断开连接时，THE Router_System SHALL 清理该 Session 的资源而不影响其他活动 Session
8. THE Router_System SHALL 支持配置每个 Session 的资源限制（如最大并发请求数、超时时间）
9. THE Router_System SHALL 在指标收集中区分不同 Session 的统计数据
10. THE Router_System SHALL 提供 API 查询当前活动的 Session 列表及其状态

### 需求 39：请求追踪和审计日志

**用户故事：** 作为系统运维人员和安全审计员，我希望系统提供详细的请求追踪和审计日志，以便分析系统行为、调试问题和满足合规要求。

#### 验收标准

1. THE Router_System SHALL 为每个请求生成唯一的请求 ID（Request_ID）
2. THE Router_System SHALL 记录每个请求的完整生命周期，包括：接收时间、路由决策、执行时间、完成时间
3. THE Router_System SHALL 在审计日志中记录以下信息：
   - Session 标识符和 AI_Agent 标识符
   - Request_ID 和 Correlation_ID
   - 请求的工具名称（Namespaced_Tool_Name）
   - 请求的输入参数（支持配置是否记录和脱敏规则）
   - 请求的输出结果（支持配置是否记录和脱敏规则）
   - 路由到的 Service 名称和连接 ID
   - 执行状态（成功、失败、超时）
   - 执行持续时间（毫秒）
   - 错误信息（如果失败）
4. THE Router_System SHALL 支持配置审计日志的详细级别（minimal、standard、verbose）
5. THE Router_System SHALL 提供日志查询 API，支持按以下条件过滤：
   - Session 标识符
   - AI_Agent 标识符
   - Request_ID
   - Tool 名称
   - Service 名称
   - 时间范围
   - 执行状态
6. THE Router_System SHALL 支持将审计日志导出为标准格式（JSON、CSV）
7. THE Router_System SHALL 允许配置审计日志的保留策略（保留时间、最大大小、轮转策略）
8. THE Router_System SHALL 在日志中包含调度决策的详细信息，如连接池选择原因、负载均衡决策
9. THE Router_System SHALL 支持实时日志流，允许外部系统订阅日志事件
10. THE Router_System SHALL 确保审计日志的完整性，防止日志被篡改或丢失

### 需求 40：配置导入导出

**用户故事：** 作为系统管理员，我希望能够导入和导出服务配置，以便在不同环境之间迁移配置或备份配置。

#### 验收标准

1. THE Router_System SHALL 支持从 mcpServers 格式的 JSON 文件导入服务配置
2. THE Router_System SHALL 支持导出所有服务配置为 mcpServers 格式的 JSON 文件
3. THE Router_System SHALL 在导入前验证 JSON 配置的格式和内容
4. WHEN 导入的服务名称与现有服务冲突时，THE Router_System SHALL 提供选项：覆盖、跳过或重命名
5. THE Router_System SHALL 支持批量导入多个服务配置
6. THE Router_System SHALL 在导入过程中提供进度反馈和错误报告
7. THE Router_System SHALL 支持部分导入，即使某些服务配置无效也继续导入其他有效配置
8. THE Router_System SHALL 在导出时支持选择性导出（选择特定服务或按标签过滤）
9. THE Router_System SHALL 提供配置备份功能，自动定期备份配置到指定位置
10. THE Router_System SHALL 支持从备份恢复配置
11. THE Router_System SHALL 将备份文件存储在配置目录的 backups/ 子目录中
12. THE Router_System SHALL 在备份文件名中包含时间戳，便于识别和管理
13. THE Router_System SHALL 允许配置备份保留策略（保留数量、保留时间）
14. THE Router_System SHALL 在导入配置时识别并应用配置中定义的工具启用/禁用状态
15. THE Router_System SHALL 在导出配置时包含所有工具的当前启用/禁用状态
16. THE Router_System SHALL 支持在配置文件中使用工具名称模式（如 "service_*" 或正则表达式）定义工具状态

### 需求 41：命令行界面

**用户故事：** 作为系统管理员和开发者，我希望通过命令行参数控制系统行为，以便灵活配置和启动系统。

#### 验收标准

1. THE Router_System SHALL 提供命令行参数 --config-dir 或 -c 用于指定配置目录位置
2. THE Router_System SHALL 提供命令行参数 --mode 或 -m 用于指定运行模式（cli 或 server）
3. WHERE Server 模式，THE Router_System SHALL 提供命令行参数 --port 或 -p 用于指定监听端口（默认监听 0.0.0.0）
4. THE Router_System SHALL 提供命令行参数 --log-level 或 -l 用于指定日志级别
5. THE Router_System SHALL 提供命令行参数 --help 或 -h 显示所有可用的命令行选项
6. THE Router_System SHALL 提供命令行参数 --version 或 -v 显示系统版本信息
7. THE Router_System SHALL 提供命令行参数 --validate 用于验证配置文件而不启动系统
8. THE Router_System SHALL 提供命令行参数 --init 用于初始化配置目录和创建默认配置文件
9. THE Router_System SHALL 支持通过环境变量覆盖命令行参数
10. THE Router_System SHALL 按以下优先级应用配置：命令行参数 > 环境变量 > 配置文件 > 默认值
11. THE Router_System SHALL 在启动时显示实际使用的配置值和来源
12. THE Router_System SHALL 提供命令行参数 --dry-run 用于模拟启动过程而不实际启动服务
13. WHERE Server 模式，THE Router_System SHALL 在启动时显示监听地址和端口（如 "Listening on http://0.0.0.0:3000"）

## 正确性属性映射

本需求文档中的验收标准对应于设计文档中定义的 49 个正确性属性。这些属性将使用基于属性的测试（使用 fast-check 库）进行验证，以确保系统在所有有效输入下的正确行为。

关键属性包括：
- 往返一致性（服务注册、配置、JSON-RPC 消息）
- 完整性保证（服务列表、工具发现）
- 状态持久化（工具状态、配置）
- 错误处理（格式、传播、恢复）
- 资源管理（连接池、批量限制）
- 并发安全性（无竞态条件、原子操作）

每个正确性属性都将实现为基于属性的测试，运行至少 100 次迭代，使用随机生成的输入来验证系统行为。

