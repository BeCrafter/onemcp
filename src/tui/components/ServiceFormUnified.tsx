/**
 * Unified Service Form Component
 *
 * Single-page form for adding and editing services, laid out as a flat
 * two-column list: one row per field (`Label  value`), one box around the fields,
 * and plain lines for the title, the focused field's help and the key hints.
 * No section rules, no group headings, no nested boxes — the earlier sectioned
 * version drew four full-width rules inside a four-box stack, twelve horizontal
 * lines in one screen, which read as noise rather than structure, and its
 * label-on-its-own-row layout spent a row per field (mostly empty) on nothing.
 *
 * Row math is exact on purpose. Every field occupies a fixed number of rows (one,
 * plus one for an inline error) and every value is windowed to a single row by
 * its editor, so the render window can never push the frame past the terminal —
 * a frame taller than the viewport makes ink's absolute writes land on the wrong
 * rows.
 *
 * The form owns ALL keys. The enumerated fields render as inline single-row
 * radios (see InlineSelect) instead of a nested dropdown: in ink every mounted
 * `useInput` sees every keystroke, so a child select's own ↑/↓ handler raced the
 * form's field navigation and the value could never be changed.
 */

import React, { useState, useMemo } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { SingleLineInput } from './SingleLineInput.js';
import { InlineSelect } from './InlineSelect.js';
import { fieldHelp, fieldPlaceholder } from './service-field-config.js';
import { displayWidth, truncateDisplay, wrapDisplay } from '../text-layout.js';
import type { ServiceDefinition, TransportType } from '../../types/service.js';

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
  /**
   * True while the host renders its own dialog (delete/overwrite confirmation).
   * The form then stops reading keys AND stops mounting editors — otherwise the
   * `y`/`n` that answers the dialog is typed into the focused field as well,
   * corrupting the value that is about to be saved.
   */
  suspended?: boolean | undefined;
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

const FORM_FIELDS: readonly FormField[] = [
  'name',
  'transport',
  'command',
  'url',
  'args',
  'env',
  'headers',
  'tags',
  'enabled',
  'maxConnections',
  'idleTimeout',
  'connectionTimeout',
  'triggerHintsStart',
  'triggerHintsEnd',
  'triggerHintsPhrases',
];

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
 * Field configuration
 */
interface FieldConfig {
  field: FormField;
  label: string;
  help: string;
  required: boolean;
  type: 'text' | 'select';
  /** Folded away until Ctrl+A. */
  advanced: boolean;
}

/** Enumerated fields: the stored values and how they are spelled out. */
const TRANSPORT_VALUES: readonly string[] = ['stdio', 'sse', 'http'];
const ENABLED_VALUES: readonly string[] = ['on', 'off'];

const SELECT_LABELS: Record<string, string> = { on: 'On', off: 'Off' };

function selectValues(field: FormField): readonly string[] {
  if (field === 'transport') {
    return TRANSPORT_VALUES;
  }
  if (field === 'enabled') {
    return ENABLED_VALUES;
  }
  return [];
}

