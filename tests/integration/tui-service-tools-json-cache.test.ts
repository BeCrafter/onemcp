/**
 * Integration tests for the tools view's JSON editor and per-tool state.
 *
 * Guards behaviour the E2E scenarios do not reach:
 *   - Ctrl+J projects the typed parameters into the raw-JSON editor, and editing
 *     that JSON projects back into the form (plus extra-key count);
 *   - invalid JSON is refused with a visible error and no backend call;
 *   - each tool keeps its own typed arguments when you switch away and back.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { Box, useStdout } from 'ink';
import { ServiceTools } from '../../src/tui/components/ServiceTools.js';
import type { Tool } from '../../src/types/tool.js';
import type { ServiceDefinition } from '../../src/types/service.js';
import { renderWithTerminal, waitFor, pressKey, typeKeys } from './helpers/ansi-terminal.js';

const { fetchServiceToolsMock, callServiceToolMock } = vi.hoisted(() => {
  const mk = (name: string): Tool => ({
    name,
    namespacedName: `demo__${name}`,
    serviceName: 'demo',
    description: `mock tool ${name}`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        q: { type: 'string', description: 'query text' },
        verbose: { type: 'boolean', description: 'chatty output' },
      },
      required: ['q'],
    },
    enabled: true,
  });
  return {
    fetchServiceToolsMock: vi.fn(() => Promise.resolve([mk('alpha'), mk('bravo')])),
    callServiceToolMock: vi.fn(() =>
      Promise.resolve({
        isError: false,
        text: '{"ok":true}',
        formatted: '{\n  "ok": true\n}',
        nonTextTypes: [],
        raw: '{\n  "content": []\n}',
      })
    ),
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

const { copyToClipboardMock } = vi.hoisted(() => ({
  copyToClipboardMock: vi.fn((_text: string) => true),
}));
vi.mock('../../src/tui/clipboard.js', () => ({
  __esModule: true,
  copyToClipboard: copyToClipboardMock,
}));

const MiniApp: React.FC = () => {
  const { stdout } = useStdout();
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
    { flexDirection: 'column', height: stdout?.rows || 40 },
    React.createElement(ServiceTools, {
      service,
      onBack: () => {},
      onToggleTool: () => {},
      toolStates: {},
      terminalHeight: stdout?.rows || 40,
    })
  );
};

const renderTools = () => renderWithTerminal(React.createElement(MiniApp), { rows: 40, cols: 110 });

describe('ServiceTools JSON editor and per-tool state', () => {
  beforeEach(() => {
    fetchServiceToolsMock.mockClear();
    callServiceToolMock.mockClear();
  });

  it('projects typed parameters into the JSON editor and back', async () => {
    const { instance, term, stdin } = renderTools();
    await waitFor(() => term.text().includes('PARAMETERS (2)'));

    await pressKey(stdin, '\t'); // list → params
    await typeKeys(stdin, 'hello');
    await waitFor(() => term.text().includes('hello'));

    await pressKey(stdin, '\n'); // Ctrl+J → raw JSON
    await waitFor(() => term.text().includes('Arguments (raw JSON):'));
    expect(term.text()).toContain('"q": "hello"');
    expect(term.text()).not.toContain('"verbose"'); // unset optionals stay out

    await pressKey(stdin, '\n'); // Ctrl+J → back to the form
    await waitFor(() => term.text().includes('PARAMETERS (2)'));
    expect(term.text()).toContain('hello');

    instance.unmount();
  });

  it('refuses to run on invalid JSON and says why', async () => {
    const { instance, term, stdin } = renderTools();
    await waitFor(() => term.text().includes('PARAMETERS (2)'));

    await pressKey(stdin, '\t');
    await typeKeys(stdin, 'x');
    await pressKey(stdin, '\n'); // Ctrl+J → raw JSON
    await waitFor(() => term.text().includes('Arguments (raw JSON):'));

    for (let i = 0; i < 30; i += 1) {
      await pressKey(stdin, '\x7f'); // backspace the projected JSON away
    }
    await typeKeys(stdin, '{not json');
    await pressKey(stdin, '\x12'); // Ctrl+R

    await waitFor(() => term.text().includes('✗ JSON:'));
    expect(callServiceToolMock).not.toHaveBeenCalled();

    instance.unmount();
  });

  it('archives the raw result and says whether the path reached the clipboard', async () => {
    const { instance, term, stdin } = renderTools();
    await waitFor(() => term.text().includes('PARAMETERS (2)'));

    await pressKey(stdin, '\t');
    await typeKeys(stdin, 'x');
    await pressKey(stdin, '\x12'); // Ctrl+R
    await waitFor(() => term.text().includes('Result: ✓'));

    copyToClipboardMock.mockImplementation(() => true);
    await pressKey(stdin, '\x0f'); // Ctrl+O
    await waitFor(() => term.text().includes('Saved full output:'));
    expect(term.text()).toContain('path copied to the clipboard');

    // Without a clipboard utility the file is still saved — and that has to be
    // said, instead of a bare "saved" that hides the failed copy.
    copyToClipboardMock.mockImplementation(() => false);
    await pressKey(stdin, '\x0f');
    await waitFor(() => term.text().includes('clipboard unavailable'));

    instance.unmount();
  });

  it('keeps each tool’s typed arguments when switching away and back', async () => {
    const { instance, term, stdin } = renderTools();
    await waitFor(() => term.text().includes('alpha'));

    await pressKey(stdin, '\t'); // list → params
    await typeKeys(stdin, 'kept-value');
    await waitFor(() => term.text().includes('kept-value'));

    await pressKey(stdin, '\x1b'); // Esc → back to the list region
    await pressKey(stdin, '\x1b[B'); // ↓ → bravo
    await waitFor(() => term.text().includes('mock tool bravo'));
    await pressKey(stdin, '\x1b[A'); // ↑ → alpha
    await waitFor(() => term.text().includes('mock tool alpha'));

    await pressKey(stdin, '\t'); // params again
    await pressKey(stdin, '\n'); // Ctrl+J: the JSON projection shows what was kept
    await waitFor(() => term.text().includes('Arguments (raw JSON):'));
    expect(term.text()).toContain('"q": "kept-value"');

    instance.unmount();
  });
});
