/**
 * Unified Service Form Component
 *
 * Single-page progressive form for adding and editing services.
 * Shows all fields on one page with progressive disclosure for optional fields.
 * Provides inline validation and real-time preview.
 * Handles terminal height constraints for small terminals.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import SelectInput from 'ink-select-input';
import { SingleLineInput } from './SingleLineInput.js';
import type { ServiceDefinition, TransportType } from '../../types/service.js';
import { fieldHelp, fieldPlaceholder } from './service-field-config.js';

export interface ServiceFormUnifiedProps {
  /** Existing service to edit (undefined for new service) */
  service?: ServiceDefinition | undefined;
  /** Callback when form is submitted */
  onSubmit: (service: ServiceDefinition) => void;
  /** Callback when form is cancelled */
  onCancel: () => void;
  /**
   * Vertical space the host actually leaves for this form (terminal height minus
   * the host's own header/footer). Falls back to the raw terminal height.
   */
  terminalHeight?: number | undefined;
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
  | 'triggerHintsPhrases';

/**
 * Field configuration
 */
interface FieldConfig {
  field: FormField;
  label: string;
  help: string;
  required: boolean;
  type: 'text' | 'select';
  dependsOn?: { field: FormField; value: string };
}

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
 * Get field configurations
 */
function getFieldConfigs(transport: TransportType): FieldConfig[] {
  const configs: FieldConfig[] = [
    {
      field: 'name',
      label: 'Service Name',
      help: fieldHelp.name,
      required: true,
      type: 'text',
    },
    {
      field: 'transport',
      label: 'Transport Type',
      help: fieldHelp.transport,
      required: true,
      type: 'select',
    },
  ];

  if (transport === 'stdio') {
    configs.push({
      field: 'command',
      label: 'Command',
      help: fieldHelp.command,
      required: true,
      type: 'text',
      dependsOn: { field: 'transport', value: 'stdio' },
    });
    configs.push({
      field: 'args',
      label: 'Arguments',
      help: fieldHelp.args,
      required: false,
      type: 'text',
      dependsOn: { field: 'transport', value: 'stdio' },
    });
    configs.push({
      field: 'env',
      label: 'Environment Variables',
      help: fieldHelp.env,
      required: false,
      type: 'text',
      dependsOn: { field: 'transport', value: 'stdio' },
    });
  } else {
    configs.push({
      field: 'url',
      label: 'URL',
      help: fieldHelp.url,
      required: true,
      type: 'text',
      dependsOn: { field: 'transport', value: transport },
    });
    configs.push({
      field: 'headers',
      label: 'Headers',
      help: fieldHelp.headers,
      required: false,
      type: 'text',
      dependsOn: { field: 'transport', value: transport },
    });
  }

  configs.push(
    {
      field: 'tags',
      label: 'Tags',
      help: fieldHelp.tags,
      required: false,
      type: 'text',
    },
    {
      field: 'enabled',
      label: 'Enabled',
      help: fieldHelp.enabled,
      required: false,
      type: 'select',
    },
    {
      field: 'maxConnections',
      label: 'Max Connections',
      help: fieldHelp.maxConnections,
      required: false,
      type: 'text',
    },
    {
      field: 'idleTimeout',
      label: 'Idle Timeout',
      help: fieldHelp.idleTimeout,
      required: false,
      type: 'text',
    },
    {
      field: 'connectionTimeout',
      label: 'Connection Timeout',
      help: fieldHelp.connectionTimeout,
      required: false,
      type: 'text',
    },
    {
      field: 'triggerHintsStart',
      label: 'Trigger: On Session Start',
      help: fieldHelp.triggerHintsStart,
      required: false,
      type: 'text',
    },
    {
      field: 'triggerHintsEnd',
      label: 'Trigger: On Session End',
      help: fieldHelp.triggerHintsEnd,
      required: false,
      type: 'text',
    },
    {
      field: 'triggerHintsPhrases',
      label: 'Trigger Phrases',
      help: fieldHelp.triggerHintsPhrases,
      required: false,
      type: 'text',
    }
  );

  return configs;
}

/**
 * Validate single field
 */
