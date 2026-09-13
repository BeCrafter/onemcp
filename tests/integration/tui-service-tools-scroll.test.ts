/**
 * Reproduces the ServiceTools scroll-indicator overlap bug against the REAL
 * components, using the optimized app's outer chrome (Header) and contentHeight
 * calculation. Mocks tool discovery to return 50 tools and drives ↓ keystrokes
 * to scroll to the bottom, then asserts the "↑ more" indicator occupies its own
 * line rather than overlapping the last tool row.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { Box, useStdout, render } from 'ink';
import { ServiceTools } from '../../src/tui/components/ServiceTools.js';
import { Header } from '../../src/tui/components/Header.js';
import type { ServiceDefinition } from '../../src/types/service.js';
import {
  Terminal,
  createStdin,
  sleep,
  waitFor,
  typeKeys,
  pressKey,
} from './helpers/ansi-terminal.js';

// Hoisted so the mock factory can reference it and tests can assert that the
// mock (not a real connection attempt) drove the render.
const { fetchServiceToolsMock } = vi.hoisted(() => {
  const tools = Array.from({ length: 50 }, (_, i) => ({
    // Long names well beyond the tool-list panel width, to exercise truncation
    name: `namespace___tool_${String(i).padStart(3, '0')}_with_a_very_long_extra_suffix_that_goes_well_beyond_the_tool_list_width_0123456789`,
    description: 'mock tool',
    inputSchema: { type: 'object', properties: {} },
  }));
  return { fetchServiceToolsMock: vi.fn(() => Promise.resolve(tools)) };
});

vi.mock('../../src/tui/discovery-worker.js', () => ({
  __esModule: true,
  fetchServiceTools: fetchServiceToolsMock,
  // ServiceTools also imports the call API; tests here never invoke it but
  // the named exports must exist for the module import to succeed.
  callServiceTool: vi.fn(),
  ToolCallError: class ToolCallError extends Error {},
  DiscoveryError: class DiscoveryError extends Error {},
  DiscoveryErrorType: { TIMEOUT: 'timeout', CONNECTION_FAILED: 'connection_failed' },
  default: fetchServiceToolsMock,
}));

// Minimal ANSI terminal emulator (same as repro script)
// Mirrors the optimized app's outer chrome + contentHeight wiring
const MiniApp: React.FC<{ rows: number }> = ({ rows }) => {
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows || rows;
  const OUTER_CHROME_LINES = 5;
  const STATUS_BAR_LINES = 0;
  const contentHeight = Math.max(8, terminalHeight - OUTER_CHROME_LINES - STATUS_BAR_LINES);

  const service: ServiceDefinition = {
    name: 'big-service',
    transport: 'stdio',
    command: 'node',
    enabled: true,
    tags: [],
    connectionPool: {
      maxConnections: 5,
      idleTimeout: 60000,
      connectionTimeout: 30000,
    },
  };

  return React.createElement(
    Box,
    { flexDirection: 'column', height: terminalHeight },
    React.createElement(Header, {
      title: 'MCP Router System',
      subtitle: 'Configuration Manager',
      stats: [
        { label: 'Services', value: 1, color: 'yellow' },
        { label: 'Enabled', value: 1, color: 'green' },
        { label: 'Mode', value: 'tui', color: 'blue' },
      ],
    }),
    React.createElement(
      Box,
      { flexDirection: 'column', flexGrow: 1 },
      React.createElement(ServiceTools, {
        service,
        onBack: () => {},
        onToggleTool: () => {},
        toolStates: {},
        terminalHeight: contentHeight,
      })
    )
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
  return { instance, term, stdin, stdout };
}

// Poll the rendered terminal until `pred` holds or the timeout elapses, so slow
// CI runners don't flake on Ink's 32ms-throttled render loop.
// Push a sequence of keystrokes with enough delay between each for Ink's
// throttled render loop (32ms) to flush, then flush the scheduler.
describe('ServiceTools scroll indicator (real components, optimized chrome)', () => {
  it('keeps ↑ more on its own line at the bottom of a long tool list (24-row terminal)', async () => {
    const { instance, term, stdin } = renderApp(24, 80);

    // Wait for tools to load (mocked discovery must drive the render)
    await waitFor(() => term.text().includes('namespace___tool_000'));
    expect(fetchServiceToolsMock).toHaveBeenCalled();
    expect(term.text()).toContain('namespace___tool_000');

    // Scroll all the way to the bottom (stop early once tool_049 is selected)
    for (let i = 0; i < 120; i++) {
      stdin.push(Buffer.from('\x1b[B', 'utf8')); // down arrow
      await new Promise((r) => setImmediate(r));
      await sleep(25);
      if (
        term
          .text()
          .split('\n')
          .some((l) => l.includes('▶') && l.includes('tool_049'))
      ) {
        break;
      }
    }

    const text = term.text();

    const lines = text.split('\n');
    const moreLine = lines.findIndex((l) => l.includes('↑ more'));
    expect(moreLine).toBeGreaterThan(-1);

    // The line containing "↑ more" must be ONLY the indicator, not a tool row
    expect(lines[moreLine]!.includes('namespace___tool_')).toBe(false);
    expect(lines[moreLine]!.trim()).toBe('↑ more');

    // The last tool row (selected, at bottom) is on its own line above it
    const lastToolLine = lines.findIndex((l) => l.includes('tool_049'));
    expect(lastToolLine).toBeGreaterThan(-1);
    expect(lines[lastToolLine]!.includes('▶')).toBe(true);
    expect(lastToolLine).toBeLessThan(moreLine);

    // Long tool names must be truncated within the left panel, not overflow
    // into the description column. Left panel width is TOOLS_LIST_WIDTH = 38
    // at 80 columns (76 * 0.5). A tool row and the description column legitimately
    // share the same row (side-by-side panels), so assert the truncation ellipsis
    // sits strictly before the description column.
    const LEFT_PANEL_WIDTH = 38;
    const toolRows = lines.filter((l) => l.includes('namespace___tool_'));
    expect(toolRows.length).toBeGreaterThan(0);
    for (const row of toolRows) {
      const ellipsisCol = row.indexOf('…');
      expect(ellipsisCol).toBeGreaterThan(0);
      expect(ellipsisCol).toBeLessThan(LEFT_PANEL_WIDTH);
      const descCol = row.indexOf('DESCRIPTION');
      if (descCol > -1) {
        expect(ellipsisCol).toBeLessThan(descCol);
      }
    }

    instance.unmount();
  });

  it('filters the tool list by name when entering search mode', async () => {
    const { instance, term, stdin } = renderApp(24, 80);

    // Wait for tools to load (mocked discovery must drive the render)
    await waitFor(() => term.text().includes('namespace___tool_000'));

    // Enter search mode and type "tool_04" → matches tool_040..tool_049 (10 tools)
    await typeKeys(stdin, '/');
    await typeKeys(stdin, 'tool_04');

    const text = term.text();
    // Search bar shows the query and match count
    expect(text).toContain('Search: tool_04');
    expect(text).toContain('[10/50 matched]');

    // Only tool_04x rows are visible; tool_000 (non-matching) is gone
    expect(text).not.toContain('namespace___tool_000');
    expect(text).toContain('namespace___tool_040');
    // The first match is selected (▶ marker)
    expect(text).toContain('▶');

    instance.unmount();
  });

  it('shows an empty state when no tools match the query', async () => {
    const { instance, term, stdin } = renderApp(24, 80);

    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setImmediate(r));
      await sleep(10);
      if (term.text().includes('namespace___tool_000')) break;
    }

    await typeKeys(stdin, '/');
    await typeKeys(stdin, 'zzzzzz');

    const text = term.text();
    expect(text).toContain('[0/50 matched]');
    expect(text).toContain('No tools match');

    instance.unmount();
  });

  it('exits search input mode but keeps the filter on first Esc, clears on second', async () => {
    const { instance, term, stdin } = renderApp(24, 80);

    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setImmediate(r));
      await sleep(10);
      if (term.text().includes('namespace___tool_000')) break;
    }

    // Enter search input mode and narrow the list
    await typeKeys(stdin, '/');
    await typeKeys(stdin, 'tool_04');
    expect(term.text()).toContain('[10/50 matched]');
    // Still in search input mode (yellow cursor visible)
    expect(term.text()).toContain('_');

    // First Esc: leave input mode but keep the filter active
    stdin.push(Buffer.from('\x1b', 'utf8')); // Esc
    await new Promise((r) => setImmediate(r));
    await sleep(80);
    const afterFirstEsc = term.text();
    expect(afterFirstEsc).toContain('[10/50 matched]');
    // No longer in input mode (no cursor)
    expect(afterFirstEsc).not.toContain('Search: tool_04_');
    // Filter still applied: non-matching tool hidden
    expect(afterFirstEsc).not.toContain('namespace___tool_000');

    // Second Esc: clear the query, restore the full list
    stdin.push(Buffer.from('\x1b', 'utf8')); // Esc
    await new Promise((r) => setImmediate(r));
    await sleep(80);
    const afterSecondEsc = term.text();
    expect(afterSecondEsc).toContain('namespace___tool_000');
    expect(afterSecondEsc).toContain('Press / to search');

    instance.unmount();
  });

  it('toggles only the filtered tool after confirming the search with Enter', async () => {
    const { instance, term, stdin } = renderApp(24, 80);

    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setImmediate(r));
      await sleep(10);
      if (term.text().includes('namespace___tool_000')) break;
    }

    // Search "tool_040", confirm with Enter, then toggle with Space
    await typeKeys(stdin, '/');
    await typeKeys(stdin, 'tool_040');
    stdin.push(Buffer.from('\r', 'utf8')); // Enter
    await new Promise((r) => setImmediate(r));
    await sleep(80);
    stdin.push(Buffer.from(' ', 'utf8')); // Space → toggle
    await new Promise((r) => setImmediate(r));
    await sleep(80);

    const text = term.text();
    // tool_040 was enabled (✓ green) and is now disabled (✗ red), shown selected
    // Find the selected row containing tool_040
    const selectedRow = text.split('\n').find((l) => l.includes('▶') && l.includes('tool_040'));
    expect(selectedRow).toBeDefined();
    expect(selectedRow!.includes('✗')).toBe(true);

    instance.unmount();
  });

  it('scrolls an expanded description in its own region, leaving ↑/↓ to tool navigation', async () => {
    const longDesc = Array.from(
      { length: 80 },
      (_, i) => `desc-line-${String(i).padStart(2, '0')}`
    ).join('\n');
    fetchServiceToolsMock.mockImplementation(() =>
      Promise.resolve([
        { name: 'alpha', description: longDesc, inputSchema: { type: 'object', properties: {} } },
        {
          name: 'bravo',
          description: 'bravo short description',
          inputSchema: { type: 'object', properties: {} },
        },
      ])
    );

    const { instance, term, stdin } = renderApp(24, 80);
    await waitFor(() => term.text().includes('desc-line-00'));

    // 展开：立刻回到描述开头（展开是为了从头读），焦点交给描述区
    await pressKey(stdin, '\x05'); // Ctrl+E
    await waitFor(() => !term.text().includes('Ctrl+E expands'));
    expect(term.text()).toContain('desc-line-00');
    expect(term.text()).toContain('↑/↓ Scroll line');
    expect(term.text()).toContain('Esc Back to tool list');

    // 描述区里 ↑/↓ 逐行滚动，而不再切换工具（关键判别：选中项必须没变）
    await pressKey(stdin, '\x1b[B'); // ↓
    await waitFor(() => !term.text().includes('desc-line-00'));
    expect(term.text()).not.toContain('bravo short description');

    // Esc 把箭头交还工具列表，且**不折叠**描述、不离开工具视图 ——
    // 这正是「展开后想切工具」那条反馈的判据。
    await pressKey(stdin, '\x1b'); // Esc
    await waitFor(() => term.text().includes('↑/↓ Navigate'));
    expect(term.text()).not.toContain('↑/↓ Scroll line');

    // 列表焦点下 ↓ 立刻切换工具（无需先折叠），换到新工具后描述回到折叠态
    await pressKey(stdin, '\x1b[B'); // ↓ → bravo
    await waitFor(() => term.text().includes('bravo short description'));
    expect(term.text()).toContain('Ctrl+E Expand desc');

    instance.unmount();
  });
});
