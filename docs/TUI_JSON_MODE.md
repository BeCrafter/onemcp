# TUI JSON Mode

## Overview

The TUI JSON mode provides an alternative way to configure services using JSON instead of the step-by-step form interface. This mode is designed for advanced users who prefer to work with JSON directly and supports bulk import of multiple services.

## Features

### 1. Multi-line JSON Editor

- Type or paste JSON configuration directly
- Real-time character and line count
- Support for large configurations (displays first 15 lines with scroll indicator)

### 2. Real-time Validation

- Instant JSON syntax validation
- Comprehensive service definition validation
- Clear error messages with field-specific details
- Visual indicators for valid/invalid JSON

### 3. Multiple Import Formats

The JSON editor supports three different formats:

#### Single Service Object
```json
{
  "name": "myservice",
  "transport": "stdio",
  "command": "node",
  "args": ["server.js"],
  "enabled": true,
  "tags": ["test"],
  "connectionPool": {
    "maxConnections": 5,
    "idleTimeout": 60000,
    "connectionTimeout": 30000
  }
}
```

#### Array of Services (Bulk Import)
```json
[
  {
    "name": "service1",
    "transport": "stdio",
    "command": "node",
    "args": ["server1.js"]
  },
  {
    "name": "service2",
    "transport": "http",
    "url": "http://localhost:3000"
  }
]
```

#### mcpServers Format
```json
{
  "filesystem": {
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
    "env": {
      "NODE_ENV": "production"
    },
    "tags": ["local", "storage"],
    "enabled": true
  },
  "github": {
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env": {
      "GITHUB_TOKEN": "your-token-here"
    },
    "tags": ["remote", "api"]
  }
}
```

### 4. File Import

Import JSON configuration from a file:

1. Press `Ctrl+I` in the JSON editor
2. Enter the file path (supports `~` for home directory)
3. The file content will be loaded and validated

### 5. Example Templates

Press `Ctrl+E` to load an example template with common service configurations.

## Keyboard Shortcuts

### JSON Editor
- `Ctrl+S` - Save and submit configuration
- `Ctrl+I` - Import from file
- `Ctrl+E` - Load example template
- `Ctrl+L` - Clear editor
- `?` or `F1` - Toggle help screen
- `Esc` - Cancel and return

### Mode Switching
- `Ctrl+M` - Switch between Form and JSON modes (from either mode)

## Validation Rules

### Required Fields

**For all services:**
- `name` - Service identifier (alphanumeric, hyphens, underscores only)
- `transport` - Must be 'stdio', 'sse', or 'http'

**For stdio transport:**
- `command` - Command to start the MCP server

**For sse/http transport:**
- `url` - HTTP(S) URL of the MCP server

### Optional Fields

- `args` - Array of command-line arguments (stdio only)
- `env` - Object of environment variables (stdio only)
- `tags` - Array of tags for categorization
- `enabled` - Boolean (default: true)
- `connectionPool` - Connection pool configuration
  - `maxConnections` - Number between 1 and 100 (default: 5)
  - `idleTimeout` - Milliseconds >= 1000 (default: 60000)
  - `connectionTimeout` - Milliseconds >= 1000 (default: 30000)
- `toolStates` - Object mapping tool names/patterns to enabled state

## Bulk Import

When importing multiple services:

1. The editor shows a preview of all services to be imported
2. Each service is validated independently
3. Validation errors show which service has the issue
4. All valid services can be imported even if some are invalid

## Error Messages

The JSON editor provides detailed error messages:

- **JSON parse errors** - Shows the exact parsing error
- **Missing fields** - Identifies which required field is missing
- **Invalid values** - Explains what values are acceptable
- **Multiple services** - Prefixes errors with service name/index

## Tips

1. **Start with an example** - Press `Ctrl+E` to see a working template
2. **Import existing configs** - Use `Ctrl+I` to load from files
3. **Validate as you type** - Watch the validation status in real-time
4. **Use mcpServers format** - Compatible with standard MCP configurations
5. **Switch modes freely** - Use `Ctrl+M` to toggle between form and JSON

## Integration with Form Mode

- Data is preserved when switching between modes
- Form data is automatically converted to JSON format
- JSON is parsed and populated into form fields
- Both modes validate using the same rules
