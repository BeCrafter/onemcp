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
| `npm run deploy:local` | 编译 → npm 打包真实 tarball → 全局安装（完整替代旧 onemcp 命令）→ 重启 ~/.onemcp daemon → 冒烟 |
| `npm run verify:local` | 端到端回归：重新编译安装后，以独立实例（随机端口）跑全部场景 case |
| `npm run lint` / `lint:fix` | ESLint |
| `npm run format` / `format:check` | Prettier |
| `npm run typecheck` | TypeScript check only |
| `npx vitest run <file>` | Single test file |
| `npx vitest run -t "<name>"` | Single test by name |

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
   `npm test` → `npm run deploy:local` → `npm run verify:local`
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
- TUI：交互式界面需 PTY，不纳入脚本；其恢复逻辑由
  `tests/integration/discovery-worker-session-expiry.test.ts` 覆盖

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
