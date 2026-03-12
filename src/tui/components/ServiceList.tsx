/**
 * Service List Component
 *
 * Displays all registered services with their status and details.
 * Supports navigation and selection with enhanced visual feedback.
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import type { ServiceDefinition } from '../../types/service.js';
import type { DiscoveryStatus } from '../tool-discovery-manager.js';

export interface ServiceListProps {
  services: ServiceDefinition[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  terminalHeight?: number;
  showDetails?: boolean;
  globalToolStats?: {
    enabled: number;
    total: number;
  };
  discoveryStatus?: Map<string, DiscoveryStatus>;
  toolCounts?: Map<string, number>;
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
  discoveryStatus?: DiscoveryStatus;
  toolCount?: number;
}> = ({ service, isSelected, discoveryStatus, toolCount }) => {
  const transport = formatTransport(service.transport);
  const status = formatEnabled(service.enabled);

  // Count explicitly disabled tools from toolStates
  const disabledTools = service.toolStates
    ? Object.entries(service.toolStates).filter(([_, enabled]) => enabled === false).length
    : 0;

  const enabledTools = (toolCount ?? 0) - disabledTools;

  const endpoint = service.transport === 'stdio'
    ? ((service.command || '') + (service.args?.length ? ' ' + service.args.join(' ') : ''))
    : (service.url || '');

  const endpointDisplay = endpoint.length > 50
    ? endpoint.substring(0, 47) + '...'
    : endpoint;

  // Render tool count indicator based on discovery status
  const renderToolIndicator = () => {
    if (!service.enabled) return null;

    switch (discoveryStatus) {
      case 'in-progress':
        return (
          <Box width={12} flexShrink={0}>
            <Text dimColor>⏳ loading</Text>
          </Box>
        );
      case 'failed':
        return (
          <Box width={12} flexShrink={0}>
            <Text color="red">✗ failed</Text>
          </Box>
        );
      case 'completed':
        if (toolCount !== undefined && toolCount > 0) {
          return (
            <Box width={12} flexShrink={0}>
              <Text color="magenta" bold>{Math.max(0, enabledTools)}/{toolCount}</Text>
              <Text dimColor> tools</Text>
            </Box>
          );
        }
        return null;
      default:
        return null;
    }
  };

  return (
    <Box
      flexDirection="row"
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

      {renderToolIndicator()}
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
  terminalHeight,
  discoveryStatus,
  toolCounts,
}) => {
  const { stdout } = useStdout();
  const effectiveTerminalHeight = terminalHeight || 24;
  const effectiveTerminalWidth = stdout?.columns || 80;
  const HEADER_LINES = 2;
  const FOOTER_LINES = 2;
  const SERVICE_ITEM_LINES = 1;
  // Calculate visible services based on terminal height, but cap at 25 per page
  const calculatedVisible = Math.floor((effectiveTerminalHeight - HEADER_LINES - FOOTER_LINES) / SERVICE_ITEM_LINES);
  const MAX_VISIBLE_SERVICES = Math.min(25, Math.max(3, calculatedVisible));

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
      {/* Header */}
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
      </Box>

      {/* Service list with border */}
      <Box width={effectiveTerminalWidth} flexDirection="column" borderStyle="single" borderColor="gray" marginY={0}>
        {visibleServices.map((service, index) => {
          const svcDiscoveryStatus = discoveryStatus?.get(service.name);
          const svcToolCount = toolCounts?.get(service.name);
          return (
            <ServiceListItem
              key={service.name}
              service={service}
              isSelected={startIndex + index === selectedIndex}
              {...(svcDiscoveryStatus !== undefined ? { discoveryStatus: svcDiscoveryStatus } : {})}
              {...(svcToolCount !== undefined ? { toolCount: svcToolCount } : {})}
            />
          );
        })}
      </Box>

      {totalPages > 1 && (
        <Box marginTop={0} paddingX={2} justifyContent="center">
          <Text dimColor>
            <Text bold>{currentPage + 1}/{totalPages}</Text>
            <Text> | ↑/↓ Navigate | ←/→ Page </Text>
            <Text dimColor>({services.length} services)</Text>
          </Text>
        </Box>
      )}

      {/* Footer with shortcuts */}
      <Box width={effectiveTerminalWidth} borderStyle="single" borderColor="gray" paddingX={1} marginTop={0}>
        <Text dimColor>
          ↑/↓ Navigate | Enter Edit | Space Toggle | a Add | d Delete | v Tools | r Refresh | q Quit
        </Text>
      </Box>
    </Box>
  );
};
