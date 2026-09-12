# OneMCP AI Agent Guide（单一规范源）

本文件是所有 AI Agent 在本仓库工作的**唯一规范来源**，
由「架构与设计模式」「命令与验证」「编码约定」三部分组成。请勿在其他文件中重复维护规范内容。

---

## Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Clean dist/ + build with tsup（保证产物不含历史残留） |
| `npm run dev` | Watch mode |
| `npm test` | Run all tests（unit + property） |
| `npm run test:watch` | Watch mode tests |
| `npm run test:coverage` | Coverage report (thresholds: 80% lines/fn/stmt, 75% branches) |
| `npm run test:property` | Property-based tests (fast-check) |
| `npm run deploy:local` | 编译 → npm 打包真实 tarball → 全局安装（完整替代旧 onemcp 命令）→ 重启 daemon（launchd 守护时自动走 `launchctl kickstart`）→ 就绪冒烟 |
| `npm run verify:local` | 端到端回归：重新编译安装后，以独立实例（随机端口）跑全部场景 case（N*/F*） |
| `npm run verify:tui` | TUI 端到端回归：tmux 驱动真实终端跑交互场景（T*），不动 daemon/用户配置 |
| `npm run lint` / `lint:fix` | ESLint |
| `npm run format` / `format:check` | Prettier |
| `npm run typecheck` | TypeScript check only |
| `npx vitest run <file>` | Single test file |
| `npx vitest run -t "<name>"` | Single test by name |

> **本机注记（daemon 守护方式）**：:5625 由 launchd 守护 `site.iskill.onemcp`
> （plist `~/Library/LaunchAgents/site.iskill.onemcp.plist`，`RunAtLoad` + `KeepAlive`）直接运行**全局安装的 `onemcp`**，
> 因此 `deploy:local` 装的本地构建只要重启守护即可生效（脚本会自动检测并用 `launchctl kickstart -k` 重启）。
> 这类守护进程**不写** `~/.onemcp/server.pid`，手动切版用
> `launchctl kickstart -k gui/$(id -u)/site.iskill.onemcp`；plist 备份见同目录 `*.bak-*`。

---

## E2E 场景回归规则（必须遵守）

端到端场景统一维护在 **`scripts/e2e-local.mjs`**（正常场景 `N*` + 故障恢复场景 `F*`）。
该脚本自包含"编译 → npm pack → 全局真实安装（tarball + 安装形态校验）"，随后以随机端口 +
独立临时配置的独立实例运行全部场景，不影响 :5625 正在运行的 daemon。

### 规则

1. **新增功能或修复缺陷时，必须同步在 `scripts/e2e-local.mjs` 增加/更新对应场景 case**：
   修复类问题放入 `F*`（故障恢复），新功能/正常操作放入 `N*`（正常场景），编号顺延。
   确保每个问题都能在端到端层面复现与验证，迭代过程始终可用全局 case 回归。
2. **每次修改代码后的标准验证链**（全绿才算完成）：
   `npm test` → `npm run build && npm run verify:tui`（改动涉及 TUI 时）→
   `npm run deploy:local` → `npm run verify:local`
   - CI（`.github/workflows/ci.yml`）跑 `lint` / `typecheck` / `build` / 单测 / 集成测试 / coverage
     以及 **TUI E2E**（tui-e2e 任务，`verify:tui`）；
     `verify:local` 需要全局安装，仍是本地门禁，CI 不跑。
   - 驱动脚本会为 tmux 会话**剥掉 `CI` / `CONTINUOUS_INTEGRATION` / `CI_*`**（`withoutCiMarkers`）：
     Ink 用 `is-in-ci` 判断 CI 环境，命中时只在**退出时**绘制最后一帧，驱动会全程看到空屏
     （这是排查「CI 里 TUI 未就绪」类问题的第一嫌疑人，而不是应用代码）。
