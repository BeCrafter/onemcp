/**
 * Integration tests for the flattened ServiceTools detail panel: inline
 * parameter editing (Tab into fields), Ctrl+R tool invocation, JSON output
 * formatting, and the layered Esc behavior. Renders the REAL ServiceTools
 * component with a mocked discovery-worker (no real backend) and drives
 * keystrokes through a fake TTY.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { Box, useStdout, render } from 'ink';
import { ServiceTools } from '../../src/tui/components/ServiceTools.js';
import type { ToolCallOutcome } from '../../src/tui/discovery-worker.js';
import type { Tool } from '../../src/types/tool.js';
import type { ServiceDefinition } from '../../src/types/service.js';
import { Terminal, createStdin, waitFor, typeKeys, pressKey } from './helpers/ansi-terminal.js';

const { tools, fetchServiceToolsMock, callServiceToolMock, mockOutcome } = vi.hoisted(() => {
  const tools: Tool[] = [
    {
      name: 'alpha',
      namespacedName: 'demo__alpha',
      serviceName: 'demo',
      description: 'mock tool with parameters',
      inputSchema: {
        type: 'object' as const,
        properties: {
          q: { type: 'string', description: 'query text' },
          limit: { type: 'integer', description: 'max results' },
          verbose: { type: 'boolean', description: 'chatty output' },
          tags: { type: 'array', items: { type: 'string' }, description: 'filter tags' },
        },
        required: ['q'],
      },
      enabled: true,
    },
  ];
  const outcome: ToolCallOutcome = {
    isError: false,
    text: '{"ok":true}',
    formatted: '{\n  "ok": true\n}',
    nonTextTypes: [],
    raw: '{\n  "content": []\n}',
  };
  return {
    tools,
    mockOutcome: outcome,
    fetchServiceToolsMock: vi.fn(() => Promise.resolve(tools)),
    callServiceToolMock: vi.fn(
      (
        _service: ServiceDefinition,
        _toolName: string,
        _args: Record<string, unknown>,
        _timeout: number
      ) => Promise.resolve(outcome)
    ),
  };
});

vi.mock('../../src/tui/discovery-worker.js', () => ({
  __esModule: true,
  fetchServiceTools: fetchServiceToolsMock,
  callServiceTool: callServiceToolMock,
  // Minimal stand-ins: ServiceTools only uses them for instanceof checks.
  ToolCallError: class ToolCallError extends Error {},
  DiscoveryError: class DiscoveryError extends Error {},
  DiscoveryErrorType: { TIMEOUT: 'timeout', CONNECTION_FAILED: 'connection_failed' },
  default: fetchServiceToolsMock,
}));

const { copyToClipboardMock } = vi.hoisted(() => ({
  copyToClipboardMock: vi.fn((_text: string) => true),
}));
vi.mock('../../src/tui/clipboard.js', () => ({
  __esModule: true,
  copyToClipboard: copyToClipboardMock,
}));

const MiniApp: React.FC<{ rows: number; onBack?: (() => void) | undefined }> = ({
  rows,
  onBack,
}) => {
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows || rows;

  const service: ServiceDefinition = {
    name: 'demo',
    transport: 'http',
    url: 'http://127.0.0.1:1/mcp',
    enabled: true,
    tags: [],
    connectionPool: { maxConnections: 1, idleTimeout: 60000, connectionTimeout: 10000 },
  };

  return React.createElement(
    Box,
    { flexDirection: 'column', height: terminalHeight },
    React.createElement(ServiceTools, {
      service,
      onBack: onBack ?? (() => {}),
      onToggleTool: () => {},
      toolStates: {},
      terminalHeight,
    })
  );
};

function renderApp(rows: number, cols: number, onBack?: () => void) {
  const term = new Terminal(rows, cols);
  const stdin = createStdin();
  const stdout: any = {
    columns: cols,
    rows,
    isTTY: true,
    write: (s: string) => {
      term.feed(s);
      return true;
    },
    on: () => {},
    off: () => {},
    emit: () => {},
    once: () => {},
    removeListener: () => {},
    setEncoding: () => {},
    getWindowSize: () => [cols, rows],
  };
  const instance = render(React.createElement(MiniApp, { rows, onBack }), {
    stdout,
    stdin,
    exitOnCtrlC: false,
  });
  return { instance, term, stdin, stdout };
}

/**
 * Tab from the tool list into the parameters region. The cycle is
 * list → description → params, so the fields are two Tabs away.
 */
