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
import type { SystemConfig } from './types/config.js';

/**
 * CLI argument definitions
 */
interface CliArgs {
  mode?: 'cli' | 'server' | 'tui' | undefined;
  configDir?: string | undefined;
  port?: string | undefined;
  logLevel?: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | undefined;
  help?: boolean | undefined;
  version?: boolean | undefined;
  validate?: boolean | undefined;
  init?: boolean | undefined;
  dryRun?: boolean | undefined;
}

/**
 * Display help message
 */
function displayHelp(): void {
  console.log(`
MCP Router System - Intelligent routing layer for MCP servers

USAGE:
  onemcp [OPTIONS]

OPTIONS:
  -m, --mode <mode>           Deployment mode: cli, server, or tui (default: cli)
  -c, --config-dir <path>     Configuration directory (default: ~/.onemcp)
  -p, --port <port>           Server port for server mode (default: 3000)
  -l, --log-level <level>     Log level: DEBUG, INFO, WARN, ERROR (default: INFO)
  -h, --help                  Display this help message
  -v, --version               Display version information
  --validate                  Validate configuration without starting
  --init                      Initialize configuration directory with defaults
  --dry-run                   Simulate startup without actually starting services

MODES:
  cli                         Stdio-based communication (default)
  server                      HTTP server mode
  tui                         Interactive terminal UI for configuration management

ENVIRONMENT VARIABLES:
  ONEMCP_CONFIG_DIR          Override configuration directory location
  ONEMCP_MODE                Override deployment mode
  ONEMCP_PORT                Override server port
  ONEMCP_LOG_LEVEL           Override log level

EXAMPLES:
  # Start in CLI mode (default)
  onemcp

  # Start in server mode on port 8080
  onemcp --mode server --port 8080

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

For more information, visit: https://github.com/yourusername/onemcp-router
`);
}

/**
 * Display version information
 */
function displayVersion(): void {
  // Read version from package.json
  // In production, this would be bundled or read from a version file
  console.log('MCP Router System v0.1.0');
}

/**
 * Parse command-line arguments
 */
function parseCliArgs(): CliArgs {
  try {
    const { values } = parseArgs({
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
      },
      strict: true,
      allowPositionals: false,
    });

    return {
      mode: values.mode as 'cli' | 'server' | 'tui' | undefined,
      configDir: values['config-dir'],
      port: values.port,
      logLevel: values['log-level'] as 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | undefined,
      help: values.help,
      version: values.version,
      validate: values.validate,
      init: values.init,
      dryRun: values['dry-run'],
    };
  } catch (error) {
    console.error(`Error parsing arguments: ${error instanceof Error ? error.message : String(error)}`);
    console.error('Use --help for usage information');
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
  const configDir = args.configDir || process.env['ONEMCP_CONFIG_DIR'] || resolve(homedir(), '.onemcp');
  return resolve(configDir);
}

/**
 * Initialize configuration directory with default structure
 */
