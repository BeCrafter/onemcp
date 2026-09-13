/**
 * Tool parameter schema utilities
 *
 * Pure, React-free helpers that turn a tool's `inputSchema` into render-ready
 * parameter descriptors, display lines, and a validated `arguments` payload.
 * Shared by the ServiceTools detail panel and the ToolRunner form.
 */

import { displayWidth, truncateDisplay, wrapDisplay } from './text-layout.js';
import type { Tool } from '../types/tool.js';

/**
 * Base kind of a parameter, used to pick the form widget.
 */
export type ParamKind =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'array'
  | 'object'
  | 'unknown';

/**
 * Render-ready descriptor for one property of a tool's inputSchema.
 */
export interface ToolParam {
  /** Property key in inputSchema.properties (the wire-level argument name). */
  name: string;
  /** Base kind used to pick the form widget. */
  kind: ParamKind;
  /** Human label, e.g. 'string', 'array<number>', 'string | number', 'unknown ($ref)'. */
  typeLabel: string;
  /** Element kind for arrays; absent for non-arrays. */
  itemKind?: ParamKind;
  required: boolean;
  /** Property's own description, '' when absent. */
  description: string;
  /** Present only when the schema declares a non-empty enum. */
  enumValues?: ReadonlyArray<string | number>;
  /** Present only when the schema declares a default. */
  defaultValue?: unknown;
  /** The raw property schema, for object/array JSON hints. */
  raw: Record<string, unknown>;
}

/**
 * Result of turning form values into a tool-call arguments payload.
 */
export type BuildArgsResult =
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; errors: Record<string, string> };

/** Sentinel form value for "no value chosen" on select widgets. */
export const UNSET_SENTINEL = '__unset__';

/**
 * Whether a value is a plain object (not array, not null).
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const PRIMITIVE_KINDS: ReadonlySet<string> = new Set(['string', 'number', 'integer', 'boolean']);

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * One-line type label + widget kind for a property schema.
 * Never throws on malformed input — anything unrecognized degrades to 'unknown'.
 */
export function describeParamType(prop: Record<string, unknown>): {
  label: string;
  kind: ParamKind;
} {
  const rawEnum = prop['enum'];
  if (Array.isArray(rawEnum) && rawEnum.length > 0) {
    const kind: ParamKind = typeof rawEnum[0] === 'number' ? 'number' : 'string';
    return { label: `${kind} (enum)`, kind };
  }

  if (prop['type'] === 'array') {
    const items = prop['items'];
    if (isRecord(items)) {
      const inner = describeParamType(items);
      return { label: `array<${inner.label}>`, kind: 'array' };
    }
    return { label: 'array', kind: 'array' };
  }

  const anyOf = prop['anyOf'];
  if (Array.isArray(anyOf) && anyOf.length > 0) {
    return { label: joinUnionLabels(anyOf), kind: 'unknown' };
  }
  const oneOf = prop['oneOf'];
  if (Array.isArray(oneOf) && oneOf.length > 0) {
    return { label: joinUnionLabels(oneOf), kind: 'unknown' };
  }

  const type = prop['type'];
  if (typeof type === 'string' && PRIMITIVE_KINDS.has(type)) {
    return { label: type, kind: type as ParamKind };
  }
  if (type === 'object') {
    return { label: 'object', kind: 'object' };
  }

  if (typeof prop['$ref'] === 'string') {
    return { label: 'unknown ($ref)', kind: 'unknown' };
  }

  return { label: 'unknown', kind: 'unknown' };
}

function joinUnionLabels(members: unknown[]): string {
  const labels = members
    .slice(0, 3)
    .map((member) => (isRecord(member) ? describeParamType(member).label : 'unknown'))
    .join(' | ');
  return members.length > 3 ? `${labels} | …` : labels;
}

/**
 * Turn an inputSchema into ordered render-ready descriptors.
 * Follows the declaration order of `properties`; malformed entries are skipped.
 */
