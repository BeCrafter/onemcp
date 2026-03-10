/**
 * Unified Service Form Component
 * 
 * Single-page progressive form for adding and editing services.
 * Shows all fields on one page with progressive disclosure for optional fields.
 * Provides inline validation and real-time preview.
 * Handles terminal height constraints for small terminals.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import type { ServiceDefinition, TransportType } from '../../types/service.js';

export interface ServiceFormUnifiedProps {
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
  | 'connectionTimeout';

/**
 * Field configuration
 */
interface FieldConfig {
  field: FormField;
  label: string;
  help: string;
  required: boolean;
  type: 'text' | 'select';
  dependsOn?: { field: FormField; value: any };
}

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
  headers: string;
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
 * Get field configurations
 */
function getFieldConfigs(transport: TransportType): FieldConfig[] {
  const configs: FieldConfig[] = [
    {
      field: 'name',
      label: 'Service Name',
      help: 'Unique identifier (letters, numbers, hyphens, underscores)',
      required: true,
      type: 'text',
    },
    {
      field: 'transport',
      label: 'Transport Type',
      help: 'Protocol for communication',
      required: true,
      type: 'select',
    },
  ];

  if (transport === 'stdio') {
    configs.push({
      field: 'command',
      label: 'Command',
      help: 'Command to start the MCP server (e.g., npx, node, python)',
      required: true,
      type: 'text',
      dependsOn: { field: 'transport', value: 'stdio' },
    });
    configs.push({
      field: 'args',
      label: 'Arguments',
      help: 'Command-line arguments (comma-separated, optional)',
      required: false,
      type: 'text',
      dependsOn: { field: 'transport', value: 'stdio' },
    });
    configs.push({
      field: 'env',
      label: 'Environment Variables',
      help: 'KEY=VALUE pairs (comma-separated, optional)',
      required: false,
      type: 'text',
      dependsOn: { field: 'transport', value: 'stdio' },
    });
  } else {
    configs.push({
      field: 'url',
      label: 'URL',
      help: 'HTTP(S) URL of the MCP server',
      required: true,
      type: 'text',
      dependsOn: { field: 'transport', value: transport },
    });
    configs.push({
      field: 'headers',
      label: 'Headers',
      help: 'KEY: VALUE pairs (comma-separated, optional)',
      required: false,
      type: 'text',
      dependsOn: { field: 'transport', value: transport },
    });
  }

  configs.push(
    {
      field: 'tags',
      label: 'Tags',
      help: 'Labels for categorization (comma-separated, optional)',
      required: false,
      type: 'text',
    },
    {
      field: 'enabled',
      label: 'Enabled',
      help: 'Whether this service should be active',
      required: false,
      type: 'select',
    },
    {
      field: 'maxConnections',
      label: 'Max Connections',
      help: 'Maximum concurrent connections (1-100, default: 5)',
      required: false,
      type: 'text',
    },
    {
      field: 'idleTimeout',
      label: 'Idle Timeout',
      help: 'Time before idle connections close in ms (min: 1000, default: 60000)',
      required: false,
      type: 'text',
    },
    {
      field: 'connectionTimeout',
      label: 'Connection Timeout',
      help: 'Maximum time to wait for connection in ms (min: 1000, default: 30000)',
      required: false,
      type: 'text',
    }
  );

  return configs;
}

/**
 * Validate single field
 */
function validateField(field: FormField, value: any, transport: TransportType): string | null {
  switch (field) {
    case 'name':
      if (!value.trim()) {
        return 'Service name is required';
      }
      if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
        return 'Only letters, numbers, hyphens, and underscores allowed';
      }
      return null;

    case 'command':
      if (transport === 'stdio' && !value.trim()) {
        return 'Command is required for stdio transport';
      }
      return null;

    case 'url':
      if (transport !== 'stdio' && !value.trim()) {
        return 'URL is required for HTTP/SSE transport';
      }
      if (value.trim() && !/^https?:\/\/.+/.test(value)) {
        return 'URL must start with http:// or https://';
      }
      return null;

    case 'maxConnections':
      if (value.trim()) {
        const num = parseInt(value, 10);
        if (isNaN(num) || num < 1 || num > 100) {
          return 'Must be between 1 and 100';
        }
      }
      return null;

    case 'idleTimeout':
    case 'connectionTimeout':
      if (value.trim()) {
        const num = parseInt(value, 10);
        if (isNaN(num) || num < 1000) {
          return 'Must be at least 1000ms';
        }
      }
      return null;

    default:
      return null;
  }
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
      maxConnections: parseInt(data.maxConnections || '5', 10),
      idleTimeout: parseInt(data.idleTimeout || '60000', 10),
      connectionTimeout: parseInt(data.connectionTimeout || '30000', 10),
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

  return service;
}

