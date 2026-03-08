/**
 * File-based configuration provider implementation
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import type {
  ConfigProvider,
  SystemConfig,
  ValidationResult,
  ValidationError,
} from '../types/config.js';
import type { StorageAdapter } from '../types/storage.js';

/**
 * Configuration options for FileConfigProvider
 */
export interface FileConfigProviderOptions {
  /** Storage adapter for file operations */
  storageAdapter: StorageAdapter;
  /** Custom config directory (overrides default ~/.onemcp) */
  configDir?: string;
}

export class FileConfigProvider implements ConfigProvider {
  private storageAdapter: StorageAdapter;
  private configDir: string;
  private validator: ValidateFunction;
  private readonly CONFIG_FILE = 'config.json';

  constructor(options: FileConfigProviderOptions) {
    this.storageAdapter = options.storageAdapter;

    // Determine config directory with priority order
    this.configDir = this.resolveConfigDir(options.configDir);

    // Initialize JSON schema validator
    this.validator = this.createValidator();
  }

  /**
   * Resolve configuration directory based on priority order
   */
  private resolveConfigDir(optionsDir?: string): string {
    // Priority 1: Constructor options
    if (optionsDir) {
      return this.expandPath(optionsDir);
    }

    // Priority 2: Environment variable
    const envDir = process.env['ONEMCP_CONFIG_DIR'];
    if (envDir) {
      return this.expandPath(envDir);
    }

    // Priority 3: Default
    return path.join(os.homedir(), '.onemcp');
  }

  /**
   * Expand path with home directory support
   */
  private expandPath(configPath: string): string {
    if (configPath.startsWith('~/')) {
      return path.join(os.homedir(), configPath.slice(2));
    }
    return path.resolve(configPath);
  }