3. **场景编写约定**：
   - 随机空闲端口 + `mkdtemp` 独立临时配置，绝不触碰 :5625 运行实例
   - mock 后端自带请求级日志与 `/__stats`、`/__expire`（HTTP 过期触发）控制端点；
     stdio 崩溃用 fixture 的 `ONEMCP_FIXTURE_EXIT_AFTER_CALLS` 确定性触发
   - 断言用相对式（如 `expiredErrors >= 1`），不依赖连接预热/启动时序的精确计数
   - 恢复类场景需用日志特征确认走了恢复路径
     （后端 `Recoverable connection failure ...`、前端 `Client session ... recreating transparently`）
   - 每条断言独立报告（✓/✗ 汇总），失败时转储实例 stderr，退出码供 CI 使用
4. **文档同步**：新增/调整场景后，同步更新 README「本地部署与端到端验证」小节的场景清单。

### 当前场景清单（以 scripts/e2e-local.mjs 为准）

- **N1** HTTP 正常链路与连接复用（零过期零重建，后端请求计数精确匹配）
- **N2** stdio 正常链路（spawn → initialize → tools/call）
- **N3** SSE 正常链路（legacy 两阶段握手）
- **N4** 标签过滤（X-MCP-Tags 在会话创建时解析，需带标签头 initialize）
- **N5** ping + DELETE 会话终止 + 终止后句柄透明重建
- **N6** /health 与 /diagnostics 端点
- **F1** HTTP 后端会话过期（jymcp 型 -32001，经 /__expire 触发）→ 透明重建
- **F2** HTTP 后端规范型会话过期（HTTP 404）→ 透明重建
- **F3** stdio 后端进程崩溃 → 自动 respawn 重放
- **F4** 前端客户端会话句柄失效 → 重启实例后旧 Mcp-Session-Id 透明重建
- TUI：交互式界面需 PTY，由 **`scripts/tui-e2e.mjs`**（`npm run verify:tui`）覆盖，
  见下「TUI 场景回归规则」；组件级行为另有 `tests/integration/tui-*.test.ts`

---

## TUI 场景回归规则（必须遵守）

TUI 交互场景统一维护在 **`scripts/tui-e2e.mjs`**（`npm run verify:tui`），用 tmux 充当真实终端：
私有 socket 建会话、`send-keys` 驱动按键、`capture-pane` 读屏。**必须用真实终端驱动**——
自研 ANSI 仿真在帧高溢出等场景下的滚动语义与真实终端不一致，会产生假象。

### 规则

1. **改动 TUI 行为（按键、布局、渲染）时，必须同步在 `scripts/tui-e2e.mjs` 增加/更新 T* 场景**，
   编号顺延；纯组件逻辑另加 `tests/integration/tui-*.test.ts`。
2. **隔离是硬性要求**：
   - tmux 私有 socket（`-L onemcp-tui-e2e`），不触碰用户默认 tmux server
   - 每场景 `mkdtemp` 独立配置目录，绝不读写 `~/.onemcp`；配置由 `onemcp --init` 生成后打补丁
     （不要手写配置模板：schema 新增必填字段时会静默失效，应用会因校验失败直接退出）
   - 不绑定端口，与运行中的 daemon 无关
3. **断言要锁行为而不是锁像素**：相对式判断（如「每个服务恰好占一行」「无 `-http://` 游离字符」
   「确认前服务数不变」），失败时转储当前画面。退出码：0 通过 / 1 断言失败 / 2 环境不具备（未装 tmux，
   需显式 `--allow-skip` 才会按通过处理）——「跳过」不允许伪装成「通过」。
4. **文档同步**：新增/调整场景后同步更新 README「本地部署与端到端验证」的 TUI 场景清单。

### 当前 TUI 场景清单（以 scripts/tui-e2e.mjs 为准）

