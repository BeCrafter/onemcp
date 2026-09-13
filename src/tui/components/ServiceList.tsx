/**
 * Service List Component
 *
 * Displays all registered services with their status and details.
 * Supports navigation and selection with enhanced visual feedback.
 *
 * Every service renders on EXACTLY one line: the endpoint/tags are truncated to
 * a computed cell budget instead of wrapping. Wrapping was what pushed the frame
 * past the terminal (rows can be 2-3 lines when an endpoint is long), and a frame
 * taller than the viewport makes ink's absolute writes land on the wrong rows.
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { truncateDisplay } from '../text-layout.js';
import type { ServiceDefinition } from '../../types/service.js';
import type { DiscoveryStatus } from '../tool-discovery-manager.js';

export interface ServiceListProps {
  services: ServiceDefinition[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  terminalHeight?: number;
  discoveryStatus?: Map<string, DiscoveryStatus>;
  toolCounts?: Map<string, number>;
}

/** Column budgets derived from the terminal width. */
export interface ListColumnLayout {
  nameWidth: number;
  transportWidth: number;
  endpointWidth: number;
  /** null → the tags column is dropped to keep the endpoint readable. */
  tagWidth: number | null;
  /** null → the tool-count column is dropped. */
  toolWidth: number | null;
}

const MARKER_WIDTH = 3;
const TRANSPORT_WIDTH = 8;
const DEFAULT_NAME_WIDTH = 25;
const DEFAULT_TAG_WIDTH = 28;
const DEFAULT_TOOL_WIDTH = 12;
const MIN_NAME_WIDTH = 10;
/** Below this the endpoint stops being readable, so columns get dropped instead. */
const MIN_ENDPOINT_WIDTH = 10;

/**
 * Split the horizontal budget between columns, dropping the optional ones
 * (tags, then tool counts) before letting the endpoint collapse to nothing.
 */