function initializeConfigDir(configDir: string): void {
  console.log(`Initializing configuration directory: ${configDir}`);

  try {
    // Create directory structure
    mkdirSync(configDir, { recursive: true });
    mkdirSync(resolve(configDir, 'services'), { recursive: true });
    mkdirSync(resolve(configDir, 'logs'), { recursive: true });
    mkdirSync(resolve(configDir, 'backups'), { recursive: true });

    // Create default config.json
    const defaultConfig: SystemConfig = {
      mode: 'cli',
      logLevel: 'INFO',
      configDir,
      services: [],
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
    writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf8');

    // Create README
    const readme = `# MCP Router Configuration Directory

This directory contains configuration files for the MCP Router System.

## Directory Structure

- \`config.json\`: Main configuration file
- \`services/\`: Service definition files
- \`logs/\`: Log files (if file logging is enabled)
- \`backups/\`: Configuration backup files

## Configuration Format

The \`config.json\` file follows the MCP Router System configuration schema.
Service definitions can be added to the \`services\` array or stored as separate
files in the \`services/\` directory.

## Getting Started

1. Edit \`config.json\` to configure the router
2. Add service definitions to the \`services\` array
3. Start the router: \`onemcp --config-dir ${configDir}\`

For more information, see the documentation at:
https://github.com/yourusername/onemcp-router
`;

    writeFileSync(resolve(configDir, 'README.md'), readme, 'utf8');

    console.log('✓ Configuration directory initialized successfully');
    console.log(`  Config file: ${configPath}`);
    console.log(`  Services directory: ${resolve(configDir, 'services')}`);
    console.log(`  Logs directory: ${resolve(configDir, 'logs')}`);
    console.log(`  Backups directory: ${resolve(configDir, 'backups')}`);
  } catch (error) {
    console.error(`Failed to initialize configuration directory: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

/**
 * Validate configuration
 */
async function validateConfiguration(configDir: string): Promise<boolean> {
  console.log(`Validating configuration in: ${configDir}`);

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
      console.log('✓ Configuration is valid');
      console.log(`  Mode: ${config.mode}`);
      console.log(`  Services: ${config.services.length}`);
      console.log(`  Log level: ${config.logLevel}`);
      if (config.mode === 'server' && config.port) {
        console.log(`  Server port: ${config.port}`);
      }
      return true;
    } else {
      console.error('✗ Configuration validation failed:');
      for (const error of validation.errors) {
        console.error(`  - ${error.field}: ${error.message}`);
      }
      return false;
    }
  } catch (error) {
    console.error(`Failed to validate configuration: ${error instanceof Error ? error.message : String(error)}`);
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
 */
function displayEffectiveConfig(config: SystemConfig, configDir: string): void {
  console.log('\nEffective Configuration:');
  console.log(`  Configuration directory: ${configDir}`);
  console.log(`  Mode: ${config.mode}`);
  console.log(`  Log level: ${config.logLevel}`);
  if (config.mode === 'server') {
    console.log(`  Server port: ${config.port || 3000}`);
  }
  console.log(`  Services: ${config.services.length}`);
  console.log(`  Health checks: ${config.healthCheck.enabled ? 'enabled' : 'disabled'}`);
  console.log(`  Audit logging: ${config.audit.enabled ? 'enabled' : 'disabled'}`);
  console.log(`  Metrics: ${config.metrics?.enabled ? 'enabled' : 'disabled'}`);
  console.log('');
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

  // Handle init flag
  if (args.init) {
    initializeConfigDir(configDir);
    process.exit(0);
  }

  // Check if configuration directory exists
  if (!existsSync(configDir)) {
    console.error(`Configuration directory does not exist: ${configDir}`);
    console.error('Run with --init to create it, or specify a different directory with --config-dir');
    process.exit(1);
  }

  // Handle validate flag
  if (args.validate) {
    const valid = await validateConfiguration(configDir);
    process.exit(valid ? 0 : 1);
  }

  // Load configuration
  console.log(`Loading configuration from: ${configDir}`);
  
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
      console.error('Configuration validation failed:');
      for (const error of validation.errors) {
        console.error(`  - ${error.field}: ${error.message}`);
      }
      process.exit(1);
    }
    
    // Display effective configuration
    displayEffectiveConfig(config, configDir);
    
    // Handle dry-run flag
    if (args.dryRun) {
      console.log('Dry run complete. Configuration is valid.');
      process.exit(0);
    }
    
    // Start the router based on mode
    if (config.mode === 'cli') {
      const { CliModeRunner } = await import('./cli-mode.js');
      const runner = new CliModeRunner(config, configProvider);
      
      // Set up graceful shutdown handlers
      const shutdown = async (signal: string) => {
        console.error(`\nReceived ${signal}, shutting down gracefully...`);
        try {
          await runner.stop();
          process.exit(0);
        } catch (error) {
          console.error(`Error during shutdown: ${error}`);
          process.exit(1);
        }
      };
      
      process.on('SIGINT', () => shutdown('SIGINT'));
      process.on('SIGTERM', () => shutdown('SIGTERM'));
      
      // Start the runner
      await runner.start();
    } else if (config.mode === 'tui') {
      const { runApp } = await import('./tui.js');
      await runApp(config, configProvider);
    } else {
      const { ServerModeRunner } = await import('./server-mode.js');
      const runner = new ServerModeRunner(config, configProvider);
      
      // Set up graceful shutdown handlers
      const shutdown = async (signal: string) => {
        console.error(`\nReceived ${signal}, shutting down gracefully...`);
        try {
          await runner.stop();
          process.exit(0);
        } catch (error) {
          console.error(`Error during shutdown: ${error}`);
          process.exit(1);
        }
      };
      
      process.on('SIGINT', () => shutdown('SIGINT'));
      process.on('SIGTERM', () => shutdown('SIGTERM'));
      
      // Start the runner
      await runner.start();
    }
  } catch (error) {
    console.error(`Failed to start router: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run main function
main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
