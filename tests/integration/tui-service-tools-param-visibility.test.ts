/**
 * 短终端下焦点参数的编辑器必须留在可视窗口内。
 *
 * 参数区展开的块 = 名称行 + 完整换行描述 + 编辑器行。滚动逻辑原本只保证
 * 「块的起始行可见」，而且最后一条参数的块尾被算成 `anchor + 1`，于是当
 * 名称行恰好落在窗口内、编辑器行落在窗口外时，面板一动不动：
 *
 *  ①编辑器行不在 `.slice(scroll, scroll + FLOW_VISIBLE)` 里 —— `SingleLineInput`
 *    根本没挂载，此时敲进去的字符没有任何组件接收，值不会变（不是"看不见"，
 *    是"录不进去"）；
 *  ②即便挂载了，用户也看不到自己敲了什么。
 *
 * 这里用真实组件 + 真实 ANSI 网格复现：焦点落在最后一条参数（描述很长，
 * 与 playwright 的 `browser_find.regex` 同形）时，编辑器行必须可见。
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { Box, useStdout, render } from 'ink';
import { ServiceTools } from '../../src/tui/components/ServiceTools.js';
import type { Tool } from '../../src/types/tool.js';
import type { ServiceDefinition } from '../../src/types/service.js';
import { Terminal, createStdin, waitFor, typeKeys, pressKey } from './helpers/ansi-terminal.js';

/** 最后一条参数的描述要够长，才能把编辑器行顶出窗口（复刻截图里的 regex）。 */
const LONG_PARAM_DESC =
  'Regular expression to search for in the page snapshot. Matching is case-sensitive by ' +
  'default; wrap the pattern in slashes to add flags, e.g. "/error/i" for case-insensitive. ' +
  'Provide either text or regex, not both.';

const makeTool = (desc: string): Tool => ({
  name: 'find',
  namespacedName: 'demo__find',
  serviceName: 'demo',
  description: 'Search the accessibility snapshot of the current page.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      text: { type: 'string', description: 'Plain text to search for in the page snapshot.' },
      regex: { type: 'string', description: desc },
    },
    required: [],
  },
  enabled: true,
});

const { fetchServiceToolsMock, callServiceToolMock, toolRef } = vi.hoisted(() => ({
  fetchServiceToolsMock: vi.fn(),
  callServiceToolMock: vi.fn(),
  toolRef: { current: null as unknown },
}));

vi.mock('../../src/tui/discovery-worker.js', () => ({
  __esModule: true,
  fetchServiceTools: fetchServiceToolsMock,
  callServiceTool: callServiceToolMock,
  ToolCallError: class ToolCallError extends Error {},
  DiscoveryError: class DiscoveryError extends Error {},
  DiscoveryErrorType: { TIMEOUT: 'timeout', CONNECTION_FAILED: 'connection_failed' },
  default: fetchServiceToolsMock,
}));