/**
 * Unified Service Form Component
 */
export const ServiceFormUnified: React.FC<ServiceFormUnifiedProps> = ({
  service,
  onSubmit,
  onCancel,
}) => {
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows || 24;
  
  // Initialize form data
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
      };
    }
  });

  const [currentField, setCurrentField] = useState<FormField>('name');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Map<FormField, string>>(new Map());
  const [touched, setTouched] = useState<Set<FormField>>(new Set());
  const [scrollOffset, setScrollOffset] = useState(0);
  const isCtrlAActive = useRef(false);

  // Get field configurations based on transport type
  const fieldConfigs = getFieldConfigs(formData.transport);
  const requiredFields = fieldConfigs.filter(c => c.required).map(c => c.field);
  const connectionPoolFields: FormField[] = ['maxConnections', 'idleTimeout', 'connectionTimeout'];

  // Calculate visible fields based on terminal height
  const HEADER_LINES = 4;
  const FOOTER_LINES = 3;
  const AVAILABLE_LINES = Math.max(1, terminalHeight - HEADER_LINES - FOOTER_LINES);
  
  // Default to compact mode - current field expanded, others collapsed
  const isCompactMode = true;
  const COLLAPSED_FIELD_LINES = 1;
  const visibleFieldCount = Math.min(
    fieldConfigs.length,
    Math.max(3, Math.floor(AVAILABLE_LINES / COLLAPSED_FIELD_LINES))
  );

  // Get current field config for help text
  const currentFieldConfig = fieldConfigs.find(c => c.field === currentField);
  const currentFieldHelp = currentFieldConfig?.help || '';

  // Ensure scroll shows current field
  useEffect(() => {
    const currentIdx = fieldConfigs.findIndex(c => c.field === currentField);
    if (currentIdx < scrollOffset) {
      setScrollOffset(currentIdx);
    } else if (currentIdx >= scrollOffset + visibleFieldCount) {
      setScrollOffset(Math.max(0, currentIdx - visibleFieldCount + 1));
    }
  }, [currentField, fieldConfigs]);

  // Validate current field when it changes
  useEffect(() => {
    if (touched.has(currentField)) {
      const value = formData[currentField as keyof FormData];
      const error = validateField(currentField, value, formData.transport);
      
      setFieldErrors(prev => {
        const next = new Map(prev);
        if (error) {
          next.set(currentField, error);
        } else {
          next.delete(currentField);
        }
        return next;
      });
    }
  }, [formData, currentField, touched, formData.transport]);

  // Check if form is valid
  const isFormValid = (): boolean => {
    const errors: ValidationError[] = [];
    
    for (const config of fieldConfigs) {
      if (config.required) {
        const value = formData[config.field as keyof FormData];
        const error = validateField(config.field, value, formData.transport);
        if (error) {
          errors.push({ field: config.field, message: error });
        }
      }
    }

    return errors.length === 0;
  };

  const isFieldVisible = (config: FieldConfig): boolean => {
    const isConnectionPool = connectionPoolFields.includes(config.field);
    return (config.required || !isConnectionPool) || (showAdvanced && isConnectionPool);
  };

  // Handle field navigation
  const goToNextField = (overrideTransport?: TransportType) => {
    const transportForFields = overrideTransport ?? formData.transport;
    const configsForTransport = getFieldConfigs(transportForFields);
    const currentIndex = configsForTransport.findIndex(c => c.field === currentField);
    if (currentIndex < configsForTransport.length - 1) {
      // Mark current field as touched
      setTouched(prev => new Set(prev).add(currentField));
      
      // Find next visible field
      for (let i = currentIndex + 1; i < configsForTransport.length; i++) {
        const nextConfig = configsForTransport[i];
        if (nextConfig && isFieldVisible(nextConfig)) {
          setCurrentField(nextConfig.field);
          return;
        }
      }
    }
  };

  const goToPrevField = () => {
    const currentIndex = fieldConfigs.findIndex(c => c.field === currentField);
    if (currentIndex > 0) {
      // Find previous visible field
      for (let i = currentIndex - 1; i >= 0; i--) {
        const prevConfig = fieldConfigs[i];
        if (prevConfig && isFieldVisible(prevConfig)) {
          setCurrentField(prevConfig.field);
          return;
        }
      }
    }
  };

  // Handle form submission
  const handleSubmit = () => {
    // Mark all required fields as touched
    const allTouched = new Set(touched);
    requiredFields.forEach(f => allTouched.add(f));
    setTouched(allTouched);

    if (!isFormValid()) {
      // Jump to first error field
      for (const config of fieldConfigs) {
        const value = formData[config.field as keyof FormData];
        const error = validateField(config.field, value, formData.transport);
        if (error) {
          setCurrentField(config.field);
          return;
        }
      }
      return;
    }

    const serviceDefinition = formDataToService(formData);
    onSubmit(serviceDefinition);
  };

  // Handle keyboard input
  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    // Scroll up/down when form is in scroll mode
    if (key.upArrow) {
      setScrollOffset(prev => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow) {
      setScrollOffset(prev => Math.min(fieldConfigs.length - visibleFieldCount, prev + 1));
      return;
    }

    // Toggle advanced options (Ctrl+A) - for optional fields like tags, env, args
    if (input === 'a' && key.ctrl) {
      isCtrlAActive.current = true;
      setShowAdvanced(!showAdvanced);
      setTimeout(() => {
        isCtrlAActive.current = false;
      }, 2);
      return;
    }

    // Submit form (Ctrl+S)
    if (input === 's' && key.ctrl) {
      handleSubmit();
      return;
    }

    // Navigate fields (Tab / Shift+Tab)
    if (key.tab) {
      if (key.shift) {
        goToPrevField();
      } else {
        goToNextField();
      }
      return;
    }

    // Handle select fields
    if (currentField === 'transport' || currentField === 'enabled') {
      if (key.return) {
        goToNextField();
      }
    }
  });

  // Render transport selector
  const renderTransportSelector = () => {
    const items = [
      { label: 'stdio', value: 'stdio' },
      { label: 'sse', value: 'sse' },
      { label: 'http', value: 'http' },
    ];

    return (
      <SelectInput
        items={items}
        initialIndex={items.findIndex(i => i.value === formData.transport)}
        onSelect={(item) => {
          const newTransport = item.value as TransportType;
          setFormData({ ...formData, transport: newTransport });
          setTouched(prev => new Set(prev).add('transport'));
          goToNextField(newTransport);
        }}
      />
    );
  };

  // Render enabled selector
  const renderEnabledSelector = () => {
    const items = [
      { label: 'Yes', value: true },
      { label: 'No', value: false },
    ];

    return (
      <SelectInput
        items={items}
        initialIndex={formData.enabled ? 0 : 1}
        onSelect={(item) => {
          setFormData({ ...formData, enabled: item.value as boolean });
          setTouched(prev => new Set(prev).add('enabled'));
        }}
      />
    );
  };

  // Render text input
  const renderTextInput = (field: FormField) => {
    return (
      <TextInput
        value={formData[field as keyof FormData] as string}
        onChange={(value) => {
          // Ignore changes when Ctrl+A is being processed
          if (isCtrlAActive.current) {
            return;
          }
          setFormData({ ...formData, [field]: value });
        }}
        onSubmit={() => {
          setTouched(prev => new Set(prev).add(field));
          goToNextField();
        }}
      />
    );
  };

  // Render field
  const renderField = (config: FieldConfig, isCurrent: boolean) => {
    const error = fieldErrors.get(config.field);
    const hasError = touched.has(config.field) && error;
    const isConnectionPool = connectionPoolFields.includes(config.field);
    const isVisible = (config.required || !isConnectionPool) || (showAdvanced && isConnectionPool);

    if (!isVisible) {
      return null;
    }

    // In compact mode, help is shown in the dedicated help area
    const showHelp = !isCompactMode;

    return (
      <Box key={config.field} flexDirection="column" marginBottom={fieldMarginBottom}>
        <Box>
          <Text bold color={isCurrent ? 'cyan' : 'white'}>
            {isCurrent ? '▶ ' : '  '}
            {config.label}
            {config.required && <Text color="red">*</Text>}
          </Text>
        </Box>
        
        {/* Help text only shown in non-compact mode (it's in dedicated area in compact mode) */}
        {showHelp && (
          <Box marginLeft={2}>
            <Text dimColor>{config.help}</Text>
          </Box>
        )}

        <Box marginLeft={2} marginTop={isCompactMode ? 0 : 0}>
          {isCurrent ? (
            <>
              {config.type === 'select' ? (
                config.field === 'transport' ? renderTransportSelector() :
                config.field === 'enabled' ? renderEnabledSelector() : null
              ) : (
                renderTextInput(config.field)
              )}
            </>
          ) : (
            <Text color={hasError ? 'red' : 'green'}>
              {formData[config.field as keyof FormData]?.toString() || <Text dimColor>(empty)</Text>}
            </Text>
          )}
        </Box>

        {hasError && (
          <Box marginLeft={2}>
            <Text color="red">✗ {error}</Text>
          </Box>
        )}
      </Box>
    );
  };

  // Adjust padding and margins based on terminal height for small terminals
  const isUltraCompactMode = terminalHeight < 15;
  const formPadding = isCompactMode ? 0 : 1;
  const formMarginBottom = isCompactMode ? 0 : 1;
  const fieldPadding = isCompactMode ? 0 : 1;
  const fieldMarginBottom = isCompactMode ? (isUltraCompactMode ? 0 : 0) : 1;
  const helpPaddingX = isCompactMode ? 0 : 1;

  // Calculate visible fields based on scroll
  const visibleConfigs = fieldConfigs.slice(scrollOffset, scrollOffset + visibleFieldCount);
  const hasMoreAbove = scrollOffset > 0;
  const hasMoreBelow = scrollOffset + visibleFieldCount < fieldConfigs.length;

  return (
    <Box flexDirection="column" padding={formPadding}>
      {/* Header */}
      <Box borderStyle="round" borderColor="cyan" padding={formPadding} marginBottom={formMarginBottom}>
        <Text bold color="cyan">
          {service ? 'Edit Service' : 'Add New Service'}
        </Text>
      </Box>

      {/* Form fields */}
      <Box flexDirection="column" borderStyle="single" padding={fieldPadding} marginBottom={fieldMarginBottom}>
        {/* Scroll indicator */}
        {hasMoreAbove && (
          <Box justifyContent="center">
            <Text dimColor>▲ more above</Text>
          </Box>
        )}
        
        {visibleConfigs.map(config => 
          renderField(config, config.field === currentField)
        )}

        {/* Scroll indicator */}
        {hasMoreBelow && (
          <Box justifyContent="center">
            <Text dimColor>▼ more below</Text>
          </Box>
        )}

        {/* Advanced options toggle */}
        {!showAdvanced && (
          <Box marginTop={1}>
            <Text dimColor>
              Press Ctrl+A to show connection pool settings
            </Text>
          </Box>
        )}
      </Box>

      {/* Field help info - prominent display */}
      {currentFieldHelp && (
        <Box borderStyle="round" borderColor="yellow" paddingX={1} paddingY={0} marginBottom={formMarginBottom}>
          <Text>
            <Text color="yellow">💡 </Text>
            <Text bold color="yellow">{currentFieldConfig?.label}: </Text>
            <Text color="white">{currentFieldHelp}</Text>
          </Text>
        </Box>
      )}

      {/* Navigation help */}
      <Box borderStyle="single" borderColor="gray" paddingX={helpPaddingX} marginTop={formMarginBottom}>
        <Text dimColor>
          ↑/↓: Scroll | Tab/Enter: Next | Ctrl+A: Advanced | Ctrl+S: Save | Esc: Cancel
        </Text>
      </Box>
    </Box>
  );
};
