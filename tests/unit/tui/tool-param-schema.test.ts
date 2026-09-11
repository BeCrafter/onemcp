import { describe, expect, it } from 'vitest';

import {
  bestEffortArgs,
  buildParamRows,
  buildToolArguments,
  buildToolParams,
  describeParamType,
  formatParamValue,
  seedFormValues,
  UNSET_SENTINEL,
  wrapText,
} from '../../../src/tui/tool-param-schema.js';
import type { ToolParam } from '../../../src/tui/tool-param-schema.js';

describe('describeParamType', () => {
  it('passes through the six primitive/object types', () => {
    expect(describeParamType({ type: 'string' })).toEqual({ label: 'string', kind: 'string' });
    expect(describeParamType({ type: 'number' })).toEqual({ label: 'number', kind: 'number' });
    expect(describeParamType({ type: 'integer' })).toEqual({ label: 'integer', kind: 'integer' });
    expect(describeParamType({ type: 'boolean' })).toEqual({ label: 'boolean', kind: 'boolean' });
    expect(describeParamType({ type: 'object' })).toEqual({ label: 'object', kind: 'object' });
  });

  it('labels arrays with their element type', () => {
    expect(describeParamType({ type: 'array', items: { type: 'number' } })).toEqual({
      label: 'array<number>',
      kind: 'array',
    });
    expect(describeParamType({ type: 'array' })).toEqual({ label: 'array', kind: 'array' });
  });

  it('detects enum from the first value type', () => {
    expect(describeParamType({ type: 'string', enum: ['a', 'b'] })).toEqual({
      label: 'string (enum)',
      kind: 'string',
    });
    expect(describeParamType({ enum: [1, 2] })).toEqual({ label: 'number (enum)', kind: 'number' });
  });

  it('joins anyOf/oneOf member labels and degrades the kind', () => {
    expect(describeParamType({ anyOf: [{ type: 'string' }, { type: 'number' }] })).toEqual({
      label: 'string | number',
      kind: 'unknown',
    });
    expect(describeParamType({ oneOf: [{ type: 'string' }] })).toEqual({
      label: 'string',
      kind: 'unknown',
    });
  });

  it('caps union labels at three members', () => {
    const prop = {
      anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'object' }],
    };
    expect(describeParamType(prop).label).toBe('string | number | boolean | …');
  });

  it('degrades unknown shapes without throwing', () => {
    expect(describeParamType({ $ref: '#/$defs/x' })).toEqual({
      label: 'unknown ($ref)',
      kind: 'unknown',
    });
    expect(describeParamType({})).toEqual({ label: 'unknown', kind: 'unknown' });
    expect(describeParamType({ type: 42 })).toEqual({ label: 'unknown', kind: 'unknown' });
    expect(describeParamType({ enum: 'not-an-array' })).toEqual({
      label: 'unknown',
      kind: 'unknown',
    });
  });
});

describe('buildToolParams', () => {
  it('returns [] for undefined schema and empty properties', () => {
    expect(buildToolParams(undefined)).toEqual([]);
    expect(buildToolParams({ type: 'object', properties: {} })).toEqual([]);
  });

  it('preserves declaration order and required flags', () => {
    const params = buildToolParams({
      type: 'object',
      properties: {
        b: { type: 'string' },
        a: { type: 'number' },
        c: { type: 'boolean' },
      },
      required: ['a'],
    });
    expect(params.map((p) => p.name)).toEqual(['b', 'a', 'c']);
    expect(params.map((p) => p.required)).toEqual([false, true, false]);
  });

  it('keeps falsy defaults (default: 0 / empty string)', () => {
    const params = buildToolParams({
      type: 'object',
      properties: {
        zero: { type: 'number', default: 0 },
        empty: { type: 'string', default: '' },
      },
    });
    const zero = params.find((p) => p.name === 'zero');
    const empty = params.find((p) => p.name === 'empty');
    expect(zero?.defaultValue).toBe(0);
    expect(empty?.defaultValue).toBe('');
  });

  it('skips non-record properties and copies descriptions', () => {
    const params = buildToolParams({
      type: 'object',
      properties: {
        good: { type: 'string', description: 'hello' },
        bad: true,
      },
    });
    expect(params).toHaveLength(1);
    expect(params[0]?.description).toBe('hello');
  });

  it('records enum values and array item kinds', () => {
    const params = buildToolParams({
      type: 'object',
      properties: {
        tags: { type: 'array', items: { type: 'string' } },
        level: { type: 'number', enum: [1, 2, 3] },
      },
    });
    expect(params.find((p) => p.name === 'tags')?.itemKind).toBe('string');
    expect(params.find((p) => p.name === 'level')?.enumValues).toEqual([1, 2, 3]);
  });
});

