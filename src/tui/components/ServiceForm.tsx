/**
 * Service Form Component
 * 
 * Interactive form for adding and editing services.
 * Provides step-by-step configuration with validation and helpful error messages.
 * Shows/hides fields based on transport type selection.
 * Handles terminal height constraints for small terminals.
 */

import React, { useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import type { ServiceDefinition, TransportType } from '../../types/service.js';

export interface ServiceFormProps {
  /** Existing service to edit (undefined for new service) */
  service?: ServiceDefinition | undefined;
  /** Callback when form is submitted */
  onSubmit: (service: ServiceDefinition) => void;
  /** Callback when form is cancelled */
  onCancel: () => void;
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
  | 'headers'
  | 'tags'
  | 'enabled'
  | 'maxConnections'
  | 'idleTimeout'
  | 'connectionTimeout'
  | 'triggerHintsStart'
  | 'triggerHintsEnd'
  | 'triggerHintsPhrases'
  | 'quickMode'
  | 'confirm';

/**
 * Quick mode fields - only essential fields for new services
 */
const QUICK_MODE_FIELDS: FormField[] = ['name', 'transport'];

const QUICK_MODE_STDIO_FIELDS: FormField[] = ['command', 'tags', 'quickMode', 'confirm'];
const QUICK_MODE_HTTP_FIELDS: FormField[] = ['url', 'headers', 'tags', 'quickMode', 'confirm'];

/**
 * Form data structure
 */
export interface FormData {
  name: string;
  transport: TransportType;
  command: string;
  url: string;
  args: string;
  env: string;
  headers: string;
  tags: string;
  enabled: boolean;
  maxConnections: string;
  idleTimeout: string;
  connectionTimeout: string;
  triggerHintsStart: string;
  triggerHintsEnd: string;
  triggerHintsPhrases: string;
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
      'enabled', 'maxConnections', 'idleTimeout', 'connectionTimeout',
      'triggerHintsStart', 'triggerHintsEnd', 'triggerHintsPhrases', 'confirm',
    ];
  } else {
    return [
      'name', 'transport', 'url', 'headers', 'tags',
      'enabled', 'maxConnections', 'idleTimeout', 'connectionTimeout',
      'triggerHintsStart', 'triggerHintsEnd', 'triggerHintsPhrases', 'confirm',
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
    headers: 'HTTP Headers (Key: Value, comma-separated)',
    tags: 'Tags (comma-separated)',
    enabled: 'Enabled',
    maxConnections: 'Max Connections',
    idleTimeout: 'Idle Timeout (ms)',
    connectionTimeout: 'Connection Timeout (ms)',
    triggerHintsStart: 'Trigger: On Session Start (optional)',
    triggerHintsEnd: 'Trigger: On Session End (optional)',
    triggerHintsPhrases: 'Trigger Phrases (comma-separated, optional)',
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
    env: 'Environment variables to pass to the process (e.g., NODE_ENV=production, DEBUG=true).',
    headers: 'Custom HTTP headers (e.g., Authorization: Bearer token, Content-Type: application/json).',
    tags: 'Labels for categorization and filtering (e.g., local, storage, api)',
    enabled: 'Whether this service should be active',
    maxConnections: 'Maximum number of concurrent connections (default: 5)',
    idleTimeout: 'Time before idle connections are closed (default: 60000)',
    connectionTimeout: 'Maximum time to wait for connection (default: 30000)',
    triggerHintsStart: 'Reason the LLM should call this service at conversation start (e.g., "recall role memory").',
    triggerHintsEnd: 'Reason the LLM should call this service before conversation ends (e.g., "persist new memory").',
    triggerHintsPhrases: 'Extra trigger phrases the LLM should treat as a search signal (e.g., "我是X, switch role").',
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
export function formDataToService(data: FormData): ServiceDefinition {
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

    if (data.headers.trim()) {
      service.headers = {};
      const headerPairs = data.headers.split(',').map(h => h.trim()).filter(h => h.length > 0);
      for (const pair of headerPairs) {
        const [key, ...valueParts] = pair.split(':');
        if (key && valueParts.length > 0) {
          service.headers[key.trim()] = valueParts.join(':').trim();
        }
      }
    }
  }

  const phrases = data.triggerHintsPhrases
    .split(',')
    .map(p => p.trim())
    .filter(p => p.length > 0);
  const hints: NonNullable<ServiceDefinition['triggerHints']> = {};
  if (data.triggerHintsStart.trim()) hints.onSessionStart = data.triggerHintsStart.trim();
  if (data.triggerHintsEnd.trim()) hints.onSessionEnd = data.triggerHintsEnd.trim();
  if (phrases.length > 0) hints.phrases = phrases;
  if (Object.keys(hints).length > 0) {
    service.triggerHints = hints;
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
}) => {
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows || 24;
  
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
        headers: service.headers ? Object.entries(service.headers).map(([k, v]) => `${k}: ${v}`).join(', ') : '',
        tags: service.tags.join(', '),
        enabled: service.enabled,
        maxConnections: service.connectionPool.maxConnections.toString(),
        idleTimeout: service.connectionPool.idleTimeout.toString(),
        connectionTimeout: service.connectionPool.connectionTimeout.toString(),
        triggerHintsStart: service.triggerHints?.onSessionStart || '',
        triggerHintsEnd: service.triggerHints?.onSessionEnd || '',
        triggerHintsPhrases: service.triggerHints?.phrases?.join(', ') || '',
      };
    } else {
      return {
        name: '',
        transport: 'stdio',
        command: '',
        url: '',
        args: '',
        env: '',
        headers: '',
        tags: '',
        enabled: true,
        maxConnections: '5',
        idleTimeout: '60000',
        connectionTimeout: '30000',
        triggerHintsStart: '',
        triggerHintsEnd: '',
        triggerHintsPhrases: '',
      };
    }
  });

  const [currentField, setCurrentField] = useState<FormField>('name');
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [quickMode, setQuickMode] = useState(!service);

  // Calculate fields based on quick mode
  const fields = getFieldOrder(formData.transport, quickMode);

  // Handle field navigation
  const goToNextField = (overrideTransport?: TransportType) => {
    const transportForFields = overrideTransport ?? formData.transport;
    const fieldsForTransport = getFieldOrder(transportForFields, quickMode);
    const currentIndex = fieldsForTransport.indexOf(currentField);
    if (currentIndex < fieldsForTransport.length - 1) {
      const nextField = fieldsForTransport[currentIndex + 1];
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
          const newTransport = item.value as TransportType;
          setFormData({ ...formData, transport: newTransport });
          goToNextField(newTransport);
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
        onSubmit={() => goToNextField()}
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

          {previewService.headers && Object.keys(previewService.headers).length > 0 && (
            <Text><Text bold>Headers:</Text> {Object.entries(previewService.headers).map(([k, v]) => `${k}: ${v}`).join(', ')}</Text>
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
  // Adjust padding and margins based on terminal height for small terminals
  const isCompactMode = terminalHeight < 18;
  const formPadding = isCompactMode ? 0 : 1;
  const formMarginBottom = isCompactMode ? 0 : 1;
  const fieldPadding = isCompactMode ? 0 : 1;
  const fieldMarginBottom = isCompactMode ? 0 : 1;
  const helpPaddingX = isCompactMode ? 0 : 1;
  const showProgress = !isCompactMode;
  const showAllErrors = !isCompactMode || errors.length <= 2;

  return (
    <Box flexDirection="column" padding={formPadding}>
      <Box borderStyle="round" borderColor="cyan" padding={formPadding} marginBottom={formMarginBottom}>
        <Text bold color="cyan">
          {service ? 'Edit Service' : 'Add New Service'}
        </Text>
      </Box>

      {/* Progress indicator - hidden in compact mode */}
      {showProgress && (
        <Box marginBottom={1}>
          <Text dimColor>
            Step {fields.indexOf(currentField) + 1} of {fields.length}
          </Text>
        </Box>
      )}

      {/* Current field */}
      <Box flexDirection="column" borderStyle="single" padding={fieldPadding} marginBottom={fieldMarginBottom}>
        <Text bold color="yellow">{getFieldLabel(currentField)}</Text>
        <Text dimColor>{getFieldHelp(currentField)}</Text>
        <Box marginTop={1}>
          {renderField()}
        </Box>
      </Box>

      {/* Validation errors */}
      {currentError && (
        <Box borderStyle="single" borderColor="red" padding={fieldPadding} marginBottom={fieldMarginBottom}>
          <Text color="red">✗ {currentError.message}</Text>
        </Box>
      )}

      {/* All validation errors - limited in compact mode */}
      {(showAllErrors && errors.length > 0) && (
        <Box flexDirection="column" borderStyle="single" borderColor="red" padding={fieldPadding} marginBottom={fieldMarginBottom}>
          <Text bold color="red">Validation Errors:</Text>
          {errors.map((error, index) => (
            <Text key={index} color="red">
              • {getFieldLabel(error.field)}: {error.message}
            </Text>
          ))}
        </Box>
      )}

      {/* Navigation help */}
      <Box borderStyle="single" borderColor="gray" paddingX={helpPaddingX}>
        <Text dimColor>
          {currentField === 'confirm' 
            ? '↑/↓: Select | Enter: Confirm | p: Preview | Esc: Cancel'
            : 'Enter: Next field | Esc: Cancel'}
        </Text>
      </Box>
    </Box>
  );
};
