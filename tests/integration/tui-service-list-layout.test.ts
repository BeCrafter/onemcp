/**
 * Integration tests for the service list layout.
 *
 * Regression guard for the frame-overflow bug: long endpoints used to wrap rows
 * onto two or three lines, which pushed the rendered frame past the terminal
 * height. A frame taller than the viewport makes a real terminal scroll
 * mid-render, so every later absolute cursor move lands on the wrong row —
 * visible as stray characters and dropped continuation lines.
 *
 * Invariants asserted here:
 *   - every service renders on exactly ONE line (no wrapping),
 *   - the frame never writes past the last terminal row,
 *   - narrow terminals degrade (tags/tool counts dropped, then the name column
 *     shrinks) instead of collapsing the endpoint to one character per line.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { Box, useStdout } from 'ink';
import { ServiceList, computeColumnLayout } from '../../src/tui/components/ServiceList.js';
import type { ServiceDefinition } from '../../src/types/service.js';
import { renderWithTerminal, waitFor } from './helpers/ansi-terminal.js';

const mkService = (name: string, url: string, tags: string[] = []): ServiceDefinition => ({
  name,
  transport: 'http',
  url,
  enabled: true,
  tags,
  connectionPool: { maxConnections: 5, idleTimeout: 60000, connectionTimeout: 30000 },
});

/** Sixteen services, most with endpoints far wider than their column. */
const manyServices: ServiceDefinition[] = [
  mkService(
    'mock-stdio',
    'node /Users/someone/code/Github/BeCrafter/skill-mcp/dist/index.js serve',
    ['audit', 'mock']
  ),
  mkService('mock-broken', 'node /tmp/tui-audit/does-not-exist.cjs', ['audit']),
  mkService('mock-http-remote', 'http://127.0.0.1:5999/mcp', ['audit', 'http']),
  mkService('jymcp', 'https://app2.example.com/jyskills/jymcp', ['tal', 'jiaoyan']),
  mkService('toolbox', 'npx -y @scope/npx-package-name@latest'),
  mkService('kv-store', 'npx -y @scope/kv-store-package', ['kv', 'store']),
  mkService('catalog', 'https://mcp.example.com/catalog/mcp'),
  mkService('browser-bridge', 'npx -y bridge-package@latest'),
  mkService('repo-docs', 'npx remote-helper https://docs.example.io/docs', ['docs', 'docsx']),
  mkService('alpha', 'https://a.example.com/a/very/long/path/to/mcp/endpoint'),
  mkService('beta', 'https://b.example.com/b/very/long/path/to/mcp/endpoint'),
  mkService('gamma', 'https://c.example.com/c/very/long/path/to/mcp/endpoint'),
  mkService('delta', 'https://d.example.com/d/very/long/path/to/mcp/endpoint'),
  mkService('epsilon', 'https://e.example.com/e/very/long/path/to/mcp/endpoint'),
  mkService('zeta', 'https://f.example.com/f/very/long/path/to/mcp/endpoint'),
  mkService('eta', 'https://g.example.com/g/very/long/path/to/mcp/endpoint'),
];

/** Mirrors how app-optimized mounts the list: a fixed-height column. */
const MiniList: React.FC<{ services: ServiceDefinition[]; height: number }> = ({
  services,
  height,
}) => {
  const { stdout } = useStdout();
  return React.createElement(
    Box,
    { flexDirection: 'column', height: stdout?.rows || 24 },
    React.createElement(ServiceList, {
      services,
      selectedIndex: 0,
      onSelect: () => {},
      terminalHeight: height,
    })
  );
};

/**
 * The service name cell (status symbol + name) of a rendered row, or '' when
 * the line has no name there. Matching the CELL avoids false hits from names
 * that are substrings of each other (eta ⊂ beta/zeta) or of an endpoint.
 */
const nameInRow = (line: string): string => {
  const cell = line.slice(4, 29);
  const match = /^\s*[+-]\s+(\S+)/.exec(cell);
  return match?.[1] ?? '';
};