export function buildToolParams(schema: Tool['inputSchema'] | undefined): ToolParam[] {
  if (schema === undefined || !isRecord(schema.properties)) {
    return [];
  }

  const required = new Set<string>(
    Array.isArray(schema.required)
      ? schema.required.filter((r): r is string => typeof r === 'string')
      : []
  );

  const params: ToolParam[] = [];
  for (const [name, rawValue] of Object.entries(schema.properties)) {
    if (!isRecord(rawValue)) {
      continue;
    }
    const { label, kind } = describeParamType(rawValue);
    const param: ToolParam = {
      name,
      kind,
      typeLabel: label,
      required: required.has(name),
      description: asString(rawValue['description']),
      raw: rawValue,
    };
    if (kind === 'array' && isRecord(rawValue['items'])) {
      param.itemKind = describeParamType(rawValue['items']).kind;
    }
    const enumValues = readEnumValues(rawValue);
    if (enumValues !== undefined) {
      param.enumValues = enumValues;
    }
    if ('default' in rawValue) {
      param.defaultValue = rawValue['default'];
    }
    params.push(param);
  }
  return params;
}

function readEnumValues(raw: Record<string, unknown>): ReadonlyArray<string | number> | undefined {
  const values = raw['enum'];
  if (!Array.isArray(values) || values.length === 0) {
    return undefined;
  }
  const filtered = values.filter(
    (v): v is string | number => typeof v === 'string' || typeof v === 'number'
  );
  return filtered.length > 0 ? filtered : undefined;
}

/**
 * Word wrap at `width` DISPLAY cells (CJK-aware), preserving leading
 * indentation as hanging indents. Delegates to wrapDisplay — do not measure
 * with String.length, double-width characters would overflow the panel.
 */
export function wrapText(text: string, width: number): string[] {
  return wrapDisplay(text, width);
}

/**
 * Semantic tone of a styled segment; the component maps tones to colors.
 */
export type SegmentTone = 'primary' | 'muted' | 'critical' | 'value' | 'accent';

/** A styled span of a row. `segments.map(s => s.text).join('') === text`. */
export interface StyledSegment {
  text: string;
  tone: SegmentTone;
}

/**
 * One row of the flattened detail-panel parameter block. Every row renders as
 * exactly ONE terminal line; `text` is always authoritative, and `segments` is
 * present only when the row was NOT truncated (truncation happens on the joined
 * string, so post-hoc segments would mis-align and could drop the required mark).
 */
export type ParamRow =
  | { kind: 'text'; text: string; segments?: StyledSegment[]; anchor?: string }
  | { kind: 'input'; param: ToolParam }
  | { kind: 'select'; param: ToolParam };

/** Indent for the detail rows of the expanded parameter. */
const DETAIL_INDENT = '     ';
/** Indent for the rule between parameters (aligned with the name rows). */
const SEPARATOR_INDENT = '   ';

/** Current-value summary for a parameter row. */
export function formatParamValue(
  param: ToolParam,
  values: Readonly<Record<string, string>>
): string {
  const rawValue = values[param.name] ?? '';
  if (rawValue === '' || rawValue === UNSET_SENTINEL) {
    return '(unset)';
  }
  return rawValue;
}

/** Build a text row, keeping segments only when nothing had to be truncated. */
function textRow(text: string, segments: StyledSegment[], width: number): ParamRow {
  if (displayWidth(text) > width) {
    return { kind: 'text', text: truncateDisplay(text, width) };
  }
  return { kind: 'text', text, segments };
}

/**
 * Flatten parameters into the detail panel's row stream (one terminal line per
 * row, every text row ≤ width).
 *
 * Every parameter gets a numbered name row (with the
 * `name  typeLabel  *required` template intact), ONE line of description and
 * its current value, with a horizontal rule separating consecutive parameters.
 * The focused parameter expands instead to the full wrapped description plus
 * `enum:` / `default:` details and swaps its `= value` row for a live editor
 * row — so a tool with many parameters stays scannable while still explaining
 * every parameter at a glance.
 */
