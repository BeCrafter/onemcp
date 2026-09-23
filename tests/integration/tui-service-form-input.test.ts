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
 *   - ←/→ must actually change an enumerated field. With a nested dropdown the
 *     child's own useInput raced the form's field navigation, so the value could
 *     never be changed from the keyboard (only via an undocumented digit key).
 *   - An over-long value must stay on one row: a wrapped value made the frame
 *     taller than the terminal, which corrupts every absolute write after it.
 *   - Esc with unsaved edits asks first, and the y/n answer to a host dialog
 *     (delete/overwrite) must not be typed into the focused field.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { Box, useStdout } from 'ink';
import { ServiceFormUnified } from '../../src/tui/components/ServiceFormUnified.js';
import type { ServiceDefinition } from '../../src/types/service.js';
import { renderWithTerminal, waitFor, typeKeys, pressKey, paste } from './helpers/ansi-terminal.js';

/** Rows the host leaves for the form in these tests (terminal is 34 rows). */
const FORM_BUDGET = 29;

/** Mirrors app-optimized: a fixed-height column around the form. */
const MiniForm: React.FC<{
  onSubmit: (s: unknown) => void;
  terminalHeight: number;
  onCancel?: () => void;
  service?: ServiceDefinition;
  suspended?: boolean;
  /** Omit the fixed-height column to measure the form's own frame height. */
  bare?: boolean;
}> = ({ onSubmit, terminalHeight, onCancel, service, suspended, bare }) => {
  const { stdout } = useStdout();
  const form = React.createElement(ServiceFormUnified, {
    onSubmit: onSubmit as never,
    onCancel: onCancel ?? (() => {}),
    terminalHeight,
    ...(service !== undefined ? { service } : {}),
    ...(suspended === true ? { suspended } : {}),
  });
  return bare === true
    ? form
    : React.createElement(Box, { flexDirection: 'column', height: stdout?.rows || 24 }, form);
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

    // Expanding parks the focus on the first revealed field; step back to the
    // name field to confirm its value survived the chord.
    await pressKey(stdin, '\x1b[Z'); // Shift+Tab → Enabled
    await pressKey(stdin, '\x1b[Z'); // Shift+Tab → Tags
    await pressKey(stdin, '\x1b[Z'); // Shift+Tab → Environment Variables
    await pressKey(stdin, '\x1b[Z'); // Shift+Tab → Arguments
    await pressKey(stdin, '\x1b[Z'); // Shift+Tab → Command
    await pressKey(stdin, '\x1b[Z'); // Shift+Tab → Transport Type
    await pressKey(stdin, '\x1b[Z'); // Shift+Tab → Service Name
    await waitFor(() => term.text().includes('abc'));
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
      React.createElement(MiniForm, {
        onSubmit: vi.fn(),
        terminalHeight: FORM_BUDGET,
        bare: true,
      }),
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

    // The tracker counts the newline that ends the last line, so the frame's
    // row count is exactly maxRowWritten — it must fit the 29 rows
    // app-optimized hands to the form.
    expect(term.maxRowWritten).toBeLessThanOrEqual(FORM_BUDGET);

    instance.unmount();
  });

  it('switches the transport with ←/→ and swaps the connection fields', async () => {
    const onSubmit = vi.fn();
    const { instance, term, stdin } = renderWithTerminal(
      React.createElement(MiniForm, { onSubmit, terminalHeight: FORM_BUDGET }),
      { rows: 34, cols: 100 }
    );

    await waitFor(() => term.text().includes('Service Name'));
    await typeKeys(stdin, 'arrow-svc');
    await pressKey(stdin, '\r'); // Enter → Transport Type
    await waitFor(() => term.text().includes('(•) stdio'));

    await pressKey(stdin, '\x1b[C'); // → sse
    await waitFor(() => term.text().includes('(•) sse'));
    expect(term.text()).toContain('( ) stdio');

    await pressKey(stdin, '\x1b[C'); // → http
    await waitFor(() => term.text().includes('(•) http'));

    await pressKey(stdin, '\r'); // Enter → next field: URL (no Command for http)
    await waitFor(() => term.text().includes('URL'));
    expect(term.text()).not.toContain('Command');

    await paste(stdin, 'https://api.example.com/mcp');
    await pressKey(stdin, '\x13'); // Ctrl+S
    await waitFor(() => onSubmit.mock.calls.length > 0);

    const saved = onSubmit.mock.calls[0]?.[0] as ServiceDefinition;
    expect(saved.transport).toBe('http');
    expect(saved.url).toBe('https://api.example.com/mcp');
    expect(saved.command).toBeUndefined();

    instance.unmount();
  });

  it('toggles Enabled with ←/→ and saves the new value', async () => {
    const onSubmit = vi.fn();
    const { instance, term, stdin } = renderWithTerminal(
      React.createElement(MiniForm, { onSubmit, terminalHeight: FORM_BUDGET }),
      { rows: 34, cols: 100 }
    );

    await waitFor(() => term.text().includes('Service Name'));
    await typeKeys(stdin, 'toggle-svc');
    await pressKey(stdin, '\r'); // → Transport
    await pressKey(stdin, '\r'); // → Command
    await typeKeys(stdin, 'npx');
    await pressKey(stdin, '\r'); // → Arguments
    await pressKey(stdin, '\r'); // → Environment Variables
    await pressKey(stdin, '\r'); // → Tags
    await pressKey(stdin, '\r'); // → Enabled
    await waitFor(() => term.text().includes('(•) On'));

    await pressKey(stdin, '\x1b[C'); // On → Off
    await waitFor(() => term.text().includes('(•) Off'));

    await pressKey(stdin, '\x13'); // Ctrl+S
    await waitFor(() => onSubmit.mock.calls.length > 0);

    const saved = onSubmit.mock.calls[0]?.[0] as ServiceDefinition;
    expect(saved.enabled).toBe(false);

    instance.unmount();
  });

  it('keeps an over-long value on a single row', async () => {
    const { instance, term, stdin } = renderWithTerminal(
      React.createElement(MiniForm, {
        onSubmit: vi.fn(),
        terminalHeight: FORM_BUDGET,
        bare: true,
      }),
      { rows: 34, cols: 100 }
    );

    await waitFor(() => term.text().includes('Service Name'));
    const baseline = term.maxRowWritten;
    await paste(stdin, 'x'.repeat(300));
    await waitFor(() => term.text().includes('xxx'));

    // The value is windowed by the editor, so nothing below it moves: a wrapped
    // value would have pushed the frame (and every later write) down.
    expect(term.maxRowWritten).toBe(baseline);
    expect(term.maxRowWritten).toBeLessThanOrEqual(FORM_BUDGET);

    instance.unmount();
  });

  it('refuses an out-of-range optional value and points at the field', async () => {
    const onSubmit = vi.fn();
    const { instance, term, stdin } = renderWithTerminal(
      React.createElement(MiniForm, {
        onSubmit,
        terminalHeight: FORM_BUDGET,
        bare: true,
      }),
      { rows: 34, cols: 100 }
    );

    await waitFor(() => term.text().includes('Service Name'));
    await typeKeys(stdin, 'range-svc');
    await pressKey(stdin, '\r'); // → Transport
    await pressKey(stdin, '\r'); // → Command
    await typeKeys(stdin, 'npx');
    await pressKey(stdin, '\x01'); // Ctrl+A → focus lands on Max Connections
    await waitFor(() => term.text().includes('Max Connections'));

    await pressKey(stdin, '\x7f'); // Backspace: clear the default 5
    await typeKeys(stdin, '0');
    await waitFor(() => term.text().includes('0'));

    await pressKey(stdin, '\x13'); // Ctrl+S
    // Refused by the form itself (not by the registry, whose message names a
    // dotted config path the user cannot act on).
    await waitFor(() => term.text().includes('Must be between 1 and 100'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(term.maxRowWritten).toBeLessThanOrEqual(FORM_BUDGET);

    instance.unmount();
  });

  it('asks before discarding unsaved edits', async () => {
    const onCancel = vi.fn();
    const { instance, term, stdin } = renderWithTerminal(
      React.createElement(MiniForm, { onSubmit: vi.fn(), onCancel, terminalHeight: FORM_BUDGET }),
      { rows: 34, cols: 100 }
    );

    await waitFor(() => term.text().includes('Service Name'));
    await pressKey(stdin, '\x1b'); // Esc on a pristine form leaves immediately
    expect(onCancel).toHaveBeenCalledTimes(1);

    instance.unmount();

    const second = renderWithTerminal(
      React.createElement(MiniForm, { onSubmit: vi.fn(), onCancel, terminalHeight: FORM_BUDGET }),
      { rows: 34, cols: 100 }
    );
    await waitFor(() => second.term.text().includes('Service Name'));
    await typeKeys(second.stdin, 'dirty');

    await pressKey(second.stdin, '\x1b'); // Esc → confirmation instead of exit
    await waitFor(() => second.term.text().includes('Discard 1 unsaved'));
    expect(onCancel).toHaveBeenCalledTimes(1);

    await pressKey(second.stdin, 'n'); // keep editing
    await waitFor(() => !second.term.text().includes('Discard 1 unsaved'));
    expect(second.term.text()).toContain('dirty');
    expect(onCancel).toHaveBeenCalledTimes(1);

    await pressKey(second.stdin, '\x1b');
    await waitFor(() => second.term.text().includes('Discard 1 unsaved'));
    await pressKey(second.stdin, 'y');
    await waitFor(() => onCancel.mock.calls.length > 1);
    expect(onCancel).toHaveBeenCalledTimes(2);

    second.instance.unmount();
  });

  it('ignores keyboard input while a host dialog is up', async () => {
    const onCancel = vi.fn();
    const service: ServiceDefinition = {
      name: 'dup',
      transport: 'stdio',
      command: 'npx',
      enabled: true,
      tags: [],
      connectionPool: { maxConnections: 5, idleTimeout: 60000, connectionTimeout: 30000 },
    };
    const { instance, term, stdin } = renderWithTerminal(
      React.createElement(MiniForm, {
        onSubmit: vi.fn(),
        onCancel,
        terminalHeight: FORM_BUDGET,
        service,
        suspended: true,
      }),
      { rows: 34, cols: 100 }
    );

    await waitFor(() => term.text().includes('Edit Service'));
    // These are the keys that answer the host's "overwrite / delete?" dialog.
    await typeKeys(stdin, 'yn');
    await pressKey(stdin, '\x1b');

    expect(term.text()).toContain('dup');
    expect(term.text()).not.toContain('dupy');
    expect(onCancel).not.toHaveBeenCalled();

    instance.unmount();
  });

  it('stacks the label above the value when the terminal is too narrow to table', async () => {
    // 80 columns leaves ~54 cells for the value beside a 24-cell label column,
    // which would clip the arg/env/header examples — so the form stacks instead.
    const NARROW_BUDGET = 19; // mirrors app-optimized at 24 rows
    const { instance, term, stdin } = renderWithTerminal(
      React.createElement(MiniForm, {
        onSubmit: vi.fn(),
        terminalHeight: NARROW_BUDGET,
        bare: true,
      }),
      { rows: 24, cols: 80 }
    );

    await waitFor(() => term.text().includes('Service Name'));
    await typeKeys(stdin, 'narrow-svc');
    await waitFor(() => term.text().includes('narrow-svc'));

    const body = term.lines().filter((l) => l.trimStart().startsWith('│'));
    /** Row content without the box borders. */
    const cell = (line: string): string => line.replace(/^│/, '').replace(/│\s*$/, '').trim();
    const labelRow = body.findIndex((l) => /▶ Service Name\*?\s*│\s*$/.test(l));
    expect(labelRow).toBeGreaterThanOrEqual(0);
    expect(cell(body[labelRow + 1] ?? '')).toBe('narrow-svc');
    // …and nothing is laid out beside a label in this mode.
    expect(body.some((l) => /▶ Service Name\*?\s+[^│\s]/.test(l))).toBe(false);
    expect(term.text()).not.toContain('▌');
    expect(term.maxRowWritten).toBeLessThanOrEqual(NARROW_BUDGET);

    instance.unmount();
  });

  it('reflows on window resize without waiting for a keystroke', async () => {
    const { instance, term, stdin, resize } = renderWithTerminal(
      React.createElement(MiniForm, { onSubmit: vi.fn(), terminalHeight: FORM_BUDGET, bare: true }),
      { rows: 34, cols: 100 }
    );

    await waitFor(() => term.text().includes('Service Name'));
    await typeKeys(stdin, 'reflow-svc');
    await waitFor(() => term.text().includes('reflow-svc'));

    const body = (): string[] => term.lines().filter((l) => l.trimStart().startsWith('│'));
    const isTable = (): boolean => body().some((l) => /▶ Service Name\*?\s+[^│\s]/.test(l));
    const isStacked = (): boolean => body().some((l) => /▶ Service Name\*?\s*│\s*$/.test(l));
    expect(isTable()).toBe(true);

    // Shrink the window and send NOTHING. ink repaints on `resize` but does not
    // re-run the components, so a size read straight from `useStdout()` keeps the
    // stale layout until the next keystroke — the reflow has to come from the
    // resize event alone.
    resize(34, 80);
    await waitFor(isStacked);
    expect(isStacked()).toBe(true);
    expect(isTable()).toBe(false);

    resize(34, 100);
    await waitFor(isTable);
    expect(isTable()).toBe(true);

    instance.unmount();
  });

  it('lays the form out as a flat two-column list', async () => {
    const { instance, term, stdin } = renderWithTerminal(
      React.createElement(MiniForm, { onSubmit: vi.fn(), terminalHeight: FORM_BUDGET, bare: true }),
      { rows: 34, cols: 100 }
    );

    await waitFor(() => term.text().includes('Service Name'));
    await typeKeys(stdin, 'flat-svc');
    await waitFor(() => term.text().includes('flat-svc'));

    const body = term.lines().filter((l) => l.trimStart().startsWith('│'));
    // One row per field: label and value share it.
    expect(body.some((l) => /▶ Service Name\*?\s+flat-svc/.test(l))).toBe(true);
    for (const label of [
      'Transport',
      'Command',
      'Arguments',
      'Environment',
      'Tags',
      'Enabled',
      'Advanced',
    ]) {
      expect(body.filter((l) => l.includes(label))).toHaveLength(1);
    }
    // No section furniture: the form used to draw ▌ headings with full-width rules.
    expect(term.text()).not.toContain('▌');
    expect(body.some((l) => /^│[─\s]+│$/.test(l.trim()))).toBe(false);

    instance.unmount();
  });
});
