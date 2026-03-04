/**
 * Service Form Component
 * 
 * Interactive form for adding and editing services.
 * Provides step-by-step configuration with validation and helpful error messages.
 * Shows/hides fields based on transport type selection.
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import type { ServiceDefinition, TransportType } from '../../types/service.js';
import { ServiceJsonEditor } from './ServiceJsonEditor.js';

export interface ServiceFormProps {
  /** Existing service to edit (undefined for new service) */
  service?: ServiceDefinition | undefined;
  /** Callback when form is submitted */
  onSubmit: (service: ServiceDefinition) => void;
  /** Callback when form is cancelled */
  onCancel: () => void;
  /** Initial mode (form or json) */
  initialMode?: 'form' | 'json';
}

/**
 * Form field type
 */
type FormField = 
  | 'name'
  | 'transport'
  | 'command'
  | 'url'
  | 'args'
  | 'env'
  | 'tags'
  | 'enabled'
  | 'maxConnections'
  | 'idleTimeout'
  | 'connectionTimeout'
  | 'quickMode'
  | 'confirm';

/**
 * Quick mode fields - only essential fields for new services
 */
const QUICK_MODE_FIELDS: FormField[] = ['name', 'transport'];

const QUICK_MODE_STDIO_FIELDS: FormField[] = ['command', 'tags', 'quickMode', 'confirm'];
const QUICK_MODE_HTTP_FIELDS: FormField[] = ['url', 'tags', 'quickMode', 'confirm'];

/**
 * Full mode fields - all available fields
 */
const FULL_MODE_FIELDS: FormField[] = ['name', 'transport'];

/**
 * Form data structure
 */
interface FormData {
  name: string;
  transport: TransportType;
  command: string;
  url: string;
  args: string;
  env: string;
  tags: string;
  enabled: boolean;
  maxConnections: string;
  idleTimeout: string;
  connectionTimeout: string;
}

/**
 * Validation error
 */
interface ValidationError {
  field: FormField;
  message: string;
}

/**
 * Get field order based on transport type and quick mode
 */
function getFieldOrder(transport: TransportType, quickMode: boolean): FormField[] {
  if (quickMode) {
    if (transport === 'stdio') {
      return [...QUICK_MODE_FIELDS, ...QUICK_MODE_STDIO_FIELDS];
    } else {
      return [...QUICK_MODE_FIELDS, ...QUICK_MODE_HTTP_FIELDS];
    }
  }
  
  if (transport === 'stdio') {
    return [
      'name', 'transport', 'command', 'args', 'env', 'tags', 
      'enabled', 'maxConnections', 'idleTimeout', 'connectionTimeout', 'confirm',
    ];
  } else {
    return [
      'name', 'transport', 'url', 'tags', 
      'enabled', 'maxConnections', 'idleTimeout', 'connectionTimeout', 'confirm',
    ];
  }
}

/**
 * Get field label
 */
function getFieldLabel(field: FormField): string {
  const labels: Record<FormField, string> = {
    name: 'Service Name',
    transport: 'Transport Type',
    command: 'Command',
    url: 'URL',
    args: 'Arguments (comma-separated)',
    env: 'Environment Variables (KEY=VALUE, comma-separated)',
    tags: 'Tags (comma-separated)',
    enabled: 'Enabled',
    maxConnections: 'Max Connections',
    idleTimeout: 'Idle Timeout (ms)',
    connectionTimeout: 'Connection Timeout (ms)',
    confirm: 'Confirm',
    quickMode: 'Quick Mode',
  };
  return labels[field];
}

/**
 * Get field help text
 */
function getFieldHelp(field: FormField): string {
  const help: Record<FormField, string> = {
    name: 'Unique identifier for this service',
    transport: 'Protocol used to communicate with the service',
    command: 'Command to start the MCP server (e.g., npx, node, python)',
    url: 'HTTP(S) URL of the MCP server',
    args: 'Command-line arguments (e.g., -y, @modelcontextprotocol/server-filesystem, /tmp)',
    env: 'Environment variables to pass to the process (e.g., NODE_ENV=production, DEBUG=true)',
    tags: 'Labels for categorization and filtering (e.g., local, storage, api)',
    enabled: 'Whether this service should be active',
    maxConnections: 'Maximum number of concurrent connections (default: 5)',
    idleTimeout: 'Time before idle connections are closed (default: 60000)',
    connectionTimeout: 'Maximum time to wait for connection (default: 30000)',
    confirm: 'Review and save the configuration',
    quickMode: 'Use quick mode with defaults for advanced options',
  };
  return help[field];
}