const tabToParams = async (stdin: Parameters<typeof pressKey>[0]): Promise<void> => {
  await pressKey(stdin, '\t');
  await pressKey(stdin, '\t');
};
describe('ServiceTools flattened detail panel', () => {
  beforeEach(() => {
    fetchServiceToolsMock.mockReset();
    fetchServiceToolsMock.mockImplementation(() => Promise.resolve(tools));
    callServiceToolMock.mockClear();
    callServiceToolMock.mockImplementation(() => Promise.resolve(mockOutcome));
    copyToClipboardMock.mockClear();
    copyToClipboardMock.mockImplementation(() => true);
  });

  it('shows description and parameters flattened, without section focus markers', async () => {
    const { instance, term } = renderApp(30, 100);

    await waitFor(() => term.text().includes('Parameters (4)'));

    const text = term.text();
    expect(text).toContain('DESCRIPTION');
    expect(text).toContain('PARAMETERS (4)');
    expect(text).toContain('mock tool with parameters');
    expect(text).toContain('q  string  *required');
    expect(text).toContain('limit  integer');
    expect(text).toContain('verbose  boolean');
    expect(text).toContain('tags  array<string>');
    // No section-focus markers from the old two-section design.
    expect(text).not.toContain('▸');

    instance.unmount();
  });

  it('expands the description with Ctrl+E and re-collapses it for the next tool', async () => {
    const longLines = Array.from({ length: 40 }, (_, i) => `detail line ${i}`);
    const described = { ...tools[0]!, description: longLines.join('\n') };
    fetchServiceToolsMock.mockImplementation(() =>
      Promise.resolve([described, { ...described, name: 'beta', namespacedName: 'demo__beta' }])
    );
    const { instance, term, stdin } = renderApp(30, 100);

    await waitFor(() => term.text().includes('more line(s)'));
    expect(term.text()).toContain('detail line 0');
    expect(term.text()).toContain('Ctrl+E expands');

    await pressKey(stdin, '\x05'); // Ctrl+E → expand
    await waitFor(() => !term.text().includes('more line(s)'));
    // The tail is now reachable by paging the panel (Ctrl+D = page down).
    for (let i = 0; i < 4; i++) {
      await pressKey(stdin, '\x04');
    }
    await waitFor(() => term.text().includes('detail line 39'));

    await pressKey(stdin, '\x05'); // Ctrl+E → collapse
    await waitFor(() => term.text().includes('more line(s)'));
    expect(term.text()).not.toContain('detail line 39');

    // The toggle is temporary: the next tool starts collapsed again.
    await pressKey(stdin, '\x05'); // expand once more
    await waitFor(() => !term.text().includes('more line(s)'));
    await pressKey(stdin, '\x1b'); // Esc → hand the arrows back to the list
    await pressKey(stdin, '\x1b[B'); // ↓ → beta
    await waitFor(() => term.text().includes('▶ ✓ beta'));
    await waitFor(() => term.text().includes('more line(s)'));

    instance.unmount();
  });

  it('Tab enters the first field; typed letters land in the field, not the list', async () => {
    const { instance, term, stdin } = renderApp(30, 100);

    await waitFor(() => term.text().includes('Parameters (4)'));
    expect(term.text()).not.toContain('value');

    await tabToParams(stdin); // list → description → fields (q focused)
    await waitFor(() => term.text().includes('value')); // input placeholder visible

    // Typing 'a' must edit the field, not batch-enable tools.
    await typeKeys(stdin, 'zz');
    await waitFor(() => term.text().includes('zz'));

    instance.unmount();
  });

  it('runs the tool with Ctrl+R: coerced args, blank optionals omitted, formatted output', async () => {
    const { instance, term, stdin } = renderApp(30, 100);

    await waitFor(() => term.text().includes('Parameters (4)'));

    // Tab now switches REGIONS (list → params); ↑/↓ moves between parameters.
    await tabToParams(stdin); // list → description → params (q expanded)
    await typeKeys(stdin, 'hello');
    await pressKey(stdin, '\x1b[B'); // ↓ → limit
    await typeKeys(stdin, '3');
    await pressKey(stdin, '\x1b[B'); // ↓ → verbose (select, stays unset)
    await pressKey(stdin, '\x1b[B'); // ↓ → tags (left blank)

    await pressKey(stdin, '\x12'); // Ctrl+R
    await waitFor(() => term.text().includes('Result: ✓'));

    expect(callServiceToolMock).toHaveBeenCalledTimes(1);
    const [calledService, calledTool, calledArgs, calledTimeout] =
      callServiceToolMock.mock.calls[0]!;
    expect(calledTool).toBe('alpha');
    expect(calledService).toMatchObject({ name: 'demo' });
    expect(typeof calledTimeout).toBe('number');
    expect(calledArgs).toEqual({ q: 'hello', limit: 3 });

    // Output defaults to the formatted JSON, not the compact original.
    expect(term.text()).toContain('"ok": true');
    expect(term.text()).not.toContain('{"ok":true}');

    // The result is framed in a bordered box whose content keeps its indent.
    const text = term.text();
    expect(text).toContain('╭');
    expect(text).toContain('╰');
    const framedLine = text.split('\n').find((l) => l.includes('│') && l.includes('"ok"'));
    expect(framedLine).toBeDefined();
    expect(framedLine!.indexOf('│')).toBeLessThan(framedLine!.indexOf('"ok"'));

    instance.unmount();
  });

  it('PgDn scrolls inside the result box for tall outputs', async () => {
    const tall = Array.from({ length: 20 }, (_, i) => `"line-${String(i).padStart(2, '0')}": ${i}`);
    callServiceToolMock.mockImplementation(() =>
      Promise.resolve({
        ...mockOutcome,
        formatted: `{\n  ${tall.join(',\n  ')}\n}`,
      })
    );
    const { instance, term, stdin } = renderApp(30, 100);

    await waitFor(() => term.text().includes('Parameters (4)'));
    await tabToParams(stdin);
    await typeKeys(stdin, 'x');
    await pressKey(stdin, '\x12'); // Ctrl+R
    await waitFor(() => term.text().includes('Result: ✓'));
    expect(term.text()).toContain('"line-00"');

    await pressKey(stdin, '\x1b[6~'); // PgDn
    await waitFor(() => !term.text().includes('"line-00"'));
    expect(term.text()).toContain('"line-08"');
    expect(term.text()).toContain('↓'); // box hint shows remaining rows

    instance.unmount();
  });

  it('blocks the request and shows field errors when validation fails', async () => {
    const { instance, term, stdin } = renderApp(30, 100);

    await waitFor(() => term.text().includes('Parameters (4)'));
    await tabToParams(stdin); // → q (left empty)

    await pressKey(stdin, '\x12'); // Ctrl+R with required q blank
    await waitFor(() => term.text().includes('q: is required'));

    expect(callServiceToolMock).not.toHaveBeenCalled();

    instance.unmount();
  });

  it('Ctrl+J toggles the inline raw-JSON editor over the parameter rows', async () => {
    const { instance, term, stdin } = renderApp(30, 100);

    await waitFor(() => term.text().includes('Parameters (4)'));

    await pressKey(stdin, '\n'); // Ctrl+J → json editor
    await waitFor(() => term.text().includes('Arguments (raw JSON):'));
    expect(term.text()).not.toContain('q  string  *required');

    await pressKey(stdin, '\n'); // Ctrl+J → back to fields
    await waitFor(() => term.text().includes('q  string  *required'));

    instance.unmount();
  });

  it('shows the tool-error marker when the backend reports isError', async () => {
    callServiceToolMock.mockImplementation(() =>
      Promise.resolve({
        ...mockOutcome,
        isError: true,
        text: 'boom from backend',
        formatted: 'boom from backend',
      })
    );
    const { instance, term, stdin } = renderApp(30, 100);

    await waitFor(() => term.text().includes('Parameters (4)'));
    await tabToParams(stdin);
    await typeKeys(stdin, 'x');
    await pressKey(stdin, '\x12');
    await waitFor(() => term.text().includes('boom from backend'));

    expect(term.text()).toContain('tool reported an error');

    instance.unmount();
  });

  it('Esc layers: leave editing first, then trigger onBack', async () => {
    const onBack = vi.fn();
    const { instance, term, stdin } = renderApp(30, 100, onBack);

    await waitFor(() => term.text().includes('Parameters (4)'));

    await tabToParams(stdin); // → description → fields
    await waitFor(() => term.text().includes('value'));

    await pressKey(stdin, '\x1b'); // leave editing → list focus
    await waitFor(() => term.text().includes('= (unset)'));
    expect(onBack).not.toHaveBeenCalled();

    await pressKey(stdin, '\x1b'); // list focus → back to services
    await waitFor(() => onBack.mock.calls.length > 0);

    instance.unmount();
  });

  it('keeps one description line per parameter while browsing and expands the focused one', async () => {
    const longDesc =
      'first detail sentence that runs well past the panel width so it must be cut off';
    fetchServiceToolsMock.mockImplementation(() =>
      Promise.resolve([
        {
          ...tools[0]!,
          inputSchema: {
            type: 'object' as const,
            properties: {
              q: { type: 'string', description: longDesc },
              limit: { type: 'integer', description: 'max results' },
            },
            required: ['q'],
          },
        },
      ])
    );
    const { instance, term, stdin } = renderApp(30, 100);

    await waitFor(() => term.text().includes('PARAMETERS (2)'));
    // Browsing: one truncated description line per parameter — the trailing `…`
    // is the cue that the full text is available.
    expect(term.text()).toContain('1  q  string  *required');
    expect(term.text()).toContain('= (unset)');
    expect(term.text()).toMatch(/first detail sentence[^\n]*…/);
    expect(term.text()).not.toContain('must be cut off');
    expect(term.text()).toContain('max results');
    // Consecutive parameters are separated by a rule.
    expect(
      term
        .text()
        .split('\n')
        .some((l) => l.trim().startsWith('───'))
    ).toBe(true);

    await tabToParams(stdin); // → params: the focused one expands fully
    await waitFor(() => term.text().includes('▶ 1  q  string  *required'));
    await waitFor(() => term.text().includes('must be cut off'));
    // The other parameter keeps its single line.
    expect(term.text()).toMatch(/max results/);

    instance.unmount();
  });

  it('Tab cycles regions and ↑/↓ scrolls the panel from the result region', async () => {
    const tall = Array.from({ length: 24 }, (_, i) => `"line-${String(i).padStart(2, '0')}": ${i}`);
    callServiceToolMock.mockImplementation(() =>
      Promise.resolve({ ...mockOutcome, formatted: `{\n  ${tall.join(',\n  ')}\n}` })
    );
    const { instance, term, stdin } = renderApp(30, 100);

    await waitFor(() => term.text().includes('PARAMETERS (4)'));
    await tabToParams(stdin);
    await typeKeys(stdin, 'x');
    await pressKey(stdin, '\x12'); // Ctrl+R → focus lands on the result region
    await waitFor(() => term.text().includes('Result: ✓'));

    // The footer advertises the result-region keys once it has focus.
    await waitFor(() => term.text().includes('Ctrl+Y Copy result'));

    // ↑/↓ scroll the panel line by line from the result region (this is the
    // capability that was previously missing entirely).
    const before = term.text();
    expect(before).toContain('"line-00"');
    await pressKey(stdin, '\x1b[B'); // ↓
    await waitFor(() => !term.text().includes('"line-00"'));
    expect(term.text()).toContain('"line-01"');

    await pressKey(stdin, '\t'); // result → list
    await waitFor(() => term.text().includes('a/A All on/off'));

    instance.unmount();
  });

  it('reaches the last line of a large result (no row cap)', async () => {
    const lines = Array.from({ length: 300 }, (_, i) => `"l${String(i).padStart(3, '0')}": ${i}`);
    callServiceToolMock.mockImplementation(() =>
      Promise.resolve({ ...mockOutcome, formatted: `{\n  ${lines.join(',\n  ')}\n}` })
    );
    const { instance, term, stdin } = renderApp(30, 100);

    await waitFor(() => term.text().includes('Parameters (4)'));
    await tabToParams(stdin);
    await typeKeys(stdin, 'x');
    await pressKey(stdin, '\x12'); // Ctrl+R → focus lands on the result region
    await waitFor(() => term.text().includes('Result: ✓'));
    expect(term.text()).toContain('"l000"');

    // Page to the very bottom; the tail of a 300-line result must be reachable.
    for (let i = 0; i < 18; i++) {
      await pressKey(stdin, '\x1b[C'); // →
    }
    await waitFor(() => term.text().includes('"l299"'));
    expect(term.text()).toContain('"l299"');
    expect(term.text()).toContain('╰'); // the closing border came into view

    instance.unmount();
  });

  it('pages the panel with ←/→ and back again', async () => {
    const lines = Array.from({ length: 60 }, (_, i) => `"p${String(i).padStart(3, '0')}": ${i}`);
    callServiceToolMock.mockImplementation(() =>
      Promise.resolve({ ...mockOutcome, formatted: `{\n  ${lines.join(',\n  ')}\n}` })
    );
    const { instance, term, stdin } = renderApp(30, 100);

    await waitFor(() => term.text().includes('Parameters (4)'));
    await tabToParams(stdin);
    await typeKeys(stdin, 'x');
    await pressKey(stdin, '\x12');
    await waitFor(() => term.text().includes('Result: ✓'));
    expect(term.text()).toContain('"p000"');

    // → pages forward by a whole viewport, not a single line.
    await pressKey(stdin, '\x1b[C');
    await waitFor(() => !term.text().includes('"p000"'));
    expect(term.text()).toContain('"p020"');

    // ← pages back.
    await pressKey(stdin, '\x1b[D');
    await waitFor(() => term.text().includes('"p000"'));

    instance.unmount();
  });

  it('copies the whole result (unwrapped) with Ctrl+Y', async () => {
    const { instance, term, stdin } = renderApp(30, 100);

    await waitFor(() => term.text().includes('Parameters (4)'));
    await tabToParams(stdin);
    await typeKeys(stdin, 'x');
    await pressKey(stdin, '\x12'); // Ctrl+R → result focus
    await waitFor(() => term.text().includes('Result: ✓'));

    await pressKey(stdin, '\x19'); // Ctrl+Y
    expect(copyToClipboardMock).toHaveBeenCalledTimes(1);
    // The UNWRAPPED text, so pasted data has no display line breaks.
    expect(copyToClipboardMock.mock.calls[0]?.[0]).toBe('{\n  "ok": true\n}');
    await waitFor(() => term.text().includes('Copied'));

    instance.unmount();
  });

  it('selects a range of result lines with v and copies only those', async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `"r${String(i).padStart(2, '0')}": ${i}`);
    callServiceToolMock.mockImplementation(() =>
      Promise.resolve({ ...mockOutcome, formatted: `{\n  ${lines.join(',\n  ')}\n}` })
    );
    const { instance, term, stdin } = renderApp(30, 100);

    await waitFor(() => term.text().includes('Parameters (4)'));
    await tabToParams(stdin);
    await typeKeys(stdin, 'x');
    await pressKey(stdin, '\x12');
    await waitFor(() => term.text().includes('Result: ✓'));

    await pressKey(stdin, 'v'); // anchor at the first visible result line
    await waitFor(() => term.text().includes('Copy selection'));
    await pressKey(stdin, '\x1b[B'); // ↓ extend
    await pressKey(stdin, '\x1b[B'); // ↓ extend
    await pressKey(stdin, '\x19'); // Ctrl+Y

    const copied = copyToClipboardMock.mock.calls[0]?.[0] as string;
    const copiedLines = copied.split('\n');
    // Exactly the three highlighted lines, without the box frame glyphs.
    expect(copiedLines).toHaveLength(3);
    expect(copiedLines[0]).toBe('{');
    expect(copied).toContain('"r01"');
    expect(copied).not.toContain('│');

    instance.unmount();
  });

  it('marks the result cursor, moves it with ↑/↓ and selects from it with v', async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `"r${String(i).padStart(2, '0')}": ${i}`);
    callServiceToolMock.mockImplementation(() =>
      Promise.resolve({ ...mockOutcome, formatted: `{\n  ${lines.join(',\n  ')}\n}` })
    );
    const { instance, term, stdin } = renderApp(30, 100);

    await waitFor(() => term.text().includes('Parameters (4)'));
    await tabToParams(stdin);
    await typeKeys(stdin, 'x');
    await pressKey(stdin, '\x12');
    await waitFor(() => term.text().includes('Result: ✓'));

    // A successful run focuses the result region: the cursor sits on line 0.
    const cursorRow = (): number =>
      term
        .text()
        .split('\n')
        .findIndex((l) => l.includes('▸'));
    await waitFor(() => cursorRow() > -1);
    const first = cursorRow();
    expect(term.text().split('\n')[first]).toContain('{');

    await pressKey(stdin, '\x1b[B'); // ↓
    await waitFor(() => cursorRow() === first + 1);
    await pressKey(stdin, '\x1b[A'); // ↑ back
    await waitFor(() => cursorRow() === first);

    // v anchors at the cursor, ↓ extends, Ctrl+Y copies exactly that range.
    await pressKey(stdin, '\x1b[B'); // ↓ → line 1
    await pressKey(stdin, 'v');
    await waitFor(() => term.text().includes('Copy selection'));
    await pressKey(stdin, '\x1b[B'); // ↓ extend → line 2
    await pressKey(stdin, '\x19'); // Ctrl+Y

    const copied = copyToClipboardMock.mock.calls[0]?.[0] as string;
    expect(copied.split('\n')).toHaveLength(2);
    expect(copied).toContain('"r00"');
    expect(copied).toContain('"r01"');
    expect(copied).not.toContain('"r02"');

    instance.unmount();
  });

  it('toggles a full-width view with f so mouse selection cannot stray', async () => {
    const { instance, term, stdin } = renderApp(30, 100);

    await waitFor(() => term.text().includes('Parameters (4)'));
    await tabToParams(stdin);
    await typeKeys(stdin, 'x');
    await pressKey(stdin, '\x12');
    await waitFor(() => term.text().includes('Result: ✓'));
    // Two-column layout: the tool list occupies the left column.
    expect(term.text()).toContain('▶ ✓');

    // Measure the BOX itself: rendered rows are full lines, and in the
    // two-column layout the box starts partway across.
    const boxWidth = (line: string): number =>
      line.trimEnd().length - Math.max(0, line.indexOf('╭'));
    const narrowBox =
      term
        .text()
        .split('\n')
        .find((l) => l.includes('╭')) ?? '';

    await pressKey(stdin, 'f'); // full width
    await waitFor(() => !term.text().includes('▶ ✓'));

    const wideBox =
      term
        .text()
        .split('\n')
        .find((l) => l.includes('╭')) ?? '';
    expect(boxWidth(wideBox)).toBeGreaterThan(boxWidth(narrowBox) + 20);
    expect(term.text()).toContain('Full width');

    await pressKey(stdin, 'f'); // back to two columns
    await waitFor(() => term.text().includes('▶ ✓'));

    instance.unmount();
  });

  it('leaves exactly one blank row under each section title', async () => {
    const { instance, term } = renderApp(30, 100);

    await waitFor(() => term.text().includes('PARAMETERS (4)'));
    const lines = term.text().split('\n');
    const descTitle = lines.findIndex((l) => l.includes('DESCRIPTION'));
    const descBody = lines.findIndex((l) => l.includes('mock tool with parameters'));
    const paramTitle = lines.findIndex((l) => l.includes('PARAMETERS (4)'));
    const firstParam = lines.findIndex((l) => l.includes('1  q  string'));

    expect(descTitle).toBeGreaterThan(-1);
    expect(paramTitle).toBeGreaterThan(-1);
    expect(firstParam).toBeGreaterThan(-1);
    // Title, one blank row, then content — for each section.
    expect(descBody).toBe(descTitle + 2);
    expect(paramTitle).toBe(descBody + 2);
    expect(firstParam).toBe(paramTitle + 2);

    instance.unmount();
  });

  it('keeps a literal section heading per region, with no focus marker glyph', async () => {
    const { instance, term, stdin } = renderApp(30, 100);

    await waitFor(() => term.text().includes('Parameters (4)'));
    // Headings are literal in every focus state: the row keeps the same bar
    // glyph and label, and focus is signalled by colour alone (verified against
    // real SGR codes in scripts/tui-e2e.mjs T15 — this harness drops them).
    expect(term.text()).toContain('▌ DESCRIPTION');
    expect(term.text()).toContain('▌ PARAMETERS (4)');
    expect(term.text()).not.toMatch(/▶ ▌/);
    // The rule is drawn out to the panel width.
    expect(
      term
        .text()
        .split('\n')
        .some((l) => l.includes('DESCRIPTION ───'))
    ).toBe(true);

    // Moving focus must not change the glyph, shift the label, or add a marker.
    await pressKey(stdin, '\t');
    await waitFor(() => term.text().includes('Quick Actions — Description'));
    expect(term.text()).toContain('▌ DESCRIPTION');
    expect(term.text()).toContain('▌ PARAMETERS (4)');
    expect(term.text()).not.toMatch(/▶ ▌/);

    instance.unmount();
  });
});
