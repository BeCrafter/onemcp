/**
 * Service JSON Editor Component
 * 
 * Multi-line JSON editor for service configuration.
 * Provides real-time validation, file import, and bulk import support.
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ServiceDefinition } from '../../types/service.js';
import { FileImportDialog } from './FileImportDialog.js';

export interface ServiceJsonEditorProps {
  /** Initial JSON content (for editing existing service) */
  initialJson?: string;
  /** Callback when JSON is submitted */
  onSubmit: (services: ServiceDefinition[]) => void;
  /** Callback when editor is cancelled */
  onCancel: () => void;
}

/**
 * Validation result
 */
interface ValidationResult {
  valid: boolean;
  errors: string[];
  services?: ServiceDefinition[];
}

/**
 * Validate JSON and parse services
 */
function validateJson(jsonText: string): ValidationResult {
  if (!jsonText.trim()) {
    return {
      valid: false,
      errors: ['JSON content is empty'],
    };
  }

  try {
    const parsed = JSON.parse(jsonText);
    
    // Check if it's a single service or multiple services
    let services: ServiceDefinition[];
    
    if (Array.isArray(parsed)) {
      // Array of services
      services = parsed;
    } else if (typeof parsed === 'object' && parsed !== null) {
      // Could be a single service or mcpServers format
      if (parsed.name && parsed.transport) {
        // Single service
        services = [parsed as ServiceDefinition];
      } else {
        // Assume mcpServers format: { "serviceName": { command, args, env, ... }, ... }
        services = Object.entries(parsed).map(([name, config]: [string, any]) => {
          const service: ServiceDefinition = {
            name,
            transport: config.transport || 'stdio',
            enabled: config.enabled !== false,
            tags: config.tags || [],
            connectionPool: {
              maxConnections: config.connectionPool?.maxConnections || 5,
              idleTimeout: config.connectionPool?.idleTimeout || 60000,
              connectionTimeout: config.connectionPool?.connectionTimeout || 30000,
            },
          };

          if (service.transport === 'stdio') {
            service.command = config.command;
            service.args = config.args;
            service.env = config.env;
          } else {
            service.url = config.url;
          }

          if (config.toolStates) {
            service.toolStates = config.toolStates;
          }

          return service;
        });
      }
    } else {
      return {
        valid: false,
        errors: ['JSON must be an object or array'],
      };
    }

    // Validate each service
    const errors: string[] = [];
    
    for (let i = 0; i < services.length; i++) {
      const service = services[i];
      const prefix = services.length > 1 ? `Service ${i + 1} (${service?.name || 'unnamed'}): ` : '';

      if (!service) {
        errors.push(`${prefix}Service is null or undefined`);
        continue;
      }

      if (!service.name || typeof service.name !== 'string') {
        errors.push(`${prefix}Missing or invalid 'name' field`);
      } else if (!/^[a-zA-Z0-9_-]+$/.test(service.name)) {
        errors.push(`${prefix}Service name can only contain letters, numbers, hyphens, and underscores`);
      }

      if (!service.transport || !['stdio', 'sse', 'http'].includes(service.transport)) {
        errors.push(`${prefix}Invalid 'transport' field (must be 'stdio', 'sse', or 'http')`);
      }

      if (service.transport === 'stdio') {
        if (!service.command || typeof service.command !== 'string') {
          errors.push(`${prefix}Missing or invalid 'command' field for stdio transport`);
        }
      } else {
        if (!service.url || typeof service.url !== 'string') {
          errors.push(`${prefix}Missing or invalid 'url' field for ${service.transport} transport`);
        } else if (!/^https?:\/\/.+/.test(service.url)) {
          errors.push(`${prefix}URL must start with http:// or https://`);
        }
      }

      if (service.connectionPool) {
        const pool = service.connectionPool;
        if (typeof pool.maxConnections !== 'number' || pool.maxConnections < 1 || pool.maxConnections > 100) {
          errors.push(`${prefix}maxConnections must be between 1 and 100`);
        }
        if (typeof pool.idleTimeout !== 'number' || pool.idleTimeout < 1000) {
          errors.push(`${prefix}idleTimeout must be at least 1000ms`);
        }
        if (typeof pool.connectionTimeout !== 'number' || pool.connectionTimeout < 1000) {
          errors.push(`${prefix}connectionTimeout must be at least 1000ms`);
        }
      }
    }

    if (errors.length > 0) {
      return {
        valid: false,
        errors,
      };
    }

    return {
      valid: true,
      errors: [],
      services,
    };
  } catch (error) {
    const err = error as Error;
    return {
      valid: false,
      errors: [`JSON parse error: ${err.message}`],
    };
  }
}

