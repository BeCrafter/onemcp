/**
 * TUI Service Tools Component
 *
 * Displays tools for a selected service and allows enabling/disabling them.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { fetchServiceTools } from '../discovery-worker.js';
import type { ServiceDefinition } from '../../types/service.js';

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

interface BasicTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface ToolWithState extends BasicTool {
  enabled: boolean;
}

const FETCH_TIMEOUT_MS = 15000;

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
  const [tools, setTools] = useState<ToolWithState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [toolScrollOffset, setToolScrollOffset] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState(false);

  const filteredTools = useMemo(() => {
    if (!searchQuery) return tools;
    const q = searchQuery.toLowerCase();
    return tools.filter(t => t.name.toLowerCase().includes(q));
  }, [tools, searchQuery]);

  const terminalHeight = terminalHeightProp ?? (stdout?.rows || 24);
  const terminalWidth = stdout?.columns || 80;
  const HEADER_LINES = 4;
  const FOOTER_LINES = 4; // Increased from 3 to 4 to account for quick actions section
  const AVAILABLE_LINES = Math.max(1, terminalHeight - HEADER_LINES - FOOTER_LINES);
  const VISIBLE_TOOLS = Math.min(filteredTools.length, Math.max(3, AVAILABLE_LINES - 2));
  
  // Calculate available lines for description content (accounting for description header and scroll indicators)
  const DESCRIPTION_CONTENT_LINES = Math.max(1, AVAILABLE_LINES - 2);
  
  const BORDER_PADDING = 4;
  const effectiveWidth = Math.max(terminalWidth - BORDER_PADDING, 50);
  const TOOL_WIDTH_RATIO = Math.min(0.5, Math.max(0.3, 40 / effectiveWidth));
  const TOOLS_LIST_WIDTH = Math.floor(effectiveWidth * TOOL_WIDTH_RATIO);
  const DESC_WIDTH = effectiveWidth - TOOLS_LIST_WIDTH;

  // Prefix "▶ ✓ " / "  ✓ " occupies 4 cells; keep name strictly within the panel
  const TOOL_NAME_PREFIX_WIDTH = 4;
  const maxToolNameWidth = Math.max(8, TOOLS_LIST_WIDTH - TOOL_NAME_PREFIX_WIDTH - 1);
  const truncateToolName = (name: string): string =>
    name.length > maxToolNameWidth ? name.slice(0, maxToolNameWidth - 1) + '…' : name;

  const currentTool = filteredTools[selectedIndex];
  const descriptionLines = currentTool?.description?.split('\n') || [];
  const maxDescScroll = Math.max(0, descriptionLines.length - DESCRIPTION_CONTENT_LINES);

  // Calculate tool statistics
  const enabledToolsCount = tools.filter(t => t.enabled).length;
  const totalToolsCount = tools.length;

  useEffect(() => {
    setScrollOffset(0);
  }, [selectedIndex]);

  // Reset selection when the filter changes so the index stays valid
  useEffect(() => {
    setSelectedIndex(0);
    setToolScrollOffset(0);
  }, [searchQuery]);

  useEffect(() => {
    setToolScrollOffset(prev => {
      if (selectedIndex < prev) return selectedIndex;
      if (selectedIndex >= prev + VISIBLE_TOOLS) {
        return Math.max(0, selectedIndex - VISIBLE_TOOLS + 1);
      }
      return prev;
    });
  }, [selectedIndex, VISIBLE_TOOLS]);

  useEffect(() => {
    const loadTools = async () => {
      setLoading(true);
      setError(null);

      try {
        const fetchedTools = await fetchServiceTools(service, FETCH_TIMEOUT_MS);
        
        if (fetchedTools.length > 0) {
          setTools(fetchedTools.map(tool => ({
            ...tool,
            enabled: toolStates[tool.name] ?? true,
          })));
          
          // Notify parent component of discovered tool count
          onToolsDiscovered?.(fetchedTools.length);
        } else if (Object.keys(toolStates).length > 0) {
          setTools(Object.entries(toolStates).map(([name, enabled]) => ({
            name,
            description: '',
            inputSchema: { type: 'object', properties: {} },
            enabled,
          })));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch tools');
      } finally {
        setLoading(false);
      }
    };

    loadTools();
  }, [service.name, service.url]);

  useInput((input, key) => {
    // --- Search input mode: keystrokes edit the query (↑↓ still navigate) ---
    if (searchMode) {
      if (key.escape) {
        // First Esc: leave search mode but keep the filter; a second Esc
        // (handled in navigation mode below) clears the query, a third
        // returns to the service list.
        setSearchMode(false);
        return;
      }
      if (key.return) {
        setSearchMode(false);
        return;
      }
      if (key.upArrow) {
        setSelectedIndex(prev => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedIndex(prev => Math.max(0, Math.min(filteredTools.length - 1, prev + 1)));
        return;
      }
      if (key.backspace || key.delete) {
        setSearchQuery(prev => prev.slice(0, -1));
        return;
      }
      // Printable character (including space) → append to query
      if (input && input.length === 1 && input >= ' ' && input !== '/' ) {
        setSearchQuery(prev => prev + input);
        return;
      }
      return;
    }

    // --- Navigation mode ---
    if (input === '/') {
      setSearchMode(true);
      return;
    }
    if (key.escape) {
      // Layered Esc: a lingering filter clears first, then we go back.
      if (searchQuery) {
        setSearchQuery('');
      } else {
        onBack();
      }
      return;
    }
    if (key.upArrow) {
      setSelectedIndex(prev => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setSelectedIndex(prev => Math.max(0, Math.min(filteredTools.length - 1, prev + 1)));
    } else if (key.leftArrow) {
      setScrollOffset(prev => Math.max(0, prev - 1));
    } else if (key.rightArrow) {
      setScrollOffset(prev => Math.min(maxDescScroll, prev + 1));
    } else if (input === ' ' || input === 't') {
      const tool = filteredTools[selectedIndex];
      if (tool) {
        const newEnabled = !tool.enabled;
        onToggleTool(tool.name, newEnabled);
        setTools(prev => prev.map(t =>
          t.name === tool.name ? { ...t, enabled: newEnabled } : t
        ));
      }
    } else if (input === 'a') {
      const toolsToEnable = filteredTools.filter(t => !t.enabled).map(t => t.name);
      if (toolsToEnable.length > 0) {
        const filteredNames = new Set(filteredTools.map(t => t.name));
        const applyEnable = (t: ToolWithState): ToolWithState =>
          filteredNames.has(t.name) ? { ...t, enabled: true } : t;
        if (onBatchToggleTools) {
          const batchToolStates: Record<string, boolean> = {};
          toolsToEnable.forEach(toolName => {
            batchToolStates[toolName] = true;
          });
          onBatchToggleTools(batchToolStates);
          setTools(prev => prev.map(applyEnable));
        } else {
          setTools(prev => prev.map(applyEnable));
          toolsToEnable.forEach(toolName => onToggleTool(toolName, true));
        }
      }
    } else if (input === 'A') {
      const toolsToDisable = filteredTools.filter(t => t.enabled).map(t => t.name);
      if (toolsToDisable.length > 0) {
        const filteredNames = new Set(filteredTools.map(t => t.name));
        const applyDisable = (t: ToolWithState): ToolWithState =>
          filteredNames.has(t.name) ? { ...t, enabled: false } : t;
        if (onBatchToggleTools) {
          const batchToolStates: Record<string, boolean> = {};
          toolsToDisable.forEach(toolName => {
            batchToolStates[toolName] = false;
          });
          onBatchToggleTools(batchToolStates);
          setTools(prev => prev.map(applyDisable));
        } else {
          setTools(prev => prev.map(applyDisable));
          toolsToDisable.forEach(toolName => onToggleTool(toolName, false));
        }
      }
    }
  });

  const endpointInfo = service.transport === 'stdio'
    ? ((service.command || '') + (service.args?.length ? ' ' + service.args.join(' ') : ''))
    : (service.url || 'N/A');

  if (loading) {
    return (
      <Box flexDirection="column" height={terminalHeight}>
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="cyan">Tools for: {service.name}</Text>
          <Text dimColor>Transport: {service.transport} | {endpointInfo}</Text>
        </Box>
        <Text color="cyan">Fetching tools from service...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={terminalHeight}>
      <Box flexDirection="column" marginBottom={1}>
        <Box justifyContent="space-between">
          <Box>
            <Text bold color="cyan">Tools for: {service.name}</Text>
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
        <Text dimColor>Transport: {service.transport} | {endpointInfo}</Text>
      </Box>

      {error && (
        <Box marginBottom={1}>
          <Text color="yellow">{error}</Text>
        </Box>
      )}

      {tools.length === 0 ? (
        <Box flexDirection="column">
          <Text color="yellow">No tools found for this service</Text>
          <Text dimColor>
            {service.transport === 'stdio'
              ? 'Could not connect to stdio service - check command and ensure service is running'
              : (service.url
                ? 'Could not connect to service or service has no tools'
                : 'Service URL not configured - tools can only be discovered when service is reachable')}
          </Text>
          {Object.keys(toolStates).length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text>Previously configured:</Text>
              {Object.entries(toolStates).map(([name, enabled]) => (
                <Box key={name} flexDirection="row">
                  <Text>
                    <Text color={enabled ? 'green' : 'red'}>
                      {enabled ? '+' : '-'}
                    </Text>
                    {' '}{name}
                  </Text>
                </Box>
              ))}
            </Box>
          )}
        </Box>
      ) : (
        <Box flexDirection="column" flexGrow={1}>
          {/* Search bar */}
          <Box marginBottom={0}>
            <Text>
              <Text bold color={searchMode ? 'yellow' : 'cyan'}>🔍 </Text>
              {searchMode || searchQuery ? (
                <>
                  <Text dimColor>Search: </Text>
                  <Text color={searchMode ? 'yellow' : 'white'}>{searchQuery}</Text>
                  {searchMode && <Text color="yellow">_</Text>}
                  <Text dimColor>
                    {' '}[{filteredTools.length}/{totalToolsCount} matched]
                  </Text>
                </>
              ) : (
                <Text dimColor>Press / to search ({totalToolsCount} tools)</Text>
              )}
            </Text>
          </Box>

          <Box flexDirection="row" flexGrow={1}>
            <Box flexDirection="column" width={TOOLS_LIST_WIDTH}>
              {filteredTools.length === 0 ? (
                <Text color="yellow">
                  No tools match &quot;{searchQuery}&quot;
                </Text>
              ) : (
                <>
                  {filteredTools.slice(toolScrollOffset, toolScrollOffset + VISIBLE_TOOLS).map((tool, index) => (
                    <Box key={tool.name} flexDirection="row">
                      <Text>
                        {index === selectedIndex - toolScrollOffset ? '▶ ' : '  '}
                        <Text color={tool.enabled ? 'green' : 'red'} bold>
                          {tool.enabled ? '✓' : '✗'}
                        </Text>
                        {' '}
                      </Text>
                      <Text wrap="truncate">{truncateToolName(tool.name)}</Text>
                    </Box>
                  ))}
                  {(toolScrollOffset > 0 || toolScrollOffset + VISIBLE_TOOLS < filteredTools.length) && (
                    <Text dimColor>
                      {toolScrollOffset > 0 && '↑ more'}
                      {toolScrollOffset > 0 && toolScrollOffset + VISIBLE_TOOLS < filteredTools.length && '  •  '}
                      {toolScrollOffset + VISIBLE_TOOLS < filteredTools.length &&
                        `↓ ${filteredTools.length - toolScrollOffset - VISIBLE_TOOLS} more`}
                    </Text>
                  )}
                </>
              )}
            </Box>

            <Box flexDirection="column" marginLeft={1} width={DESC_WIDTH} flexGrow={1}>
              <Text bold>Description:</Text>
              {descriptionLines.length > 0 ? (
                <>
                  {descriptionLines.slice(scrollOffset, scrollOffset + DESCRIPTION_CONTENT_LINES).map((line, i) => (
                    <Text key={i}>{line}</Text>
                  ))}
                  <Text dimColor>
                    {scrollOffset > 0 ? '↑' : ' '}
                    {scrollOffset > 0 && scrollOffset < maxDescScroll ? '|' : ''}
                    {scrollOffset < maxDescScroll ? '↓' : ''}
                  </Text>
                </>
              ) : (
                <Text dimColor>No description</Text>
              )}
            </Box>
          </Box>
        </Box>
      )}

      <Box flexDirection="column">
        <Text bold color="cyan">Quick Actions:</Text>
        <Text dimColor>
          {'  '}↑/↓: Navigate • Space/T: Toggle tool • /: Search{searchMode ? ' (Enter to confirm)' : ''}
        </Text>
        <Text dimColor>
          {'  '}a: Enable {searchQuery ? 'filtered' : 'all'} • A: Disable {searchQuery ? 'filtered' : 'all'}
        </Text>
        <Text dimColor>
          {'  '}←/→: Scroll description • Esc: {searchQuery ? 'Clear search' : 'Return to service list'}
        </Text>
      </Box>
    </Box>
  );
};
