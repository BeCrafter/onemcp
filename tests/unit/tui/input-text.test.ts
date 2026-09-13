/**
 * Unit tests for the input-chunk classification shared by TUI editors.
 *
 * Ink hands a paste over as ONE multi-character `input` string, so editors that
 * filter on `length === 1` silently drop pasted text.
 */

import { describe, it, expect } from 'vitest';
import { isPrintableChunk, isEditableChunk } from '../../../src/tui/input-text.js';

describe('isPrintableChunk', () => {
  it('accepts single keystrokes and pasted chunks', () => {
    expect(isPrintableChunk('a')).toBe(true);
    expect(isPrintableChunk('hello world')).toBe(true);
    expect(isPrintableChunk('{"text":"hi"}')).toBe(true);
    expect(isPrintableChunk('中文-ok')).toBe(true);
  });

  it('rejects key actions and empty input', () => {
    expect(isPrintableChunk('')).toBe(false);
    expect(isPrintableChunk('\n')).toBe(false);
    expect(isPrintableChunk('\r\n')).toBe(false);
    expect(isPrintableChunk('\t')).toBe(false);
    expect(isPrintableChunk('\x7f')).toBe(false);
    expect(isPrintableChunk('ok\nmore')).toBe(false);
  });
});

describe('isEditableChunk', () => {
  it('accepts multi-line text (a pasted JSON document)', () => {
    expect(isEditableChunk('{\n  "a": 1\n}')).toBe(true);
    expect(isEditableChunk('plain')).toBe(true);
  });

  it('still rejects non-text control bytes', () => {
    expect(isEditableChunk('')).toBe(false);
    expect(isEditableChunk('\x03')).toBe(false);
    expect(isEditableChunk('ok\x7f')).toBe(false);
  });
});
