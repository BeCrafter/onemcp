# OneMCP Dev Rules

## Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Build with tsup |
| `npm run dev` | Watch mode |
| `npm test` | Run all tests |
| `npm run test:watch` | Watch mode tests |
| `npm run test:coverage` | Coverage report (thresholds: 80% lines/fn/stmt, 75% branches) |
| `npm run test:property` | Property-based tests (fast-check) |
| `npm run lint` / `lint:fix` | ESLint |
| `npm run format` / `format:check` | Prettier |
| `npm run typecheck` | TypeScript check only |
| `npx vitest run <file>` | Single test file |
| `npx vitest run -t "<name>"` | Single test by name |

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
├── routing/    # ToolRouter
├── session/    # Session management
├── storage/    # File / memory adapters
├── transport/  # stdio, HTTP transports
├── tui/        # Ink/React TUI components
├── types/      # All TypeScript types (re-exported from index.ts)
└── utils/      # Shared utilities
```

---

## Testing

- Unit tests: `tests/unit/<module>/<feature>.test.ts` (mirrors src structure)
- Property tests: `tests/property/<feature>.property.test.ts` using fast-check
- Integration tests: `tests/integration/`
- Use factory helpers (`createTestService()`, `createMockConfigProvider()`) — don't repeat setup inline
- Mock with `vi.fn()` — avoid real I/O in unit tests
- Property tests must include arbitraries for each type; test invariants not just happy paths
- Coverage thresholds enforced: 80% lines/functions/statements, 75% branches