export function computeColumnLayout(terminalWidth: number): ListColumnLayout {
  const inner = Math.max(20, terminalWidth - 4); // borders (2) + paddingX (2)
  const fixed = MARKER_WIDTH + TRANSPORT_WIDTH;
  let nameWidth = DEFAULT_NAME_WIDTH;
  let tagWidth: number | null = DEFAULT_TAG_WIDTH;
  let toolWidth: number | null = DEFAULT_TOOL_WIDTH;

  const endpointIfKept = (): number =>
    inner - fixed - nameWidth - (tagWidth ?? 0) - (toolWidth ?? 0);

  if (endpointIfKept() < MIN_ENDPOINT_WIDTH) {
    tagWidth = null;
  }
  if (endpointIfKept() < MIN_ENDPOINT_WIDTH) {
    toolWidth = null;
  }
  if (endpointIfKept() < MIN_ENDPOINT_WIDTH) {
    const deficit = MIN_ENDPOINT_WIDTH - endpointIfKept();
    nameWidth -= Math.min(deficit, nameWidth - MIN_NAME_WIDTH);
  }

  return {
    nameWidth,
    transportWidth: TRANSPORT_WIDTH,
    endpointWidth: Math.max(4, endpointIfKept()),
    tagWidth,
    toolWidth,
  };
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
 * Service List Item Component — renders exactly one terminal line.
 */
const ServiceListItem: React.FC<{
  service: ServiceDefinition;
  isSelected: boolean;
  layout: ListColumnLayout;
  discoveryStatus?: DiscoveryStatus;
  toolCount?: number;
}> = ({ service, isSelected, layout, discoveryStatus, toolCount }) => {
  const transport = formatTransport(service.transport);
  const status = formatEnabled(service.enabled);

  // Count explicitly disabled tools from toolStates
  const disabledTools = service.toolStates
    ? Object.entries(service.toolStates).filter(([_, enabled]) => enabled === false).length
    : 0;

  const enabledTools = (toolCount ?? 0) - disabledTools;

  const endpoint =
    service.transport === 'stdio'
      ? (service.command || '') + (service.args?.length ? ' ' + service.args.join(' ') : '')
      : service.url || '';

  const tags = service.tags?.slice(0, 3) ?? [];

  const toolLabel = (): string => {
    if (!service.enabled) {
      return '';
    }
    switch (discoveryStatus) {
      case 'in-progress':
        return '⏳ loading';
      case 'failed':
        return '✗ failed';
      case 'completed':
        return toolCount !== undefined && toolCount > 0
          ? `${Math.max(0, enabledTools)}/${toolCount} tools`
          : '';
      default:
        return '';
    }
  };

  return (
    <Box flexDirection="row" paddingX={1} paddingY={0} marginBottom={0}>
      <Box width={MARKER_WIDTH} flexShrink={0}>
        <Text bold color={isSelected ? 'cyan' : 'gray'}>
          {isSelected ? '▶' : ' '}
        </Text>
      </Box>

      <Box width={layout.nameWidth} flexShrink={0}>
        <Text bold color={status.color}>
          {status.symbol}
        </Text>
        <Text bold color={isSelected ? 'cyan' : 'white'} wrap="truncate">
          {' '}
          {truncateDisplay(service.name, Math.max(1, layout.nameWidth - 2))}
        </Text>
      </Box>

      <Box width={layout.transportWidth} flexShrink={0}>
        <Text color={transport.color} bold wrap="truncate">
          {transport.text}
        </Text>
      </Box>

      <Box width={layout.endpointWidth} flexShrink={0}>
        <Text color="gray" wrap="truncate">
          {truncateDisplay(endpoint, layout.endpointWidth)}
        </Text>
      </Box>

      {layout.tagWidth !== null && (
        <Box width={layout.tagWidth} flexShrink={0} paddingX={1}>
          <Text wrap="truncate">
            {tags.map((tag, index) => (
              <Text key={tag}>
                <Text color="gray">[</Text>
                <Text color="yellow">{tag}</Text>
                <Text color="gray">]</Text>
                {index < tags.length - 1 ? ' ' : ''}
              </Text>
            ))}
          </Text>
        </Box>
      )}

      {layout.toolWidth !== null && (
        <Box width={layout.toolWidth} flexShrink={0} justifyContent="flex-end">
          <Text wrap="truncate">
            <Text color={discoveryStatus === 'failed' ? 'red' : 'magenta'} bold>
              {toolLabel()}
            </Text>
          </Text>
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
  terminalHeight,
  discoveryStatus,
  toolCounts,
}) => {
  const { stdout } = useStdout();
  const effectiveTerminalHeight = terminalHeight || 24;
  const effectiveTerminalWidth = stdout?.columns || 80;

  const layout = computeColumnLayout(effectiveTerminalWidth);

  // Chrome the list draws around its rows: header(1) + box borders(2) +
  // footer borders(2), plus one row for the pagination hint when it shows.
  const LIST_CHROME_LINES = 5;
  const rowsForItems = (withPager: boolean): number =>
    Math.max(3, effectiveTerminalHeight - LIST_CHROME_LINES - (withPager ? 1 : 0));

  const wouldPaginate = Math.ceil(services.length / Math.min(25, rowsForItems(false))) > 1;
  const MAX_VISIBLE_SERVICES = Math.min(25, rowsForItems(wouldPaginate));

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
        <Box borderStyle="double" borderColor="yellow" padding={1} flexDirection="column">
          <Text bold color="yellow">
            📋 No services registered
          </Text>
          <Text color="gray">Get started by adding your first MCP service</Text>
        </Box>

        <Box marginTop={1} borderStyle="single" borderColor="cyan" paddingX={1}>
          <Text>
            <Text color="cyan">a</Text>
            <Text color="gray">: Add service | </Text>
            <Text color="cyan">?</Text>
            <Text color="gray">: Help | </Text>
            <Text color="cyan">q</Text>
            <Text color="gray">: Quit</Text>
          </Text>
        </Box>
      </Box>
    );
  }

  const enabledCount = services.filter((s) => s.enabled).length;
  const disabledCount = services.length - enabledCount;

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box paddingX={1} paddingY={0}>
        <Text bold color="cyan">
          {services.length} Services
        </Text>
        <Text color="gray">: </Text>
        <Text color="green" bold>
          {enabledCount} enabled
        </Text>
        {disabledCount > 0 && (
          <>
            <Text color="gray">, </Text>
            <Text color="red" bold>
              {disabledCount} disabled
            </Text>
          </>
        )}
      </Box>

      {/* Service list with border */}
      <Box
        width={effectiveTerminalWidth}
        flexDirection="column"
        borderStyle="single"
        borderColor="gray"
      >
        {visibleServices.map((service, index) => {
          const svcDiscoveryStatus = discoveryStatus?.get(service.name);
          const svcToolCount = toolCounts?.get(service.name);
          return (
            <ServiceListItem
              key={service.name}
              service={service}
              isSelected={startIndex + index === selectedIndex}
              layout={layout}
              {...(svcDiscoveryStatus !== undefined ? { discoveryStatus: svcDiscoveryStatus } : {})}
              {...(svcToolCount !== undefined ? { toolCount: svcToolCount } : {})}
            />
          );
        })}
      </Box>

      {totalPages > 1 && (
        <Box marginTop={0} paddingX={2} justifyContent="center">
          <Text color="gray">
            <Text bold>
              {currentPage + 1}/{totalPages}
            </Text>
            <Text> | ↑/↓ Navigate | ←/→ Page </Text>
            <Text color="gray">({services.length} services)</Text>
          </Text>
        </Box>
      )}

      {/* Footer with shortcuts */}
      <Box width={effectiveTerminalWidth} borderStyle="single" borderColor="gray" paddingX={1}>
        <Text color="gray" wrap="truncate">
          ↑/↓ Navigate | Enter Edit | Space Toggle | a Add | d Delete | v Tools | r Refresh | q Quit
        </Text>
      </Box>
    </Box>
  );
};