/**
 * Validate form data
 */
function validateFormData(data: FormData): ValidationError[] {
  const errors: ValidationError[] = [];

  // Validate name
  if (!data.name.trim()) {
    errors.push({ field: 'name', message: 'Service name is required' });
  } else if (!/^[a-zA-Z0-9_-]+$/.test(data.name)) {
    errors.push({ field: 'name', message: 'Service name can only contain letters, numbers, hyphens, and underscores' });
  }

  // Validate transport-specific fields
  if (data.transport === 'stdio') {
    if (!data.command.trim()) {
      errors.push({ field: 'command', message: 'Command is required for stdio transport' });
    }
  } else {
    if (!data.url.trim()) {
      errors.push({ field: 'url', message: 'URL is required for SSE/HTTP transport' });
    } else if (!/^https?:\/\/.+/.test(data.url)) {
      errors.push({ field: 'url', message: 'URL must start with http:// or https://' });
    }
  }

  // Validate numeric fields
  const maxConn = parseInt(data.maxConnections, 10);
  if (isNaN(maxConn) || maxConn < 1 || maxConn > 100) {
    errors.push({ field: 'maxConnections', message: 'Max connections must be between 1 and 100' });
  }

  const idleTimeout = parseInt(data.idleTimeout, 10);
  if (isNaN(idleTimeout) || idleTimeout < 1000) {
    errors.push({ field: 'idleTimeout', message: 'Idle timeout must be at least 1000ms' });
  }

  const connTimeout = parseInt(data.connectionTimeout, 10);
  if (isNaN(connTimeout) || connTimeout < 1000) {
    errors.push({ field: 'connectionTimeout', message: 'Connection timeout must be at least 1000ms' });
  }

  return errors;
}

/**
 * Convert form data to service definition
 */
function formDataToService(data: FormData): ServiceDefinition {
  const service: ServiceDefinition = {
    name: data.name.trim(),
    transport: data.transport,
    enabled: data.enabled,
    tags: data.tags.split(',').map(t => t.trim()).filter(t => t.length > 0),
    connectionPool: {
      maxConnections: parseInt(data.maxConnections, 10),
      idleTimeout: parseInt(data.idleTimeout, 10),
      connectionTimeout: parseInt(data.connectionTimeout, 10),
    },
  };

  if (data.transport === 'stdio') {
    service.command = data.command.trim();
    
    if (data.args.trim()) {
      service.args = data.args.split(',').map(a => a.trim()).filter(a => a.length > 0);
    }
    
    if (data.env.trim()) {
      service.env = {};
      const envPairs = data.env.split(',').map(e => e.trim()).filter(e => e.length > 0);
      for (const pair of envPairs) {
        const [key, ...valueParts] = pair.split('=');
        if (key && valueParts.length > 0) {
          service.env[key.trim()] = valueParts.join('=').trim();
        }
      }
    }
  } else {
    service.url = data.url.trim();
  }

  return service;
}

/**
 * Service Form Component
 */
