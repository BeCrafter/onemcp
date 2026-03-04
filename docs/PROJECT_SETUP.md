# Project Setup Documentation

This document describes the project infrastructure and setup for the MCP Router System.

## Technology Stack

### Core Technologies
- **Runtime**: Node.js 18+
- **Language**: TypeScript 5.3+
- **Package Manager**: npm (also supports yarn/pnpm)
- **Build Tool**: tsup (fast TypeScript bundler)

### Development Tools
- **Linting**: ESLint with TypeScript support
- **Formatting**: Prettier
- **Testing**: Vitest
- **Property Testing**: fast-check
- **Type Checking**: TypeScript compiler

## Project Structure

```
onemcp/
├── src/                          # Source code
│   ├── index.ts                 # Main library entry point
│   ├── cli.ts                   # CLI entry point
│   └── tui.ts                   # TUI entry point
├── tests/                       # Test files
│   ├── unit/                    # Unit tests
│   ├── property/                # Property-based tests
│   ├── integration/             # Integration tests
│   └── e2e/                     # End-to-end tests
├── docs/                        # Documentation
├── dist/                        # Build output (generated)
├── package.json                 # Package configuration
├── tsconfig.json                # TypeScript configuration
├── tsup.config.ts               # Build configuration
├── vitest.config.ts             # Test configuration
├── .eslintrc.json               # ESLint configuration
├── .prettierrc.json             # Prettier configuration
└── README.md                    # Project documentation
```

## Configuration Files

### package.json
Defines project metadata, dependencies, and npm scripts.

Key dependencies:
- `@modelcontextprotocol/sdk`: MCP protocol SDK
- `fastify`: HTTP server for Server mode
- `ink`: React-based TUI framework
- `pino`: High-performance logging
- `ajv`: JSON schema validation
- `execa`: Process execution
- `p-queue`: Async queue management

### tsconfig.json
TypeScript compiler configuration with strict type checking enabled:
- Target: ES2022
- Module: ESNext
- Strict mode enabled
- All strict type checking options enabled

### tsup.config.ts
Build configuration for tsup:
- Entry points: index.ts, cli.ts, tui.ts
- Output format: ESM
- Generates TypeScript declarations
- Source maps enabled

### vitest.config.ts
Test framework configuration:
- Test environment: Node.js
- Coverage provider: v8
- Coverage targets: 80% lines, 80% functions, 75% branches
- Test timeout: 10 seconds

### .eslintrc.json
Linting configuration:
- TypeScript ESLint parser
- Recommended TypeScript rules
- Prettier integration
- Custom rules for code quality

### .prettierrc.json
Code formatting configuration:
- Single quotes
- Semicolons
- 100 character line width
- 2 space indentation

## Available Scripts

### Development
- `npm run dev`: Watch mode with auto-rebuild
- `npm run build`: Build for production
- `npm run clean`: Remove build artifacts

### Testing
- `npm test`: Run all tests once
- `npm run test:watch`: Run tests in watch mode
- `npm run test:coverage`: Run tests with coverage report
- `npm run test:property`: Run only property-based tests

### Code Quality
- `npm run lint`: Check code for linting errors
- `npm run lint:fix`: Auto-fix linting errors
- `npm run format`: Format code with Prettier
- `npm run format:check`: Check code formatting
- `npm run typecheck`: Type check without emitting files

## Development Workflow

1. **Initial Setup**
   ```bash
   npm install
   ```

2. **Development**
   ```bash
   npm run dev
   ```
   This starts the build in watch mode, automatically rebuilding on file changes.

3. **Testing**
   ```bash
   npm run test:watch
   ```
   Run tests in watch mode during development.

4. **Before Committing**
   ```bash
   npm run lint
   npm run format
   npm run typecheck
   npm test
   ```
   Ensure all checks pass before committing.

5. **Building**
   ```bash
   npm run build
   ```
   Creates production build in `dist/` directory.

## Testing Strategy

The project uses a dual testing approach:

### Unit Tests
- Located in `tests/unit/`
- Test specific functionality and edge cases
- Use Vitest framework
- Example: `tests/unit/setup.test.ts`

### Property-Based Tests
- Located in `tests/property/`
- Test universal properties across many inputs
- Use fast-check library
- Run 100+ iterations per property
- Example: `tests/property/setup.property.test.ts`

### Integration Tests
- Located in `tests/integration/`
- Test complete workflows and component interactions

### End-to-End Tests
- Located in `tests/e2e/`
- Test full system behavior

## Code Quality Standards

### TypeScript
- Strict mode enabled
- No implicit any
- No unused variables or parameters
- Explicit return types for public APIs

### Linting
- ESLint with TypeScript support
- Prettier for consistent formatting
- No console statements (except in CLI entry points)

### Testing
- Minimum 80% code coverage
- All new features must have tests
- Property tests for correctness properties
- Unit tests for specific cases

## Environment Variables

See `.env.example` for available environment variables:
- `ONEMCP_CONFIG_DIR`: Configuration directory location
- `LOG_LEVEL`: Logging level (DEBUG, INFO, WARN, ERROR)
- `PORT`: Server mode port (default: 3000)
- `NODE_ENV`: Node environment (development, production, test)

## Next Steps

After project setup, the implementation will proceed according to the tasks defined in `.kiro/specs/onemcp-router-system/tasks.md`:

1. Implement core data models and types
2. Implement Transport Layer
3. Implement Protocol Layer
4. Implement Storage Layer
5. And so on...

Each task builds on previous tasks, with checkpoints to ensure incremental validation.
