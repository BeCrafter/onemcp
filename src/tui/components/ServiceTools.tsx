/**
 * TUI Service Tools Component
 *
 * Displays tools for a selected service with a flattened detail panel
 * (description → editable parameters → run result in one scroll flow) and
 * allows enabling/disabling or running them inline (Ctrl+R).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  callServiceTool,
  DiscoveryError,
  DiscoveryErrorType,
  fetchServiceTools,
  ToolCallError,
  type ToolCallOutcome,
} from '../discovery-worker.js';
import {
  boxBottom,
  boxRow,
  boxTop,
  displayWidth,
  SECTION_BAR,
  sectionTitle,
  truncateDisplay,
} from '../text-layout.js';
import { copyToClipboard } from '../clipboard.js';
import { safeStringify } from '../../utils/safe-json.js';
import {
  bestEffortArgs,
  buildParamRows,
  buildToolArguments,
  buildToolParams,
  formatParamValue,
  isRecord,
  seedFormValues,
  wrapText,
  type SegmentTone,
  type StyledSegment,
} from '../tool-param-schema.js';
import type { ServiceDefinition } from '../../types/service.js';
import type { Tool } from '../../types/tool.js';
import type { ToolParam } from '../tool-param-schema.js';
import { SingleLineInput } from './SingleLineInput.js';
import { isPrintableChunk } from '../input-text.js';
import { JsonTextArea } from './JsonTextArea.js';

export interface ServiceToolsProps {
  service: ServiceDefinition;
  onBack: () => void;
  onToggleTool: (toolName: string, enabled: boolean) => void;
  onBatchToggleTools?: (toolStates: Record<string, boolean>) => void;
  toolStates?: Record<string, boolean>;
  onToolsDiscovered?: (toolCount: number) => void;
  /**
   * Actual vertical space available to this component, as computed by the host
   * (e.g. app.tsx minus its own header/footer). Falls back to terminal height.
   */
  terminalHeight?: number;
}

/** Where keyboard focus lives inside the tools view. */
type PanelFocus = 'list' | 'params' | 'result' | 'json';
type RunStatus = 'editing' | 'running' | 'done';
type ResultView = 'formatted' | 'raw';

/** One row of the flattened detail panel; every row renders as one line. */
type DetailRow =
  | {
      type: 'text';
      text: string;
      segments?: StyledSegment[];
      anchor?: string;
      /** Index into the result's rendered lines (for range selection). */
      resultIndex?: number;
    }
  | { type: 'input'; param: ToolParam }
  | { type: 'select'; param: ToolParam };

const FETCH_TIMEOUT_MS = 15000;
const CALL_TIMEOUT_MS = 60000;
const RESULT_MAX_CHARS = 200_000;
/** Indent + marker for the expanded parameter's value / editor row. */
const DETAIL_VALUE_INDENT = '     ▸ ';
/** Indent for the description body, setting it apart from the section title. */
const DESCRIPTION_INDENT = '  ';

/**
 * Panel scroll indicator. Rendered on one row always (so the panel height is
 * stable) but stays blank when there is nothing to scroll, and is indented to
 * align with content — a lone dim glyph at the panel's left edge reads as a
 * rendering artifact rather than a control.
 */
const scrollHint = (offset: number, max: number): string => {
  const arrows: string[] = [];
  if (offset > 0) {
    arrows.push('↑');
  }
  if (offset < max) {
    arrows.push('↓');
  }
  return arrows.length > 0 ? `   ${arrows.join('|')} more` : ' ';
};

/** Map a segment tone to ink Text props (colors are a pure enhancement; the
 *  test harness strips SGR, so nothing observable depends on them).
 *
 *  `muted` deliberately de-emphasizes with a grey FOREGROUND rather than
 *  `dimColor`: some terminals render SGR 2 (faint) by dimming the whole cell —
 *  background included — which turns every dim span into a visibly darker
 *  rectangle. */
type ToneStyle = { bold?: boolean; dimColor?: boolean; color?: 'red' | 'cyan' | 'green' | 'gray' };
const toneStyle = (tone: SegmentTone): ToneStyle => {
  switch (tone) {
    case 'muted':
      return { color: 'gray' };
    case 'critical':
      return { color: 'red', bold: true };
    case 'accent':
      return { color: 'cyan', bold: true };
    case 'primary':
      return { bold: true };
    case 'value':
      return {};
  }
};

const isCtrlJ = (input: string, key: { ctrl: boolean }): boolean =>
  // Terminals send Ctrl+J as a bare LF: ink parses it to name 'enter' with
  // ctrl=false, so the raw \n must be matched alongside ctrl+'j'.
  input === '\n' || (key.ctrl && input === 'j');

const sanitizeFileName = (name: string): string => name.replace(/[^A-Za-z0-9._-]/g, '_');

/**
 * Seed for the raw-JSON arguments editor. With nothing to project the buffer
 * starts EMPTY rather than as a `{}` stub — a stub is never replaced when the
 * cursor is at offset 0, so typing produced `{}{"text":"hi"}` and an obscure
 * parse error.
 */
function seedJsonText(args: Record<string, unknown>): string {
  return Object.keys(args).length > 0 ? JSON.stringify(args, null, 2) : '';
}