const MiniApp: React.FC<{ rows: number }> = ({ rows }) => {
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows || rows;
  const service: ServiceDefinition = {
    name: 'demo',
    transport: 'stdio',
    command: 'node',
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

/** 编辑器行：`     ▸ <值>`（与未聚焦参数的 `     = (unset)` 区分开）。 */
const EDITOR_ROW = /^\s*▸ /;
const editorLine = (text: string, value: string): number =>
  text.split('\n').findIndex((l) => EDITOR_ROW.test(l) && l.includes(value));

/**
 * Tab 到参数区（列表 → 描述 → 参数）。每次按键后都要等焦点真的落定 ——
 * ink 的渲染是节流的，连按三次会绕回列表，随后 ↓ 就变成了切换工具。
 */
const tabToParams = async (stdin: unknown, term: Terminal): Promise<void> => {
  for (let i = 0; i < 3; i += 1) {
    if (term.text().includes('Quick Actions — Parameters')) return;
    await pressKey(stdin, '\t');
    await waitFor(() => term.text().includes('Quick Actions — Parameters'), 1500);
  }
  expect(term.text()).toContain('Quick Actions — Parameters');
};

describe('焦点参数的编辑器可见性（短终端）', () => {
  it('最后一条参数：名称行在窗口内、编辑器行在窗口外时，输入仍要生效且可见', async () => {
    fetchServiceToolsMock.mockImplementation(() => Promise.resolve([makeTool(LONG_PARAM_DESC)]));
    // 24 行：面板 14 行流式内容，名称行可见而编辑器行被顶出窗口。
    const { instance, term, stdin } = renderApp(24, 100);
    await waitFor(() => term.text().includes('PARAMETERS'));

    await tabToParams(stdin, term);
    await pressKey(stdin, '\x1b[B'); // ↓ → regex（最后一条）
    await waitFor(() => /▶ 2\s+regex/.test(term.text()));

    const before = term.text();
    expect(before).toContain('▶ 2  regex');
    expect(editorLine(before, 'value')).toBeGreaterThan(-1);

    await typeKeys(stdin, 'err.*i');
    const typed = await waitFor(() => editorLine(term.text(), 'err.*i') > -1, 3000);
    expect(typed, `输入后编辑器行不可见（值没有落到任何挂载的输入组件上）\n${term.text()}`).toBe(
      true
    );

    instance.unmount();
  });

  it('描述比整个视口还长时，编辑器行仍必须在屏内（名称行可让位）', async () => {
    // 20 行 → 流式窗口 10 行，而这条参数的块（名称 + 换行描述 + 编辑器）远超 10 行。
    const huge = Array.from({ length: 40 }, (_, i) => `desc-filler-${i}`).join(' ');
    fetchServiceToolsMock.mockImplementation(() => Promise.resolve([makeTool(huge)]));

    const { instance, term, stdin } = renderApp(20, 100);
    await waitFor(() => term.text().includes('PARAMETERS'));

    await tabToParams(stdin, term);
    await pressKey(stdin, '\x1b[B'); // ↓ → regex
    await waitFor(() => /▶ 2\s+regex/.test(term.text()));

    await typeKeys(stdin, 'abc');
    const typed = await waitFor(() => editorLine(term.text(), 'abc') > -1, 3000);
    expect(typed, `编辑器行被顶出屏外\n${term.text()}`).toBe(true);

    instance.unmount();
  });

  it('非最后一条参数同样保证编辑器行可见', async () => {
    // 三条参数、每条描述都很长：焦点停在中间那条时，块尾同样会被顶出窗口。
    const huge = Array.from({ length: 30 }, (_, i) => `filler-${i}`).join(' ');
    const tool: Tool = {
      name: 'three',
      namespacedName: 'demo__three',
      serviceName: 'demo',
      description: 'three params',
      inputSchema: {
        type: 'object' as const,
        properties: {
          first: { type: 'string', description: huge },
          second: { type: 'string', description: huge },
          third: { type: 'string', description: huge },
        },
        required: [],
      },
      enabled: true,
    };
    toolRef.current = tool;
    fetchServiceToolsMock.mockImplementation(() => Promise.resolve([tool]));

    const { instance, term, stdin } = renderApp(20, 100);
    await waitFor(() => term.text().includes('PARAMETERS'));
    await tabToParams(stdin, term);

    await pressKey(stdin, '\x1b[B'); // ↓ → second
    await waitFor(() => /▶ 2\s+second/.test(term.text()));
    await typeKeys(stdin, 'second-value');
    expect(
      await waitFor(() => editorLine(term.text(), 'second-value') > -1, 3000),
      `第二条参数的编辑器行不可见\n${term.text()}`
    ).toBe(true);

    instance.unmount();
  });

  it('编辑器行已在屏内时，输入不会把视图拽走（滚动位置保持稳定）', async () => {
    fetchServiceToolsMock.mockImplementation(() => Promise.resolve([makeTool(LONG_PARAM_DESC)]));
    const { instance, term, stdin } = renderApp(24, 100);
    await waitFor(() => term.text().includes('PARAMETERS'));

    await tabToParams(stdin, term);
    await pressKey(stdin, '\x1b[B'); // ↓ → regex
    await waitFor(() => /▶ 2\s+regex/.test(term.text()));

    // 落定后的面板首行：块起始行（名称行）就在窗口顶部。编辑器行的值本身
    // 当然会变，所以只比对窗口的"形状"（哪一行在窗口顶部、哪些行可见）。
    const panelShape = (): string =>
      term
        .text()
        .split('\n')
        .filter((l) => l.includes('▌') || /^\s*(▶|\s)\s?\d+\s\s/.test(l) || EDITOR_ROW.test(l))
        .map((l) => (EDITOR_ROW.test(l) ? '▸' : l))
        .join('\n');
    const before = panelShape();
    expect(before).toContain('▶ 2  regex');

    // 打字会让 flowRows 重建（formValues 变了），此时编辑器已可见 —— 面板
    // 不该因此跳走，否则每敲一个字符画面都在动。
    await typeKeys(stdin, 'err');
    await waitFor(() => editorLine(term.text(), 'err') > -1);
    expect(panelShape()).toBe(before);

    instance.unmount();
  });
});
