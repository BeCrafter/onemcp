/**
 * Integration tests for the single-line TUI editor.
 *
 * Regression guards:
 *   - the cursor window is measured in display CELLS, so a CJK value cannot
 *     overflow the one row the component promises (it used to slice the value
 *     by UTF-16 units, which mis-windowed wide characters);
 *   - a pasted chunk lands whole;
 *   - control chords never insert their letter.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { Box } from 'ink';
import { SingleLineInput } from '../../src/tui/components/SingleLineInput.js';
import { displayWidth } from '../../src/tui/text-layout.js';
import { renderWithTerminal, waitFor, paste, pressKey, typeKeys } from './helpers/ansi-terminal.js';

const renderInput = (value: string, width: number | undefined, onChange = vi.fn()) => {
  const element = React.createElement(
    Box,
    { flexDirection: 'column' },
    React.createElement(SingleLineInput, {
      value,
      onChange,
      ...(width === undefined ? {} : { width }),
    })
  );
  return { ...renderWithTerminal(element, { rows: 6, cols: 40 }), onChange };
};

describe('SingleLineInput windowing', () => {
  it('keeps a CJK value inside its box on a single row', async () => {
    const { instance, term } = renderInput('中文测试值很长了', 10);

    await waitFor(() => term.text().trim() !== '');
    const lines = term.lines();

    expect(lines).toHaveLength(1);
    expect(displayWidth(lines[0] ?? '')).toBeLessThanOrEqual(10);
    // The tail is what a cursor-at-end window shows, with the clipped side marked.
    expect(term.text()).toContain('…');

    instance.unmount();
  });

  it('does not wrap an ASCII value either', async () => {
    const { instance, term } = renderInput('abcdefghijklmnop', 8);

    await waitFor(() => term.text().trim() !== '');
    const lines = term.lines();
    expect(lines).toHaveLength(1);
    expect(displayWidth(lines[0] ?? '')).toBeLessThanOrEqual(8);

    instance.unmount();
  });

  it('accepts a pasted chunk whole', async () => {
    const onChange = vi.fn();
    const { instance, term, stdin } = renderInput('', 20, onChange);

    await waitFor(() => term.text().trim() !== '');
    await paste(stdin, '粘贴进来的中文');

    await waitFor(() => onChange.mock.calls.length > 0);
    expect(onChange).toHaveBeenLastCalledWith('粘贴进来的中文');

    instance.unmount();
  });

  it('ignores control chords instead of typing their letter', async () => {
    const onChange = vi.fn();
    const { instance, stdin } = renderInput('ab', 20, onChange);

    await pressKey(stdin, '\x13'); // Ctrl+S
    await pressKey(stdin, '\x01'); // Ctrl+A
    await typeKeys(stdin, 'c');

    await waitFor(() => onChange.mock.calls.length > 0);
    const values = onChange.mock.calls.map((c) => c[0] as string);
    // Ctrl+S / Ctrl+A must leave no trace: 'ab' + a leaked letter would show up
    // as 'abs' / 'aba' before the real 'c' keystroke.
    expect(values).not.toContain('abs');
    expect(values).not.toContain('aba');
    expect(values[values.length - 1]).toBe('abc');

    instance.unmount();
  });
});
