/**
 * Service List Component
 * 
 * Displays all registered services with their status and details.
 * Supports navigation and selection with enhanced visual feedback.
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ServiceDefinition } from '../../types/service.js';

export interface ServiceListProps {
  services: ServiceDefinition[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  globalToolStats?: { enabled: number; total: number };
  terminalHeight?: number;
  showDetails?: boolean;
}

/**
 * Format transport type with color
 */
function formatTransport(transport: string): { text: string; color: string } {
  switch (transport) {
    case 'stdio':
      return { text: 'stdio', color: 'blue' };
    case 'sse':
      return { text: 'SSE', color: 'magenta' };
    case 'http':
      return { text: 'HTTP', color: 'cyan' };
    default:
      return { text: transport, color: 'gray' };
  }
}

/**
 * Format enabled status with color
 */
function formatEnabled(enabled: boolean): { text: string; color: string; symbol: string } {
  return enabled
    ? { text: 'Enabled', color: 'green', symbol: '+' }
    : { text: 'Disabled', color: 'red', symbol: '-' };
}

/**
 * Service List Item Component
 */
const ServiceListItem: React.FC<{
  service: ServiceDefinition;
  isSelected: boolean;
}> = ({ service, isSelected }) => {
  const transport = formatTransport(service.transport);
  const status = formatEnabled(service.enabled);
  
  // Calculate tool statistics
  const hasTools = service.toolStates && Object.keys(service.toolStates).length > 0;
  
  // Use discovered tool count if available, otherwise fall back to toolStates length
  const totalTools = service.discoveredToolsCount ?? (hasTools ? Object.keys(service.toolStates!).length : 0);
  
  // Count explicitly disabled tools
  const disabledTools = hasTools 
    ? Object.entries(service.toolStates!).filter(([_, enabled]) => enabled === false).length
    : 0;
  
  // Enabled tools = total - disabled (tools are enabled by default)
  const enabledTools = totalTools - disabledTools;

  const endpoint = service.transport === 'stdio' 
    ? ((service.command || '') + (service.args?.length ? ' ' + service.args.join(' ') : ''))
    : (service.url || '');
  
  const endpointDisplay = endpoint.length > 50 
    ? endpoint.substring(0, 47) + '...' 
    : endpoint;

  return (
    <Box
      flexDirection="row"
      borderStyle="single"
      borderColor={isSelected ? 'cyan' : 'gray'}
      paddingX={1}
      paddingY={0}
      marginBottom={0}
    >
      <Box width={3}>
        <Text bold color={isSelected ? 'cyan' : 'dimGray'}>
          {isSelected ? '▶' : ' '}
        </Text>
      </Box>
      
      <Box width={25} flexShrink={0}>
        <Text bold color={status.color}>
          {status.symbol}
        </Text>
        <Text bold color={isSelected ? 'cyan' : 'white'}>
          {' '}{service.name}
        </Text>
      </Box>
      
      <Box width={8} flexShrink={0}>
        <Text color={transport.color} bold>{transport.text}</Text>
      </Box>
      
      <Box flexGrow={1} flexShrink={1}>
        <Text color="dimGray">{endpointDisplay}</Text>
      </Box>
      
      {totalTools > 0 && (
        <Box width={12} flexShrink={0}>
          <Text color="magenta" bold>{enabledTools}/{totalTools}</Text>
          <Text dimColor> tools</Text>
        </Box>
      )}
    </Box>
  );
};

/**
 * Service List Component
 */
