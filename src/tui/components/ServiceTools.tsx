/**
 * TUI Service Tools Component
 *
 * Displays tools for a selected service and allows enabling/disabling them.
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { StdioTransport } from '../../transport/stdio.js';
import type { ServiceDefinition, Tool } from '../../types/service.js';

export interface ServiceToolsProps {
  service: ServiceDefinition;
  onBack: () => void;
  onToggleTool: (toolName: string, enabled: boolean) => void;
  toolStates?: Record<string, boolean>;
  onToolsDiscovered?: (toolCount: number) => void;
}

interface ToolWithState extends Tool {
  enabled: boolean;
}

async function fetchToolsViaStdio(service: ServiceDefinition): Promise<Tool[]> {
  if (!service.command) {
    return [];
  }

  let transport: StdioTransport | null = null;
  
  try {
    transport = new StdioTransport({
      command: service.command,
      args: service.args || [],
      env: service.env,
    });

    // Wait for connection
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Connection timeout')), 10000);
      transport!.on('connected', () => {
        clearTimeout(timeout);
        resolve();
      });
      transport!.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    // Step 1: Send initialize request
    const initRequest = {
      jsonrpc: '2.0' as const,
      id: `init-${Date.now()}`,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'onemcp-tui',
          version: '0.1.0',
        },
      },
    };

    await transport.send(initRequest);

    // Wait for initialize response
    const initIter = transport.receive();
    const initResult = await initIter.next();
    
    if (!initResult.value || initResult.value === undefined) {
      throw new Error('No response for initialize request');
    }
    
    if ('error' in initResult.value) {
      throw new Error(`Initialize failed: ${(initResult.value as any).error.message}`);
    }

    // Step 2: Send initialized notification (no response expected)
    await transport.send({
      jsonrpc: '2.0' as const,
      method: 'initialized',
      params: {},
    });

    // Step 3: Send tools/list request
    const toolsRequest = {
      jsonrpc: '2.0' as const,
      id: `tools-${Date.now()}`,
      method: 'tools/list',
      params: {},
    };

    await transport.send(toolsRequest);

    // Wait for tools response
    const toolsIter = transport.receive();
    const toolsResult = await toolsIter.next();
    
    if (!toolsResult.value || toolsResult.value === undefined) {
      throw new Error('No response for tools/list request');
    }
    
    if ('error' in toolsResult.value) {
      throw new Error(`tools/list failed: ${(toolsResult.value as any).error.message}`);
    }

    const result = toolsResult.value as any;
    if (result.result?.tools) {
      return result.result.tools.map((t: any) => ({
        name: t.name,
        description: t.description || '',
        inputSchema: t.inputSchema || { type: 'object', properties: {} },
      }));
    }

    return [];
  } catch (err) {
    console.error('MCP stdio error:', err);
    throw err;
  } finally {
    if (transport) {
      await transport.close();
    }
  }
}

async function fetchToolsViaHttp(service: ServiceDefinition): Promise<Tool[]> {
  if (!service.url || (service.transport !== 'http' && service.transport !== 'sse')) {
    return [];
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };

  if (service.headers) {
    Object.assign(headers, service.headers);
  }

  let sessionId: string | undefined;

  try {
    // Step 1: Initialize
    const initResponse = await fetch(service.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `init-${Date.now()}`,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'onemcp-tui',
            version: '0.1.0',
          },
        },
      }),
    });

    sessionId = initResponse.headers.get('mcp-session-id') || undefined;

    const initText = await initResponse.text();
    let initData: any;
    
    // Handle SSE response format
    if (initText.startsWith('event:') || initText.includes('\ndata: ')) {
      const lines = initText.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          initData = JSON.parse(line.slice(6));
          break;
        }
      }
    } else {
      initData = JSON.parse(initText);
    }

    if (initData.error) {
      throw new Error(initData.error.message);
    }

    // Step 2: Send initialized notification
    await fetch(service.url, {
      method: 'POST',
      headers: {
        ...headers,
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `notif-${Date.now()}`,
        method: 'initialized',
        params: {},
      }),
    });

    // Step 3: List tools
    const toolsResponse = await fetch(service.url, {
      method: 'POST',
      headers: {
        ...headers,
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `tools-${Date.now()}`,
        method: 'tools/list',
        params: {},
      }),
    });

    const toolsText = await toolsResponse.text();
    let toolsData: any;
    
    if (toolsText.startsWith('event:') || toolsText.includes('\ndata: ')) {
      const lines = toolsText.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          toolsData = JSON.parse(line.slice(6));
          break;
        }
      }
    } else {
      toolsData = JSON.parse(toolsText);
    }

    if (toolsData.error) {
      throw new Error(toolsData.error.message);
    }

    if (toolsData.result?.tools) {
      return toolsData.result.tools.map((t: any) => ({
        name: t.name,
        description: t.description || '',
        inputSchema: t.inputSchema || { type: 'object', properties: {} },
      }));
    }
  } catch (err) {
    console.error('MCP HTTP error:', err);
    throw err;
  }

  return [];
}

async function fetchToolsFromService(service: ServiceDefinition): Promise<Tool[]> {
  if (service.transport === 'stdio') {
    return fetchToolsViaStdio(service);
  } else {
    return fetchToolsViaHttp(service);
  }
}

export const ServiceTools: React.FC<ServiceToolsProps> = ({
  service,
  onBack,
  onToggleTool,
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
  const HEADER_LINES = 3;
  const FOOTER_LINES = 2;
  const AVAILABLE_LINES = terminalHeight - HEADER_LINES - FOOTER_LINES;
  const VISIBLE_TOOLS = Math.max(5, Math.floor(AVAILABLE_LINES * 0.5));
  const TOOLS_LIST_WIDTH = Math.floor(terminalWidth * 0.3);
  const DESC_WIDTH = Math.floor(terminalWidth * 0.7) - 1;

  const currentTool = tools[selectedIndex];
  const descriptionLines = currentTool?.description?.split('\n') || [];
  const maxDescScroll = Math.max(0, descriptionLines.length - VISIBLE_TOOLS);

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
        const fetchedTools = await fetchToolsFromService(service);
        
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
      tools.forEach(t => {
        if (!t.enabled) onToggleTool(t.name, true);
      });
      setTools(prev => prev.map(t => ({ ...t, enabled: true })));
    } else if (input === 'A') {
      tools.forEach(t => {
        if (t.enabled) onToggleTool(t.name, false);
      });
      setTools(prev => prev.map(t => ({ ...t, enabled: false })));
    } else if (key.escape) {
      onBack();
    }
  });

  if (loading) {
    return (
      <Box flexDirection="column" height={terminalHeight}>
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="cyan">Tools for: {service.name}</Text>
          <Text dimColor>Transport: {service.transport} | URL: {service.url || 'N/A'}</Text>
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
              <Text dimColor>Tools: </Text>
              <Text color="magenta" bold>
                {enabledToolsCount}/{totalToolsCount}
              </Text>
              <Text dimColor> enabled</Text>
            </Box>
          )}
        </Box>
        <Text dimColor>Transport: {service.transport} | URL: {service.url || 'N/A'}</Text>
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
            {service.url 
              ? 'Could not connect to service or service has no tools'
              : 'Service URL not configured - tools can only be discovered when service is reachable'}
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
                  <Text color={tool.enabled ? 'green' : 'red'}>
                    {tool.enabled ? '+' : '-'}
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
                {descriptionLines.slice(scrollOffset, scrollOffset + VISIBLE_TOOLS - 1).map((line, i) => (
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
        <Text bold>Actions:</Text>
        <Text dimColor>  [↑/↓] Select | [Space/T] Toggle | [a] Enable all | [A] Disable all</Text>
        <Text dimColor>  [←/→] Scroll description | [Esc] Back</Text>
      </Box>
    </Box>
  );
};
