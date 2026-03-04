/**
 * Service List Component
 * 
 * Displays all registered services with their status and details.
 * Supports navigation and selection with enhanced visual feedback.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { ServiceDefinition } from '../../types/service.js';

export interface ServiceListProps {
  services: ServiceDefinition[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onToggleService?: (serviceName: string, enabled: boolean) => void;
  onDeleteService?: (serviceName: string) => void;
  showDetails?: boolean;
  globalToolStats?: { enabled: number; total: number };
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
  showDetails?: boolean;
}> = ({ service, isSelected, showDetails = true }) => {
  const transport = formatTransport(service.transport);
  const status = formatEnabled(service.enabled);
  const tags = service.tags && service.tags.length > 0 ? service.tags.join(', ') : 'none';
  
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

  return (
    <Box
      flexDirection="column"
      borderStyle={isSelected ? 'double' : 'single'}
      borderColor={isSelected ? 'cyan' : 'gray'}
      paddingX={1}
      marginBottom={1}
    >
      {/* Header line */}
      <Box justifyContent="space-between">
        <Box>
          <Text bold color={isSelected ? 'cyan' : 'white'}>
            {isSelected ? '▶ ' : '  '}
            <Text color={status.color} bold>
              {status.symbol}
            </Text>
            {' '}{service.name}
          </Text>
        </Box>
        <Box>
          <Text color={status.color}>{status.text}</Text>
          {totalTools > 0 && (
            <>
              <Text dimColor> • </Text>
              <Text color="magenta">{enabledTools}/{totalTools} tools</Text>
            </>
          )}
        </Box>
      </Box>
      
      {/* Transport and endpoint */}
      <Box marginLeft={2}>
        <Text dimColor>Transport: </Text>
        <Text color={transport.color} bold>{transport.text}</Text>
        
        {service.transport === 'stdio' && service.command && (
          <>
            <Text dimColor> • Command: </Text>
            <Text color="yellow">{service.command}</Text>
            {service.args && service.args.length > 0 && (
              <>
                <Text dimColor> </Text>
                <Text dimColor>{service.args.slice(0, 2).join(' ')}</Text>
                {service.args.length > 2 && <Text dimColor>...</Text>}
              </>
            )}
          </>
        )}
        
        {(service.transport === 'sse' || service.transport === 'http') && service.url && (
          <>
            <Text dimColor> • URL: </Text>
            <Text color="blue">{service.url}</Text>
          </>
        )}
      </Box>
      
      {/* Details (optional) */}
      {showDetails && (
        <>
          {/* Tags */}
          {service.tags && service.tags.length > 0 && (
            <Box marginLeft={2}>
              <Text dimColor>Tags: </Text>
              {service.tags.map((tag, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <Text dimColor>, </Text>}
                  <Text color="yellow">{tag}</Text>
                </React.Fragment>
              ))}
            </Box>
          )}
          
          {/* Connection pool (only if selected) */}
          {isSelected && service.connectionPool && (
            <Box marginLeft={2}>
              <Text dimColor>Pool: </Text>
              <Text>
                max={service.connectionPool.maxConnections}, 
                idle={service.connectionPool.idleTimeout}ms, 
                timeout={service.connectionPool.connectionTimeout}ms
              </Text>
            </Box>
          )}
        </>
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
  onToggleService,
  onDeleteService,
  showDetails = true,
  globalToolStats,
}) => {
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
      {/* Summary header with global tool stats */}
      <Box marginBottom={1} paddingX={1} justifyContent="space-between">
        <Box>
          <Text bold>Services ({services.length})</Text>
          <Text dimColor> • </Text>
          <Text color="green">{enabledCount} enabled</Text>
          {disabledCount > 0 && (
            <>
              <Text dimColor> • </Text>
              <Text color="red">{disabledCount} disabled</Text>
            </>
          )}
        </Box>
        {globalToolStats && globalToolStats.total > 0 && (
          <Box>
            <Text dimColor>Tools: </Text>
            <Text color="magenta" bold>
              {globalToolStats.enabled}/{globalToolStats.total}
            </Text>
            <Text dimColor> enabled</Text>
          </Box>
        )}
      </Box>
      
      {/* Service list */}
      {services.map((service, index) => (
        <ServiceListItem
          key={service.name}
          service={service}
          isSelected={index === selectedIndex}
          showDetails={showDetails}
        />
      ))}
      
      {/* Footer with shortcuts */}
      <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
        <Box flexDirection="column">
          <Box flexWrap="wrap">
            <Text color="cyan">↑/↓</Text><Text dimColor>: Navigate | </Text>
            <Text color="cyan">Enter/e</Text><Text dimColor>: Edit | </Text>
            <Text color="cyan">a</Text><Text dimColor>: Add | </Text>
            <Text color="cyan">d</Text><Text dimColor>: Delete | </Text>
            <Text color="cyan">Space/t</Text><Text dimColor>: Toggle | </Text>
            <Text color="cyan">v</Text><Text dimColor>: Tools | </Text>
            <Text color="cyan">r</Text><Text dimColor>: Refresh | </Text>
            <Text color="cyan">?</Text><Text dimColor>: Help | </Text>
            <Text color="cyan">q</Text><Text dimColor>: Quit</Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};