function validateField(
  field: FormField,
  value: string | boolean,
  transport: TransportType
): string | null {
  // Only text fields carry text; the Enabled select passes a boolean.
  const text = typeof value === 'string' ? value : '';
  const trimmed = text.trim();

  switch (field) {
    case 'name':
      if (!trimmed) {
        return 'Service name is required';
      }
      if (!/^[a-zA-Z0-9_-]+$/.test(text)) {
        return 'Only letters, numbers, hyphens, and underscores allowed';
      }
      return null;

    case 'command':
      if (transport === 'stdio' && !trimmed) {
        return 'Command is required for stdio transport';
      }
      return null;

    case 'url':
      if (transport !== 'stdio' && !trimmed) {
        return 'URL is required for HTTP/SSE transport';
      }
      if (trimmed && !/^https?:\/\/.+/.test(text)) {
        return 'URL must start with http:// or https://';
      }
      return null;

    case 'maxConnections': {
      if (trimmed) {
        const num = parseInt(text, 10);
        if (isNaN(num) || num < 1 || num > 100) {
          return 'Must be between 1 and 100';
        }
      }
      return null;
    }

    case 'idleTimeout':
    case 'connectionTimeout': {
      if (trimmed) {
        const num = parseInt(text, 10);
        if (isNaN(num) || num < 1000) {
          return 'Must be at least 1000ms';
        }
      }
      return null;
    }

    default:
      return null;
  }
}

/**
 * Convert form data to service definition
 */
