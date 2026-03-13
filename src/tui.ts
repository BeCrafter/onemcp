#!/usr/bin/env node

/**
 * MCP Router System - TUI Entry Point
 *
 * This is the TUI entry point for interactive configuration management.
 * Provides a user-friendly terminal interface for managing services and tools.
 */

import React from 'react';
import { render } from 'ink';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { TuiApp } from './tui/app.js';
import { TuiAppOptimized } from './tui/app-optimized.js';
import type { SystemConfig } from './types/config.js';
import type { ConfigProvider } from './types/config.js';
import { FileConfigProvider } from './config/file-provider.js';
import { FileStorageAdapter } from './storage/file.js';
import { getPackageVersion } from './utils/package-version.js';

// Use optimized version by default
const USE_OPTIMIZED_UI = process.env['ONEMCP_USE_LEGACY_UI'] !== 'true';

/**
 * Run the TUI application with a config and configProvider
 */
export async function runApp(config: SystemConfig, configProvider: ConfigProvider): Promise<void> {
  const AppComponent = USE_OPTIMIZED_UI ? TuiAppOptimized : TuiApp;
  const { waitUntilExit } = render(React.createElement(AppComponent, { config, configProvider }));
  await waitUntilExit();
}

/**
 * TUI CLI argument definitions
 */
interface TuiArgs {
  configDir?: string | undefined;
  help?: boolean | undefined;
  version?: boolean | undefined;
}

/**
 * Display help message
 */
function displayHelp(): void {
  // eslint-disable-next-line no-console
  console.log(`
MCP Router System - Terminal User Interface

USAGE:
  onemcp-tui [OPTIONS]

OPTIONS:
  -c, --config-dir <path>     Configuration directory (default: ~/.onemcp)
  -h, --help                  Display this help message
  -v, --version               Display version information

ENVIRONMENT VARIABLES:
  ONEMCP_CONFIG_DIR          Override configuration directory location

DESCRIPTION:
  The TUI provides an interactive terminal interface for managing MCP Router
  configuration. You can add, edit, and delete services, manage tool states,
  test connections, and import/export configurations.

FEATURES:
  - Service management (add, edit, delete)
  - Form mode for step-by-step configuration
  - JSON mode for direct configuration input
  - Tool state management (enable/disable)
  - Connection testing
  - Configuration import/export
  - Configuration templates

KEYBOARD SHORTCUTS:
  Arrow Keys    Navigate menus and lists
  Enter         Select/confirm
  Esc           Go back/cancel
  Tab           Switch between form and JSON mode
  Ctrl+C        Exit application

EXAMPLES:
  # Start TUI with default configuration directory
  onemcp-tui

  # Use custom configuration directory
  onemcp-tui --config-dir /etc/onemcp

For more information, visit: https://github.com/BeCrafter/onemcp
`);
}

/**
 * Display version information
 */
function displayVersion(): void {
  // eslint-disable-next-line no-console
  console.log(`MCP Router System TUI v${getPackageVersion()}`);
}

/**
 * Parse command-line arguments
 */
function parseCliArgs(): TuiArgs {
  try {
    const { values } = parseArgs({
      options: {
        'config-dir': {
          type: 'string',
          short: 'c',
        },
        help: {
          type: 'boolean',
          short: 'h',
        },
        version: {
          type: 'boolean',
          short: 'v',
        },
      },
      strict: true,
      allowPositionals: false,
    });

    return {
      configDir: values['config-dir'],
      help: values.help,
      version: values.version,
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
function resolveConfigDir(args: TuiArgs): string {
  const configDir =
    args.configDir || process.env['ONEMCP_CONFIG_DIR'] || resolve(homedir(), '.onemcp');
  return resolve(configDir);
}

/**
 * Main TUI entry point
 */
async function main(): Promise<void> {
  const args = parseCliArgs();

  if (args.help) {
    displayHelp();
    process.exit(0);
  }

  if (args.version) {
    displayVersion();
    process.exit(0);
  }

  const configDir = resolveConfigDir(args);

  if (!existsSync(configDir)) {
    process.stderr.write(`Configuration directory does not exist: ${configDir}\n`);
    process.stderr.write('\n');
    process.stderr.write('Please initialize the configuration directory first:\n');
    process.stderr.write(`  onemcp --init --config-dir ${configDir}\n`);
    process.stderr.write('\n');
    process.stderr.write('Or use the default directory:\n');
    process.stderr.write('  onemcp --init\n');
    process.exit(1);
  }

  const storage = new FileStorageAdapter(configDir);
  const configProvider = new FileConfigProvider({
    storageAdapter: storage,
    configDir,
  });

  const config = await configProvider.load();

  await runApp(config, configProvider);
}

const isTuiDirectCall = process.argv[1]?.includes('tui');
if (isTuiDirectCall) {
  main().catch((error) => {
    process.stderr.write(
      'Unexpected error: ' + (error instanceof Error ? error.message : String(error)) + '\n'
    );
    process.exit(1);
  });
}