export const ServiceForm: React.FC<ServiceFormProps> = ({
  service,
  onSubmit,
  onCancel,
  initialMode = 'form',
}) => {
  const [mode, setMode] = useState<'form' | 'json'>(initialMode);
  
  // Initialize form data from existing service or defaults
  const [formData, setFormData] = useState<FormData>(() => {
    if (service) {
      return {
        name: service.name,
        transport: service.transport,
        command: service.command || '',
        url: service.url || '',
        args: service.args?.join(', ') || '',
        env: service.env ? Object.entries(service.env).map(([k, v]) => `${k}=${v}`).join(', ') : '',
        tags: service.tags.join(', '),
        enabled: service.enabled,
        maxConnections: service.connectionPool.maxConnections.toString(),
        idleTimeout: service.connectionPool.idleTimeout.toString(),
        connectionTimeout: service.connectionPool.connectionTimeout.toString(),
      };
    } else {
      return {
        name: '',
        transport: 'stdio',
        command: '',
        url: '',
        args: '',
        env: '',
        tags: '',
        enabled: true,
        maxConnections: '5',
        idleTimeout: '60000',
        connectionTimeout: '30000',
      };
    }
  });

  const [currentField, setCurrentField] = useState<FormField>('name');
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [quickMode, setQuickMode] = useState(!service);

  // Calculate fields based on quick mode
  const fields = getFieldOrder(formData.transport, quickMode);

  // Convert form data to JSON for JSON mode
  const formDataToJson = (): string => {
    const serviceObj = formDataToService(formData);
    return JSON.stringify({ [serviceObj.name || 'service']: serviceObj }, null, 2);
  };

  // Handle JSON mode submission
  const handleJsonSubmit = (services: ServiceDefinition[]) => {
    if (services.length === 1 && services[0]) {
      onSubmit(services[0]);
    } else if (services.length > 1) {
      // For bulk import, submit the first service and notify about others
      // In a real implementation, this would need to handle multiple services
      onSubmit(services[0]!);
    }
  };

  // Handle mode toggle
  const toggleMode = () => {
    setMode(mode === 'form' ? 'json' : 'form');
  };

  // Handle field navigation
  const goToNextField = () => {
    const currentIndex = fields.indexOf(currentField);
    if (currentIndex < fields.length - 1) {
      const nextField = fields[currentIndex + 1];
      if (nextField) {
        setCurrentField(nextField);
      }
      setErrors([]);
    }
  };

  // Handle form submission
  const handleSubmit = () => {
    const validationErrors = validateFormData(formData);
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      // Jump to first error field
      const firstErrorField = validationErrors[0]?.field;
      if (firstErrorField) {
        setCurrentField(firstErrorField);
      }
      return;
    }

    const serviceDefinition = formDataToService(formData);
    onSubmit(serviceDefinition);
  };

  // Handle keyboard input for non-text fields
  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    // Handle mode toggle (Ctrl+M)
    if (input === 'm' && key.ctrl) {
      toggleMode();
      return;
    }

    // Handle preview toggle
    if (input === 'p' && currentField === 'confirm') {
      setShowPreview(!showPreview);
      return;
    }

    // Handle navigation for select fields
    if (currentField === 'transport' || currentField === 'enabled' || currentField === 'confirm') {
      if (key.upArrow || key.downArrow) {
        // Let SelectInput handle it
        return;
      }
      if (key.return) {
        if (currentField === 'confirm') {
          handleSubmit();
        } else {
          goToNextField();
        }
      }
    }
  });

  // Render transport type selector
  const renderTransportSelector = () => {
    const items = [
      { label: 'stdio - Standard Input/Output (local process)', value: 'stdio' },
      { label: 'SSE - Server-Sent Events (HTTP)', value: 'sse' },
      { label: 'HTTP - Streamable HTTP', value: 'http' },
    ];

    return (
      <SelectInput
        items={items}
        initialIndex={items.findIndex(i => i.value === formData.transport)}
        onSelect={(item) => {
          setFormData({ ...formData, transport: item.value as TransportType });
          goToNextField();
        }}
      />
    );
  };

  // Render enabled selector
  const renderEnabledSelector = () => {
    const items = [
      { label: 'Yes - Service will be active', value: true },
      { label: 'No - Service will be inactive', value: false },
    ];

    return (
      <SelectInput
        items={items}
        initialIndex={formData.enabled ? 0 : 1}
        onSelect={(item) => {
          setFormData({ ...formData, enabled: item.value as boolean });
          goToNextField();
        }}
      />
    );
  };

  // Render confirm selector
  const renderConfirmSelector = () => {
    const items = [
      { label: 'Save - Create/update this service', value: 'save' },
      { label: 'Preview - Review configuration', value: 'preview' },
      { label: 'Cancel - Discard changes', value: 'cancel' },
    ];

    return (
      <SelectInput
        items={items}
        onSelect={(item) => {
          if (item.value === 'save') {
            handleSubmit();
          } else if (item.value === 'preview') {
            setShowPreview(!showPreview);
          } else {
            onCancel();
          }
        }}
      />
    );
  };

  // Render quickMode selector
  const renderQuickModeSelector = () => {
    const items = [
      { label: 'Yes - Use defaults for advanced options', value: true },
      { label: 'No - Configure all options manually', value: false },
    ];

    return (
      <SelectInput
        items={items}
        initialIndex={quickMode ? 0 : 1}
        onSelect={(item) => {
          setQuickMode(item.value as boolean);
          goToNextField();
        }}
      />
    );
  };

  // Render text input field
  const renderTextInput = (field: FormField) => {
    return (
      <TextInput
        value={formData[field as keyof FormData] as string}
        onChange={(value) => {
          setFormData({ ...formData, [field]: value });
        }}
        onSubmit={goToNextField}
      />
    );
  };

  // Render current field
  const renderField = () => {
    if (currentField === 'transport') {
      return renderTransportSelector();
    } else if (currentField === 'enabled') {
      return renderEnabledSelector();
    } else if (currentField === 'confirm') {
      return renderConfirmSelector();
    } else if (currentField === 'quickMode') {
      return renderQuickModeSelector();
    } else {
      return renderTextInput(currentField);
    }
  };

  // Get current field error
  const currentError = errors.find(e => e.field === currentField);

  // Render JSON mode
  if (mode === 'json') {
    return (
      <Box flexDirection="column">
        <ServiceJsonEditor
          initialJson={service ? formDataToJson() : ''}
          onSubmit={handleJsonSubmit}
          onCancel={onCancel}
        />
        <Box borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
          <Text dimColor>Ctrl+M: Switch to Form Mode</Text>
        </Box>
      </Box>
    );
  }

  // Render preview
  if (showPreview) {
    const previewService = formDataToService(formData);
    return (
      <Box flexDirection="column" padding={1}>
        <Box borderStyle="round" borderColor="cyan" padding={1} marginBottom={1}>
          <Text bold color="cyan">Configuration Preview</Text>
        </Box>

        <Box flexDirection="column" borderStyle="single" padding={1} marginBottom={1}>
          <Text><Text bold>Name:</Text> {previewService.name}</Text>
          <Text><Text bold>Transport:</Text> {previewService.transport}</Text>
          <Text><Text bold>Enabled:</Text> {previewService.enabled ? 'Yes' : 'No'}</Text>
          
          {previewService.command && (
            <Text><Text bold>Command:</Text> {previewService.command}</Text>
          )}
          
          {previewService.args && previewService.args.length > 0 && (
            <Text><Text bold>Args:</Text> {previewService.args.join(', ')}</Text>
          )}
          
          {previewService.url && (
            <Text><Text bold>URL:</Text> {previewService.url}</Text>
          )}
          
          {previewService.env && Object.keys(previewService.env).length > 0 && (
            <Text><Text bold>Environment:</Text> {Object.entries(previewService.env).map(([k, v]) => `${k}=${v}`).join(', ')}</Text>
          )}
          
          <Text><Text bold>Tags:</Text> {previewService.tags.join(', ') || 'none'}</Text>
          
          <Text><Text bold>Connection Pool:</Text></Text>
          <Text>  Max Connections: {previewService.connectionPool.maxConnections}</Text>
          <Text>  Idle Timeout: {previewService.connectionPool.idleTimeout}ms</Text>
          <Text>  Connection Timeout: {previewService.connectionPool.connectionTimeout}ms</Text>
        </Box>

        <Box borderStyle="single" borderColor="gray" paddingX={1}>
          <Text dimColor>Press 'p' to return to form | Esc: Cancel</Text>
        </Box>
      </Box>
    );
  }

  // Render form
  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="round" borderColor="cyan" padding={1} marginBottom={1}>
        <Text bold color="cyan">
          {service ? 'Edit Service' : 'Add New Service'}
        </Text>
      </Box>

      {/* Progress indicator */}
      <Box marginBottom={1}>
        <Text dimColor>
          Step {fields.indexOf(currentField) + 1} of {fields.length}
        </Text>
      </Box>

      {/* Current field */}
      <Box flexDirection="column" borderStyle="single" padding={1} marginBottom={1}>
        <Text bold color="yellow">{getFieldLabel(currentField)}</Text>
        <Text dimColor>{getFieldHelp(currentField)}</Text>
        <Box marginTop={1}>
          {renderField()}
        </Box>
      </Box>

      {/* Validation errors */}
      {currentError && (
        <Box borderStyle="single" borderColor="red" padding={1} marginBottom={1}>
          <Text color="red">✗ {currentError.message}</Text>
        </Box>
      )}

      {/* All validation errors */}
      {errors.length > 0 && (
        <Box flexDirection="column" borderStyle="single" borderColor="red" padding={1} marginBottom={1}>
          <Text bold color="red">Validation Errors:</Text>
          {errors.map((error, index) => (
            <Text key={index} color="red">
              • {getFieldLabel(error.field)}: {error.message}
            </Text>
          ))}
        </Box>
      )}

      {/* Navigation help */}
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text dimColor>
          {currentField === 'confirm' 
            ? '↑/↓: Select | Enter: Confirm | p: Preview | Ctrl+M: JSON Mode | Esc: Cancel'
            : 'Enter: Next field | Ctrl+M: JSON Mode | Esc: Cancel'}
        </Text>
      </Box>
    </Box>
  );
};