  /**
   * Create JSON schema validator for SystemConfig
   */
  private createValidator(): ValidateFunction {
    const ajv = new Ajv({ allErrors: true, verbose: true });
    addFormats(ajv); // Add format validators including 'uri'

    const schema = {
      type: 'object',
      required: [
        'mode',
        'logLevel',
        'configDir',
        'mcpServers',
        'connectionPool',
        'healthCheck',
        'audit',
        'security',
      ],
      properties: {
        mode: {
          type: 'string',
          enum: ['cli', 'server', 'tui'],
        },
        port: {
          type: 'number',
          minimum: 1,
          maximum: 65535,
        },
        logLevel: {
          type: 'string',
          enum: ['DEBUG', 'INFO', 'WARN', 'ERROR'],
        },
        configDir: {
          type: 'string',
          minLength: 1,
        },
        mcpServers: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'transport', 'enabled'],
            properties: {
              name: {
                type: 'string',
                minLength: 1,
              },
              transport: {
                type: 'string',
                enum: ['stdio', 'sse', 'http'],
              },
              enabled: {
                type: 'boolean',
              },
              command: {
                type: 'string',
              },
              args: {
                type: 'array',
                items: { type: 'string' },
              },
              env: {
                type: 'object',
                additionalProperties: { type: 'string' },
              },
              url: {
                type: 'string',
                format: 'uri',
              },
              tags: {
                type: 'array',
                items: { type: 'string' },
              },
              connectionPool: {
                type: 'object',
                required: ['maxConnections', 'idleTimeout', 'connectionTimeout'],
                properties: {
                  maxConnections: {
                    type: 'number',
                    minimum: 1,
                  },
                  idleTimeout: {
                    type: 'number',
                    minimum: 0,
                  },
                  connectionTimeout: {
                    type: 'number',
                    minimum: 0,
                  },
                },
              },
              toolStates: {
                type: 'object',
                additionalProperties: { type: 'boolean' },
              },
            },
            // Conditional validation based on transport type
            if: {
              properties: { transport: { const: 'stdio' } },
            },
            then: {
              required: ['command'],
            },
            else: {
              if: {
                properties: {
                  transport: { enum: ['sse', 'http'] },
                },
              },
              then: {
                required: ['url'],
              },
            },
          },
        },
        connectionPool: {
          type: 'object',
          required: ['maxConnections', 'idleTimeout', 'connectionTimeout'],
          properties: {
            maxConnections: {
              type: 'number',
              minimum: 1,
            },
            idleTimeout: {
              type: 'number',
              minimum: 0,
            },
            connectionTimeout: {
              type: 'number',
              minimum: 0,
            },
          },
        },
        healthCheck: {
          type: 'object',
          required: ['enabled', 'interval', 'failureThreshold', 'autoUnload'],
          properties: {
            enabled: {
              type: 'boolean',
            },
            interval: {
              type: 'number',
              minimum: 1000,
            },
            failureThreshold: {
              type: 'number',
              minimum: 1,
            },
            autoUnload: {
              type: 'boolean',
            },
          },
        },
        audit: {
          type: 'object',
          required: ['enabled', 'level', 'logInput', 'logOutput', 'retention'],
          properties: {
            enabled: {
              type: 'boolean',
            },
            level: {
              type: 'string',
              enum: ['minimal', 'standard', 'verbose'],
            },
            logInput: {
              type: 'boolean',
            },
            logOutput: {
              type: 'boolean',
            },
            retention: {
              type: 'object',
              required: ['days', 'maxSize'],
              properties: {
                days: {
                  type: 'number',
                  minimum: 1,
                },
                maxSize: {
                  type: 'string',
                  pattern: '^\\d+[KMGT]?B$',
                },
              },
            },
          },
        },
        security: {
          type: 'object',
          required: ['dataMasking'],
          properties: {
            dataMasking: {
              type: 'object',
              required: ['enabled', 'patterns'],
              properties: {
                enabled: {
                  type: 'boolean',
                },
                patterns: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
            },
          },
        },
        logging: {
          type: 'object',
          properties: {
            level: {
              type: 'string',
              enum: ['DEBUG', 'INFO', 'WARN', 'ERROR'],
            },
            outputs: {
              type: 'array',
              items: { type: 'string' },
            },
            format: {
              type: 'string',
              enum: ['json', 'pretty'],
            },
            filePath: {
              type: 'string',
            },
          },
        },
      },
    };

    return ajv.compile(schema);
  }

  /**
   * Load configuration from file system
   */
  async load(): Promise<SystemConfig> {
    try {
      // Read config file (use relative path for storage adapter)
      const configData = await this.storageAdapter.read(this.CONFIG_FILE);

      if (!configData) {
        const configPath = path.join(this.configDir, this.CONFIG_FILE);
        throw new Error(`Configuration file not found: ${configPath}`);
      }

      let config: SystemConfig;
      try {
        const parsed = JSON.parse(configData);
        if (typeof parsed !== 'object' || parsed === null) {
          throw new Error('Configuration JSON is not an object');
        }
        
        const processed = {
          ...parsed,
          mcpServers: parsed.mcpServers || parsed.services || []
        };
        
        if ('services' in processed) {
          delete (processed as any).services;
        }
        
        config = processed as SystemConfig;
      } catch (error) {
        throw new Error(
          `Failed to parse configuration JSON: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      // Validate configuration
      const validationResult = this.validate(config);
      if (!validationResult.valid) {
        const errorMessages = validationResult.errors
          .map((err) => `  - ${err.field}: ${err.message}`)
          .join('\n');
        throw new Error(`Configuration validation failed:\n${errorMessages}`);
      }

      return config;
    } catch (error) {
      throw new Error(
        `Failed to load configuration: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Save configuration to file system
   */
  async save(config: SystemConfig): Promise<void> {
    try {
      // Validate before saving
      const validationResult = this.validate(config);
      if (!validationResult.valid) {
        const errorMessages = validationResult.errors
          .map((err) => `  - ${err.field}: ${err.message}`)
          .join('\n');
        throw new Error(`Configuration validation failed:\n${errorMessages}`);
      }

      // Serialize to JSON with pretty formatting
      const configData = JSON.stringify(config, null, 2);

      // Write to file using atomic write (use relative path for storage adapter)
      await this.storageAdapter.write(this.CONFIG_FILE, configData);
    } catch (error) {
      throw new Error(
        `Failed to save configuration: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Validate configuration structure and values
   */
  validate(config: SystemConfig): ValidationResult {
    const errors: ValidationError[] = [];

    // Run JSON schema validation
    const valid = this.validator(config);

    if (!valid && this.validator.errors) {
      // Convert AJV errors to ValidationError format
      for (const error of this.validator.errors) {
        const field = error.instancePath || error.schemaPath;
        const message = error.message || 'Validation failed';

        errors.push({
          field: field.replace(/^\//, '').replace(/\//g, '.'),
          message,
          expected: error.params,
          actual: error.data,
        });
      }
    }

    // Additional custom validations

    // Validate server mode requires port
    if (config.mode === 'server' && !config.port) {
      errors.push({
        field: 'port',
        message: 'Port is required for server mode',
        expected: 'number between 1-65535',
        actual: config.port,
      });
    }

    // Validate service transport-specific requirements
    if (config.mcpServers && Array.isArray(config.mcpServers)) {
      for (let i = 0; i < config.mcpServers.length; i++) {
        const service = config.mcpServers[i];
        if (!service) continue;

        if (service.transport === 'stdio' && !service.command) {
          errors.push({
            field: `services[${i}].command`,
            message: 'Command is required for stdio transport',
            expected: 'non-empty string',
            actual: service.command,
          });
        }

        if ((service.transport === 'sse' || service.transport === 'http') && !service.url) {
          errors.push({
            field: `services[${i}].url`,
            message: `URL is required for ${service.transport} transport`,
            expected: 'valid URL',
            actual: service.url,
          });
        }

        // Validate URL format for HTTP transports
        if (service.url) {
          try {
            new URL(service.url);
          } catch {
            errors.push({
              field: `services[${i}].url`,
              message: 'Invalid URL format',
              expected: 'valid URL (e.g., https://example.com)',
              actual: service.url,
            });
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Watch for configuration changes and automatically reload
   *
   * Monitors the config file for changes and invokes the callback with the new
   * configuration when changes are detected. Validates configuration before
   * applying changes and maintains the previous valid configuration on validation
   * failure.
   *
   * Features:
   * - Debounces file change events to avoid multiple reloads for a single edit
   * - Validates configuration before applying changes
   * - Maintains previous valid configuration on validation failure
   * - Handles file deletion gracefully (logs warning, doesn't crash)
   * - Catches and logs callback errors (doesn't crash watcher)
   *
   * @param callback Function to invoke with new configuration
   * @returns Function to stop watching
   */
  watch(callback: (config: SystemConfig) => void): () => void {
    const configPath = path.join(this.configDir, this.CONFIG_FILE);
    const configKey = this.CONFIG_FILE;
    let watcher: fs.FSWatcher | null = null;
    let pollTimer: NodeJS.Timeout | null = null;
    let lastMtime: number = 0;
    let debounceTimer: NodeJS.Timeout | null = null;
    let isWatching = true;

    const DEBOUNCE_DELAY = 300;
    const POLL_INTERVAL = 1000;

    const loadConfig = async () => {
      try {
        const fileData = await this.storageAdapter.read(configKey);

        if (!fileData) {
          console.warn(`Configuration file deleted: ${configPath}`);
          return;
        }

        const newConfig = await this.load();

        try {
          callback(newConfig);
        } catch (callbackError) {
          console.error(
            'Error in configuration watch callback:',
            callbackError instanceof Error ? callbackError.message : String(callbackError)
          );
        }
      } catch (error) {
        console.error(
          'Failed to reload configuration, keeping previous valid configuration:',
          error instanceof Error ? error.message : String(error)
        );
      }
    };

    const handleChange = () => {
      if (!isWatching) return;

      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      debounceTimer = setTimeout(() => void loadConfig(), DEBOUNCE_DELAY);
    };

    const checkFile = async () => {
      if (!isWatching) return;

      try {
        const stats = await fs.promises.stat(configPath);
        const currentMtime = stats.mtimeMs;

        if (lastMtime !== 0 && currentMtime !== lastMtime) {
          lastMtime = currentMtime;
          void handleChange();
        } else if (lastMtime === 0) {
          lastMtime = currentMtime;
        }
      } catch {
        // File might not exist yet
      }
    };

    try {
      watcher = fs.watch(configPath, { persistent: false }, (eventType) => {
        if (eventType === 'change') {
          void handleChange();
        }
      });

      watcher.on('error', (error: Error) => {
        console.error('Configuration file watcher error:', error.message);
      });
    } catch (error) {
      console.error(
        'Failed to start fs.watch, falling back to polling:',
        error instanceof Error ? error.message : String(error)
      );
    }

    pollTimer = setInterval(() => void checkFile(), POLL_INTERVAL);

    return () => {
      isWatching = false;

      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }

      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }

      if (watcher) {
        watcher.close();
        watcher = null;
      }
    };
  }

  /**
   * Get the resolved configuration directory path
   */
  getConfigDir(): string {
    return this.configDir;
  }

  /**
   * Initialize configuration directory structure
   *
   * Creates the configuration directory and subdirectories if they don't exist:
   * - config.json: Main configuration file with sensible defaults
   * - services/: Directory for service definitions
   * - logs/: Directory for log files
   * - backups/: Directory for configuration backups
   * - README.md: Documentation explaining the directory structure
   *
   * This method is idempotent - calling it multiple times is safe and will not
   * overwrite existing files.
   *
   * @returns Promise resolving when initialization is complete
   * @throws Error if directory creation fails
   */
  async initialize(): Promise<void> {
    try {
      // Create main config directory
      await this.ensureDirectory(this.configDir);

      // Create subdirectories
      await this.ensureDirectory(path.join(this.configDir, 'services'));
      await this.ensureDirectory(path.join(this.configDir, 'logs'));
      await this.ensureDirectory(path.join(this.configDir, 'backups'));

      // Create default config.json if it doesn't exist
      const configPath = path.join(this.configDir, this.CONFIG_FILE);
      const existingConfig = await this.storageAdapter.read(configPath);

      if (!existingConfig) {
        const defaultConfig = this.createDefaultConfig();
        await this.save(defaultConfig);
      }

      // Create README.md if it doesn't exist
      const readmePath = path.join(this.configDir, 'README.md');
      const existingReadme = await this.storageAdapter.read(readmePath);

      if (!existingReadme) {
        const readmeContent = this.createReadmeContent();
        await this.storageAdapter.write(readmePath, readmeContent);
      }
    } catch (error) {
      throw new Error(
        `Failed to initialize configuration directory: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Ensure a directory exists, creating it if necessary
   */
  private async ensureDirectory(dirPath: string): Promise<void> {
    try {
      // Check if directory exists by trying to read it
      const exists = await this.storageAdapter
        .read(dirPath)
        .then(() => true)
        .catch(() => false);

      if (!exists) {
        // Create directory using Node.js fs module directly
        // StorageAdapter is for file operations, not directory creation
        await fs.promises.mkdir(dirPath, { recursive: true });
      }
    } catch (error) {
      throw new Error(
        `Failed to create directory ${dirPath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Create default system configuration
   */
  private createDefaultConfig(): SystemConfig {
    return {
      mode: 'cli',
      logLevel: 'INFO',
      configDir: this.configDir,
      mcpServers: [],
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
          patterns: ['password', 'token', 'secret', 'key', 'apiKey', 'apiSecret'],
        },
      },
      logging: {
        level: 'INFO',
        outputs: ['console'],
        format: 'pretty',
      },
    };
  }

  /**
   * Create README content explaining directory structure
   */
  private createReadmeContent(): string {
    return `# OneMCP Configuration Directory

This directory contains the configuration for the OneMCP System.

## Directory Structure

\`\`\`
${path.basename(this.configDir)}/
├── config.json       # Main configuration file
├── services/         # Service definition files (optional)
├── logs/             # Log files (if file logging is enabled)
├── backups/          # Configuration backups
└── README.md         # This file
\`\`\`

## Configuration File (config.json)

The main configuration file defines the system behavior and registered services.

### Configuration Format

\`\`\`json
{
  "mode": "cli",              // Deployment mode: "cli" or "server"
  "port": 3000,               // Server port (required for server mode)
  "logLevel": "INFO",         // Log level: DEBUG, INFO, WARN, ERROR
  "configDir": "~/.onemcp",   // Configuration directory path
  "mcpServers": [],             // Array of service definitions
  "connectionPool": {         // Default connection pool settings
    "maxConnections": 5,
    "idleTimeout": 60000,
    "connectionTimeout": 30000
  },
  "healthCheck": {            // Health monitoring settings
    "enabled": true,
    "interval": 30000,
    "failureThreshold": 3,
    "autoUnload": true
  },
  "audit": {                  // Audit logging settings
    "enabled": true,
    "level": "standard",
    "logInput": false,
    "logOutput": false,
    "retention": {
      "days": 30,
      "maxSize": "1GB"
    }
  },
  "security": {               // Security settings
    "dataMasking": {
      "enabled": true,
      "patterns": ["password", "token", "secret", "key"]
    }
  }
}
\`\`\`

## Adding Services

Services can be added directly in the \`services\` array in config.json or managed via the TUI.

### Service Definition Format

#### Stdio Transport (Local Process)

\`\`\`json
{
  "name": "filesystem",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
  "env": {
    "NODE_ENV": "production"
  },
  "enabled": true,
  "tags": ["local", "storage"],
  "connectionPool": {
    "maxConnections": 3,
    "idleTimeout": 60000,
    "connectionTimeout": 30000
  }
}
\`\`\`

#### HTTP/SSE Transport (Remote Service)

\`\`\`json
{
  "name": "remote-api",
  "transport": "http",
  "url": "https://api.example.com/mcp",
  "enabled": true,
  "tags": ["remote", "api"],
  "connectionPool": {
    "maxConnections": 10,
    "idleTimeout": 120000,
    "connectionTimeout": 30000
  }
}
\`\`\`

### Transport Types

- **stdio**: Launches a local process and communicates via stdin/stdout
  - Required fields: \`command\`
  - Optional fields: \`args\`, \`env\`
  
- **sse**: Connects to a remote service using Server-Sent Events
  - Required fields: \`url\`
  
- **http**: Connects to a remote service using HTTP streaming
  - Required fields: \`url\`

## Tool State Management

You can pre-configure which tools are enabled or disabled for each service:

\`\`\`json
{
  "name": "filesystem",
  "toolStates": {
    "read_file": true,
    "write_file": false,
    "*_directory": true
  }
}
\`\`\`

Tool state patterns support:
- Exact tool names: \`"read_file": false\`
- Wildcard patterns: \`"*_directory": true\`
- Regular expressions: \`".*_file": false\`

## Logs Directory

When file logging is enabled, log files are stored in the \`logs/\` directory.

Configure file logging in config.json:

\`\`\`json
{
  "logging": {
    "level": "INFO",
    "outputs": ["console", "file"],
    "format": "json",
    "filePath": "logs/onemcp.log"
  }
}
\`\`\`

## Backups Directory

Configuration backups are automatically created in the \`backups/\` directory when:
- Configuration is modified via the TUI
- Manual backup is triggered
- Periodic backups are enabled

Backup files are named with timestamps: \`config-backup-YYYY-MM-DD-HHmmss.json\`

## Configuration Management

### Using the TUI

Launch the interactive configuration interface:

\`\`\`bash
onemcp-tui
\`\`\`

The TUI provides:
- Service management (add, edit, delete)
- Tool state management
- Configuration validation
- Connection testing
- Import/export functionality

### Using the CLI

Validate configuration:

\`\`\`bash
onemcp --validate
\`\`\`

Initialize configuration directory:

\`\`\`bash
onemcp --init
\`\`\`

Specify custom config directory:

\`\`\`bash
onemcp --config-dir /path/to/config
# or
export ONEMCP_CONFIG_DIR=/path/to/config
onemcp
\`\`\`

## Hot Reload

The system automatically reloads configuration when config.json is modified.
Invalid configurations are rejected and the previous valid configuration is maintained.

## More Information

For complete documentation, visit: https://github.com/BeCrafter/onemcp

For support, open an issue at: https://github.com/BeCrafter/onemcp/issues
`;
  }
}