describe('ServiceList layout', () => {
  it('gives the endpoint column a sane budget at decreasing widths', () => {
    const wide = computeColumnLayout(100);
    expect(wide).toEqual({
      nameWidth: 25,
      transportWidth: 8,
      endpointWidth: 20,
      tagWidth: 28,
      toolWidth: 12,
    });

    // Too narrow for tags → the tag column is dropped, not squeezed to nothing.
    const medium = computeColumnLayout(80);
    expect(medium.tagWidth).toBeNull();
    expect(medium.toolWidth).toBe(12);
    expect(medium.endpointWidth).toBe(28);
    expect(medium.endpointWidth).toBeGreaterThanOrEqual(10);

    // Even narrower → tool counts go too.
    const narrow = computeColumnLayout(60);
    expect(narrow.tagWidth).toBeNull();
    expect(narrow.toolWidth).toBeNull();
    expect(narrow.endpointWidth).toBeGreaterThanOrEqual(10);

    // Very narrow → the name column shrinks before the endpoint is starved.
    const tiny = computeColumnLayout(40);
    expect(tiny.nameWidth).toBeLessThan(25);
    expect(tiny.endpointWidth).toBeGreaterThanOrEqual(10);
  });

  it('renders one line per service and never overflows the terminal height', async () => {
    const { instance, term } = renderWithTerminal(
      React.createElement(MiniList, { services: manyServices, height: 29 }),
      { rows: 34, cols: 100 }
    );

    await waitFor(() => term.text().includes('mock-stdio'));

    // header (1) + list box borders (2) + one line per service (16) +
    // footer box (3) = 22. A wrapped row would make this count grow.
    const lines = term.lines();
    expect(lines.length).toBe(22);

    // No service row may be followed by a wrapped continuation of itself.
    for (const service of manyServices) {
      const hits = lines.filter((l) => nameInRow(l) === service.name);
      expect(hits, `service ${service.name} should occupy exactly one line`).toHaveLength(1);
    }

    // Every line stays inside the terminal width.
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(100);
    }

    // Long endpoints are elided rather than wrapped.
    expect(term.text()).toContain('…');

    // The frame must not write past the last row (that is what corrupts a real
    // terminal: it scrolls and every later absolute write lands one row off).
    expect(term.maxRowWritten).toBeLessThanOrEqual(33);

    instance.unmount();
  });

  it('degrades at 60 columns instead of collapsing to one character per line', async () => {
    const { instance, term } = renderWithTerminal(
      React.createElement(MiniList, { services: manyServices, height: 29 }),
      { rows: 34, cols: 60 }
    );

    await waitFor(() => term.text().includes('mock-stdio'));

    const lines = term.lines();
    // Still one line per service (22 lines) — the old layout wrapped every
    // endpoint character onto its own row at this width.
    expect(lines.length).toBe(22);
    for (const service of manyServices) {
      expect(lines.filter((l) => nameInRow(l) === service.name)).toHaveLength(1);
    }

    // Tags are dropped to buy room for the endpoint, which stays readable.
    expect(term.text()).not.toContain('[audit]');
    expect(term.text()).toContain('http');
    expect(term.maxRowWritten).toBeLessThanOrEqual(33);

    instance.unmount();
  });

  it('paginates instead of overflowing when the list is taller than the view', async () => {
    const services = Array.from({ length: 40 }, (_, i) =>
      mkService(`svc-${i}`, `http://127.0.0.1:${9000 + i}/mcp`)
    );
    const { instance, term } = renderWithTerminal(
      React.createElement(MiniList, { services, height: 14 }),
      { rows: 20, cols: 100 }
    );

    await waitFor(() => term.text().includes('svc-0'));

    // height 14 - 5 chrome - 1 pager = 8 items per page → 40/8 = 5 pages.
    const lines = term.lines();
    expect(lines.length).toBeLessThanOrEqual(20);
    expect(lines.filter((l) => l.includes('svc-')).length).toBe(8);
    expect(term.text()).toContain('1/5');
    expect(term.maxRowWritten).toBeLessThanOrEqual(19);

    instance.unmount();
  });
});