/** The enumerated field's current value as it is stored in FormData. */
function selectValue(field: FormField, data: FormData): string {
  return field === 'enabled' ? (data.enabled ? 'on' : 'off') : data.transport;
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
      advanced: false,
    },
    {
      field: 'transport',
      label: 'Transport',
      help: fieldHelp.transport,
      required: true,
      type: 'select',
      advanced: false,
    },
  ];

  if (transport === 'stdio') {
    configs.push(
      {
        field: 'command',
        label: 'Command',
        help: fieldHelp.command,
        required: true,
        type: 'text',
        advanced: false,
      },
      {
        field: 'args',
        label: 'Arguments',
        help: fieldHelp.args,
        required: false,
        type: 'text',
        advanced: false,
      },
      {
        field: 'env',
        label: 'Environment',
        help: fieldHelp.env,
        required: false,
        type: 'text',
        advanced: false,
      }
    );
  } else {
    configs.push(
      {
        field: 'url',
        label: 'URL',
        help: fieldHelp.url,
        required: true,
        type: 'text',
        advanced: false,
      },
      {
        field: 'headers',
        label: 'Headers',
        help: fieldHelp.headers,
        required: false,
        type: 'text',
        advanced: false,
      }
    );
  }

  configs.push(
    {
      field: 'tags',
      label: 'Tags',
      help: fieldHelp.tags,
      required: false,
      type: 'text',
      advanced: false,
    },
    {
      field: 'enabled',
      label: 'Enabled',
      help: fieldHelp.enabled,
      required: false,
      type: 'select',
      advanced: false,
    },
    {
      field: 'maxConnections',
      label: 'Max Connections',
      help: fieldHelp.maxConnections,
      required: false,
      type: 'text',
      advanced: true,
    },
    {
      field: 'idleTimeout',
      label: 'Idle Timeout',
      help: fieldHelp.idleTimeout,
      required: false,
      type: 'text',
      advanced: true,
    },
    {
      field: 'connectionTimeout',
      label: 'Connection Timeout',
      help: fieldHelp.connectionTimeout,
      required: false,
      type: 'text',
      advanced: true,
    },
    {
      field: 'triggerHintsStart',
      label: 'Trigger on start',
      help: fieldHelp.triggerHintsStart,
      required: false,
      type: 'text',
      advanced: true,
    },
    {
      field: 'triggerHintsEnd',
      label: 'Trigger on end',
      help: fieldHelp.triggerHintsEnd,
      required: false,
      type: 'text',
      advanced: true,
    },
    {
      field: 'triggerHintsPhrases',
      label: 'Trigger phrases',
      help: fieldHelp.triggerHintsPhrases,
      required: false,
      type: 'text',
      advanced: true,
    }
  );

  return configs;
}

/**
 * Widest label over BOTH transport variants, so the label column keeps its width
 * when the transport switches (a column that resizes on every toggle would make
 * the whole form jump).
 */
const LABEL_TEXT_WIDTH = Math.max(
  ...getFieldConfigs('stdio').map((config) => displayWidth(config.label)),
  ...getFieldConfigs('http').map((config) => displayWidth(config.label))
);

/** Cells reserved for the focus marker; both states are padded to this width, and
 * in the stacked layout the value row is indented by the same amount.
 */
const MARKER_WIDTH = 3;
/** Gap between the label cell and the value cell in the two-column layout. */
const COLUMN_GAP = 2;
/**
 * Value width below which the two-column layout is dropped for the stacked one.
 *
 * The two-column form is the better default — the whole service fits on one
 * screen and the label/value pairing is carried by alignment rather than by
 * colour — but it spends ~24 cells on the label column, and below ~60 cells the
 * value column starts clipping the arg/env/header examples that tell you what to
 * type. Narrow terminals therefore stack, the same way ServiceList drops its
 * tags and tool-count columns before letting the endpoint collapse.
 */
const MIN_TABLE_VALUE_WIDTH = 60;
/** The value column never collapses below this, even on a tiny terminal. */
const MIN_VALUE_WIDTH = 20;

/** Marker glyph plus its padding. `▶` renders two cells wide on some terminals,
 * so the idle form keeps three spaces — the same convention the parameter list
 * uses (see tool-param-schema.ts) — leaving every label at the same cell.
 */
const focusMarker = (focused: boolean): string => (focused ? '▶ ' : '   ');

/**
 * Validate one field; null when the value is acceptable. Optional fields are
 * only checked when they carry a value.
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

/** Form data for a new service, or the current values of `service`. */
function buildInitialFormData(service?: ServiceDefinition): FormData {
  if (!service) {
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
    tags: service.tags?.join(', ') ?? '',
    enabled: service.enabled,
    maxConnections: (service.connectionPool?.maxConnections ?? 5).toString(),
    idleTimeout: (service.connectionPool?.idleTimeout ?? 60000).toString(),
    connectionTimeout: (service.connectionPool?.connectionTimeout ?? 30000).toString(),
    triggerHintsStart: service.triggerHints?.onSessionStart || '',
    triggerHintsEnd: service.triggerHints?.onSessionEnd || '',
    triggerHintsPhrases: service.triggerHints?.phrases?.join(', ') || '',
  };
}