export function buildParamRows(
  params: readonly ToolParam[],
  values: Readonly<Record<string, string>>,
  width: number,
  focusedName: string | null
): ParamRow[] {
  const effectiveWidth = Math.max(8, width);
  if (params.length === 0) {
    return [{ kind: 'text', text: '(no parameters)' }];
  }

  const indexWidth = String(params.length).length;
  const ruleBody = '─'.repeat(Math.max(4, effectiveWidth - SEPARATOR_INDENT.length));
  const rows: ParamRow[] = [];

  params.forEach((param, index) => {
    const focused = param.name === focusedName;

    if (index > 0) {
      rows.push({
        kind: 'text',
        text: `${SEPARATOR_INDENT}${ruleBody}`,
        segments: [
          { text: SEPARATOR_INDENT, tone: 'muted' },
          { text: ruleBody, tone: 'muted' },
        ],
      });
    }

    // `▶` is DOUBLE-width, so `'▶ '` is 3 cells — the unfocused marker is
    // padded to 3 cells too, otherwise focused rows shift a column right.
    const marker = focused ? '▶ ' : '   ';
    const idx = String(index + 1).padStart(indexWidth, ' ');
    const head = `${marker}${idx}  ${param.name}  ${param.typeLabel}${
      param.required ? '  *required' : ''
    }`;
    const headSegments: StyledSegment[] = [
      { text: marker, tone: focused ? 'accent' : 'muted' },
      { text: idx, tone: 'muted' },
      { text: '  ', tone: 'muted' },
      { text: param.name, tone: focused ? 'accent' : 'primary' },
      { text: `  ${param.typeLabel}`, tone: 'muted' },
    ];
    if (param.required) {
      headSegments.push({ text: '  *required', tone: 'critical' });
    }
    const headRow = textRow(head, headSegments, effectiveWidth);
    // The name row is the scroll anchor for this parameter's block.
    rows.push(headRow.kind === 'text' ? { ...headRow, anchor: param.name } : headRow);

    const detailWidth = Math.max(1, effectiveWidth - DETAIL_INDENT.length);
    // Description: the focused parameter expands fully (plus enum / default),
    // while the others keep exactly ONE line — truncated, so the trailing `…`
    // tells the reader a fuller text is there and that moving the cursor onto
    // the parameter reveals it.
    if (param.description !== '') {
      const lines = focused
        ? wrapText(param.description, detailWidth)
        : [truncateDisplay(param.description.replace(/\s+/g, ' ').trim(), detailWidth)];
      for (const line of lines) {
        const text = `${DETAIL_INDENT}${line}`;
        rows.push({
          kind: 'text',
          text,
          segments: [
            { text: DETAIL_INDENT, tone: 'muted' },
            { text: line, tone: 'muted' },
          ],
        });
      }
    }
    if (focused && param.enumValues !== undefined) {
      const body = `enum: ${param.enumValues.join(' | ')}`;
      rows.push(
        textRow(
          `${DETAIL_INDENT}${body}`,
          [
            { text: DETAIL_INDENT, tone: 'muted' },
            { text: body, tone: 'muted' },
          ],
          effectiveWidth
        )
      );
    }
    if (focused && 'defaultValue' in param) {
      const body = `default: ${formatValue(param.defaultValue)}`;
      rows.push(
        textRow(
          `${DETAIL_INDENT}${body}`,
          [
            { text: DETAIL_INDENT, tone: 'muted' },
            { text: body, tone: 'muted' },
          ],
          effectiveWidth
        )
      );
    }

    const isSelectField = param.kind === 'boolean' || param.enumValues !== undefined;
    if (focused && isSelectField) {
      rows.push({ kind: 'select', param });
    } else if (focused) {
      rows.push({ kind: 'input', param });
    } else {
      const summary = formatParamValue(param, values);
      const prefix = `${DETAIL_INDENT}= `;
      const maxSummary = Math.max(1, effectiveWidth - displayWidth(prefix));
      const valueText = prefix + truncateDisplay(summary, maxSummary);
      const segments: StyledSegment[] = [
        { text: prefix, tone: 'muted' },
        { text: truncateDisplay(summary, maxSummary), tone: 'value' },
      ];
      rows.push(textRow(valueText, segments, effectiveWidth));
    }
  });

  return rows;
}