/**
 * Get example JSON template
 */
function getExampleJson(): string {
  return JSON.stringify({
    "filesystem": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      "env": {
        "NODE_ENV": "production"
      },
      "tags": ["local", "storage"],
      "enabled": true,
      "connectionPool": {
        "maxConnections": 5,
        "idleTimeout": 60000,
        "connectionTimeout": 30000
      }
    },
    "github": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "your-token-here"
      },
      "tags": ["remote", "api"],
      "enabled": true
    }
  }, null, 2);
}

/**
 * Service JSON Editor Component
 */
export const ServiceJsonEditor: React.FC<ServiceJsonEditorProps> = ({
  initialJson,
  onSubmit,
  onCancel,
}) => {
  const [jsonText, setJsonText] = useState<string>(initialJson || '');
  const [cursorPosition, setCursorPosition] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const [showFileImport, setShowFileImport] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResult>({ valid: true, errors: [] });

  // Validate JSON on change
  useEffect(() => {
    if (jsonText.trim()) {
      const result = validateJson(jsonText);
      setValidationResult(result);
    } else {
      setValidationResult({ valid: true, errors: [] });
    }
  }, [jsonText]);

  // Handle keyboard input
  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    // Toggle help
    if (input === '?' || (key as any).f1) {
      setShowHelp(!showHelp);
      return;
    }

    // Show file import dialog
    if (input === 'i' && key.ctrl) {
      setShowFileImport(true);
      return;
    }

    // Load example
    if (input === 'e' && key.ctrl) {
      setJsonText(getExampleJson());
      return;
    }

    // Submit
    if (input === 's' && key.ctrl) {
      if (validationResult.valid && validationResult.services) {
        onSubmit(validationResult.services);
      }
      return;
    }

    // Clear
    if (input === 'l' && key.ctrl) {
      setJsonText('');
      setCursorPosition(0);
      return;
    }

    // Handle text input
    if (key.backspace || key.delete) {
      if (jsonText.length > 0 && cursorPosition > 0) {
        const newText = jsonText.slice(0, cursorPosition - 1) + jsonText.slice(cursorPosition);
        setJsonText(newText);
        setCursorPosition(cursorPosition - 1);
      }
    } else if (key.return) {
      const newText = jsonText.slice(0, cursorPosition) + '\n' + jsonText.slice(cursorPosition);
      setJsonText(newText);
      setCursorPosition(cursorPosition + 1);
    } else if (input && !key.ctrl && !key.meta) {
      const newText = jsonText.slice(0, cursorPosition) + input + jsonText.slice(cursorPosition);
      setJsonText(newText);
      setCursorPosition(cursorPosition + input.length);
    }
  });

  // Handle file import
  const handleFileImport = (content: string) => {
    setJsonText(content);
    setShowFileImport(false);
  };

  // Render file import dialog
  if (showFileImport) {
    return (
      <FileImportDialog
        onImport={handleFileImport}
        onCancel={() => setShowFileImport(false)}
      />
    );
  }

  // Render help screen
  if (showHelp) {
    return (
      <Box flexDirection="column" padding={1}>
        <Box borderStyle="round" borderColor="cyan" padding={1} marginBottom={1}>
          <Text bold color="cyan">JSON Editor Help</Text>
        </Box>

        <Box flexDirection="column" borderStyle="single" padding={1} marginBottom={1}>
          <Text bold color="yellow">Keyboard Shortcuts:</Text>
          <Text>  Ctrl+S - Save and submit</Text>
          <Text>  Ctrl+I - Import from file</Text>
          <Text>  Ctrl+E - Load example template</Text>
          <Text>  Ctrl+L - Clear editor</Text>
          <Text>  ? or F1 - Toggle this help</Text>
          <Text>  Esc - Cancel and return</Text>
        </Box>

        <Box flexDirection="column" borderStyle="single" padding={1} marginBottom={1}>
          <Text bold color="yellow">Supported Formats:</Text>
          <Text>1. Single service object:</Text>
          <Text dimColor>   {`{ "name": "myservice", "transport": "stdio", ... }`}</Text>
          <Text>2. Array of services:</Text>
          <Text dimColor>   {`[{ "name": "service1", ... }, { "name": "service2", ... }]`}</Text>
          <Text>3. mcpServers format:</Text>
          <Text dimColor>   {`{ "service1": { "command": "...", ... }, "service2": { ... } }`}</Text>
        </Box>

        <Box flexDirection="column" borderStyle="single" padding={1} marginBottom={1}>
          <Text bold color="yellow">Required Fields:</Text>
          <Text>  • name - Service identifier</Text>
          <Text>  • transport - 'stdio', 'sse', or 'http'</Text>
          <Text>  • command - Required for stdio transport</Text>
          <Text>  • url - Required for sse/http transport</Text>
        </Box>

        <Box borderStyle="single" borderColor="gray" paddingX={1}>
          <Text dimColor>Press ? or F1 to return to editor</Text>
        </Box>
      </Box>
    );
  }

  // Calculate display lines (limit to visible area)
  const lines = jsonText.split('\n');
  const maxVisibleLines = 15;
  const displayLines = lines.slice(0, maxVisibleLines);
  const hasMoreLines = lines.length > maxVisibleLines;

  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="round" borderColor="cyan" padding={1} marginBottom={1}>
        <Text bold color="cyan">JSON Configuration Editor</Text>
      </Box>

      {/* Editor area */}
      <Box flexDirection="column" borderStyle="single" padding={1} marginBottom={1}>
        <Box marginBottom={1}>
          <Text dimColor>
            Lines: {lines.length} | Characters: {jsonText.length}
            {validationResult.valid && validationResult.services && (
              <Text color="green"> | ✓ Valid ({validationResult.services.length} service{validationResult.services.length !== 1 ? 's' : ''})</Text>
            )}
            {!validationResult.valid && (
              <Text color="red"> | ✗ Invalid</Text>
            )}
          </Text>
        </Box>

        <Box flexDirection="column" minHeight={maxVisibleLines}>
          {displayLines.length === 0 ? (
            <Text dimColor>Type or paste JSON configuration here...</Text>
          ) : (
            displayLines.map((line, index) => (
              <Text key={index}>{line || ' '}</Text>
            ))
          )}
          {hasMoreLines && (
            <Text dimColor>... ({lines.length - maxVisibleLines} more lines)</Text>
          )}
        </Box>
      </Box>

      {/* Validation errors */}
      {!validationResult.valid && validationResult.errors.length > 0 && (
        <Box flexDirection="column" borderStyle="single" borderColor="red" padding={1} marginBottom={1}>
          <Text bold color="red">Validation Errors:</Text>
          {validationResult.errors.slice(0, 5).map((error, index) => (
            <Text key={index} color="red">• {error}</Text>
          ))}
          {validationResult.errors.length > 5 && (
            <Text dimColor>... and {validationResult.errors.length - 5} more errors</Text>
          )}
        </Box>
      )}

      {/* Service preview */}
      {validationResult.valid && validationResult.services && validationResult.services.length > 0 && (
        <Box flexDirection="column" borderStyle="single" borderColor="green" padding={1} marginBottom={1}>
          <Text bold color="green">Services to Import:</Text>
          {validationResult.services.slice(0, 3).map((service, index) => (
            <Text key={index}>
              • {service.name} ({service.transport})
              {service.enabled === false && <Text dimColor> [disabled]</Text>}
            </Text>
          ))}
          {validationResult.services.length > 3 && (
            <Text dimColor>... and {validationResult.services.length - 3} more services</Text>
          )}
        </Box>
      )}

      {/* Keyboard shortcuts */}
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text dimColor>
          Ctrl+S: Save | Ctrl+I: Import | Ctrl+E: Example | Ctrl+L: Clear | ?: Help | Esc: Cancel
        </Text>
      </Box>
    </Box>
  );
};
