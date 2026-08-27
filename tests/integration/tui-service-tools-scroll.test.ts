/**
 * Reproduces the ServiceTools scroll-indicator overlap bug against the REAL
 * components, using the optimized app's outer chrome (Header) and contentHeight
 * calculation. Mocks tool discovery to return 50 tools and drives ↓ keystrokes
 * to scroll to the bottom, then asserts the "↑ more" indicator occupies its own
 * line rather than overlapping the last tool row.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { Readable } from 'stream';
import { Box, useStdout, render } from 'ink';
import { ServiceTools } from '../../src/tui/components/ServiceTools.js';
import { Header } from '../../src/tui/components/Header.js';
import type { ServiceDefinition } from '../../src/types/service.js';

vi.mock('../../src/tui/discovery-worker.js', () => ({
  fetchServiceTools: () =>
    Promise.resolve(
      Array.from({ length: 50 }, (_, i) => ({
        // Long names well beyond the tool-list panel width, to exercise truncation
        name: `namespace___tool_${String(i).padStart(3, '0')}_with_a_very_long_extra_suffix_that_goes_well_beyond_the_tool_list_width_0123456789`,
        description: 'mock tool',
        inputSchema: { type: 'object', properties: {} },
      }))
    ),
}));

// Minimal ANSI terminal emulator (same as repro script)
class Terminal {
  grid: string[][];
  rows: number;
  cols: number;
  private r = 0;
  private c = 0;
  constructor(rows: number, cols: number) {
    this.rows = rows;
    this.cols = cols;
    this.grid = Array.from({ length: rows }, () => Array(cols).fill(' '));
  }
  feed(data: string) {
    let i = 0;
    while (i < data.length) {
      const ch = data[i]!;
      if (ch === '\x1b') {
        if (data[i + 1] === '[') {
          let j = i + 2;
          let paramStr = '';
          while (j < data.length && !/[A-Za-z]/.test(data[j]!)) {
            paramStr += data[j]!;
            j++;
          }
          const final = data[j]!;
          j++;
          const isPrivate = paramStr.includes('?');
          const clean = paramStr.replace(/[^0-9;]/g, '');
          const parts = clean.split(';');
          const num = (s: string) => (s === '' ? 1 : parseInt(s, 10) || 1);
          if (!isPrivate) {
            if (final === 'H' || final === 'f') {
              this.r = Math.min(this.rows - 1, Math.max(0, num(parts[0] ?? '1') - 1));
              this.c = Math.min(this.cols - 1, Math.max(0, num(parts[1] ?? '1') - 1));
            } else if (final === 'A') this.r = Math.max(0, this.r - num(parts[0] ?? '1'));
            else if (final === 'B') this.r = Math.min(this.rows - 1, this.r + num(parts[0] ?? '1'));
            else if (final === 'C') this.c = Math.min(this.cols - 1, this.c + num(parts[0] ?? '1'));
            else if (final === 'D') this.c = Math.max(0, this.c - num(parts[0] ?? '1'));
            else if (final === 'G')
              this.c = Math.min(this.cols - 1, Math.max(0, num(parts[0] ?? '1') - 1));
            else if (final === 'K') {
              if (this.r >= 0 && this.r < this.rows) {
                for (let k = this.c; k < this.cols; k++) this.grid[this.r]![k] = ' ';
              }
            } else if (final === 'J' && parts[0] === '2') {
              for (let rr = 0; rr < this.rows; rr++)
                for (let cc = 0; cc < this.cols; cc++) this.grid[rr]![cc] = ' ';
            }
          }
          i = j;
        } else {
          i += 2;
          while (i < data.length && !/[A-Za-z]/.test(data[i]!)) i++;
          i++;
        }
      } else if (ch === '\n') {
        this.r++;
        this.c = 0;
        i++;
      } else if (ch === '\r') {
        this.c = 0;
        i++;
      } else if (ch >= ' ') {
        if (this.r >= 0 && this.r < this.rows && this.c >= 0 && this.c < this.cols) {
          this.grid[this.r]![this.c] = ch;
        }
        this.c++;
        i++;
      } else {
        i++;
      }
    }
  }
  text(): string {
    return this.grid.map((row) => row.join('').replace(/\s+$/, '')).join('\n');
  }
}

const createStdin = () => {
  const stdin: any = new Readable({ read() {} });
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  stdin.ref = () => {};
  stdin.unref = () => {};
  return stdin;
};

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

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
// Push a sequence of keystrokes with enough delay between each for Ink's
// throttled render loop (32ms) to flush, then flush the scheduler.
const typeKeys = async (stdin: any, chars: string, perKey = 60) => {
  for (const ch of chars) {
    stdin.push(Buffer.from(ch, 'utf8'));
    await new Promise((r) => setImmediate(r));
    await sleep(perKey);
  }
};

describe('ServiceTools scroll indicator (real components, optimized chrome)', () => {
  it('keeps ↑ more on its own line at the bottom of a long tool list (24-row terminal)', async () => {
    const { instance, term, stdin } = renderApp(24, 80);

    // Wait for tools to load
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setImmediate(r));
      await sleep(10);
      if (term.text().includes('namespace___tool_000')) break;
    }
    expect(term.text()).toContain('namespace___tool_000');

    // Scroll all the way to the bottom
    for (let i = 0; i < 60; i++) {
      stdin.push(Buffer.from('\x1b[B', 'utf8')); // down arrow
      await sleep(20);
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
      const descCol = row.indexOf('Description');
      if (descCol > -1) {
        expect(ellipsisCol).toBeLessThan(descCol);
      }
    }

    instance.unmount();
  });

  it('filters the tool list by name when entering search mode', async () => {
    const { instance, term, stdin } = renderApp(24, 80);

    // Wait for tools to load
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setImmediate(r));
      await sleep(10);
      if (term.text().includes('namespace___tool_000')) break;
    }

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
});