describe('wrapText', () => {
  it('keeps every line within width and preserves word order', () => {
    const lines = wrapText('aaa bbb ccc ddd eee fff', 7);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(7);
    }
    // wrap-ansi (trim:false) may leave the breaking space on the next line;
    // whitespace-collapsed join must still reproduce the original words.
    const rejoined = lines.join(' ').split(/\s+/).filter(Boolean).join(' ');
    expect(rejoined).toBe('aaa bbb ccc ddd eee fff');
  });

  it('hard-splits words longer than width', () => {
    const lines = wrapText('abcdefghij', 4);
    expect(lines).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('returns a single empty line for empty input and handles newlines', () => {
    expect(wrapText('', 10)).toEqual(['']);
    expect(wrapText('a\n\nb', 10)).toEqual(['a', '', 'b']);
  });

  it('preserves JSON indentation with hanging continuations', () => {
    const lines = wrapText('{\n    "tool_names": ["aaa", "bbb"],\n}', 16);
    // The 4-space JSON indent survives (old wrapText stripped it entirely).
    expect(lines).toContain('{');
    expect(lines).toContain('    "tool_names"');
    for (const line of lines) {
      if (line.startsWith('    ') || line.startsWith('      ')) {
        expect(line.startsWith('    ')).toBe(true); // hanging indent, not col 0
      }
      expect(line.length).toBeLessThanOrEqual(18); // indent + body ≤ width + slack
    }
    expect(lines[lines.length - 1]).toBe('}');
  });

  it('never collapses to [] for non-empty input', () => {
    expect(wrapText('x', 1)).toEqual(['x']);
  });
});

describe('buildParamRows', () => {
  const makeParam = (overrides: Partial<ToolParam> & { name: string }): ToolParam => ({
    kind: 'string',
    typeLabel: 'string',
    required: false,
    description: '',
    raw: {},
    ...overrides,
  });

  it('renders a placeholder row for no parameters', () => {
    expect(buildParamRows([], {}, 40, null)).toEqual([{ kind: 'text', text: '(no parameters)' }]);
  });

  it('keeps one description line per unfocused parameter, separated by a rule', () => {
    const params: ToolParam[] = [
      makeParam({ name: 'q', required: true, description: 'query text' }),
      makeParam({ name: 'limit', kind: 'integer', typeLabel: 'integer' }),
    ];
    const rows = buildParamRows(params, { q: 'hello', limit: '' }, 40, null);
    const texts = rows.map((r) => (r.kind === 'text' ? r.text : '<edit>'));
    expect(texts).toEqual([
      '   1  q  string  *required',
      '     query text',
      '     = hello',
      `   ${'─'.repeat(37)}`,
      '   2  limit  integer',
      '     = (unset)',
    ]);
  });

  it('truncates an unfocused description to a single line and marks the cut', () => {
    const long = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu';
    const params: ToolParam[] = [
      { ...makeParam({ name: 'q', description: long }), raw: {} },
      makeParam({
        name: 'multi',
        description: 'line one\nline two\nline three',
        enumValues: [1, 2],
        kind: 'number',
        typeLabel: 'number (enum)',
      }),
    ];
    const texts = buildParamRows(params, {}, 40, null).map((r) =>
      r.kind === 'text' ? r.text : '<edit>'
    );
    // One truncated line each: the `…` is the "there is more" cue, and a
    // multi-line description collapses onto a single row.
    expect(texts).toEqual([
      '   1  q  string',
      '     alpha beta gamma delta epsilon zet…',
      '     = (unset)',
      `   ${'─'.repeat(37)}`,
      '   2  multi  number (enum)',
      '     line one line two line three',
      '     = (unset)',
    ]);
    const firstDesc = texts[1] ?? '';
    expect(firstDesc.endsWith('…')).toBe(true);
    expect(firstDesc.length).toBeLessThanOrEqual(40);
  });

  it('expands description, enum and default only for the focused parameter', () => {
    const params: ToolParam[] = [
      makeParam({ name: 'q', description: 'query text' }),
      makeParam({
        name: 'level',
        kind: 'number',
        typeLabel: 'number (enum)',
        description: 'which level',
        enumValues: [1, 2],
        defaultValue: 1,
      }),
    ];
    const toText = (rows: ReturnType<typeof buildParamRows>): string[] =>
      rows.map((r) => (r.kind === 'text' ? r.text : '<edit>'));

    expect(toText(buildParamRows(params, {}, 40, null))).toEqual([
      '   1  q  string',
      '     query text',
      '     = (unset)',
      `   ${'─'.repeat(37)}`,
      '   2  level  number (enum)',
      '     which level',
      '     = (unset)',
    ]);
    expect(toText(buildParamRows(params, {}, 40, 'level'))).toEqual([
      '   1  q  string',
      '     query text',
      '     = (unset)',
      `   ${'─'.repeat(37)}`,
      '▶ 2  level  number (enum)',
      '     which level',
      '     enum: 1 | 2',
      '     default: 1',
      '<edit>',
    ]);
  });

  it('swaps only the focused parameter value row for an editor row', () => {
    const params: ToolParam[] = [
      makeParam({ name: 'q', required: true, description: 'query text' }),
      makeParam({ name: 'limit', kind: 'integer', typeLabel: 'integer' }),
    ];
    const rows = buildParamRows(params, { q: 'hello', limit: '' }, 40, 'q');
    const texts = rows.map((r) => (r.kind === 'text' ? r.text : '<edit>'));
    expect(texts).toEqual([
      '▶ 1  q  string  *required',
      '     query text',
      '<edit>',
      `   ${'─'.repeat(37)}`,
      '   2  limit  integer',
      '     = (unset)',
    ]);
  });

  it('keeps segments consistent with text and drops them when truncated', () => {
    const params: ToolParam[] = [
      makeParam({ name: 'q', required: true, description: 'query text' }),
      makeParam({ name: 'averyveryverylongparametername', typeLabel: 'unknown ($ref)' }),
    ];
    const rows = buildParamRows(params, { q: 'hello' }, 40, 'q');
    for (const row of rows) {
      if (row.kind === 'text' && row.segments !== undefined) {
        expect(row.segments.map((s) => s.text).join('')).toBe(row.text);
      }
    }
    // A row too narrow to render verbatim must carry NO segments: truncation
    // happens on the joined string, so post-hoc segments would mis-align.
    const narrow = buildParamRows(params, { q: 'hello' }, 20, null);
    for (const row of narrow) {
      if (row.kind === 'text' && row.segments !== undefined) {
        expect(row.text.length).toBeLessThanOrEqual(20);
        expect(row.segments.map((s) => s.text).join('')).toBe(row.text);
      }
    }
    expect(narrow.some((r) => r.kind === 'text' && r.segments === undefined)).toBe(true);
  });

  it('tones the name as primary, the type as muted and the required mark as critical', () => {
    const params: ToolParam[] = [makeParam({ name: 'q', required: true })];
    const row = buildParamRows(params, {}, 40, null)[0];
    expect(row?.kind).toBe('text');
    if (row?.kind === 'text') {
      const tones = new Map(row.segments?.map((s) => [s.text, s.tone]));
      expect(tones.get('q')).toBe('primary');
      expect(tones.get('  string')).toBe('muted');
      expect(tones.get('  *required')).toBe('critical');
    }
  });

  it('keeps the load-bearing name-row template as a substring', () => {
    const params: ToolParam[] = [
      makeParam({ name: 'q', required: true }),
      makeParam({ name: 'limit', kind: 'integer', typeLabel: 'integer' }),
      makeParam({ name: 'tags', kind: 'array', typeLabel: 'array<string>' }),
    ];
    const texts = buildParamRows(params, {}, 40, null).map((r) =>
      r.kind === 'text' ? r.text : ''
    );
    const joined = texts.join('\n');
    // Integration tests assert these as substrings — the gutter must only
    // ever be a PREFIX of the name row.
    expect(joined).toContain('q  string  *required');
    expect(joined).toContain('limit  integer');
    expect(joined).toContain('tags  array<string>');
  });

  it('marks the expanded field with ▶ and emits an input row', () => {
    const params: ToolParam[] = [makeParam({ name: 'q' })];
    const rows = buildParamRows(params, { q: '' }, 40, 'q');
    expect(rows[0]?.kind).toBe('text');
    expect(rows[0]?.kind === 'text' ? rows[0].text : '').toBe('▶ 1  q  string');
    expect(rows[rows.length - 1]).toEqual({ kind: 'input', param: params[0] });
  });

  it('emits a select row for focused boolean/enum fields', () => {
    const boolParam = makeParam({ name: 'flag', kind: 'boolean', typeLabel: 'boolean' });
    const enumParam = makeParam({
      name: 'level',
      kind: 'number',
      typeLabel: 'number (enum)',
      enumValues: [1, 2],
    });
    expect(buildParamRows([boolParam], { flag: '' }, 40, 'flag').at(-1)).toEqual({
      kind: 'select',
      param: boolParam,
    });
    expect(buildParamRows([enumParam], { level: '' }, 40, 'level').at(-1)).toEqual({
      kind: 'select',
      param: enumParam,
    });
  });

  it('keeps every text row within width', () => {
    const params: ToolParam[] = [
      makeParam({
        name: 'averyveryverylongparameternamewithatype',
        description: 'word '.repeat(30).trim(),
      }),
    ];
    const rows = buildParamRows(params, {}, 30, null);
    for (const row of rows) {
      if (row.kind === 'text') {
        expect(row.text.length).toBeLessThanOrEqual(30);
      }
    }
  });

  it('truncates long unfocused values instead of wrapping', () => {
    const params: ToolParam[] = [makeParam({ name: 'v' })];
    const rows = buildParamRows(params, { v: 'x'.repeat(100) }, 20, null);
    const valueRow = rows.at(-1);
    expect(valueRow?.kind).toBe('text');
    if (valueRow?.kind === 'text') {
      expect(valueRow.text.length).toBeLessThanOrEqual(20);
      expect(valueRow.text.endsWith('…')).toBe(true);
    }
  });
});

describe('formatParamValue', () => {
  const param: ToolParam = {
    name: 'v',
    kind: 'string',
    typeLabel: 'string',
    required: false,
    description: '',
    raw: {},
  };

  it('shows (unset) for blank and sentinel values', () => {
    expect(formatParamValue(param, { v: '' })).toBe('(unset)');
    expect(formatParamValue(param, { v: UNSET_SENTINEL })).toBe('(unset)');
    expect(formatParamValue(param, {})).toBe('(unset)');
  });

  it('returns the raw value otherwise', () => {
    expect(formatParamValue(param, { v: '[1,2]' })).toBe('[1,2]');
  });
});

describe('seedFormValues', () => {
  it('prefills declared defaults and blanks everything else', () => {
    const params: ToolParam[] = [
      {
        name: 'a',
        kind: 'number',
        typeLabel: 'number',
        required: false,
        description: '',
        defaultValue: 5,
        raw: {},
      },
      {
        name: 'b',
        kind: 'array',
        typeLabel: 'array',
        required: false,
        description: '',
        defaultValue: [1, 2],
        raw: {},
      },
      { name: 'c', kind: 'string', typeLabel: 'string', required: false, description: '', raw: {} },
    ];
    expect(seedFormValues(params)).toEqual({ a: '5', b: '[1,2]', c: '' });
  });
});

describe('buildToolArguments', () => {
  it('omits blank optional fields entirely', () => {
    const params: ToolParam[] = [
      {
        name: 'req',
        kind: 'string',
        typeLabel: 'string',
        required: true,
        description: '',
        raw: {},
      },
      {
        name: 'opt',
        kind: 'string',
        typeLabel: 'string',
        required: false,
        description: '',
        raw: {},
      },
    ];
    const result = buildToolArguments(params, { req: 'x', opt: '' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.args)).toEqual(['req']);
      expect(Object.keys(result.args)).not.toContain('opt');
    }
  });

  it('collects an error for a blank required field', () => {
    const params: ToolParam[] = [
      {
        name: 'req',
        kind: 'string',
        typeLabel: 'string',
        required: true,
        description: '',
        raw: {},
      },
    ];
    const result = buildToolArguments(params, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors['req']).toBe('is required');
    }
  });

  it('coerces numbers and rejects non-numeric input', () => {
    const params: ToolParam[] = [
      { name: 'n', kind: 'number', typeLabel: 'number', required: false, description: '', raw: {} },
      {
        name: 'i',
        kind: 'integer',
        typeLabel: 'integer',
        required: false,
        description: '',
        raw: {},
      },
    ];
    const ok = buildToolArguments(params, { n: '42.5', i: '7' });
    expect(ok).toEqual({ ok: true, args: { n: 42.5, i: 7 } });

    const bad = buildToolArguments(params, { n: 'abc', i: '1.5' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors['n']).toBe('must be a number');
      expect(bad.errors['i']).toBe('must be an integer');
    }
  });

  it('treats the unset sentinel as blank', () => {
    const params: ToolParam[] = [
      {
        name: 'flag',
        kind: 'boolean',
        typeLabel: 'boolean',
        required: false,
        description: '',
        raw: {},
      },
      {
        name: 'must',
        kind: 'boolean',
        typeLabel: 'boolean',
        required: true,
        description: '',
        raw: {},
      },
    ];
    const omitted = buildToolArguments(params, { flag: UNSET_SENTINEL, must: 'true' });
    expect(omitted.ok).toBe(true);
    if (omitted.ok) {
      expect(Object.keys(omitted.args)).toEqual(['must']);
    }

    const error = buildToolArguments(params, { flag: 'true', must: UNSET_SENTINEL });
    expect(error.ok).toBe(false);
    if (!error.ok) {
      expect(error.errors['must']).toBe('is required');
    }
  });

  it('coerces booleans and rejects other strings', () => {
    const params: ToolParam[] = [
      {
        name: 'flag',
        kind: 'boolean',
        typeLabel: 'boolean',
        required: false,
        description: '',
        raw: {},
      },
    ];
    expect(buildToolArguments(params, { flag: 'true' })).toEqual({
      ok: true,
      args: { flag: true },
    });
    expect(buildToolArguments(params, { flag: 'false' })).toEqual({
      ok: true,
      args: { flag: false },
    });
    const bad = buildToolArguments(params, { flag: 'yes' });
    expect(bad.ok).toBe(false);
  });

  it('parses arrays strictly', () => {
    const params: ToolParam[] = [
      { name: 'ids', kind: 'array', typeLabel: 'array', required: false, description: '', raw: {} },
    ];
    expect(buildToolArguments(params, { ids: '[1,2]' })).toEqual({
      ok: true,
      args: { ids: [1, 2] },
    });
    const notArray = buildToolArguments(params, { ids: '{"a":1}' });
    expect(notArray.ok).toBe(false);
    const malformed = buildToolArguments(params, { ids: '[1' });
    expect(malformed.ok).toBe(false);
  });

  it('parses objects strictly', () => {
    const params: ToolParam[] = [
      {
        name: 'cfg',
        kind: 'object',
        typeLabel: 'object',
        required: false,
        description: '',
        raw: {},
      },
    ];
    expect(buildToolArguments(params, { cfg: '{"a":1}' })).toEqual({
      ok: true,
      args: { cfg: { a: 1 } },
    });
    const notObject = buildToolArguments(params, { cfg: '[1,2]' });
    expect(notObject.ok).toBe(false);
  });

  it('coerces numeric enum members to numbers and validates membership', () => {
    const params: ToolParam[] = [
      {
        name: 'level',
        kind: 'number',
        typeLabel: 'number (enum)',
        required: false,
        description: '',
        enumValues: [1, 2, 3],
        raw: {},
      },
    ];
    const ok = buildToolArguments(params, { level: '2' });
    expect(ok).toEqual({ ok: true, args: { level: 2 } });
    const bad = buildToolArguments(params, { level: '9' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors['level']).toBe('must be one of: 1, 2, 3');
    }
  });

  it('collects every field error at once', () => {
    const params: ToolParam[] = [
      { name: 'a', kind: 'number', typeLabel: 'number', required: true, description: '', raw: {} },
      { name: 'b', kind: 'array', typeLabel: 'array', required: false, description: '', raw: {} },
      { name: 'c', kind: 'string', typeLabel: 'string', required: true, description: '', raw: {} },
    ];
    const result = buildToolArguments(params, { a: 'NaN?', b: '[', c: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual(['a', 'b', 'c']);
    }
  });

  it('falls back to raw string when unknown-kind JSON parsing fails', () => {
    const params: ToolParam[] = [
      {
        name: 'mystery',
        kind: 'unknown',
        typeLabel: 'unknown',
        required: false,
        description: '',
        raw: {},
      },
    ];
    expect(buildToolArguments(params, { mystery: '{"k":1}' })).toEqual({
      ok: true,
      args: { mystery: { k: 1 } },
    });
    expect(buildToolArguments(params, { mystery: 'plain text' })).toEqual({
      ok: true,
      args: { mystery: 'plain text' },
    });
  });
});

describe('bestEffortArgs', () => {
  it('drops fields that fail coercion instead of erroring', () => {
    const params: ToolParam[] = [
      {
        name: 'good',
        kind: 'number',
        typeLabel: 'number',
        required: false,
        description: '',
        raw: {},
      },
      {
        name: 'bad',
        kind: 'number',
        typeLabel: 'number',
        required: false,
        description: '',
        raw: {},
      },
      {
        name: 'missing',
        kind: 'string',
        typeLabel: 'string',
        required: true,
        description: '',
        raw: {},
      },
    ];
    expect(bestEffortArgs(params, { good: '1', bad: 'nope' })).toEqual({ good: 1 });
  });
});