export function formDataToService(data: FormData): ServiceDefinition {
  const service: ServiceDefinition = {
    name: data.name.trim(),
    transport: data.transport,
    enabled: data.enabled,
    tags: data.tags
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0),
    connectionPool: {
      maxConnections: parseInt(data.maxConnections || '5', 10),
      idleTimeout: parseInt(data.idleTimeout || '60000', 10),
      connectionTimeout: parseInt(data.connectionTimeout || '30000', 10),
    },
  };

  if (data.transport === 'stdio') {
    service.command = data.command.trim();

    if (data.args.trim()) {
      service.args = data.args
        .split(',')
        .map((a) => a.trim())
        .filter((a) => a.length > 0);
    }

    if (data.env.trim()) {
      service.env = {};
      const envPairs = data.env
        .split(',')
        .map((e) => e.trim())
        .filter((e) => e.length > 0);
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
      const headerPairs = data.headers
        .split(',')
        .map((h) => h.trim())
        .filter((h) => h.length > 0);
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
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
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
 * Collapsed-field value. Booleans read Yes/No (the raw `true` leaked the
 * internal representation), and empty values read as a grey placeholder.
 */
const formatFieldValue = (field: FormField, data: FormData): React.ReactNode => {
  const value = data[field as keyof FormData];
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  const text = value?.toString() ?? '';
  return text.length > 0 ? text : <Text color="gray">(empty)</Text>;
};

/**
 * Unified Service Form Component
 */
export const ServiceFormUnified: React.FC<ServiceFormUnifiedProps> = ({
  service,
  onSubmit,
  onCancel,
  terminalHeight: terminalHeightProp,
}) => {
  const { stdout } = useStdout();
  const terminalHeight = terminalHeightProp ?? (stdout?.rows || 24);

  // Initialize form data
  const [formData, setFormData] = useState<FormData>(() => {
    if (service) {
      return {
        name: service.name,
        transport: service.transport,
        command: service.command || '',
        url: service.url || '',
        args: service.args?.join(', ') || '',
        env: service.env
          ? Object.entries(service.env)
              .map(([k, v]) => `${k}=${v}`)
              .join(', ')
          : '',
        headers:
          service.transport === 'stdio'
            ? ''
            : service.headers
              ? Object.entries(service.headers)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(', ')
              : '',
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
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Map<FormField, string>>(new Map());
  const [touched, setTouched] = useState<Set<FormField>>(new Set());
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Get field configurations based on transport type
  const fieldConfigs = getFieldConfigs(formData.transport);
  const requiredFields = fieldConfigs.filter((c) => c.required).map((c) => c.field);
  const connectionPoolFields: FormField[] = ['maxConnections', 'idleTimeout', 'connectionTimeout'];
  const advancedOnlyFields: FormField[] = [
    ...connectionPoolFields,
    'triggerHintsStart',
    'triggerHintsEnd',
    'triggerHintsPhrases',
  ];

  const HEADER_LINES = 4;
  const FOOTER_LINES = 3;
  const AVAILABLE_LINES = Math.max(1, terminalHeight - HEADER_LINES - FOOTER_LINES);

  // Default to compact mode - current field expanded, others collapsed
  const isCompactMode = true;

  /**
   * Lines a field actually occupies. Counting rows instead of assuming one line
   * per field is what keeps the form inside the viewport: a select renders one
   * row per option, so the old `SERVICE_ITEM_LINES`-style math under-counted and
   * pushed the whole frame past the terminal, which corrupts the screen.
   */
  const fieldHeight = (config: FieldConfig): number => {
    if (config.type !== 'select') {
      return 2; // label + value/editor row
    }
    const optionRows = config.field === 'transport' ? 3 : 2; // stdio/sse/http | Yes/No
    return optionRows + 1; // label + options
  };

  // Chrome the form draws itself: title box(3) + fields box borders(2) +
  // field-help box(3) + navigation box(3) + advanced hint + scroll indicators(2).
  const FORM_CHROME_LINES = 3 + 2 + 3 + 3 + (showAdvanced ? 1 : 2) + 2;
  const FIELD_BUDGET = Math.max(3, AVAILABLE_LINES - FORM_CHROME_LINES);

  /**
   * Fields to render: the window always contains the current field and expands
   * outward while the line budget allows, so the focused field can never be
   * scrolled off-screen.
   */
  const { visibleConfigs, hasMoreAbove, hasMoreBelow } = useMemo(() => {
    const heights = fieldConfigs.map(fieldHeight);
    const currentIdx = Math.max(
      0,
      fieldConfigs.findIndex((c) => c.field === currentField)
    );
    let used = heights[currentIdx] ?? 1;
    let start = currentIdx;
    let end = currentIdx + 1;
    for (;;) {
      let grew = false;
      if (end < fieldConfigs.length && used + (heights[end] ?? 1) <= FIELD_BUDGET) {
        used += heights[end] ?? 1;
        end += 1;
        grew = true;
      }
      if (start > 0 && used + (heights[start - 1] ?? 1) <= FIELD_BUDGET) {
        used += heights[start - 1] ?? 1;
        start -= 1;
        grew = true;
      }
      if (!grew) {
        break;
      }
    }
    return {
      visibleConfigs: fieldConfigs.slice(start, end),
      hasMoreAbove: start > 0,
      hasMoreBelow: end < fieldConfigs.length,
    };
  }, [fieldConfigs, currentField, FIELD_BUDGET, showAdvanced]);

  // Get current field config for help text
  const currentFieldConfig = fieldConfigs.find((c) => c.field === currentField);
  const currentFieldHelp = currentFieldConfig?.help || '';

  // Validate current field when it changes
  useEffect(() => {
    if (touched.has(currentField)) {
      const value = formData[currentField as keyof FormData];
      const error = validateField(currentField, value, formData.transport);

      setFieldErrors((prev) => {
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
    const isAdvanced = advancedOnlyFields.includes(config.field);
    return config.required || !isAdvanced || (showAdvanced && isAdvanced);
  };

  // Handle field navigation
  const goToNextField = (overrideTransport?: TransportType) => {
    const transportForFields = overrideTransport ?? formData.transport;
    const configsForTransport = getFieldConfigs(transportForFields);
    const currentIndex = configsForTransport.findIndex((c) => c.field === currentField);
    if (currentIndex < configsForTransport.length - 1) {
      // Mark current field as touched
      setTouched((prev) => new Set(prev).add(currentField));

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
    const currentIndex = fieldConfigs.findIndex((c) => c.field === currentField);
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
    requiredFields.forEach((f) => allTouched.add(f));
    setTouched(allTouched);

    if (!isFormValid()) {
      // Focus the first offending field AND say so — a silent no-op looks like
      // a broken save button when the field is already focused.
      for (const config of fieldConfigs) {
        const value = formData[config.field as keyof FormData];
        const error = validateField(config.field, value, formData.transport);
        if (error) {
          setCurrentField(config.field);
          setSubmitError(`${config.label}: ${error}`);
          return;
        }
      }
      setSubmitError('Some fields are invalid.');
      return;
    }

    setSubmitError(null);
    const serviceDefinition = formDataToService(formData);
    onSubmit(serviceDefinition);
  };

  // Handle keyboard input
  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    // Field navigation — the render window follows the focused field, so
    // arrows move between fields instead of scrolling a fixed viewport.
    if (key.upArrow) {
      goToPrevField();
      return;
    }
    if (key.downArrow) {
      goToNextField();
      return;
    }

    // Toggle advanced options (Ctrl+A) - for optional fields like tags, env, args
    if (input === 'a' && key.ctrl) {
      setShowAdvanced(!showAdvanced);
      return;
    }

    // Submit form (Ctrl+S). The chord itself never reaches the text editor
    // (SingleLineInput ignores ctrl chords), so no stray 's' is inserted.
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

    // Confirm a field and move on (Enter). Selects handle Enter themselves.
    if (key.return && currentField !== 'transport' && currentField !== 'enabled') {
      setTouched((prev) => new Set(prev).add(currentField));
      goToNextField();
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
        initialIndex={items.findIndex((i) => i.value === formData.transport)}
        onSelect={(item) => {
          const newTransport = item.value as TransportType;
          setFormData({ ...formData, transport: newTransport });
          setTouched((prev) => new Set(prev).add('transport'));
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
          setTouched((prev) => new Set(prev).add('enabled'));
        }}
      />
    );
  };

  // Render text input. SingleLineInput ignores control chords outright (so
  // Ctrl+S/Ctrl+A can never be typed into the field) and accepts pasted chunks.
  const renderTextInput = (field: FormField) => {
    const placeholder = fieldPlaceholder[field];
    return (
      <SingleLineInput
        value={formData[field as keyof FormData] as string}
        onChange={(value) => {
          setFormData({ ...formData, [field]: value });
          setSubmitError(null);
        }}
        {...(placeholder ? { placeholder } : {})}
      />
    );
  };

  // Render field
  const renderField = (config: FieldConfig, isCurrent: boolean) => {
    const error = fieldErrors.get(config.field);
    const hasError = touched.has(config.field) && error;
    const isAdvanced = advancedOnlyFields.includes(config.field);
    const isVisible = config.required || !isAdvanced || (showAdvanced && isAdvanced);

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
              {config.type === 'select'
                ? config.field === 'transport'
                  ? renderTransportSelector()
                  : config.field === 'enabled'
                    ? renderEnabledSelector()
                    : null
                : renderTextInput(config.field)}
            </>
          ) : (
            <Text color={hasError ? 'red' : 'green'}>
              {formatFieldValue(config.field, formData)}
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

  return (
    <Box flexDirection="column" padding={formPadding}>
      {/* Header */}
      <Box
        borderStyle="round"
        borderColor="cyan"
        padding={formPadding}
        marginBottom={formMarginBottom}
      >
        <Text bold color="cyan">
          {' '}
          {service ? 'Edit Service' : 'Add New Service'}
        </Text>
      </Box>

      {/* Form fields */}
      <Box
        flexDirection="column"
        borderStyle="single"
        padding={fieldPadding}
        marginBottom={fieldMarginBottom}
      >
        {/* Scroll indicator */}
        {hasMoreAbove && (
          <Box justifyContent="center">
            <Text dimColor>▲ more above</Text>
          </Box>
        )}

        {visibleConfigs.map((config) => renderField(config, config.field === currentField))}

        {/* Scroll indicator */}
        {hasMoreBelow && (
          <Box justifyContent="center">
            <Text dimColor>▼ more below</Text>
          </Box>
        )}

        {/* Advanced options toggle */}
        {!showAdvanced && (
          <Box marginTop={1}>
            <Text dimColor>Press Ctrl+A to show connection pool settings</Text>
          </Box>
        )}
      </Box>

      {/* Field help info - prominent display */}
      {currentFieldHelp && (
        <Box
          borderStyle="round"
          borderColor="yellow"
          paddingX={1}
          paddingY={0}
          marginBottom={formMarginBottom}
        >
          <Text>
            <Text color="yellow">💡 </Text>
            <Text bold color="yellow">
              {currentFieldConfig?.label}:{' '}
            </Text>
            <Text color="white">{currentFieldHelp}</Text>
          </Text>
        </Box>
      )}

      {/* Submission error — visible feedback when Ctrl+S is refused */}
      {submitError !== null && (
        <Box borderStyle="single" borderColor="red" paddingX={1}>
          <Text color="red">✗ {submitError}</Text>
        </Box>
      )}

      {/* Navigation help */}
      <Box
        borderStyle="single"
        borderColor="gray"
        paddingX={helpPaddingX}
        marginTop={formMarginBottom}
      >
        <Text dimColor>
          ↑/↓/Tab: Field | Enter: Next | Ctrl+A: Advanced | Ctrl+S: Save | Esc: Cancel
        </Text>
      </Box>
    </Box>
  );
};