/** Classify a call failure into the run-view error copy. */
function describeCallError(err: unknown): string {
  if (err instanceof ToolCallError) {
    const code = typeof err.code === 'number' ? ` (${err.code})` : '';
    const data = err.data !== undefined ? `\n${safeStringify(err.data)}` : '';
    return `Backend error${code}: ${err.message}${data}`;
  }
  if (err instanceof DiscoveryError) {
    if (err.type === DiscoveryErrorType.TIMEOUT) {
      return 'Timed out — the tool may still be running on the backend.';
    }
    return `Could not call tool: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/** Cycle a boolean/enum field's value with Space (parent-handled). */
function cycleSelectValue(param: ToolParam, current: string): string {
  const options =
    param.kind === 'boolean'
      ? [...(param.required ? [] : ['']), 'true', 'false']
      : [...(param.required ? [] : ['']), ...(param.enumValues ?? []).map((v) => String(v))];
  const idx = options.indexOf(current);
  return options[(idx + 1) % options.length] ?? '';
}

/**
 * Section header row. The bar glyph is the same whether or not the section has
 * focus — only its color differs: the focused bar reads as plain text, the idle
 * one is grey. Grey rather than `dimColor` on purpose: terminals that render
 * faint cells by dimming them would paint a darker block behind the bar.
 */
const sectionRow = (label: string, width: number, focused: boolean): DetailRow => {
  const text = sectionTitle(label, width);
  if (!text.startsWith(SECTION_BAR)) {
    return { type: 'text', text };
  }
  return {
    type: 'text',
    text,
    segments: [
      { text: SECTION_BAR, tone: focused ? 'value' : 'muted' },
      { text: text.slice(SECTION_BAR.length), tone: 'value' },
    ],
  };
};

export const ServiceTools: React.FC<ServiceToolsProps> = ({
  service,
  onBack,
  onToggleTool,
  onBatchToggleTools,
  toolStates = {},
  onToolsDiscovered,
  terminalHeight: terminalHeightProp,
}) => {
  const { stdout } = useStdout();
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [focus, setFocus] = useState<PanelFocus>('list');
  const [fieldIndex, setFieldIndex] = useState(0);
  const [panelScroll, setPanelScroll] = useState(0);
  const [formValues, setFormValuesState] = useState<Record<string, string>>({});
  const [jsonText, setJsonTextState] = useState<string>('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [extraCount, setExtraCount] = useState(0);
  const [runStatus, setRunStatus] = useState<RunStatus>('editing');
  const [outcome, setOutcome] = useState<ToolCallOutcome | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [runDurationMs, setRunDurationMs] = useState<number | null>(null);
  const [resultView, setResultView] = useState<ResultView>('formatted');
  const [dumpPath, setDumpPath] = useState<string | null>(null);
  /** Hides the tool list so the result spans the full width and mouse-drag
   *  selection cannot pick up the neighbouring column. */
  const [fullWidth, setFullWidth] = useState(false);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  /** Result-line range selection (anchor + moving end), like a visual mode. */
  const [selectAnchor, setSelectAnchor] = useState<number | null>(null);
  const [selectCursor, setSelectCursor] = useState<number | null>(null);
  /** The result line ↑/↓ moves — shown with a `▸` marker while the region is
   *  focused, so the position stays visible without an active selection. */
  const [resultCursor, setResultCursor] = useState<number | null>(null);
  /** Show the whole tool description instead of the capped preview. Temporary
   *  by design: selecting another tool restores the capped default. */
  const [descExpanded, setDescExpanded] = useState(false);
  const [toolScrollOffset, setToolScrollOffset] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState(false);

  // Refs mirror the state so Ctrl+R reads the latest keystrokes even though
  // the focused input's useInput fires first within the same keypress.
  const formValuesRef = useRef(formValues);
  const jsonTextRef = useRef(jsonText);
  const extraArgsRef = useRef<Record<string, unknown>>({});
  /** Typed arguments per tool name, so reselecting a tool restores them. */
  const formCacheRef = useRef<
    Map<
      string,
      { values: Record<string, string>; jsonText: string; extra: Record<string, unknown> }
    >
  >(new Map());
  const prevToolNameRef = useRef<string | undefined>(undefined);

  const setFormValues = (next: Record<string, string>): void => {
    formValuesRef.current = next;
    setFormValuesState(next);
  };
  const setJsonText = (next: string): void => {
    jsonTextRef.current = next;
    setJsonTextState(next);
  };

  const filteredTools = useMemo(() => {
    if (!searchQuery) return tools;
    const q = searchQuery.toLowerCase();
    return tools.filter((t) => t.name.toLowerCase().includes(q));
  }, [tools, searchQuery]);

  const terminalHeight = terminalHeightProp ?? (stdout?.rows || 24);
  const terminalWidth = stdout?.columns || 80;
  const HEADER_LINES = 4;
  // Contextual hint footer; the "Quick Actions:" title is dropped on tiny terminals.
  const FOOTER_LINES = terminalHeight < 10 ? 2 : 3;
  const ERROR_LINES = error !== null ? 1 : 0;
  const BODY_LINES = Math.max(1, terminalHeight - HEADER_LINES - FOOTER_LINES - ERROR_LINES);
  // Body = search bar + divider + the two side-by-side panels.
  const PANEL_LINES = Math.max(1, BODY_LINES - 2);
  const VISIBLE_TOOLS = Math.min(filteredTools.length, Math.max(1, PANEL_LINES - 1));

  const BORDER_PADDING = 4;
  const effectiveWidth = Math.max(terminalWidth - BORDER_PADDING, 50);
  const TOOL_WIDTH_RATIO = Math.min(0.5, Math.max(0.3, 40 / effectiveWidth));
  const TOOLS_LIST_WIDTH = Math.floor(effectiveWidth * TOOL_WIDTH_RATIO);
  // Full-width mode drops the tool list so the panel owns the entire row —
  // mouse-drag selection then has no neighbouring column to pick up.
  const PANEL_BOX_WIDTH = fullWidth
    ? Math.max(20, terminalWidth - 2)
    : effectiveWidth - TOOLS_LIST_WIDTH;
  const PANEL_WIDTH = Math.max(10, PANEL_BOX_WIDTH - 2);
  const RESULT_INNER = Math.max(8, PANEL_WIDTH - 2);

  // "▶ ✓ " occupies 5 cells (▶ is double-width); keep names inside the panel.
  const TOOL_NAME_PREFIX_CELLS = 5;
  const maxToolNameWidth = Math.max(8, TOOLS_LIST_WIDTH - TOOL_NAME_PREFIX_CELLS - 1);
  const truncateToolName = (name: string): string => truncateDisplay(name, maxToolNameWidth);

  const currentTool = filteredTools[selectedIndex];
  const params = useMemo(
    () => buildToolParams(currentTool?.inputSchema),
    [currentTool?.inputSchema]
  );

  // Calculate tool statistics
  const enabledToolsCount = tools.filter((t) => t.enabled).length;
  const totalToolsCount = tools.length;

  useEffect(() => {
    setToolScrollOffset((prev) => {
      if (selectedIndex < prev) return selectedIndex;
      if (selectedIndex >= prev + VISIBLE_TOOLS) {
        return Math.max(0, selectedIndex - VISIBLE_TOOLS + 1);
      }
      return prev;
    });
  }, [selectedIndex, VISIBLE_TOOLS]);

  // Reset per-tool editor/run state when the selected tool changes, but carry
  // the typed arguments over per tool so switching back restores them.
  //
  // Deliberately keyed on the tool NAME only: a tools/list refresh produces new
  // object identities, so depending on `params` (or the schema) would re-run
  // this reset on every refetch and wipe the arguments being typed. The
  // trade-off is that a same-named tool whose schema changed mid-session keeps
  // stale form values until the tool is re-selected.
  useEffect(() => {
    const previous = prevToolNameRef.current;
    if (previous !== undefined && previous !== currentTool?.name) {
      formCacheRef.current.set(previous, {
        values: formValuesRef.current,
        jsonText: jsonTextRef.current,
        extra: extraArgsRef.current,
      });
    }
    prevToolNameRef.current = currentTool?.name;
    const restored =
      currentTool === undefined ? undefined : formCacheRef.current.get(currentTool.name);

    setFocus('list');
    setFieldIndex(0);
    setPanelScroll(0);
    setDescExpanded(false);
    const seededValues = restored?.values ?? seedFormValues(params);
    setFormValues(seededValues);
    setJsonText(restored?.jsonText ?? seedJsonText(bestEffortArgs(params, seededValues)));
    setJsonError(null);
    setFieldErrors({});
    setExtraCount(restored === undefined ? 0 : Object.keys(restored.extra).length);
    setRunStatus('editing');
    setOutcome(null);
    setErrorMessage(null);
    setRunDurationMs(null);
    setResultView('formatted');
    setDumpPath(null);
    setCopyNotice(null);
    setSelectAnchor(null);
    setSelectCursor(null);
    setResultCursor(null);
    extraArgsRef.current = restored?.extra ?? {};
  }, [currentTool?.name]);

  useEffect(() => {
    const loadTools = async () => {
      setLoading(true);
      setError(null);

      try {
        const fetchedTools = await fetchServiceTools(service, FETCH_TIMEOUT_MS);

        if (fetchedTools.length > 0) {
          setTools(
            fetchedTools.map((tool) => ({
              ...tool,
              enabled: toolStates[tool.name] ?? true,
            }))
          );

          // Notify parent component of discovered tool count
          onToolsDiscovered?.(fetchedTools.length);
        } else if (Object.keys(toolStates).length > 0) {
          setTools(
            Object.entries(toolStates).map(([name, enabled]) => ({
              name,
              namespacedName: `${service.name}__${name}`,
              serviceName: service.name,
              description: '',
              inputSchema: { type: 'object' as const, properties: {} },
              enabled,
            }))
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch tools');
      } finally {
        setLoading(false);
      }
    };

    void loadTools();
  }, [service.name, service.url]);

  const goToField = (index: number): void => {
    const next = Math.max(0, Math.min(params.length - 1, index));
    setFieldIndex(next);
  };

  /** Page the panel by one viewport, clamped to the scrollable range. */
  const pagePanel = (direction: 1 | -1): void => {
    setPanelScroll((prev) => {
      const clamped = Math.min(prev, maxPanelScroll);
      return Math.max(0, Math.min(maxPanelScroll, clamped + direction * FLOW_VISIBLE));
    });
  };

  /**
   * Tab order across the panel regions. Unavailable regions are skipped, so
   * Tab only ever lands somewhere meaningful (no result → no result region).
   */
  const cycleRegion = (direction: 1 | -1): void => {
    const available: PanelFocus[] = ['list'];
    if (params.length > 0) {
      available.push('params');
    }
    if (runStatus !== 'editing') {
      available.push('result');
    }
    const current = Math.max(0, available.indexOf(focus));
    const next = available[(current + direction + available.length) % available.length];
    if (next === undefined) {
      return;
    }
    if (next === 'params') {
      setFieldIndex((prev) => Math.max(0, Math.min(params.length - 1, prev)));
    }
    setFocus(next);
  };

  const runTool = (): void => {
    if (runStatus === 'running' || currentTool === undefined) {
      return;
    }
    let args: Record<string, unknown>;

    if (focus !== 'json') {
      const result = buildToolArguments(params, formValuesRef.current);
      if (!result.ok) {
        setFieldErrors(result.errors);
        setFocus('params');
        const firstIdx = params.findIndex((p) => result.errors[p.name] !== undefined);
        if (firstIdx >= 0) {
          setFieldIndex(firstIdx);
        }
        return;
      }
      setFieldErrors({});
      args = { ...result.args, ...extraArgsRef.current };
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonTextRef.current);
      } catch (err) {
        setJsonError(err instanceof Error ? err.message : 'Invalid JSON');
        return;
      }
      if (!isRecord(parsed)) {
        setJsonError('Arguments must be a JSON object');
        return;
      }
      setJsonError(null);
      args = parsed;
    }

    setRunStatus('running');
    setOutcome(null);
    setErrorMessage(null);
    setDumpPath(null);
    setCopyNotice(null);
    setSelectAnchor(null);
    setSelectCursor(null);
    setResultCursor(null);
    const startedAt = Date.now();

    void callServiceTool(service, currentTool.name, args, CALL_TIMEOUT_MS)
      .then((res) => {
        setRunDurationMs(Date.now() - startedAt);
        setOutcome(res);
        setRunStatus('done');
        // Reveal the output: focusing the result region also scrolls to it.
        setFocus('result');
      })
      .catch((err: unknown) => {
        setRunDurationMs(Date.now() - startedAt);
        setErrorMessage(describeCallError(err));
        setRunStatus('done');
        setFocus('result');
      });
  };

  /** Ctrl+J: project form → JSON, or parse JSON back into the form fields. */
  const toggleJsonMode = (): void => {
    if (runStatus === 'running' || searchMode || params.length === 0) {
      return;
    }
    if (focus !== 'json') {
      setJsonText(
        seedJsonText({ ...bestEffortArgs(params, formValuesRef.current), ...extraArgsRef.current })
      );
      setJsonError(null);
      setFocus('json');
      return;
    }
    let parsed: unknown;
    try {
      const raw = jsonTextRef.current.trim();
      parsed = raw === '' ? {} : JSON.parse(raw);
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : 'Invalid JSON — fix before switching');
      return;
    }
    if (!isRecord(parsed)) {
      setJsonError('Arguments must be a JSON object — fix before switching');
      return;
    }
    const values = { ...formValuesRef.current };
    for (const key of Object.keys(values)) {
      if (!(key in parsed)) {
        values[key] = '';
      }
    }
    const extra: Record<string, unknown> = {};
    let extraKeys = 0;
    for (const [key, value] of Object.entries(parsed)) {
      const param = params.find((p) => p.name === key);
      if (param) {
        values[key] = typeof value === 'string' ? value : JSON.stringify(value);
      } else {
        extra[key] = value;
        extraKeys++;
      }
    }
    extraArgsRef.current = extra;
    setExtraCount(extraKeys);
    setJsonError(null);
    setFormValues(values);
    setFocus('params');
  };

  /** Toggle the tool list off so the result owns the full terminal width. */
  const toggleFullWidth = (): void => {
    setFullWidth((prev) => !prev);
    setFocus((prev) =>
      prev === 'list' || prev === 'result' ? (fullWidth ? 'list' : 'result') : prev
    );
  };

  /** Index of the first result line at or below the viewport top. */
  const firstVisibleResultIndex = (): number => {
    for (let i = clampedPanelScroll; i < flowRows.length; i++) {
      const row = flowRows[i];
      if (row?.type === 'text' && row.resultIndex !== undefined) {
        return row.resultIndex;
      }
    }
    return 0;
  };

  /** The highlighted result-line range, or null when nothing is selected. */
  const selectedRange = (): { from: number; to: number } | null => {
    if (selectAnchor === null || selectCursor === null) {
      return null;
    }
    return {
      from: Math.min(selectAnchor, selectCursor),
      to: Math.max(selectAnchor, selectCursor),
    };
  };

  /** Start or cancel a result-line range selection. */
  const toggleSelection = (): void => {
    if (runStatus !== 'done' || resultLines.length === 0) {
      return;
    }
    if (selectAnchor !== null) {
      setSelectAnchor(null);
      setSelectCursor(null);
      return;
    }
    // Anchor where the cursor sits (it defaults to the first visible line).
    const start = resultCursor ?? firstVisibleResultIndex();
    setSelectAnchor(start);
    setSelectCursor(start);
    setCopyNotice(null);
  };

  /**
   * Copy the highlighted lines — or the whole result when nothing is selected.
   * "Copy all" uses the UNWRAPPED text so pasted data has no display line
   * breaks; a range copies exactly the lines that were highlighted.
   */
  const copyResult = (): void => {
    if (runStatus !== 'done' || resultLines.length === 0) {
      return;
    }
    const range = selectedRange();
    const text =
      range === null ? resultText : resultLines.slice(range.from, range.to + 1).join('\n');
    if (text === '') {
      setCopyNotice('Nothing to copy');
      return;
    }
    const lineCount = range === null ? resultText.split('\n').length : range.to - range.from + 1;
    setCopyNotice(
      copyToClipboard(text)
        ? `✓ Copied ${lineCount} line(s) to the clipboard`
        : '✗ No clipboard utility found (pbcopy/xclip)'
    );
  };

  /** Write the full raw result to a temp file (unaffected by display width). */
  const dumpOutcome = (): void => {
    if (runStatus !== 'done' || outcome === null) {
      return;
    }
    try {
      const dir = mkdtempSync(join(tmpdir(), 'onemcp-call-'));
      const file = join(dir, `${sanitizeFileName(currentTool?.name ?? 'tool')}.json`);
      writeFileSync(file, outcome.raw, 'utf8');
      setDumpPath(file);
      // The panel line is width-truncated, so hand the full path to the
      // clipboard as well — otherwise the saved file can't be located.
      setCopyNotice(
        copyToClipboard(file)
          ? '✓ Full path copied to the clipboard'
          : '✓ Output saved — clipboard unavailable, use the path above'
      );
    } catch {
      setDumpPath(null);
    }
  };

  useInput((input, key) => {
    // --- Control chords: active in every focus, including search mode ---
    if (input === 'r' && key.ctrl) {
      runTool();
      return;
    }
    if (isCtrlJ(input, key)) {
      toggleJsonMode();
      return;
    }
    if (input === 'e' && key.ctrl) {
      setDescExpanded((prev) => !prev);
      return;
    }
    if (input === 'p' && key.ctrl && runStatus === 'done' && outcome !== null) {
      setResultView((prev) => (prev === 'formatted' ? 'raw' : 'formatted'));
      return;
    }
    if (input === 'o' && key.ctrl && runStatus === 'done' && outcome !== null) {
      dumpOutcome();
      return;
    }
    if (input === 'y' && key.ctrl) {
      copyResult();
      return;
    }
    // Panel paging — PageUp/PageDown, with Ctrl+U/Ctrl+D as a fallback for
    // terminals that do not send the page-key sequences. Deliberately ungated:
    // paging must work before a tool has ever been run.
    if (key.pageUp || (key.ctrl && input === 'u')) {
      setPanelScroll((prev) => Math.max(0, Math.min(prev, maxPanelScroll) - FLOW_VISIBLE));
      return;
    }
    if (key.pageDown || (key.ctrl && input === 'd')) {
      setPanelScroll((prev) =>
        Math.min(maxPanelScroll, Math.min(prev, maxPanelScroll) + FLOW_VISIBLE)
      );
      return;
    }

    // --- Search input mode: keystrokes edit the query (↑↓ still navigate) ---
    if (searchMode) {
      if (key.escape) {
        // First Esc: leave search mode but keep the filter; a second Esc
        // (handled below) clears the query, a third returns to the services.
        setSearchMode(false);
        return;
      }
      if (key.return) {
        setSearchMode(false);
        return;
      }
      if (key.upArrow) {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedIndex((prev) => Math.max(0, Math.min(filteredTools.length - 1, prev + 1)));
        return;
      }
      if (key.backspace || key.delete) {
        setSearchQuery((prev) => prev.slice(0, -1));
        return;
      }
      // Printable text (a keystroke or a whole pasted chunk) → append to query.
      // A lone '/' still only opens the search box.
      if (isPrintableChunk(input) && !(input.length === 1 && input === '/')) {
        setSearchQuery((prev) => prev + input);
        return;
      }
      return;
    }

    // --- Layered Esc: cancel selection → leave region → clear filter → back ---
    if (key.escape) {
      if (runStatus === 'running') {
        return;
      }
      if (selectAnchor !== null) {
        setSelectAnchor(null);
        setSelectCursor(null);
      } else if (focus !== 'list') {
        setFocus('list');
      } else if (searchQuery) {
        setSearchQuery('');
      } else {
        onBack();
      }
      return;
    }

    // Full width: hide the tool list so the result spans the whole row.
    if (input === 'f' && !key.ctrl && (focus === 'list' || focus === 'result')) {
      toggleFullWidth();
      return;
    }

    // --- JSON focus: editing keys belong to JsonTextArea ---
    if (focus === 'json') {
      return;
    }

    // --- Parameter focus: ↑/↓ change the expanded parameter; the mounted
    //     input owns letters, ←/→ (cursor) and Enter. ---
    if (focus === 'params') {
      if (key.tab) {
        cycleRegion(key.shift ? -1 : 1);
        return;
      }
      if (key.upArrow) {
        goToField(fieldIndex - 1);
        return;
      }
      if (key.downArrow || key.return) {
        goToField(fieldIndex + 1);
        return;
      }
      const currentParam = params[fieldIndex];
      if (
        input === ' ' &&
        currentParam !== undefined &&
        (currentParam.kind === 'boolean' || currentParam.enumValues !== undefined)
      ) {
        const next = cycleSelectValue(currentParam, formValuesRef.current[currentParam.name] ?? '');
        setFormValues({ ...formValuesRef.current, [currentParam.name]: next });
      }
      return;
    }

    // --- Result focus: ↑/↓ move the line cursor (extending the selection while
    //     one is active), ←/→ page, v selects a range from the cursor ---
    if (focus === 'result') {
      if (key.tab) {
        cycleRegion(key.shift ? -1 : 1);
        return;
      }
      const selecting = selectAnchor !== null;
      if (input === 'v' && !key.ctrl) {
        toggleSelection();
        return;
      }
      const hasLines = resultLines.length > 0;
      // While a range is active the moving end is the selection cursor;
      // otherwise it is the plain line cursor.
      const cursor = (selecting ? selectCursor : resultCursor) ?? firstVisibleResultIndex();
      const move = (delta: number): void => {
        if (!hasLines) {
          return;
        }
        const next = Math.max(0, Math.min(resultLines.length - 1, cursor + delta));
        if (selecting) {
          setSelectCursor(next);
        } else {
          setResultCursor(next);
        }
      };
      if (key.upArrow) {
        move(-1);
      } else if (key.downArrow) {
        move(1);
      } else if (key.leftArrow) {
        // Paging drags the cursor along, otherwise the reveal effect would
        // yank the view straight back to the cursor.
        move(-FLOW_VISIBLE);
        pagePanel(-1);
      } else if (key.rightArrow) {
        move(FLOW_VISIBLE);
        pagePanel(1);
      }
      return;
    }

    // --- List focus ---
    if (input === '/') {
      setSearchMode(true);
      return;
    }
    if (key.tab) {
      cycleRegion(key.shift ? -1 : 1);
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setSelectedIndex((prev) => Math.max(0, Math.min(filteredTools.length - 1, prev + 1)));
    } else if (key.leftArrow) {
      pagePanel(-1);
    } else if (key.rightArrow) {
      pagePanel(1);
    } else if ((input === ' ' || input === 't') && !key.ctrl) {
      const tool = filteredTools[selectedIndex];
      if (tool) {
        const newEnabled = !tool.enabled;
        onToggleTool(tool.name, newEnabled);
        setTools((prev) =>
          prev.map((t) => (t.name === tool.name ? { ...t, enabled: newEnabled } : t))
        );
      }
    } else if (input === 'a' && !key.ctrl) {
      const toolsToEnable = filteredTools.filter((t) => !t.enabled).map((t) => t.name);
      if (toolsToEnable.length > 0) {
        const filteredNames = new Set(filteredTools.map((t) => t.name));
        const applyEnable = (t: Tool): Tool =>
          filteredNames.has(t.name) ? { ...t, enabled: true } : t;
        if (onBatchToggleTools) {
          const batchToolStates: Record<string, boolean> = {};
          toolsToEnable.forEach((toolName) => {
            batchToolStates[toolName] = true;
          });
          onBatchToggleTools(batchToolStates);
          setTools((prev) => prev.map(applyEnable));
        } else {
          setTools((prev) => prev.map(applyEnable));
          toolsToEnable.forEach((toolName) => onToggleTool(toolName, true));
        }
      }
    } else if (input === 'A') {
      const toolsToDisable = filteredTools.filter((t) => t.enabled).map((t) => t.name);
      if (toolsToDisable.length > 0) {
        const filteredNames = new Set(filteredTools.map((t) => t.name));
        const applyDisable = (t: Tool): Tool =>
          filteredNames.has(t.name) ? { ...t, enabled: false } : t;
        if (onBatchToggleTools) {
          const batchToolStates: Record<string, boolean> = {};
          toolsToDisable.forEach((toolName) => {
            batchToolStates[toolName] = false;
          });
          onBatchToggleTools(batchToolStates);
          setTools((prev) => prev.map(applyDisable));
        } else {
          setTools((prev) => prev.map(applyDisable));
          toolsToDisable.forEach((toolName) => onToggleTool(toolName, false));
        }
      }
    }
  });

  // --- Flattened detail rows (description → parameters; result is pinned) ---

  const descCap = Math.min(12, Math.max(3, Math.floor(PANEL_LINES * 0.35)));
  const descRows: DetailRow[] = useMemo(() => {
    const rows: DetailRow[] = [];
    const wrapped = wrapText(
      currentTool?.description ?? '',
      PANEL_WIDTH - DESCRIPTION_INDENT.length
    );
    if (wrapped.length === 0 || (wrapped.length === 1 && wrapped[0] === '')) {
      rows.push({ type: 'text', text: `${DESCRIPTION_INDENT}(no description)` });
    } else if (!descExpanded && wrapped.length > descCap) {
      for (const line of wrapped.slice(0, descCap)) {
        rows.push({ type: 'text', text: `${DESCRIPTION_INDENT}${line}` });
      }
      rows.push({
        type: 'text',
        text: `${DESCRIPTION_INDENT}… ${wrapped.length - descCap} more line(s) — Ctrl+E expands`,
      });
    } else {
      for (const line of wrapped) {
        rows.push({ type: 'text', text: `${DESCRIPTION_INDENT}${line}` });
      }
    }
    return rows;
  }, [currentTool?.description, PANEL_WIDTH, descCap, descExpanded]);

  // Only the parameter region expands a field; browsing (list focus) keeps the
  // compact one-line-per-parameter overview.
  const expandedParamName = focus === 'params' ? (params[fieldIndex]?.name ?? null) : null;
  const paramRows: DetailRow[] = useMemo(
    () =>
      buildParamRows(params, formValues, PANEL_WIDTH, expandedParamName).map((row): DetailRow => {
        if (row.kind !== 'text') {
          return { type: row.kind, param: row.param };
        }
        return {
          type: 'text',
          text: row.text,
          ...(row.segments !== undefined ? { segments: row.segments } : {}),
          ...(row.anchor !== undefined ? { anchor: row.anchor } : {}),
        };
      }),
    [params, formValues, PANEL_WIDTH, expandedParamName]
  );

  /** One-line status headline for the result box. */
  const resultLabel = (() => {
    const duration = runDurationMs === null ? '' : ` ${runDurationMs}ms`;
    if (runStatus === 'running') {
      return `Result: running…`;
    }
    if (errorMessage !== null) {
      return `Result: ✗ failed${duration}`;
    }
    if (outcome?.isError) {
      return `Result: ✗ tool reported an error${duration}`;
    }
    return `Result: ✓${duration}`;
  })();

  /** Description + parameters + validation rows (the scrollable flow). */
  const allRowsBase: DetailRow[] = useMemo(
    () => [
      sectionRow('Description', PANEL_WIDTH, focus === 'list'),
      { type: 'text' as const, text: ' ' },
      ...descRows,
      { type: 'text' as const, text: ' ' },
      sectionRow(`Parameters (${params.length})`, PANEL_WIDTH, focus === 'params'),
      { type: 'text' as const, text: ' ' },
      ...paramRows,
      ...(Object.keys(fieldErrors).length > 0
        ? Object.entries(fieldErrors).map(
            ([name, message]): DetailRow => ({
              type: 'text' as const,
              text: `  ✗ ${name}: ${message}`,
            })
          )
        : []),
      ...(extraCount > 0
        ? [
            {
              type: 'text' as const,
              text: `  ${extraCount} extra key(s) from JSON merged on run`,
            } satisfies DetailRow,
          ]
        : []),
    ],
    [descRows, paramRows, params.length, fieldErrors, extraCount, PANEL_WIDTH, focus]
  );

  /** The result text exactly as produced (unwrapped) — what "copy all" copies. */
  const resultText: string = useMemo(() => {
    if (runStatus !== 'done' || outcome === null) {
      return '';
    }
    const base = resultView === 'raw' ? outcome.raw : outcome.formatted;
    return base.length > RESULT_MAX_CHARS ? base.slice(0, RESULT_MAX_CHARS) : base;
  }, [runStatus, outcome, resultView]);

  /** Result content wrapped for the panel — also the unit of range selection. */
  const resultLines: string[] = useMemo(() => {
    if (runStatus === 'editing') {
      return [];
    }
    let body = '';
    if (runStatus === 'running') {
      body = `Running ${currentTool?.namespacedName ?? ''}…`;
    } else if (errorMessage !== null) {
      body = errorMessage;
    } else {
      body = resultText;
    }
    // Every line is kept — rendering is already bounded by the viewport slice,
    // so capping here would only make output unreachable. The CHARACTER cap
    // above (RESULT_MAX_CHARS) does hide the tail, so say so instead of letting
    // the output look complete; Ctrl+O still writes the full result.
    const lines = wrapText(body, RESULT_INNER);
    const sourceLength =
      resultView === 'raw' ? (outcome?.raw.length ?? 0) : (outcome?.formatted.length ?? 0);
    if (sourceLength > RESULT_MAX_CHARS) {
      lines.push(
        `… truncated at ${RESULT_MAX_CHARS.toLocaleString()} characters — Ctrl+O saves the full result`
      );
    }
    if (dumpPath !== null) {
      const shown = dumpPath.replace(tmpdir(), '…');
      lines.push(`Saved full output: ${truncateDisplay(shown, RESULT_INNER - 19)}`);
    }
    return lines;
  }, [
    runStatus,
    errorMessage,
    resultText,
    resultView,
    outcome,
    dumpPath,
    RESULT_INNER,
    currentTool?.namespacedName,
  ]);

  /** The result section: section header, then a framed block of output rows. */
  const resultRows: DetailRow[] = useMemo(() => {
    if (resultLines.length === 0) {
      return [];
    }
    return [
      { type: 'text' as const, text: ' ' },
      sectionRow('Output', PANEL_WIDTH, focus === 'result'),
      { type: 'text' as const, text: ' ' },
      { type: 'text' as const, text: boxTop(resultLabel, RESULT_INNER) },
      ...resultLines.map(
        (line, index): DetailRow => ({
          type: 'text' as const,
          text: boxRow(line, RESULT_INNER),
          resultIndex: index,
        })
      ),
      { type: 'text' as const, text: boxBottom('', RESULT_INNER) },
    ];
  }, [resultLines, RESULT_INNER, PANEL_WIDTH, focus, resultLabel]);

  const flowRows: DetailRow[] = useMemo(
    () => [...allRowsBase, ...resultRows],
    [allRowsBase, resultRows]
  );
  /** Where the result section starts — used to reveal it. */
  const resultStartIndex = allRowsBase.length;

  const FLOW_VISIBLE = Math.max(1, PANEL_LINES - 1); // reserve the indicator row
  const maxPanelScroll = Math.max(0, flowRows.length - FLOW_VISIBLE);
  // Clamp at render time — PANEL_LINES shrinks while a status message is
  // visible, so an effect-based clamp would leave a blank panel for ~2s.
  const clampedPanelScroll = Math.min(panelScroll, maxPanelScroll);

  /**
   * Keep the expanded parameter visible while navigating it.
   *
   * Collapsing makes `flowRows.length` focus-dependent, so the previous
   * absolute-index math would scroll BACKWARDS when the block height changed.
   * Instead: recompute against this render's rows and only move when the
   * parameter's whole block is not currently on screen.
   */
  useEffect(() => {
    if (focus !== 'params' || runStatus !== 'editing') {
      return;
    }
    const name = params[fieldIndex]?.name;
    if (name === undefined) {
      return;
    }
    const anchor = flowRows.findIndex((r) => r.type === 'text' && r.anchor === name);
    if (anchor < 0) {
      return;
    }
    const nextName = params[fieldIndex + 1]?.name;
    const nextAnchor =
      nextName === undefined
        ? -1
        : flowRows.findIndex((r) => r.type === 'text' && r.anchor === nextName);
    const blockEnd = nextAnchor > anchor ? nextAnchor : anchor + 1;
    setPanelScroll((prev) => {
      const clamped = Math.min(prev, maxPanelScroll);
      const fullyVisible = anchor >= clamped && blockEnd <= clamped + FLOW_VISIBLE;
      return fullyVisible ? clamped : Math.min(maxPanelScroll, anchor);
    });
  }, [focus, fieldIndex, params, flowRows, maxPanelScroll, FLOW_VISIBLE, runStatus]);

  /** Focusing the result region reveals it and seeds the line cursor. */
  useEffect(() => {
    if (focus !== 'result') {
      return;
    }
    setPanelScroll(Math.min(Math.max(0, resultStartIndex), maxPanelScroll));
    setResultCursor((prev) => {
      if (resultLines.length === 0) {
        return null;
      }
      return prev !== null && prev < resultLines.length ? prev : 0;
    });
  }, [focus, resultStartIndex, maxPanelScroll, resultLines.length]);

  /** Keep the line cursor (or the selection end) on screen. */
  useEffect(() => {
    if (focus !== 'result') {
      return;
    }
    const target = selectCursor ?? resultCursor;
    if (target === null) {
      return;
    }
    const rowIndex = flowRows.findIndex((r) => r.type === 'text' && r.resultIndex === target);
    if (rowIndex < 0) {
      return;
    }
    setPanelScroll((prev) => {
      const clamped = Math.min(prev, maxPanelScroll);
      if (rowIndex >= clamped && rowIndex < clamped + FLOW_VISIBLE) {
        return clamped;
      }
      return Math.max(0, Math.min(maxPanelScroll, rowIndex - Math.floor(FLOW_VISIBLE / 2)));
    });
  }, [focus, selectCursor, resultCursor, flowRows, maxPanelScroll, FLOW_VISIBLE]);

  /** The copy notice is transient. */
  useEffect(() => {
    if (copyNotice === null) {
      return;
    }
    const timer = setTimeout(() => setCopyNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [copyNotice]);

  const endpointInfo =
    service.transport === 'stdio'
      ? (service.command || '') + (service.args?.length ? ' ' + service.args.join(' ') : '')
      : service.url || 'N/A';

  if (loading) {
    return (
      <Box flexDirection="column" height={terminalHeight}>
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="cyan">
            Tools for: {service.name}
          </Text>
          <Text dimColor>
            Transport: {service.transport} | {endpointInfo}
          </Text>
        </Box>
        <Text color="cyan">Fetching tools from service...</Text>
      </Box>
    );
  }

  const renderDetailRow = (row: DetailRow, key: string) => {
    const range = selectedRange();
    if (row.type === 'text' && row.resultIndex !== undefined) {
      // Result content rows are split so the selection background covers only
      // the actual text — never the `│` frame or the row's trailing padding,
      // which would otherwise turn a blank result line into a solid bar.
      const line = resultLines[row.resultIndex] ?? '';
      // The cursor marker sits INSIDE the frame and eats one content cell, so
      // the box keeps both of its borders (a marker drawn over the left frame
      // made the box look broken) and the right border stays aligned.
      const cursorHere = focus === 'result' && row.resultIndex === resultCursor;
      const marker = cursorHere ? '▸' : '';
      const budget = RESULT_INNER - marker.length;
      const fitted = truncateDisplay(line, budget);
      const padding = ' '.repeat(Math.max(0, budget - displayWidth(fitted)));
      const highlighted =
        range !== null &&
        row.resultIndex >= range.from &&
        row.resultIndex <= range.to &&
        fitted.trim() !== '';
      return (
        <Text key={key} wrap="truncate">
          {'│'}
          {marker}
          <Text {...(highlighted ? { backgroundColor: 'blue' as const } : {})}>{fitted}</Text>
          {padding}
          {'│'}
        </Text>
      );
    }
    if (row.type === 'input') {
      const param = row.param;
      return (
        <Box key={key}>
          <Text>{DETAIL_VALUE_INDENT}</Text>
          <SingleLineInput
            key={param.name}
            value={formValues[param.name] ?? ''}
            placeholder={
              param.kind === 'array' ? '[1, 2]' : param.kind === 'object' ? '{"k": "v"}' : 'value'
            }
            width={PANEL_WIDTH - DETAIL_VALUE_INDENT.length}
            onChange={(next) => {
              setFormValues({ ...formValuesRef.current, [param.name]: next });
            }}
          />
        </Box>
      );
    }
    if (row.type === 'select') {
      const value = formatParamValue(row.param, formValues);
      const options =
        row.param.kind === 'boolean'
          ? row.param.required
            ? 'true/false'
            : '(unset)/true/false'
          : (row.param.enumValues ?? []).map((v) => String(v)).join('/');
      return (
        <Text key={key} wrap="truncate">
          {DETAIL_VALUE_INDENT}
          <Text bold>{value}</Text>
          <Text color="gray">{`  ◂ Space cycles: ${truncateDisplay(options, PANEL_WIDTH - 26)}`}</Text>
        </Text>
      );
    }
    if (row.segments !== undefined) {
      // One wrapping parent so truncation and line-breaking stay row-level;
      // children only contribute color (the harness drops SGR entirely).
      return (
        <Text key={key} wrap="truncate">
          {row.segments.map((segment, i) => (
            <Text key={i} {...toneStyle(segment.tone)}>
              {segment.text}
            </Text>
          ))}
        </Text>
      );
    }
    return (
      <Text key={key} wrap="truncate">
        {row.text}
      </Text>
    );
  };

  return (
    <Box flexDirection="column" height={terminalHeight}>
      <Box flexDirection="column" marginBottom={1}>
        <Box justifyContent="space-between">
          <Box>
            <Text bold color="cyan">
              Tools for: {service.name}
            </Text>
          </Box>
          {totalToolsCount > 0 && (
            <Box>
              <Text color="green" bold>
                {enabledToolsCount}✓
              </Text>
              <Text dimColor>/</Text>
              <Text color="red" bold>
                {totalToolsCount - enabledToolsCount}✗
              </Text>
              <Text dimColor> of {totalToolsCount}</Text>
            </Box>
          )}
        </Box>
        <Text dimColor>
          Transport: {service.transport} | {endpointInfo}
        </Text>
      </Box>

      {error && <Text color="yellow">{truncateDisplay(error, effectiveWidth)}</Text>}

      {tools.length === 0 ? (
        <Box flexDirection="column">
          <Text color="yellow">No tools found for this service</Text>
          <Text dimColor>
            {service.transport === 'stdio'
              ? 'Could not connect to stdio service - check command and ensure service is running'
              : service.url
                ? 'Could not connect to service or service has no tools'
                : 'Service URL not configured - tools can only be discovered when service is reachable'}
          </Text>
          {Object.keys(toolStates).length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text>Previously configured:</Text>
              {Object.entries(toolStates).map(([name, enabled]) => (
                <Box key={name} flexDirection="row">
                  <Text>
                    <Text color={enabled ? 'green' : 'red'}>{enabled ? '+' : '-'}</Text> {name}
                  </Text>
                </Box>
              ))}
            </Box>
          )}
        </Box>
      ) : (
        <Box flexDirection="column" flexGrow={1}>
          {/* Search bar + divider */}
          <Box marginBottom={0}>
            <Text>
              <Text bold color={searchMode ? 'yellow' : 'cyan'}>
                🔍{' '}
              </Text>
              {searchMode || searchQuery ? (
                <>
                  <Text dimColor>Search: </Text>
                  <Text color={searchMode ? 'yellow' : 'white'}>{searchQuery}</Text>
                  {searchMode && <Text color="yellow">_</Text>}
                  <Text dimColor>
                    {' '}
                    [{filteredTools.length}/{totalToolsCount} matched]
                  </Text>
                </>
              ) : (
                <Text dimColor>Press / to search ({totalToolsCount} tools)</Text>
              )}
            </Text>
          </Box>
          <Text dimColor wrap="truncate">
            {'─'.repeat(Math.min(effectiveWidth, 200))}
          </Text>

          <Box flexDirection="row" height={PANEL_LINES}>
            {!fullWidth && (
              <Box flexDirection="column" width={TOOLS_LIST_WIDTH}>
                {filteredTools.length === 0 ? (
                  <Text color="yellow">No tools match &quot;{searchQuery}&quot;</Text>
                ) : (
                  <>
                    {filteredTools
                      .slice(toolScrollOffset, toolScrollOffset + VISIBLE_TOOLS)
                      .map((tool, index) => (
                        <Box key={tool.name} flexDirection="row">
                          <Text>
                            {index === selectedIndex - toolScrollOffset ? '▶ ' : '  '}
                            <Text color={tool.enabled ? 'green' : 'red'} bold>
                              {tool.enabled ? '✓' : '✗'}
                            </Text>{' '}
                          </Text>
                          <Text
                            wrap="truncate"
                            bold
                            {...(index === selectedIndex - toolScrollOffset
                              ? { color: 'cyan' as const }
                              : { color: 'white' as const })}
                          >
                            {truncateToolName(tool.name)}
                          </Text>
                        </Box>
                      ))}
                    {(toolScrollOffset > 0 ||
                      toolScrollOffset + VISIBLE_TOOLS < filteredTools.length) && (
                      <Text dimColor>
                        {toolScrollOffset > 0 && '↑ more'}
                        {toolScrollOffset > 0 &&
                          toolScrollOffset + VISIBLE_TOOLS < filteredTools.length &&
                          '  •  '}
                        {toolScrollOffset + VISIBLE_TOOLS < filteredTools.length &&
                          `↓ ${filteredTools.length - toolScrollOffset - VISIBLE_TOOLS} more`}
                      </Text>
                    )}
                  </>
                )}
              </Box>
            )}

            <Box
              flexDirection="column"
              marginLeft={fullWidth ? 0 : 1}
              width={PANEL_BOX_WIDTH}
              flexGrow={1}
            >
              {focus === 'json' ? (
                <Box flexDirection="column">
                  <Text bold color="cyan">
                    Arguments (raw JSON):
                  </Text>
                  <Box width={PANEL_WIDTH}>
                    <JsonTextArea
                      value={jsonText}
                      onChange={(next) => {
                        setJsonText(next);
                      }}
                      height={Math.max(1, Math.min(12, PANEL_LINES - 4))}
                    />
                  </Box>
                  {jsonError !== null && (
                    <Text color="red">✗ JSON: {truncateDisplay(jsonError, PANEL_WIDTH - 8)}</Text>
                  )}
                </Box>
              ) : (
                <>
                  {flowRows
                    .slice(clampedPanelScroll, clampedPanelScroll + FLOW_VISIBLE)
                    .map((row, i) =>
                      renderDetailRow(row, `row-${clampedPanelScroll + i}-${row.type}`)
                    )}
                  <Text dimColor>{scrollHint(clampedPanelScroll, maxPanelScroll)}</Text>
                </>
              )}
            </Box>
          </Box>
        </Box>
      )}

      <Box flexDirection="column">
        {terminalHeight >= 10 && (
          <Text bold color="cyan">
            Quick Actions:
          </Text>
        )}
        <Text dimColor wrap="truncate">
          {'  '}
          {searchMode
            ? 'Type to search • ↑/↓ Navigate matches • Enter Confirm'
            : focus === 'params'
              ? '↑/↓ Param • ←/→ Cursor • Space Cycle option • Enter Next'
              : focus === 'result'
                ? `↑/↓ Cursor • ←/→ Page • v ${
                    selectAnchor !== null ? 'Cancel select' : 'Select lines'
                  } • f Full width`
                : focus === 'json'
                  ? 'Edit raw JSON arguments'
                  : '↑/↓ Navigate • Space Toggle • a/A All on/off • / Search'}
        </Text>
        <Text dimColor wrap="truncate">
          {'  '}
          {copyNotice ??
            (searchMode
              ? 'Ctrl+R Run • Esc Leave search'
              : focus === 'params' || focus === 'json'
                ? 'Tab Next region • Ctrl+R Run • Ctrl+J JSON • Esc Done'
                : focus === 'result'
                  ? selectAnchor !== null
                    ? 'Ctrl+Y Copy selection • Esc Cancel'
                    : 'Ctrl+Y Copy result • Ctrl+P Raw • Ctrl+O Save'
                  : `←/→ Page • Tab Region • Ctrl+R Run • f Full width • Ctrl+E ${
                      descExpanded ? 'Collapse' : 'Expand'
                    } desc`)}
        </Text>
      </Box>
    </Box>
  );
};
