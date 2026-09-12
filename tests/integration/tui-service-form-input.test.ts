/**
 * Integration tests for the unified service form's input handling.
 *
 * Regression guards:
 *   - Ctrl+S must not leak an 's' into the focused text field. It used to: the
 *     form handled the chord while ink-text-input also received the character,
 *     so repeated save attempts corrupted the field — a second Ctrl+S could
 *     then persist that stray character as the service command.
 *   - A refused save has to SAY why. Silently jumping focus looks like a dead
 *     save button when the invalid field is already focused.
 *   - A pasted chunk must land in the field (multi-character input events).
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { Box, useStdout } from 'ink';
import { ServiceFormUnified } from '../../src/tui/components/ServiceFormUnified.js';
import { renderWithTerminal, waitFor, typeKeys, pressKey, paste } from './helpers/ansi-terminal.js';

/** Mirrors app-optimized: a fixed-height column around the form. */
const MiniForm: React.FC<{ onSubmit: (s: unknown) => void; terminalHeight: number }> = ({
  onSubmit,
  terminalHeight,
}) => {
  const { stdout } = useStdout();
  return React.createElement(
    Box,
    { flexDirection: 'column', height: stdout?.rows || 24 },
    React.createElement(ServiceFormUnified, {
      onSubmit: onSubmit as never,
      onCancel: () => {},
      terminalHeight,
    })
  );
};

describe('ServiceFormUnified input handling', () => {
  it('does not type the Ctrl+S chord into the focused field', async () => {
    const onSubmit = vi.fn();
    const { instance, term, stdin } = renderWithTerminal(
      React.createElement(MiniForm, { onSubmit, terminalHeight: 29 }),
      { rows: 34, cols: 100 }
    );

    await waitFor(() => term.text().includes('Service Name'));
    await typeKeys(stdin, 'abc');
    await waitFor(() => term.text().includes('abc'));

    await pressKey(stdin, '\x13'); // Ctrl+S
    // The save is refused because the (stdio) command is empty, and it says so
    // instead of silently doing nothing.
    await waitFor(() => term.text().includes('✗'));
    expect(term.text()).toContain('required');
    expect(onSubmit).not.toHaveBeenCalled();

    // Focus jumped to the offending field (name → transport → command), so
    // step back twice and confirm the chord never inserted anything.
    await pressKey(stdin, '\x1b[Z'); // Shift+Tab → transport
    await pressKey(stdin, '\x1b[Z'); // Shift+Tab → name
    await waitFor(() => term.text().includes('abc'));
    expect(term.text()).toContain('abc');
    expect(term.text()).not.toContain('abcs');

    instance.unmount();
  });

  it('does not type the Ctrl+A chord into the focused field', async () => {
    const { instance, term, stdin } = renderWithTerminal(
      React.createElement(MiniForm, { onSubmit: vi.fn(), terminalHeight: 29 }),
      { rows: 34, cols: 100 }
    );

    await waitFor(() => term.text().includes('Service Name'));
    await typeKeys(stdin, 'abc');
    await waitFor(() => term.text().includes('abc'));

    await pressKey(stdin, '\x01'); // Ctrl+A → advanced options
    await waitFor(() => term.text().includes('Max Connections'));

    expect(term.text()).not.toContain('abca');
    expect(term.text()).toContain('abc');

    instance.unmount();
  });

  it('accepts a pasted chunk in the focused field', async () => {
    const { instance, term, stdin } = renderWithTerminal(
      React.createElement(MiniForm, { onSubmit: vi.fn(), terminalHeight: 29 }),
      { rows: 34, cols: 100 }
    );

    await waitFor(() => term.text().includes('Service Name'));
    await paste(stdin, 'pasted-service-name');

    await waitFor(() => term.text().includes('pasted-service-name'));
    expect(term.text()).toContain('pasted-service-name');

    instance.unmount();
  });

  it('keeps the form inside the terminal when every field is visible', async () => {
    const { instance, term, stdin } = renderWithTerminal(
      React.createElement(MiniForm, { onSubmit: vi.fn(), terminalHeight: 29 }),
      { rows: 34, cols: 100 }
    );

    await waitFor(() => term.text().includes('Service Name'));
    await pressKey(stdin, '\x01'); // Ctrl+A → all advanced fields on
    await waitFor(() => term.text().includes('Max Connections'));
    // Walk every field so the render window follows the focus.
    for (let i = 0; i < 14; i++) {
      await pressKey(stdin, '\t');
    }
    await waitFor(() => term.text().includes('Trigger'));

    expect(term.maxRowWritten).toBeLessThanOrEqual(33);

    instance.unmount();
  });
});
