/**
 * TUI Service Tools Component
 *
 * Displays tools for a selected service and allows enabling/disabling them.
 */

import React, { useState, useEffect } from 'react';
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
}) => {
  const { stdout } = useStdout();
  const [tools, setTools] = useState<ToolWithState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  const terminalHeight = stdout?.rows || 24;
  const terminalWidth = stdout?.columns || 80;
  const HEADER_LINES = 4;
  const FOOTER_LINES = 4; // Increased from 3 to 4 to account for quick actions section
  const AVAILABLE_LINES = Math.max(1, terminalHeight - HEADER_LINES - FOOTER_LINES);
  const VISIBLE_TOOLS = Math.min(tools.length, Math.max(3, AVAILABLE_LINES));
  
  // Calculate available lines for description content (accounting for description header and scroll indicators)
  const DESCRIPTION_CONTENT_LINES = Math.max(1, AVAILABLE_LINES - 2);
  
  const BORDER_PADDING = 4;
  const effectiveWidth = Math.max(terminalWidth - BORDER_PADDING, 50);
  const TOOL_WIDTH_RATIO = Math.min(0.5, Math.max(0.3, 40 / effectiveWidth));
  const TOOLS_LIST_WIDTH = Math.floor(effectiveWidth * TOOL_WIDTH_RATIO);
  const DESC_WIDTH = effectiveWidth - TOOLS_LIST_WIDTH;

  const currentTool = tools[selectedIndex];
  const descriptionLines = currentTool?.description?.split('\n') || [];
  const maxDescScroll = Math.max(0, descriptionLines.length - DESCRIPTION_CONTENT_LINES);

  // Calculate tool statistics
  const enabledToolsCount = tools.filter(t => t.enabled).length;
  const totalToolsCount = tools.length;

  useEffect(() => {
    setScrollOffset(0);
  }, [selectedIndex]);

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
    if (key.upArrow) {
      setSelectedIndex(prev => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setSelectedIndex(prev => Math.min(tools.length - 1, prev + 1));
    } else if (key.leftArrow) {
      setScrollOffset(prev => Math.max(0, prev - 1));
    } else if (key.rightArrow) {
      setScrollOffset(prev => Math.min(maxDescScroll, prev + 1));
    } else if (input === ' ' || input === 't') {
      if (tools[selectedIndex]) {
        const tool = tools[selectedIndex];
        const newEnabled = !tool.enabled;
        onToggleTool(tool.name, newEnabled);
        setTools(prev => prev.map((t, i) => 
          i === selectedIndex ? { ...t, enabled: newEnabled } : t
        ));
      }
    } else if (input === 'a') {
      const toolsToEnable = tools.filter(t => !t.enabled).map(t => t.name);
      if (toolsToEnable.length > 0) {
        if (onBatchToggleTools) {
          const batchToolStates: Record<string, boolean> = {};
          toolsToEnable.forEach(toolName => {
            batchToolStates[toolName] = true;
          });
          onBatchToggleTools(batchToolStates);
          setTools(prev => prev.map(t => ({ ...t, enabled: true })));
        } else {
          setTools(prev => prev.map(t => ({ ...t, enabled: true })));
          toolsToEnable.forEach(toolName => onToggleTool(toolName, true));
        }
      }
    } else if (input === 'A') {
      const toolsToDisable = tools.filter(t => t.enabled).map(t => t.name);
      if (toolsToDisable.length > 0) {
        if (onBatchToggleTools) {
          const batchToolStates: Record<string, boolean> = {};
          toolsToDisable.forEach(toolName => {
            batchToolStates[toolName] = false;
          });
          onBatchToggleTools(batchToolStates);
          setTools(prev => prev.map(t => ({ ...t, enabled: false })));
        } else {
          setTools(prev => prev.map(t => ({ ...t, enabled: false })));
          toolsToDisable.forEach(toolName => onToggleTool(toolName, false));
        }
      }
    } else if (key.escape) {
      onBack();
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
        <Box flexDirection="row" flexGrow={1}>
          <Box flexDirection="column" width={TOOLS_LIST_WIDTH}>
            {tools.slice(0, VISIBLE_TOOLS).map((tool, index) => (
               <Box key={tool.name} flexDirection="row">
                 <Text>
                   {index === selectedIndex ? '▶ ' : '  '}
                   <Text color={tool.enabled ? 'green' : 'red'} bold>
                     {tool.enabled ? '✓' : '✗'}
                   </Text>
                   {' '}{tool.name}
                 </Text>
               </Box>
            ))}
            {tools.length > VISIBLE_TOOLS && (
              <Text dimColor>  ... +{tools.length - VISIBLE_TOOLS} more</Text>
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
      )}

      <Box flexDirection="column">
        <Text bold color="cyan">Quick Actions:</Text>
        <Text dimColor>  ↑/↓: Navigate tools • Space/T: Toggle tool</Text>
        <Text dimColor>  A: Disable all tools • a: Enable all tools</Text>
        <Text dimColor>  ←/→: Scroll description • Esc: Return to service list</Text>
      </Box>
    </Box>
  );
};
