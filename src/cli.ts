#!/usr/bin/env node

/**
 * MCP Router System - CLI Entry Point
 *
 * This is the CLI entry point for running the router in CLI or Server mode.
 * Supports command-line argument parsing for configuration and control.
 */

import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { FileConfigProvider } from './config/file-provider.js';
import { FileStorageAdapter } from './storage/file.js';
import type { SystemConfig, ToolDiscoveryConfig } from './types/config.js';
import type { TagFilter } from './types/tool.js';
import { getPackageVersion } from './utils/package-version.js';
import { silenceStderrForShutdown } from './utils/silence-stderr-shutdown.js';

/**
 * CLI argument definitions
 */
interface CliArgs {
  mode?: 'cli' | 'server' | 'tui' | undefined;
  configDir?: string | undefined;
  port?: string | undefined;
  logLevel?: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | undefined;
  tag?: string | undefined;
  'smart-discovery'?: boolean | undefined;
  help?: boolean | undefined;
  version?: boolean | undefined;
  validate?: boolean | undefined;
  init?: boolean | undefined;
  dryRun?: boolean | undefined;
  daemon?: boolean | undefined;
  lines?: string | undefined;
  follow?: boolean | undefined;
  positionals?: string[];
}

/**
 * Display help message
 */
function displayHelp(): void {
  // eslint-disable-next-line no-console
  console.log(`
MCP Router System - Intelligent routing layer for MCP servers

USAGE:
  onemcp [OPTIONS]

OPTIONS:
  -m, --mode <mode>           Deployment mode: cli, server, or tui (default: cli)
  -c, --config-dir <path>     Configuration directory (default: ~/.onemcp)
  -p, --port <port>           Server port for server mode (default: 3000)
  -l, --log-level <level>    Log level: DEBUG, INFO, WARN, ERROR (default: INFO)
  -t, --tag <tags>            Tag filter for service/tool filtering (comma-separated, OR logic)
  --smart-discovery          Enable smart tool discovery mode (default: enabled)
  -h, --help                  Display this help message
  -v, --version               Display version information
  --validate                  Validate configuration without starting
  --init                      Initialize configuration directory with defaults
  --dry-run                   Simulate startup without actually starting services
  -d, --daemon                Start server in background (server mode only)

SERVER SUBCOMMANDS:
  onemcp server status        Show background server status (PID, port, uptime)
  onemcp server stop          Stop the background server
  onemcp server restart       Restart the background server
  onemcp server logs          Show server logs (default: last 50 lines)
    --lines <n>               Number of log lines to show
    --follow                  Follow log output (like tail -f)

MODES:
  cli                         Stdio-based communication (default)
  server                      HTTP server mode
  tui                         Interactive terminal UI for configuration management

TAG FILTERING:
  -t, --tag                   Filter services by tags (CLI mode only)
                                Multiple tags are separated by commas (OR logic)
                                Example: onemcp --tag production,api
                                Services without tags are always available

SMART TOOL DISCOVERY:
  --smart-discovery            Enable smart tool discovery mode (default: enabled)
                                When enabled, tools/list only returns a search tool
                                Users search for tools instead of seeing all at once
                                Use --no-smart-discovery to disable

HEADER FILTERING (Server mode):
  X-MCP-Tags: "tag1,tag2"           HTTP header to filter services by tags (OR logic)
                                      Example: curl -H "X-MCP-Tags: production,api" http://localhost:3000/mcp
  X-MCP-Smart-Discovery: "true"      HTTP header to control smart tool discovery per connection
                                      Values: true/1/on (enable), false/0/off (disable)
                                      Overrides --no-smart-discovery server default
                                      Example: curl -H "X-MCP-Smart-Discovery: false" http://localhost:3000/mcp

ENVIRONMENT VARIABLES:
  ONEMCP_CONFIG_DIR           Override configuration directory location
  ONEMCP_MODE                Override deployment mode
  ONEMCP_PORT                Override server port
  ONEMCP_LOG_LEVEL           Override log level

EXAMPLES:
  # Start in CLI mode with tag filter
  onemcp --tag production,api

  # Disable smart tool discovery
  onemcp --no-smart-discovery

  # Start in server mode
  onemcp --mode server --port 8080

  # Start server in background (daemon mode)
  onemcp --mode server --daemon
  onemcp --mode server -d

  # Manage background server
  onemcp server status
  onemcp server stop
  onemcp server restart
  onemcp server logs
  onemcp server logs --lines 100
  onemcp server logs --follow

  # Start in server mode with HTTP header tag filter
  onemcp --mode server
  curl -H "X-MCP-Tags: production" http://localhost:3000/mcp -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'

  # Start in TUI mode for interactive configuration
  onemcp --mode tui

  # Use custom configuration directory
  onemcp --config-dir /etc/onemcp

  # Initialize configuration directory
  onemcp --init

  # Validate configuration
  onemcp --validate

  # Dry run to check configuration
  onemcp --dry-run

For more information, visit: https://github.com/BeCrafter/onemcp
`);
}

