# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Commands

```bash
# Development
npm run dev              # Watch mode with auto-rebuild
npm run build           # Build TypeScript to dist/
npm run clean           # Remove dist/ directory

# Testing
npm test                # Run all tests (unit + property)
npm run test:watch     # Watch mode for tests
npm run test:coverage  # Generate coverage report
npm run test:property  # Property-based tests only
npm run test -- <file> # Run specific test file

# Code Quality
npm run lint           # Check code with ESLint
npm run lint:fix       # Auto-fix ESLint issues
npm run format         # Format code with Prettier
npm run format:check   # Check formatting without changing
npm run typecheck      # TypeScript type checking

# Running
npx tsx src/cli.ts --help           # See CLI options
npx tsx src/cli.ts                  # CLI mode (stdio)
npx tsx src/cli.ts --mode server    # Server mode (HTTP)
npx tsx src/cli.ts --mode tui       # TUI mode (interactive)
```

## Architecture Overview

**OneMCP** is a unified routing layer that aggregates multiple MCP (Model Context Protocol) servers. It handles service discovery, tool routing, connection pooling, and flexible configuration management.

### Core Layers (Bottom to Top)

1. **Storage Layer** (`src/storage/`)
   - Adapters: `FileStorageAdapter`, `MemoryStorageAdapter`
   - Persists configuration and runtime state

2. **Config Layer** (`src/config/`)
   - `FileConfigProvider`: Loads/validates/watches config files
   - Validates service definitions and system settings

3. **Service Registry** (`src/registry/`)
   - Registers, tracks, and manages MCP backend services
   - Discovers tools from registered services
   - Tag-based filtering

4. **Connection Pool** (`src/pool/`)
   - Manages connections to backend MCP servers
   - Handles connection lifecycle, idle timeouts, health checks
   - Uses `child_process` to spawn MCP servers

5. **Protocol Layer** (`src/protocol/`)
   - JSON-RPC 2.0 parsing and serialization
   - Message validation and error formatting

6. **Transport Layer** (`src/transport/`)
   - **StdioTransport**: CLI mode (stdin/stdout)
   - **HttpTransport**: Server mode (HTTP/SSE)

7. **Routing Layer** (`src/routing/`)
   - Tool routing and namespace management
   - Tool state management (enabled/disabled)
   - Batch tool invocation
   - Tag filtering

### Application Entry Points

- **CLI Mode** (`src/cli-mode.ts`): Stdio-based communication for use as MCP server
- **Server Mode** (`src/server-mode.ts`): HTTP server for remote clients
- **TUI Mode** (`src/tui.ts` + `src/tui/components/`): Interactive React-based UI for config management
- **Daemon Mode** (`src/daemon/`): Background server management (start/stop/logs/status)

### Key Cross-Cutting Concerns

- **Logging** (`src/logging/`): Pino-based with masking support
- **Health Monitoring** (`src/health/`): Service health tracking and auto-unload
- **Session Management** (`src/session/`): Multi-client session isolation
- **Audit Logging** (`src/logging/audit-logger.ts`): Request/response tracking
- **Metrics** (`src/metrics/`): System metrics collection and reporting

## Important Design Patterns

**Tool Namespacing**: Tools are exposed as `{serviceName}___{toolName}` to avoid collisions between services.

**Smart Tool Discovery**: By default, `tools/list` returns only a search tool (`search_tools`). Clients search for tools on-demand rather than receiving the full list upfront. Disable with `--no-smart-discovery`.

**Tag Filtering**: Services can have tags (e.g., "production", "api"). Clients filter which services to load via CLI `--tag` or HTTP `X-MCP-Tags` header.

**Connection Pooling**: Each service gets its own pool with configurable max connections, idle timeout, and connection timeout. Prevents resource exhaustion and improves performance through connection reuse.

**Configuration Hot-Reload**: Config file changes are detected and services are reloaded without restarting the entire system.

## Testing Strategy

- **Unit Tests** (`tests/unit/`): Test individual components with specific examples
- **Property-Based Tests** (`tests/property/`): Use `fast-check` to verify correctness properties hold across random inputs
- **Integration Tests** (`tests/integration/`): End-to-end tests with mock MCP servers

Run tests early and often during development. Property tests are especially valuable for complex logic like routing and connection pooling.

## Configuration Structure

Config files live in `~/.onemcp/` (or custom `--config-dir`):

- `config.json`: Main system config with mode, port, logging, health checks, audit settings
- `mcpServers`: Map of service name → service config (command, args, env, connection pool settings, tags)
- `toolStates`: Map of tool name → enabled/disabled state

See README.md for example configurations.

## Common Development Scenarios

**Adding a new transport protocol**: Extend `BaseTransport` in `src/transport/` and integrate into routing layer.

**Adding a new config provider**: Implement `IConfigProvider` interface in `src/config/`.

**Debugging service connections**: Set `logLevel: 'DEBUG'` in config. Check `src/pool/connection.ts` and `src/routing/` for detailed logs.

**Troubleshooting tool routing**: Namespace parsing happens in `src/routing/`. Check that tool names follow `{serviceName}___{toolName}` format.

## Notes

- **stdout vs stderr**: In CLI mode, stdout is reserved for MCP JSON-RPC only. All informational output goes to stderr. This is critical—do not mix them.
- **Process Management**: The system handles graceful shutdown with signal handlers (SIGINT, SIGTERM). Cleanup is in `cli-mode.ts` and `server-mode.ts`.
- **Node Version**: Requires Node.js >= 18.0.0 (for native ESM and modern APIs).