- **T1** 列表一屏渲染（16 服务 @34 行 / @50 行）：每服务恰好一行、无续行、无游离字符、不超帧高
- **T2** 窄终端降级（60 列）：丢弃 tags 列、端点省略号截断、仍每服务一行
- **T3** 删除二次确认：`d` 弹确认 → `n` 取消（配置未变）→ `d`+`y` 才删除并落盘
- **T4** 重名覆盖确认：同名保存弹确认，`n` 取消且原 tags 完好（不静默覆盖）
- **T5** Ctrl+S 不污染：空 Command 连按 3 次 → 字段无 `s`、有错误提示、零落库
- **T6** Ctrl+C 退出：有服务配置时进程也能真正结束
- **T7** 参数粘贴并运行：整块粘贴（一次多字符输入）生效并运行成功
- **T8** 工具视图：工具清单（精确计数）+ 搜索框粘贴过滤
- **T9** 结果区操作：Ctrl+P 原始输出 / `v` 选行 + Ctrl+Y 复制选区 / `f` 全宽
- **T10** 结果分页：大输出下 PageDown/PageUp 改变可见行区间
- **T11** CJK：中文标签在列表里每服务一行；中文参数值运行后原样回显
- **T12** 配置路径与自身写盘提示：footer 显示真实 configDir；保存后提示是成功而非「外部变更」
- **T13** 结果存档：Ctrl+O 生成临时文件、给出路径并复制完整路径
- **T14** 长描述滚动：Ctrl+E 展开后 ↑/↓ 逐行滚动描述（不再切换工具），滚到尽头后继续 ↓ 才切换到下一个工具

---

## Architecture Overview

**OneMCP** is a unified routing layer that aggregates multiple MCP (Model Context Protocol) servers. It handles service discovery, tool routing, connection pooling, and flexible configuration management.

### Core Layers (Bottom to Top)

1. **Storage Layer** (`src/storage/`) — `FileStorageAdapter`, `MemoryStorageAdapter`; persists configuration and runtime state
2. **Config Layer** (`src/config/`) — `FileConfigProvider`: loads/validates/watches config files
3. **Service Registry** (`src/registry/`) — registers services, discovers tools, tag-based filtering
4. **Connection Pool** (`src/pool/`) — connection lifecycle, idle timeouts, health checks; spawns stdio servers
5. **Protocol Layer** (`src/protocol/`) — JSON-RPC 2.0 parsing/serialization, MCP handler, smart discovery
6. **Transport Layer** (`src/transport/`) — `StdioTransport` (CLI mode), `HttpTransport` (Streamable HTTP / SSE client)
7. **Routing Layer** (`src/routing/`) — tool routing, namespacing, tool states, discovery cache, `session-error.ts` error classification

### Application Entry Points

- **CLI Mode** (`src/cli-mode.ts`): stdio communication for use as an MCP server
- **Server Mode** (`src/server-mode.ts`): HTTP server (Streamable HTTP) for remote clients, client session handles
- **TUI Mode** (`src/tui.ts` + `src/tui/`): interactive React/Ink config management
- **Daemon Mode** (`src/daemon/`): background server management (start/stop/logs/status)

### Key Cross-Cutting Concerns

- **Logging** (`src/logging/`): Pino-based with masking; audit logger
- **Health Monitoring** (`src/health/`): service health tracking
- **Session Management** (`src/session/`): client session lifecycle (server mode)
- **Metrics** (`src/metrics/`): metrics collection and reporting

## Important Design Patterns

**Tool Namespacing**: Tools are exposed as `{serviceName}__{toolName}` (double underscore, `NamespaceManager.DELIMITER`) to avoid collisions between services.

**Smart Tool Discovery**: By default, `tools/list` returns only a search tool (`search_tools`). Clients search for tools on-demand rather than receiving the full list upfront. Disable with `--no-smart-discovery`.

**Tag Filtering**: Services can have tags (e.g., "production", "api"). Clients filter which services to load via CLI `--tag` or HTTP `X-MCP-Tags` header (parsed at session creation).

**Connection Pooling**: Each service gets its own pool with configurable max connections, idle timeout, and connection timeout. Prevents resource exhaustion and improves performance through connection reuse.