/**
 * Display version information
 */
function displayVersion(): void {
  // eslint-disable-next-line no-console
  console.log(`MCP Router System v${getPackageVersion()}`);
}

/**
 * Returns process.argv[1] (the script path), or exits with an error if undefined.
 */
function requireExecutablePath(): string {
  const p = process.argv[1];
  if (p === undefined) {
    process.stderr.write('Cannot determine executable path.\n');
    process.exit(1);
  }
  return p;
}

/**
 * Parse command-line arguments
 */
function parseCliArgs(): CliArgs {
  try {
    const { values, positionals } = parseArgs({
      allowNegative: true,
      options: {
        mode: {
          type: 'string',
          short: 'm',
        },
        'config-dir': {
          type: 'string',
          short: 'c',
        },
        port: {
          type: 'string',
          short: 'p',
        },
        'log-level': {
          type: 'string',
          short: 'l',
        },
        tag: {
          type: 'string',
          short: 't',
        },
        'smart-discovery': {
          type: 'boolean',
          negate: true,
        },
        help: {
          type: 'boolean',
          short: 'h',
        },
        version: {
          type: 'boolean',
          short: 'v',
        },
        validate: {
          type: 'boolean',
        },
        init: {
          type: 'boolean',
        },
        'dry-run': {
          type: 'boolean',
        },
        daemon: {
          type: 'boolean',
          short: 'd',
        },
        lines: {
          type: 'string',
        },
        follow: {
          type: 'boolean',
        },
      },
      strict: true,
      allowPositionals: true,
    });

    return {
      mode: values.mode as 'cli' | 'server' | 'tui' | undefined,
      configDir: values['config-dir'],
      port: values.port,
      logLevel: values['log-level'] as 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | undefined,
      tag: values.tag,
      'smart-discovery': values['smart-discovery'],
      help: values.help,
      version: values.version,
      validate: values.validate,
      init: values.init,
      dryRun: values['dry-run'],
      daemon: values.daemon,
      lines: values.lines,
      follow: values.follow,
      positionals,
    };
  } catch (error) {
    process.stderr.write(
      `Error parsing arguments: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.stderr.write('Use --help for usage information\n');
    process.exit(1);
  }
}

/**
 * Resolve configuration directory with priority:
 * 1. Command-line argument (--config-dir)
 * 2. Environment variable (ONEMCP_CONFIG_DIR)
 * 3. Default (~/.onemcp)
 */
function resolveConfigDir(args: CliArgs): string {
  const configDir =
    args.configDir || process.env['ONEMCP_CONFIG_DIR'] || resolve(homedir(), '.onemcp');
  return resolve(configDir);
}

/**
 * Initialize configuration directory with default structure
 */
function initializeConfigDir(configDir: string): void {
  process.stderr.write(`Initializing configuration directory: ${configDir}\n`);

  try {
    // Create directory structure
    mkdirSync(configDir, { recursive: true });

    // Create default config.json
    const defaultConfig: SystemConfig = {
      mode: 'cli',
      logLevel: 'INFO',
      configDir,
      mcpServers: {},
      connectionPool: {
        maxConnections: 5,
        idleTimeout: 60000,
        connectionTimeout: 30000,
      },
      healthCheck: {
        enabled: true,
        interval: 30000,
        failureThreshold: 3,
        autoUnload: true,
      },
      audit: {
        enabled: true,
        level: 'standard',
        logInput: false,
        logOutput: false,
        retention: {
          days: 30,
          maxSize: '1GB',
        },
      },
      security: {
        dataMasking: {
          enabled: true,
          patterns: ['password', 'token', 'secret', 'key', 'apiKey', 'api_key'],
        },
      },
      logging: {
        level: 'INFO',
        outputs: ['console'],
        format: 'pretty',
      },
      metrics: {
        enabled: true,
        collectionInterval: 60000,
        retentionPeriod: 86400000, // 24 hours
      },
    };

    const configPath = resolve(configDir, 'config.json');

    // Only write config.json if it doesn't already exist
    if (!existsSync(configPath)) {
      writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf8');
    }

    process.stderr.write('✓ Configuration directory initialized successfully\n');
    process.stderr.write(`  Config file: ${configPath}\n`);
  } catch (error) {
    process.stderr.write(
      `Failed to initialize configuration directory: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exit(1);
  }
}

/**
 * Validate configuration
 */
async function validateConfiguration(configDir: string): Promise<boolean> {
  process.stderr.write(`Validating configuration in: ${configDir}\n`);

  try {
    const storage = new FileStorageAdapter(configDir);
    const configProvider = new FileConfigProvider({
      storageAdapter: storage,
      configDir,
    });

    // Load configuration
    const config = await configProvider.load();

    // Validate configuration
    const validation = configProvider.validate(config);

    if (validation.valid) {
      process.stderr.write('✓ Configuration is valid\n');
      process.stderr.write(`  Mode: ${config.mode}\n`);
      process.stderr.write(`  Services: ${Object.keys(config.mcpServers).length}\n`);
      process.stderr.write(`  Log level: ${config.logLevel}\n`);
      if (config.mode === 'server' && config.port) {
        process.stderr.write(`  Server port: ${config.port}\n`);
      }
      return true;
    } else {
      process.stderr.write('✗ Configuration validation failed:\n');
      for (const error of validation.errors) {
        process.stderr.write(`  - ${error.field}: ${error.message}\n`);
      }
      return false;
    }
  } catch (error) {
    process.stderr.write(
      `Failed to validate configuration: ${error instanceof Error ? error.message : String(error)}\n`
    );
    return false;
  }
}

/**
 * Apply configuration overrides from CLI arguments and environment variables
 */
function applyConfigOverrides(config: SystemConfig, args: CliArgs): SystemConfig {
  const overrides: Partial<SystemConfig> = {};

  // Mode override (priority: CLI > env > config)
  if (args.mode) {
    overrides.mode = args.mode;
  } else if (process.env['ONEMCP_MODE']) {
    overrides.mode = process.env['ONEMCP_MODE'] as 'cli' | 'server' | 'tui';
  }

  // Port override (priority: CLI > env > config)
  if (args.port) {
    overrides.port = parseInt(args.port, 10);
  } else if (process.env['ONEMCP_PORT']) {
    overrides.port = parseInt(process.env['ONEMCP_PORT'], 10);
  }

  // Log level override (priority: CLI > env > config)
  if (args.logLevel) {
    overrides.logLevel = args.logLevel;
  } else if (process.env['ONEMCP_LOG_LEVEL']) {
    overrides.logLevel = process.env['ONEMCP_LOG_LEVEL'] as 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  }

  return { ...config, ...overrides };
}

/**
 * Display effective configuration
 * Uses stderr so that in CLI (stdio) mode stdout is reserved for MCP JSON-RPC only.
 */
function displayEffectiveConfig(config: SystemConfig, configDir: string): void {
  process.stderr.write('\nEffective Configuration:\n');
  process.stderr.write(`  Configuration directory: ${configDir}\n`);
  process.stderr.write(`  Mode: ${config.mode}\n`);
  process.stderr.write(`  Log level: ${config.logLevel}\n`);
  if (config.mode === 'server') {
    process.stderr.write(`  Server port: ${config.port || 3000}\n`);
  }
  process.stderr.write(`  Services: ${Object.keys(config.mcpServers).length}\n`);
  process.stderr.write(`  Health checks: ${config.healthCheck.enabled ? 'enabled' : 'disabled'}\n`);
  process.stderr.write(`  Audit logging: ${config.audit.enabled ? 'enabled' : 'disabled'}\n`);
  process.stderr.write(`  Metrics: ${config.metrics?.enabled ? 'enabled' : 'disabled'}\n`);
  process.stderr.write('\n');
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  // Parse command-line arguments
  const args = parseCliArgs();

  // Handle help flag
  if (args.help) {
    displayHelp();
    process.exit(0);
  }

  // Handle version flag
  if (args.version) {
    displayVersion();
    process.exit(0);
  }

  // Resolve configuration directory
  const configDir = resolveConfigDir(args);

  // Handle "onemcp server <subcommand>" early dispatch (no config loading needed)
  if (args.positionals && args.positionals[0] === 'server') {
    const { stopDaemon, restartDaemon, printDaemonStatus, showLogs } =
      await import('./daemon/server-daemon.js');
    const subcommand = args.positionals[1];
    switch (subcommand) {
      case 'status':
        printDaemonStatus(configDir);
        return;
      case 'stop':
        await stopDaemon(configDir);
        return;
      case 'restart': {
        const execPath = requireExecutablePath();
        await restartDaemon(configDir, execPath);
        return;
      }
      case 'logs': {
        const lines = args.lines ? parseInt(args.lines, 10) : 50;
        showLogs(configDir, isNaN(lines) ? 50 : lines, args.follow ?? false);
        return;
      }
      default:
        process.stderr.write(`Unknown server subcommand: ${subcommand ?? '(none)'}\n`);
        process.stderr.write('Available subcommands: status, stop, restart, logs\n');
        process.exit(1);
    }
  }

  // Handle init flag
  if (args.init) {
    initializeConfigDir(configDir);
    process.exit(0);
  }

  // Check if configuration directory exists
  if (!existsSync(configDir)) {
    process.stderr.write(`Configuration directory does not exist: ${configDir}\n`);
    process.stderr.write(
      'Run with --init to create it, or specify a different directory with --config-dir\n'
    );
    process.exit(1);
  }

  // Handle validate flag
  if (args.validate) {
    const valid = await validateConfiguration(configDir);
    process.exit(valid ? 0 : 1);
  }

  // When explicitly starting in CLI mode, skip loading banner so stdout is not touched before MCP
  if (args.mode !== 'cli') {
    process.stderr.write(`Loading configuration from: ${configDir}\n`);
  }

  try {
    const storage = new FileStorageAdapter(configDir);
    const configProvider = new FileConfigProvider({
      storageAdapter: storage,
      configDir,
    });

    let config = await configProvider.load();

    // Apply CLI and environment overrides
    config = applyConfigOverrides(config, args);

    // Validate final configuration
    const validation = configProvider.validate(config);
    if (!validation.valid) {
      process.stderr.write('Configuration validation failed:\n');
      for (const error of validation.errors) {
        process.stderr.write(`  - ${error.field}: ${error.message}\n`);
      }
      process.exit(1);
    }

    // Display effective configuration only when not in CLI mode (CLI reserves stdout for MCP JSON-RPC only)
    if (config.mode !== 'cli') {
      displayEffectiveConfig(config, configDir);
    }

    // Handle dry-run flag
    if (args.dryRun) {
      process.stderr.write('Dry run complete. Configuration is valid.\n');
      process.exit(0);
    }

    // Start the router based on mode
    if (config.mode === 'cli') {
      const { CliModeRunner } = await import('./cli-mode.js');

      // Parse tag filter from CLI argument (--tag or -t)
      let tagFilter: TagFilter | undefined;
      if (args.tag) {
        const tags = args.tag
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t.length > 0);
        if (tags.length > 0) {
          tagFilter = { tags, logic: 'OR' };
          console.error(`Tag filter: ${tags.join(', ')} (OR logic)`);
        }
      }

      // Parse smart discovery config from CLI argument
      let toolDiscoveryConfig: ToolDiscoveryConfig | undefined;
      if (args['smart-discovery'] !== undefined) {
        toolDiscoveryConfig = {
          smartDiscovery: args['smart-discovery'],
          maxResults: 10,
          searchDescription: true,
        };
        console.error(`Smart tool discovery: ${args['smart-discovery'] ? 'enabled' : 'disabled'}`);
      }

      const runner = new CliModeRunner(config, configProvider, tagFilter, toolDiscoveryConfig);

      // Set up graceful shutdown handlers
      const shutdown = async (_signal: string) => {
        // In CLI (stdio) mode the process runs as a subprocess of tools like MCP Inspector.
        // The inspector pipes our stderr and forwards every chunk to the browser via SSE.
        // When the user clicks "Disconnect", the browser SSE closes first, then the inspector
        // sends SIGTERM to us. Any stderr write at that point causes the inspector to call
        // webAppTransport.send() on a closed transport and crash with "Not connected".
        // Silence stderr for the entire shutdown sequence to prevent this race condition.
        // Override write to a no-op so console.error() calls inside runner.stop() are
        // also suppressed without causing stream errors.
        silenceStderrForShutdown();
        try {
          await runner.stop();
          process.exit(0);
        } catch {
          process.exit(1);
        }
      };

      process.on('SIGINT', () => void shutdown('SIGINT'));
      process.on('SIGTERM', () => void shutdown('SIGTERM'));

      // Start the runner
      await runner.start();
    } else if (config.mode === 'tui') {
      const { runApp } = await import('./tui.js');
      await runApp(config, configProvider);
    } else {
      // Daemon mode: spawn detached process and exit
      if (args.daemon) {
        const { spawnDaemon, readPidFile, isProcessRunning } =
          await import('./daemon/server-daemon.js');

        // Check for existing daemon
        const existingPid = readPidFile(configDir);
        if (existingPid !== null && isProcessRunning(existingPid)) {
          process.stderr.write(`Server is already running (PID ${existingPid})\n`);
          process.exit(1);
        }

        // Build child args without --daemon/-d flag
        const childArgs = process.argv.slice(2).filter((a) => a !== '--daemon' && a !== '-d');

        // Ensure --mode server is present
        if (!childArgs.includes('--mode') && !childArgs.includes('-m')) {
          childArgs.push('--mode', 'server');
        }

        const port = config.port ?? 3000;
        const execPath = requireExecutablePath();
        spawnDaemon(execPath, childArgs, configDir, port);
        return;
      }

      const { ServerModeRunner } = await import('./server-mode.js');

      // If running as daemon child, clean up PID file on shutdown
      const isDaemonChild = process.env['ONEMCP_DAEMON'] === '1';
      const runnerOptions: {
        onShutdownComplete?: () => void;
        toolDiscoveryConfig?: ToolDiscoveryConfig;
      } = {};
      if (isDaemonChild) {
        runnerOptions.onShutdownComplete = () => {
          void import('./daemon/server-daemon.js').then(({ removePidFile }) =>
            removePidFile(configDir)
          );
        };
      }
      if (args['smart-discovery'] !== undefined) {
        runnerOptions.toolDiscoveryConfig = {
          smartDiscovery: args['smart-discovery'],
          maxResults: 10,
          searchDescription: true,
        };
        console.error(`Smart tool discovery: ${args['smart-discovery'] ? 'enabled' : 'disabled'}`);
      }

      const runner = new ServerModeRunner(config, configProvider, runnerOptions);

      // Set up graceful shutdown handlers
      const shutdown = async (signal: string) => {
        process.stderr.write(`\nReceived ${signal}, shutting down gracefully...\n`);
        try {
          await runner.stop();
          process.exit(0);
        } catch (error) {
          process.stderr.write(
            `Error during shutdown: ${error instanceof Error ? error.message : String(error)}\n`
          );
          process.exit(1);
        }
      };

      process.on('SIGINT', () => void shutdown('SIGINT'));
      process.on('SIGTERM', () => void shutdown('SIGTERM'));

      // Start the runner
      await runner.start();
    }
  } catch (error) {
    process.stderr.write(
      `Failed to start router: ${error instanceof Error ? error.message : String(error)}\n`
    );
    if (error instanceof Error && error.stack) {
      process.stderr.write(error.stack + '\n');
    }
    process.exit(1);
  }
}

// Run main function
main().catch((error) => {
  process.stderr.write(
    'Unexpected error: ' + (error instanceof Error ? error.message : String(error)) + '\n'
  );
  process.exit(1);
});
