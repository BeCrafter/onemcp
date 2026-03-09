# OneMCP Developer Guide

## Build, Test, and Lint Commands

### Core Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Build the project using tsup |
| `npm run dev` | Watch mode for development |
| `npm run clean` | Remove dist directory |

### Testing

| Command | Description |
|---------|-------------|
| `npm test` | Run all tests (vitest --run) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run test:property` | Run property-based tests using fast-check |

**Running a single test file:**
```bash
npx vitest run tests/unit/config/file-provider.test.ts
```

**Running a single test:**
```bash
npx vitest run -t "should load config"
```

### Linting and Formatting

| Command | Description |
|---------|-------------|
| `npm run lint` | Run ESLint on src and tests |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm run format` | Format code with Prettier |
| `npm run format:check` | Check formatting without fixing |
| `npm run typecheck` | TypeScript type checking only |

---

## Code Style Guidelines

### TypeScript Configuration

The project uses strict TypeScript with these key settings:
- **Target**: ES2022
- **Module**: ESNext (ESM)
- **Strict mode**: Enabled
- **`noImplicitAny`**: Error (no implicit any allowed)
- **`noNonNullAssertion`**: Error (forbidden `!` operator)
- **`noUncheckedIndexedAccess`**: Enabled

### Imports and Exports

```typescript
// Use explicit .js extensions for relative imports
import { Tool } from '../types/tool.js';
import type { ServiceDefinition } from '../types/service.js';

// Group imports: external → internal → types
import Ajv from 'ajv';
import { EventEmitter } from 'events';
import type { Tool } from '../types/tool.js';
import { ErrorCode } from '../types/jsonrpc.js';
import { ToolRouter } from './tool-router.js';

// Export types separately when needed
export type { Session, SessionContext } from './session/index.js';
export { CliModeRunner } from './cli-mode.js';
```

### Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Classes | PascalCase | `ToolRouter`, `ConnectionPool` |
| Interfaces | PascalCase | `ToolCacheEntry`, `RequestContext` |
| Types | PascalCase | `TagFilter`, `ServiceDefinition` |
| Functions | camelCase | `parseCliArgs`, `displayHelp` |
| Variables | camelCase | `toolCache`, `connectionPools` |
| Constants | UPPER_SNAKE_CASE | `DEFAULT_TIMEOUT`, `MAX_RETRIES` |
| Private members | Prefix with `_` or use `private` | `private readonly _toolCache` |
| File names | kebab-case | `tool-router.ts`, `connection-pool.ts` |

### Error Handling

```typescript
// Use proper error handling with type guards
try {
  const result = await configProvider.load();
  return result;
} catch (error) {
  process.stderr.write(
    `Failed to load config: ${error instanceof Error ? error.message : String(error)}\n`
  );
  return null;
}

// Use void for fire-and-forget promises
process.on('SIGINT', () => void shutdown('SIGINT'));

// Use nullish coalescing for optional values
const port = config.port ?? 3000;

// Check for null/undefined explicitly instead of non-null assertion
if (service.command !== undefined && service.command !== null) {
  // Use service.command here
}
```

### ESLint Rules (Enforced)

- **`@typescript-eslint/no-explicit-any`**: Error - Never use `any`, use proper types
- **`@typescript-eslint/no-non-null-assertion`**: Error - Never use `!` operator, check for null/undefined
- **`@typescript-eslint/no-floating-promises`**: Error - Always await or use void for promises
- **`@typescript-eslint/await-thenable`**: Error - Don't await non-Promise values
- **`no-console`**: Warn - Use `process.stdout.write()` or `process.stderr.write()` instead

### Console Usage

```typescript
// OK: Help/version output (with eslint-disable)
function displayHelp(): void {
  // eslint-disable-next-line no-console
  console.log(`Usage: onemcp [OPTIONS]`);
}

// OK: stderr for errors
process.stderr.write(`Error: ${message}\n`);

// OK: stdout for status messages
process.stdout.write(`Loading configuration...\n`);

// NOT OK: console.log for status messages
// Use process.stdout.write instead
```

### Type Annotations

```typescript
// Explicit return types for public methods
public async load(): Promise<SystemConfig | null> { }

// Private fields in constructor
constructor(
  private readonly serviceRegistry: ServiceRegistry,
  private readonly namespaceManager: NamespaceManager
) { }

// Use readonly for immutable fields
private readonly toolCache: ToolCacheEntry | null = null;

// Use type inference when obvious
const toolCache = new Map<string, Tool[]>(); // Infer Map<string, Tool[]>
```

### Class Structure

```typescript
/**
 * Class description
 */
export class ToolRouter extends EventEmitter {
  // Private fields
  private toolCache: ToolCacheEntry | null = null;
  private connectionPools: Map<string, ConnectionPool> = new Map();

  constructor(
    private readonly serviceRegistry: ServiceRegistry,
    private readonly namespaceManager: NamespaceManager,
    private readonly healthMonitor: HealthMonitor
  ) {
    super();
    // Setup code
  }

  /**
   * Method description
   * @param paramName - Parameter description
   */
  public async discoverTools(tagFilter?: TagFilter): Promise<Tool[]> {
    // Implementation
  }

  private handleError(error: Error): void {
    this.emit('error', error);
  }
}
```

### JSDoc Comments

```typescript
/**
 * Resolves configuration directory with priority:
 * 1. Command-line argument (--config-dir)
 * 2. Environment variable (ONEMCP_CONFIG_DIR)
 * 3. Default (~/.onemcp)
 */
function resolveConfigDir(args: CliArgs): string { }
```

---

## Project Structure

```
src/
├── cli.ts           # CLI entry point
├── tui.ts           # TUI entry point
├── index.ts         # Library exports
├── cli-mode.ts      # CLI mode runner
├── server-mode.ts   # Server mode runner
├── config/          # Configuration providers
├── health/          # Health monitoring
├── logging/         # Logging (audit, request, logger)
├── metrics/         # Metrics collection
├── namespace/       # Tool namespace management
├── pool/            # Connection pooling
├── protocol/       # JSON-RPC parsing/serialization
├── registry/       # Service registry
├── routing/        # Tool routing
├── session/        # Session management
├── storage/        # Storage adapters
├── transport/      # Transport layer (stdio, http)
├── tui/            # TUI components
└── types/          # TypeScript type definitions
```

---

## Testing Guidelines

Tests are located in `tests/` with the following organization:
- `tests/unit/` - Unit tests
- `tests/integration/` - Integration tests
- `tests/property/` - Property-based tests (fast-check)

Test files should follow naming: `*.test.ts`

---

## Common Patterns

### Null Checks Instead of Non-Null Assertion

```typescript
// BAD
const command = service.command!;

// GOOD
if (service.command !== undefined && service.command !== null) {
  const command = service.command;
  // Use command
}

// Or with optional chaining
const value = config?.port ?? 3000;
```

### Async/Await

```typescript
// BAD: Async function without await
async function getData(): Promise<Data> {
  return fetchData(); // Missing await
}

// GOOD
async function getData(): Promise<Data> {
  return await fetchData();
}

// Or for fire-and-forget
process.on('SIGTERM', () => void shutdown());
```