**Backend Session-Expiry Recovery**: Backends may expire idle sessions and report it as a JSON-RPC `-32001` error (HTTP 200) or a spec-conformant HTTP 404 — signals invisible to the transport layer. `src/routing/session-error.ts` classifies such errors (plus dead-but-reconnectable transport failures like stdio process exit / SSE drop / ended receive streams). Both the discovery path (`queryServiceTools`) and `callTool` run a bounded retry loop (`maxConnections + 1` attempts): invalidate the stale connection via `markConnectionFailed`, acquire a fresh one and replay the request transparently. Timeouts and network-unreachable errors fail fast on purpose (retrying would double latency or repeat side effects).

**Client Session Handles** (server mode): A client's `Mcp-Session-Id` is a handle, not a living resource. If a request presents an unknown/evicted id, the session is transparently recreated under the same id (`createSessionFromRequest` in `src/server-mode.ts`) so clients that don't re-initialize keep working; an `initialize` on a stale handle starts fresh per spec. Idle sessions are garbage-collected after 30 min and the map is capped (oldest-idle eviction).

**Discovery Cache Reuse**: `findTool` serves tool lookups from the per-service discovery cache (60s TTL, same cache as `discoverTools`); misses fall back to a live backend query. Cache invalidation hooks: service register/unregister, health events, `setToolState`, config hot-reload.

**Configuration Hot-Reload**: Config file changes are detected and services are reloaded without restarting the entire system.

## Configuration Structure

Config files live in `~/.onemcp/` (or custom `--config-dir`):

- `config.json`: Main system config with mode, port, logging, health checks, audit settings
- `mcpServers`: Map of service name → service config (command, args, env, connection pool settings, tags)
- `toolStates`: Map of tool name → enabled/disabled state

See README.md for example configurations.

## Common Development Scenarios

**Adding a new transport protocol**: Extend `BaseTransport` in `src/transport/` and integrate into routing layer.

**Adding a new config provider**: Implement `IConfigProvider` interface in `src/config/`.

**Debugging service connections**: Set `logLevel: 'INFO'` or `DEBUG` in config. Recovery actions log WARN lines: `Recoverable connection failure (tools/list|tools/call ...), invalidating connection ... and retrying` (backend side) and `Client session ... recreating transparently` (front side).

**Troubleshooting tool routing**: Namespace parsing happens in `src/routing/`. Check that tool names follow `{serviceName}__{toolName}` format (double underscore).

---

## Constraints (Hard Rules)

These are enforced by ESLint and will cause CI failure if violated:

- **NO `any`** — use proper types; `@typescript-eslint/no-explicit-any: error`
- **NO `!`** — no non-null assertions; use explicit null checks or optional chaining
- **NO `console.log/warn/error`** — use `process.stdout.write()` / `process.stderr.write()`; only `console.log` in CLI help/version output with `// eslint-disable-next-line no-console`
- **Always handle promises** — `await` or `void`; floating promises are errors
- **No implicit `any`** — all parameters and return types must be inferrable or explicit
- **No `!` index access** — `noUncheckedIndexedAccess` is enabled; check array/map access results

---

## TypeScript

- Target: ES2022, Module: ESNext (ESM), strict mode enabled
- `exactOptionalPropertyTypes` enabled — don't assign `undefined` to optional fields explicitly
- Use `readonly` for fields that don't change after construction
- Use `type` keyword for type-only imports: `import type { Foo } from './foo.js'`
- Explicit return types required on all public methods
- Use type inference only when the type is obvious from the right-hand side

---

## Naming

| Element | Convention | Example |
|---------|------------|---------|
| Classes / Interfaces / Types | PascalCase | `ToolRouter`, `ServiceDefinition` |
| Functions / Variables | camelCase | `discoverTools`, `toolCache` |
| Constants | UPPER_SNAKE_CASE | `DEFAULT_TIMEOUT_MS`, `MAX_RETRIES` |
| Private members | `private` keyword (or `_` prefix) | `private readonly _cache` |
| Files | kebab-case | `tool-router.ts`, `connection-pool.ts` |

---

## Imports

- Relative imports must use explicit `.js` extensions (ESM requirement)
- Group order: external packages → internal modules → types
- Use `import type` for type-only imports

