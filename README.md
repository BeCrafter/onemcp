# OneMCP

**智能 MCP 路由系统 - 统一管理多个 MCP 服务器的路由层**

[License: MIT](https://opensource.org/licenses/MIT)
[Node Version](https://nodejs.org)
[TypeScript](https://www.typescriptlang.org/)


## 📖 简介

OneMCP 是一个基于 Node.js 的智能路由中间件，用于聚合和管理多个 MCP (Model Context Protocol) 服务器。它作为 MCP 客户端和后端服务器之间的统一路由层，提供服务发现、工具路由、连接池管理和灵活的配置管理功能。

### ✨ 核心特性

- 🔄 **服务聚合** - 将多个独立的 MCP 服务器统一到单一接口
- 🏷️ **工具命名空间** - 通过 `{serviceName}__{toolName}` 格式避免工具名称冲突
- 🔌 **连接池管理** - 优化资源使用，通过连接复用提高性能
- 🚀 **灵活部署** - 支持 CLI (stdio)、Server (HTTP) 两种模式，Server 模式支持后台 daemon 运行
- 🌐 **多协议支持** - 支持 stdio、SSE 和 Streamable HTTP 三种传输协议
- 👥 **多会话隔离** - 支持多个 AI Agent 并发连接，确保会话间完全隔离
- 💚 **健康监控** - 自动检测服务健康状态，实现工具的自动加载/卸载
- 🎨 **交互式 TUI** - 提供友好的终端界面进行配置管理
- 🔧 **可扩展架构** - 支持自定义配置提供者和存储适配器
- 📊 **审计日志** - 详细记录所有请求和操作，便于追踪和调试
- 🏷️ **标签过滤** - 根据标签筛选服务和工具，支持每个客户端连接独立设置
- 🔍 **智能工具发现** - 默认只暴露搜索工具，AI Agent 按需搜索，支持每个连接动态控制
- 📦 **批量操作** - 在单个请求中执行多个工具调用
- 💻 **编程 API** - 作为 NPM 包使用，完整的 TypeScript 支持

## 🚀 快速开始

### 安装

```bash
# 全局安装
npm install -g onemcp

# 或作为项目依赖
npm install onemcp
```

### 开发模式（本地运行）

如果你是从源码运行，需要先构建项目：

```bash
# 克隆仓库
git clone https://github.com/BeCrafter/onemcp.git
cd onemcp

# 安装依赖
npm install

# 构建项目
npm run build
```

### 初始化配置

首次使用前，需要初始化配置目录：

```bash
# 初始化默认配置目录 ~/.onemcp
onemcp --init
# 或使用 npx
npx onemcp --init

# 或指定自定义配置目录
onemcp --init --config-dir /path/to/config
# 或使用 npx
npx onemcp --init --config-dir /path/to/config
```

### CLI 模式（通过 stdio 通信）

```bash
# 默认使用 CLI 模式
onemcp

# 或使用 npx 直接运行（无需安装）
npx onemcp

# 使用自定义配置目录
onemcp --config-dir ~/.onemcp
```

### Server 模式（通过 HTTP 通信）

```bash
# 启动 HTTP 服务器，监听 0.0.0.0:3000
onemcp --mode server --port 3000

# 或使用 npx 直接运行（无需安装）
npx onemcp --mode server --port 3000

# 使用环境变量
ONEMCP_MODE=server ONEMCP_PORT=8080 onemcp

# 后台运行（daemon 模式）
onemcp --mode server --port 3000 --daemon
# 简写
onemcp -m server -p 3000 -d

# 关闭后台服务
onemcp server stop

# 查看后台服务状态
onemcp server status

# 查看后台服务日志
onemcp server logs

# 重启后台服务
onemcp server restart
```

### Server 后台运行（Daemon 模式）

在 server 模式下使用 `--daemon`（或 `-d`）参数可以将服务进程放到后台运行，避免占用终端。

#### 启动与管理

```bash
# 启动后台服务
onemcp --mode server --port 3000 --daemon

# 查看后台服务状态
onemcp server status

# 查看实时日志（持续追踪，Ctrl+C 退出）
onemcp server logs --follow
# 或简写
onemcp server logs -f

# 查看最近 50 行日志
onemcp server logs --lines 50
# 或简写
onemcp server logs -n 50

# 停止后台服务
onemcp server stop

# 重启后台服务
onemcp server restart
```

#### 说明

- PID 文件保存于 `~/.onemcp/onemcp-server.pid`
- 日志文件保存于 `~/.onemcp/onemcp-server.log`
- 使用 `--config-dir` 可自定义上述文件位置

### TUI 模式（交互式配置管理）

```bash
# 启动交互式配置界面
onemcp --mode tui

# 或使用 npx 直接运行（无需安装）
npx onemcp --mode tui

# 使用自定义配置目录
onemcp --mode tui --config-dir ~/.onemcp
```

### 使用方式说明

**已安装包：**
```bash
onemcp -h                      # 查看帮助
onemcp --version               # 查看版本
onemcp --mode server           # 启动服务器模式
onemcp --mode server --daemon  # 后台运行服务器模式
onemcp server status           # 查看后台服务状态
onemcp server stop             # 停止后台服务
onemcp server logs             # 查看后台服务日志
onemcp --mode tui              # 启动 TUI 模式
```

**无需安装（使用 npx）：**
```bash
npx onemcp -h                      # 查看帮助
npx onemcp --version               # 查看版本
npx onemcp --mode server           # 启动服务器模式
npx onemcp --mode server --daemon  # 后台运行服务器模式
npx onemcp server status           # 查看后台服务状态
npx onemcp server stop             # 停止后台服务
npx onemcp --mode tui              # 启动 TUI 模式
```

**开发模式（从源码运行）：**
```bash
npx tsx src/cli.ts -h                      # 查看帮助
npx tsx src/cli.ts --version               # 查看版本
npx tsx src/cli.ts --mode server           # 启动服务器模式
npx tsx src/cli.ts --mode server --daemon  # 后台运行服务器模式
npx tsx src/cli.ts server status           # 查看后台服务状态
npx tsx src/cli.ts server stop             # 停止后台服务
npx tsx src/cli.ts --mode tui              # 启动 TUI 模式
```

**入口文件说明：**
- `src/cli.ts` - 主入口文件，支持 CLI、Server 和 TUI 三种模式
- `src/tui.ts` - TUI 模式的独立入口（内部使用，不对外输出）

## ✅ 验证和测试

### 验证配置

```bash
# 验证配置文件是否正确
onemcp --validate
# 或使用 npx
npx onemcp --validate

# 模拟启动（不实际启动服务）
onemcp --dry-run
# 或使用 npx
npx onemcp --dry-run
```

### 查看帮助信息

```bash
# 查看帮助
onemcp --help
# 或使用 npx
npx onemcp --help
# 或开发模式
npx tsx src/cli.ts -h

# 查看版本信息
onemcp --version
# 或使用 npx
npx onemcp --version
# 或开发模式
npx tsx src/cli.ts -v
```

## 📋 配置

配置文件位于 `~/.onemcp/config.json`（或通过 `--config-dir` 指定的目录）。

### 配置文件结构

```json
{
  "mode": "cli",
  "port": 3000,
  "logLevel": "INFO",
  "configDir": "~/.onemcp",
  "mcpServers": {
    "filesystem": {
      "transport": "stdio",
      "enabled": true,
      "tags": ["filesystem", "local"],
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      "env": {},
      "connectionPool": {
        "maxConnections": 3,
        "idleTimeout": 60000,
        "connectionTimeout": 30000
      },
      "toolStates": {
        "read_file": true,
        "write_file": false
      }
    },
    "remote-api": {
      "transport": "http",
      "enabled": true,
      "tags": ["remote", "api"],
      "url": "https://api.example.com/mcp",
      "connectionPool": {
        "maxConnections": 5,
        "idleTimeout": 60000,
        "connectionTimeout": 30000
      }
    }
  },
  "connectionPool": {
    "maxConnections": 5,
    "idleTimeout": 60000,
    "connectionTimeout": 30000
  },
  "healthCheck": {
    "enabled": true,
    "interval": 30000,
    "failureThreshold": 3,
    "autoUnload": true
  },
  "audit": {
    "enabled": true,
    "level": "standard",
    "logInput": false,
    "logOutput": false,
    "retention": {
      "days": 30,
      "maxSize": "1GB"
    }
  },
  "security": {
    "dataMasking": {
      "enabled": true,
      "patterns": ["password", "token", "secret", "key"]
    }
  },
  "logging": {
    "level": "INFO",
    "outputs": ["console"],
    "format": "pretty"
  },
  "metrics": {
    "enabled": true,
    "collectionInterval": 60000,
    "retentionPeriod": 86400000
  }
}
```

### 服务配置示例

#### Stdio 传输协议

```json
{
  "mcpServers": {
    "filesystem": {
      "enabled": true,
      "tags": ["local", "storage"],
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      "env": {
        "NODE_ENV": "production"
      },
      "connectionPool": {
        "maxConnections": 5,
        "idleTimeout": 60000,
        "connectionTimeout": 30000
      }
    }
  }
}
```

#### HTTP 传输协议

```json
{
  "mcpServers": {
    "remote-api": {
      "enabled": true,
      "tags": ["remote", "api"],
      "transport": "http",
      "url": "https://api.example.com/mcp",
      "connectionPool": {
        "maxConnections": 5,
        "idleTimeout": 60000,
        "connectionTimeout": 30000
      }
    }
  }
}
```

## 💻 编程式使用

```typescript
import { CliModeRunner, ServerModeRunner } from 'onemcp';
import { FileConfigProvider } from 'onemcp';
import { FileStorageAdapter } from 'onemcp';

// 创建配置提供者
const storage = new FileStorageAdapter('~/.onemcp');
const configProvider = new FileConfigProvider({
  storageAdapter: storage,
  configDir: '~/.onemcp'
});

// 加载配置
const config = await configProvider.load();

// CLI 模式
const cliRunner = new CliModeRunner(config, configProvider);
await cliRunner.start();

// Server 模式
const serverRunner = new ServerModeRunner(config, configProvider);
await serverRunner.start();

// 停止运行器
await cliRunner.stop();
await serverRunner.stop();
```

### 客户端标签过滤 (Client-Side Tag Filtering)

OneMCP 支持**每个客户端连接**指定自己需要的标签过滤。

#### 标签过滤参数

```typescript
interface TagFilter {
  tags: string[];        // 要匹配的标签数组
  logic: 'AND' | 'OR';  // 过滤逻辑：AND（所有标签都必须匹配）或 OR（任一标签匹配即可）
}
```

#### 服务标签行为

- **有标签的服务**: 只有当客户端的标签过滤器匹配时才会暴露
- **无标签的服务**: 始终对所有客户端可用（默认全场景输出）

#### 使用方式

**CLI 模式 (stdio)**: 使用 `--tag` 或 `-t` 命令行参数

```bash
# 过滤具有 production 或 api 标签的服务
onemcp --tag production,api
# 或使用 npx
npx onemcp --tag production,api

# 简写形式
onemcp -t production,database
# 或使用 npx
npx onemcp -t production,database
```

**Server 模式 (HTTP)**: 使用 `X-MCP-Tags` HTTP 头

```bash
# 过滤具有 production 或 api 标签的服务
curl -H "X-MCP-Tags: production,api" http://localhost:3000/mcp \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
```

> **注意**:
>
> - CLI 模式使用 `--tag` 参数，Server 模式使用 HTTP 头
> - 多个标签使用逗号分隔，采用 OR 逻辑（匹配任一标签即可）
> - 此功能适用于**每个独立客户端连接**，不同的客户端可以指定不同的标签过滤器
> - 如果不提供标签过滤，则返回所有服务工具（包括有标签和无标签的服务）

### 智能工具发现（Smart Discovery）

OneMCP 默认启用**智能工具发现**模式：`tools/list` 只返回一个搜索工具（`search_tools`），AI Agent 通过该工具按需搜索所需工具，而不是一次性加载全部工具列表，适合工具数量多的场景。

#### 关闭智能工具发现

**CLI 模式**：使用 `--no-smart-discovery` 参数（直接返回全部工具列表）

```bash
onemcp --no-smart-discovery
# 或使用 npx
npx onemcp --no-smart-discovery
```

**Server 模式**：

- **启动时关闭**（对所有客户端生效）：使用 `--no-smart-discovery` 参数

```bash
onemcp --mode server --port 3000 --no-smart-discovery
```

- **每个客户端连接动态控制**：使用 `X-MCP-Smart-Discovery` HTTP 头（优先级高于启动参数）

```bash
# 当前连接关闭智能发现，直接返回全部工具列表
curl -H "X-MCP-Smart-Discovery: false" http://localhost:3000/mcp \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

# 当前连接开启智能发现
curl -H "X-MCP-Smart-Discovery: true" http://localhost:3000/mcp \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

#### HTTP 头优先级

| 优先级 | 来源 | 说明 |
|--------|------|------|
| 高 | `X-MCP-Smart-Discovery` 头 | 每个客户端连接独立控制 |
| 低 | `--no-smart-discovery` 启动参数 | 服务器默认值 |

> **注意**：
>
> - `X-MCP-Smart-Discovery` 支持值：`true`/`1`/`on` 开启，`false`/`0`/`off` 关闭
> - 不传该头时，使用服务器启动时的默认值（未传 `--no-smart-discovery` 时默认开启）

### HTTP 请求头参考

Server 模式支持以下自定义 HTTP 请求头，用于每个客户端连接的个性化配置：

| 请求头 | 说明 | 示例值 |
|--------|------|--------|
| `X-MCP-Tags` | 按标签过滤服务和工具（逗号分隔，OR 逻辑） | `production,api` |
| `X-MCP-Smart-Discovery` | 控制智能工具发现开关 | `true` / `false` |

### 事件监听

路由器会发出事件用于监控和调试：

```typescript
// 注意：事件系统正在开发中
// 以下是计划中的 API

router.on('service:connected', (serviceName) => {
  console.log(`服务已连接: ${serviceName}`);
});

router.on('service:disconnected', (serviceName) => {
  console.log(`服务已断开: ${serviceName}`);
});

router.on('tool:invoked', (toolName, duration) => {
  console.log(`工具已调用: ${toolName} (${duration}ms)`);
});

router.on('error', (error) => {
  console.error(`错误: ${error.message}`);
});
```

## 🏗️ 架构设计

### 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                        MCP 客户端                            │
│              (Claude Desktop, Cursor IDE 等)                │
└────────────────┬────────────────────────────────────────────┘
                 │
                 │ JSON-RPC 2.0 (stdio/HTTP)
                 │
┌────────────────▼────────────────────────────────────────────┐
│                     OneMCP                           │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              传输层 (Transport Layer)                │  │
│  │  (CLI: stdio | Server: HTTP)                         │  │
│  └────────────────────┬─────────────────────────────────┘  │
│                       │                                     │
│  ┌────────────────────▼─────────────────────────────────┐  │
│  │              协议层 (Protocol Layer)                 │  │
│  │  • JSON-RPC 解析和序列化                             │  │
│  │  • 消息验证                                          │  │
│  └────────────────────┬─────────────────────────────────┘  │
│                       │                                     │
│  ┌────────────────────▼─────────────────────────────────┐  │
│  │              路由层 (Routing Layer)                  │  │
│  │  • 工具路由                                          │  │
│  │  • 命名空间管理                                      │  │
│  │  • 工具缓存                                          │  │
│  └────────────────────┬─────────────────────────────────┘  │
│                       │                                     │
│  ┌────────────────────▼─────────────────────────────────┐  │
│  │              服务层 (Service Layer)                  │  │
│  │  • 服务注册表                                        │  │
│  │  • 连接池管理                                        │  │
│  │  • 健康监控                                          │  │
│  │  • 会话管理                                          │  │
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

### 核心组件

- **传输层** - 处理与客户端的底层通信（stdio/HTTP）
- **协议层** - JSON-RPC 2.0 消息解析、验证和序列化
- **路由层** - 工具路由、命名空间管理和缓存
- **服务层** - 服务注册、连接池、健康监控和会话管理
- **存储层** - 配置持久化和存储适配器

## 🛠️ 开发

### 安装依赖

```bash
npm install
```

### 开发模式（监视模式）

```bash
npm run dev
```

### 构建

```bash
npm run build
```

### 清理构建目录

```bash
npm run clean
```

### 运行测试

```bash
# 运行所有测试
npm test

# 监视模式
npm run test:watch

# 生成覆盖率报告
npm run test:coverage

# 运行基于属性的测试
npm run test:property
```

### 代码检查和格式化

```bash
# 代码检查
npm run lint

# 自动修复 lint 问题
npm run lint:fix

# 代码格式化
npm run format

# 检查代码格式
npm run format:check

# 类型检查
npm run typecheck
```

### 开发工作流

在本地开发时，使用监视模式自动重新构建：

```bash
npm run dev
```

在另一个终端中，可以直接运行路由器：

```bash
# 查看帮助
npx tsx src/cli.ts -h

# CLI 模式
npx tsx src/cli.ts

# Server 模式
npx tsx src/cli.ts --mode server --port 3000

# TUI 模式
npx tsx src/cli.ts --mode tui
```

## 🧪 测试策略

项目采用双重测试策略：

### 单元测试

验证特定示例、边缘情况和集成点：

```bash
npm test
```

### 基于属性的测试

使用 [fast-check](https://github.com/dubzzz/fast-check) 验证系统在所有有效输入下的正确性：

```bash
npm run test:property
```

## 📚 文档

- [需求文档](./docs/requirements.md) - 详细的功能需求和验收标准
- [设计文档](./docs/design.md) - 系统架构和设计决策
- [项目设置](./docs/PROJECT_SETUP.md) - 开发环境设置指南
- [TUI JSON 模式](./docs/TUI_JSON_MODE.md) - TUI 配置界面使用指南
- [健康检查集成](./docs/HEALTH_CHECK_INTEGRATION.md) - 健康监控功能说明
- [任务列表](./docs/tasks.md) - 开发任务和进度跟踪

## 🤝 贡献

欢迎贡献！请查看 [CONTRIBUTING.md](./CONTRIBUTING.md) 了解如何参与项目开发。

### 开发设置

1. Fork 并克隆仓库
2. 安装依赖：`npm install`
3. 创建功能分支：`git checkout -b feature/your-feature-name`
4. 进行更改
5. 运行测试：`npm test`
6. 运行代码检查：`npm run lint`
7. 格式化代码：`npm run format`
8. 提交更改并附上描述性消息
9. 推送到你的 fork 并提交 pull request

## 📄 许可证

本项目采用 [MIT 许可证](./LICENSE)。

## 🙏 致谢

- [Model Context Protocol](https://modelcontextprotocol.io/) - MCP 协议规范
- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/sdk) - MCP 官方 SDK
- [Ink](https://github.com/vadimdemedes/ink) - React 风格的 CLI 界面框架
- [Vitest](https://vitest.dev/) - 快速的单元测试框架
- [fast-check](https://github.com/dubzzz/fast-check) - 基于属性的测试库

## 📮 联系方式

如有问题或建议，请：

- 提交 [Issue](https://github.com/yourusername/onemcp/issues)
- 发起 [Pull Request](https://github.com/yourusername/onemcp/pulls)
- 查看 [讨论区](https://github.com/yourusername/onemcp/discussions)

---



**用 ❤️ 构建，为 MCP 生态系统服务**