export const ServiceList: React.FC<ServiceListProps> = ({
  services,
  selectedIndex,
  onSelect,
  globalToolStats,
  terminalHeight,
}) => {
  const effectiveTerminalHeight = terminalHeight || 24;
  const HEADER_LINES = 3;
  const FOOTER_LINES = 3;
  const SERVICE_ITEM_LINES = 4;
  const MAX_VISIBLE_SERVICES = Math.max(3, Math.floor((effectiveTerminalHeight - HEADER_LINES - FOOTER_LINES) / SERVICE_ITEM_LINES));
  
  const [currentPage, setCurrentPage] = useState(0);
  const totalPages = Math.ceil(services.length / MAX_VISIBLE_SERVICES);
  const startIndex = currentPage * MAX_VISIBLE_SERVICES;
  const visibleServices = services.slice(startIndex, startIndex + MAX_VISIBLE_SERVICES);
  
  useEffect(() => {
    const newPage = Math.floor(selectedIndex / MAX_VISIBLE_SERVICES);
    if (newPage !== currentPage && newPage >= 0 && newPage < totalPages) {
      setCurrentPage(newPage);
    }
  }, [selectedIndex, MAX_VISIBLE_SERVICES, totalPages, currentPage]);
  
  useInput((_input, key) => {
    if (key.leftArrow) {
      if (currentPage > 0) {
        const newPage = currentPage - 1;
        setCurrentPage(newPage);
        onSelect(newPage * MAX_VISIBLE_SERVICES);
      }
    } else if (key.rightArrow) {
      if (currentPage < totalPages - 1) {
        const newPage = currentPage + 1;
        setCurrentPage(newPage);
        onSelect(newPage * MAX_VISIBLE_SERVICES);
      }
    }
  });
  
  if (services.length === 0) {
    return (
      <Box flexDirection="column">
        <Box
          borderStyle="double"
          borderColor="yellow"
          padding={1}
          flexDirection="column"
        >
          <Text bold color="yellow">📋 No services registered</Text>
          <Text dimColor>Get started by adding your first MCP service</Text>
        </Box>
        
        <Box marginTop={1} borderStyle="single" borderColor="cyan" paddingX={1}>
          <Text>
            <Text color="cyan">a</Text>
            <Text dimColor>: Add service | </Text>
            <Text color="cyan">?</Text>
            <Text dimColor>: Help | </Text>
            <Text color="cyan">q</Text>
            <Text dimColor>: Quit</Text>
          </Text>
        </Box>
      </Box>
    );
  }

  const enabledCount = services.filter(s => s.enabled).length;
  const disabledCount = services.length - enabledCount;

  return (
    <Box flexDirection="column">
      <Box paddingX={1} paddingY={0}>
        <Text bold color="cyan">{services.length} Services</Text>
        <Text dimColor>: </Text>
        <Text color="green" bold>{enabledCount} enabled</Text>
        {disabledCount > 0 && (
          <>
            <Text dimColor>, </Text>
            <Text color="red" bold>{disabledCount} disabled</Text>
          </>
        )}
        {globalToolStats && globalToolStats.total > 0 && (
          <>
            <Text dimColor> | </Text>
            <Text color="magenta" bold>{globalToolStats.enabled}/{globalToolStats.total}</Text>
            <Text dimColor> tools</Text>
          </>
        )}
      </Box>
      
      {/* Service list */}
      {visibleServices.map((service, index) => (
        <ServiceListItem
          key={service.name}
          service={service}
          isSelected={startIndex + index === selectedIndex}
        />
      ))}
      
      {totalPages > 1 && (
        <Box marginTop={1} paddingX={2} justifyContent="center">
          <Text dimColor>
            <Text bold>{currentPage + 1}/{totalPages}</Text>
            <Text> | ↑/↓ Navigate | ←/→ Page </Text>
            <Text dimColor>({services.length} services)</Text>
          </Text>
        </Box>
      )}
      
      {/* Footer with shortcuts */}
      <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={2} paddingY={1}>
        <Box flexWrap="wrap">
          <Text color="cyan" bold>↑/↓</Text><Text dimColor> Navigate </Text>
          <Text dimColor>|</Text>
          <Text color="cyan" bold>Enter</Text><Text dimColor> Edit </Text>
          <Text dimColor>|</Text>
          <Text color="cyan" bold>Space</Text><Text dimColor> Toggle </Text>
          <Text dimColor>|</Text>
          <Text color="cyan" bold>a</Text><Text dimColor> Add </Text>
          <Text dimColor>|</Text>
          <Text color="cyan" bold>d</Text><Text dimColor> Delete </Text>
          <Text dimColor>|</Text>
          <Text color="cyan" bold>v</Text><Text dimColor> Tools </Text>
          <Text dimColor>|</Text>
          <Text color="cyan" bold>q</Text><Text dimColor> Quit</Text>
        </Box>
      </Box>
    </Box>
  );
};