```typescript
import Ajv from 'ajv';
import { ToolRouter } from './tool-router.js';
import type { ServiceDefinition } from '../types/service.js';
```

---

## Error Handling

- Always use `instanceof Error` guard before accessing `.message`
- Use `??` for defaults, `?.` for safe access — never `!`
- Use `void` for fire-and-forget promise calls
- Wrap errors with context (correlationId, requestId, sessionId) via `ErrorBuilder`

```typescript
try {
  return await configProvider.load();
} catch (error) {
  process.stderr.write(`Failed: ${error instanceof Error ? error.message : String(error)}\n`);
  return null;
}

process.on('SIGINT', () => void shutdown('SIGINT'));
```

---

## Class Structure

```typescript
export class MyService extends EventEmitter {
  private readonly cache: Map<string, Item> = new Map();

  constructor(
    private readonly registry: ServiceRegistry,
    private readonly monitor: HealthMonitor
  ) {
    super();
  }

  /** Brief description of what this method does. */
  public async doWork(input: string): Promise<Result> {
    // implementation
  }

  private handleError(error: Error): void {
    this.emit('error', error);
  }
}
```

---

## JSDoc

Add JSDoc to all public methods. Keep it brief — describe *what* and *why*, not *how*.

```typescript
/**
 * Resolves config directory using priority:
 * 1. CLI arg (--config-dir)
 * 2. Env var (ONEMCP_CONFIG_DIR)
 * 3. Default (~/.onemcp)
 */
function resolveConfigDir(args: CliArgs): string {}
```

---

## Project Structure

```
src/
├── cli.ts / tui.ts / index.ts   # Entry points
├── cli-mode.ts / server-mode.ts # Mode runners
├── config/     # Config providers (FileConfigProvider)
├── errors/     # ErrorBuilder, recovery, timeout handler
├── health/     # HealthMonitor
├── logging/    # Pino logger, audit logger, data masker
├── metrics/    # Metrics collector and service
├── namespace/  # NamespaceManager (__-separated tool names)
├── pool/       # ConnectionPool
├── protocol/   # JSON-RPC parser, serializer, MCP handler
├── registry/   # ServiceRegistry
├── routing/    # ToolRouter, session-error.ts (error classification)
├── session/    # Client session management (server mode)
├── storage/    # File / memory adapters
├── transport/  # stdio, HTTP transports
├── tui/        # Ink/React TUI components
├── types/      # All TypeScript types (re-exported from index.ts)
└── utils/      # Shared utilities
scripts/
├── deploy-local.mjs          # npm run deploy:local
├── e2e-local.mjs             # npm run verify:local（E2E 场景 case 维护在此）
├── tui-e2e.mjs               # npm run verify:tui（TUI 场景 case 维护在此，tmux 驱动）
└── lib/install-local.mjs     # 共享"编译→打包→安装"管道
```

---

## Testing

- Unit tests: `tests/unit/<module>/<feature>.test.ts` (mirrors src structure)
- Property tests: `tests/property/<feature>.property.test.ts` using fast-check
- Integration tests: `tests/integration/`（真实 HTTP/stdio mock 后端）
- E2E scenarios: `scripts/e2e-local.mjs`（见「E2E 场景回归规则」）
- Use factory helpers (`createTestService()`, `createMockConfigProvider()`) — don't repeat setup inline
- Mock with `vi.fn()` — avoid real I/O in unit tests
- Property tests must include arbitraries for each type; test invariants not just happy paths
- Coverage thresholds enforced: 80% lines/functions/statements, 75% branches

Run tests early and often during development. Property tests are especially valuable for complex logic like routing and connection pooling.

---

## Notes

- **stdout vs stderr**: In CLI mode, stdout is reserved for MCP JSON-RPC only. All informational output goes to stderr. This is critical—do not mix them.
- **Process Management**: The system handles graceful shutdown with signal handlers (SIGINT, SIGTERM). Cleanup is in `cli-mode.ts` and `server-mode.ts`.
- **Node Version**: Requires Node.js >= 18.0.0 (for native ESM and modern APIs).
