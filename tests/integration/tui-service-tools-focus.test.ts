/**
 * Focus visibility in the flattened ServiceTools panel.
 *
 * A focused region used to be signalled only by the colour of a single `▌` cell
 * — and the "focused" colour was the terminal default, i.e. exactly the colour
 * of the label and rule sitting next to it. Focus was therefore invisible, and
 * (because both test harnesses drop SGR) untestable. These tests pin the glyph
 * that replaced it: exactly one region carries `▶ `, the mark moves with Tab,
 * and the bottom hints describe the marked region and nothing else.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { Box, useStdout, render } from 'ink';
import { ServiceTools } from '../../src/tui/components/ServiceTools.js';
import type { ToolCallOutcome } from '../../src/tui/discovery-worker.js';
import type { Tool } from '../../src/types/tool.js';
import type { ServiceDefinition } from '../../src/types/service.js';
import { Terminal, createStdin, waitFor, typeKeys, pressKey } from './helpers/ansi-terminal.js';

const { fetchServiceToolsMock, callServiceToolMock } = vi.hoisted(() => {
  // Long enough that the collapsed description is clipped by `descCap`, which is
  // what drives the description region's "clipped" hint.
  const longDescription = [
    'mock tool with parameters',
    ...Array.from({ length: 40 }, (_, i) => `desc-line-${String(i).padStart(2, '0')}`),
  ].join('\n');
  const tool: Tool = {
    name: 'alpha',
    namespacedName: 'demo__alpha',
    serviceName: 'demo',
    description: longDescription,
    inputSchema: {
      type: 'object' as const,
      properties: {
        q: { type: 'string', description: 'query text' },
        limit: { type: 'integer', description: 'max results' },
      },
      required: ['q'],
    },
    enabled: true,
  };
  const outcome: ToolCallOutcome = {
    isError: false,
    text: '{"ok":true}',
    formatted: '{\n  "ok": true\n}',
    nonTextTypes: [],
    raw: '{\n  "content": []\n}',
  };
  return {
    fetchServiceToolsMock: vi.fn(() => Promise.resolve([tool])),
    callServiceToolMock: vi.fn(() => Promise.resolve(outcome)),
  };
});

vi.mock('../../src/tui/discovery-worker.js', () => ({
  __esModule: true,
  fetchServiceTools: fetchServiceToolsMock,
  callServiceTool: callServiceToolMock,
  ToolCallError: class ToolCallError extends Error {},
  DiscoveryError: class DiscoveryError extends Error {},
  DiscoveryErrorType: { TIMEOUT: 'timeout', CONNECTION_FAILED: 'connection_failed' },
  default: fetchServiceToolsMock,
}));

vi.mock('../../src/tui/clipboard.js', () => ({
  __esModule: true,
  copyToClipboard: vi.fn(() => true),
}));

const MiniApp: React.FC<{ rows: number }> = ({ rows }) => {
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
      onBack: () => {},
      onToggleTool: () => {},
      toolStates: {},
      terminalHeight,
    })
  );
};

function renderApp(rows: number, cols: number) {
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
  const instance = render(React.createElement(MiniApp, { rows }), {
    stdout,
    stdin,
    exitOnCtrlC: false,
  });
  return { instance, term, stdin };
}

describe('ServiceTools region focus (real components)', () => {
  it('keeps every heading glyph constant and moves the focus cue with Tab', async () => {
    const { instance, term, stdin } = renderApp(30, 100);
    await waitFor(() => term.text().includes('mock tool with parameters'));

    // Focus is carried by colour alone, and this harness drops SGR — so the
    // heading rows must stay *literally* identical between focus states: no
    // marker glyph appears or disappears. The footer names the focused region,
    // which is the part this harness can observe.
    expect(term.text()).toContain('Tools for: demo');
    expect(term.text()).toContain('▌ DESCRIPTION');
    expect(term.text()).not.toMatch(/▶ ▌/);

    await typeKeys(stdin, '\t');
    expect(await waitFor(() => term.text().includes('Quick Actions — Description'))).toBe(true);
    expect(term.text()).toContain('Tools for: demo');
    expect(term.text()).toContain('▌ DESCRIPTION');
    expect(term.text()).not.toMatch(/▶ ▌/);

    await typeKeys(stdin, '\t');
    expect(await waitFor(() => term.text().includes('Quick Actions — Parameters'))).toBe(true);
    expect(term.text()).toContain('▌ PARAMETERS (2)');
    expect(term.text()).not.toMatch(/▶ ▌/);

    // A third Tab wraps back to the tool list.
    await typeKeys(stdin, '\t');
    expect(await waitFor(() => term.text().includes('Quick Actions — Tools'))).toBe(true);

    instance.unmount();
  });

  it("shows only the focused region's keys, and names the region", async () => {
    const { instance, term, stdin } = renderApp(30, 100);
    await waitFor(() => term.text().includes('mock tool with parameters'));

    expect(term.text()).toContain('Quick Actions — Tools');
    expect(term.text()).toContain('Space Toggle');
    expect(term.text()).not.toContain('↑/↓ Param');

    await typeKeys(stdin, '\t');
    await waitFor(() => term.text().includes('Quick Actions — Description'));
    expect(term.text()).toContain('Description is clipped — Ctrl+E expands it');
    expect(term.text()).not.toContain('Space Toggle');
    expect(term.text()).not.toContain('↑/↓ Param');

    // Expanding makes the description scrollable, and the hint says so.
    await pressKey(stdin, '\x05'); // Ctrl+E → expand + focus the description
    await waitFor(() => term.text().includes('↑/↓ Scroll line'));
    expect(term.text()).not.toContain('Ctrl+E expands');
    await pressKey(stdin, '\x05'); // Ctrl+E → collapse; focus returns to the list

    // Collapsing handed focus back to the tool list, so params is two Tabs away.
    await typeKeys(stdin, '\t');
    await typeKeys(stdin, '\t');
    await waitFor(() => term.text().includes('Quick Actions — Parameters'));
    expect(term.text()).toContain('↑/↓ Param');
    expect(term.text()).not.toContain('Space Toggle');
    // The description's own key must not leak into the parameters region.
    expect(term.text()).not.toContain('Scroll line');

    instance.unmount();
  });

  it('keeps a transient notice off the hint lines', async () => {
    const { instance, term, stdin } = renderApp(30, 100);
    await waitFor(() => term.text().includes('mock tool with parameters'));

    // Run the tool from the parameters region: Tab, fill `q`, Ctrl+R.
    await typeKeys(stdin, '\t');
    await typeKeys(stdin, '\t');
    await typeKeys(stdin, 'hello');
    await pressKey(stdin, '\x12'); // Ctrl+R
    await waitFor(() => term.text().includes('Result: ✓'));

    await pressKey(stdin, '\x19'); // Ctrl+Y → copy notice
    await waitFor(() => term.text().includes('Copied'));

    const lines = term.text().split('\n');
    const hintLine = lines.findIndex((line) => line.includes('↑/↓ Cursor'));
    const actionLine = lines.findIndex((line) => line.includes('Ctrl+Y Copy result'));
    const noticeLine = lines.findIndex((line) => line.includes('Copied'));

    // Both hint lines survive untouched, and the notice took the footer's
    // heading slot — so the footer never grows past its measured line budget.
    expect(hintLine).toBeGreaterThan(-1);
    expect(actionLine).toBeGreaterThan(hintLine);
    expect(noticeLine).toBeGreaterThan(-1);
    expect(noticeLine).toBeLessThan(hintLine);
    expect(term.text()).not.toContain('Quick Actions —');

    instance.unmount();
  });

  it('lets the result region join the Tab cycle only once it has output', async () => {
    const { instance, term, stdin } = renderApp(30, 100);
    await waitFor(() => term.text().includes('mock tool with parameters'));

    // No run yet: three Tabs from the list come back to the list.
    await typeKeys(stdin, '\t');
    await typeKeys(stdin, '\t');
    await typeKeys(stdin, '\t');
    await waitFor(() => term.text().includes('Quick Actions — Tools'));
    expect(term.text()).not.toContain('Quick Actions — Result');

    // Run from the parameters region (list → desc → params, then type + Ctrl+R).
    await typeKeys(stdin, '\t');
    await typeKeys(stdin, '\t');
    await waitFor(() => term.text().includes('Quick Actions — Parameters'));
    await typeKeys(stdin, 'hello');
    await pressKey(stdin, '\x12'); // Ctrl+R
    await waitFor(() => term.text().includes('Result: ✓'));
    expect(term.text()).toContain('Quick Actions — Result');

    // Still in the cycle: result → list → desc → params → result.
    await typeKeys(stdin, '\t');
    expect(await waitFor(() => term.text().includes('Quick Actions — Tools'))).toBe(true);
    await typeKeys(stdin, '\t');
    await typeKeys(stdin, '\t');
    await typeKeys(stdin, '\t');
    expect(await waitFor(() => term.text().includes('Quick Actions — Result'))).toBe(true);
    expect(term.text()).toContain('Ctrl+Y Copy result');

    instance.unmount();
  });
});