/**
 * Convert form data to service definition.
 *
 * `base` is the service being edited; state the form has no input for is carried
 * over verbatim. `toolStates` especially — dropping it silently re-enabled every
 * tool the user had switched off.
 */
export function formDataToService(data: FormData, base?: ServiceDefinition): ServiceDefinition {
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

  if (base?.toolStates !== undefined) {
    service.toolStates = base.toolStates;
  }

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

type Entry = { kind: 'field'; config: FieldConfig } | { kind: 'advanced' };

/**
 * Unified Service Form Component
 */
export const ServiceFormUnified: React.FC<ServiceFormUnifiedProps> = ({
  service,
  onSubmit,
  onCancel,
  terminalHeight: terminalHeightProp,
  suspended = false,
}) => {
  const { stdout } = useStdout();
  const terminalHeight = terminalHeightProp ?? (stdout?.rows || 24);
  const terminalWidth = stdout?.columns || 80;

  const [initialData] = useState<FormData>(() => buildInitialFormData(service));
  const [formData, setFormData] = useState<FormData>(initialData);
  const [currentField, setCurrentField] = useState<FormField>('name');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [discardPending, setDiscardPending] = useState(false);
  const [touched, setTouched] = useState<ReadonlySet<FormField>>(new Set());

  const fieldConfigs = useMemo(() => getFieldConfigs(formData.transport), [formData.transport]);

  /** Fields the user has changed since the form opened. */
  const dirtyFields = useMemo(() => {
    const dirty = new Set<FormField>();
    for (const field of FORM_FIELDS) {
      if (formData[field] !== initialData[field]) {
        dirty.add(field);
      }
    }
    return dirty;
  }, [formData, initialData]);

  /** Errors follow the values, so correcting a field clears its own error. */
  const errors = useMemo(() => {
    const next = new Map<FormField, string>();
    for (const config of fieldConfigs) {
      const error = validateField(config.field, formData[config.field], formData.transport);
      if (error) {
        next.set(config.field, error);
      }
    }
    return next;
  }, [fieldConfigs, formData]);

  const shownError = (field: FormField): string | undefined =>
    touched.has(field) ? errors.get(field) : undefined;

  const currentConfig = fieldConfigs.find((config) => config.field === currentField);
  const currentHelp =
    currentField === 'name' && service !== undefined && formData.name !== service.name
      ? 'Renaming replaces the old entry. Tool states and other settings are kept.'
      : (currentConfig?.help ?? '');

  const isVisible = (config: FieldConfig): boolean => !config.advanced || showAdvanced;

  // ---------------------------------------------------------------- navigation

  const goToNextField = (): void => {
    const index = fieldConfigs.findIndex((config) => config.field === currentField);
    for (let i = index + 1; i < fieldConfigs.length; i += 1) {
      const config = fieldConfigs[i];
      if (config !== undefined && isVisible(config)) {
        setTouched((prev) => new Set(prev).add(currentField));
        setCurrentField(config.field);
        return;
      }
    }
  };

  const goToPrevField = (): void => {
    const index = fieldConfigs.findIndex((config) => config.field === currentField);
    for (let i = index - 1; i >= 0; i -= 1) {
      const config = fieldConfigs[i];
      if (config !== undefined && isVisible(config)) {
        setCurrentField(config.field);
        return;
      }
    }
  };

  /** ←/→ on an enumerated field: move the selection, wrapping at both ends. */
  const cycleSelect = (field: FormField, delta: number): void => {
    const values = selectValues(field);
    const index = values.indexOf(selectValue(field, formData));
    const next = values[(index + delta + values.length) % values.length];
    if (values.length === 0 || next === undefined) {
      return;
    }
    setFormData((prev) =>
      field === 'enabled'
        ? { ...prev, enabled: next === 'on' }
        : { ...prev, transport: next as TransportType }
    );
    setTouched((prev) => new Set(prev).add(field));
    setSubmitError(null);
  };

  // ------------------------------------------------------------------ submit

  const handleSubmit = (): void => {
    // Every field is validated once it has a value, not just the required ones:
    // an out-of-range timeout used to slip through and come back later as a raw
    // registry error naming a field the user could not see.
    const offender = fieldConfigs.find((config) => errors.has(config.field));
    if (offender !== undefined) {
      setTouched(new Set(FORM_FIELDS));
      if (offender.advanced && !showAdvanced) {
        setShowAdvanced(true);
      }
      setCurrentField(offender.field);
      setSubmitError(`${offender.label}: ${errors.get(offender.field) ?? 'invalid value'}`);
      return;
    }

    setSubmitError(null);
    onSubmit(formDataToService(formData, service));
  };

  // ------------------------------------------------------------------- input

  useInput(
    (input, key) => {
      // The discard confirmation owns the keyboard while it is up. No editor is
      // mounted in that state, so nothing can leak into a field.
      if (discardPending) {
        if (input === 'y' || input === 'Y') {
          onCancel();
        } else if (input === 'n' || input === 'N' || key.escape) {
          setDiscardPending(false);
        }
        return;
      }

      if (key.escape) {
        if (dirtyFields.size > 0) {
          setDiscardPending(true);
        } else {
          onCancel();
        }
        return;
      }

      if (input === 's' && key.ctrl) {
        handleSubmit();
        return;
      }

      if (input === 'a' && key.ctrl) {
        const next = !showAdvanced;
        setShowAdvanced(next);
        // Expanding parks the focus on the first revealed field, collapsing walks
        // back to one that stays on screen — the focus never sits on a hidden row.
        if (next) {
          setCurrentField('maxConnections');
        } else if (currentConfig?.advanced === true) {
          setCurrentField('enabled');
        }
        return;
      }

      if (key.upArrow || (key.tab && key.shift)) {
        goToPrevField();
        return;
      }
      if (key.downArrow || key.tab) {
        goToNextField();
        return;
      }

      // ←/→ belongs to the focused field: caret movement in a text field, value
      // selection in an enumerated one.
      if (key.leftArrow || key.rightArrow) {
        if (currentConfig?.type === 'select') {
          cycleSelect(currentField, key.rightArrow ? 1 : -1);
        }
        return;
      }

      if (key.return) {
        setTouched((prev) => new Set(prev).add(currentField));
        goToNextField();
      }
    },
    // A host dialog owns the keyboard while it is up.
    { isActive: !suspended }
  );

  // ------------------------------------------------------------------ render

  // Two layouts, chosen by the width actually available for values:
  //   table — `Label  value` on one row, labels aligned down the form
  //   stacked — label on its own row, value indented beneath it (full width)
  const innerWidth = Math.max(12, terminalWidth - 2);
  const labelTextWidth = Math.max(
    8,
    Math.min(LABEL_TEXT_WIDTH, innerWidth - MIN_VALUE_WIDTH - MARKER_WIDTH - 3)
  );
  const labelCellWidth = MARKER_WIDTH + labelTextWidth + 1 + COLUMN_GAP;
  const tableValueWidth = innerWidth - labelCellWidth;
  const useTable = tableValueWidth >= MIN_TABLE_VALUE_WIDTH;
  /** Rows one field takes: one per row in the table layout, two when stacked. */
  const fieldRows = useTable ? 1 : 2;
  /** Horizontal offset of the value (and of an inline error) cell. */
  const valueIndent = useTable ? labelCellWidth : MARKER_WIDTH;
  const valueWidth = Math.max(
    MIN_VALUE_WIDTH,
    useTable ? tableValueWidth : innerWidth - MARKER_WIDTH
  );
  const helpPrefix = `${currentConfig?.label ?? ''} · `;
  const helpWidth = Math.max(8, innerWidth - 2 - displayWidth(helpPrefix));

  const advancedCount = fieldConfigs.filter((config) => config.advanced).length;

  const entries = useMemo<Entry[]>(() => {
    // The Advanced row is drawn where the folded fields belong, so it reads as
    // their header — and, while they are folded, as the only statement of what
    // is hidden and how to reveal it.
    const list: Entry[] = fieldConfigs
      .filter((config) => !config.advanced)
      .map((config) => ({ kind: 'field', config }));
    list.push({ kind: 'advanced' });
    if (showAdvanced) {
      for (const config of fieldConfigs.filter((c) => c.advanced)) {
        list.push({ kind: 'field', config });
      }
    }
    return list;
  }, [fieldConfigs, showAdvanced]);

  // Rows the form spends outside the scrolling field window. Everything here is
  // a plain line except the body box, which is the only border on screen.
  const helpRows = currentHelp === '' ? 0 : wrapDisplay(currentHelp, helpWidth).length;
  const submitRows = submitError !== null ? 1 : 0;
  const chromeRows = (withTitle: boolean, withHelp: boolean): number =>
    1 /* hint line */ +
    2 /* body borders */ +
    (withTitle ? 1 : 0) +
    (withHelp ? helpRows : 0) +
    submitRows;

  const useTitle = terminalHeight - chromeRows(true, helpRows > 0) >= 3;
  const useHelp = helpRows > 0 && terminalHeight - chromeRows(useTitle, true) >= 3;
  const bodyBudget = Math.max(3, terminalHeight - chromeRows(useTitle, useHelp));

  const { visibleEntries, hasMoreAbove, hasMoreBelow } = useMemo(() => {
    const rows = entries.map((entry) =>
      entry.kind === 'advanced' || shownError(entry.config.field) === undefined
        ? fieldRows
        : fieldRows + 1
    );
    const focusIndex = Math.max(
      0,
      entries.findIndex((entry) => entry.kind === 'field' && entry.config.field === currentField)
    );

    // The window always contains the focused field and grows outward while the
    // row budget allows. The scroll indicators are drawn INSIDE the body, so the
    // rows they need come out of the same budget: reserving them up front (and
    // re-running once the window is known) keeps the frame inside the terminal.
    const windowFor = (budget: number): { start: number; end: number } => {
      let used = rows[focusIndex] ?? 1;
      let start = focusIndex;
      let end = focusIndex + 1;
      for (;;) {
        let grew = false;
        if (end < entries.length && used + (rows[end] ?? 1) <= budget) {
          used += rows[end] ?? 1;
          end += 1;
          grew = true;
        }
        if (start > 0 && used + (rows[start - 1] ?? 1) <= budget) {
          used += rows[start - 1] ?? 1;
          start -= 1;
          grew = true;
        }
        if (!grew) {
          break;
        }
      }
      return { start, end };
    };

    let reserved = 0;
    let win = windowFor(bodyBudget);
    for (let pass = 0; pass < 3; pass += 1) {
      const need = (win.start > 0 ? 1 : 0) + (win.end < entries.length ? 1 : 0);
      if (need <= reserved) {
        break;
      }
      reserved = need;
      win = windowFor(Math.max(3, bodyBudget - reserved));
    }

    return {
      visibleEntries: entries.slice(win.start, win.end),
      hasMoreAbove: win.start > 0,
      hasMoreBelow: win.end < entries.length,
    };
    // shownError (and therefore the row heights) reads both of these.
  }, [entries, currentField, bodyBudget, errors, touched, fieldRows]);

  const renderValue = (config: FieldConfig, editable: boolean): React.ReactNode => {
    if (config.type === 'select') {
      return (
        <InlineSelect
          options={selectValues(config.field).map((value) => ({
            value,
            label: SELECT_LABELS[value] ?? value,
          }))}
          value={selectValue(config.field, formData)}
          focused={editable}
          width={valueWidth}
        />
      );
    }

    if (editable) {
      return (
        <SingleLineInput
          value={formData[config.field] as string}
          onChange={(next) => {
            setFormData((prev) => ({ ...prev, [config.field]: next }));
            setSubmitError(null);
          }}
          width={valueWidth}
          {...(fieldPlaceholder[config.field] !== undefined
            ? { placeholder: fieldPlaceholder[config.field] as string }
            : {})}
        />
      );
    }

    const value = formData[config.field] as string;
    // The cell supplies the width (renderValueCell), so the text only has to
    // refuse to wrap.
    return (
      <Text wrap="truncate">{value.length > 0 ? value : <Text color="gray">(empty)</Text>}</Text>
    );
  };

  /** The label cell: focus marker + label + required marker. */
  const renderLabel = (config: FieldConfig | null, focused: boolean): React.ReactNode => (
    <Text bold color={focused ? 'cyan' : 'gray'}>
      {focusMarker(focused)}
      {config === null ? 'Advanced' : truncateDisplay(config.label, labelTextWidth)}
      {config?.required === true && <Text color="red">*</Text>}
    </Text>
  );

  /**
   * The value cell. In the stacked layout it is the second line of the entry; in
   * the table layout it sits beside the label, which is what aligns the values.
   */
  const renderValueCell = (node: React.ReactNode): React.ReactNode =>
    useTable ? (
      <Box width={valueWidth} flexShrink={0}>
        {node}
      </Box>
    ) : (
      <Box marginLeft={valueIndent} width={valueWidth}>
        {node}
      </Box>
    );

  const renderField = (config: FieldConfig): React.ReactNode => {
    const isCurrent = config.field === currentField;
    const error = shownError(config.field);
    // A host dialog (or the discard prompt) leaves every row read-only.
    const editable = isCurrent && !suspended && !discardPending;

    return (
      <Box key={config.field} flexDirection="column">
        <Box flexDirection={useTable ? 'row' : 'column'}>
          {useTable ? (
            <Box width={labelCellWidth} flexShrink={0}>
              {renderLabel(config, isCurrent)}
            </Box>
          ) : (
            <Box>{renderLabel(config, isCurrent)}</Box>
          )}
          {renderValueCell(renderValue(config, editable))}
        </Box>
        {error !== undefined && (
          <Box marginLeft={valueIndent} width={valueWidth}>
            <Text color="red" wrap="truncate">
              ✗ {error}
            </Text>
          </Box>
        )}
      </Box>
    );
  };

  const renderAdvancedRow = (): React.ReactNode => (
    <Box key="advanced" flexDirection={useTable ? 'row' : 'column'}>
      {useTable ? (
        <Box width={labelCellWidth} flexShrink={0}>
          {renderLabel(null, false)}
        </Box>
      ) : (
        <Box>{renderLabel(null, false)}</Box>
      )}
      {renderValueCell(
        <Text color="gray" wrap="truncate">
          {showAdvanced ? 'Ctrl+A: hide' : `Ctrl+A: show ${advancedCount} more`}
        </Text>
      )}
    </Box>
  );

  const navHint = ((): string => {
    if (discardPending) {
      return `Discard ${dirtyFields.size} unsaved change(s)? y: confirm • n/Esc: keep editing`;
    }
    const parts = ['↑/↓/Tab: Field'];
    if (currentConfig?.type === 'select') {
      parts.push('←/→: Option');
    }
    parts.push('Ctrl+A: Advanced', 'Ctrl+S: Save');
    parts.push(dirtyFields.size > 0 ? `Esc: Cancel (${dirtyFields.size} unsaved)` : 'Esc: Cancel');
    return parts.join(' • ');
  })();

  return (
    <Box flexDirection="column">
      {useTitle && (
        <Box paddingX={1} justifyContent="space-between">
          <Text bold color="cyan">
            {service !== undefined ? `Edit Service — ${service.name}` : 'Add Service'}
          </Text>
          {dirtyFields.size > 0 && <Text color="yellow">● {dirtyFields.size} unsaved</Text>}
        </Box>
      )}

      <Box flexDirection="column" borderStyle="single" borderColor="gray">
        {hasMoreAbove && (
          <Box justifyContent="center">
            <Text color="gray">▲ more above</Text>
          </Box>
        )}
        {visibleEntries.map((entry) =>
          entry.kind === 'advanced' ? renderAdvancedRow() : renderField(entry.config)
        )}
        {hasMoreBelow && (
          <Box justifyContent="center">
            <Text color="gray">▼ more below</Text>
          </Box>
        )}
      </Box>

      {useHelp && (
        <Box paddingX={1}>
          <Text>
            <Text bold color="gray">
              {helpPrefix}
            </Text>
            <Text color="white">{currentHelp}</Text>
          </Text>
        </Box>
      )}

      {submitError !== null && (
        <Box paddingX={1}>
          <Text color="red" wrap="truncate">
            ✗ {submitError}
          </Text>
        </Box>
      )}

      <Box paddingX={1}>
        <Text color={discardPending ? 'yellow' : 'gray'} bold={discardPending} wrap="truncate">
          {navHint}
        </Text>
      </Box>
    </Box>
  );
};