/** Initial form values: declared defaults prefilled, everything else blank. */
export function seedFormValues(params: readonly ToolParam[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const param of params) {
    if ('defaultValue' in param && param.defaultValue !== undefined) {
      const d = param.defaultValue;
      values[param.name] = typeof d === 'string' ? d : JSON.stringify(d);
    } else {
      values[param.name] = '';
    }
  }
  return values;
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') {
    return value === '' ? '""' : value;
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Coerce one trimmed form value into the wire value for its parameter kind.
 * Returns the coerced value or a field-level error message.
 */
function coerceFieldValue(
  param: ToolParam,
  trimmed: string
): { value: unknown } | { error: string } {
  switch (param.kind) {
    case 'string':
      return { value: trimmed };
    case 'number': {
      const n = Number(trimmed);
      return Number.isFinite(n) ? { value: n } : { error: 'must be a number' };
    }
    case 'integer': {
      const n = Number(trimmed);
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        return { error: 'must be an integer' };
      }
      return { value: n };
    }
    case 'boolean':
      if (trimmed === 'true' || trimmed === 'false') {
        return { value: trimmed === 'true' };
      }
      return { error: "must be 'true' or 'false'" };
    case 'array': {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        return Array.isArray(parsed)
          ? { value: parsed }
          : { error: 'must be a JSON array, e.g. [1,2]' };
      } catch {
        return { error: 'must be a JSON array, e.g. [1,2]' };
      }
    }
    case 'object': {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        return isRecord(parsed)
          ? { value: parsed }
          : { error: 'must be a JSON object, e.g. {"k":1}' };
      } catch {
        return { error: 'must be a JSON object, e.g. {"k":1}' };
      }
    }
    case 'unknown': {
      try {
        return { value: JSON.parse(trimmed) as unknown };
      } catch {
        return { value: trimmed };
      }
    }
  }
}

function coerceEnumValue(
  param: ToolParam,
  trimmed: string
): { value: unknown } | { error: string } {
  const enumValues = param.enumValues;
  if (enumValues === undefined) {
    return { value: trimmed };
  }
  const allNumeric = enumValues.every((v) => typeof v === 'number');
  const candidate: string | number =
    allNumeric && trimmed !== '' && Number.isFinite(Number(trimmed)) ? Number(trimmed) : trimmed;
  if (enumValues.includes(candidate)) {
    return { value: candidate };
  }
  return { error: `must be one of: ${enumValues.join(', ')}` };
}

/**
 * Build the arguments payload from form values.
 * Core rule: a blank value means the key is OMITTED entirely — never '' or null.
 * All field errors are collected, not just the first.
 */
export function buildToolArguments(
  params: readonly ToolParam[],
  formValues: Readonly<Record<string, string>>
): BuildArgsResult {
  const args: Record<string, unknown> = {};
  const errors: Record<string, string> = {};

  for (const param of params) {
    const rawValue = formValues[param.name] ?? '';
    const trimmed = rawValue.trim();

    if (trimmed === '' || trimmed === UNSET_SENTINEL) {
      if (param.required) {
        errors[param.name] = 'is required';
      }
      continue;
    }

    const result =
      param.enumValues !== undefined
        ? coerceEnumValue(param, trimmed)
        : coerceFieldValue(param, trimmed);
    if ('error' in result) {
      errors[param.name] = result.error;
    } else {
      args[param.name] = result.value;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, args };
}

/**
 * Best-effort form → arguments projection that never fails: each field is
 * coerced independently and fields that do not coerce are simply omitted.
 * Used when projecting the form into the JSON editor.
 */
export function bestEffortArgs(
  params: readonly ToolParam[],
  formValues: Readonly<Record<string, string>>
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const param of params) {
    const rawValue = formValues[param.name] ?? '';
    const trimmed = rawValue.trim();
    if (trimmed === '' || trimmed === UNSET_SENTINEL) {
      continue;
    }
    const result =
      param.enumValues !== undefined
        ? coerceEnumValue(param, trimmed)
        : coerceFieldValue(param, trimmed);
    if ('value' in result) {
      args[param.name] = result.value;
    }
  }
  return args;
}
