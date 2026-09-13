import { describe, expect, it } from 'vitest';

import {
  formatToolOutput,
  normalizeToolResult,
  ToolCallError,
} from '../../../src/tui/discovery-worker.js';

describe('formatToolOutput', () => {
  it('pretty-prints JSON objects and arrays', () => {
    expect(formatToolOutput('{"a":1,"b":[2,3]}')).toBe(
      '{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}'
    );
    expect(formatToolOutput(' [1, 2] ')).toBe('[\n  1,\n  2\n]');
  });

  it('returns non-JSON text verbatim', () => {
    expect(formatToolOutput('plain text output')).toBe('plain text output');
    expect(formatToolOutput('{"unterminated": ')).toBe('{"unterminated": ');
    expect(formatToolOutput('42')).toBe('42');
    expect(formatToolOutput('"quoted string"')).toBe('"quoted string"');
    expect(formatToolOutput('')).toBe('');
  });
});

describe('normalizeToolResult', () => {
  it('joins multiple text blocks with newlines', () => {
    const outcome = normalizeToolResult({
      content: [
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' },
      ],
    });
    expect(outcome.isError).toBe(false);
    expect(outcome.text).toBe('a\nb');
    expect(outcome.formatted).toBe('a\nb');
    expect(outcome.nonTextTypes).toEqual([]);
  });

  it('formats JSON text blocks while keeping the original text', () => {
    const outcome = normalizeToolResult({
      content: [{ type: 'text', text: '{"total":1,"found":0}' }],
    });
    expect(outcome.text).toBe('{"total":1,"found":0}');
    expect(outcome.formatted).toBe('{\n  "total": 1,\n  "found": 0\n}');
  });

  it('preserves text for isError results without throwing', () => {
    const outcome = normalizeToolResult({
      content: [{ type: 'text', text: 'boom happened' }],
      isError: true,
    });
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toBe('boom happened');
  });

  it('records non-text block types and placeholders', () => {
    const outcome = normalizeToolResult({
      content: [
        { type: 'image', data: 'base64data', mimeType: 'image/png' },
        { type: 'text', text: 'caption' },
      ],
    });
    expect(outcome.nonTextTypes).toEqual(['image']);
    expect(outcome.text).toBe('[image]\ncaption');
  });

  it('includes the uri for resource blocks', () => {
    const outcome = normalizeToolResult({
      content: [{ type: 'resource', resource: { uri: 'x://y' } }],
    });
    expect(outcome.nonTextTypes).toEqual(['resource']);
    expect(outcome.text).toBe('[resource: x://y]');
  });

  it('falls back to structuredContent when there is no text content', () => {
    const outcome = normalizeToolResult({ content: [], structuredContent: { a: 1 } });
    expect(outcome.text).toBe('{\n  "a": 1\n}');
  });

  it('renders (empty result) for an empty result object', () => {
    expect(normalizeToolResult({ content: [] }).text).toBe('(empty result)');
  });

  it('degrades raw output on circular structures without throwing', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    const outcome = normalizeToolResult({ content: [], extra: circular });
    expect(typeof outcome.raw).toBe('string');
    expect(outcome.text).toBe('(empty result)');
  });

  it('handles non-object results without throwing', () => {
    expect(normalizeToolResult(null).isError).toBe(false);
    expect(normalizeToolResult('plain').text).toBe('(empty result)');
    expect(normalizeToolResult(42).raw).toBe('42');
    expect(normalizeToolResult(undefined).text).toBe('(empty result)');
  });
});

describe('ToolCallError', () => {
  it('carries the backend code and service name', () => {
    const err = new ToolCallError('svc', 'bad params', -32602, { detail: 'x' });
    expect(err.name).toBe('ToolCallError');
    expect(err.serviceName).toBe('svc');
    expect(err.code).toBe(-32602);
    expect(err.data).toEqual({ detail: 'x' });
    expect(err.message).toBe('bad params');
  });

  it('leaves code/data undefined when absent', () => {
    const err = new ToolCallError('svc', 'failed');
    // With useDefineForClassFields the declared fields exist as own
    // properties — what matters for error classification is the value.
    expect(err.code).toBeUndefined();
    expect(err.data).toBeUndefined();
  });
});
